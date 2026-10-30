# Validation du mode Coins sur observations réelles (GBIF) et météo ERA5

Résultats : `docs/etude-champignons-coins.md`, sections 5 à 7. Les données (GBIF, ERA5, variables du milieu) restent
dans `.cache-habitat/` (non versionné ; licences GBIF variées : seuls des agrégats sont publiés).

Préparation (une fois, sur le poste) :
1. `gbif_fetch_all.py` (espèces, Sud-Ouest, avec dates → `sp.json`) et `gbif_fetch_bg2.py` (fond « champignons du
   sol à chapeau », sans lichens → `bg2.json`), dans `.cache-habitat/gbif/`.
2. `era5_fetch.py` : ERA5 0,25° horaire → journalier, 1995 → aujourd'hui, lu sur `s3://openmeteo` (~50 min, Python
   global avec s3fs + omfiles) → `.cache-habitat/era5/era5-daily.npz` (28 Mo ; les fichiers intermédiaires par
   année, ~230 Mo, peuvent être effacés une fois l'assemblage fait).
3. `build-habitat-fine.py` crée `covariates-20m.tif` (+ `altitude-20m.tif`) au premier lancement.
4. `extract_points.py` : fenêtres de ± 200 m autour de chaque observation → `patches.npz`.

Mesures :
- `habitat_eval.py [auc|curves]` : AUC du milieu dans les bois, rapports observations / fond par classe.
- `habitat_fit.py` : courbes d'altitude et facteurs de roche ajustés, validés hors zone (5 plis de carrés de 0,25°).
- `pousse_eval.py [scan]` : AUC de la météo de pousse (même lieu, autres années / autres semaines) ; `scan` : quelles
  fenêtres de pluie et de température comptent.
- `pousse_fit.py [espèce…]` : ajustement du modèle à fenêtres, validé années paires / impaires.
- `combined_eval.py <ancien habitat-20m-7b.tif> <ancien build-pousse.py>` : note finale, ancienne contre nouvelle.

Environnement : `.venv-habitat` (rasterio, pyproj, pyshp, numpy, scipy, pillow, s3fs, omfiles, tzdata).
