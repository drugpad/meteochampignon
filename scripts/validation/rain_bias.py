"""Biais de la pluie du modèle (AROME raccordé, historique weather/ de la branche data) par rapport aux pluviomètres
Météo-France (historique horaire de la branche live), jour par jour, selon l'altitude de la station.

Mesures :
  - rapport modèle / mesure (somme sur les jours) et écart moyen, par tranche d'altitude ;
  - validation « une station mise de côté » de la correction actuelle (additive, portée 10 km) et de variantes :
    on corrige la carte avec TOUTES les autres stations, et on regarde l'erreur à la station retirée — c'est l'erreur
    d'un endroit SANS pluviomètre, le cas réel d'un coin en forêt.

Usage : python rain_bias.py    (Python global : s3fs, omfiles, scipy)
"""
import importlib.util
import json
import os
from datetime import timedelta

import numpy as np
from scipy.interpolate import RegularGridInterpolator

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
spec = importlib.util.spec_from_file_location("bp", os.path.join(ROOT, "scripts", "build-pousse.py"))
bp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bp)
rm = bp.rm


def main():
    rows = rm.out_shape()[1] - rm.out_shape()[0]
    cols = rm.out_shape()[3] - rm.out_shape()[2]
    lats, lons = rm.target_lats(rows), rm.target_lons(cols)
    archive = bp.load_archive(rows)
    stations = bp.load_stations()
    meta = json.load(open(os.path.join(ROOT, "src", "data", "stations-midi-pyrenees.json"), encoding="utf-8"))
    alt_of = {(round(s["lat"], 4), round(s["lon"], 4)): s["altitude"] for s in meta}
    today = max(archive) + timedelta(days=1)
    rec = []  # (jour, lat, lon, altitude, mesure, modèle)
    per_day = {}
    for b in range(1, 20):
        d = today - timedelta(days=b)
        if d not in archive:
            continue
        tot = bp.station_totals(stations, d)
        if len(tot) < 50:
            continue
        rain = archive[d][0]
        f = RegularGridInterpolator((lats, lons), rain, bounds_error=False, fill_value=None)
        model = f(np.array([(t[0], t[1]) for t in tot]))
        per_day[d] = (rain, tot)
        for (la, lo, mm), mo in zip(tot, model):
            rec.append((d, la, lo, alt_of.get((round(la, 4), round(lo, 4)), -1), mm, float(mo)))
    print(f"{len(per_day)} jours, {len(rec)} comparaisons station-jour")
    alt = np.array([r[3] for r in rec], float)
    meas = np.array([r[4] for r in rec])
    model = np.array([r[5] for r in rec])
    print("\nPluie totale par tranche d'altitude (somme sur les jours) :")
    for lo_, hi_ in ((0, 300), (300, 600), (600, 900), (900, 1200), (1200, 1600), (1600, 4000)):
        m = (alt >= lo_) & (alt < hi_)
        if m.sum() < 10:
            continue
        print(f"  {lo_:4d}-{hi_:4d} m : {int(m.sum()):4d} station-jours, mesure {meas[m].sum():7.0f} mm, modèle {model[m].sum():7.0f} mm, "
              f"rapport {model[m].sum() / max(meas[m].sum(), 0.1):4.2f}, écart moyen {np.abs(model[m] - meas[m]).mean():4.2f} mm")
    wet = meas + model > 2
    print(f"  jours de pluie : rapport global {model[wet].sum() / meas[wet].sum():.2f}")

    # Validation « station mise de côté » : erreur à un endroit sans pluviomètre.
    def loo(correct):
        errs = []
        for d, (rain, tot) in per_day.items():
            for k in range(len(tot)):
                others = tot[:k] + tot[k + 1 :]
                out = correct(rain, others)
                v = RegularGridInterpolator((lats, lons), out, bounds_error=False, fill_value=None)([[tot[k][0], tot[k][1]]])[0]
                a = alt_of.get((round(tot[k][0], 4), round(tot[k][1], 4)), -1)
                errs.append((a, abs(v - tot[k][2]), v, tot[k][2]))
        return np.array(errs)

    variants = {
        "modèle seul": lambda rain, t: rain,
        "correction actuelle (additive, 10 km)": lambda rain, t: bp.correct_rain(rain, t, rows, cols)[0],
    }
    for name, fn in variants.items():
        e = loo(fn)
        mtn = e[:, 0] >= 900
        print(f"\n{name} : erreur moyenne {e[:, 1].mean():.2f} mm/jour (montagne >= 900 m : {e[mtn, 1].mean():.2f}, "
              f"rapport modèle/mesure en montagne {e[mtn, 2].sum() / e[mtn, 3].sum():.2f})")


if __name__ == "__main__":
    main()
