"""ERA5 (0,25°, horaire) sur le Sud-Ouest, lu sur le stockage public d'Open-Meteo (s3://openmeteo, CC BY 4.0) :
pluie journalière (mm), température moyenne et minimale journalières (°C), jours UTC, 1995 -> aujourd'hui.
Sortie : era5-<var>-<morceau>.npz dans ce dossier, puis era5-daily.npz (assemblage)."""
import datetime as dt
import glob
import os
import sys
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import s3fs
from omfiles import OmFileReader

HERE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".cache-habitat", "era5")
LAT0, LAT1, LON0, LON1 = 42.25, 46.5, -2.0, 4.5
I0, I1 = int(round((LAT0 + 90) / 0.25)), int(round((LAT1 + 90) / 0.25)) + 1
J0, J1 = int(round((LON0 + 180) / 0.25)), int(round((LON1 + 180) / 0.25)) + 1
fs = s3fs.S3FileSystem(anon=True)
BASE = "openmeteo/data/copernicus_era5"


def job(var, name):
    out = os.path.join(HERE, f"era5-{var}-{name}.npz")
    if os.path.exists(out):
        return out
    path = f"{BASE}/{var}/{name}.om"
    if name.startswith("year_"):
        t0 = dt.datetime(int(name[5:]), 1, 1)
    else:
        t0 = dt.datetime(1970, 1, 1) + dt.timedelta(hours=int(name[6:]) * 504)
    for attempt in range(4):
        try:
            a = OmFileReader.from_fsspec(fs, path)[I0:I1, J0:J1, :]
            break
        except Exception as e:  # coupure réseau : on recommence
            print(var, name, "erreur", e, flush=True)
    else:
        raise RuntimeError(path)
    np.savez_compressed(out, t0=np.datetime64(t0, "h"), data=a.astype(np.float32))
    print(var, name, a.shape, flush=True)
    return out


def assemble():
    days = {}
    for var in ("precipitation", "temperature_2m"):
        hourly = {}
        for f in glob.glob(os.path.join(HERE, f"era5-{var}-*.npz")):
            z = np.load(f)
            t0 = z["t0"]
            a = z["data"]
            for k in range(a.shape[2]):
                v = a[:, :, k]
                if np.isnan(v).all():
                    continue
                hourly[t0 + np.timedelta64(k, "h")] = v
        ts = sorted(hourly)
        print(var, len(ts), "heures", ts[0], ts[-1], flush=True)
        by_day = {}
        for t in ts:
            by_day.setdefault(t.astype("datetime64[D]"), []).append(hourly[t])
        full = [d for d, v in by_day.items() if len(v) == 24]
        days[var] = (sorted(full), by_day)
    dates = sorted(set(days["precipitation"][0]) & set(days["temperature_2m"][0]))
    P = np.stack([np.sum(days["precipitation"][1][d], axis=0) for d in dates])
    T = [np.stack(days["temperature_2m"][1][d]) for d in dates]
    Tm = np.stack([t.mean(axis=0) for t in T])
    Tn = np.stack([t.min(axis=0) for t in T])
    hs = OmFileReader.from_fsspec(fs, f"{BASE}/static/HSURF.om")[I0:I1, J0:J1]
    np.savez_compressed(os.path.join(HERE, "era5-daily.npz"), dates=np.array(dates), P=P.astype(np.float32), Tm=Tm.astype(np.float32),
                        Tn=Tn.astype(np.float32), hsurf=np.asarray(hs, np.float32), lat0=LAT0 + 0 * 0.25, lon0=LON0, step=0.25)
    print("jours", len(dates), dates[0], dates[-1], P.shape)


if __name__ == "__main__":
    if sys.argv[1:] == ["assemble"]:
        assemble()
        sys.exit()
    names = [f"year_{y}" for y in range(1995, 2022)]
    names += [p.split("/")[-1][:-3] for p in fs.ls(f"{BASE}/precipitation") if "chunk_" in p]
    tasks = [(v, n) for n in names for v in ("precipitation", "temperature_2m")]
    with ThreadPoolExecutor(8) as ex:
        list(ex.map(lambda t: job(*t), tasks))
    assemble()
