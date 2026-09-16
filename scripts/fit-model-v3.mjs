#!/usr/bin/env node
// Suite du diagnostic de scripts/residual-analysis.mjs : notre modèle
// surestime systématiquement le score sauf sur les points dominés par le
// châtaignier (biais quasi nul), alors qu'il surestime de 6-7 points sur les
// points dominés par chêne pédonculé/pubescent/hêtre. Ça sent une mauvaise
// calibration RELATIVE des aptitudes d'essences (fixées à la main jusqu'ici)
// plutôt qu'un problème de la structure "terrain".
//
// Cette variante laisse l'optimiseur ajuster LUI-MÊME les 5 aptitudes
// impliquées dans ce biais (chataignier, chene_pedoncule, chene_pubescent,
// chene_rouvre, hetre), en plus des 18 paramètres de terrain habituels —
// plutôt que de les garder figées à des valeurs choisies à la main.
//
//   node scripts/fit-model-v3.mjs
import { readFileSync, writeFileSync } from 'node:fs'

// Aptitudes fixes pour les essences qu'on ne remet PAS en question (peu de
// points, ou hors sujet — résineux, non hôtes) : évite de faire exploser le
// nombre de paramètres libres sans justification.
const FIXED_APTITUDE = {
  chene_tauzin: 0.9, chene_pubescent_ALT: undefined, chene_chevelu: 0.85,
  chene_vert: 0.5, noisetier: 0.35, charme: 0.3, bouleau: 0.15,
  merisier: 0.1, saule_marsault: 0.1, tremble: 0.05,
}
// Essences dont on laisse l'optimiseur retrouver l'aptitude — celles
// impliquées dans le biais observé, plus fréquentes (n>=68/82 points).
const FREE_SPECIES = ['chataignier', 'chene_pedoncule', 'chene_pubescent', 'chene_rouvre', 'hetre']

function plateau(v, a, b, c, d) {
  if (v <= a || v >= d) return 0
  if (v < b) return (v - a) / (b - a)
  if (v > c) return (d - v) / (d - c)
  return 1
}

function hostAbundance(essences, apt) {
  let w = 0
  for (const [k, v] of Object.entries(essences)) w += v * (apt[k] ?? FIXED_APTITUDE[k] ?? 0)
  return w
}

const BOUNDS = [
  ['altLowOk', 50, 300], ['altHighOk', 400, 900], ['altKo', 950, 1800],
  ['phLowOk', 3.8, 4.8], ['phHighOk', 5.0, 6.2], ['phKo', 6.2, 7.6],
  ['penLowOk', 2, 20], ['penHighOk', 25, 50], ['penKo', 55, 90],
  ['aspMin', 0.05, 0.9], ['aspBest', 120, 240],
  ['hostSat', 60, 250], ['hostPow', 0.1, 1.2],
  ['wAlt', 0.05, 0.8], ['wExp', 0.02, 0.6], ['wPen', 0.01, 0.5],
  ['wPh', 0.05, 0.8], ['floor', 0.01, 0.3],
  // Aptitudes libres, bornées large (0 = pas hôte du tout, 1.3 = encore
  // meilleur hôte que ce qu'on pensait) :
  ...FREE_SPECIES.map((s) => [`apt_${s}`, 0, 1.3]),
]

function decode(vec) {
  const q = {}
  BOUNDS.forEach(([name], i) => (q[name] = vec[i]))
  const apt = {}
  for (const s of FREE_SPECIES) apt[s] = q[`apt_${s}`]
  return { q, apt }
}

function predict(p, q, apt) {
  const crit = [
    [plateau(p.altitude, 0, q.altLowOk, q.altHighOk, q.altKo), q.wAlt],
    [q.aspMin + (1 - q.aspMin) * ((Math.cos(((p.orientation - q.aspBest) * Math.PI) / 180) + 1) / 2), q.wExp],
    [plateau(p.pente, 0, q.penLowOk, q.penHighOk, q.penKo), q.wPen],
    [plateau(p.ph, 3.5, q.phLowOk, q.phHighOk, q.phKo), q.wPh],
  ]
  const terrain = crit.reduce((prod, [v, w]) => prod * Math.pow(Math.max(q.floor, v), w), 1)
  const hostFactor = Math.pow(Math.min(1, hostAbundance(p.essences, apt) / q.hostSat), q.hostPow)
  return 100 * hostFactor * terrain
}

const meanAbsErr = (points, vec) => {
  const { q, apt } = decode(vec)
  return points.reduce((s, p) => s + Math.abs(Math.round(predict(p, q, apt)) - p.score), 0) / points.length
}

function optimise(points, { iterations = 3000, popSize = 70, seed = 1 } = {}) {
  let rngState = seed
  const rnd = () => {
    rngState = (rngState * 1103515245 + 12345) & 0x7fffffff
    return rngState / 0x7fffffff
  }
  const rand = (lo, hi) => lo + rnd() * (hi - lo)
  let pop = Array.from({ length: popSize }, () => BOUNDS.map(([, lo, hi]) => rand(lo, hi)))
  let fit = pop.map((v) => meanAbsErr(points, v))
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
      const f = meanAbsErr(points, trial)
      if (f < fit[i]) { pop[i] = trial; fit[i] = f }
    }
  }
  const best = fit.indexOf(Math.min(...fit))
  return { vec: pop[best], err: fit[best] }
}

function looCv(points, opts) {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const train = points.filter((_, k) => k !== i)
    const { vec } = optimise(train, { ...opts, seed: 1000 + i })
    const { q, apt } = decode(vec)
    sum += Math.abs(Math.round(predict(points[i], q, apt)) - points[i].score)
  }
  return sum / points.length
}

const data = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8'))
const points = data.points
const nSeeds = Number(process.argv[2]) || 25

console.log(`\nAjustement avec aptitudes libres (${FREE_SPECIES.join(', ')}) sur ${points.length} points, ${BOUNDS.length} paramètres, ${nSeeds} graines…\n`)
let best = null
for (let s = 0; s < nSeeds; s++) {
  const r = optimise(points, { seed: 11 + s * 53 })
  console.log(`  graine ${s + 1}/${nSeeds} : erreur ${r.err.toFixed(3)}` + (best && r.err >= best.err ? '' : '  <- meilleure'))
  if (!best || r.err < best.err) best = r
}
const { q, apt } = decode(best.vec)
console.log(`\nMeilleur ajustement : ${best.err.toFixed(3)}`)
console.log('Aptitudes retrouvées :', Object.fromEntries(Object.entries(apt).map(([k, v]) => [k, +v.toFixed(3)])))

console.log('\nValidation croisée LOO-CV (peut prendre longtemps avec 23 paramètres)…')
const loo = looCv(points, {})
console.log(`Erreur en validation croisée : ${loo.toFixed(3)}`)
console.log(
  loo - best.err > 3
    ? '⚠ Sur-apprentissage probable — le gain ne se généralise pas.'
    : '✓ Écart faible avec le fit — le modèle a probablement trouvé une vraie meilleure calibration.',
)

writeFileSync(
  new URL('./fit-model-v3-best.json', import.meta.url),
  JSON.stringify({ q, apt, fitErr: best.err, looErr: loo, nSeeds, nPoints: points.length, date: new Date().toISOString() }, null, 2),
)
