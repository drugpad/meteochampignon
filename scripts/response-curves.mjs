#!/usr/bin/env node
// Extrait les VRAIES courbes de réponse du score à chaque variable, au lieu
// de supposer des trapèzes comme le fait notre formule actuelle.
//
// Méthode (dépendance partielle) : on entraîne le modèle à forte capacité
// (les mêmes arbres boostés que scripts/capacity-test.mjs), puis pour chaque
// variable on la fait varier sur toute sa plage en gardant les autres telles
// qu'elles sont dans les données réelles, et on moyenne les prédictions.
// C'est la forme de la réponse « toutes choses égales par ailleurs »,
// débarrassée des corrélations entre variables qui faussent une simple
// moyenne par tranche.
//
//   node scripts/response-curves.mjs
import { readFileSync } from 'node:fs'

const HOST_APTITUDE = {
  chataignier: 1, chene_pedoncule: 1, chene_rouvre: 1, chene_tauzin: 0.9,
  chene_pubescent: 0.85, chene_chevelu: 0.85, hetre: 0.9, chene_vert: 0.5,
  noisetier: 0.35, charme: 0.3, bouleau: 0.15, merisier: 0.1,
  saule_marsault: 0.1, tremble: 0.05,
}
const SPECIES = [
  'chataignier', 'chene_pedoncule', 'chene_pubescent', 'chene_rouvre', 'hetre', 'frene',
  'erable', 'merisier', 'charme', 'noisetier', 'bouleau', 'saule_marsault', 'tremble',
  'tilleul', 'pin_sylvestre', 'pin_noir', 'douglas', 'sapin_blanc', 'epicea', 'aulne', 'robinier',
]
const IDX = { altitude: 0, ph: 1, pente: 2, cosO: 3, sinO: 4, orientation: 5, host: 6, total: 7, count: 8 }

function features(p) {
  let host = 0
  let total = 0
  for (const [k, v] of Object.entries(p.essences)) {
    host += v * (HOST_APTITUDE[k] ?? 0)
    total += v
  }
  return [
    p.altitude, p.ph, p.pente,
    Math.cos((p.orientation * Math.PI) / 180), Math.sin((p.orientation * Math.PI) / 180), p.orientation,
    host, total, Object.keys(p.essences).length, p.lat, p.lon,
    ...SPECIES.map((s) => p.essences[s] ?? 0),
  ]
}

function buildTree(X, y, idx, depth, maxDepth, minLeaf) {
  const mean = idx.reduce((s, i) => s + y[i], 0) / idx.length
  if (depth >= maxDepth || idx.length < 2 * minLeaf) return { leaf: mean }
  let best = null
  for (let f = 0; f < X[0].length; f++) {
    const vals = [...new Set(idx.map((i) => X[i][f]))].sort((a, b) => a - b)
    if (vals.length < 2) continue
    const cuts = new Set()
    for (let q = 1; q <= 8; q++) cuts.add(vals[Math.floor((vals.length * q) / 9)])
    for (const cut of cuts) {
      let ls = 0, ln = 0, rs = 0, rn = 0
      for (const i of idx) {
        if (X[i][f] <= cut) { ls += y[i]; ln++ } else { rs += y[i]; rn++ }
      }
      if (ln < minLeaf || rn < minLeaf) continue
      const gain = (ls * ls) / ln + (rs * rs) / rn
      if (!best || gain > best.gain) best = { gain, f, cut }
    }
  }
  if (!best) return { leaf: mean }
  return {
    f: best.f, cut: best.cut,
    left: buildTree(X, y, idx.filter((i) => X[i][best.f] <= best.cut), depth + 1, maxDepth, minLeaf),
    right: buildTree(X, y, idx.filter((i) => X[i][best.f] > best.cut), depth + 1, maxDepth, minLeaf),
  }
}
const predictTree = (t, x) => {
  while (t.leaf === undefined) t = x[t.f] <= t.cut ? t.left : t.right
  return t.leaf
}
function fitBoosted(X, y, { trees = 250, depth = 3, lr = 0.06, minLeaf = 4 } = {}) {
  const base = y.reduce((a, b) => a + b, 0) / y.length
  const resid = y.map((v) => v - base)
  const model = { base, trees: [], lr }
  const idxAll = X.map((_, i) => i)
  for (let t = 0; t < trees; t++) {
    const tree = buildTree(X, resid, idxAll, 0, depth, minLeaf)
    model.trees.push(tree)
    for (let i = 0; i < X.length; i++) resid[i] -= lr * predictTree(tree, X[i])
  }
  return model
}
const predictBoosted = (m, x) => m.base + m.trees.reduce((s, t) => s + m.lr * predictTree(t, x), 0)

const data = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8'))
const points = data.points
const X = points.map(features)
const y = points.map((p) => p.score)
const model = fitBoosted(X, y)

function pdp(label, featIdx, values, format = (v) => String(v), extra = null) {
  console.log(`\n=== ${label} ===`)
  const results = values.map((v) => {
    let sum = 0
    for (const row of X) {
      const x = [...row]
      x[featIdx] = v
      if (extra) extra(x, v)
      sum += predictBoosted(model, x)
    }
    return { v, score: sum / X.length }
  })
  const min = Math.min(...results.map((r) => r.score))
  const max = Math.max(...results.map((r) => r.score))
  for (const r of results) {
    const bar = '#'.repeat(Math.round(((r.score - min) / Math.max(1e-9, max - min)) * 50))
    console.log(`  ${format(r.v).padStart(8)} → ${r.score.toFixed(1).padStart(5)}  ${bar}`)
  }
  console.log(`  (amplitude de l'effet : ${(max - min).toFixed(1)} points)`)
}

pdp('pH du sol', IDX.ph, [4.6, 4.8, 5.0, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.8, 6.0, 6.2, 6.5], (v) => v.toFixed(1))
pdp('Altitude (m)', IDX.altitude, [120, 200, 300, 400, 500, 600, 700, 850, 1000, 1150, 1350], (v) => `${v}m`)
pdp('Pente (°)', IDX.pente, [0, 2, 5, 8, 12, 16, 20, 25, 30, 35, 40, 45], (v) => `${v}°`)
pdp(
  'Orientation (°)',
  IDX.orientation,
  [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330],
  (v) => `${v}°`,
  // L'orientation est encodée trois fois (brute + cos + sin) : il faut les
  // faire varier ensemble, sinon le modèle voit des entrées incohérentes.
  (x, v) => {
    x[IDX.cosO] = Math.cos((v * Math.PI) / 180)
    x[IDX.sinO] = Math.sin((v * Math.PI) / 180)
  },
)
pdp('Abondance d’hôtes (somme pondérée)', IDX.host, [20, 40, 60, 80, 100, 130, 160, 200, 250], (v) => String(v))
pdp('Nombre d’essences recensées', IDX.count, [10, 13, 16, 18, 20, 21, 22, 23, 24], (v) => String(v))
