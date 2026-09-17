#!/usr/bin/env node
// Nouvelle formule, reconstruite d'après ce que les données disent vraiment
// (scripts/response-curves.mjs) plutôt que d'après nos intuitions de départ :
//
//   - le pH écrase tout (28 points d'amplitude) avec un optimum ÉTROIT
//     autour de 5.2-5.6 et une CHUTE BRUTALE au-delà : l'ancienne formule
//     lui donnait un plateau large de 4.15 à 5.51 puis un déclin doux,
//     c'est-à-dire l'inverse de la réalité du côté acide comme alcalin ;
//   - l'altitude est neutre jusqu'à ~700 m puis décroche d'un coup ;
//   - l'orientation compte (14.6) avec un optimum large au sud ;
//   - la pente (4.6) et l'abondance d'hôtes (2.4) sont presque sans effet,
//     alors que l'ancienne formule en faisait des facteurs de premier plan.
//
// On teste deux façons de combiner (additive et multiplicative) avec peu de
// paramètres, et on tranche en validation croisée 5 blocs — moins de
// paramètres qu'avant (10-11 contre 18), donc moins de sur-apprentissage.
//
//   node scripts/fit-compact.mjs
import { readFileSync, writeFileSync } from 'node:fs'

const HOST_APTITUDE = {
  chataignier: 1, chene_pedoncule: 1, chene_rouvre: 1, chene_tauzin: 0.9,
  chene_pubescent: 0.85, chene_chevelu: 0.85, hetre: 0.9, chene_vert: 0.5,
  noisetier: 0.35, charme: 0.3, bouleau: 0.15, merisier: 0.1,
  saule_marsault: 0.1, tremble: 0.05,
}
const hostAbundance = (e) => Object.entries(e).reduce((s, [k, v]) => s + v * (HOST_APTITUDE[k] ?? 0), 0)

// pH : montée depuis phAcidKo, optimum de phLo à phHi, puis chute abrupte
// sur phDrop unités (la « falaise » observée).
function phFactor(ph, q) {
  if (ph < q.phLo) return Math.max(0, (ph - q.phAcidKo) / Math.max(0.01, q.phLo - q.phAcidKo))
  if (ph <= q.phHi) return 1
  return Math.max(0, 1 - (ph - q.phHi) / Math.max(0.01, q.phDrop))
}
// Altitude : neutre jusqu'au décrochage, puis descente vers un plancher.
function altFactor(alt, q) {
  if (alt <= q.altBreak) return 1
  const t = (alt - q.altBreak) / Math.max(1, q.altSpan)
  return Math.max(q.altFloor, 1 - t * (1 - q.altFloor))
}
const aspFactor = (orient, q) => q.aspMin + (1 - q.aspMin) * ((Math.cos(((orient - q.aspBest) * Math.PI) / 180) + 1) / 2)
const hostFactor = (host, q) => q.hostMin + (1 - q.hostMin) * Math.min(1, host / Math.max(1, q.hostSat))

const BOUNDS = [
  ['phAcidKo', 3.0, 5.1], ['phLo', 4.8, 5.4], ['phHi', 5.3, 5.9], ['phDrop', 0.15, 2.0],
  ['altBreak', 400, 900], ['altSpan', 100, 900], ['altFloor', 0.3, 1.0],
  ['aspMin', 0.3, 1.0], ['aspBest', 140, 240],
  ['hostMin', 0.5, 1.0], ['hostSat', 40, 250],
  ['amp', 60, 130], // niveau global (forme multiplicative)
]
const decode = (vec) => Object.fromEntries(BOUNDS.map(([n], i) => [n, vec[i]]))

function predict(p, q, form) {
  const fPh = phFactor(p.ph, q)
  const fAlt = altFactor(p.altitude, q)
  const fAsp = aspFactor(p.orientation, q)
  const fHost = hostFactor(hostAbundance(p.essences), q)
  if (form === 'mult') return q.amp * fPh * fAlt * fAsp * fHost
  // Forme additive : chaque critère apporte/retire des points, pondéré par
  // l'amplitude observée dans les courbes de réponse.
  return 30 + 32 * fPh + 14 * fAlt + 16 * fAsp + 8 * fHost
}
const mae = (points, q, form) => points.reduce((s, p) => s + Math.abs(Math.round(predict(p, q, form)) - p.score), 0) / points.length

function optimise(points, form, { iterations = 1200, popSize = 50, seed = 1 } = {}) {
  let st = seed
  const rnd = () => ((st = (st * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  let pop = Array.from({ length: popSize }, () => BOUNDS.map(([, lo, hi]) => lo + rnd() * (hi - lo)))
  let fit = pop.map((v) => mae(points, decode(v), form))
  for (let g = 0; g < iterations; g++) {
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
      const f = mae(points, decode(trial), form)
      if (f < fit[i]) { pop[i] = trial; fit[i] = f }
    }
  }
  const best = fit.indexOf(Math.min(...fit))
  return { q: decode(pop[best]), err: fit[best] }
}

const data = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8'))
const points = data.points

const order = points.map((_, i) => i)
let s = 7
const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
for (let i = order.length - 1; i > 0; i--) {
  const j = Math.floor(r() * (i + 1))
  ;[order[i], order[j]] = [order[j], order[i]]
}

console.log(`\nFormule compacte (${BOUNDS.length} paramètres) sur ${points.length} points.\n`)
const results = {}
for (const form of ['mult', 'add']) {
  let cvSum = 0
  for (let k = 0; k < 5; k++) {
    const test = order.filter((_, i) => i % 5 === k).map((i) => points[i])
    const train = order.filter((_, i) => i % 5 !== k).map((i) => points[i])
    let best = null
    for (let sd = 0; sd < 4; sd++) {
      const res = optimise(train, form, { seed: 11 + sd * 53 })
      if (!best || res.err < best.err) best = res
    }
    cvSum += test.reduce((acc, p) => acc + Math.abs(Math.round(predict(p, best.q, form)) - p.score), 0)
  }
  let full = null
  for (let sd = 0; sd < 8; sd++) {
    const res = optimise(points, form, { seed: 101 + sd * 37 })
    if (!full || res.err < full.err) full = res
  }
  results[form] = { cv: cvSum / points.length, fit: full.err, q: full.q }
  console.log(`  ${form === 'mult' ? 'multiplicative' : 'additive     '} : ajustement ${full.err.toFixed(2)}  |  validation croisée ${(cvSum / points.length).toFixed(2)}`)
}

console.log('\n  références :')
console.log('    ancienne formule (18 paramètres) : 8.56 ajustement / 9.21 LOO-CV')
console.log('    boosting (boîte noire)           : 7.84 validation croisée')
console.log('    plancher théorique des données   : ~4.6')

const winner = results.mult.cv <= results.add.cv ? 'mult' : 'add'
console.log(`\n=== Forme retenue : ${winner === 'mult' ? 'multiplicative' : 'additive'} ===`)
for (const [k, v] of Object.entries(results[winner].q)) console.log(`  ${k.padEnd(10)} ${v.toFixed(3)}`)

writeFileSync(
  new URL('./compact-model.json', import.meta.url),
  JSON.stringify({ form: winner, ...results[winner], nPoints: points.length, date: new Date().toISOString() }, null, 1),
)
console.log('\nÉcrit dans scripts/compact-model.json')
