"""Note finale (milieu x météo de pousse) aux observations datées de la région, contre le fond « champignons du sol »
observé aux mêmes périodes (mêmes cueilleurs, mêmes chemins) : AUC de l'ancienne et de la nouvelle version.

  milieu : nouveau = règles actuelles (habitat_eval) ; ancien = raster sauvegardé (OLD_HABITAT, 7 bandes x 255) ;
  météo  : nouveau = scripts/build-pousse.py ; ancien = OLD_POUSSE (copie du fichier d'avant la révision).

Usage : python combined_eval.py <ancien habitat-20m-7b.tif> <ancien build-pousse.py>
"""
import importlib.util
import os
import sys

import numpy as np
import rasterio
from pyproj import Transformer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import habitat_eval as he  # noqa: E402
import pousse_eval as pe  # noqa: E402


def old_pousse_module(path):
    spec = importlib.util.spec_from_file_location("old_pousse", path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def weather(era, mod, sp, lat, lon, alt, days):
    out = np.full(len(lat), np.nan)
    ok = np.array([era.index.get(d, -1) >= pe.LOOKBACK + 10 for d in days])
    idx = np.array([era.index.get(d, -1) for d in days])
    if not ok.any():
        return out
    P, Tm, Tn = era.series(lat[ok], lon[ok], alt[ok], idx[ok], n=pe.LOOKBACK)
    series = (P[:, :, None], Tm[:, :, None], Tn[:, :, None])
    orig = mod.season_factor
    mod.season_factor = lambda s, d: 1.0
    try:
        raw = mod.pousse(series, [None] * P.shape[0], P.shape[0] - 1, sp)[:, 0]
    finally:
        mod.season_factor = orig
    seas = np.array([orig(sp, d.astype(object)) for d in days[ok]])
    out[ok] = raw * seas
    return out


def main(old_tif, old_py):
    d = he.load()
    dated = (d["year"] >= 1995) & (d["month"] > 0) & (d["day"] > 0)
    d = {k: v[dated] for k, v in d.items()}
    days = np.array([np.datetime64(f"{y:04d}-{m:02d}-{dd:02d}") for y, m, dd in zip(d["year"], d["month"], d["day"])])
    era = pe.Era5()
    inrange = (days >= era.dates[0] + 70) & (days <= era.dates[-1])
    d = {k: v[inrange] for k, v in d.items()}
    days = days[inrange]
    alt = d["alt"][:, he.HALF, he.HALF].astype(float)
    hab_new = he.habitat_points(d, reduce="mean3")
    to_l93 = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)
    x, y = to_l93.transform(d["lon"], d["lat"])
    with rasterio.open(old_tif) as src:
        hab_old = np.array(list(src.sample(zip(x, y)))).astype(float) / 255
    oldm = old_pousse_module(old_py)
    bg = d["kind"] == -1
    print(f"points datés : {len(days)}, fond {bg.sum()}")
    for k, sp in enumerate(he.fine.SPECIES):
        pres = d["kind"] == k
        if pres.sum() < 15:
            continue
        m = pres | bg
        w_new = weather(era, pe.bp, sp, d["lat"][m], d["lon"][m], alt[m], days[m])
        w_old = weather(era, oldm, sp, d["lat"][m], d["lon"][m], alt[m], days[m])
        p, b = pres[m], bg[m]
        res = {
            "milieu ancien": he.auc(hab_old[m][p, k], hab_old[m][b, k]),
            "milieu nouveau": he.auc(hab_new[m][p, k], hab_new[m][b, k]),
            "météo ancienne": he.auc(w_old[p], w_old[b]),
            "météo nouvelle": he.auc(w_new[p], w_new[b]),
            "TOTAL ancien": he.auc(hab_old[m][p, k] * w_old[p], hab_old[m][b, k] * w_old[b]),
            "TOTAL nouveau": he.auc(hab_new[m][p, k] * w_new[p], hab_new[m][b, k] * w_new[b]),
        }
        print(f"  {sp:14s} n={p.sum():4d}  " + "  ".join(f"{n} {v:.3f}" for n, v in res.items()))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
