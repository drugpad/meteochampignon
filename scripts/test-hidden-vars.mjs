#!/usr/bin/env node
// Cherche la variable cachée. Terrain d'expérience : le cluster de cases
// voisines (scripts/diagnose-ceiling.mjs montre que leur score y varie de
// 53 à 77 alors qu'AUCUNE des 5 variables affichées par le service ne
// corrèle avec cette variation — donc l'information manquante agit à
// l'échelle fine, à l'intérieur d'une même zone).
//
// Variables testées, toutes invisibles sur leur interface :
//   - couvert forestier réel de la case (BD Forêt V2 IGN, précision
//     parcellaire) : forêt fermée / ouverte / lande / autre. Leurs
//     "essences" viennent d'une grille à ~1 km, qui dit quelles espèces
//     existent dans la région, pas si CETTE case est réellement boisée.
//   - courbure du terrain (MNT IGN 1-5 m) : une cuvette concave retient
//     l'humidité, une croupe convexe la perd. Classique en mycologie, et
//     absent de leur affichage (qui ne montre que pente + orientation).
//   - position topographique (TPI) : fond de vallon vs mi-pente vs crête.
//
//   node scripts/test-hidden-vars.mjs [--all]
import { readFileSync, writeFileSync } from 'node:fs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Grille 5x5 de 20 m autour du point sur le MNT fin IGN, en un seul appel.
async function fetchElevationGrid(lat, lon, step = 20, half = 2) {
  const dLat = step / 111320
  const dLon = step / (111320 * Math.cos((lat * Math.PI) / 180))
  const lats = []
  const lons = []
  for (let i = -half; i <= half; i++) {
    for (let j = -half; j <= half; j++) {
      lats.push((lat + i * dLat).toFixed(6))
      lons.push((lon + j * dLon).toFixed(6))
    }
  }
  const url =
    `https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json` +
    `?lon=${lons.join('|')}&lat=${lats.join('|')}&resource=ign_rge_alti_wld&delimiter=|`
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
      if (!res.ok) throw new Error(`RGE ALTI ${res.status}`)
      const data = await res.json()
      return data.elevations.map((e) => e.z)
    } catch (err) {
      if (attempt === 2) return null
      await sleep(1500)
    }
  }
}

// À partir de la grille 5x5 (indices i=sud→nord, j=ouest→est) :
// courbure (laplacien), position topographique, pente/orientation fines.
function terrainDerivatives(z, step = 20) {
  const n = 5
  const at = (i, j) => z[(i + 2) * n + (j + 2)] // i,j dans [-2..2]
  const center = at(0, 0)

  // Laplacien discret sur les 4 voisins immédiats : >0 = cuvette (concave,
  // le terrain remonte autour), <0 = croupe (convexe).
  const laplacian = (at(0, 1) + at(0, -1) + at(1, 0) + at(-1, 0) - 4 * center) / (step * step)

  // Position topographique : altitude du centre - moyenne de l'anneau
  // extérieur (rayon 40 m). Négatif = en creux, positif = en relief.
  const ring = []
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) if (Math.abs(i) === 2 || Math.abs(j) === 2) ring.push(at(i, j))
  const tpi = center - ring.reduce((a, b) => a + b, 0) / ring.length

  const dzdx = (at(1, 1) + 2 * at(0, 1) + at(-1, 1) - (at(1, -1) + 2 * at(0, -1) + at(-1, -1))) / (8 * step)
  const dzdy = (at(1, -1) + 2 * at(1, 0) + at(1, 1) - (at(-1, -1) + 2 * at(-1, 0) + at(-1, 1))) / (8 * step)

  return {
    altitudeFine: center,
    courbure: laplacian * 1e4, // remis à une échelle lisible
    tpi,
    penteFine: (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI,
    orientationFine: ((Math.atan2(-dzdx, -dzdy) * 180) / Math.PI + 360) % 360,
    // Rugosité locale : écart-type des 25 altitudes. Un terrain chaotique
    // (blocs, ravines) n'est pas le même milieu qu'une pente lisse.
    rugosite: Math.sqrt(z.reduce((s, v) => s + (v - z.reduce((a, b) => a + b, 0) / z.length) ** 2, 0) / z.length),
  }
}

// Type de formation végétale au point (BD Forêt V2, IGN) — la donnée
// "quelle forêt y a-t-il réellement ici", à la parcelle.
async function fetchForestV2(lat, lon) {
  const m = 0.0002 // ~20 m, la taille d'une de leurs cases
  const bbox = `${lat - m},${lon - m},${lat + m},${lon + m},urn:ogc:def:crs:EPSG::4326`
  const url =
    `https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature` +
    `&TYPENAMES=LANDCOVER.FORESTINVENTORY.V2:formation_vegetale` +
    `&BBOX=${bbox}&COUNT=1&OUTPUTFORMAT=application/json`
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
      if (!res.ok) throw new Error(`BD Forêt V2 ${res.status}`)
      const data = await res.json()
      return data.features?.[0]?.properties ?? null
    } catch (err) {
      if (attempt === 2) return null
      await sleep(1500)
    }
  }
}

const data = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8'))
const all = process.argv.includes('--all')
const targets = all
  ? data.points
  : data.points.filter((p) => p.lat > 43.1 && p.lat < 43.103 && p.lon > 0.213 && p.lon < 0.216)

console.log(`\n${targets.length} points à enrichir (${all ? 'tout le jeu' : 'cluster de cases voisines'})…\n`)

const enriched = []
for (const [i, p] of targets.entries()) {
  const z = await fetchElevationGrid(p.lat, p.lon)
  const forest = await fetchForestV2(p.lat, p.lon)
  const deriv = z && z.every((v) => typeof v === 'number' && v > -1000) ? terrainDerivatives(z) : null
  enriched.push({ ...p, ...(deriv ?? {}), foret: forest?.tfv ?? forest?.TFV ?? null, foretProps: i === 0 ? forest : undefined })
  process.stdout.write(`\r  ${i + 1}/${targets.length}`)
  await sleep(400)
}
console.log('\n')

if (enriched[0]?.foretProps) {
  console.log('Champs disponibles dans BD Forêt V2 (premier point) :')
  console.log(' ', JSON.stringify(enriched[0].foretProps))
  console.log('')
}

writeFileSync(
  new URL(all ? './enriched-all.json' : './enriched-cluster.json', import.meta.url),
  JSON.stringify(enriched.map(({ foretProps, ...rest }) => rest), null, 1),
)

function pearson(xs, ys) {
  const ok = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
  if (ok.length < 4) return NaN
  const a = ok.map((o) => o[0])
  const b = ok.map((o) => o[1])
  const ma = a.reduce((s, v) => s + v, 0) / a.length
  const mb = b.reduce((s, v) => s + v, 0) / b.length
  const num = a.reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0)
  const den = Math.sqrt(a.reduce((s, v) => s + (v - ma) ** 2, 0) * b.reduce((s, v) => s + (v - mb) ** 2, 0))
  return num / den
}

const scores = enriched.map((p) => p.score)
console.log('=== Corrélation des NOUVELLES variables avec leur score ===')
for (const key of ['courbure', 'tpi', 'penteFine', 'rugosite', 'altitudeFine']) {
  const r = pearson(enriched.map((p) => p[key]), scores)
  console.log(`  ${key.padEnd(16)} r=${Number.isFinite(r) ? r.toFixed(3) : 'n/a'}`)
}
const rOrientFine = pearson(enriched.map((p) => Math.cos((p.orientationFine * Math.PI) / 180)), scores)
console.log(`  cos(orient. fine) r=${Number.isFinite(rOrientFine) ? rOrientFine.toFixed(3) : 'n/a'}`)

console.log('\n=== Couvert forestier réel (BD Forêt V2) vs leur score ===')
const byForest = {}
for (const p of enriched) (byForest[p.foret ?? 'hors forêt / pas de donnée'] ??= []).push(p.score)
for (const [k, v] of Object.entries(byForest).sort((a, b) => b[1].length - a[1].length)) {
  const moy = v.reduce((a, b) => a + b, 0) / v.length
  console.log(`  ${String(k).slice(0, 58).padEnd(60)} n=${String(v.length).padStart(3)}  score moyen=${moy.toFixed(1)}`)
}
