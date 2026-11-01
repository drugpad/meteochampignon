"""Humidité du sol ERA5-Land (0-7 cm, m³/m³, 0,1°, horaire -> moyenne journalière) sur le Sud-Ouest, 2005 -> aujourd'hui,
lue sur le stockage public d'Open-Meteo (s3://openmeteo, CC BY 4.0). Pour tester si l'humidité réelle du sol prédit
mieux les sorties de champignons que les cumuls de pluie (docs/etude-champignons-coins.md, section 10).
Sortie : .cache-habitat/era5land/sm-<morceau>.npz puis sm-daily.npz (assemblage). Python global (s3fs + omfiles)."""
import datetime as dt
import glob
import os
import sys
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import s3fs
from omfiles import OmFileReader

HERE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".cache-habitat", "era5land")
os.makedirs(HERE, exist_ok=True)
LAT0, LAT1, LON0, LON1 = 42.3, 46.5, -2.0, 4.5
I0, I1 = int(round((LAT0 + 90) / 0.1)), int(round((LAT1 + 90) / 0.1)) + 1
J0, J1 = int(round((LON0 + 180) / 0.1)), int(round((LON1 + 180) / 0.1)) + 1
BASE = "openmeteo/data/copernicus_era5_land/soil_moisture_0_to_7cm"
fs = s3fs.S3FileSystem(anon=True)


def job(name):
    out = os.path.join(HERE, f"sm-{name}.npz")
    if os.path.exists(out):
        return
    t0 = dt.datetime(int(name[5:]), 1, 1) if name.startswith("year_") else dt.datetime(1970, 1, 1) + dt.timedelta(hours=int(name[6:]) * 504)
    for _ in range(4):
        try:
            a = OmFileReader.from_fsspec(fs, f"{BASE}/{name}.om")[I0:I1, J0:J1, :]
            break
        except Exception as e:
            print(name, "erreur", e, flush=True)
    else:
        raise RuntimeError(name)
    # Moyenne journalière (jours UTC complets) : divise la taille par 24.
    n = a.shape[2] // 24
    daily = np.nanmean(a[:, :, : n * 24].reshape(a.shape[0], a.shape[1], n, 24), axis=3).astype(np.float32)
    np.savez_compressed(out, d0=np.datetime64(t0.date()), data=daily)
    print(name, daily.shape, flush=True)


def assemble():
    days = {}
    for f in sorted(glob.glob(os.path.join(HERE, "sm-*.npz"))):
        if f.endswith("sm-daily.npz"):
            continue
        z = np.load(f)
        for k in range(z["data"].shape[2]):
            v = z["data"][:, :, k]
            if not np.isnan(v).all():
                days[z["d0"] + np.timedelta64(k, "D")] = v
    dates = sorted(days)
    np.savez_compressed(os.path.join(HERE, "sm-daily.npz"), dates=np.array(dates), SM=np.stack([days[d] for d in dates]),
                        lat0=LAT0, lon0=LON0, step=0.1)
    print("jours", len(dates), dates[0], dates[-1])


if __name__ == "__main__":
    if sys.argv[1:] == ["assemble"]:
        assemble()
        sys.exit()
    names = [f"year_{y}" for y in range(2005, 2022)] + [p.split("/")[-1][:-3] for p in fs.ls(BASE) if "chunk_" in p]
    with ThreadPoolExecutor(16) as ex:
        list(ex.map(job, names))
    assemble()
