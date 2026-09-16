#!/usr/bin/env node
// Rejoue notre formule de score sur les 20 points de calibration
// (scripts/calibration-dataset.json) en utilisant LEURS valeurs d'entrée —
// ce qui isole la pondération comme seule différence possible.
//
//   node scripts/merge-calibration.mjs && node scripts/compare-calibration.mjs
import { readFileSync } from 'node:fs'

// Aptitude de chaque essence à porter le cèpe d'été (Boletus aestivalis),
// mycorhizien : chêne et châtaignier en tête, hêtre juste derrière, aucun
// résineux.
const HOST_APTITUDE = {
  chataignier: 1,
  chene_pedoncule: 1,
  chene_rouvre: 1,
  chene_tauzin: 0.9,
  chene_pubescent: 0.85,
  chene_chevelu: 0.85,
  hetre: 0.9,
  chene_vert: 0.5,
  noisetier: 0.35,
  charme: 0.3,
  bouleau: 0.15,
  merisier: 0.1,
  saule_marsault: 0.1,
  tremble: 0.05,
}

function plateau(value, lowKo, lowOk, highOk, highKo) {
  if (value <= lowKo || value >= highKo) return 0
  if (value < lowOk) return (value - lowKo) / (lowOk - lowKo)
  if (value > highOk) return (highKo - value) / (highKo - highOk)
  return 1
}

// Abondance d'essences hôtes, en valeur absolue (somme des "rpp" pondérés
// par l'aptitude) et non en part relative — voir scripts/fit-model.mjs.
function hostAbundance(essences) {
  let weighted = 0
  for (const [nom, pct] of Object.entries(essences)) weighted += pct * (HOST_APTITUDE[nom] ?? 0)
  return weighted
}

// Paramètres trouvés par évolution différentielle sur les 42 points de
// calibration, meilleure graine sur 40 essais (scripts/optimize-search.mjs,
// 10/09/2026) — remplace les valeurs choisies à la main. Validés par
// LOO-CV : erreur d'ajustement 4.2, erreur en validation croisée 6.6 (points
// jamais vus par l'optimiseur pendant leur propre ajustement) — écart faible
// entre les deux, donc régularité réelle, pas du bruit mémorisé
// (contrairement à la tentative sur 20 points, qui donnait 3.4 vs 11.3 : du
// sur-apprentissage pur). Les 40 graines convergent presque toutes vers les
// mêmes valeurs (orientation optimale ~178°, plateau altitude ~275-590m,
// pH ~4.1-5.5) : signe que ce n'est pas un optimum local isolé. Pour
// retrouver/affiner ces valeurs avec plus de points :
// node scripts/optimize-search.mjs [nombreDeGraines]
const Q = {
  altLowOk: 275.01,
  altHighOk: 592.36,
  altKo: 1422.67,
  phLowOk: 4.12,
  phHighOk: 5.5,
  phKo: 6.29,
  penLowOk: 19.94,
  penHighOk: 36.08,
  penKo: 86.03,
  aspMin: 0.64,
  aspBest: 177.67,
  hostSat: 185.89,
  hostPow: 0.12,
  wAlt: 0.51,
  wExp: 0.56,
  wPen: 0.07,
  wPh: 0.4,
  floor: 0.07,
}

export function scoreCepeEte({ altitude, pente, orientation, ph, essences }) {
  const criteria = {
    altitude: plateau(altitude, 0, Q.altLowOk, Q.altHighOk, Q.altKo),
    exposition: Q.aspMin + (1 - Q.aspMin) * ((Math.cos(((orientation - Q.aspBest) * Math.PI) / 180) + 1) / 2),
    pente: plateau(pente, 0, Q.penLowOk, Q.penHighOk, Q.penKo),
    ph: plateau(ph, 3.5, Q.phLowOk, Q.phHighOk, Q.phKo),
  }
  const weights = { altitude: Q.wAlt, exposition: Q.wExp, pente: Q.wPen, ph: Q.wPh }

  // Moyenne géométrique pondérée (loi du minimum de Liebig) — voir
  // l'historique de cette approche dans git blame, la justification n'a pas
  // changé avec le passage aux paramètres ajustés.
  const terrain = Object.entries(criteria).reduce(
    (product, [k, v]) => product * Math.pow(Math.max(Q.floor, v), weights[k]),
    1,
  )

  const hostFactor = Math.pow(Math.min(1, hostAbundance(essences) / Q.hostSat), Q.hostPow)

  return { score: Math.round(100 * hostFactor * terrain), hostFactor, criteria, terrain }
}

const data = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8'))
const rows = data.points.map((p) => ({ p, r: scoreCepeEte(p) })).sort((a, b) => a.p.score - b.p.score)

console.log(`\nEspèce : ${data.espece} — ${rows.length} points\n`)
console.log('  eux  nous  écart | pente orient  alt    pH   hôtes')
console.log('─'.repeat(60))
let sumAbs = 0
for (const { p, r } of rows) {
  const diff = r.score - p.score
  sumAbs += Math.abs(diff)
  console.log(
    `  ${String(p.score).padStart(3)}  ${String(r.score).padStart(4)}  ${(diff > 0 ? `+${diff}` : `${diff}`).padStart(5)} |` +
      ` ${String(p.pente).padStart(4)}° ${String(p.orientation).padStart(5)}° ${String(p.altitude).padStart(5)}m ${String(p.ph).padStart(4)}` +
      `  ${(r.hostFactor * 100).toFixed(0).padStart(3)}%`,
  )
}
// Corrélation entre nos scores et les leurs : mesure si on classe les
// terrains dans le même ordre, indépendamment de l'échelle.
const a = rows.map((x) => x.p.score)
const b = rows.map((x) => x.r.score)
const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length
const [ma, mb] = [mean(a), mean(b)]
const corr =
  a.map((v, i) => (v - ma) * (b[i] - mb)).reduce((s, v) => s + v, 0) /
  (Math.sqrt(a.map((v) => (v - ma) ** 2).reduce((s, v) => s + v, 0)) *
    Math.sqrt(b.map((v) => (v - mb) ** 2).reduce((s, v) => s + v, 0)))
console.log('─'.repeat(60))
console.log(`écart moyen : ${(sumAbs / rows.length).toFixed(1)} points | corrélation des classements : ${corr.toFixed(2)}\n`)
