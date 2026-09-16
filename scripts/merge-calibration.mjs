#!/usr/bin/env node
// Fusionne les deux sources de points de calibration en un seul jeu
// normalisé (scripts/calibration-dataset.json) :
//   - calibration-points.json  : relevés à la main depuis des captures
//   - calibration-releves.jsonl: relevés extraits automatiquement du panneau
// Les noms d'essences diffèrent entre les deux (clés sans accent d'un côté,
// libellés d'affichage de l'autre) — c'est ici qu'on les réconcilie.
import { readFileSync, writeFileSync } from 'node:fs'

const NORM = {
  'châtaignier': 'chataignier',
  'hêtre commun': 'hetre',
  'chêne pédonculé': 'chene_pedoncule',
  'chêne rouvre': 'chene_rouvre',
  'chêne pubescent': 'chene_pubescent',
  'chêne tauzin': 'chene_tauzin',
  'chêne vert': 'chene_vert',
  'chêne chevelu': 'chene_chevelu',
  'frêne commun': 'frene',
  'frêne orne': 'frene_orne',
  'bouleau verruqueux': 'bouleau',
  'saule marsault': 'saule_marsault',
  'épicéa commun': 'epicea',
  'épicéa de sitka': 'epicea_sitka',
  'merisier': 'merisier',
  'tremble': 'tremble',
  'pin noir': 'pin_noir',
  'pin sylvestre': 'pin_sylvestre',
  'pin maritime': 'pin_maritime',
  'pin mugo': 'pin_mugo',
  'aulne glutineux': 'aulne',
  'noisetier': 'noisetier',
  'robinier faux-acacia': 'robinier',
  'sapin blanc': 'sapin_blanc',
  'sapin de douglas': 'douglas',
  'érable champêtre': 'erable',
  'érable sycomore': 'erable_sycomore',
  'charme commun': 'charme',
  'tilleul': 'tilleul',
  'sorbier des oiseaux': 'sorbier',
}

function normEssences(essences) {
  const out = {}
  for (const [k, v] of Object.entries(essences)) {
    const key = NORM[k] ?? k
    out[key] = v
  }
  return out
}

const base = JSON.parse(readFileSync(new URL('./calibration-points.json', import.meta.url), 'utf8'))
const points = base.points.map((p) => ({ ...p, essences: normEssences(p.essences), source: 'capture' }))

const lines = readFileSync(new URL('./calibration-releves.jsonl', import.meta.url), 'utf8')
  .split('\n')
  .filter((l) => l.trim())
for (const line of lines) {
  const r = JSON.parse(line)
  const [lat, lon] = r.coords.split(',').map((s) => Number(s.trim()))
  points.push({
    lat,
    lon,
    score: r.score,
    libelle: r.libelle,
    altitude: r.altitude,
    ph: r.ph,
    orientation: r.orientation,
    pente: r.pente,
    essences: normEssences(r.essences),
    source: 'releve',
  })
}

// Troisième source : séries d'échantillonnage contrôlé (ring orientation,
// transect altitude, contraste pH, plantations résineuses), relevées le
// 10/09/2026 — déjà au format {lat, lon, score, altitude, ph, orientation,
// pente, essences} avec libellés français, seule la normalisation des
// essences est nécessaire.
const lines2 = readFileSync(new URL('./calibration-releves-2.jsonl', import.meta.url), 'utf8')
  .split('\n')
  .filter((l) => l.trim())
for (const line of lines2) {
  const r = JSON.parse(line)
  points.push({
    lat: r.lat,
    lon: r.lon,
    score: r.score,
    altitude: r.altitude,
    ph: r.ph,
    orientation: r.orientation,
    pente: r.pente,
    essences: normEssences(r.essences),
    source: `serie-${r.serie}`,
  })
}

// Quatrième source : 21 points pris au hasard sur toute la région (pas une
// série ciblée), capturés automatiquement via l'observateur DOM installé
// dans la page (scripts non applicable ici, capture faite en direct dans le
// navigateur) — même format que la source 3.
const lines3 = readFileSync(new URL('./calibration-releves-3.jsonl', import.meta.url), 'utf8')
  .split('\n')
  .filter((l) => l.trim())
for (const line of lines3) {
  const r = JSON.parse(line)
  points.push({
    lat: r.lat,
    lon: r.lon,
    score: r.score,
    altitude: r.altitude,
    ph: r.ph,
    orientation: r.orientation,
    pente: r.pente,
    essences: normEssences(r.essences),
    source: 'aleatoire',
  })
}

// Cinquième source : 91 points capturés le 16/09/2026 via clics rapides +
// observateur DOM (mêmes clés que la source 4).
const lines4 = readFileSync(new URL('./calibration-releves-4.jsonl', import.meta.url), 'utf8')
  .split('\n')
  .filter((l) => l.trim())
for (const line of lines4) {
  const r = JSON.parse(line)
  points.push({
    lat: r.lat,
    lon: r.lon,
    score: r.score,
    altitude: r.altitude,
    ph: r.ph,
    orientation: r.orientation,
    pente: r.pente,
    essences: normEssences(r.essences),
    source: 'aleatoire2',
  })
}

// Sixième source : cluster de points voisins (16/09/2026) pour isoler
// l'effet du terrain seul (essences quasi constantes sur une petite zone).
const lines5 = readFileSync(new URL('./calibration-releves-5.jsonl', import.meta.url), 'utf8')
  .split('\n')
  .filter((l) => l.trim())
for (const line of lines5) {
  const r = JSON.parse(line)
  points.push({
    lat: r.lat,
    lon: r.lon,
    score: r.score,
    altitude: r.altitude,
    ph: r.ph,
    orientation: r.orientation,
    pente: r.pente,
    essences: normEssences(r.essences),
    source: 'cluster',
  })
}

// Déduplication : deux clics peuvent tomber sur la même case interne (même
// score + mêmes essences + même terrain) malgré des coordonnées affichées
// différentes — repéré en pratique (16/09/2026, clic répété par erreur sur
// la même case). Un doublon exact ne serait pas un "point jamais vu"
// pendant la validation croisée, donc fausserait l'estimation.
const seenKeys = new Set()
const deduped = []
for (const p of points) {
  const key = JSON.stringify([p.score, p.altitude, p.ph, p.orientation, p.pente, p.essences])
  if (seenKeys.has(key)) continue
  seenKeys.add(key)
  deduped.push(p)
}
const nDupes = points.length - deduped.length

const out = { espece: base.espece, releve: '2026-09-16', points: deduped }
writeFileSync(new URL('./calibration-dataset.json', import.meta.url), JSON.stringify(out, null, 1))
console.log(`${points.length} points bruts, ${nDupes} doublons exacts retirés → ${deduped.length} points dans scripts/calibration-dataset.json`)
