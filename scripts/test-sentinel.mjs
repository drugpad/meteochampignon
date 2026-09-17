#!/usr/bin/env node
// Hypothèse finale sur la variable cachée : l'imagerie satellite Sentinel-2.
//
// Pourquoi elle est la seule candidate crédible :
//   - le service couvre toute la France, donc sa donnée est forcément un
//     raster national — personne ne relève les arbres sur le terrain ;
//   - le site existe depuis décembre 2020, donc le LiDAR HD de l'IGN
//     (acquisitions à partir de 2021, couverture progressive jusqu'en 2026)
//     ne peut pas être la source d'origine ;
//   - Sentinel-2 est gratuit, couvre l'Europe entière depuis 2015, à 10 m
//     de résolution, avec un repassage tous les 5 jours ;
//   - ses pixels de 10 m expliqueraient l'aspect « moucheté » de leur carte
//     et la longueur de corrélation de ~30 m qu'on a mesurée sur les erreurs.
//
// On calcule ici deux indices classiques autour de chaque case :
//   NDVI  (vigueur/densité de la végétation) = (PIR - Rouge)/(PIR + Rouge)
//   NDMI  (humidité du couvert)              = (PIR - MIR)/(PIR + MIR)
//
//   node scripts/test-sentinel.mjs [--all]
import { readFileSync, writeFileSync } from 'node:fs'
import { fromUrl } from 'geotiff'
import proj4 from 'proj4'

const data = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8'))
const all = process.argv.includes('--all')
const targets = all
  ? data.points
  : data.points.filter((p) => p.lat > 43.1 && p.lat < 43.103 && p.lon > 0.213 && p.lon < 0.216)

// La région couvre plusieurs tuiles Sentinel-2 : on cherche les images
// disponibles sur toute l'emprise, puis on attribue à chaque point la
// meilleure image qui le contient (catalogue STAC public d'Element 84, sans
// authentification).
const lats = targets.map((p) => p.lat)
const lons = targets.map((p) => p.lon)
const bbox = [Math.min(...lons) - 0.02, Math.min(...lats) - 0.02, Math.max(...lons) + 0.02, Math.max(...lats) + 0.02]

console.log('\nRecherche des images Sentinel-2 d’été peu nuageuses sur l’emprise…')
const search = await fetch('https://earth-search.aws.element84.com/v1/search', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    collections: ['sentinel-2-l2a'],
    bbox,
    datetime: '2026-06-01T00:00:00Z/2026-09-17T00:00:00Z',
    query: { 'eo:cloud_cover': { lt: 10 } },
    limit: 200,
    sortby: [{ field: 'properties.eo:cloud_cover', direction: 'asc' }],
  }),
})
const results = await search.json()
if (!results.features?.length) {
  console.log('Aucune image trouvée sur la période — élargir la fenêtre de dates.')
  process.exit(1)
}
// Une seule image par tuile (la moins nuageuse, elles sont triées).
const scenesByTile = new Map()
for (const f of results.features) {
  const tile = `${f.properties['mgrs:utm_zone']}${f.properties['mgrs:latitude_band']}${f.properties['mgrs:grid_square']}`
  if (!scenesByTile.has(tile)) scenesByTile.set(tile, f)
}
console.log(`  ${results.features.length} images trouvées, ${scenesByTile.size} tuiles retenues :`)
for (const [tile, f] of scenesByTile) {
  console.log(`    ${tile} — ${f.properties.datetime.slice(0, 10)}, ${f.properties['eo:cloud_cover'].toFixed(1)}% de nuages`)
}

const inBbox = (f, lat, lon) => {
  const [w, s, e, n] = f.bbox
  return lon >= w && lon <= e && lat >= s && lat <= n
}
const sceneFor = (lat, lon) => [...scenesByTile.values()].find((f) => inBbox(f, lat, lon)) ?? null

// Ouverture paresseuse des bandes : une image Sentinel-2 pèse des centaines
// de Mo, mais on ne lit que les quelques pixels utiles par requêtes
// partielles (comme pour les rasters d'essences).
const imageCache = new Map()
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

// Les images Sentinel-2 sont en projection UTM : il faut convertir les
// coordonnées géographiques avant de lire les pixels.
function toUtm(scene, lon, lat) {
  const epsg = scene.properties['proj:epsg'] ?? scene.properties['proj:code']?.split(':').pop()
  const utm = `+proj=utm +zone=${String(epsg).slice(-2)} +datum=WGS84 +units=m +no_defs`
  return proj4('EPSG:4326', utm, [lon, lat])
}

async function meanAround(scene, band, lat, lon, half = 1) {
  const img = await bandImage(scene, band)
  if (!img) return NaN
  const [x, y] = toUtm(scene, lon, lat)
  const [ox, oy] = [img.getOrigin()[0], img.getOrigin()[1]]
  const [rx, ry] = img.getResolution()
  const px = Math.round((x - ox) / rx)
  const py = Math.round((y - oy) / ry)
  const win = [px - half, py - half, px + half + 1, py + half + 1]
  const raster = await img.readRasters({ window: win, interleave: true })
  const vals = Array.from(raster).filter((v) => v > 0)
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN
}

console.log(`\n${targets.length} points — lecture des pixels satellite…\n`)
const rows = []
let sansImage = 0
for (const [i, p] of targets.entries()) {
  const scene = sceneFor(p.lat, p.lon)
  if (!scene) {
    sansImage++
    rows.push({ ...p, ndvi: NaN, ndmi: NaN, pir: NaN })
  } else {
    try {
      const [rouge, pir, mir] = await Promise.all([
        meanAround(scene, 'red', p.lat, p.lon),
        meanAround(scene, 'nir', p.lat, p.lon),
        meanAround(scene, 'swir16', p.lat, p.lon, 0),
      ])
      rows.push({
        ...p,
        ndvi: (pir - rouge) / (pir + rouge),
        ndmi: Number.isFinite(mir) ? (pir - mir) / (pir + mir) : NaN,
        pir,
        scene: scene.id,
      })
    } catch (err) {
      rows.push({ ...p, ndvi: NaN, ndmi: NaN, pir: NaN })
    }
  }
  process.stdout.write(`\r  ${i + 1}/${targets.length}`)
}
console.log('\n')
if (sansImage) console.log(`  (${sansImage} points sans image couvrante)\n`)

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

const scores = rows.map((r) => r.score)
console.log('=== Indices satellite vs leur score ===')
console.log(`  NDVI (vigueur végétation)  r=${pearson(rows.map((r) => r.ndvi), scores).toFixed(3)}`)
console.log(`  NDMI (humidité du couvert) r=${pearson(rows.map((r) => r.ndmi), scores).toFixed(3)}`)
console.log(`  réflectance PIR brute      r=${pearson(rows.map((r) => r.pir), scores).toFixed(3)}`)
const ndvis = rows.map((r) => r.ndvi).filter(Number.isFinite)
console.log(`\n  plage de NDVI observée : ${Math.min(...ndvis).toFixed(3)} à ${Math.max(...ndvis).toFixed(3)}`)

writeFileSync(new URL(all ? './sentinel-all.json' : './sentinel-cluster.json', import.meta.url), JSON.stringify(rows, null, 1))
console.log(`\nÉcrit dans scripts/${all ? 'sentinel-all.json' : 'sentinel-cluster.json'}`)
