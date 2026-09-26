#!/usr/bin/env node
// Leur score est-il calculé sur le MÊME modèle de terrain que celui qu'ils
// affichent, mais interpolé plutôt que pris au pixel le plus proche ?
//
// Constat qui l'a suggéré : deux cases distantes de 20 m affichent souvent
// EXACTEMENT le même terrain (altitude, orientation, pente), alors que leurs
// scores diffèrent de 5 à 10 points. Or on avait établi en début de projet
// que leurs valeurs affichées correspondent au MNT européen EU-DEM à 25 m.
// Des valeurs identiques pour deux cases voisines signifient que l'affichage
// prend le pixel le plus proche. Si le calcul du score, lui, travaille sur ce
// même MNT interpolé (réglage par défaut de la plupart des outils SIG), les
// deux cases ont un terrain différent pour le calcul — et identique à
// l'affichage.
//
// On avait testé le MNT de l'IGN, jamais leur propre source en interpolé.
//
//   node scripts/test-eudem-precision.mjs
import { readFileSync, writeFileSync } from 'node:fs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const data = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8'))
const cluster = data.points.filter((p) => p.lat > 43.1 && p.lat < 43.103 && p.lon > 0.213 && p.lon < 0.216)

// OpenTopoData accepte jusqu'à 100 points par requête et 1 requête/seconde.
async function elevations(points, interpolation) {
  const out = []
  for (let i = 0; i < points.length; i += 100) {
    const lot = points.slice(i, i + 100)
    const url =
      `https://api.opentopodata.org/v1/eudem25m?interpolation=${interpolation}` +
      `&locations=${lot.map(([la, lo]) => `${la.toFixed(7)},${lo.toFixed(7)}`).join('|')}`
    for (let essai = 0; essai < 4; essai++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
        if (res.status === 429) {
          await sleep(3000)
          continue
        }
        const json = await res.json()
        out.push(...json.results.map((r) => r.elevation))
        break
      } catch {
        await sleep(2000)
      }
    }
    await sleep(1200)
  }
  return out
}

// Pente et orientation (Horn) à partir d'une grille 3x3 au pas donné.
function horn(z, pas) {
  const [sw, s, se, w, , e, nw, n, ne] = z
  const dzdx = (se + 2 * e + ne - (sw + 2 * w + nw)) / (8 * pas)
  const dzdy = (nw + 2 * n + ne - (sw + 2 * s + se)) / (8 * pas)
  return {
    pente: (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI,
    orientation: ((Math.atan2(-dzdx, -dzdy) * 180) / Math.PI + 360) % 360,
  }
}

function grille(lat, lon, pas) {
  const dLat = pas / 111320
  const dLon = pas / (111320 * Math.cos((lat * Math.PI) / 180))
  const pts = []
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) pts.push([lat + i * dLat, lon + j * dLon])
  return pts
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
  return den === 0 ? NaN : num / den
}

const scores = cluster.map((p) => p.score)
const sud = (o) => Math.cos(((o - 180) * Math.PI) / 180)

console.log(`\n${cluster.length} cases du cluster — MNT EU-DEM 25 m (leur source)\n`)
console.log('  méthode                        altitude   sud(orient)   pente    |  cohérence avec leur affichage')

const resultats = {}
for (const interp of ['nearest', 'bilinear', 'cubic']) {
  for (const pas of [5, 12.5, 25]) {
    const toutes = cluster.flatMap((p) => grille(p.lat, p.lon, pas))
    const z = await elevations(toutes, interp)
    const rows = cluster.map((p, i) => {
      const bloc = z.slice(i * 9, i * 9 + 9)
      return { alt: bloc[4], ...horn(bloc, pas) }
    })
    const rAlt = pearson(rows.map((r) => r.alt), scores)
    const rSud = pearson(rows.map((r) => sud(r.orientation)), scores)
    const rPente = pearson(rows.map((r) => r.pente), scores)
    // Cohérence : notre calcul retrouve-t-il LEURS valeurs affichées ?
    const ecartAlt = rows.reduce((s, r, i) => s + Math.abs(r.alt - cluster[i].altitude), 0) / rows.length
    const ecartPente = rows.reduce((s, r, i) => s + Math.abs(r.pente - cluster[i].pente), 0) / rows.length
    const fmt = (r) => (Number.isFinite(r) ? (r >= 0 ? '+' : '') + r.toFixed(3) : '  n/a ')
    const label = `${interp}, pas ${pas} m`
    resultats[label] = rows
    console.log(
      `  ${label.padEnd(28)} ${fmt(rAlt).padStart(9)}   ${fmt(rSud).padStart(11)}   ${fmt(rPente).padStart(6)}   |  alt ±${ecartAlt.toFixed(1)} m, pente ±${ecartPente.toFixed(1)}°`,
    )
  }
}

console.log('\n  rappel — valeurs affichées par le service :')
console.log(
  `  ${'affichées'.padEnd(28)} ${pearson(cluster.map((p) => p.altitude), scores).toFixed(3).padStart(9)}   ${pearson(cluster.map((p) => sud(p.orientation)), scores).toFixed(3).padStart(11)}   ${pearson(cluster.map((p) => p.pente), scores).toFixed(3).padStart(6)}`,
)

writeFileSync(new URL('./eudem-precision-cluster.json', import.meta.url), JSON.stringify(resultats, null, 1))
