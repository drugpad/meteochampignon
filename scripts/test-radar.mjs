#!/usr/bin/env node
// Piste du radar Sentinel-1.
//
// Ce qui l'a suggérée : dans le cluster, des cases strictement identiques sur
// toutes les valeurs affichées obtiennent 62, 67, 67 et 72 ; et la carte des
// scores est tachetée (un point à 53 entouré de 69 et 73). Ce grain fin et
// bruité est la signature du chatoiement radar, propre aux images Sentinel-1
// à 10 m.
//
// Le radar n'est pas anecdotique en foresterie : contrairement à l'optique,
// il traverse le feuillage et répond à la STRUCTURE du peuplement (biomasse,
// rugosité du couvert, humidité), pas seulement à sa couleur. Il est gratuit,
// national, disponible depuis 2014 — et c'est exactement ce que la carte
// européenne des genres d'arbres utilise en complément de Sentinel-2.
//
//   node scripts/test-radar.mjs [--all]
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

console.log('\nRecherche d’images radar Sentinel-1 sur la zone…')
const res = await fetch('https://earth-search.aws.element84.com/v1/search', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    collections: ['sentinel-1-grd'],
    bbox,
    datetime: '2026-05-01T00:00:00Z/2026-09-17T00:00:00Z',
    limit: 20,
  }),
})
const json = await res.json()
if (!json.features?.length) {
  console.log('Aucune image radar trouvée dans ce catalogue.')
  console.log('Collections disponibles :')
  const cols = await (await fetch('https://earth-search.aws.element84.com/v1/collections')).json()
  for (const c of cols.collections ?? []) console.log('  -', c.id)
  process.exit(1)
}
console.log(`  ${json.features.length} images trouvées.`)
const scene = json.features[0]
console.log(`  image retenue : ${scene.id}`)
console.log(`  date : ${scene.properties.datetime.slice(0, 10)}`)
console.log(`  bandes disponibles : ${Object.keys(scene.assets).join(', ')}`)

const cache = new Map()
async function bandImage(band) {
  if (!cache.has(band)) {
    const href = scene.assets[band]?.href
    if (!href) return null
    cache.set(band, await (await fromUrl(href)).getImage())
  }
  return cache.get(band)
}

async function moyenne(band, lat, lon, half = 1) {
  const img = await bandImage(band)
  if (!img) return NaN
  const epsg = scene.properties['proj:epsg'] ?? scene.properties['proj:code']?.split(':').pop()
  const [x, y] = epsg
    ? proj4('EPSG:4326', `+proj=utm +zone=${String(epsg).slice(-2)} +datum=WGS84 +units=m +no_defs`, [lon, lat])
    : [lon, lat]
  const [rx, ry] = img.getResolution()
  const px = Math.round((x - img.getOrigin()[0]) / rx)
  const py = Math.round((y - img.getOrigin()[1]) / ry)
  const raster = await img.readRasters({ window: [px - half, py - half, px + half + 1, py + half + 1], interleave: true })
  const vals = Array.from(raster).filter((v) => v > 0)
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN
}

const bandes = ['vv', 'vh'].filter((b) => scene.assets[b])
if (!bandes.length) {
  console.log('\nLes bandes VV/VH ne sont pas exposées par ce catalogue pour cette image.')
  process.exit(1)
}

console.log(`\n${cibles.length} points — lecture du radar (${bandes.join(', ')})…\n`)
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
  rows.push({ ...p, ...vals, ratio: vals.vh && vals.vv ? vals.vh / vals.vv : NaN })
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
console.log('=== Radar vs leur score ===')
for (const b of [...bandes, 'ratio']) {
  console.log(`  ${b.padEnd(8)} r=${pearson(rows.map((r) => r[b]), scores).toFixed(3)}`)
}

writeFileSync(new URL(all ? './radar-all.json' : './radar-cluster.json', import.meta.url), JSON.stringify(rows, null, 1))
