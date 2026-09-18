#!/usr/bin/env node
// Radar Sentinel-1, version corrigée du relief (RTC), seule exploitable ici.
//
// Les images radar brutes (GRD) sont livrées dans la géométrie de visée du
// satellite, pas en coordonnées cartographiques : impossible d'y lire un
// pixel à une latitude/longitude donnée sans un modèle de géoréférencement
// complexe. La version RTC est reprojetée à 10 m et corrigée des effets de
// pente, donc directement lisible — et c'est de toute façon celle qu'on
// utiliserait pour de la forêt, puisque la correction de relief est
// indispensable en terrain accidenté.
//
//   node scripts/test-radar-rtc.mjs [--all]
import { readFileSync, writeFileSync } from 'node:fs'
import { fromUrl } from 'geotiff'
import proj4 from 'proj4'

const data = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8'))
const all = process.argv.includes('--all')
const cibles = all
  ? data.points
  : data.points.filter((p) => p.lat > 43.1 && p.lat < 43.103 && p.lon > 0.213 && p.lon < 0.216)

const lats = cibles.map((p) => p.lat)
const lons = cibles.map((p) => p.lon)
const bbox = [Math.min(...lons) - 0.02, Math.min(...lats) - 0.02, Math.max(...lons) + 0.02, Math.max(...lats) + 0.02]

console.log('\nRecherche d’images radar corrigées du relief…')
const res = await fetch('https://planetarycomputer.microsoft.com/api/stac/v1/search', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ collections: ['sentinel-1-rtc'], bbox, datetime: '2026-04-01T00:00:00Z/2026-09-17T00:00:00Z', limit: 10 }),
})
const json = await res.json()
if (!json.features?.length) {
  console.log('Aucune image RTC disponible sur cette période/zone.')
  console.log(JSON.stringify(json).slice(0, 300))
  process.exit(1)
}
const scene = json.features[0]
console.log(`  image : ${scene.id}`)
console.log(`  date : ${scene.properties.datetime.slice(0, 10)}`)

// Les liens du catalogue doivent être signés (accès anonyme autorisé).
async function signe(href) {
  const r = await fetch(`https://planetarycomputer.microsoft.com/api/sas/v1/sign?href=${encodeURIComponent(href)}`)
  const j = await r.json()
  return j.href ?? href
}

const cache = new Map()
async function bandImage(band) {
  if (!cache.has(band)) {
    const href = scene.assets[band]?.href
    if (!href) return null
    cache.set(band, await (await fromUrl(await signe(href))).getImage())
  }
  return cache.get(band)
}

async function moyenne(band, lat, lon, half = 1) {
  const img = await bandImage(band)
  if (!img) return NaN
  const epsg = scene.properties['proj:epsg'] ?? scene.properties['proj:code']?.split(':').pop()
  const [x, y] = proj4('EPSG:4326', `+proj=utm +zone=${String(epsg).slice(-2)} +datum=WGS84 +units=m +no_defs`, [lon, lat])
  const [rx, ry] = img.getResolution()
  const px = Math.round((x - img.getOrigin()[0]) / rx)
  const py = Math.round((y - img.getOrigin()[1]) / ry)
  const raster = await img.readRasters({ window: [px - half, py - half, px + half + 1, py + half + 1], interleave: true })
  const vals = Array.from(raster).filter((v) => Number.isFinite(v) && v > 0)
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN
}

const bandes = ['vv', 'vh'].filter((b) => scene.assets[b])
console.log(`  bandes : ${bandes.join(', ') || 'aucune'}\n`)
if (!bandes.length) process.exit(1)

const rows = []
for (const [i, p] of cibles.entries()) {
  const vals = {}
  for (const b of bandes) {
    try {
      vals[b] = await moyenne(b, p.lat, p.lon)
    } catch {
      vals[b] = NaN
    }
  }
  // Le rapport VH/VV est l'indicateur classique de structure du couvert :
  // il sépare la diffusion de volume (feuillage dense) de la réflexion de
  // surface (sol nu, canopée rase).
  rows.push({ ...p, ...vals, ratioVhVv: Number.isFinite(vals.vh) && vals.vv ? vals.vh / vals.vv : NaN })
  process.stdout.write(`\r  ${i + 1}/${cibles.length}`)
}
console.log('\n')

function pearson(xs, ys) {
  const ok = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
  if (ok.length < 5) return NaN
  const a = ok.map((o) => o[0])
  const b = ok.map((o) => o[1])
  const ma = a.reduce((s, v) => s + v, 0) / a.length
  const mb = b.reduce((s, v) => s + v, 0) / b.length
  const num = a.reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0)
  const den = Math.sqrt(a.reduce((s, v) => s + (v - ma) ** 2, 0) * b.reduce((s, v) => s + (v - mb) ** 2, 0))
  return den === 0 ? NaN : num / den
}
const scores = rows.map((r) => r.score)
const n = rows.filter((r) => Number.isFinite(r.vv)).length
console.log(`=== Radar corrigé du relief vs leur score (${n} points lus) ===`)
for (const b of [...bandes, 'ratioVhVv']) {
  console.log(`  ${b.padEnd(10)} r=${pearson(rows.map((r) => r[b]), scores).toFixed(3)}`)
}

writeFileSync(new URL(all ? './radar-all.json' : './radar-cluster.json', import.meta.url), JSON.stringify(rows, null, 1))
