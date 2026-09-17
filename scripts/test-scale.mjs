#!/usr/bin/env node
// À quelle ÉCHELLE leur score « voit-il » le terrain ?
//
// Deux faits contradictoires en apparence (voir residual-autocorr.mjs et
// test-subcell.mjs) : leur score est spatialement lisse (corrélation 0.68
// entre cases voisines) alors que les variables qu'ils affichent varient
// brutalement d'une case à l'autre — et aucune statistique fine de la case
// n'explique le score. L'explication possible : le score est calculé sur le
// terrain d'un VOISINAGE plus large (versant entier), pas de la case seule.
//
// On calcule donc pente/orientation à plusieurs échelles (de 10 m à 200 m)
// et on regarde laquelle prédit réellement leur score, à l'intérieur du
// cluster où tout le reste est constant.
//
//   node scripts/test-scale.mjs
import { readFileSync } from 'node:fs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SCALES = [10, 25, 50, 100, 200]

// Une grille 3x3 au pas voulu suffit pour pente/orientation (Horn).
async function terrainAtScale(lat, lon, step) {
  const dLat = step / 111320
  const dLon = step / (111320 * Math.cos((lat * Math.PI) / 180))
  const lats = []
  const lons = []
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      lats.push((lat + i * dLat).toFixed(7))
      lons.push((lon + j * dLon).toFixed(7))
    }
  }
  const url =
    `https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json` +
    `?lon=${lons.join('|')}&lat=${lats.join('|')}&resource=ign_rge_alti_wld&delimiter=|`
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(25000) })
      if (!res.ok) throw new Error(String(res.status))
      const { elevations } = await res.json()
      const z = elevations.map((e) => e.z)
      if (z.some((v) => typeof v !== 'number' || v < -100)) return null
      const [sw, s, se, w, c, e, nw, n, ne] = z
      const dzdx = (se + 2 * e + ne - (sw + 2 * w + nw)) / (8 * step)
      const dzdy = (nw + 2 * n + ne - (sw + 2 * s + se)) / (8 * step)
      return {
        altitude: c,
        pente: (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI,
        orientation: ((Math.atan2(-dzdx, -dzdy) * 180) / Math.PI + 360) % 360,
      }
    } catch {
      if (attempt === 2) return null
      await sleep(1500)
    }
  }
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

const data = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8'))
const targets = data.points.filter((p) => p.lat > 43.1 && p.lat < 43.103 && p.lon > 0.213 && p.lon < 0.216)
const scores = targets.map((p) => p.score)

console.log(`\n${targets.length} cases du cluster, terrain recalculé à ${SCALES.length} échelles…\n`)

const results = {}
for (const step of SCALES) {
  const rows = []
  for (const [i, p] of targets.entries()) {
    rows.push(await terrainAtScale(p.lat, p.lon, step))
    process.stdout.write(`\r  échelle ${step}m : ${i + 1}/${targets.length}   `)
    await sleep(320)
  }
  results[step] = rows
}
console.log('\n')

console.log('=== Corrélation avec LEUR score, selon l’échelle de calcul du terrain ===\n')
console.log('  échelle   sud (cos orient)   pente     altitude')
for (const step of SCALES) {
  const rows = results[step]
  const rSud = pearson(rows.map((t) => (t ? Math.cos(((t.orientation - 180) * Math.PI) / 180) : NaN)), scores)
  const rPente = pearson(rows.map((t) => (t ? t.pente : NaN)), scores)
  const rAlt = pearson(rows.map((t) => (t ? t.altitude : NaN)), scores)
  const fmt = (r) => (Number.isFinite(r) ? (r >= 0 ? '+' : '') + r.toFixed(3) : ' n/a ')
  const flag = Number.isFinite(rSud) && Math.abs(rSud) > 0.5 ? '  ← fort !' : ''
  console.log(`  ${String(step + 'm').padEnd(9)} ${fmt(rSud).padStart(10)}      ${fmt(rPente).padStart(7)}   ${fmt(rAlt).padStart(8)}${flag}`)
}

console.log('\n  rappel — valeurs AFFICHÉES par le service (échelle inconnue) :')
console.log(
  `  ${'affiché'.padEnd(9)} ${((r) => (r >= 0 ? '+' : '') + r.toFixed(3))(pearson(targets.map((p) => Math.cos(((p.orientation - 180) * Math.PI) / 180)), scores)).padStart(10)}` +
    `      ${((r) => (r >= 0 ? '+' : '') + r.toFixed(3))(pearson(targets.map((p) => p.pente), scores)).padStart(7)}` +
    `   ${((r) => (r >= 0 ? '+' : '') + r.toFixed(3))(pearson(targets.map((p) => p.altitude), scores)).padStart(8)}`,
)
