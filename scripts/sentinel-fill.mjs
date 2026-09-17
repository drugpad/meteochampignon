#!/usr/bin/env node
// Complète les indices satellite pour les points laissés de côté par
// scripts/test-sentinel.mjs : la région couvre de nombreuses tuiles
// Sentinel-2 et la recherche groupée n'en couvrait qu'une partie. Ici on
// cherche une image point par point (avec cache par tuile), ce qui est plus
// lent mais garantit la couverture complète.
//
//   node scripts/sentinel-fill.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { fromUrl } from 'geotiff'
import proj4 from 'proj4'

const rows = JSON.parse(readFileSync(new URL('./sentinel-all.json', import.meta.url), 'utf8'))
const manquants = rows.filter((r) => !Number.isFinite(r.ndvi))
console.log(`\n${manquants.length} points sans indice satellite sur ${rows.length}.\n`)

const sceneCache = new Map() // clé : tuile arrondie au 0.2° → scène
const imageCache = new Map()

async function sceneNear(lat, lon) {
  const key = `${Math.round(lat * 5)}_${Math.round(lon * 5)}`
  if (sceneCache.has(key)) return sceneCache.get(key)
  const res = await fetch('https://earth-search.aws.element84.com/v1/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      collections: ['sentinel-2-l2a'],
      intersects: { type: 'Point', coordinates: [lon, lat] },
      datetime: '2026-06-01T00:00:00Z/2026-09-17T00:00:00Z',
      query: { 'eo:cloud_cover': { lt: 12 } },
      limit: 1,
      sortby: [{ field: 'properties.eo:cloud_cover', direction: 'asc' }],
    }),
  })
  const json = await res.json()
  const scene = json.features?.[0] ?? null
  sceneCache.set(key, scene)
  return scene
}

async function bandImage(scene, band) {
  const key = `${scene.id}|${band}`
  if (!imageCache.has(key)) {
    const href = scene.assets[band]?.href
    if (!href) return null
    const tiff = await fromUrl(href)
    imageCache.set(key, await tiff.getImage())
  }
  return imageCache.get(key)
}

async function meanAround(scene, band, lat, lon, half = 1) {
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

let ok = 0
for (const [i, r] of manquants.entries()) {
  try {
    const scene = await sceneNear(r.lat, r.lon)
    if (scene) {
      const [rouge, pir, mir] = await Promise.all([
        meanAround(scene, 'red', r.lat, r.lon),
        meanAround(scene, 'nir', r.lat, r.lon),
        meanAround(scene, 'swir16', r.lat, r.lon, 0),
      ])
      r.ndvi = (pir - rouge) / (pir + rouge)
      r.ndmi = Number.isFinite(mir) ? (pir - mir) / (pir + mir) : NaN
      r.pir = pir
      r.scene = scene.id
      if (Number.isFinite(r.ndvi)) ok++
    }
  } catch {
    /* on laisse NaN, le modèle sait gérer les valeurs manquantes */
  }
  process.stdout.write(`\r  ${i + 1}/${manquants.length} (${ok} complétés)`)
}
console.log('\n')

writeFileSync(new URL('./sentinel-all.json', import.meta.url), JSON.stringify(rows, null, 1))

const avec = rows.filter((r) => Number.isFinite(r.ndvi))
console.log(`${avec.length}/${rows.length} points disposent maintenant d'un indice satellite.`)

function pearson(xs, ys) {
  const ma = xs.reduce((s, v) => s + v, 0) / xs.length
  const mb = ys.reduce((s, v) => s + v, 0) / ys.length
  const num = xs.reduce((s, v, i) => s + (v - ma) * (ys[i] - mb), 0)
  const den = Math.sqrt(xs.reduce((s, v) => s + (v - ma) ** 2, 0) * ys.reduce((s, v) => s + (v - mb) ** 2, 0))
  return num / den
}
const s = avec.map((r) => r.score)
console.log(`\n  NDVI vs score : r=${pearson(avec.map((r) => r.ndvi), s).toFixed(3)}`)
const avecNdmi = avec.filter((r) => Number.isFinite(r.ndmi))
console.log(`  NDMI vs score : r=${pearson(avecNdmi.map((r) => r.ndmi), avecNdmi.map((r) => r.score)).toFixed(3)}`)
