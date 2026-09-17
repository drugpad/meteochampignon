import { readFileSync } from 'node:fs'
import { scoreCepeEte } from './compare-calibration.mjs'
const data = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8'))
const points = data.points.map((p) => ({ ...p, pred: scoreCepeEte(p).score }))
const buckets = {}
for (const p of points) {
  const key = `${Math.round(p.lat * 3) / 3},${Math.round(p.lon * 3) / 3}`
  ;(buckets[key] ??= []).push(p.pred - p.score)
}
const rows = Object.entries(buckets)
  .filter(([, e]) => e.length >= 4)
  .map(([k, e]) => ({ k, n: e.length, mean: e.reduce((a, b) => a + b, 0) / e.length }))
  .sort((a, b) => Math.abs(b.mean) - Math.abs(a.mean))
console.log('Poches géographiques (>=4 points) avec le plus gros biais moyen local :')
for (const r of rows) console.log(`  ${r.k.padEnd(20)} n=${r.n}  biais moyen=${r.mean.toFixed(1)}`)
console.log('\necart-type des biais moyens par poche:', Math.sqrt(rows.reduce((s, r) => s + r.mean ** 2, 0) / rows.length).toFixed(2))
