#!/usr/bin/env node
// Diagnostic : notre erreur vient-elle du CLASSEMENT (on ordonne mal les
// terrains) ou de l'ÉCHELLE (on les ordonne bien mais on traduit mal en
// note /100) ? La réponse change complètement la suite : une erreur
// d'échelle se corrige par une simple courbe de calibration, une erreur de
// classement veut dire qu'il manque de l'information.
//
//   node scripts/diagnose-ceiling.mjs
import { readFileSync } from 'node:fs'
import { scoreCepeEte } from './compare-calibration.mjs'

const data = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8'))
const points = data.points.map((p) => ({ ...p, pred: scoreCepeEte(p).score }))

// --- 1. Distribution de LEURS scores -----------------------------------
// Si elle est suspecte­ment uniforme, c'est le signe d'une normalisation par
// percentile (ils étalent les notes sur 0-100 à l'échelle de la région).
console.log('\n=== Distribution de leurs scores (par tranche de 10) ===')
const bins = new Array(10).fill(0)
for (const p of points) bins[Math.min(9, Math.floor(p.score / 10))]++
bins.forEach((n, i) => {
  const bar = '#'.repeat(Math.round((n / points.length) * 120))
  console.log(`  ${String(i * 10).padStart(3)}-${String(i * 10 + 9).padStart(3)} : ${String(n).padStart(3)} ${bar}`)
})

// --- 2. Corrélations de rang -------------------------------------------
function rank(values) {
  const idx = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0])
  const r = new Array(values.length)
  for (let i = 0; i < idx.length; ) {
    let j = i
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++
    const avg = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg
    i = j + 1
  }
  return r
}
function pearson(xs, ys) {
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length
  const my = ys.reduce((a, b) => a + b, 0) / ys.length
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0)
  const den = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0))
  return num / den
}
const theirs = points.map((p) => p.score)
const ours = points.map((p) => p.pred)
console.log('\n=== Qualité du classement ===')
console.log(`  corrélation de Pearson  : ${pearson(ours, theirs).toFixed(3)}`)
console.log(`  corrélation de Spearman : ${pearson(rank(ours), rank(theirs)).toFixed(3)}  (sur les rangs — insensible à l'échelle)`)

// --- 3. Recalibration monotone optimale (régression isotonique, PAVA) ---
// On garde NOTRE ordre et on cherche la meilleure traduction possible de
// notre note vers la leur. L'erreur qui reste après ça est purement due à
// des erreurs de classement, donc au manque d'information.
const sorted = [...points].sort((a, b) => a.pred - b.pred)
const blocks = sorted.map((p) => ({ sum: p.score, n: 1 }))
for (let i = 0; i < blocks.length - 1; ) {
  if (blocks[i].sum / blocks[i].n <= blocks[i + 1].sum / blocks[i + 1].n) {
    i++
    continue
  }
  blocks[i] = { sum: blocks[i].sum + blocks[i + 1].sum, n: blocks[i].n + blocks[i + 1].n }
  blocks.splice(i + 1, 1)
  if (i > 0) i--
}
const fitted = []
for (const b of blocks) for (let k = 0; k < b.n; k++) fitted.push(b.sum / b.n)

const errBefore = points.reduce((s, p) => s + Math.abs(p.pred - p.score), 0) / points.length
const errAfter = sorted.reduce((s, p, i) => s + Math.abs(fitted[i] - p.score), 0) / sorted.length
console.log('\n=== Erreur avant / après recalibration parfaite de l’échelle ===')
console.log(`  écart moyen actuel                    : ${errBefore.toFixed(2)} points`)
console.log(`  écart moyen si l'échelle était parfaite : ${errAfter.toFixed(2)} points`)
console.log(
  `  → ${(((errBefore - errAfter) / errBefore) * 100).toFixed(0)}% de notre erreur vient de l'ÉCHELLE (corrigeable),` +
    ` ${((errAfter / errBefore) * 100).toFixed(0)}% du CLASSEMENT (manque d'info)`,
)

// --- 4. Le cluster de cases voisines : qu'est-ce qui fait varier le score
// quand essences + pH + altitude sont quasi constants ? ------------------
const cluster = points.filter((p) => p.lat > 43.1 && p.lat < 43.103 && p.lon > 0.213 && p.lon < 0.216)
if (cluster.length > 5) {
  console.log(`\n=== Cluster de ${cluster.length} cases voisines (essences/pH/altitude ~constants) ===`)
  console.log(`  leurs scores vont de ${Math.min(...cluster.map((p) => p.score))} à ${Math.max(...cluster.map((p) => p.score))}`)
  const cs = cluster.map((p) => p.score)
  console.log(`  corrélation score / cos(orientation) : ${pearson(cluster.map((p) => Math.cos((p.orientation * Math.PI) / 180)), cs).toFixed(3)}`)
  console.log(`  corrélation score / sin(orientation) : ${pearson(cluster.map((p) => Math.sin((p.orientation * Math.PI) / 180)), cs).toFixed(3)}`)
  console.log(`  corrélation score / pente            : ${pearson(cluster.map((p) => p.pente), cs).toFixed(3)}`)
  console.log(`  corrélation score / altitude         : ${pearson(cluster.map((p) => p.altitude), cs).toFixed(3)}`)
  console.log(`  corrélation score / latitude         : ${pearson(cluster.map((p) => p.lat), cs).toFixed(3)}`)
  console.log(`  corrélation score / longitude        : ${pearson(cluster.map((p) => p.lon), cs).toFixed(3)}`)
  const predErr = cluster.reduce((s, p) => s + Math.abs(p.pred - p.score), 0) / cluster.length
  console.log(`  notre écart moyen sur ce cluster     : ${predErr.toFixed(1)} points`)
}
