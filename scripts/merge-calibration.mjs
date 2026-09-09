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

const out = { espece: base.espece, releve: '2026-09-09', points }
writeFileSync(new URL('./calibration-dataset.json', import.meta.url), JSON.stringify(out, null, 1))
console.log(`${points.length} points fusionnés dans scripts/calibration-dataset.json`)
