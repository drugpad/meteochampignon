"""L'humidité réelle du sol (ERA5-Land, 0-7 cm) prédit-elle mieux les sorties que nos cumuls de pluie ?

Même dispositif que pousse_eval.py (même lieu ; AUC « années » = même jour des autres années, « semaines » = ±10-45 j).
  1. humidité seule : moyenne sur une fenêtre de w jours finie L jours avant (plus humide = meilleur) ;
  2. modèle actuel (pluie x température x gel, build-pousse.py, sans saison) ;
  3. humidité à la place de la pluie : f_sol x f_temp x gel ;
  4. les deux : f_pluie x f_sol x f_temp x gel.
f_sol = rampe de 0 à 1 entre deux seuils d'humidité (m³/m³), choisis sur les années paires et mesurés sur les impaires,
et inversement.

Usage : python sm_eval.py   (après era5land_fetch.py)
"""
import itertools
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pousse_eval as pe  # noqa: E402

CACHE = os.path.join(pe.CACHE, "era5land")
N = 100


class SoilMoisture:
    def __init__(self):
        z = np.load(os.path.join(CACHE, "sm-daily.npz"))
        self.dates = z["dates"].astype("datetime64[D]")
        self.SM = z["SM"]
        self.lat0, self.lon0, self.step = float(z["lat0"]), float(z["lon0"]), float(z["step"])
        self.index = {d: i for i, d in enumerate(self.dates)}

    def series(self, lat, lon, end_dates, n=N):
        """(n, N) humidité finissant aux dates données ; NaN si un jour manque."""
        fi = (lat - self.lat0) / self.step
        fj = (lon - self.lon0) / self.step
        i0, j0 = np.floor(fi).astype(int), np.floor(fj).astype(int)
        di, dj = fi - i0, fj - j0
        idx = np.array([self.index.get(d, -10**6) for d in end_dates])
        ks = idx[None, :] - np.arange(n - 1, -1, -1)[:, None]
        ok = (ks >= 0).all(axis=0)
        ks = np.clip(ks, 0, len(self.dates) - 1)
        out = 0
        for a, b, w in ((i0, j0, (1 - di) * (1 - dj)), (i0 + 1, j0, di * (1 - dj)), (i0, j0 + 1, (1 - di) * dj), (i0 + 1, j0 + 1, di * dj)):
            out = out + self.SM[ks, a[None, :], b[None, :]] * w[None, :]
        out = np.where(ok[None, :], out, np.nan)
        return out.astype(np.float32)


def raw_current(sp, P, Tm, Tn):
    """Composantes du modèle actuel (sans calibration ni saison) : f_pluie, f_temp x gel."""
    lag, width, r0 = pe.bp.SPECIES[sp]["pluie"]
    topt, spread, tdays = pe.bp.SPECIES[sp]["temp"]
    n = P.shape[0]
    end = n - lag
    f_rain = 1 - np.exp(-P[end - width : end].sum(axis=0) / r0)
    t = Tm[n - tdays :].mean(axis=0)
    f_temp = np.exp(-0.5 * ((t - topt) / spread) ** 2) * np.where(Tn[n - 3 :].min(axis=0) < -1, 0.3, 1.0)
    return f_rain, f_temp


def sm_mean(S, L, w):
    n = S.shape[0]
    return np.nanmean(S[n - L - w : n - L], axis=0) if L else np.nanmean(S[n - w :], axis=0)


def build(era, sm, obs, k):
    first = max(era.dates[0], sm.dates[0]) + N + 50
    last = min(era.dates[-1], sm.dates[-1]) - 50
    rows = [o for o in obs if o[0] == k and first <= o[4] <= last]
    if len(rows) < 30:
        return None
    lat = np.array([o[1] for o in rows]); lon = np.array([o[2] for o in rows]); alt = np.array([o[3] for o in rows])
    day = np.array([o[4] for o in rows]); year = np.array([int(str(d)[:4]) for d in day])

    def pack(lat_, lon_, alt_, days_):
        idx = np.array([era.index[d] for d in days_])
        P, Tm, Tn = era.series(lat_, lon_, alt_, idx, n=N)
        return dict(P=P, Tm=Tm, Tn=Tn, S=sm.series(lat_, lon_, days_))

    case = pack(lat, lon, alt, day)
    years = sorted({int(str(d)[:4]) for d in sm.dates})
    ri, ci, cdays = [], [], []
    for r, d in enumerate(day):
        ds = str(d)
        for c, y in enumerate(years):
            if y == int(ds[:4]):
                continue
            x = np.datetime64(f"{y}{ds[4:]}" if ds[5:] != "02-29" else f"{y}-02-28")
            if first <= x <= last:
                ri.append(r); ci.append(c); cdays.append(x)
    ri, ci = np.array(ri), np.array(ci)
    yr = pack(lat[ri], lon[ri], alt[ri], np.array(cdays))
    offs = [o for o in range(-45, 46, 5) if abs(o) >= 10]
    wk = [pack(lat, lon, alt, day + np.timedelta64(o, "D")) for o in offs]
    return dict(n=len(rows), year=year, case=case, yr=yr, ri=ri, ci=ci, ncol=len(years), wk=wk)


def aucs(D, fn, sel):
    sc = fn(D["case"])
    sy = np.full((D["n"], D["ncol"]), np.nan)
    sy[D["ri"], D["ci"]] = fn(D["yr"])
    sw = np.stack([fn(w) for w in D["wk"]], axis=1)
    ok = np.isfinite(sc)
    sel = sel & ok
    return pe.paired_auc(sc[sel], sy[sel]), pe.paired_auc(sc[sel], sw[sel])


def main():
    era, sm = pe.Era5(), SoilMoisture()
    obs = pe.observations()
    print("humidité du sol :", sm.dates[0], "->", sm.dates[-1])
    for k, sp in enumerate(pe.SPECIES):
        D = build(era, sm, obs, k)
        if D is None:
            continue
        allr = np.ones(D["n"], bool)
        even = D["year"] % 2 == 0
        cur = lambda s: np.prod(raw_current(sp, s["P"], s["Tm"], s["Tn"]), axis=0)  # noqa: E731
        print(f"\n== {sp} n={D['n']}")
        print("  modèle actuel (pluie x temp x gel)      : années %.3f semaines %.3f" % aucs(D, cur, allr))
        # 1. humidité seule : meilleures fenêtres
        best = []
        for L, w in itertools.product((0, 3, 7, 14), (3, 7, 14, 21, 30)):
            a = aucs(D, lambda s, L=L, w=w: sm_mean(s["S"], L, w), allr)
            best.append((np.mean(a), a, L, w))
        best.sort(key=lambda t: -t[0])
        print("  humidité seule, meilleures fenêtres     : " + ", ".join(f"L{L} w{w} {a[0]:.3f}/{a[1]:.3f}" for _, a, L, w in best[:3]))
        # 3 et 4 : rampe d'humidité, réglée sur une moitié des années, mesurée sur l'autre.
        for label, with_rain in (("humidité à la place de la pluie", False), ("pluie ET humidité", True)):
            cv = []
            for tr, te in ((even, ~even), (~even, even)):
                cands = []
                for (L, w), lo, span in itertools.product([(b[2], b[3]) for b in best[:3]], (0.15, 0.2, 0.25, 0.3), (0.05, 0.1, 0.15)):
                    def fn(s, L=L, w=w, lo=lo, span=span):
                        fr, ft = raw_current(sp, s["P"], s["Tm"], s["Tn"])
                        fs = np.clip((sm_mean(s["S"], L, w) - lo) / span, 0, 1)
                        return (fr if with_rain else 1) * fs * ft
                    cands.append((np.mean(aucs(D, fn, tr)), fn, (L, w, lo, span)))
                cands.sort(key=lambda t: -t[0])
                cv.append((aucs(D, cands[0][1], te), cands[0][2]))
            ref = [aucs(D, cur, te) for _, te in ((even, ~even), (~even, even))]
            print(f"  {label:39s} : hors années " + " | ".join(f"{a[0]:.3f}/{a[1]:.3f} (actuel {r[0]:.3f}/{r[1]:.3f}) {p}" for (a, p), r in zip(cv, ref)))


if __name__ == "__main__":
    main()
