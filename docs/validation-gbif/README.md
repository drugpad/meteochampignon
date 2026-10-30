# Validation du modèle de milieu sur observations GBIF (première passe, 30/10/2026)

Scripts de la section 3 de `docs/etude-champignons-coins.md` (milieu à 250 m, fond « tous champignons »).
**Remplacés** par `scripts/validation/` (sections 5 à 7) : milieu à 20 m, fond sans lichens, météo ERA5.

1. `fetch.py` : observations des 7 espèces dans l'emprise → `gbif.json`.
2. `bg.py` : observations de champignons quelconques (fond de comparaison) → `bg.json`.
3. `analyse2.py` : AUC dans la forêt, rapports par altitude, essences, pH.
4. `analyse3.py` : AUC global, intervalles de confiance (bootstrap), saisons corrigées de l'effort.
5. `cv2.py` : recalage de l'altitude et des essences, validation croisée.

Python 3 avec `numpy` et `pillow`. Les données GBIF ne sont **pas** versionnées (licences variées) : à retélécharger, et à citer « GBIF.org ».
