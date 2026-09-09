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
// degrés. ~0.08° ≈ 8-9km de maille, dans la fourchette visée par la spec
// (5-10km) sans exploser le nombre de points à interroger (usage restreint,
// mais pas la peine d'en abuser).
export const RAIN_GRID_STEP_DEG = 0.08

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
