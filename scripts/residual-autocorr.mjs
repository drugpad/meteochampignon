#!/usr/bin/env node
// Test décisif sur la NATURE de l'erreur résiduelle : structure spatiale ou
// bruit pur ?
//
// Si l'information qui nous manque est une vraie couche géographique
// (couvert forestier fin, humidité du sol, structure du peuplement…), elle
// varie de façon continue dans l'espace : deux cases voisines doivent avoir
// des résidus semblables. On peut alors espérer retrouver cette donnée.
//
// Si au contraire les résidus sautent au hasard d'une case à la suivante,
// c'est du bruit — soit un aléa volontaire côté service, soit une entrée
// chaotique non reproductible — et aucune donnée supplémentaire ne nous
// permettra de faire mieux.
//
//   node scripts/residual-autocorr.mjs
import { readFileSync } from 'node:fs'
import { scoreCepeEte } from './compare-calibration.mjs'

const data = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8'))
const points = data.points.map((p) => ({ ...p, resid: p.score - scoreCepeEte(p).score }))

const distM = (a, b) => {
  const dLat = (a.lat - b.lat) * 111320
  const dLon = (a.lon - b.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180)
  return Math.hypot(dLat, dLon)
}

// Corrélation des résidus entre paires de points, par tranche de distance.
const BANDS = [
  [0, 30], [30, 60], [60, 120], [120, 250], [250, 500],
  [500, 1000], [1000, 3000], [3000, 10000], [10000, 1e9],
]
const bands = BANDS.map(([lo, hi]) => ({ lo, hi, xs: [], ys: [] }))

for (let i = 0; i < points.length; i++) {
  for (let j = i + 1; j < points.length; j++) {
    const d = distM(points[i], points[j])
    const band = bands.find((b) => d >= b.lo && d < b.hi)
    if (!band) continue
    // Paire symétrisée : on ajoute (a,b) et (b,a) pour que la corrélation
    // ne dépende pas de l'ordre arbitraire des points.
    band.xs.push(points[i].resid, points[j].resid)
    band.ys.push(points[j].resid, points[i].resid)
  }
}

function pearson(xs, ys) {
  if (xs.length < 8) return NaN
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length
  const my = ys.reduce((a, b) => a + b, 0) / ys.length
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0)
  const den = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0))
  return num / den
}

console.log('\n=== Corrélation des erreurs résiduelles selon la distance entre cases ===\n')
console.log('  distance          paires   corrélation des résidus')
for (const b of bands) {
  const r = pearson(b.xs, b.ys)
  const label = b.hi >= 1e9 ? `> ${b.lo / 1000} km` : b.hi >= 1000 ? `${b.lo / 1000}-${b.hi / 1000} km` : `${b.lo}-${b.hi} m`
  const bar = Number.isFinite(r) ? '#'.repeat(Math.max(0, Math.round(r * 40))) : ''
  console.log(`  ${label.padEnd(16)} ${String(b.xs.length / 2).padStart(6)}   ${Number.isFinite(r) ? r.toFixed(3) : 'n/a'}  ${bar}`)
}

console.log(
  '\nLecture : une corrélation forte à courte distance qui décroît avec la distance =\n' +
    'couche géographique cachée, donc récupérable. Une corrélation nulle dès la case\n' +
    "voisine = bruit non reproductible, donc plafond infranchissable.",
)
