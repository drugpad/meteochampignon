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
// par l'aptitude) et non en part relative. Les 20 points de calibration sont
// clairs là-dessus : la somme des hôtes est corrélée au score (0.39) alors
// que leur *part* dans le peuplement ne l'est pas (-0.15). Autrement dit,
// c'est la quantité de chênes/châtaigniers qui compte, pas le fait qu'ils
// soient majoritaires — une forêt riche et mélangée vaut mieux qu'une
// pauvre monospécifique.
function hostAbundance(essences) {
  let weighted = 0
  for (const [nom, pct] of Object.entries(essences)) weighted += pct * (HOST_APTITUDE[nom] ?? 0)
  return weighted
}

// Le cèpe d'été est le plus thermophile des cèpes : versants chauds
// favorisés, mais l'effet reste modéré (corrélation 0.27).
function aspectScore(aspectDeg) {
  return 0.2 + 0.8 * ((Math.cos(((aspectDeg - 180) * Math.PI) / 180) + 1) / 2)
}

// Plancher appliqué à chaque critère : même le pire terrain garde une chance
// résiduelle, et ça évite qu'un seul critère à zéro annule tout le reste.
const CRITERION_FLOOR = 0.05

export function scoreCepeEte({ altitude, pente, orientation, ph, essences }) {
  const criteria = {
    // Espèce thermophile de plaine et moyenne montagne : au-delà de ~1000m
    // elle cède la place au cèpe de Bordeaux. Le point à 1366m (score 23
    // chez eux, malgré une hêtraie dense et un pH favorable) confirme la
    // chute.
    altitude: plateau(altitude, 0, 150, 700, 1000),
    exposition: aspectScore(orientation),
    // Une pente franche draine bien, mais l'effet est faible une fois qu'on
    // regarde des terrains variés (corrélation 0.34, et un point plat à
    // 74/100 chez eux). Poids volontairement marginal.
    pente: plateau(pente, 0, 8, 35, 65),
    // Critère le plus discriminant du jeu (-0.61) : les bolets sont des
    // champignons de sols acides. Au-delà de pH 6 (calcaire), ça s'effondre.
    ph: plateau(ph, 3.5, 4.2, 5.5, 6.4),
  }
  const weights = { altitude: 0.4, exposition: 0.3, pente: 0.05, ph: 0.4 }

  // Moyenne géométrique pondérée, et non somme pondérée : c'est la loi du
  // minimum de Liebig — le facteur le plus défavorable limite le résultat,
  // il ne se compense pas par les autres. Une somme pondérée donnait 69 à
  // la hêtraie de 1366m (eux : 23), parce que le bon pH et les bonnes
  // essences rattrapaient l'altitude rédhibitoire. En multiplicatif, ce même
  // point tombe à 26. Le passage d'une structure à l'autre a fait chuter
  // l'écart moyen de 10.6 à 7.2 points sur les 20 points de calibration.
  const terrain = Object.entries(criteria).reduce(
    (product, [k, v]) => product * Math.pow(Math.max(CRITERION_FLOOR, v), weights[k]),
    1,
  )

  // L'abondance d'hôtes agit elle aussi en multiplicateur : sans arbre
  // compatible, pas de cèpe quel que soit le terrain. Exposant 0.3 : la
  // courbe monte vite puis sature — passer de 0 à 40 de chênes change tout,
  // de 100 à 150 presque rien.
  const hostFactor = Math.pow(Math.min(1, hostAbundance(essences) / 150), 0.3)

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
