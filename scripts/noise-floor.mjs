#!/usr/bin/env node
// Plancher de bruit : quelle est la meilleure précision ATTEIGNABLE par
// n'importe quelle formule basée sur les seules variables affichées ?
//
// Principe : on cherche les paires de cases dont TOUTES les variables
// affichées sont quasi identiques (altitude, pH, orientation, pente,
// essences). Par construction, n'importe quelle formule prenant ces
// variables en entrée leur donnera le même score. Si le service, lui, leur
// attribue des scores très différents, cet écart est irréductible : il vient
// d'une information qu'on n'a pas.
//
//   node scripts/noise-floor.mjs
import { readFileSync } from 'node:fs'

const data = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8'))
const points = data.points

// Tolérances : de l'ordre de la précision d'affichage / d'une case voisine.
// Les essences sont comparées par agrégats (abondance d'hôtes pondérée,
// somme totale, nombre d'espèces) plutôt qu'espèce par espèce : sur une même
// zone elles ne varient que de ±1-2 points d'une case à l'autre, et exiger
// l'égalité stricte sur 22 espèces ne laissait quasiment aucune paire.
//
// Le niveau de tolérance se règle en argument (`node scripts/noise-floor.mjs
// strict`) : avec des tolérances larges on mesure aussi la variation due à
// la tolérance elle-même, ce qui gonfle le plancher estimé. Le niveau
// « strict » ne garde que des paires vraiment indiscernables à l'affichage.
const LEVELS = {
  strict: { altitude: 3, ph: 0.001, orientation: 5, pente: 1, host: 2, total: 4, count: 0 },
  moyen: { altitude: 8, ph: 0.1, orientation: 10, pente: 2, host: 4, total: 8, count: 1 },
  large: { altitude: 15, ph: 0.1, orientation: 20, pente: 4, host: 6, total: 12, count: 1 },
}
const level = process.argv[2] ?? 'large'
const TOL = LEVELS[level] ?? LEVELS.large
console.log(`\nNiveau de tolérance : ${level} → ${JSON.stringify(TOL)}`)

const HOST_APTITUDE = {
  chataignier: 1, chene_pedoncule: 1, chene_rouvre: 1, chene_tauzin: 0.9,
  chene_pubescent: 0.85, chene_chevelu: 0.85, hetre: 0.9, chene_vert: 0.5,
  noisetier: 0.35, charme: 0.3, bouleau: 0.15, merisier: 0.1,
  saule_marsault: 0.1, tremble: 0.05,
}
function essenceSummary(essences) {
  let host = 0
  let total = 0
  for (const [k, v] of Object.entries(essences)) {
    host += v * (HOST_APTITUDE[k] ?? 0)
    total += v
  }
  return { host, total, count: Object.keys(essences).length }
}

function similar(a, b) {
  if (Math.abs(a.altitude - b.altitude) > TOL.altitude) return false
  if (Math.abs(a.ph - b.ph) > TOL.ph) return false
  if (Math.abs(a.pente - b.pente) > TOL.pente) return false
  // Écart angulaire réel (l'orientation est cyclique : 350° et 10° sont
  // voisins de 20°, pas éloignés de 340°).
  let dOrient = Math.abs(a.orientation - b.orientation) % 360
  if (dOrient > 180) dOrient = 360 - dOrient
  if (dOrient > TOL.orientation) return false
  const ea = essenceSummary(a.essences)
  const eb = essenceSummary(b.essences)
  if (Math.abs(ea.host - eb.host) > TOL.host) return false
  if (Math.abs(ea.total - eb.total) > TOL.total) return false
  if (Math.abs(ea.count - eb.count) > TOL.count) return false
  return true
}

const diffs = []
const examples = []
for (let i = 0; i < points.length; i++) {
  for (let j = i + 1; j < points.length; j++) {
    if (!similar(points[i], points[j])) continue
    const d = Math.abs(points[i].score - points[j].score)
    diffs.push(d)
    if (d >= 15 && examples.length < 8) examples.push([points[i], points[j], d])
  }
}

console.log(`\n${diffs.length} paires de cases "identiques sur le papier" trouvées parmi ${points.length} points.\n`)
if (diffs.length < 10) {
  console.log('Trop peu de paires pour conclure — il faudrait plus de points ou des tolérances plus larges.')
  process.exit(0)
}

diffs.sort((a, b) => a - b)
const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length
const median = diffs[Math.floor(diffs.length / 2)]
const p90 = diffs[Math.floor(diffs.length * 0.9)]

console.log('=== Écart de score entre deux cases identiques sur toutes les variables affichées ===')
console.log(`  écart moyen   : ${mean.toFixed(2)} points`)
console.log(`  écart médian  : ${median} points`)
console.log(`  9e décile     : ${p90} points`)
console.log(`  écart maximum : ${diffs[diffs.length - 1]} points`)

// Pour deux tirages indépendants d'une même loi d'écart-type s :
//   E|X1 - X2| = 2s/sqrt(pi)  →  s = E|X1-X2| * sqrt(pi)/2
// et la meilleure erreur absolue moyenne atteignable par un prédicteur est
//   E|X - mediane| ≈ 0.8 s  (cas gaussien).
const sigma = (mean * Math.sqrt(Math.PI)) / 2
const floor = 0.8 * sigma
console.log('\n=== Conséquence ===')
console.log(`  bruit irréductible estimé (écart-type) : ${sigma.toFixed(2)} points`)
console.log(`  MEILLEURE erreur atteignable par n'importe quelle formule : ~${floor.toFixed(1)} points`)
console.log(`  notre formule actuelle                                   : 8.56 points`)
console.log(`  modèle à forte capacité (gradient boosting, val. croisée) : 7.84 points`)
console.log(
  `\n  → on est à ${(8.56 / floor).toFixed(2)}x du plancher théorique` +
    ` (le boosting à ${(7.84 / floor).toFixed(2)}x).`,
)

if (examples.length) {
  console.log('\n=== Exemples de paires identiques au score très différent ===')
  for (const [a, b, d] of examples) {
    console.log(
      `  ${d} points d'écart : ${a.score} vs ${b.score}` +
        ` | alt ${a.altitude}/${b.altitude}m, pH ${a.ph}/${b.ph}, orient ${a.orientation}/${b.orientation}°, pente ${a.pente}/${b.pente}°` +
        ` | ${a.lat.toFixed(4)},${a.lon.toFixed(4)} vs ${b.lat.toFixed(4)},${b.lon.toFixed(4)}`,
    )
  }
}
