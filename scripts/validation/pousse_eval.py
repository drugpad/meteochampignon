"""Évaluation de la météo de pousse (build-pousse.py) sur les observations GBIF datées, avec la météo ERA5.

Pour chaque observation (lieu x, jour t), score de pousse s(x, t) calculé sur la pluie et la température ERA5
(0,25°, température ramenée à l'altitude du point quand elle est connue). Deux comparaisons « cas-témoin » où le
LIEU est le même (le milieu ne joue donc pas) :
  - AUC « années » : même jour de l'année, AUTRES années (la saison est identique : seule la météo diffère) ;
  - AUC « semaines » : même année, jours décalés de 10 à 45 jours avant/après (saison proche + météo).
0,5 = la météo du modèle n'explique rien ; 1 = parfait. Le facteur de saison est évalué à part (contre le fond
« tous champignons » : à quel mois l'espèce est-elle sur-représentée ?).

Usage : python pousse_eval.py
"""
import datetime as dt
import importlib.util
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CACHE = os.path.join(ROOT, ".cache-habitat")


def load_module(name, file):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, "scripts", file))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


bp = load_module("pousse", "build-pousse.py")
SPECIES = list(bp.SPECIES)
LAPSE = 0.0065  # °C par mètre
LOOKBACK = 60  # jours de météo avant le jour évalué


class Era5:
    def __init__(self):
        z = np.load(os.path.join(CACHE, "era5", "era5-daily.npz"))
        self.dates = z["dates"].astype("datetime64[D]")
        self.P, self.Tm, self.Tn, self.hs = z["P"], z["Tm"], z["Tn"], z["hsurf"]
        self.lat0, self.lon0, self.step = float(z["lat0"]), float(z["lon0"]), float(z["step"])
        self.index = {d: i for i, d in enumerate(self.dates)}

    def weights(self, lat, lon):
        """Interpolation bilinéaire : (indices i, j des 4 voisins, poids)."""
        fi = (lat - self.lat0) / self.step
        fj = (lon - self.lon0) / self.step
        i0, j0 = np.floor(fi).astype(int), np.floor(fj).astype(int)
        di, dj = fi - i0, fj - j0
        return [(i0, j0, (1 - di) * (1 - dj)), (i0 + 1, j0, di * (1 - dj)), (i0, j0 + 1, (1 - di) * dj), (i0 + 1, j0 + 1, di * dj)]

    def series(self, lat, lon, alt, end_idx, n=LOOKBACK):
        """Séries (n jours finissant à end_idx inclus) pour chaque point : P, Tm, Tn de forme (n, N)."""
        ks = end_idx[None, :] - np.arange(n - 1, -1, -1)[:, None]
        out = []
        w = self.weights(lat, lon)
        for arr in (self.P, self.Tm, self.Tn):
            v = sum(arr[ks, i[None, :], j[None, :]] * wt[None, :] for i, j, wt in w)
            out.append(v)
        hs = sum(self.hs[i, j] * wt for i, j, wt in w)
        corr = np.where(alt >= 0, -LAPSE * (alt - hs), 0.0)
        out[1] = out[1] + corr[None, :]
        out[2] = out[2] + corr[None, :]
        return [o.astype(np.float32) for o in out]


def score(sp, P, Tm, Tn, doy_dates, model=None):
    """Score de pousse au DERNIER jour des séries (n, N), facteur de saison par point (dates numpy)."""
    series = (P[:, :, None], Tm[:, :, None], Tn[:, :, None])
    orig = bp.season_factor
    bp.season_factor = lambda s, d: 1.0
    try:
        s = (model or bp.pousse)(series, [None] * P.shape[0], P.shape[0] - 1, sp)[:, 0]
    finally:
        bp.season_factor = orig
    seas = np.array([orig(sp, d.astype(object)) for d in doy_dates])
    return s, seas


def observations():
    sp = json.load(open(os.path.join(CACHE, "gbif", "sp.json")))
    alt = {}
    pfile = os.path.join(CACHE, "gbif", "patches.npz")
    if os.path.exists(pfile):  # altitude des points de la région (relief GLO-30)
        z = np.load(pfile)
        for lo, la, a in zip(z["lon"], z["lat"], z["alt"][:, 10, 10]):
            alt[(round(float(lo), 5), round(float(la), 5))] = float(a)
    obs = []
    for k, name in enumerate(SPECIES):
        seen = set()
        for r in sp[name]["recs"]:
            if not (r.get("year") and r.get("month") and r.get("day")) or r["year"] < 1995:
                continue
            u = r.get("coordinateUncertaintyInMeters")
            if u is not None and u > 5000:
                continue
            key = (round(r["decimalLatitude"], 2), round(r["decimalLongitude"], 2), r["year"], r["month"], r["day"])
            if key in seen:
                continue
            seen.add(key)
            a = alt.get((round(r["decimalLongitude"], 5), round(r["decimalLatitude"], 5)), -1.0)
            obs.append((k, r["decimalLatitude"], r["decimalLongitude"], a, np.datetime64(dt.date(r["year"], r["month"], r["day"]))))
    return obs


def auc(pos, neg):
    pos, neg = np.asarray(pos, float), np.asarray(neg, float)
    if len(pos) == 0 or len(neg) == 0:
        return float("nan")
    allv = np.concatenate([pos, neg])
    order = np.argsort(allv, kind="mergesort")
    sv = allv[order]
    ranks = np.empty(len(allv))
    i = 0
    while i < len(sv):
        j = i
        while j + 1 < len(sv) and sv[j + 1] == sv[i]:
            j += 1
        ranks[order[i : j + 1]] = (i + j) / 2 + 1
        i = j + 1
    return (ranks[: len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg))


def paired_auc(case, controls):
    """AUC apparié : pour chaque cas, part des témoins (même lieu) de score plus bas (ex aequo = 1/2), moyennée."""
    c = case[:, None]
    gt = (c > controls).sum(axis=1) + 0.5 * (c == controls).sum(axis=1)
    n = np.isfinite(controls).sum(axis=1)
    ok = n > 0
    return float(np.mean(gt[ok] / n[ok]))


def evaluate(era, obs, sp_index, model=None, sp_name=None, verbose=True):
    sp = sp_name or SPECIES[sp_index]
    rows = [o for o in obs if o[0] == sp_index]
    first, last = era.dates[0] + LOOKBACK + 50, era.dates[-1] - 50
    rows = [o for o in rows if first <= o[4] <= last]
    if len(rows) < 20:
        return None
    lat = np.array([o[1] for o in rows])
    lon = np.array([o[2] for o in rows])
    alt = np.array([o[3] for o in rows])
    day = np.array([o[4] for o in rows])
    idx = np.array([era.index[d] for d in day])
    # Cas.
    P, Tm, Tn = era.series(lat, lon, alt, idx)
    s_case, seas_case = score(sp, P, Tm, Tn, day, model)
    # Témoins « semaines » : même lieu, décalages de 10 à 45 jours.
    offs = [o for o in range(-45, 46, 5) if abs(o) >= 10]
    s_wk = np.zeros((len(rows), len(offs)), np.float32)
    for c, o in enumerate(offs):
        P, Tm, Tn = era.series(lat, lon, alt, idx + o)
        s, seas = score(sp, P, Tm, Tn, day + o, model)
        s_wk[:, c] = s * seas
    # Témoins « années » : même jour de l'année, autres années disponibles.
    years = sorted({int(str(d)[:4]) for d in era.dates})
    s_yr = np.full((len(rows), len(years)), np.nan, np.float32)
    for c, y in enumerate(years):
        dy = np.array([np.datetime64(f"{y}{str(d)[4:]}") if str(d)[5:] != "02-29" else np.datetime64(f"{y}-02-28") for d in day])
        ok = np.array([(first <= x <= last) and int(str(x)[:4]) != int(str(d)[:4]) for x, d in zip(dy, day)])
        if not ok.any():
            continue
        ii = np.array([era.index.get(x, -1) for x in dy])
        ok &= ii >= 0
        P, Tm, Tn = era.series(lat[ok], lon[ok], alt[ok], ii[ok])
        s, _ = score(sp, P, Tm, Tn, dy[ok], model)
        s_yr[ok, c] = s
    res = dict(sp=sp, n=len(rows), auc_years=paired_auc(s_case, s_yr), auc_weeks=paired_auc(s_case * seas_case, s_wk),
               mean_case=float(s_case.mean()), mean_years=float(np.nanmean(s_yr)), zero_case=float((s_case < 0.02).mean()))
    if verbose:
        print(f"  {sp:14s} n={res['n']:4d}  AUC années={res['auc_years']:.3f}  AUC semaines={res['auc_weeks']:.3f}  "
              f"score moyen cas {res['mean_case']:.2f} / autres années {res['mean_years']:.2f}  cas à ~0 : {res['zero_case']*100:.0f} %")
    return res, s_case, s_yr, s_wk


def controls_years(era, rows):
    """Pour chaque cas : indices ERA5 du même jour de l'année dans les autres années (ou -1)."""
    years = sorted({int(str(d)[:4]) for d in era.dates})
    first, last = era.dates[0] + LOOKBACK + 50, era.dates[-1] - 50
    out = np.full((len(rows), len(years)), -1, int)
    for r, o in enumerate(rows):
        d = str(o[4])
        for c, y in enumerate(years):
            if y == int(d[:4]):
                continue
            x = np.datetime64(f"{y}{d[4:]}" if d[5:] != "02-29" else f"{y}-02-28")
            if first <= x <= last:
                out[r, c] = era.index.get(x, -1)
    return out


def scan(era, obs):
    """Exploration : quelles fenêtres de pluie et de température distinguent le jour d'observation des mêmes jours
    des autres années (même lieu) ? Pluie : cumul sur w jours finissant L jours avant ; température : moyenne sur v
    jours, comparée à l'optimum (écart absolu, plus petit = mieux)."""
    for k, sp in enumerate(SPECIES):
        first, last = era.dates[0] + LOOKBACK + 50, era.dates[-1] - 50
        rows = [o for o in obs if o[0] == k and first <= o[4] <= last]
        if len(rows) < 30:
            continue
        lat = np.array([o[1] for o in rows]); lon = np.array([o[2] for o in rows]); alt = np.array([o[3] for o in rows])
        idx = np.array([era.index[o[4]] for o in rows])
        ctl = controls_years(era, rows)
        Pc, Tc, Nc = era.series(lat, lon, alt, idx, n=70)
        ok = ctl >= 0
        ri, ci = np.nonzero(ok)
        Pk, Tk, Nk = era.series(lat[ri], lon[ri], alt[ri], ctl[ri, ci], n=70)
        print(f"\n== {sp} n={len(rows)}  (T moyenne 20 j des cas : {Tc[-20:].mean():.1f} °C, autres années {Tk[-20:].mean():.1f})")
        line = []
        for L in (0, 3, 7, 10, 14, 21):
            for w in (3, 7, 14, 21, 30, 45):
                if L + w > 70:
                    continue
                vc = Pc[70 - L - w : 70 - L].sum(axis=0)
                vk = Pk[70 - L - w : 70 - L].sum(axis=0)
                m = np.full(ok.shape, np.nan); m[ri, ci] = vk
                line.append((paired_auc(vc, m), L, w))
        line.sort(reverse=True)
        print("  pluie (AUC, décalage L, fenêtre w) meilleurs :", ", ".join(f"{a:.3f} L{L} w{w}" for a, L, w in line[:8]))
        print("  pluie L0 :", ", ".join(f"w{w} {a:.3f}" for a, L, w in sorted(line, key=lambda t: (t[1], t[2])) if L == 0))
        tl = []
        for v in (3, 7, 14, 20, 30):
            tc = Tc[70 - v :].mean(axis=0)
            tk = Tk[70 - v :].mean(axis=0)
            m = np.full(ok.shape, np.nan); m[ri, ci] = tk
            tl.append((paired_auc(tc, m), v, float(np.median(tc))))
        print("  température plus chaude que les autres années (AUC>0,5) :", ", ".join(f"v{v} {a:.3f} (méd. {t:.1f})" for a, v, t in tl))


if __name__ == "__main__":
    era = Era5()
    obs = observations()
    print("observations datées", len(obs), "ERA5", era.dates[0], "->", era.dates[-1])
    if sys.argv[1:] == ["scan"]:
        scan(era, obs)
        sys.exit()
    for k in range(len(SPECIES)):
        evaluate(era, obs, k)
