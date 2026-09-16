#!/usr/bin/env node
// Cherche un point commun dans les erreurs du modèle actuel : si les gros
// écarts se concentrent sur une essence dominante, une zone géographique ou
// une plage d'altitude particulière, ça sent la variable cachée plutôt que
// le bruit pur.
import { readFileSync } from 'node:fs'

const HOST_APTITUDE = {
  chataignier: 1, chene_pedoncule: 1, chene_rouvre: 1, chene_tauzin: 0.9,
  chene_pubescent: 0.85, chene_chevelu: 0.85, hetre: 0.9, chene_vert: 0.5,
  noisetier: 0.35, charme: 0.3, bouleau: 0.15, merisier: 0.1,
  saule_marsault: 0.1, tremble: 0.05,
}
function plateau(v, a, b, c, d) {
  if (v <= a || v >= d) return 0
  if (v < b) return (v - a) / (b - a)
  if (v > c) return (d - v) / (d - c)
  return 1
}
function hostAbundance(essences) {
  let w = 0
  for (const [k, v] of Object.entries(essences)) w += v * (HOST_APTITUDE[k] ?? 0)
  return w
}
const Q = {
  altLowOk: 275.01, altHighOk: 592.36, altKo: 1422.67,
  phLowOk: 4.12, phHighOk: 5.5, phKo: 6.29,
  penLowOk: 19.94, penHighOk: 36.08, penKo: 86.03,
  aspMin: 0.64, aspBest: 177.67,
  hostSat: 185.89, hostPow: 0.12,
  wAlt: 0.51, wExp: 0.56, wPen: 0.07, wPh: 0.4, floor: 0.07,
}
function scoreCepeEte({ altitude, pente, orientation, ph, essences }) {
  const criteria = {
    altitude: plateau(altitude, 0, Q.altLowOk, Q.altHighOk, Q.altKo),
    exposition: Q.aspMin + (1 - Q.aspMin) * ((Math.cos(((orientation - Q.aspBest) * Math.PI) / 180) + 1) / 2),
    pente: plateau(pente, 0, Q.penLowOk, Q.penHighOk, Q.penKo),
    ph: plateau(ph, 3.5, Q.phLowOk, Q.phHighOk, Q.phKo),
  }
  const weights = { altitude: Q.wAlt, exposition: Q.wExp, pente: Q.wPen, ph: Q.wPh }
  const terrain = Object.entries(criteria).reduce((p, [k, v]) => p * Math.pow(Math.max(Q.floor, v), weights[k]), 1)
  const hostFactor = Math.pow(Math.min(1, hostAbundance(essences) / Q.hostSat), Q.hostPow)
  return Math.round(100 * hostFactor * terrain)
}

const data = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8'))
const points = data.points.map((p) => {
  const pred = scoreCepeEte(p)
  const dominant = Object.entries(p.essences).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '?'
  return { ...p, pred, err: pred - p.score, dominant }
})

function groupStats(keyFn, label) {
  const groups = {}
  for (const p of points) {
    const k = keyFn(p)
    ;(groups[k] ??= []).push(p.err)
  }
  console.log(`\n--- ${label} ---`)
  const rows = Object.entries(groups)
    .map(([k, errs]) => ({
      k,
      n: errs.length,
      meanErr: errs.reduce((a, b) => a + b, 0) / errs.length,
      meanAbs: errs.reduce((a, b) => a + Math.abs(b), 0) / errs.length,
    }))
    .filter((r) => r.n >= 2)
    .sort((a, b) => b.meanAbs - a.meanAbs)
  for (const r of rows) {
    console.log(`  ${r.k.padEnd(22)} n=${String(r.n).padStart(3)}  biais moyen=${r.meanErr.toFixed(1).padStart(6)}  |erreur| moyenne=${r.meanAbs.toFixed(1)}`)
  }
}

groupStats((p) => p.dominant, 'Par essence dominante')
groupStats((p) => {
  if (p.altitude < 200) return '<200m'
  if (p.altitude < 400) return '200-400m'
  if (p.altitude < 600) return '400-600m'
  if (p.altitude < 900) return '600-900m'
  return '900m+'
}, 'Par tranche d’altitude')
groupStats((p) => {
  if (p.ph < 5.2) return 'pH<5.2'
  if (p.ph < 5.6) return 'pH 5.2-5.6'
  if (p.ph < 6.0) return 'pH 5.6-6.0'
  return 'pH>=6.0'
}, 'Par pH')
groupStats((p) => {
  // zone géographique grossière par longitude (proxy est/ouest de la région)
  if (p.lon < 0.5) return 'ouest (lon<0.5)'
  if (p.lon < 1.5) return 'centre (0.5-1.5)'
  if (p.lon < 2.5) return 'centre-est (1.5-2.5)'
  return 'est (lon>=2.5)'
}, 'Par zone (longitude)')
groupStats((p) => {
  const total = Object.values(p.essences).reduce((a, b) => a + b, 0)
  if (total < 40) return 'essences clairsemées (<40)'
  if (total < 100) return 'moyen (40-100)'
  return 'dense (100+)'
}, 'Par densité totale d’essences (somme brute, indicateur de richesse du peuplement)')

// Corrélation simple erreur vs quelques variables continues, pour repérer un
// biais systématique (ex: modèle qui sous-estime toujours en haute pente).
function corr(xs, ys) {
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length
  const my = ys.reduce((a, b) => a + b, 0) / ys.length
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0)
  const den = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0))
  return num / den
}
console.log('\n--- Corrélation du biais (erreur signée) avec les variables ---')
const errs = points.map((p) => p.err)
for (const [name, fn] of [
  ['altitude', (p) => p.altitude],
  ['pH', (p) => p.ph],
  ['orientation (cos)', (p) => Math.cos((p.orientation * Math.PI) / 180)],
  ['pente', (p) => p.pente],
  ['longitude', (p) => p.lon],
  ['latitude', (p) => p.lat],
  ['abondance hôtes', (p) => hostAbundance(p.essences)],
  ['densité totale essences', (p) => Object.values(p.essences).reduce((a, b) => a + b, 0)],
]) {
  console.log(`  ${name.padEnd(26)} r=${corr(points.map(fn), errs).toFixed(2)}`)
}
