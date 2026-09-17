#!/usr/bin/env node
// Composition satellite MULTI-DATES, au lieu d'une image unique.
//
// Une image isolée est bruitée (angle solaire, ombres de relief, humidité du
// jour, date exacte du passage). Un vrai produit utilise une composition
// saisonnière, et surtout des variables que seule une série temporelle
// révèle :
//   - NDVI d'hiver  : un feuillu perd ses feuilles, un résineux non — c'est
//     LE moyen de distinguer les deux depuis l'espace ;
//   - amplitude saisonnière (été - hiver) : mesure la part de feuillus et la
//     vigueur du peuplement ;
//   - NDVI de printemps : vitesse de débourrement, liée à la maturité et à
//     l'exposition du peuplement.
//
// C'est le type d'information qui varie à 10-30 m, exactement l'échelle de
// ce qui nous manque (scripts/residual-autocorr.mjs).
//
//   node scripts/sentinel-multidate.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { fromUrl } from 'geotiff'
import proj4 from 'proj4'

const SAISONS = [
  ['hiver', '2026-01-05T00:00:00Z/2026-03-05T00:00:00Z'],
  ['printemps', '2026-04-10T00:00:00Z/2026-05-31T00:00:00Z'],
  ['ete', '2026-07-01T00:00:00Z/2026-09-15T00:00:00Z'],
]

const points = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8')).points

const sceneCache = new Map()
const imageCache = new Map()

async function sceneNear(lat, lon, datetime, saison) {
  const key = `${saison}|${Math.round(lat * 5)}_${Math.round(lon * 5)}`
  if (sceneCache.has(key)) return sceneCache.get(key)
  const res = await fetch('https://earth-search.aws.element84.com/v1/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      collections: ['sentinel-2-l2a'],
      intersects: { type: 'Point', coordinates: [lon, lat] },
      datetime,
      query: { 'eo:cloud_cover': { lt: 15 } },
      limit: 1,
      sortby: [{ field: 'properties.eo:cloud_cover', direction: 'asc' }],
    }),
  })
  const json = await res.json().catch(() => ({}))
  const scene = json.features?.[0] ?? null
  sceneCache.set(key, scene)
  return scene
}

async function bandImage(scene, band) {
  const key = `${scene.id}|${band}`
  if (!imageCache.has(key)) {
    const href = scene.assets[band]?.href
    if (!href) return null
    imageCache.set(key, await (await fromUrl(href)).getImage())
  }
  return imageCache.get(key)
}

async function ndviAt(scene, lat, lon, half = 1) {
  const read = async (band) => {
    const img = await bandImage(scene, band)
    if (!img) return NaN
    const epsg = scene.properties['proj:epsg'] ?? scene.properties['proj:code']?.split(':').pop()
    const [x, y] = proj4('EPSG:4326', `+proj=utm +zone=${String(epsg).slice(-2)} +datum=WGS84 +units=m +no_defs`, [lon, lat])
    const [rx, ry] = img.getResolution()
    const px = Math.round((x - img.getOrigin()[0]) / rx)
    const py = Math.round((y - img.getOrigin()[1]) / ry)
    const raster = await img.readRasters({ window: [px - half, py - half, px + half + 1, py + half + 1], interleave: true })
    const vals = Array.from(raster).filter((v) => v > 0)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN
  }
  const [rouge, pir] = await Promise.all([read('red'), read('nir')])
  return (pir - rouge) / (pir + rouge)
}

const rows = points.map((p) => ({ ...p }))
for (const [saison, datetime] of SAISONS) {
  let ok = 0
  for (const [i, r] of rows.entries()) {
    try {
      const scene = await sceneNear(r.lat, r.lon, datetime, saison)
      r[`ndvi_${saison}`] = scene ? await ndviAt(scene, r.lat, r.lon) : NaN
      if (Number.isFinite(r[`ndvi_${saison}`])) ok++
    } catch {
      r[`ndvi_${saison}`] = NaN
    }
    process.stdout.write(`\r  ${saison} : ${i + 1}/${rows.length} (${ok} ok)   `)
  }
  console.log('')
}

// Variables dérivées de la série temporelle.
for (const r of rows) {
  r.ndvi_amplitude = r.ndvi_ete - r.ndvi_hiver // part de feuillus / vigueur
  r.ndvi_printemps_ecart = r.ndvi_printemps - r.ndvi_hiver // débourrement
}

writeFileSync(new URL('./sentinel-multidate.json', import.meta.url), JSON.stringify(rows, null, 1))

function pearson(xs, ys) {
  const ok = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
  if (ok.length < 10) return NaN
  const a = ok.map((o) => o[0])
  const b = ok.map((o) => o[1])
  const ma = a.reduce((s, v) => s + v, 0) / a.length
  const mb = b.reduce((s, v) => s + v, 0) / b.length
  const num = a.reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0)
  const den = Math.sqrt(a.reduce((s, v) => s + (v - ma) ** 2, 0) * b.reduce((s, v) => s + (v - mb) ** 2, 0))
  return num / den
}

const scores = rows.map((r) => r.score)
console.log('\n=== Corrélation avec leur score ===')
for (const k of ['ndvi_hiver', 'ndvi_printemps', 'ndvi_ete', 'ndvi_amplitude', 'ndvi_printemps_ecart']) {
  const n = rows.filter((r) => Number.isFinite(r[k])).length
  console.log(`  ${k.padEnd(22)} r=${pearson(rows.map((r) => r[k]), scores).toFixed(3)}   (${n} points)`)
}
console.log('\nÉcrit dans scripts/sentinel-multidate.json')
