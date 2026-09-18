#!/usr/bin/env node
// Collecte du radar Sentinel-1 corrigé du relief sur l'ensemble des points,
// puis mesure du gain réel sur le modèle — le seul critère qui fait foi.
//
// Sur les 29 points du cluster, le rapport VH/VV sortait à +0.33 : trop peu
// pour conclure (beaucoup de variables testées sur un petit échantillon
// finissent par en montrer une à 0.3 par hasard). On refait donc la mesure
// sur les 222 points, et surtout on regarde si l'erreur du modèle baisse.
//
//   node scripts/radar-collect.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { fromUrl } from 'geotiff'
import proj4 from 'proj4'

const points = JSON.parse(readFileSync(new URL('./sentinel-all.json', import.meta.url), 'utf8'))

const sceneCache = new Map()
const imageCache = new Map()

async function sceneNear(lat, lon) {
  const key = `${Math.round(lat * 4)}_${Math.round(lon * 4)}`
  if (sceneCache.has(key)) return sceneCache.get(key)
  let scene = null
  try {
    const res = await fetch('https://planetarycomputer.microsoft.com/api/stac/v1/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        collections: ['sentinel-1-rtc'],
        intersects: { type: 'Point', coordinates: [lon, lat] },
        datetime: '2026-05-01T00:00:00Z/2026-09-17T00:00:00Z',
        limit: 1,
      }),
    })
    const json = await res.json()
    scene = json.features?.[0] ?? null
  } catch {
    scene = null
  }
  sceneCache.set(key, scene)
  return scene
}

async function signe(href) {
  const r = await fetch(`https://planetarycomputer.microsoft.com/api/sas/v1/sign?href=${encodeURIComponent(href)}`)
  return (await r.json()).href ?? href
}

async function bandImage(scene, band) {
  const key = `${scene.id}|${band}`
  if (!imageCache.has(key)) {
    const href = scene.assets[band]?.href
    if (!href) return null
    imageCache.set(key, await (await fromUrl(await signe(href))).getImage())
  }
  return imageCache.get(key)
}

async function moyenne(scene, band, lat, lon, half = 1) {
  const img = await bandImage(scene, band)
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

console.log(`\n${points.length} points — lecture du radar corrigé du relief…\n`)
let ok = 0
for (const [i, p] of points.entries()) {
  try {
    const scene = await sceneNear(p.lat, p.lon)
    if (scene) {
      p.vv = await moyenne(scene, 'vv', p.lat, p.lon)
      p.vh = await moyenne(scene, 'vh', p.lat, p.lon)
      p.ratioVhVv = Number.isFinite(p.vh) && p.vv ? p.vh / p.vv : NaN
      if (Number.isFinite(p.vv)) ok++
    }
  } catch {
    /* on laisse en valeur manquante */
  }
  process.stdout.write(`\r  ${i + 1}/${points.length} (${ok} lus)`)
}
console.log('\n')

writeFileSync(new URL('./radar-all.json', import.meta.url), JSON.stringify(points, null, 1))

function pearson(xs, ys) {
  const okp = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
  if (okp.length < 10) return NaN
  const a = okp.map((o) => o[0])
  const b = okp.map((o) => o[1])
  const ma = a.reduce((s, v) => s + v, 0) / a.length
  const mb = b.reduce((s, v) => s + v, 0) / b.length
  const num = a.reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0)
  const den = Math.sqrt(a.reduce((s, v) => s + (v - ma) ** 2, 0) * b.reduce((s, v) => s + (v - mb) ** 2, 0))
  return num / den
}
const scores = points.map((p) => p.score)
console.log(`=== Radar vs leur score (${ok} points lus) ===`)
for (const b of ['vv', 'vh', 'ratioVhVv']) {
  console.log(`  ${b.padEnd(10)} r=${pearson(points.map((p) => p[b]), scores).toFixed(3)}`)
}
console.log('\nÉcrit dans scripts/radar-all.json')
