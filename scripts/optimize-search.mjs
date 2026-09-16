#!/usr/bin/env node
// Recherche exhaustive (autant qu'on peut) des paramètres du modèle de
// score : relance l'évolution différentielle de fit-model.mjs avec plein de
// graines aléatoires différentes (l'algo peut se coincer dans un optimum
// local avec une seule graine), garde le meilleur résultat, puis le valide
// par LOO-CV. Pensé pour tourner en fond un moment (plusieurs minutes) sans
// bloquer la conversation — écrit sa progression dans
// scripts/optimize-search.log au fur et à mesure.
//
//   node scripts/optimize-search.mjs [nombreDeGraines]
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'

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

const BOUNDS = [
  ['altLowOk', 50, 300], ['altHighOk', 400, 900], ['altKo', 950, 1800],
  ['phLowOk', 3.8, 4.8], ['phHighOk', 5.0, 6.2], ['phKo', 6.2, 7.6],
  ['penLowOk', 2, 20], ['penHighOk', 25, 50], ['penKo', 55, 90],
  ['aspMin', 0.05, 0.9], ['aspBest', 120, 240],
  ['hostSat', 60, 200], ['hostPow', 0.1, 1.2],
  ['wAlt', 0.05, 0.8], ['wExp', 0.02, 0.6], ['wPen', 0.01, 0.5],
  ['wPh', 0.05, 0.8], ['floor', 0.01, 0.3],
]

function decode(vec) {
  const q = {}
  BOUNDS.forEach(([name], i) => (q[name] = vec[i]))
  return q
}

function predict(p, q) {
  const crit = [
    [plateau(p.altitude, 0, q.altLowOk, q.altHighOk, q.altKo), q.wAlt],
    [q.aspMin + (1 - q.aspMin) * ((Math.cos(((p.orientation - q.aspBest) * Math.PI) / 180) + 1) / 2), q.wExp],
    [plateau(p.pente, 0, q.penLowOk, q.penHighOk, q.penKo), q.wPen],
    [plateau(p.ph, 3.5, q.phLowOk, q.phHighOk, q.phKo), q.wPh],
  ]
  const terrain = crit.reduce((prod, [v, w]) => prod * Math.pow(Math.max(q.floor, v), w), 1)
  const hostFactor = Math.pow(Math.min(1, hostAbundance(p.essences) / q.hostSat), q.hostPow)
  return 100 * hostFactor * terrain
}

const meanAbsErr = (points, q) =>
  points.reduce((s, p) => s + Math.abs(Math.round(predict(p, q)) - p.score), 0) / points.length

function optimise(points, { iterations = 3000, popSize = 60, seed = 1 } = {}) {
  let rngState = seed
  const rnd = () => {
    rngState = (rngState * 1103515245 + 12345) & 0x7fffffff
    return rngState / 0x7fffffff
  }
  const rand = (lo, hi) => lo + rnd() * (hi - lo)

  let pop = Array.from({ length: popSize }, () => BOUNDS.map(([, lo, hi]) => rand(lo, hi)))
  let fit = pop.map((v) => meanAbsErr(points, decode(v)))

  for (let gen = 0; gen < iterations; gen++) {
    for (let i = 0; i < popSize; i++) {
      let a, b, c
      do { a = Math.floor(rnd() * popSize) } while (a === i)
      do { b = Math.floor(rnd() * popSize) } while (b === i || b === a)
      do { c = Math.floor(rnd() * popSize) } while (c === i || c === a || c === b)
      const F = 0.5 + rnd() * 0.4
      const trial = pop[i].map((x, k) => {
        if (rnd() > 0.9 && k !== Math.floor(rnd() * BOUNDS.length)) return x
        const [, lo, hi] = BOUNDS[k]
        return Math.min(hi, Math.max(lo, pop[a][k] + F * (pop[b][k] - pop[c][k])))
      })
      const f = meanAbsErr(points, decode(trial))
      if (f < fit[i]) { pop[i] = trial; fit[i] = f }
    }
  }
  const best = fit.indexOf(Math.min(...fit))
  return { params: decode(pop[best]), err: fit[best] }
}

function looCv(points, opts) {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const train = points.filter((_, k) => k !== i)
    const { params } = optimise(train, { ...opts, seed: 1000 + i })
    sum += Math.abs(Math.round(predict(points[i], params)) - points[i].score)
  }
  return sum / points.length
}

const LOG = new URL('./optimize-search.log', import.meta.url)
const BEST_OUT = new URL('./optimize-search-best.json', import.meta.url)
function log(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`
  console.log(stamped)
  appendFileSync(LOG, stamped + '\n')
}

const data = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8'))
const points = data.points
const nSeeds = Number(process.argv[2]) || 40
const opts = { iterations: 3000, popSize: 60 }

writeFileSync(LOG, '')
log(`Recherche sur ${points.length} points, ${BOUNDS.length} paramètres, ${nSeeds} graines à tester.`)

let best = null
for (let s = 0; s < nSeeds; s++) {
  const seed = 7 + s * 97
  const r = optimise(points, { ...opts, seed })
  log(`graine ${s + 1}/${nSeeds} (seed=${seed}) : erreur d'ajustement ${r.err.toFixed(3)}` + (best && r.err >= best.err ? '' : '  <- meilleure jusqu\'ici'))
  if (!best || r.err < best.err) best = { ...r, seed }
}

log(`\nMeilleure graine : seed=${best.seed}, erreur d'ajustement ${best.err.toFixed(3)}`)
log('Validation croisée LOO-CV sur cette meilleure graine (peut prendre plusieurs minutes)…')
const loo = looCv(points, opts)
log(`Erreur en validation croisée : ${loo.toFixed(3)} points`)
log(
  loo - best.err > 3
    ? '⚠ Sur-apprentissage probable (écart fit/LOO > 3) — à ne pas garder tel quel.'
    : '✓ Écart faible entre ajustement et validation — régularité réelle.',
)

writeFileSync(
  BEST_OUT,
  JSON.stringify({ params: best.params, fitErr: best.err, looErr: loo, nSeeds, nPoints: points.length, date: new Date().toISOString() }, null, 2),
)
log(`Paramètres retenus écrits dans scripts/optimize-search-best.json`)
