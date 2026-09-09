# Météo Midi-Pyrénées — notes techniques

## 1. Objectif

Voir la spec d'origine (fournie par l'utilisateur, non versionnée ici) : carte de Midi-Pyrénées avec prévisions 7 jours, historique météo (stations + carte de pluie), usage principal = repérer les bonnes périodes de cueillette de champignons. Usage restreint (2 utilisateurs), pas de contrainte forte de quota/scalabilité.

## 2. Comptes créés / à créer

- **Open-Meteo** : aucun compte, aucune clé.
- **Météo-France** (portail-api.meteofrance.fr) : compte créé le 09/09/2026, souscription gratuite aux API **"Données radar"** (`DonneesPubliquesRadar` v1) et **"Données d'observation"** (`DonneesPubliquesObservation`, v1 et v2 — souscrites par défaut avec le compte). Token "API Key" généré, valide 1 an (à régénérer sur le portail, section "Configurer l'API" → "Utiliser", passé cette durée), stocké dans `.env.local` (`VITE_METEOFRANCE_API_TOKEN`, non versionné).
- **Infoclimat** (infoclimat.fr/opendata) : **pas encore créé**. Prévu par la spec pour densifier le réseau de stations (StatIC) en complément des stations officielles Météo-France — non bloquant, le module Stations fonctionne déjà bien avec les seules stations RADOME (~240 sur Midi-Pyrénées, voir 4). À créer si on veut aller plus loin : connexion/inscription gratuite sur le site, puis génération d'une clé d'API en précisant le type de réutilisation (nonÐ commercial pour cet usage).

## 3. Modules

### 3.1 Carte

Socle repris d'[Unmask](../unmask) : `MapContainer` react-leaflet, fond **Plan** (OpenStreetMap) ou **Satellite** (orthophotos IGN via `data.geopf.fr/wmts`, sans clé), sélecteur `LayersControl` en bas à gauche. Pas repris : tout le reste d'Unmask (profil altimétrique, ANFR, relief 3D) est hors sujet ici — seul le fond de carte a été copié/adapté.

Sélecteur de mode **Prévisions / Historique** (`ModeSwitch.tsx`), panneau flottant en haut à gauche.

### 3.2 Prévisions 7 jours (mode Prévisions)

Clic sur la carte → `getDailyForecast` (`lib/openMeteo.ts`), Open-Meteo `forecast`, `models=best_match`, `forecast_days=7`. Résultat affiché dans un panneau flottant en bas de l'écran (`ForecastPanel.tsx`) : icône météo (mapping WMO simplifié, `lib/weatherCode.ts`), températures min/max, cumul de pluie + probabilité, vent max, par jour.

### 3.3 Stations (mode Historique)

Source : API Météo-France **DonneesPubliquesObservation v2** (`public-api.meteofrance.fr/public/DPObs/v2`), pas Infoclimat pour l'instant (voir 2).

- **Liste des stations** : récupérée une fois via `/liste-stations` (CSV ~2150 stations RADOME nationales), filtrée sur l'emprise Midi-Pyrénées (`lib/config.ts`, `MIDI_PYRENEES_BOUNDS`) et figée dans `src/data/stations-midi-pyrenees.json` (239 stations) — pas un appel réseau à chaque chargement, la liste des stations ne bouge quasiment jamais. Pour la régénérer (nouvelles stations, emprise différente) : refaire l'appel `GET /public/DPObs/v2/liste-stations` avec le token, puis refiltrer sur `MIDI_PYRENEES_BOUNDS`.
- **Détail au clic** (`lib/stations.ts`, `fetchStationDetail`) : 24 appels parallèles à `/station/horaire?id_station=...&format=json&date=...` (un par heure des dernières 24h — l'API ne renvoie qu'une heure à la fois, pas de "paquet" 24h identifié pour l'instant malgré l'existence d'une "Package Observations" dans la doc du portail, non exploré). Champs utilisés : `rr1` (pluie de l'heure précédente, mm) pour l'historique pluie, `t` (température, **en Kelvin**, converti en °C) pour l'historique température. Une heure sans réponse (trou de mesure) est simplement ignorée plutôt que de faire échouer tout le graphique.
- **Mini prévision 5 jours** : Open-Meteo au point de la station (`getDailyForecast(point, 5)`), pas une donnée Météo-France.
- Sans token configuré, les marqueurs s'affichent quand même (liste statique) mais le clic renvoie une erreur explicite dans le popup.

### 3.4 Carte de pluie 24h (mode Historique)

Deux options, comme demandé par la spec, avec toggle (`RainControls.tsx`, affiché seulement si un token Météo-France est configuré — sinon Option A seule) :

#### Option A — Open-Meteo (implémentée)

- Grille régulière sur `MIDI_PYRENEES_BOUNDS`, pas `RAIN_GRID_STEP_DEG` = 0.08° (~8-9km, `lib/config.ts`).
- Cumul 24h glissant (pas le cumul "hier" calendaire) : `rolling24hSum` (`lib/openMeteo.ts`) somme les 24 dernières valeurs horaires de précipitation jusqu'à l'heure courante.
- Récupéré par lots multi-points (`getHourlyPrecipitationBatch`), un seul appel HTTP par lot (Open-Meteo accepte des listes lat/lon séparées par virgules).
- **Point de vigilance rate-limit** : la limite de débit gratuite d'Open-Meteo semble compter chaque point d'un appel multi-lieux comme des appels unitaires pour son quota par minute — un enchaînement de lots de ~100-150 points tirés rapidement déclenche un 429 en quelques secondes (observé en test réel). D'où un lot modéré (`RAIN_GRID_BATCH_SIZE` = 100) et une pause volontairement longue entre lots (`RAIN_GRID_BATCH_DELAY_MS` = 12s, `lib/config.ts`) — le chargement complet de la grille prend donc **plusieurs minutes**, avec retry automatique en cas de 429 malgré tout (`fetchBatchWithRetry`, `lib/rainGrid.ts`). Assumé : l'app vise 2 utilisateurs occasionnels, pas un rafraîchissement temps réel.
- Rendu : `RainOverlay.tsx` peint la grille dans un canvas (interpolation bilinéaire entre les 4 points de grille encadrants chaque pixel, pas une vraie interpolation géostatistique), affiché comme `ImageOverlay` Leaflet par-dessus la carte. Échelle de couleur : `lib/color.ts`.

#### Option B — Radar Météo-France (client prêt, décodage pas branché)

API `DonneesPubliquesRadar v1` (`lib/meteoFranceRadar.ts`), vérifiée avec un vrai token le 09/09/2026 :

- Zone **METROPOLE** confirmée sur `/mosaiques`.
- Observation **LAME_D_EAU** confirmée sur `/mosaiques/METROPOLE/observations` (à côté de `REFLECTIVITE`) — c'est bien le produit "lame d'eau" (cumul radar) visé par la spec.
- `/produit?maille=500` → `application/x-hdf` (HDF5, la plus précise, 500m). `/produit?maille=1000` → `application/octet-stream+gzip` (1km).

**Ce qui manque** : le décodage du fichier (HDF5 ou GRIB gzippé) pour en extraire une grille de valeurs affichable — contrairement à l'Option A, ce n'est plus "quasi entièrement frontend" si on décode du HDF5/GRIB dans le navigateur. Deux pistes pour la suite :
1. Une lib WASM de décodage HDF5 côté client (ex. [h5wasm](https://github.com/usnistgov/h5wasm)) — reste 100% frontend mais poids/complexité à évaluer.
2. Une petite fonction serveur (Vercel Function) qui télécharge + décode + renvoie une grille JSON légère — plus simple à coder (une lib serveur type `netcdf4`/`gribberish`/`eccodes` a plus de choix que côté navigateur), mais casse le "quasi entièrement frontend".

Pas tranché — à décider une fois qu'on a une préférence après usage réel de l'Option A.

## 4. Emprise géographique

`MIDI_PYRENEES_BOUNDS` (`lib/config.ts`) : rectangle englobant lat 42.6–45.15, lon -0.4–3.4, couvrant large les 8 départements de l'ex-région (Ariège, Aveyron, Haute-Garonne, Gers, Lot, Hautes-Pyrénées, Tarn, Tarn-et-Garonne) y compris les zones frontalières (Pyrénées, causses).

## 5. Déploiement

Pas encore déployé. Prévu sur Vercel (comme Unmask, `vercel.json` déjà en place — simple rewrite SPA) une fois l'appli jugée prête, avec accord explicite de l'utilisateur avant le premier déploiement (variable d'env `VITE_METEOFRANCE_API_TOKEN` à configurer côté Vercel, pas commitée).

## 6. Pas encore un dépôt git

Le dossier n'est pas initialisé en repo git à ce stade (scaffolding initial). À faire au moment jugé opportun par l'utilisateur.
