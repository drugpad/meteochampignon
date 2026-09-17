#!/usr/bin/env node
// LA question de fond : l'information nécessaire pour reproduire leur score
// est-elle présente dans les 5 variables qu'ils affichent, oui ou non ?
//
// Méthode : on lâche un modèle à très forte capacité (gradient boosting sur
// arbres de régression) qui peut approximer n'importe quelle fonction — y
// compris des interactions et des seuils qu'on n'aurait jamais devinés à la
// main — et on mesure son erreur en validation croisée 5 blocs.
//
//   - s'il plafonne au niveau de notre formule (~8.6) → l'information
//     manque, aucune formule sur ces variables ne fera mieux. Question
//     close, on arrête de chercher la formule et on cherche la donnée.
//   - s'il fait nettement mieux → c'est la STRUCTURE de notre formule qui
//     est fausse, et l'importance des variables nous dit dans quel sens.
//
//   node scripts/capacity-test.mjs
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

function features(p) {
  let host = 0
  let total = 0
  for (const [k, v] of Object.entries(p.essences)) {
    host += v * (HOST_APTITUDE[k] ?? 0)
    total += v
  }
  return [
    p.altitude,
    p.ph,
    p.pente,
    Math.cos((p.orientation * Math.PI) / 180),
    Math.sin((p.orientation * Math.PI) / 180),
    p.orientation,
    host,
    total,
    Object.keys(p.essences).length,
    p.lat,
    p.lon,
    ...SPECIES.map((s) => p.essences[s] ?? 0),
  ]
}
const FEATURE_NAMES = [
  'altitude', 'pH', 'pente', 'cos(orient)', 'sin(orient)', 'orientation',
  'abondance hôtes', 'somme essences', 'nb essences', 'latitude', 'longitude',
  ...SPECIES,
]

// --- Arbre de régression (CART, split par réduction de variance) --------
function buildTree(X, y, idx, depth, maxDepth, minLeaf) {
  const mean = idx.reduce((s, i) => s + y[i], 0) / idx.length
  if (depth >= maxDepth || idx.length < 2 * minLeaf) return { leaf: mean }

  let best = null
  for (let f = 0; f < X[0].length; f++) {
    const vals = [...new Set(idx.map((i) => X[i][f]))].sort((a, b) => a - b)
    if (vals.length < 2) continue
    // On teste des seuils aux quantiles plutôt que toutes les valeurs :
    // même résultat en pratique, beaucoup plus rapide.
    const cuts = []
    for (let q = 1; q <= 8; q++) cuts.push(vals[Math.floor((vals.length * q) / 9)])
    for (const cut of [...new Set(cuts)]) {
      let ls = 0, ln = 0, rs = 0, rn = 0
      for (const i of idx) {
        if (X[i][f] <= cut) { ls += y[i]; ln++ } else { rs += y[i]; rn++ }
      }
      if (ln < minLeaf || rn < minLeaf) continue
      // Gain = réduction de la somme des carrés (formule équivalente rapide)
      const gain = (ls * ls) / ln + (rs * rs) / rn
      if (!best || gain > best.gain) best = { gain, f, cut }
    }
  }
  if (!best) return { leaf: mean }

  const left = idx.filter((i) => X[i][best.f] <= best.cut)
  const right = idx.filter((i) => X[i][best.f] > best.cut)
  return {
    f: best.f,
    cut: best.cut,
    left: buildTree(X, y, left, depth + 1, maxDepth, minLeaf),
    right: buildTree(X, y, right, depth + 1, maxDepth, minLeaf),
  }
}
function predictTree(t, x) {
  while (t.leaf === undefined) t = x[t.f] <= t.cut ? t.left : t.right
  return t.leaf
}
function treeImportance(t, out) {
  if (t.leaf !== undefined) return
  out[t.f] = (out[t.f] ?? 0) + 1
  treeImportance(t.left, out)
  treeImportance(t.right, out)
}

// --- Gradient boosting -------------------------------------------------
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
function predictBoosted(m, x) {
  let v = m.base
  for (const t of m.trees) v += m.lr * predictTree(t, x)
  return v
}

// --- Exécution ---------------------------------------------------------
const data = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8'))
const points = data.points
const X = points.map(features)
const y = points.map((p) => p.score)

// Validation croisée 5 blocs, découpage déterministe mélangé.
const order = X.map((_, i) => i)
let seed = 42
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
for (let i = order.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1))
  ;[order[i], order[j]] = [order[j], order[i]]
}

console.log(`\nTest de capacité sur ${points.length} points, ${FEATURE_NAMES.length} variables dérivées.`)
console.log('Modèle : gradient boosting (250 arbres, profondeur 3) — validation croisée 5 blocs.\n')

const K = 5
let sumAbs = 0
for (let k = 0; k < K; k++) {
  const test = order.filter((_, i) => i % K === k)
  const train = order.filter((_, i) => i % K !== k)
  const m = fitBoosted(train.map((i) => X[i]), train.map((i) => y[i]))
  for (const i of test) sumAbs += Math.abs(predictBoosted(m, X[i]) - y[i])
  process.stdout.write(`\r  bloc ${k + 1}/${K} terminé`)
}
const cvErr = sumAbs / points.length
console.log('\n')

const full = fitBoosted(X, y)
const fitErr = points.reduce((s, p, i) => s + Math.abs(predictBoosted(full, X[i]) - y[i]), 0) / points.length

console.log('=== Résultat ===')
console.log(`  erreur d'ajustement (sur les points vus)      : ${fitErr.toFixed(2)} points`)
console.log(`  erreur en validation croisée (points non vus) : ${cvErr.toFixed(2)} points`)
console.log(`  pour mémoire, notre formule actuelle          : 8.56 points (ajustement), 9.21 (LOO-CV)`)

const imp = {}
for (const t of full.trees) treeImportance(t, imp)
const totalSplits = Object.values(imp).reduce((a, b) => a + b, 0)
console.log('\n=== Variables les plus utilisées par le modèle ===')
Object.entries(imp)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 12)
  .forEach(([f, n]) => console.log(`  ${FEATURE_NAMES[f].padEnd(20)} ${((n / totalSplits) * 100).toFixed(1)}% des décisions`))
