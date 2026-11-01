"""Variantes de la correction de pluie par les pluviomètres, validées « station mise de côté » (erreur à un endroit
sans pluviomètre). Calcul direct au point retiré : valeur corrigée = modèle + somme(w_j r_j) / (W0 + somme(w_j)),
avec r_j = mesure - modèle aux autres stations (exactement ce que fait build-pousse.correct_rain, en plus rapide).

Variantes : portée R (km), poids « modèle seul » W0, prise en compte de l'écart d'altitude (poids x exp(-(dz/H)^2)),
correction multiplicative (rapport mesure / modèle, en log) au lieu d'additive.

Usage : python rain_correction_fit.py
"""
import itertools
import json
import os
import sys
from datetime import timedelta

import numpy as np
from scipy.interpolate import RegularGridInterpolator

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rain_bias as rb  # noqa: E402

bp, rm = rb.bp, rb.rm


def collect():
    rows = rm.out_shape()[1] - rm.out_shape()[0]
    cols = rm.out_shape()[3] - rm.out_shape()[2]
    lats, lons = rm.target_lats(rows), rm.target_lons(cols)
    archive = bp.load_archive(rows)
    stations = bp.load_stations()
    meta = json.load(open(os.path.join(rb.ROOT, "src", "data", "stations-midi-pyrenees.json"), encoding="utf-8"))
    alt_of = {(round(s["lat"], 4), round(s["lon"], 4)): s["altitude"] for s in meta}
    today = max(archive) + timedelta(days=1)
    days = []
    for b in range(1, 20):
        d = today - timedelta(days=b)
        if d not in archive:
            continue
        tot = bp.station_totals(stations, d)
        if len(tot) < 50:
            continue
        f = RegularGridInterpolator((lats, lons), archive[d][0], bounds_error=False, fill_value=None)
        st = np.array([(t[0], t[1]) for t in tot])
        days.append(dict(lat=st[:, 0], lon=st[:, 1], meas=np.array([t[2] for t in tot]), model=f(st),
                         alt=np.array([alt_of.get((round(t[0], 4), round(t[1], 4)), np.nan) for t in tot], float)))
    return days


def loo_errors(days, R, W0, H=None, mult=False):
    errs, alts, ests, meas = [], [], [], []
    for d in days:
        dy = (d["lat"][:, None] - d["lat"][None, :]) * 111.32
        dx = (d["lon"][:, None] - d["lon"][None, :]) * 111.32 * np.cos(np.radians(d["lat"][:, None]))
        w = np.exp(-(dx * dx + dy * dy) / (2 * R * R))
        if H is not None:
            dz = np.nan_to_num(d["alt"][:, None] - d["alt"][None, :], nan=0)
            w *= np.exp(-((dz / H) ** 2))
        np.fill_diagonal(w, 0)
        if mult:
            r = np.log((d["meas"] + 0.5) / (d["model"] + 0.5))
            est = (d["model"] + 0.5) * np.exp((w @ r) / (W0 + w.sum(axis=1))) - 0.5
        else:
            r = d["meas"] - d["model"]
            est = d["model"] + (w @ r) / (W0 + w.sum(axis=1))
        est = np.clip(est, 0, None)
        errs.append(np.abs(est - d["meas"]))
        alts.append(d["alt"])
        ests.append(est)
        meas.append(d["meas"])
    e, a = np.concatenate(errs), np.concatenate(alts)
    est, m = np.concatenate(ests), np.concatenate(meas)
    mtn = a >= 900
    return e.mean(), e[mtn].mean(), est[mtn].sum() / m[mtn].sum()


def main():
    days = collect()
    print(f"{len(days)} jours, {sum(len(d['meas']) for d in days)} station-jours")
    m0 = np.concatenate([np.abs(d["model"] - d["meas"]) for d in days]).mean()
    print(f"modèle seul : {m0:.3f}")
    print(f"actuelle (R=10, W0=0,15) : %.3f (montagne %.3f, rapport %.2f)" % loo_errors(days, 10, 0.15))
    res = []
    for R, W0, H, mult in itertools.product((5, 10, 15, 20, 30), (0.05, 0.15, 0.3, 0.6), (None, 200, 400, 800), (False, True)):
        res.append((*loo_errors(days, R, W0, H, mult), R, W0, H, mult))
    res.sort()
    print("meilleures variantes (erreur moyenne, montagne, rapport montagne, R, W0, H, multiplicative) :")
    for r in res[:10]:
        print("  %.3f  %.3f  %.2f  R=%s W0=%s H=%s mult=%s" % r)
    best_add = [r for r in res if r[5] is None and not r[6]][0]
    print("meilleure sans altitude ni rapport : %.3f %.3f %.2f R=%s W0=%s" % best_add[:5])


if __name__ == "__main__":
    main()
