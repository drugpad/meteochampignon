// Emprise géographique de l'ancienne région Midi-Pyrénées (8 départements :
// Ariège, Aveyron, Haute-Garonne, Gers, Lot, Hautes-Pyrénées, Tarn,
// Tarn-et-Garonne), en rectangle englobant simple — large exprès pour ne pas
// couper les zones frontalières (Pyrénées, causses du Lot/Aveyron).
//
// Sert à filtrer la liste des stations (src/data/stations-midi-pyrenees.json,
// voir CLAUDE.md) et reste la référence de l'emprise des cartes de pluie : la
// même valeur est répétée à la main dans scripts/build-rain-maps.py
// (LAT_MIN, LAT_MAX, LON_MIN, LON_MAX), à garder synchro.
export const MIDI_PYRENEES_BOUNDS = {
  latMin: 42.6,
  latMax: 45.15,
  lonMin: -0.4,
  lonMax: 3.4,
}
