#!/usr/bin/env node
// Vérification critique d'un résultat antérieur.
//
// scripts/residual-autocorr.mjs concluait à une « couche cachée spatialement
// lisse » à partir d'une corrélation de 0.68 entre résidus de cases distantes
// de moins de 30 m. Mais ce calcul ne distinguait pas deux situations très
// différentes :
//   - deux clics tombés dans la MÊME case (mêmes valeurs affichées, donc même
//     score et même résidu — corrélation 1 par construction, sans rien
//     prouver) ;
//   - deux cases VOISINES mais distinctes (valeurs affichées différentes) :
//     c'est le seul cas qui renseigne sur la continuité spatiale de
//     l'information manquante.
//
// On refait donc la mesure en séparant les deux. Si les cases distinctes ne
// montrent plus de corrélation, alors l'information manquante n'est pas une
// couche géographique continue mais une valeur propre à chaque case — et
// aucune donnée externe ne permettra de la retrouver.
//
//   node scripts/test-bruit-par-case.mjs
import { readFileSync } from 'node:fs'
import { scoreCepeEte } from './compare-calibration.mjs'

const data = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8'))
const points = data.points.map((p) => ({ ...p, resid: p.score - scoreCepeEte(p).score }))

const distM = (a, b) => {
  const dLat = (a.lat - b.lat) * 111320
  const dLon = (a.lon - b.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180)
  return Math.hypot(dLat, dLon)
}
// Deux relevés sont considérés comme issus de la même case si toutes les
// valeurs affichées coïncident : le service ne renvoie qu'un jeu de valeurs
// par case.
const memeCase = (a, b) =>
  a.altitude === b.altitude && a.ph === b.ph && a.orientation === b.orientation && a.pente === b.pente

function pearson(xs, ys) {
  if (xs.length < 8) return NaN
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length
  const my = ys.reduce((a, b) => a + b, 0) / ys.length
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0)
  const den = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0))
  return num / den
}

const BANDES = [
  [0, 30], [30, 60], [60, 120], [120, 300],
]

console.log('\n=== Corrélation des résidus, en séparant même case et cases distinctes ===\n')
console.log('  distance      cases DISTINCTES        même case (témoin)')
for (const [lo, hi] of BANDES) {
  const dif = { xs: [], ys: [] }
  const mem = { xs: [], ys: [] }
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = distM(points[i], points[j])
      if (d < lo || d >= hi) continue
      const cible = memeCase(points[i], points[j]) ? mem : dif
      cible.xs.push(points[i].resid, points[j].resid)
      cible.ys.push(points[j].resid, points[i].resid)
    }
  }
  const rd = pearson(dif.xs, dif.ys)
  const rm = pearson(mem.xs, mem.ys)
  const fmt = (r, n) => (Number.isFinite(r) ? `${(r >= 0 ? '+' : '') + r.toFixed(3)} (${n} paires)` : `n/a (${n} paires)`)
  console.log(`  ${`${lo}-${hi} m`.padEnd(12)}  ${fmt(rd, dif.xs.length / 2).padEnd(22)}  ${fmt(rm, mem.xs.length / 2)}`)
}

// Amplitude de la part propre à chaque case : écart de score entre cases
// voisines distinctes, une fois retirée la part expliquée par le modèle.
const ecarts = []
for (let i = 0; i < points.length; i++) {
  for (let j = i + 1; j < points.length; j++) {
    if (distM(points[i], points[j]) >= 60 || memeCase(points[i], points[j])) continue
    ecarts.push(Math.abs(points[i].resid - points[j].resid))
  }
}
if (ecarts.length) {
  const moy = ecarts.reduce((a, b) => a + b, 0) / ecarts.length
  console.log(`\n  Entre cases voisines distinctes (< 60 m), l'écart résiduel moyen est de ${moy.toFixed(1)} points.`)
}
console.log(
  '\nLecture : si la colonne « cases distinctes » tombe à zéro alors que le témoin\n' +
    'reste élevé, la corrélation mesurée jusqu\'ici venait des doublons de case, et\n' +
    "l'information manquante est propre à chaque case — donc introuvable de l'extérieur.",
)
