#!/usr/bin/env node
// Dernière hypothèse sérieuse : leur score serait calculé à une résolution
// plus fine que la case, puis moyenné — alors que les valeurs qu'ils
// AFFICHENT sont déjà des moyennes de case ("Altitude moyenne").
//
// Si c'est le cas, la moyenne d'une fonction n'étant pas la fonction de la
// moyenne, l'information perdue est réelle mais récupérable : il suffit de
// recalculer la statistique interne de la case sur un MNT fin. Une case de
// 20 m dont la moitié regarde au sud et l'autre au nord n'a pas la même
// valeur qu'une case uniformément orientée à l'est, même si l'orientation
// moyenne des deux est identique.
//
// Terrain d'essai : le cluster de cases voisines, où tout le reste est
// constant (mêmes essences, même pH, même type de forêt, même couvert).
//
//   node scripts/test-subcell.mjs
import { readFileSync, writeFileSync } from 'node:fs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Grille 7x7 au pas de 5 m (MNT IGN RGE ALTI, résolution 1-5 m) : de quoi
// calculer pente et orientation pour les 25 sous-pixels intérieurs.
async function fetchFineGrid(lat, lon, step = 5, n = 7) {
  const dLat = step / 111320
  const dLon = step / (111320 * Math.cos((lat * Math.PI) / 180))
  const half = (n - 1) / 2
  const lats = []
  const lons = []
  for (let i = -half; i <= half; i++) {
    for (let j = -half; j <= half; j++) {
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
      if (!res.ok) throw new Error(`RGE ALTI ${res.status}`)
      const data = await res.json()
      const z = data.elevations.map((e) => e.z)
      if (z.some((v) => typeof v !== 'number' || v < -100)) return null
      return z
    } catch {
      if (attempt === 2) return null
      await sleep(1500)
    }
  }
}

// Statistiques INTERNES de la case : on calcule pente/orientation pour
// chacun des 25 sous-pixels, puis on agrège.
function subcellStats(z, n = 7, step = 5) {
  const at = (i, j) => z[i * n + j]
  const slopes = []
  const cosA = []
  let south = 0
  for (let i = 1; i < n - 1; i++) {
    for (let j = 1; j < n - 1; j++) {
      const dzdx = (at(i - 1, j + 1) + 2 * at(i, j + 1) + at(i + 1, j + 1) - (at(i - 1, j - 1) + 2 * at(i, j - 1) + at(i + 1, j - 1))) / (8 * step)
      const dzdy = (at(i + 1, j - 1) + 2 * at(i + 1, j) + at(i + 1, j + 1) - (at(i - 1, j - 1) + 2 * at(i - 1, j) + at(i - 1, j + 1))) / (8 * step)
      const slope = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI
      const aspect = ((Math.atan2(-dzdx, -dzdy) * 180) / Math.PI + 360) % 360
      slopes.push(slope)
      cosA.push(Math.cos(((aspect - 180) * Math.PI) / 180))
      if (aspect >= 112.5 && aspect <= 247.5) south++
    }
  }
  const m = (a) => a.reduce((s, v) => s + v, 0) / a.length
  const sd = (a) => Math.sqrt(m(a.map((v) => (v - m(a)) ** 2)))
  return {
    penteMoy: m(slopes),
    penteHetero: sd(slopes),
    // « Combien la case regarde au sud », moyenné sous-pixel par sous-pixel
    // — ce n'est PAS la même chose que le cosinus de l'orientation moyenne.
    sudMoy: m(cosA),
    sudHetero: sd(cosA),
    fractionSud: south / slopes.length,
    denivele: Math.max(...z) - Math.min(...z),
  }
}

const data = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8'))
const targets = data.points.filter((p) => p.lat > 43.1 && p.lat < 43.103 && p.lon > 0.213 && p.lon < 0.216)

console.log(`\n${targets.length} cases du cluster — statistiques internes sur MNT fin (pas de 5 m)…\n`)
const rows = []
for (const [i, p] of targets.entries()) {
  const z = await fetchFineGrid(p.lat, p.lon)
  rows.push({ ...p, ...(z ? subcellStats(z) : {}) })
  process.stdout.write(`\r  ${i + 1}/${targets.length}`)
  await sleep(350)
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
console.log('=== Statistiques internes de la case vs leur score (cluster) ===')
for (const key of ['sudMoy', 'fractionSud', 'sudHetero', 'penteMoy', 'penteHetero', 'denivele']) {
  const r = pearson(rows.map((x) => x[key]), scores)
  console.log(`  ${key.padEnd(14)} r=${Number.isFinite(r) ? r.toFixed(3) : 'n/a'}`)
}
console.log('\n  rappel — variables AFFICHÉES sur le même cluster :')
console.log(`  cos(orient) affichée  r=${pearson(rows.map((x) => Math.cos(((x.orientation - 180) * Math.PI) / 180)), scores).toFixed(3)}`)
console.log(`  pente affichée        r=${pearson(rows.map((x) => x.pente), scores).toFixed(3)}`)

writeFileSync(new URL('./subcell-cluster.json', import.meta.url), JSON.stringify(rows, null, 1))
