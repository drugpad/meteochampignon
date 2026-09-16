#!/usr/bin/env node
// Variantes enrichies du modèle : teste si une interaction entre critères
// (plutôt que 4 critères indépendants) explique mieux les 42 points.
//
//   node scripts/fit-model-v2.mjs base      → modèle actuel (référence)
//   node scripts/fit-model-v2.mjs altexp    → orientation optimale qui dérive avec l'altitude
//   node scripts/fit-model-v2.mjs phalt     → fenêtre de pH qui dérive avec l'altitude
//   node scripts/fit-model-v2.mjs both      → les deux
//   node scripts/fit-model-v2.mjs all       → compare les 4 (fit rapide), puis LOO-CV sur la meilleure
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

// Bornes de base (communes à toutes les variantes), plus les paramètres
// d'interaction ajoutés selon le mode.
const BASE_BOUNDS = [
  ['altLowOk', 50, 300], ['altHighOk', 400, 900], ['altKo', 950, 1800],
  ['phLowOk', 3.8, 4.8], ['phHighOk', 5.0, 6.2], ['phKo', 6.2, 7.6],
  ['penLowOk', 2, 20], ['penHighOk', 25, 50], ['penKo', 55, 90],
  ['aspMin', 0.05, 0.9], ['aspBest', 120, 240],
  ['hostSat', 60, 200], ['hostPow', 0.1, 1.2],
  ['wAlt', 0.05, 0.8], ['wExp', 0.02, 0.6], ['wPen', 0.01, 0.5],
  ['wPh', 0.05, 0.8], ['floor', 0.01, 0.3],
]
const EXTRA = {
  base: [],
  // aspBest dérive linéairement avec l'altitude autour de 600m (référence) :
  // hypothèse qu'en altitude, il faut un versant encore plus chaud (plus
  // proche du sud) pour compenser le froid, alors qu'en plaine l'orientation
  // compte moins.
  altexp: [['aspAltCoef', -0.08, 0.08]],
  // La fenêtre de pH favorable se décale avec l'altitude : hypothèse que les
  // sols d'altitude, plus lessivés, sont plus acides "normalement", donc le
  // pH optimal pourrait être différent en montagne qu'en plaine.
  phalt: [['phAltCoef', -0.002, 0.002]],
  both: [['aspAltCoef', -0.08, 0.08], ['phAltCoef', -0.002, 0.002]],
}

function makeBounds(mode) {
  return [...BASE_BOUNDS, ...EXTRA[mode]]
}

function decode(bounds, vec) {
  const q = {}
  bounds.forEach(([name], i) => (q[name] = vec[i]))
  return q
}

function predict(mode, p, q) {
  const altRef = 600
  const aspBest = q.aspBest + (mode === 'altexp' || mode === 'both' ? (q.aspAltCoef ?? 0) * (p.altitude - altRef) : 0)
  const phShift = mode === 'phalt' || mode === 'both' ? (q.phAltCoef ?? 0) * (p.altitude - altRef) : 0

  const crit = [
    [plateau(p.altitude, 0, q.altLowOk, q.altHighOk, q.altKo), q.wAlt],
    [q.aspMin + (1 - q.aspMin) * ((Math.cos(((p.orientation - aspBest) * Math.PI) / 180) + 1) / 2), q.wExp],
    [plateau(p.pente, 0, q.penLowOk, q.penHighOk, q.penKo), q.wPen],
    [plateau(p.ph, 3.5, q.phLowOk + phShift, q.phHighOk + phShift, q.phKo + phShift), q.wPh],
  ]
  const terrain = crit.reduce((prod, [v, w]) => prod * Math.pow(Math.max(q.floor, v), w), 1)
  const hostFactor = Math.pow(Math.min(1, hostAbundance(p.essences) / q.hostSat), q.hostPow)
  return 100 * hostFactor * terrain
}

const meanAbsErr = (mode, points, q) =>
  points.reduce((s, p) => s + Math.abs(Math.round(predict(mode, p, q)) - p.score), 0) / points.length

function optimise(mode, points, { iterations = 3000, popSize = 60, seed = 1 } = {}) {
  const bounds = makeBounds(mode)
  let rngState = seed
  const rnd = () => {
    rngState = (rngState * 1103515245 + 12345) & 0x7fffffff
    return rngState / 0x7fffffff
  }
  const rand = (lo, hi) => lo + rnd() * (hi - lo)

  let pop = Array.from({ length: popSize }, () => bounds.map(([, lo, hi]) => rand(lo, hi)))
  let fit = pop.map((v) => meanAbsErr(mode, points, decode(bounds, v)))

  for (let gen = 0; gen < iterations; gen++) {
    for (let i = 0; i < popSize; i++) {
      let a, b, c
      do { a = Math.floor(rnd() * popSize) } while (a === i)
      do { b = Math.floor(rnd() * popSize) } while (b === i || b === a)
      do { c = Math.floor(rnd() * popSize) } while (c === i || c === a || c === b)
      const F = 0.5 + rnd() * 0.4
      const trial = pop[i].map((x, k) => {
        if (rnd() > 0.9 && k !== Math.floor(rnd() * bounds.length)) return x
        const [, lo, hi] = bounds[k]
        return Math.min(hi, Math.max(lo, pop[a][k] + F * (pop[b][k] - pop[c][k])))
      })
      const f = meanAbsErr(mode, points, decode(bounds, trial))
      if (f < fit[i]) { pop[i] = trial; fit[i] = f }
    }
  }
  const best = fit.indexOf(Math.min(...fit))
  return { params: decode(bounds, pop[best]), err: fit[best] }
}

function looCv(mode, points, opts) {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const train = points.filter((_, k) => k !== i)
    const { params } = optimise(mode, train, { ...opts, seed: 1000 + i })
    sum += Math.abs(Math.round(predict(mode, points[i], params)) - points[i].score)
  }
  return sum / points.length
}

const data = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8'))
const points = data.points
const mode = process.argv[2] || 'all'

function runOne(m, opts) {
  // Plusieurs graines rapides, on garde la meilleure — sinon on compare des
  // optimisations mal converties plutôt que les modèles eux-mêmes.
  let best = null
  for (let s = 0; s < 8; s++) {
    const r = optimise(m, points, { ...opts, seed: 11 + s * 53 })
    if (!best || r.err < best.err) best = r
  }
  return best
}

if (mode === 'all') {
  console.log(`\nComparaison rapide des variantes sur ${points.length} points :\n`)
  const results = {}
  for (const m of ['base', 'altexp', 'phalt', 'both']) {
    const r = runOne(m, { iterations: 1500, popSize: 50 })
    results[m] = r
    console.log(`  ${m.padEnd(8)} erreur d'ajustement : ${r.err.toFixed(3)}`)
  }
  const bestMode = Object.entries(results).sort((a, b) => a[1].err - b[1].err)[0][0]
  console.log(`\nMeilleure variante (fit) : ${bestMode}. Validation croisée LOO-CV sur celle-ci et sur 'base' pour comparer équitablement…\n`)
  for (const m of new Set(['base', bestMode])) {
    const loo = looCv(m, points, { iterations: 1500, popSize: 50 })
    console.log(`  ${m.padEnd(8)} fit=${results[m].err.toFixed(3)}  LOO-CV=${loo.toFixed(3)}`)
  }
} else {
  const r = runOne(mode, { iterations: 3000, popSize: 60 })
  console.log(`\nVariante '${mode}' — erreur d'ajustement : ${r.err.toFixed(3)}`)
  console.log('Paramètres :', r.params)
  const loo = looCv(mode, points, { iterations: 1500, popSize: 50 })
  console.log(`Erreur en validation croisée : ${loo.toFixed(3)}`)
}
