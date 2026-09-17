#!/usr/bin/env node
// Nouvelle formule, construite à partir des formes de réponse RÉELLES
// extraites des données (voir scripts/response-curves.mjs) au lieu des
// trapèzes supposés a priori.
//
// Structure : modèle additif (une courbe apprise par variable, on les
// somme). Ajustement par « backfitting » : on part de courbes plates, puis
// on affine chaque courbe à tour de rôle sur ce que les autres n'expliquent
// pas encore. C'est la méthode classique des modèles additifs généralisés,
// et le résultat reste une formule lisible — pas une boîte noire.
//
// Ce que les données disent, et qui contredit notre ancienne formule :
//   - le pH écrase tout (27.7 points d'amplitude) avec un optimum ÉTROIT
//     (5.2-5.6) et une falaise au-delà de 5.7 ;
//   - l'altitude est neutre jusqu'à ~700 m puis décroche ;
//   - la pente (4.6) et l'abondance d'hôtes (2.4) sont quasi négligeables,
//     alors que l'ancienne formule en faisait des facteurs majeurs.
//
//   node scripts/fit-gam.mjs
import { readFileSync, writeFileSync } from 'node:fs'

const HOST_APTITUDE = {
  chataignier: 1, chene_pedoncule: 1, chene_rouvre: 1, chene_tauzin: 0.9,
  chene_pubescent: 0.85, chene_chevelu: 0.85, hetre: 0.9, chene_vert: 0.5,
  noisetier: 0.35, charme: 0.3, bouleau: 0.15, merisier: 0.1,
  saule_marsault: 0.1, tremble: 0.05,
}
function hostAbundance(essences) {
  let w = 0
  for (const [k, v] of Object.entries(essences)) w += v * (HOST_APTITUDE[k] ?? 0)
  return w
}

// Une variable = comment l'extraire, et les bornes de ses tranches. Les
// bornes sont calées sur les ruptures observées dans les courbes de réponse
// (falaise du pH à 5.7, décrochage d'altitude vers 700-850 m…), pas sur un
// découpage régulier arbitraire.
const VARS = [
  { name: 'pH', get: (p) => p.ph, edges: [5.05, 5.15, 5.25, 5.35, 5.45, 5.55, 5.7, 5.95] },
  { name: 'altitude', get: (p) => p.altitude, edges: [250, 400, 550, 700, 900, 1100] },
  { name: 'orientation', get: (p) => p.orientation, circular: true, edges: [45, 90, 135, 180, 225, 270, 315] },
  { name: 'pente', get: (p) => p.pente, edges: [3, 8, 15, 25] },
  { name: 'hotes', get: (p) => hostAbundance(p.essences), edges: [60, 110, 160] },
  { name: 'nbEssences', get: (p) => Object.keys(p.essences).length, edges: [17, 20, 22] },
]

const binOf = (v, edges) => {
  let b = 0
  while (b < edges.length && v >= edges[b]) b++
  return b
}

// Ajustement par backfitting : chaque courbe est une valeur par tranche,
// estimée sur les résidus laissés par les autres variables. Régularisation
// par « shrinkage » vers 0 proportionnellement au nombre de points de la
// tranche (une tranche à 3 points ne doit pas dicter un décalage de 20
// points de score).
function fitGam(points, { iterations = 25, shrink = 6 } = {}) {
  const base = points.reduce((s, p) => s + p.score, 0) / points.length
  const curves = VARS.map((v) => new Array(v.edges.length + 1).fill(0))
  const bins = points.map((p) => VARS.map((v, k) => binOf(v.get(p), v.edges)))

  for (let it = 0; it < iterations; it++) {
    for (let k = 0; k < VARS.length; k++) {
      const sum = new Array(curves[k].length).fill(0)
      const n = new Array(curves[k].length).fill(0)
      points.forEach((p, i) => {
        let other = base
        for (let j = 0; j < VARS.length; j++) if (j !== k) other += curves[j][bins[i][j]]
        sum[bins[i][k]] += p.score - other
        n[bins[i][k]]++
      })
      for (let b = 0; b < curves[k].length; b++) {
        curves[k][b] = n[b] > 0 ? sum[b] / (n[b] + shrink) : 0
      }
      // On recentre la courbe (moyenne pondérée nulle) pour que le niveau
      // global reste porté par `base` et pas réparti au hasard entre les
      // variables — sinon les courbes ne sont plus interprétables.
      const totalN = n.reduce((a, b) => a + b, 0)
      const offset = curves[k].reduce((s, c, b) => s + c * n[b], 0) / totalN
      for (let b = 0; b < curves[k].length; b++) curves[k][b] -= offset
    }
  }
  return { base, curves }
}

const predictGam = (m, p) =>
  Math.max(0, Math.min(100, m.base + VARS.reduce((s, v, k) => s + m.curves[k][binOf(v.get(p), v.edges)], 0)))

const data = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8'))
const points = data.points

// --- Validation croisée 5 blocs (tout le pipeline refait par bloc) ------
const order = points.map((_, i) => i)
let seed = 7
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
for (let i = order.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1))
  ;[order[i], order[j]] = [order[j], order[i]]
}
const K = 5
let cvSum = 0
for (let k = 0; k < K; k++) {
  const test = order.filter((_, i) => i % K === k).map((i) => points[i])
  const train = order.filter((_, i) => i % K !== k).map((i) => points[i])
  const m = fitGam(train)
  for (const p of test) cvSum += Math.abs(predictGam(m, p) - p.score)
}
const cvErr = cvSum / points.length

const full = fitGam(points)
const fitErr = points.reduce((s, p) => s + Math.abs(predictGam(full, p) - p.score), 0) / points.length

function pearson(xs, ys) {
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length
  const my = ys.reduce((a, b) => a + b, 0) / ys.length
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0)
  const den = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0))
  return num / den
}
const corr = pearson(points.map((p) => predictGam(full, p)), points.map((p) => p.score))

console.log(`\nModèle additif à formes apprises — ${points.length} points\n`)
console.log(`  erreur d'ajustement            : ${fitErr.toFixed(2)} points`)
console.log(`  erreur en validation croisée   : ${cvErr.toFixed(2)} points`)
console.log(`  corrélation                    : ${corr.toFixed(3)}`)
console.log('\n  pour comparaison :')
console.log('    ancienne formule (trapèzes)  : 8.56 ajustement / 9.21 LOO-CV, corrélation 0.75')
console.log('    boosting (boîte noire)       : 7.84 en validation croisée')
console.log('    plancher théorique des données : ~4.8')

console.log(`\n=== La formule apprise (score = ${full.base.toFixed(1)} + somme des termes) ===`)
VARS.forEach((v, k) => {
  const labels = []
  for (let b = 0; b <= v.edges.length; b++) {
    const lo = b === 0 ? '-∞' : v.edges[b - 1]
    const hi = b === v.edges.length ? '+∞' : v.edges[b]
    labels.push(`[${lo}–${hi}[ ${full.curves[k][b] >= 0 ? '+' : ''}${full.curves[k][b].toFixed(1)}`)
  }
  const amplitude = Math.max(...full.curves[k]) - Math.min(...full.curves[k])
  console.log(`\n  ${v.name} (amplitude ${amplitude.toFixed(1)} points)`)
  console.log(`    ${labels.join('   ')}`)
})

writeFileSync(
  new URL('./gam-model.json', import.meta.url),
  JSON.stringify({ base: full.base, vars: VARS.map((v, k) => ({ name: v.name, edges: v.edges, values: full.curves[k] })), fitErr, cvErr, nPoints: points.length, date: new Date().toISOString() }, null, 1),
)
console.log('\nModèle écrit dans scripts/gam-model.json')
