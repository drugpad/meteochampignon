#!/usr/bin/env node
// Teste l'hypothèse « couvert végétal réel à haute résolution » comme
// variable cachée (voir scripts/residual-autocorr.mjs : les erreurs
// résiduelles sont spatialement corrélées à 0-30 m et plus du tout au-delà
// de 60 m — donc la donnée manquante varie à l'échelle de quelques dizaines
// de mètres, exactement l'échelle d'une trouée ou d'une lisière).
//
// Source : ESA WorldCover 2021, occupation du sol mondiale à 10 m, en
// GeoTIFF nuagique sur S3 — on ne lit que les quelques pixels utiles par
// requêtes partielles (même technique que scripts/lib-species.mjs pour les
// rasters d'essences).
//
//   node scripts/test-canopy.mjs [--all]
import { readFileSync, writeFileSync } from 'node:fs'
import { fromUrl } from 'geotiff'

// Classes ESA WorldCover
const CLASSES = {
  10: 'arbres', 20: 'arbustes', 30: 'prairie', 40: 'cultures', 50: 'bâti',
  60: 'sol nu', 70: 'neige', 80: 'eau', 90: 'zone humide', 95: 'mangrove', 100: 'lichens',
}

const tileName = (lat, lon) => {
  const latT = Math.floor(lat / 3) * 3
  const lonT = Math.floor(lon / 3) * 3
  const ns = latT >= 0 ? 'N' : 'S'
  const ew = lonT >= 0 ? 'E' : 'W'
  return `${ns}${String(Math.abs(latT)).padStart(2, '0')}${ew}${String(Math.abs(lonT)).padStart(3, '0')}`
}

const handles = new Map()
async function imageFor(lat, lon) {
  const t = tileName(lat, lon)
  if (!handles.has(t)) {
    const url = `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_${t}_Map.tif`
    const tiff = await fromUrl(url)
    handles.set(t, await tiff.getImage())
  }
  return handles.get(t)
}

// Fenêtre de N x N pixels de 10 m centrée sur le point.
async function landCoverWindow(lat, lon, half = 3) {
  const img = await imageFor(lat, lon)
  const [ox, , , oy] = img.getOrigin ? [...img.getOrigin(), 0] : [0, 0, 0, 0]
  const [rx, ry] = img.getResolution()
  const px = Math.round((lon - img.getOrigin()[0]) / rx)
  const py = Math.round((lat - img.getOrigin()[1]) / ry)
  const window = [px - half, py - half, px + half + 1, py + half + 1]
  const rasters = await img.readRasters({ window, interleave: true })
  return Array.from(rasters)
}

const data = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8'))
const all = process.argv.includes('--all')
const targets = all
  ? data.points
  : data.points.filter((p) => p.lat > 43.1 && p.lat < 43.103 && p.lon > 0.213 && p.lon < 0.216)

console.log(`\n${targets.length} points — lecture du couvert du sol à 10 m (fenêtre de 70 m)…\n`)

const rows = []
for (const [i, p] of targets.entries()) {
  try {
    const cells = await landCoverWindow(p.lat, p.lon)
    const total = cells.length
    const trees = cells.filter((c) => c === 10).length
    const open = cells.filter((c) => c === 30 || c === 40 || c === 60).length
    const centre = cells[Math.floor(total / 2)]
    rows.push({ ...p, partArbres: trees / total, partOuvert: open / total, classeCentre: centre })
  } catch (err) {
    rows.push({ ...p, partArbres: NaN, partOuvert: NaN, classeCentre: null })
  }
  process.stdout.write(`\r  ${i + 1}/${targets.length}`)
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
  return num / den
}

const scores = rows.map((r) => r.score)
console.log('=== Couvert du sol (ESA WorldCover 10 m) vs leur score ===')
console.log(`  part d'arbres dans la fenêtre  r=${pearson(rows.map((r) => r.partArbres), scores).toFixed(3)}`)
console.log(`  part de milieu ouvert          r=${pearson(rows.map((r) => r.partOuvert), scores).toFixed(3)}`)

const byClass = {}
for (const r of rows) (byClass[CLASSES[r.classeCentre] ?? 'inconnu'] ??= []).push(r.score)
console.log('\n  classe du pixel central :')
for (const [k, v] of Object.entries(byClass).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`    ${k.padEnd(12)} n=${String(v.length).padStart(3)}  score moyen=${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)}`)
}

writeFileSync(
  new URL(all ? './canopy-all.json' : './canopy-cluster.json', import.meta.url),
  JSON.stringify(rows, null, 1),
)
console.log(`\nÉcrit dans scripts/${all ? 'canopy-all.json' : 'canopy-cluster.json'}`)
