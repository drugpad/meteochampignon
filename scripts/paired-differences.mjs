#!/usr/bin/env node
// Mesure directe de la sensibilité de LEUR score à chaque variable, par
// comparaison de cases voisines.
//
// Le principe : la variable qui nous manque est une couche géographique fine
// (corrélation 0.68 entre cases distantes de moins de 30 m, nulle au-delà de
// 60 m). Entre deux cases proches, elle a donc quasiment la même valeur —
// et elle DISPARAÎT quand on soustrait leurs scores. Ce qui reste de l'écart
// ne peut plus venir que des variables visibles.
//
// On régresse donc l'écart de score sur l'écart de chaque variable, en ne
// gardant que des paires proches. Les coefficients obtenus sont les vraies
// pentes de leur formule, débarrassées de l'inconnue.
//
//   node scripts/paired-differences.mjs [distanceMax]
import { readFileSync } from 'node:fs'

const HOST_APTITUDE = {
  chataignier: 1, chene_pedoncule: 1, chene_rouvre: 1, chene_tauzin: 0.9,
  chene_pubescent: 0.85, chene_chevelu: 0.85, hetre: 0.9, chene_vert: 0.5,
  noisetier: 0.35, charme: 0.3, bouleau: 0.15, merisier: 0.1,
  saule_marsault: 0.1, tremble: 0.05,
}
const hostAbundance = (e) => Object.entries(e).reduce((s, [k, v]) => s + v * (HOST_APTITUDE[k] ?? 0), 0)

const data = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8'))
const points = data.points
const maxDist = Number(process.argv[2]) || 150

const distM = (a, b) => {
  const dLat = (a.lat - b.lat) * 111320
  const dLon = (a.lon - b.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180)
  return Math.hypot(dLat, dLon)
}

// Variables explicatives, en ÉCART entre les deux cases de la paire.
const DELTAS = [
  { name: 'pH (+0.1)', get: (p) => p.ph, unit: 0.1 },
  { name: 'altitude (+10 m)', get: (p) => p.altitude, unit: 10 },
  { name: 'exposition sud (0→1)', get: (p) => (Math.cos(((p.orientation - 180) * Math.PI) / 180) + 1) / 2, unit: 1 },
  { name: 'pente (+1°)', get: (p) => p.pente, unit: 1 },
  { name: 'abondance hôtes (+10)', get: (p) => hostAbundance(p.essences), unit: 10 },
]

const rowsX = []
const rowsY = []
for (let i = 0; i < points.length; i++) {
  for (let j = i + 1; j < points.length; j++) {
    if (distM(points[i], points[j]) > maxDist) continue
    // On ajoute la paire dans les deux sens : la régression reste ainsi
    // centrée sur zéro, sans terme constant artificiel.
    const dx = DELTAS.map((d) => d.get(points[i]) - d.get(points[j]))
    rowsX.push(dx, dx.map((v) => -v))
    rowsY.push(points[i].score - points[j].score, points[j].score - points[i].score)
  }
}

console.log(`\n${rowsY.length / 2} paires de cases distantes de moins de ${maxDist} m.\n`)
if (rowsY.length < 20) {
  console.log('Trop peu de paires — augmenter la distance maximale.')
  process.exit(0)
}

// Moindres carrés par équations normales (5 variables : résolution directe).
const n = DELTAS.length
const A = Array.from({ length: n }, () => new Array(n).fill(0))
const b = new Array(n).fill(0)
for (let r = 0; r < rowsX.length; r++) {
  for (let i = 0; i < n; i++) {
    b[i] += rowsX[r][i] * rowsY[r]
    for (let j = 0; j < n; j++) A[i][j] += rowsX[r][i] * rowsX[r][j]
  }
}
// Petite régularisation : certaines variables sont corrélées entre elles,
// sans quoi le système peut être mal conditionné.
for (let i = 0; i < n; i++) A[i][i] *= 1.0001
// Élimination de Gauss
const M = A.map((row, i) => [...row, b[i]])
for (let c = 0; c < n; c++) {
  let piv = c
  for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r
  ;[M[c], M[piv]] = [M[piv], M[c]]
  for (let r = 0; r < n; r++) {
    if (r === c || M[c][c] === 0) continue
    const f = M[r][c] / M[c][c]
    for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
  }
}
const coef = M.map((row, i) => row[n] / row[i])

// Qualité : part de la variance des écarts expliquée par les variables.
let ssRes = 0
let ssTot = 0
for (let r = 0; r < rowsX.length; r++) {
  const pred = rowsX[r].reduce((s, v, i) => s + v * coef[i], 0)
  ssRes += (rowsY[r] - pred) ** 2
  ssTot += rowsY[r] ** 2
}
const r2 = 1 - ssRes / ssTot

console.log('=== Effet mesuré de chaque variable sur LEUR score ===\n')
DELTAS.forEach((d, i) => {
  const effet = coef[i] * d.unit
  console.log(`  ${d.name.padEnd(24)} ${effet >= 0 ? '+' : ''}${effet.toFixed(2)} points de score`)
})
console.log(`\n  part de l'écart de score expliquée : ${(r2 * 100).toFixed(1)}%`)
console.log(`  écart type résiduel : ${Math.sqrt(ssRes / rowsY.length).toFixed(2)} points`)
console.log(
  r2 > 0.4
    ? "\n  → Les variables visibles expliquent l'essentiel des écarts entre cases proches :\n    la formule est bien à notre portée, ces coefficients en sont la mesure directe."
    : "\n  → Même entre cases voisines, les variables visibles n'expliquent qu'une faible\n    part des écarts : l'information manquante agit à l'échelle de la case elle-même.",
)
