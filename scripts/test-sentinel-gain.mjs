#!/usr/bin/env node
// Le test qui trancHe : ajouter les indices satellite fait-il VRAIMENT
// baisser l'erreur du modèle ?
//
// Une corrélation brute peut tromper (une variable peut corréler sans rien
// apporter de neuf si elle fait doublon avec ce qu'on a déjà — c'est ce qui
// nous est arrivé avec la diversité d'essences). La seule preuve qui compte
// est une baisse de l'erreur en validation croisée, à structure de modèle
// identique, avec et sans les nouvelles variables.
//
//   node scripts/test-sentinel-gain.mjs
import { readFileSync } from 'node:fs'

const HOST_APTITUDE = {
  chataignier: 1, chene_pedoncule: 1, chene_rouvre: 1, chene_tauzin: 0.9,
  chene_pubescent: 0.85, chene_chevelu: 0.85, hetre: 0.9, chene_vert: 0.5,
  noisetier: 0.35, charme: 0.3, bouleau: 0.15, merisier: 0.1,
  saule_marsault: 0.1, tremble: 0.05,
}
const hostAbundance = (e) => Object.entries(e).reduce((s, [k, v]) => s + v * (HOST_APTITUDE[k] ?? 0), 0)

const Q = JSON.parse(readFileSync(new URL('./compact-model.json', import.meta.url), 'utf8')).q
function baseFormula(p) {
  const fPh =
    p.ph < Q.phLo
      ? Math.max(0, (p.ph - Q.phAcidKo) / Math.max(0.01, Q.phLo - Q.phAcidKo))
      : p.ph <= Q.phHi
        ? 1
        : Math.max(0, 1 - (p.ph - Q.phHi) / Math.max(0.01, Q.phDrop))
  const fAlt =
    p.altitude <= Q.altBreak
      ? 1
      : Math.max(Q.altFloor, 1 - ((p.altitude - Q.altBreak) / Math.max(1, Q.altSpan)) * (1 - Q.altFloor))
  const fAsp = Q.aspMin + (1 - Q.aspMin) * ((Math.cos(((p.orientation - Q.aspBest) * Math.PI) / 180) + 1) / 2)
  const fHost = Q.hostMin + (1 - Q.hostMin) * Math.min(1, hostAbundance(p.essences) / Math.max(1, Q.hostSat))
  return Q.amp * fPh * fAlt * fAsp * fHost
}

const SPECIES = [
  'chataignier', 'chene_pedoncule', 'chene_pubescent', 'chene_rouvre', 'hetre', 'frene',
  'erable', 'merisier', 'charme', 'noisetier', 'bouleau', 'saule_marsault', 'tremble',
  'tilleul', 'pin_sylvestre', 'pin_noir', 'douglas', 'sapin_blanc', 'epicea', 'aulne', 'robinier',
]
// Les arbres de décision gèrent les valeurs manquantes en les envoyant d'un
// côté du seuil : on remplace donc les indices absents par une valeur
// sentinelle basse plutôt que d'écarter le point.
const SENTINELLE = -9
const num = (v) => (Number.isFinite(v) ? v : SENTINELLE)

function makeFeatures(withSat) {
  return (p) => [
    p.altitude, p.ph, p.pente,
    Math.cos((p.orientation * Math.PI) / 180), Math.sin((p.orientation * Math.PI) / 180),
    hostAbundance(p.essences),
    Object.values(p.essences).reduce((a, b) => a + b, 0),
    Object.keys(p.essences).length,
    p.lat, p.lon,
    ...SPECIES.map((s) => p.essences[s] ?? 0),
    ...(withSat ? [num(p.ndvi), num(p.ndmi), num(p.pir)] : []),
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
function fitBoosted(X, y, { trees, depth, lr, minLeaf }) {
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
function importance(model, n) {
  const out = new Array(n).fill(0)
  const walk = (t) => {
    if (t.leaf !== undefined) return
    out[t.f]++
    walk(t.left)
    walk(t.right)
  }
  model.trees.forEach(walk)
  return out
}

const points = JSON.parse(readFileSync(new URL('./sentinel-all.json', import.meta.url), 'utf8'))
const avecSat = points.filter((p) => Number.isFinite(p.ndvi)).length
console.log(`\n${points.length} points, dont ${avecSat} avec indice satellite.\n`)

const order = points.map((_, i) => i)
let s = 7
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
for (let i = order.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1))
  ;[order[i], order[j]] = [order[j], order[i]]
}

const CONFIG = { trees: 150, depth: 4, lr: 0.06, minLeaf: 8 } // le meilleur réglage trouvé
const yScore = points.map((p) => p.score)
const yResid = points.map((p) => p.score - baseFormula(p))

console.log('  variante                              validation croisée')
const results = {}
for (const withSat of [false, true]) {
  const feat = makeFeatures(withSat)
  const X = points.map(feat)
  let sum = 0
  for (let k = 0; k < 5; k++) {
    const test = order.filter((_, i) => i % 5 === k)
    const train = order.filter((_, i) => i % 5 !== k)
    const m = fitBoosted(train.map((i) => X[i]), train.map((i) => yResid[i]), CONFIG)
    for (const i of test) {
      const pred = predictBoosted(m, X[i]) + baseFormula(points[i])
      sum += Math.abs(Math.max(0, Math.min(100, pred)) - yScore[i])
    }
  }
  results[withSat] = sum / points.length
  console.log(`  hybride ${withSat ? 'AVEC' : 'SANS'} indices satellite        ${(sum / points.length).toFixed(2)}`)
}

const gain = results[false] - results[true]
console.log(
  `\n  → ${gain > 0 ? 'gain' : 'perte'} de ${Math.abs(gain).toFixed(2)} point${Math.abs(gain) >= 2 ? 's' : ''} en ajoutant le satellite`,
)
console.log('\n  références : formule seule 8.73 | ancienne formule 9.21 | plancher ~4.6')

// Quelle importance les arbres donnent-ils réellement aux variables
// satellite, comparé aux autres ?
const featNames = [
  'altitude', 'pH', 'pente', 'cos(orient)', 'sin(orient)', 'abondance hôtes', 'somme essences',
  'nb essences', 'latitude', 'longitude', ...SPECIES, 'NDVI', 'NDMI', 'PIR',
]
const X = points.map(makeFeatures(true))
const full = fitBoosted(X, yResid, CONFIG)
const imp = importance(full, featNames.length)
const total = imp.reduce((a, b) => a + b, 0)
console.log('\n=== Variables les plus utilisées pour corriger la formule ===')
imp
  .map((n, i) => ({ n, name: featNames[i] }))
  .sort((a, b) => b.n - a.n)
  .slice(0, 10)
  .forEach((f) => console.log(`  ${f.name.padEnd(18)} ${((f.n / total) * 100).toFixed(1)}%`))
