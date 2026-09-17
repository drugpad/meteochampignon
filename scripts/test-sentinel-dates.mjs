#!/usr/bin/env node
// Sur quelle IMAGE leur carte est-elle calée ?
//
// Sentinel-2 repasse tous les 5 jours : le service peut donc rafraîchir sa
// couche biotope régulièrement. Si son score dérive d'une image (ou d'une
// composition) d'une année donnée, alors le NDVI de CETTE année doit mieux
// corréler avec le score que celui des autres années. On compare donc
// plusieurs millésimes d'été, et aussi plusieurs saisons — le pic de
// corrélation désigne leur source.
//
// Terrain d'essai : le cluster de cases voisines, où toutes les variables
// qu'ils affichent sont constantes et où seul le satellite corrèle
// (scripts/test-sentinel.mjs : NDVI r=-0.55).
//
//   node scripts/test-sentinel-dates.mjs
import { readFileSync } from 'node:fs'
import { fromUrl } from 'geotiff'
import proj4 from 'proj4'

const PERIODES = [
  ['été 2019', '2019-06-15T00:00:00Z/2019-09-15T00:00:00Z'],
  ['été 2021', '2021-06-15T00:00:00Z/2021-09-15T00:00:00Z'],
  ['été 2023', '2023-06-15T00:00:00Z/2023-09-15T00:00:00Z'],
  ['été 2025', '2025-06-15T00:00:00Z/2025-09-15T00:00:00Z'],
  ['printemps 2025', '2025-04-01T00:00:00Z/2025-05-31T00:00:00Z'],
  ['automne 2024', '2024-10-01T00:00:00Z/2024-11-15T00:00:00Z'],
  ['hiver 2025', '2025-01-05T00:00:00Z/2025-02-28T00:00:00Z'],
]

const data = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8'))
const targets = data.points.filter((p) => p.lat > 43.1 && p.lat < 43.103 && p.lon > 0.213 && p.lon < 0.216)
const scores = targets.map((p) => p.score)
const lats = targets.map((p) => p.lat)
const lons = targets.map((p) => p.lon)
const bbox = [Math.min(...lons) - 0.02, Math.min(...lats) - 0.02, Math.max(...lons) + 0.02, Math.max(...lats) + 0.02]

async function findScene(datetime) {
  const res = await fetch('https://earth-search.aws.element84.com/v1/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      collections: ['sentinel-2-l2a'],
      bbox,
      datetime,
      query: { 'eo:cloud_cover': { lt: 12 } },
      limit: 1,
      sortby: [{ field: 'properties.eo:cloud_cover', direction: 'asc' }],
    }),
  })
  const json = await res.json()
  return json.features?.[0] ?? null
}

const cache = new Map()
async function bandImage(scene, band) {
  const key = `${scene.id}|${band}`
  if (!cache.has(key)) {
    const tiff = await fromUrl(scene.assets[band].href)
    cache.set(key, await tiff.getImage())
  }
  return cache.get(key)
}
async function meanAround(scene, band, lat, lon, half = 1) {
  const img = await bandImage(scene, band)
  const epsg = scene.properties['proj:epsg'] ?? scene.properties['proj:code']?.split(':').pop()
  const [x, y] = proj4('EPSG:4326', `+proj=utm +zone=${String(epsg).slice(-2)} +datum=WGS84 +units=m +no_defs`, [lon, lat])
  const [rx, ry] = img.getResolution()
  const px = Math.round((x - img.getOrigin()[0]) / rx)
  const py = Math.round((y - img.getOrigin()[1]) / ry)
  const raster = await img.readRasters({ window: [px - half, py - half, px + half + 1, py + half + 1], interleave: true })
  const vals = Array.from(raster).filter((v) => v > 0)
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN
}

function pearson(xs, ys) {
  const ok = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
  if (ok.length < 5) return NaN
  const a = ok.map((o) => o[0])
  const b = ok.map((o) => o[1])
  const ma = a.reduce((s, v) => s + v, 0) / a.length
  const mb = b.reduce((s, v) => s + v, 0) / b.length
  const num = a.reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0)
  const den = Math.sqrt(a.reduce((s, v) => s + (v - ma) ** 2, 0) * b.reduce((s, v) => s + (v - mb) ** 2, 0))
  return num / den
}

console.log(`\nCorrélation NDVI / leur score selon le millésime de l'image (${targets.length} cases du cluster)\n`)
console.log('  période           image                       nuages   NDVI      NDMI')
for (const [label, datetime] of PERIODES) {
  const scene = await findScene(datetime)
  if (!scene) {
    console.log(`  ${label.padEnd(17)} aucune image trouvée`)
    continue
  }
  const ndvis = []
  const ndmis = []
  for (const p of targets) {
    try {
      const [rouge, pir, mir] = await Promise.all([
        meanAround(scene, 'red', p.lat, p.lon),
        meanAround(scene, 'nir', p.lat, p.lon),
        meanAround(scene, 'swir16', p.lat, p.lon, 0),
      ])
      ndvis.push((pir - rouge) / (pir + rouge))
      ndmis.push((pir - mir) / (pir + mir))
    } catch {
      ndvis.push(NaN)
      ndmis.push(NaN)
    }
  }
  const rNdvi = pearson(ndvis, scores)
  const rNdmi = pearson(ndmis, scores)
  const fmt = (r) => (Number.isFinite(r) ? (r >= 0 ? '+' : '') + r.toFixed(3) : ' n/a ')
  console.log(
    `  ${label.padEnd(17)} ${scene.properties.datetime.slice(0, 10).padEnd(12)} ${String(scene.properties['eo:cloud_cover'].toFixed(1) + '%').padStart(8)}   ${fmt(rNdvi)}   ${fmt(rNdmi)}`,
  )
}
console.log('\nLecture : le millésime dont la corrélation est la plus forte (en valeur absolue)\nest le meilleur candidat pour l’image sur laquelle leur carte est calée.')
