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

// Abondance d'essences hôtes, en valeur absolue (somme des "rpp" pondérés
// par l'aptitude) et non en part relative.
function hostAbundance(essences) {
  let weighted = 0
  for (const [nom, pct] of Object.entries(essences)) weighted += pct * (HOST_APTITUDE[nom] ?? 0)
  return weighted
}

// Paramètres ajustés sur 222 points (scripts/fit-compact.mjs, 17/09/2026),
// validation croisée 5 blocs : 8.11 en ajustement, 8.73 en validation —
// contre 8.56 / 9.21 pour la version précédente, avec 12 paramètres au lieu
// de 18.
//
// Cette version corrige trois erreurs de la précédente, mises en évidence en
// extrayant les courbes de réponse réelles des données au lieu de les
// supposer (scripts/response-curves.mjs) :
//
//   1. le pH n'a PAS un large plateau favorable de 4.15 à 5.5 : son optimum
//      est étroit (~5.4-5.5) et il s'effondre au-delà — c'est de loin le
//      facteur dominant (28 points d'amplitude sur 100) ;
//   2. l'altitude est neutre jusqu'à ~670 m puis décroche, au lieu de
//      décliner progressivement dès 600 m ;
//   3. la pente n'a quasiment aucun effet (4.6 points d'amplitude) : elle
//      est retirée du modèle, alors qu'elle y pesait auparavant. L'effet des
//      essences est lui aussi bien plus faible qu'on ne le croyait (2.4
//      points) : le facteur est conservé mais son influence est plafonnée.
//
// Limite connue, mesurée : deux cases strictement indiscernables sur toutes
// les valeurs affichées par le service de référence diffèrent quand même de
// 6.5 points de score en moyenne (scripts/noise-floor.mjs). Aucune formule
// fondée sur ces seules variables ne peut donc descendre sous ~4.6 points
// d'erreur : il leur reste une information à haute résolution qu'on ne voit
// pas (probablement la structure réelle du couvert forestier, type LiDAR).
const Q = {
  phAcidKo: 3.087,
  phLo: 5.399,
  phHi: 5.501,
  phDrop: 1.097,
  altBreak: 670.1,
  altSpan: 714.5,
  altFloor: 0.376,
  aspMin: 0.833,
  aspBest: 177.07,
  hostMin: 0.765,
  hostSat: 40.17,
  amp: 79.8,
}

export function scoreCepeEte({ altitude, orientation, ph, essences }) {
  // pH : montée depuis le seuil acide, optimum étroit, puis chute.
  const fPh =
    ph < Q.phLo
      ? Math.max(0, (ph - Q.phAcidKo) / (Q.phLo - Q.phAcidKo))
      : ph <= Q.phHi
        ? 1
        : Math.max(0, 1 - (ph - Q.phHi) / Q.phDrop)

  // Altitude : neutre jusqu'au décrochage, puis descente vers un plancher.
  const fAlt =
    altitude <= Q.altBreak
      ? 1
      : Math.max(Q.altFloor, 1 - ((altitude - Q.altBreak) / Q.altSpan) * (1 - Q.altFloor))

  const fExpo = Q.aspMin + (1 - Q.aspMin) * ((Math.cos(((orientation - Q.aspBest) * Math.PI) / 180) + 1) / 2)
  const fHost = Q.hostMin + (1 - Q.hostMin) * Math.min(1, hostAbundance(essences) / Q.hostSat)

  const criteria = { ph: fPh, altitude: fAlt, exposition: fExpo }
  return { score: Math.round(Q.amp * fPh * fAlt * fExpo * fHost), hostFactor: fHost, criteria, terrain: fPh * fAlt * fExpo }
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
