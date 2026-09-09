#!/usr/bin/env node
// Recalcule la grille de pluie 24h (Option A) et l'écrit dans
// public/rain-grid.json — lancé toutes les 30 min par GitHub Actions (voir
// .github/workflows/rain-grid.yml), pas par le navigateur : l'appli lit
// directement ce fichier statique (voir src/lib/rainGrid.ts), donc
// l'ouverture de la carte de pluie est quasi instantanée au lieu d'attendre
// plusieurs minutes que le navigateur tire la grille lui-même.
//
// Reprend volontairement la même logique (bbox, pas, pacing anti-429) que
// src/lib/rainGrid.ts / src/lib/config.ts / src/lib/openMeteo.ts, mais en
// JS pur (script Node exécuté par la CI, pas de build Vite ici) — pas de
// dépendance partagée entre les deux pour rester simple, à garder synchro
// à la main si un jour la grille change (bbox, pas, etc.).

import { writeFile } from 'node:fs/promises'

const BOUNDS = { latMin: 42.6, latMax: 45.15, lonMin: -0.4, lonMax: 3.4 }
const STEP_DEG = 0.08
const BATCH_SIZE = 100
const BATCH_DELAY_MS = 12000

function buildGridPoints() {
  const points = []
  for (let lat = BOUNDS.latMin; lat <= BOUNDS.latMax; lat += STEP_DEG) {
    for (let lon = BOUNDS.lonMin; lon <= BOUNDS.lonMax; lon += STEP_DEG) {
      points.push({ lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000 })
    }
  }
  return points
}

function chunk(arr, size) {
  const chunks = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function rolling24hSum(times, values, now = new Date()) {
  const nowIndex = times.findIndex((t) => new Date(t).getTime() > now.getTime())
  const endIndex = (nowIndex === -1 ? times.length : nowIndex) - 1
  const startIndex = endIndex - 23
  if (endIndex < 0 || startIndex < 0) return null
  let sum = 0
  for (let i = startIndex; i <= endIndex; i++) sum += values[i] ?? 0
  return Math.round(sum * 10) / 10
}

async function fetchBatch(points, attempt = 0) {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', points.map((p) => p.lat.toFixed(4)).join(','))
  url.searchParams.set('longitude', points.map((p) => p.lon.toFixed(4)).join(','))
  url.searchParams.set('hourly', 'precipitation')
  url.searchParams.set('past_days', '1')
  url.searchParams.set('forecast_days', '1')
  url.searchParams.set('timezone', 'Europe/Paris')
  url.searchParams.set('models', 'best_match')

  // fetch() lui-même peut rejeter (timeout de connexion, DNS, etc. — observé
  // en usage réel sur le runner GitHub Actions : "ConnectTimeoutError" isolé
  // au milieu d'une série de lots par ailleurs valides), pas seulement
  // renvoyer un statut HTTP en erreur. Les deux cas méritent un retry avec
  // pause croissante, une erreur définitive (400 mauvais paramètre, etc.) non.
  let res
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  } catch (err) {
    if (attempt >= 5) throw err
    console.log(`${err.message}, retry dans ${4 * (attempt + 1)}s…`)
    await wait(4000 * (attempt + 1))
    return fetchBatch(points, attempt + 1)
  }
  // 429 = rate-limit (Open-Meteo semble limiter le débit par nombre de
  // points traités, pas juste par requête HTTP) ; 5xx = erreur transitoire
  // côté Open-Meteo (503 isolé déjà observé aussi).
  if ((res.status === 429 || res.status >= 500) && attempt < 5) {
    console.log(`${res.status}, retry dans ${4 * (attempt + 1)}s…`)
    await wait(4000 * (attempt + 1))
    return fetchBatch(points, attempt + 1)
  }
  if (!res.ok) throw new Error(`Open-Meteo: ${res.status}`)

  const data = await res.json()
  const results = Array.isArray(data) ? data : [data]
  return results.map((entry) => {
    const hourly = entry?.hourly
    if (!hourly) return null
    return rolling24hSum(hourly.time, hourly.precipitation)
  })
}

async function main() {
  const points = buildGridPoints()
  const batches = chunk(points, BATCH_SIZE)
  const results = []

  console.log(`Grille : ${points.length} points, ${batches.length} lots.`)

  for (const [i, batch] of batches.entries()) {
    if (i > 0) await wait(BATCH_DELAY_MS)
    const values = await fetchBatch(batch)
    batch.forEach((p, j) => results.push({ lat: p.lat, lon: p.lon, rain24h: values[j] }))
    console.log(`Lot ${i + 1}/${batches.length} ok (${results.length}/${points.length} points)`)
  }

  const output = { fetchedAt: new Date().toISOString(), points: results }
  await writeFile(new URL('../public/rain-grid.json', import.meta.url), JSON.stringify(output))
  console.log('Écrit dans public/rain-grid.json')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
