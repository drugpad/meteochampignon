"""Points d'observation (GBIF) de la région + fenêtres de variables du milieu à 20 m autour de chacun.

Entrées : .cache-habitat/gbif/sp.json (fetch_all.py) et bg2.json (fetch_bg2.py), .cache-habitat/fine/covariates-20m.tif.
Sortie : .cache-habitat/gbif/patches.npz
  - kind : -1 = fond (champignons quelconques), sinon index de l'espèce (build-habitat.SPECIES) ;
  - lon, lat, year, month, day, unc (incertitude déclarée en m, -1 = inconnue) ;
  - cov : (N, bandes, 21, 21) uint8, alt : (N, 21, 21) uint16 (fenêtre de ± 200 m centrée sur le point).
Doublons retirés : une observation par espèce, case de 20 m et jour (le fond : une par case et jour).
"""
import importlib.util
import json
import os
import sys

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.windows import Window

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.dirname(HERE))
spec = importlib.util.spec_from_file_location("fine", os.path.join(ROOT, "scripts", "build-habitat-fine.py"))
fine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fine)

G = os.path.join(ROOT, ".cache-habitat", "gbif")
HALF = 10  # fenêtre 21 x 21 cases
MAX_UNC = 2000


def records():
    sp = json.load(open(os.path.join(G, "sp.json")))
    out = []
    for k, name in enumerate(fine.SPECIES):
        out += [(k, r) for r in sp[name]["recs"]]
    # Fond : champignons du sol à chapeau (bg2.json, sans lichens) ; bg.json (tous champignons) en repli.
    bg = os.path.join(G, "bg2.json") if os.path.exists(os.path.join(G, "bg2.json")) else os.path.join(G, "bg.json")
    out += [(-1, r) for r in json.load(open(bg))]
    return out


def main():
    to_l93 = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)
    recs = records()
    lon = np.array([r["decimalLongitude"] for _, r in recs])
    lat = np.array([r["decimalLatitude"] for _, r in recs])
    x, y = to_l93.transform(lon, lat)
    row = np.floor((fine.Y1 - y) / fine.RES).astype(int)
    col = np.floor((x - fine.X0) / fine.RES).astype(int)
    keep, seen = [], set()
    for i, (k, r) in enumerate(recs):
        unc = r.get("coordinateUncertaintyInMeters")
        if unc is not None and unc > MAX_UNC:
            continue
        if not (HALF <= row[i] < fine.H - HALF and HALF <= col[i] < fine.W - HALF):
            continue
        key = (k, row[i], col[i], r.get("year"), r.get("month"), r.get("day"))
        if key in seen:
            continue
        seen.add(key)
        keep.append(i)
    keep = np.array(keep)
    # Lecture triée par tuile (cache de blocs GDAL).
    keep = keep[np.lexsort((col[keep] // 512, row[keep] // 512))]
    n = len(keep)
    print("points gardés", n, "dont espèces", sum(recs[i][0] >= 0 for i in keep), flush=True)
    cov = np.zeros((n, len(fine.COV_BANDS), 2 * HALF + 1, 2 * HALF + 1), np.uint8)
    alt = np.zeros((n, 2 * HALF + 1, 2 * HALF + 1), np.uint16)
    with rasterio.Env(GDAL_CACHEMAX=1024), rasterio.open(fine.COV) as src, rasterio.open(fine.COV_ALT) as salt:
        for j, i in enumerate(keep):
            win = Window(col[i] - HALF, row[i] - HALF, 2 * HALF + 1, 2 * HALF + 1)
            cov[j] = src.read(window=win)
            alt[j] = salt.read(1, window=win)
            if j % 5000 == 0:
                print(j, "/", n, flush=True)

    def field(name, default=-1):
        return np.array([recs[i][1].get(name) if recs[i][1].get(name) is not None else default for i in keep])

    np.savez_compressed(
        os.path.join(G, "patches.npz"), kind=np.array([recs[i][0] for i in keep]), lon=lon[keep], lat=lat[keep],
        year=field("year"), month=field("month"), day=field("day"), unc=field("coordinateUncertaintyInMeters"),
        dataset=np.array([str(recs[i][1].get("datasetKey")) for i in keep]), cov=cov, alt=alt,
    )
    print("écrit", cov.shape)


if __name__ == "__main__":
    main()
