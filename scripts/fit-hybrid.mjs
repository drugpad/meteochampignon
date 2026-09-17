#!/usr/bin/env node
// Deux dernières pistes pour récupérer la marge qui reste (on est à 8.73,
// le plancher des données est à ~4.6) :
//
//   1. réglage du boosting : notre premier essai (profondeur 3, 250 arbres)
//      donnait 7.84 en validation croisée sans avoir cherché les bons
//      réglages ;
//   2. modèle hybride : on garde la formule compacte (qui porte le sens
//      agronomique : pH, altitude, orientation) et on apprend seulement à
//      corriger SES erreurs avec des arbres boostés. L'idée est que la
//      formule capture le signal principal et que les arbres ne servent
//      qu'à rattraper les interactions résiduelles — ce qui demande
//      beaucoup moins de données que tout apprendre de zéro.
//
//   node scripts/fit-hybrid.mjs
import { readFileSync, writeFileSync } from 'node:fs'

const HOST_APTITUDE = {
  chataignier: 1, chene_pedoncule: 1, chene_rouvre: 1, chene_tauzin: 0.9,
  chene_pubescent: 0.85, chene_chevelu: 0.85, hetre: 0.9, chene_vert: 0.5,
  noisetier: 0.35, charme: 0.3, bouleau: 0.15, merisier: 0.1,
  saule_marsault: 0.1, tremble: 0.05,
}
const hostAbundance = (e) => Object.entries(e).reduce((s, [k, v]) => s + v * (HOST_APTITUDE[k] ?? 0), 0)

// Formule compacte retenue par scripts/fit-compact.mjs
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
const features = (p) => [
  p.altitude, p.ph, p.pente,
  Math.cos((p.orientation * Math.PI) / 180), Math.sin((p.orientation * Math.PI) / 180),
  hostAbundance(p.essences),
  Object.values(p.essences).reduce((a, b) => a + b, 0),
  Object.keys(p.essences).length,
  p.lat, p.lon,
  ...SPECIES.map((s) => p.essences[s] ?? 0),
]

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

const data = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8'))
const points = data.points
const X = points.map(features)
const yScore = points.map((p) => p.score)
const yResid = points.map((p, i) => p.score - baseFormula(p)) // pour l'hybride

const order = points.map((_, i) => i)
let s = 7
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
for (let i = order.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1))
  ;[order[i], order[j]] = [order[j], order[i]]
}

function crossValidate(target, addBase, params) {
  let sum = 0
  for (let k = 0; k < 5; k++) {
    const test = order.filter((_, i) => i % 5 === k)
    const train = order.filter((_, i) => i % 5 !== k)
    const m = fitBoosted(train.map((i) => X[i]), train.map((i) => target[i]), params)
    for (const i of test) {
      const pred = predictBoosted(m, X[i]) + (addBase ? baseFormula(points[i]) : 0)
      sum += Math.abs(Math.max(0, Math.min(100, pred)) - yScore[i])
    }
  }
  return sum / points.length
}

const CONFIGS = [
  { trees: 200, depth: 2, lr: 0.06, minLeaf: 4 },
  { trees: 250, depth: 3, lr: 0.06, minLeaf: 4 },
  { trees: 400, depth: 2, lr: 0.03, minLeaf: 6 },
  { trees: 150, depth: 4, lr: 0.06, minLeaf: 8 },
]

console.log(`\nRéglage du boosting et test de l'hybride — ${points.length} points, validation croisée 5 blocs.\n`)
console.log('  config                                  boosting seul   hybride (formule + correction)')
let best = null
for (const c of CONFIGS) {
  const errPure = crossValidate(yScore, false, c)
  const errHybrid = crossValidate(yResid, true, c)
  const label = `prof ${c.depth}, ${c.trees} arbres, lr ${c.lr}, feuille ${c.minLeaf}`
  console.log(`  ${label.padEnd(40)} ${errPure.toFixed(2).padStart(10)}      ${errHybrid.toFixed(2).padStart(10)}`)
  for (const [kind, err] of [['boosting', errPure], ['hybride', errHybrid]]) {
    if (!best || err < best.err) best = { kind, err, config: c }
  }
}

console.log('\n  références :')
console.log('    formule compacte seule          : 8.73 validation croisée')
console.log('    ancienne formule (18 paramètres) : 9.21')
console.log('    plancher théorique des données   : ~4.6')
console.log(`\n=== Meilleur : ${best.kind} (${JSON.stringify(best.config)}) → ${best.err.toFixed(2)} ===`)

// On sauvegarde le meilleur modèle entraîné sur tout le jeu, prêt à servir.
const finalTarget = best.kind === 'hybride' ? yResid : yScore
const finalModel = fitBoosted(X, finalTarget, best.config)
writeFileSync(
  new URL('./best-model.json', import.meta.url),
  JSON.stringify({ kind: best.kind, cvErr: best.err, config: best.config, model: finalModel, nPoints: points.length, date: new Date().toISOString() }),
)
console.log('\nModèle écrit dans scripts/best-model.json')
