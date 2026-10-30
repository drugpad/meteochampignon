"""Ajustement d'un modèle de pousse « à fenêtres » par espèce sur les observations GBIF datées + ERA5.

Forme (inspirée de Brejon Lamartinière & Hoffman, bioRxiv 2025 : pluie cumulée ~26 j, température moyenne ~20 j) :
  pluie   R = cumul de pluie de J-(L+w) à J-L (fenêtre de w jours finissant L jours avant le jour évalué)
  f_pluie = 1 - exp(-R / R0)                        (saturation : au-delà de ~2 R0, plus d'effet)
  f_temp  = exp(-((T - Topt) / s)^2 / 2), T = moyenne des v derniers jours
  score   = f_pluie x f_temp
Critère : moyenne de deux AUC appariés (même lieu) : « années » (même jour, autres années) et « semaines » (même
année, ±10 à 45 jours). Validation : paramètres choisis sur les années paires, mesurés sur les impaires, et inversement.

Usage : python pousse_fit.py
"""
import itertools
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pousse_eval as pe  # noqa: E402

N_BACK = 100
GRID = dict(
    L=[0, 3, 5, 7, 10, 14],
    w=[10, 14, 21, 28, 35, 45],
    R0=[5, 8, 12, 18, 30, 60],
    v=[7, 14, 20, 30],
    Topt=[8, 10, 12, 13, 14, 15, 16, 17, 18, 20],
    s=[2.5, 4, 6, 9],
)
OFFS = [o for o in range(-45, 46, 5) if abs(o) >= 10]


def prepare(era, obs, k):
    first, last = era.dates[0] + N_BACK + 50, era.dates[-1] - 50
    rows = [o for o in obs if o[0] == k and first <= o[4] <= last]
    lat = np.array([o[1] for o in rows]); lon = np.array([o[2] for o in rows]); alt = np.array([o[3] for o in rows])
    idx = np.array([era.index[o[4]] for o in rows])
    year = np.array([int(str(o[4])[:4]) for o in rows])
    doy = np.array([(o[4] - o[4].astype("datetime64[Y]")).astype(int) + 1 for o in rows])
    case = era.series(lat, lon, alt, idx, n=N_BACK)
    ctl = pe.controls_years(era, rows)
    ri, ci = np.nonzero(ctl >= 0)
    yr = era.series(lat[ri], lon[ri], alt[ri], ctl[ri, ci], n=N_BACK)
    wk = [era.series(lat, lon, alt, idx + o, n=N_BACK) for o in OFFS]
    return dict(n=len(rows), year=year, doy=doy, case=case, yr=yr, ri=ri, ci=ci, ncol=ctl.shape[1], wk=wk)


def feats(series, L, w, v):
    P, Tm, _ = series
    n = P.shape[0]
    R = P[n - L - w : n - L].sum(axis=0) if L > 0 else P[n - w :].sum(axis=0)
    T = Tm[n - v :].mean(axis=0)
    return R, T


def score(R, T, R0, Topt, s):
    return (1 - np.exp(-R / R0)) * np.exp(-0.5 * ((T - Topt) / s) ** 2)


def frost(series, days=3, thr=-1.0):
    """Gel des derniers jours (minimum < thr) : facteur 0,3, comme build-pousse."""
    Tn = series[2]
    return np.where(Tn[-days:].min(axis=0) < thr, 0.3, 1.0)


def season(doy, table):
    """Facteur de saison interpolé entre milieux de mois (table de 12 valeurs), doy = jour de l'année 1-366."""
    pos = (doy - 15.0) / 30.44
    i = np.floor(pos).astype(int) % 12
    f = pos - np.floor(pos)
    t = np.asarray(table)
    return t[i] * (1 - f) + t[(i + 1) % 12] * f


def aucs(D, p, sel=None, seas=None, use_frost=False):
    """AUC années et semaines pour les paramètres p, sur les cas sel (masque) ou tous. seas : table de saison
    (n'agit que sur l'AUC « semaines », le jour de l'année étant identique pour les témoins « années »)."""
    sel = np.ones(D["n"], bool) if sel is None else sel
    fr = (lambda s_: frost(s_)) if use_frost else (lambda s_: 1.0)
    Rc, Tc = feats(D["case"], p["L"], p["w"], p["v"])
    sc = score(Rc, Tc, p["R0"], p["Topt"], p["s"]) * fr(D["case"])
    Ry, Ty = feats(D["yr"], p["L"], p["w"], p["v"])
    sy = np.full((D["n"], D["ncol"]), np.nan)
    sy[D["ri"], D["ci"]] = score(Ry, Ty, p["R0"], p["Topt"], p["s"]) * fr(D["yr"])
    sw = np.stack([score(*feats(s_, p["L"], p["w"], p["v"]), p["R0"], p["Topt"], p["s"]) * fr(s_) for s_ in D["wk"]], axis=1)
    if seas is not None:
        sc_w = sc * season(D["doy"], seas)
        sw = sw * np.stack([season(D["doy"] + o, seas) for o in OFFS], axis=1)
    else:
        sc_w = sc
    return pe.paired_auc(sc[sel], sy[sel]), pe.paired_auc(sc_w[sel], sw[sel])


def search(D, sel):
    # Recherche en deux temps : fenêtre de pluie (température neutre), puis température (pluie fixée), puis affinage.
    best = None
    base = dict(Topt=14, s=50, v=14)
    for L, w, R0 in itertools.product(GRID["L"], GRID["w"], GRID["R0"]):
        p = dict(base, L=L, w=w, R0=R0)
        a = np.mean(aucs(D, p, sel))
        if best is None or a > best[0]:
            best = (a, p)
    p0 = best[1]
    for v, Topt, s in itertools.product(GRID["v"], GRID["Topt"], GRID["s"]):
        p = dict(p0, v=v, Topt=Topt, s=s)
        a = np.mean(aucs(D, p, sel))
        if a > best[0]:
            best = (a, p)
    p1 = best[1]
    for L, w, R0 in itertools.product(GRID["L"], GRID["w"], GRID["R0"]):
        p = dict(p1, L=L, w=w, R0=R0)
        a = np.mean(aucs(D, p, sel))
        if a > best[0]:
            best = (a, p)
    return best


def main():
    era = pe.Era5()
    obs = pe.observations()
    only = sys.argv[1:]
    for k, sp in enumerate(pe.SPECIES):
        if only and sp not in only:
            continue
        D = prepare(era, obs, k)
        even = D["year"] % 2 == 0
        cv = []
        for tr, te in ((even, ~even), (~even, even)):
            a, p = search(D, tr)
            cv.append((aucs(D, p, te), p))
        a_all, p_all = search(D, None)
        ay, aw = aucs(D, p_all)
        print(f"\n{sp:14s} n={D['n']}  hors années (paires->impaires, impaires->paires) : "
              + "  ".join(f"années {c[0][0]:.3f} semaines {c[0][1]:.3f}" for c in cv))
        print(f"   tout : années {ay:.3f} semaines {aw:.3f}  paramètres {p_all}")
        print("   plis : " + " | ".join(str(c[1]) for c in cv))
        cur = pe.bp.SPECIES[sp]["saison"]
        for name, tab in (("saison actuelle", cur), ("saison GBIF", NEW_SEASON[sp])):
            for fz in (False, True):
                a = aucs(D, p_all, seas=tab, use_frost=fz)
                print(f"   {name:16s} gel={'oui' if fz else 'non'} : années {a[0]:.3f} semaines {a[1]:.3f}")


# Saisons proposées d'après les mois des observations GBIF du Sud-Ouest (moyenne des lectures brute et corrigée de
# l'effort), SANS le creux d'août dû à la sécheresse (la météo du modèle s'en charge).
NEW_SEASON = {
    "cepe_ete": [0, 0, 0, 0.05, 0.4, 0.9, 1, 1, 0.9, 0.4, 0.1, 0],
    "cepe_bronze": [0, 0, 0, 0.05, 0.15, 0.4, 0.7, 0.8, 1, 1, 0.3, 0.05],
    "cepe_bordeaux": [0.05, 0, 0, 0.05, 0.1, 0.2, 0.35, 0.55, 0.95, 1, 0.6, 0.15],
    "cepe_pins": [0, 0, 0, 0.3, 0.45, 0.6, 0.5, 0.6, 1, 1, 0.35, 0.05],
    "girolle": [0.05, 0, 0, 0.1, 0.3, 0.85, 0.9, 0.85, 1, 0.8, 0.45, 0.1],
    "coulemelle": [0, 0, 0, 0.05, 0.1, 0.15, 0.3, 0.65, 1, 1, 0.65, 0.15],
    "trompette": [0.15, 0.05, 0, 0, 0, 0.05, 0.25, 0.5, 0.85, 1, 0.75, 0.35],
}


if __name__ == "__main__":
    main()
