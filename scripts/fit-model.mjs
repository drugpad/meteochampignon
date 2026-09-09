#!/usr/bin/env node
// Recherche automatique des paramètres du modèle de score, par évolution
// différentielle (bien plus fin qu'une grille : l'espace est continu et
// l'algorithme resserre tout seul autour des bonnes zones).
//
//   node scripts/fit-model.mjs            → ajustement + validation croisée
//   node scripts/fit-model.mjs --quick    → version rapide (moins d'itérations)
//
// IMPORTANT — pourquoi la validation croisée : avec 20 points et ~16
// paramètres, on peut toujours faire tomber l'erreur d'ajustement très bas
// sans rien apprendre de vrai (le modèle apprend le bruit). La validation
// "leave-one-out" réajuste le modèle en retirant un point à chaque fois et
// mesure l'erreur sur ce point exclu. L'écart entre les deux chiffres dit
// si on a trouvé une vraie régularité ou juste épousé nos 20 mesures.
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

// Bornes de chaque paramètre libre. L'ordre fixe l'encodage du vecteur.
const BOUNDS = [
  ['altLowOk', 50, 300],   ['altHighOk', 400, 900],  ['altKo', 950, 1800],
  ['phLowOk', 3.8, 4.8],   ['phHighOk', 5.0, 6.2],   ['phKo', 6.2, 7.6],
  ['penLowOk', 2, 20],     ['penHighOk', 25, 50],    ['penKo', 55, 90],
  ['aspMin', 0.05, 0.9],   ['aspBest', 120, 240],
  ['hostSat', 60, 200],    ['hostPow', 0.1, 1.2],
  ['wAlt', 0.05, 0.8],     ['wExp', 0.02, 0.6],      ['wPen', 0.01, 0.5],
  ['wPh', 0.05, 0.8],      ['floor', 0.01, 0.3],
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

// --- Évolution différentielle (DE/rand/1/bin) --------------------------
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

// --- Exécution ---------------------------------------------------------
const quick = process.argv.includes('--quick')
const opts = quick ? { iterations: 600, popSize: 40 } : { iterations: 3000, popSize: 60 }
const data = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8'))
const points = data.points

console.log(`\nAjustement sur ${points.length} points, ${BOUNDS.length} paramètres libres…`)
const full = optimise(points, opts)
console.log(`\nErreur d'ajustement  : ${full.err.toFixed(2)} points`)

// Validation croisée leave-one-out : le vrai juge de paix.
let looSum = 0
for (let i = 0; i < points.length; i++) {
  const train = points.filter((_, k) => k !== i)
  const { params } = optimise(train, { ...opts, seed: 1 + i })
  looSum += Math.abs(Math.round(predict(points[i], params)) - points[i].score)
}
const loo = looSum / points.length
console.log(`Erreur en validation : ${loo.toFixed(2)} points  (points jamais vus par le modèle)`)
console.log(
  loo - full.err > 3
    ? "\n⚠ Écart important entre les deux : le modèle épouse le bruit de nos 20 mesures.\n  Il faut plus de points, pas plus de paramètres."
    : "\n✓ Les deux chiffres sont proches : le modèle a trouvé une vraie régularité.",
)

console.log('\nParamètres retenus :')
for (const [name] of BOUNDS) console.log(`  ${name.padEnd(11)} ${full.params[name].toFixed(2)}`)

console.log('\n eux  nous  écart')
points
  .map((p) => ({ p, s: Math.round(predict(p, full.params)) }))
  .sort((a, b) => a.p.score - b.p.score)
  .forEach(({ p, s }) => {
    const d = s - p.score
    console.log(`  ${String(p.score).padStart(3)}  ${String(s).padStart(4)}  ${(d > 0 ? `+${d}` : `${d}`).padStart(5)}`)
  })
