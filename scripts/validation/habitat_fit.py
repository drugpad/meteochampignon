"""Ajustement des courbes d'altitude et des facteurs de sol (géologie) sur les observations GBIF, validé hors
échantillon par zones géographiques (5 plis de carrés de 0,25° : on ajuste sur 4/5 de la région, on mesure l'AUC
sur le 1/5 restant ; un même massif ne sert jamais à la fois à ajuster et à mesurer).

Rapport d'une classe = part des observations de l'espèce / part du fond (champignons du sol), lissé vers 1 par un
a priori (alpha observations « fictives » réparties comme le fond) pour ne pas sur-réagir aux petits effectifs.

Usage : python habitat_fit.py
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import habitat_eval as he  # noqa: E402

fine, hb = he.fine, he.hb
HALF = he.HALF
ALT_EDGES = np.array([0, 200, 400, 600, 800, 1000, 1200, 1400, 1700, 2000, 3500])
ALPHA = 4.0


def components(d):
    """Habitat SANS altitude ni sol (courbes neutralisées), puis variables au centre."""
    saved = {k: dict(getattr(hb, k)) for k in ("ALT", "PH")}
    try:
        for sp in fine.SPECIES:
            hb.ALT[sp] = [(0, 1), (5000, 1)]
            hb.PH[sp] = [(0, 1), (14, 1)]
        base = he.habitat_points(d, reduce="mean3")
    finally:
        for k, v in saved.items():
            setattr(hb, k, v)
    c = d["cov"][:, :, HALF, HALF]
    alt = d["alt"][:, HALF - 1 : HALF + 2, HALF - 1 : HALF + 2].mean(axis=(1, 2))
    geol = c[:, fine.COV_BANDS.index("geol")]
    ph = d["cov"][:, fine.COV_BANDS.index("ph20"), HALF, HALF] / 20.0
    return base, alt, geol, ph


def ratios(values, edges, sp_mask, bg_mask, alpha=ALPHA):
    k = len(edges) - 1
    b = np.clip(np.searchsorted(edges, values, side="right") - 1, 0, k - 1)
    ns = np.bincount(b[sp_mask], minlength=k).astype(float)
    nb = np.bincount(b[bg_mask], minlength=k).astype(float)
    pb = (nb + 0.5) / (nb.sum() + 0.5 * k)
    ps = (ns + alpha * pb) / (ns.sum() + alpha)
    return ps / pb, b


def smooth(r):
    lr = np.log(r)
    out = lr.copy()
    for i in range(len(lr)):
        lo, hi = max(0, i - 1), min(len(lr), i + 2)
        w = np.array([0.5 if j != i else 1.0 for j in range(lo, hi)])
        out[i] = (lr[lo:hi] * w).sum() / w.sum()
    return np.exp(out)


def fit_factors(alt, geol, sp_mask, bg_mask, use_alt=True, use_geol=True):
    fa = np.ones(len(ALT_EDGES) - 1)
    fg = np.ones(len(fine.geol_classes.CLASSES) if hasattr(fine, "geol_classes") else 7)
    if use_alt:
        r, _ = ratios(alt, ALT_EDGES, sp_mask, bg_mask)
        fa = smooth(r)
        fa = np.clip(fa / fa.max(), 0.03, 1)
    if use_geol:
        r, _ = ratios(geol, np.arange(0, 8) - 0.5, sp_mask, bg_mask)
        fg = np.clip(r / r[1:].max(), 0.1, 1)
        fg[0] = 1.0
    return fa, fg


def apply(base, alt, geol, fa, fg):
    b = np.clip(np.searchsorted(ALT_EDGES, alt, side="right") - 1, 0, len(fa) - 1)
    return base * fa[b] * fg[geol]


def folds(d, k=5, seed=1):
    cell = (np.floor(d["lat"] / 0.25) * 1000 + np.floor(d["lon"] / 0.25)).astype(int)
    u = np.unique(cell)
    rng = np.random.default_rng(seed)
    assign = dict(zip(u, rng.integers(0, k, len(u))))
    return np.array([assign[c] for c in cell])


def main():
    d = he.load()
    print("points", len(d["kind"]), "fond", int((d["kind"] == -1).sum()))
    base, alt, geol, ph = components(d)
    full = he.habitat_points(d, reduce="mean3")  # règles actuelles complètes
    bg = d["kind"] == -1
    wood = he.wooded(d)
    fl = folds(d)
    for k, sp in enumerate(fine.SPECIES):
        pres = d["kind"] == k
        scope = np.ones_like(pres) if sp == "coulemelle" else wood
        sm, bm = pres & scope, bg & scope
        if sm.sum() < 15:
            print(f"{sp}: trop peu d'observations ({sm.sum()})")
            continue
        res = {}
        for name, ua, ug in (("actuel", None, None), ("sans alt/sol", False, False), ("alt", True, False), ("géol", False, True), ("alt+géol", True, True)):
            test_s, test_b = [], []
            for f in range(5):
                tr, te = fl != f, fl == f
                if name == "actuel":
                    sc = full[:, k]
                else:
                    fa, fg = fit_factors(alt, geol, sm & tr, bm & tr, ua, ug)
                    sc = apply(base[:, k], alt, geol, fa, fg)
                test_s.append(sc[sm & te])
                test_b.append(sc[bm & te])
            res[name] = he.auc(np.concatenate(test_s), np.concatenate(test_b))
        fa, fg = fit_factors(alt, geol, sm, bm)
        print(f"\n{sp:14s} n={sm.sum():4d}  AUC hors zone : " + "  ".join(f"{n} {a:.3f}" for n, a in res.items()))
        print("   altitude : " + "  ".join(f"{int(ALT_EDGES[i])}-{int(ALT_EDGES[i + 1])}:{fa[i]:.2f}" for i in range(len(fa))))
        print("   géologie : " + "  ".join(f"{c}:{fg[i]:.2f}" for i, c in enumerate(["?", "ACID", "DECALC", "ALLUV", "MARL", "BASIC", "CALC"])))


if __name__ == "__main__":
    main()
