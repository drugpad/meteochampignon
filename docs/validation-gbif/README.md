# Validation du modèle de milieu sur observations GBIF

Scripts utilisés pour `docs/etude-champignons-coins.md` (section 3). À lancer depuis un dossier de travail (les fichiers `gbif.json` et `bg.json` y sont écrits), avec `HABITAT_DIR` pointant vers `public/habitat/` du dépôt.

1. `fetch.py` : observations des 7 espèces dans l'emprise → `gbif.json`.
2. `bg.py` : observations de champignons quelconques (fond de comparaison) → `bg.json`.
3. `analyse2.py` : AUC dans la forêt, rapports par altitude, essences, pH.
4. `analyse3.py` : AUC global, intervalles de confiance (bootstrap), saisons corrigées de l'effort.
5. `cv2.py` : recalage de l'altitude et des essences, validation croisée.

Python 3 avec `numpy` et `pillow`. Les données GBIF ne sont **pas** versionnées (licences variées) : à retélécharger, et à citer « GBIF.org ».
