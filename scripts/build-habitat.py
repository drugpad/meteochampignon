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
    # Révision du 30/10/2026 (docs/etude-champignons-coins.md, section 5) : châtaignier nettement sur-représenté dans
    # les observations GBIF de la région pour les quatre cèpes et la trompette (rapports 2,5 à 5,8) ; chêne moins
    # bon que hêtre/sapin pour le cèpe de Bordeaux (0,72 contre 1,3-1,5) ; trompette surtout hêtre puis chênes.
    "cepe_ete": {  # Boletus reticulatus (= aestivalis)
        # Chênes verts et pubescents (thermophiles, sols calcaires) : hôtes réguliers du cèpe d'été.
        "chene": 1, "chataignier": 1, "hetre": 0.8, "feuillus": 0.75, "mixte": 0.5, "chene_vert": 0.6,
        "lande": 0.1, "robinier": 0.1, "pins": 0.05, "sapin_epicea": 0.05, "autres_conif": 0.05, "peuplier": 0.05,
    },
    "cepe_bronze": {  # Boletus aereus (tête de nègre)
        "chene": 1, "chataignier": 1, "chene_vert": 0.8, "feuillus": 0.7, "mixte": 0.4, "hetre": 0.3,
        "pins": 0.1, "lande": 0.1, "robinier": 0.05,
    },
    "cepe_bordeaux": {  # Boletus edulis
        "hetre": 1, "sapin_epicea": 1, "chataignier": 1, "mixte": 0.9, "chene": 0.65, "feuillus": 0.6,
        "pins": 0.5, "autres_conif": 0.6, "chene_vert": 0.2, "lande": 0.1, "robinier": 0.05, "peuplier": 0.05,
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
        "hetre": 1, "chene": 0.9, "chataignier": 0.9, "feuillus": 0.7, "mixte": 0.6, "sapin_epicea": 0.4,
        "chene_vert": 0.4, "pins": 0.15, "autres_conif": 0.2, "robinier": 0.1, "peuplier": 0.1, "lande": 0.05,
    },
}

# Courbes (points (x, facteur), interpolation linéaire, constantes au-delà).
PH = {
    "cepe_ete": [(4.0, 0.7), (5.0, 1), (7.2, 1), (8.0, 0.7)],  # tolère les sols calcaires
    "cepe_bronze": [(4.0, 0.9), (4.5, 1), (6.0, 1), (6.8, 0.5), (7.5, 0.2)],  # sols acides, chauds
    "cepe_bordeaux": [(3.5, 0.7), (4.2, 1), (5.8, 1), (6.6, 0.5), (7.5, 0.25)],  # acidophile
    "cepe_pins": [(3.5, 0.9), (4.2, 1), (5.5, 1), (6.3, 0.4), (7.0, 0.1)],  # très acidophile
    "girolle": [(3.5, 0.8), (4.2, 1), (5.8, 1), (6.5, 0.5), (7.3, 0.2), (8.5, 0.15)],  # nettement acidophile
    # Révision du 30/10/2026 : plus de pénalité des sols acides (la trompette est sur-représentée sur roches
    # siliceuses et décalcifiées de la région, sous hêtre : rapports 1,4 et 2,9 ; le retrait de cette pénalité améliore
    # l'AUC hors zone de 0,52 à 0,57). La littérature d'Europe centrale (calcicole, Ellenberg R7) ne se vérifie pas ici.
    "trompette": [(3.5, 1), (8.5, 1)],
    "coulemelle": [(3.5, 1), (8.5, 1)],  # indifférente
}
# Altitude : révision du 30/10/2026 (observations GBIF de la région, rapports au fond « champignons du sol »,
# ajustement validé hors zone ; voir docs/etude-champignons-coins.md, section 5). Littérature concordante pour le
# cèpe de Bordeaux (rare en plaine : 7 % des stations sous 350 m en Bade-Wurtemberg, Krieglsteiner) et la girolle.
ALT = {
    # Plaine et coteaux, mais optimum 400-800 m dans la région (rapports 1,6-1,7), rare au-dessus de 1 000 m.
    "cepe_ete": [(0, 0.5), (250, 0.65), (400, 1), (850, 1), (1100, 0.5), (1400, 0.2), (1800, 0)],
    "cepe_bronze": [(0, 1), (500, 1), (800, 0.4), (1000, 0)],  # thermophile, basse altitude (confirmé)
    # Optimum 800-1 000 m (rapport 2,5), faible sous 400 m (0,1-0,4) : l'idée d'un « cèpe des chênaies de plaine du
    # Sud-Ouest » (25/10/2026) n'est pas confirmée par les observations (confusion probable avec cèpes d'été/bronzés).
    "cepe_bordeaux": [(0, 0.15), (300, 0.3), (500, 0.55), (700, 0.85), (850, 1), (1050, 1), (1250, 0.75), (1500, 0.55),
                      (2000, 0.5), (2300, 0.15)],
    "cepe_pins": [(0, 0.2), (500, 0.35), (800, 0.8), (1000, 1), (2000, 1), (2300, 0.4)],  # Pyrénées 800-1 800 m
    # Optimum 400-600 m (rapport 2,2), décroît dès 800 m (0,7), faible au-dessus de 1 500 m.
    "girolle": [(0, 0.3), (250, 0.55), (450, 1), (600, 1), (800, 0.75), (1000, 0.6), (1300, 0.55), (1600, 0.35), (2000, 0.1)],
    "trompette": [(0, 0.6), (300, 0.9), (500, 1), (1400, 1), (1700, 0.6), (2000, 0.15)],
    "coulemelle": [(0, 1), (1500, 0.85), (1900, 0.3), (2200, 0)],
}
# Pente : falaises et éboulis (peu de sol) ; ET terrains plats (fonds de vallée, sols engorgés) un peu moins bons :
# pentes de 0-3° sous-représentées pour les 7 espèces (rapports 0,2 à 0,7) dans les bois de la région.
SLOPE = [(0, 0.75), (2, 0.8), (5, 1), (30, 1), (40, 0.6), (55, 0.2)]

# Nature du sol d'après la carte géologique BRGM au 1/50 000 (scripts/geol_classes.py) : facteur par classe
# (ACID siliceux, DECALC décalcifié sur calcaire, MARL marnes/molasses, BASIC volcanique basique, CALC calcaire).
# Pour ALLUV (alluvions, colluvions, éboulis : nature variable) et les zones sans carte, on garde la courbe de pH
# SoilGrids (PH). Valeurs = littérature + rapports observés dans la région, ramenés vers 1 quand l'effectif est faible.
# La carte géologique est bien plus fine (1/50 000) que SoilGrids (250 m lissé) : sur les cèpes de Bordeaux, l'AUC hors
# zone passe de 0,63 (altitude seule) à 0,66 avec elle.
GEOL = {
    # Indifférent au pH (Krieglsteiner) ; un peu moins sur calcaire massif dans la région (rapport 0,8).
    "cepe_ete": {"ACID": 1, "DECALC": 0.9, "MARL": 0.9, "BASIC": 0.9, "CALC": 0.75, "ALLUV": 0.7},
    # Méditerranée : sols acides (Krieglsteiner, guides) ; région : siliceux 1,6, décalcifié 3,5, calcaire 0,4.
    "cepe_bronze": {"ACID": 1, "DECALC": 1, "MARL": 0.75, "BASIC": 0.9, "CALC": 0.35, "ALLUV": 0.6},
    # Acide à neutre, calcaire seulement s'il est décalcifié en surface (Krieglsteiner) ; région : siliceux 1,9,
    # décalcifié 0,8, marnes 0,7, calcaire 0,4.
    "cepe_bordeaux": {"ACID": 1, "DECALC": 0.75, "MARL": 0.45, "BASIC": 0.6, "CALC": 0.25, "ALLUV": 0.6},
    "cepe_pins": {"ACID": 1, "DECALC": 0.6, "MARL": 0.25, "BASIC": 0.6, "CALC": 0.1, "ALLUV": 0.5},  # très acidophile (UICN)
    # Acidophile (littérature A) mais signal géologique contradictoire dans la région (marnes 1,5 ; siliceux 0,6 ;
    # confusion possible avec Cantharellus pallens, calcicole) : la courbe de pH SoilGrids, qui aide (AUC 0,48 sans
    # elle contre 0,55), reste la seule règle de sol (elle pénalise déjà les sols calcaires, pH élevé).
    "girolle": {},
    "trompette": {"ACID": 1, "DECALC": 1, "MARL": 1, "BASIC": 1, "CALC": 0.8, "ALLUV": 0.7},
    "coulemelle": {"ALLUV": 0.85},
}
SPECIES = ["cepe_ete", "cepe_bronze", "cepe_bordeaux", "cepe_pins", "girolle", "coulemelle", "trompette"]

# --- Règles ajoutées le 25/10/2026 (habitat à 20 m avec le couvert Copernicus 2024, build-habitat-fine.py) ---
# Plancher des courbes de sol : le pH est une estimation à 250 m, lissée ; il ne doit pas condamner seul un bois.
PH_FLOOR = 0.25

# Ouverture du bois : densité du couvert (% d'arbres, Copernicus 2024) au point. Les cèpes de chaleur aiment les
# bois clairs et parsemés, lisières et pré-bois (sol réchauffé, pluie qui arrive au sol) ; cèpes de Bordeaux et des
# pins tolèrent mieux le dense (hêtraies, sapinières) ; la girolle va du bois clair au dense ; la trompette aime
# l'ombre humide des bois fermés ; la coulemelle, le milieu ouvert. Valeurs à moins de 15 % : pré ou clairière,
# n'a de sens qu'avec un arbre hôte tout proche (exigé à part, voir TREES_NEAR_M).
OPENNESS = {
    # Pénalité des bois très denses ADOUCIE le 25/10/2026 : le satellite mesure le couvert vu d'en haut, et une
    # vieille futaie de chênes (90-100 % de couvert) au sous-bois clair, excellent milieu à cèpes, ne se distingue
    # pas d'un taillis serré. Constaté en forêt de Bouconne : cœur de futaie à ~45 % contre 100 % sur les allées.
    "cepe_ete": [(0, 0.7), (15, 0.85), (25, 1), (80, 1), (92, 0.8), (100, 0.65)],
    "cepe_bronze": [(0, 0.7), (15, 0.85), (25, 1), (80, 1), (92, 0.8), (100, 0.65)],
    # Bois fermés non pénalisés (30/10/2026) : couvert 95-100 % sur-représenté pour le cèpe de Bordeaux (rapport 2,9).
    "cepe_bordeaux": [(0, 0.55), (15, 0.75), (40, 1), (100, 1)],
    "cepe_pins": [(0, 0.55), (15, 0.75), (40, 1), (100, 1)],
    "girolle": [(0, 0.35), (15, 0.6), (35, 1), (88, 1), (100, 0.85)],
    "trompette": [(0, 0.3), (20, 0.5), (50, 0.8), (75, 1), (100, 1)],
    "coulemelle": [(0, 1), (40, 1), (75, 0.8), (100, 0.6)],  # adouci le 30/10/2026 (sous-bois fréquent)
}
# Espèces liées aux arbres (mycorhiziennes) : un arbre doit se trouver à moins de ~30 m (une à deux hauteurs
# d'arbre, portée des racines), sinon 0. La coulemelle (saprotrophe) en est dispensée.
MYCORRHIZAL = ["cepe_ete", "cepe_bronze", "cepe_bordeaux", "cepe_pins", "girolle", "trompette"]
TREES_NEAR_M = 30
# Haies, bosquets, arbres isolés absents de la BD Forêt (elle ignore tout ce qui fait moins d'un demi-hectare) :
# essence inconnue, majoritairement des chênes et châtaigniers dans le bocage de la région.
SMALL_WOODS = {"cepe_ete": 0.6, "cepe_bronze": 0.55, "cepe_bordeaux": 0.45, "cepe_pins": 0.1, "girolle": 0.4, "trompette": 0.3}
# Milieux exclus (ESA WorldCover 2021) : bâti (50), cultures (40, le labour détruit le mycélium), eau (80) : 0 pour
# toutes les espèces. Constaté le 25/10/2026 : jardins, rives et champs bordés de haies sortaient à 0,1-0,4.
EXCLUDED_LANDCOVER = [40, 50, 80]
# Prairie près d'un arbre : un cèpe peut y sortir, mais seulement sous la couronne (~20 m), et moins qu'en sous-bois.
MEADOW_TREE_M = 20
MEADOW_FACTOR = 0.6
# Coupe récente : case de forêt de la BD Forêt (2014-2019) avec moins de 10 % d'arbres en 2024.
CUT_FACTOR = 0.1  # coupe, aucun arbre restant à moins de 20 m
CUT_EDGE_FACTOR = 0.5  # coupe, juste sous un arbre restant
# Exposition : orientation la plus favorable et pénalité maximale à l'opposé, pondérée par la pente (aucun effet
# sous 3°, plein effet à partir de 15°). Cèpes de chaleur : versants sud-sud-ouest ; espèces d'humidité : versants
# nord-nord-est qui gardent la fraîcheur ; cèpe des pins et coulemelle : neutres.
# Révision du 30/10/2026 : la préférence nord du cèpe de Bordeaux, de la girolle et de la trompette est RETIRÉE
# (littérature contradictoire ; dans la région les versants nord sont sous-représentés pour les trois : rapports
# 0,56 à 0,86). Le cèpe d'été garde le sud-ouest (rapports SO 2,1, O 1,6).
ASPECT = {"cepe_ete": (215, 0.15), "cepe_bronze": (200, 0.1)}



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
