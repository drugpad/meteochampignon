// Emprise géographique de l'ancienne région Midi-Pyrénées (8 départements :
// Ariège, Aveyron, Haute-Garonne, Gers, Lot, Hautes-Pyrénées, Tarn,
// Tarn-et-Garonne), en rectangle englobant simple — large exprès pour ne pas
// couper les zones frontalières (Pyrénées, causses du Lot/Aveyron).
export const MIDI_PYRENEES_BOUNDS = {
  latMin: 42.6,
  latMax: 45.15,
  lonMin: -0.4,
  lonMax: 3.4,
}

// Pas de la grille pour la carte de pluie Option A (voir rainGrid.ts), en
// degrés. Le modèle sous-jacent d'Open-Meteo pour la France (`best_match`)
// est en réalité AROME (Météo-France), nativement en ~1.3km de maille — la
// grille à 0.08° (~8-9km) sous-échantillonnait donc largement un modèle
// déjà assez précis pour l'usage visé. ~0.03° (~3-3.5km, ~10800 points)
// exploite mieux cette résolution native sans tomber dans l'illusion (le
// modèle n'est pas magiquement plus précis que 1.3km, inutile de descendre
// sous ce seuil).
//
// Envisagé un temps de reculer à 0.05° pour limiter le coût GitHub Actions
// (le dépôt était privé, 2000 min/mois gratuites, dépassées par les jobs
// planifiés) — finalement pas nécessaire : le dépôt est passé en **public**
// (Actions illimité et gratuit, voir section 5 de CLAUDE.md), donc la
// densité n'a plus besoin d'être sacrifiée pour le coût. Le découpage en
// tranches (voir .github/workflows/rain-grid.yml) reste nécessaire quel que
// soit le coût : c'est une limite d'Open-Meteo (sollicitation continue trop
// longue), pas de facturation GitHub.
export const RAIN_GRID_STEP_DEG = 0.03

// Dimensions de la grille, calculées par INDEX (lat = latMin + i * pas) et non
// par accumulation `lat += pas` : l'accumulation de flottants faisait sauter
// la dernière ligne (45.15 devenait 45.150000000000006 > latMax) et laissait
// la grille plus petite que ce que RainOverlay attendait. L'epsilon absorbe
// l'imprécision du rapport (ex. (45.15 - 42.6) / 0.03 = 84.99999…). Les
// scripts de CI (scripts/fetch-rain*.mjs) refont le même calcul à la main.
export const RAIN_GRID_ROWS =
  Math.floor((MIDI_PYRENEES_BOUNDS.latMax - MIDI_PYRENEES_BOUNDS.latMin) / RAIN_GRID_STEP_DEG + 1e-6) + 1
export const RAIN_GRID_COLS =
  Math.floor((MIDI_PYRENEES_BOUNDS.lonMax - MIDI_PYRENEES_BOUNDS.lonMin) / RAIN_GRID_STEP_DEG + 1e-6) + 1

// Nombre de points groupés par appel à Open-Meteo (voir rainGrid.ts) — testé
// jusqu'à 150 points en un seul appel HTTP sans erreur (ça, ce n'est pas le
// problème). Le problème observé en usage réel : la limite de débit
// gratuite d'Open-Meteo semble compter chaque point d'un appel multi-lieux
// comme autant d'appels "unitaires" pour son quota par minute (~600/min) —
// un enchaînement de lots de 120 points tirés toutes les 300ms déclenche
// donc un 429 en quelques secondes. D'où un lot modéré ici, combiné à un
// espacement généreux entre lots (voir RAIN_GRID_BATCH_DELAY_MS).
export const RAIN_GRID_BATCH_SIZE = 100

// Pause entre deux lots (ms) — calée pour rester sous ~500 points/minute
// (marge sous la limite ~600/min supposée, voir commentaire ci-dessus).
export const RAIN_GRID_BATCH_DELAY_MS = 12000
