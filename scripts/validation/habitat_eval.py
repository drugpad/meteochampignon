"""Évaluation du milieu (build-habitat.py) sur les observations GBIF : AUC et courbes de réponse.

AUC = probabilité qu'une observation de l'espèce ait un meilleur score qu'une observation de champignon quelconque
(même biais d'observateur : chemins, forêts accessibles). Pour les espèces mycorhiziennes, comparaison DANS les
milieux boisés (la vraie question : le score distingue-t-il un bon bois d'un bois ordinaire ?).
Rapport de réponse : part des observations dans une classe / part du fond dans cette classe (1 = indifférent).

Usage : python habitat_eval.py [auc|curves|all]
"""
import importlib.util
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
spec = importlib.util.spec_from_file_location("fine", os.path.join(ROOT, "scripts", "build-habitat-fine.py"))
fine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fine)
hb, hl = fine.hb, fine.hl
G = os.path.join(ROOT, ".cache-habitat", "gbif")
HALF = 10


def load(min_year=1990):
    z = np.load(os.path.join(G, "patches.npz"))
    d = {k: z[k] for k in z.files}
    c = d["cov"][:, :, HALF, HALF]
    ok = (c[:, fine.COV_BANDS.index("mask")] == 1) & ((d["year"] >= min_year) | (d["year"] == -1))
    return {k: v[ok] for k, v in d.items()}


def covariates(d):
    """Dict de tableaux (N, 21, 21) comme read_covariates, depuis les fenêtres."""
    b = {name: d["cov"][:, i] for i, name in enumerate(fine.COV_BANDS)}
    tcd = b["tcd"].astype(np.float32)
    return dict(forest=b["forest"], geol=b["geol"], alt=d["alt"].astype(np.float32), slope=b["slope4"] / 4.0,
                aspect=b["aspect2"] * 2.0, ph=b["ph20"] / 20.0, wc=b["wc"], tcd=np.where(b["tcd"] == 255, np.nan, tcd),
                mask=b["mask"])


def habitat_points(d, block=1500, reduce="center"):
    """Habitat (N, espèces) aux points : fenêtres mises bout à bout (la marge de 10 cases > rayon des filtres)."""
    c = covariates(d)
    n = len(d["kind"])
    out = np.zeros((n, len(fine.SPECIES)), np.float32)
    for s in range(0, n, block):
        e = min(n, s + block)
        m = {k: np.concatenate(list(v[s:e]), axis=1) for k, v in c.items()}
        hab = fine.habitat_block(m["forest"], m["alt"], m["ph"], m["wc"], m["mask"], m["slope"], m["aspect"], m["tcd"], m["geol"])
        hab = hab.reshape(len(fine.SPECIES), 2 * HALF + 1, e - s, 2 * HALF + 1)
        if reduce == "center":
            out[s:e] = hab[:, HALF, :, HALF].T
        else:  # moyenne 3 x 3 (60 m) : tolère une imprécision de position
            out[s:e] = hab[:, HALF - 1 : HALF + 2, :, HALF - 1 : HALF + 2].mean(axis=(1, 3)).T
    return out


def auc(pos, neg):
    """AUC de Mann-Whitney (ex aequo comptés pour moitié)."""
    pos, neg = np.asarray(pos), np.asarray(neg)
    if len(pos) == 0 or len(neg) == 0:
        return float("nan")
    allv = np.concatenate([pos, neg])
    order = np.argsort(allv, kind="mergesort")
    ranks = np.empty(len(allv))
    sv = allv[order]
    i = 0
    while i < len(sv):
        j = i
        while j + 1 < len(sv) and sv[j + 1] == sv[i]:
            j += 1
        ranks[order[i : j + 1]] = (i + j) / 2 + 1
        i = j + 1
    return (ranks[: len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg))


def wooded(d):
    c = d["cov"][:, :, HALF, HALF]
    group = c[:, 0] & 0x7F
    tcd = c[:, fine.COV_BANDS.index("tcd")]
    gi = [hl.GROUPS.index(g) for g in ("lande", "herbe")]
    forest = (group > 0) & ~np.isin(group, gi)
    return forest | ((tcd >= 30) & (tcd != 255))


def report_auc(d, h, label=""):
    bg = d["kind"] == -1
    wood = wooded(d)
    rows = []
    for k, sp in enumerate(fine.SPECIES):
        pres = d["kind"] == k
        if sp == "coulemelle":
            a_all = auc(h[pres, k], h[bg, k])
            rows.append((sp, pres.sum(), a_all, float("nan")))
        else:
            rows.append((sp, (pres & wood).sum(), auc(h[pres & wood, k], h[bg & wood, k]), auc(h[pres, k], h[bg, k])))
    print(f"--- AUC {label}")
    for sp, n, a, b in rows:
        print(f"  {sp:14s} n={n:5d}  AUC bois={a:.3f}  AUC tout={b:.3f}")
    return rows


def ratio_table(d, var, bins, labels, sp_mask, bg_mask, weights=None):
    out = []
    for lo, hi, lab in zip(bins[:-1], bins[1:], labels):
        p = ((var >= lo) & (var < hi) & sp_mask).sum() / max(1, sp_mask.sum())
        q = ((var >= lo) & (var < hi) & bg_mask).sum() / max(1, bg_mask.sum())
        out.append((lab, p, q, p / q if q > 0 else float("nan"), ((var >= lo) & (var < hi) & sp_mask).sum()))
    return out


def curves(d):
    c = d["cov"][:, :, HALF, HALF]
    names = fine.COV_BANDS
    alt = d["alt"][:, HALF, HALF].astype(float)
    tcd = c[:, names.index("tcd")].astype(float)
    tcd[tcd == 255] = np.nan
    ph = c[:, names.index("ph20")] / 20
    slope = c[:, names.index("slope4")] / 4
    aspect = c[:, names.index("aspect2")] * 2.0
    geol = c[:, names.index("geol")]
    group = c[:, 0] & 0x7F
    wc = c[:, names.index("wc")]
    bg = d["kind"] == -1
    wood = wooded(d)
    for k, sp in enumerate(fine.SPECIES):
        pres = d["kind"] == k
        smask = pres & (wood if sp != "coulemelle" else True)
        bmask = bg & (wood if sp != "coulemelle" else True)
        print(f"\n===== {sp} (n = {smask.sum()}, fond {bmask.sum()})")
        tabs = {
            "altitude": ratio_table(d, alt, [0, 200, 400, 600, 800, 1000, 1200, 1400, 1700, 3500], ["0-200", "200-400", "400-600", "600-800", "800-1000", "1000-1200", "1200-1400", "1400-1700", "1700+"], smask, bmask),
            "couvert %": ratio_table(d, np.nan_to_num(tcd, nan=-1), [-1, 0, 10, 30, 50, 70, 85, 95, 101], ["?", "0-10", "10-30", "30-50", "50-70", "70-85", "85-95", "95-100"], smask, bmask),
            "pH SoilGrids": ratio_table(d, ph, [0, 5.0, 5.5, 6.0, 6.5, 7.0, 9], ["<5", "5-5.5", "5.5-6", "6-6.5", "6.5-7", ">7"], smask, bmask),
            "géologie": ratio_table(d, geol, np.arange(0, 8) - 0.5, ["inconnu", "ACID", "DECALC", "ALLUV", "MARL", "BASIC", "CALC"], smask, bmask),
            "pente °": ratio_table(d, slope, [0, 3, 8, 15, 25, 35, 90], ["0-3", "3-8", "8-15", "15-25", "25-35", "35+"], smask, bmask),
            "exposition (pente > 8°)": ratio_table(d, np.where(slope > 8, (aspect + 22.5) % 360, -1), [0, 45, 90, 135, 180, 225, 270, 315, 360], ["N", "NE", "E", "SE", "S", "SO", "O", "NO"], smask & (slope > 8), bmask & (slope > 8)),
            "essence": ratio_table(d, group, np.arange(0, len(hl.GROUPS) + 1) - 0.5, list(hl.GROUPS), smask, bmask),
            "WorldCover": ratio_table(d, wc, [0, 11, 21, 31, 41, 51, 61, 81, 91, 256], ["arbres", "arbustes", "prairie", "culture", "bâti", "nu", "eau", "zone humide", "autre"], pres, bg),
        }
        for name, t in tabs.items():
            print(f"  {name:24s} " + "  ".join(f"{lab}:{r:4.2f}({n})" for lab, p, q, r, n in t if q > 0.002 or n > 0))


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    d = load()
    print("points", len(d["kind"]), {sp: int((d["kind"] == k).sum()) for k, sp in enumerate(fine.SPECIES)}, "fond", int((d["kind"] == -1).sum()))
    if what in ("auc", "all"):
        h = habitat_points(d)
        report_auc(d, h, "centre")
        report_auc(d, habitat_points(d, reduce="mean3"), "moyenne 60 m")
    if what in ("curves", "all"):
        curves(d)
