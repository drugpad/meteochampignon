#!/usr/bin/env node
// Leur score est-il LISSÉ sur le voisinage ?
//
// Indice décisif (scripts/test-bruit-par-case.mjs) : entre cases voisines
// mais distinctes, les résidus sont corrélés à 0.50 sous 30 m, puis à 0.03
// au-delà. Ce profil — forte dépendance entre cases adjacentes, nulle dès
// deux cases d'écart — est la signature d'une moyenne glissante, procédé
// courant pour éviter un rendu granuleux.
//
// Si le score d'une case est calculé sur la moyenne de son voisinage alors
// que les valeurs AFFICHÉES sont celles de la case seule, alors nos
// prédictions ne peuvent pas coller — et tout ce qu'on a observé s'explique
// d'un coup.
//
// Test : on compare la corrélation de leur score avec, d'une part notre
// prédiction sur la case elle-même, d'autre part la moyenne de nos
// prédictions sur les cases voisines, à plusieurs rayons.
//
//   node scripts/test-lissage.mjs
import { readFileSync } from 'node:fs'
import { scoreCepeEte } from './compare-calibration.mjs'

const data = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8'))
const points = data.points.map((p) => ({ ...p, pred: scoreCepeEte(p).score }))

const distM = (a, b) => {
  const dLat = (a.lat - b.lat) * 111320
  const dLon = (a.lon - b.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180)
  return Math.hypot(dLat, dLon)
}

function pearson(xs, ys) {
  const ok = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
  if (ok.length < 5) return NaN
  const a = ok.map((o) => o[0])
  const b = ok.map((o) => o[1])
  const ma = a.reduce((s, v) => s + v, 0) / a.length
  const mb = b.reduce((s, v) => s + v, 0) / b.length
  const num = a.reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0)
  const den = Math.sqrt(a.reduce((s, v) => s + (v - ma) ** 2, 0) * b.reduce((s, v) => s + (v - mb) ** 2, 0))
  return den === 0 ? NaN : num / den
}

// On ne garde que les points ayant assez de voisins pour qu'une moyenne de
// voisinage ait un sens, sinon on compare des choses incomparables.
function evalue(sousEnsemble, nom) {
  console.log(`\n=== ${nom} (${sousEnsemble.length} points) ===\n`)
  console.log('  rayon de moyenne     corrélation avec leur score   écart moyen')
  const brut = pearson(sousEnsemble.map((p) => p.pred), sousEnsemble.map((p) => p.score))
  const errBrut =
    sousEnsemble.reduce((s, p) => s + Math.abs(p.pred - p.score), 0) / sousEnsemble.length
  console.log(`  case seule (0 m)     ${brut.toFixed(3).padStart(12)}                ${errBrut.toFixed(2)}`)

  for (const rayon of [20, 30, 40, 60, 100, 150]) {
    const lisse = sousEnsemble.map((p) => {
      const vois = sousEnsemble.filter((q) => distM(p, q) <= rayon)
      return vois.reduce((s, q) => s + q.pred, 0) / vois.length
    })
    const nVois =
      sousEnsemble.reduce((s, p) => s + sousEnsemble.filter((q) => distM(p, q) <= rayon).length, 0) /
      sousEnsemble.length
    const r = pearson(lisse, sousEnsemble.map((p) => p.score))
    const err =
      sousEnsemble.reduce((s, p, i) => s + Math.abs(lisse[i] - p.score), 0) / sousEnsemble.length
    console.log(
      `  ${String(rayon + ' m').padEnd(20)} ${r.toFixed(3).padStart(12)}                ${err.toFixed(2)}   (${nVois.toFixed(1)} cases en moyenne)`,
    )
  }
}

// Le cluster : le seul endroit où les cases sont assez denses pour qu'une
// moyenne de voisinage soit calculable sur nos propres relevés.
const cluster = points.filter((p) => p.lat > 43.1 && p.lat < 43.103 && p.lon > 0.213 && p.lon < 0.216)
evalue(cluster, 'Cluster de cases voisines')

const dense = points.filter((p) => points.filter((q) => distM(p, q) <= 60).length >= 4)
if (dense.length > 20 && dense.length !== cluster.length) evalue(dense, 'Toutes les zones à cases denses')

console.log(
  "\nLecture : si la corrélation monte nettement quand on moyenne sur le voisinage,\n" +
    "c'est que leur score est lissé — et qu'il faut comparer leurs valeurs à une\n" +
    'moyenne de voisinage, pas à la case seule.',
)
