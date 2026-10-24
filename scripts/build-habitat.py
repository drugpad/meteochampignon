"""Habitat de chaque espèce (0 à 1) à partir des couches de build-habitat-layers.py.

Notre propre score, à règles lisibles (arbres hôtes, pH du sol, altitude, milieu), tiré des fiches du guide
(src/data/champignons.ts) et de la littérature mycologique — PAS calé sur un service tiers. L'habitat dit où
l'espèce PEUT pousser ; la météo (pluie, température) dit si elle pousse EN CE MOMENT (calculée ailleurs).

Sorties (public/habitat/, lues par l'appli) :
  - <espece>.png : niveaux de gris, valeur = habitat x 255, ligne 0 = nord, même emprise que les cartes de pluie ;
  - info.png : R = groupe d'essences dominant (index de groups), G = pH x 25, B = altitude / 10 (explications) ;
  - habitat.json : emprise, dimensions, groupes, espèces.

Lancement : .venv-habitat/Scripts/python scripts/build-habitat.py
"""
import json
import os

import numpy as np
from PIL import Image
from scipy.ndimage import uniform_filter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache-habitat")
OUT = os.path.join(ROOT, "public", "habitat")
LAT_MIN, LAT_MAX, LON_MIN, LON_MAX = 42.595, 45.155, -0.405, 3.405

# Arbres hôtes (mycorhiziens) : poids par groupe d'essences de la BD Forêt. Les quatre cèpes sont séparés
# (retour utilisateur : « ce ne sont pas du tout les mêmes zones ») : cèpe d'été et cèpe bronzé, de chaleur,
# sous chênes et châtaigniers de plaine et de coteaux ; cèpe de Bordeaux, ubiquiste et frais, jusqu'en
# montagne ; cèpe des pins, sous conifères, surtout en altitude.
HOSTS = {
    "cepe_ete": {  # Boletus reticulatus (= aestivalis)
        "chene": 1, "chataignier": 0.9, "hetre": 0.8, "feuillus": 0.75, "mixte": 0.5, "chene_vert": 0.4,
        "lande": 0.1, "robinier": 0.1, "pins": 0.05, "sapin_epicea": 0.05, "autres_conif": 0.05, "peuplier": 0.05,
    },
    "cepe_bronze": {  # Boletus aereus (tête de nègre)
        "chene": 1, "chataignier": 1, "chene_vert": 0.8, "feuillus": 0.7, "mixte": 0.4, "hetre": 0.3,
        "pins": 0.1, "lande": 0.1, "robinier": 0.05,
    },
    "cepe_bordeaux": {  # Boletus edulis
        "hetre": 1, "sapin_epicea": 1, "chene": 0.9, "chataignier": 0.9, "mixte": 0.9, "feuillus": 0.65,
        "pins": 0.5, "autres_conif": 0.5, "chene_vert": 0.3, "lande": 0.1, "robinier": 0.05, "peuplier": 0.05,
    },
    "cepe_pins": {  # Boletus pinophilus
        "pins": 1, "sapin_epicea": 0.9, "mixte": 0.7, "autres_conif": 0.6, "hetre": 0.5, "lande": 0.3,
        "chataignier": 0.3, "chene": 0.3, "feuillus": 0.2,
    },
    "girolle": {  # Cantharellus cibarius
        "hetre": 1, "chene": 0.9, "chataignier": 0.9, "sapin_epicea": 0.9, "mixte": 0.85, "feuillus": 0.65,
        "pins": 0.6, "chene_vert": 0.5, "autres_conif": 0.4, "lande": 0.15, "robinier": 0.05, "peuplier": 0.05,
    },
    "trompette": {  # Craterellus cornucopioides
        "hetre": 1, "chene": 0.85, "feuillus": 0.7, "mixte": 0.6, "chataignier": 0.6, "sapin_epicea": 0.45,
        "chene_vert": 0.4, "pins": 0.2, "autres_conif": 0.2, "robinier": 0.1, "peuplier": 0.1, "lande": 0.05,
    },
}

# Courbes (points (x, facteur), interpolation linéaire, constantes au-delà).
PH = {
    "cepe_ete": [(4.0, 0.7), (5.0, 1), (7.2, 1), (8.0, 0.7)],  # tolère les sols calcaires
    "cepe_bronze": [(4.0, 0.9), (4.5, 1), (6.0, 1), (6.8, 0.5), (7.5, 0.2)],  # sols acides, chauds
    "cepe_bordeaux": [(3.5, 0.7), (4.2, 1), (5.8, 1), (6.6, 0.5), (7.5, 0.25)],  # acidophile
    "cepe_pins": [(3.5, 0.9), (4.2, 1), (5.5, 1), (6.3, 0.4), (7.0, 0.1)],  # très acidophile
    "girolle": [(3.5, 0.8), (4.2, 1), (5.8, 1), (6.5, 0.5), (7.3, 0.2), (8.5, 0.15)],  # nettement acidophile
    "trompette": [(3.5, 0.4), (4.5, 0.65), (5.3, 1), (7.5, 1), (8.5, 0.8)],  # argilo-calcaire, neutre
    "coulemelle": [(3.5, 1), (8.5, 1)],  # indifférente
}
ALT = {
    "cepe_ete": [(0, 1), (800, 1), (1100, 0.5), (1400, 0)],  # plaine et coteaux
    "cepe_bronze": [(0, 1), (500, 1), (800, 0.4), (1000, 0)],  # thermophile, basse altitude
    "cepe_bordeaux": [(0, 0.6), (300, 0.8), (600, 1), (1600, 1), (1900, 0.4), (2100, 0)],  # plutôt frais
    "cepe_pins": [(0, 0.5), (400, 0.7), (800, 1), (2000, 1), (2300, 0.3)],  # montagne surtout
    "girolle": [(0, 0.85), (300, 1), (1500, 1), (1900, 0.3), (2100, 0)],
    "trompette": [(0, 0.9), (300, 1), (1200, 1), (1500, 0.4), (1800, 0)],
    "coulemelle": [(0, 1), (1200, 1), (1700, 0.3), (2000, 0)],
}
SLOPE = [(0, 1), (30, 1), (40, 0.6), (55, 0.2)]  # falaises et éboulis : peu de sol
SPECIES = ["cepe_ete", "cepe_bronze", "cepe_bordeaux", "cepe_pins", "girolle", "coulemelle", "trompette"]


def curve(x, pts):
    xs, ys = zip(*pts)
    return np.interp(x, xs, ys)


def main():
    L = np.load(os.path.join(CACHE, "layers.npz"))
    groups = [str(g) for g in L["groups"]]
    fr = L["fractions"]
    ph = np.where(np.isnan(L["ph"]) | (L["ph"] < 3), 6.0, L["ph"])  # trous de SoilGrids (valeur 0) : neutre
    alt = np.nan_to_num(L["alt"], nan=0)
    mask = L["mask"] == 1
    slope = curve(L["slope"], SLOPE)
    os.makedirs(OUT, exist_ok=True)

    forest = fr[[groups.index(g) for g in groups if g not in ("aucun", "lande", "herbe")]].sum(axis=0)
    trees_near = uniform_filter(np.maximum(forest, L["trees"]), size=3)  # arbres dans un rayon de ~400 m

    habitats = {}
    for sp in SPECIES:
        if sp in HOSTS:
            host = sum(fr[groups.index(g)] * w for g, w in HOSTS[sp].items())
        else:
            # Coulemelle : prairies et clairières près des bois, lisières, forêts claires, landes.
            lisiere = forest * np.clip(1 - uniform_filter(forest, size=5), 0, 1) * 2
            host = np.clip(
                0.9 * np.clip(L["grass"] * 1.5, 0, 1) * np.clip(trees_near * 2, 0, 1)
                + 0.6 * L["open"]
                + 0.4 * fr[groups.index("lande")]
                + 0.5 * lisiere,
                0,
                1,
            )
        h = np.clip(host, 0, 1) * curve(ph, PH[sp]) * curve(alt, ALT[sp]) * slope
        h[~mask] = 0
        habitats[sp] = h
        Image.fromarray(np.round(h * 255).astype(np.uint8), mode="L").save(os.path.join(OUT, f"{sp}.png"), optimize=True)
        good = (h[mask] >= 0.6).mean() * 100
        print(f"{sp:11s} habitat moyen {h[mask].mean():.3f}, cases favorables (>= 0,6) : {good:.1f} %")

    # Infos pour expliquer un endroit : essence dominante, pH, altitude.
    dom = fr.argmax(axis=0).astype(np.uint8)
    dom[fr.max(axis=0) < 0.2] = 0
    info = np.stack(
        [dom, np.clip(np.round(ph * 25), 0, 255).astype(np.uint8), np.clip(np.round(alt / 10), 0, 255).astype(np.uint8)],
        axis=-1,
    )
    info[~mask] = 0
    Image.fromarray(info, mode="RGB").save(os.path.join(OUT, "info.png"), optimize=True)

    meta = {
        "bounds": {"latMin": LAT_MIN, "latMax": LAT_MAX, "lonMin": LON_MIN, "lonMax": LON_MAX},
        "rows": int(fr.shape[1]),
        "cols": int(fr.shape[2]),
        "groups": groups,
        "species": SPECIES,
        "info": {"r": "groupe d'essences dominant (index de groups, 0 = aucun)", "g": "pH x 25", "b": "altitude / 10 m"},
        "sources": "BD Forêt V2 (IGN, Etalab 2.0), Copernicus DEM GLO-90, SoilGrids 2.0 (ISRIC, CC BY 4.0), ESA WorldCover 2021 (CC BY 4.0)",
    }
    json.dump(meta, open(os.path.join(OUT, "habitat.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    sizes = {f: os.path.getsize(os.path.join(OUT, f)) // 1024 for f in os.listdir(OUT)}
    print("Fichiers (Ko) :", sizes)


if __name__ == "__main__":
    main()
