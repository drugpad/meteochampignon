#!/usr/bin/env node
// Explore des hypothèses de STRUCTURE différentes (pas juste réoptimiser les
// mêmes paramètres) pour expliquer le score à partir des essences — rapide,
// juste des corrélations, pas un ajustement complet.
import { readFileSync } from 'node:fs'

const HOST_APTITUDE = {
  chataignier: 1, chene_pedoncule: 1, chene_rouvre: 1, chene_tauzin: 0.9,
  chene_pubescent: 0.85, chene_chevelu: 0.85, hetre: 0.9, chene_vert: 0.5,
  noisetier: 0.35, charme: 0.3, bouleau: 0.15, merisier: 0.1,
  saule_marsault: 0.1, tremble: 0.05,
}

function corr(xs, ys) {
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length
  const my = ys.reduce((a, b) => a + b, 0) / ys.length
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0)
  const den = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0))
  return num / den
}

const data = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8'))
const points = data.points
const scores = points.map((p) => p.score)

function report(name, fn) {
  const vals = points.map(fn)
  console.log(`  ${name.padEnd(45)} r=${corr(vals, scores).toFixed(3)}`)
}

console.log('\n=== Hypothèses sur comment combiner les essences ===\n')

report('Somme pondérée par aptitude (modèle actuel)', (p) => {
  let w = 0
  for (const [k, v] of Object.entries(p.essences)) w += v * (HOST_APTITUDE[k] ?? 0)
  return w
})

report('Somme brute de TOUTES les essences (sans pondération)', (p) => Object.values(p.essences).reduce((a, b) => a + b, 0))

report("Max d'une seule essence hôte pondérée (le meilleur hôte présent, pas la somme)", (p) => {
  let best = 0
  for (const [k, v] of Object.entries(p.essences)) best = Math.max(best, v * (HOST_APTITUDE[k] ?? 0))
  return best
})

report('Ratio hôtes-pondérés / somme totale (dominance relative, pas absolue)', (p) => {
  let w = 0, tot = 0
  for (const [k, v] of Object.entries(p.essences)) { w += v * (HOST_APTITUDE[k] ?? 0); tot += v }
  return tot > 0 ? w / tot : 0
})

report('% de châtaignier seul', (p) => p.essences.chataignier ?? 0)
report('% de chêne pédonculé seul', (p) => p.essences.chene_pedoncule ?? 0)
report('% de chêne pubescent seul', (p) => p.essences.chene_pubescent ?? 0)
report('% de hêtre seul', (p) => p.essences.hetre ?? 0)
report('% de chêne rouvre seul', (p) => p.essences.chene_rouvre ?? 0)
report('Présence de châtaignier (0/1, seuil 5%)', (p) => ((p.essences.chataignier ?? 0) >= 5 ? 1 : 0))
report('Nombre total d’essences différentes recensées', (p) => Object.keys(p.essences).length)
report('Nombre d’essences hôtes (aptitude>0.5) présentes à >5%', (p) =>
  Object.entries(p.essences).filter(([k, v]) => (HOST_APTITUDE[k] ?? 0) > 0.5 && v >= 5).length,
)

console.log('\n=== Pour comparaison : critères de terrain seuls ===\n')
report('Altitude', (p) => p.altitude)
report('pH', (p) => p.ph)
report('Pente', (p) => p.pente)
report('cos(orientation)', (p) => Math.cos((p.orientation * Math.PI) / 180))
