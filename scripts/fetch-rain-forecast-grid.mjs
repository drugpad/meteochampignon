#!/usr/bin/env node
// Recalcule la grille de pluie PRÉVUE (mode Prévisions, recouvrement carte)
// et l'écrit dans public/rain-forecast-grid.json — même principe que
// fetch-rain-grid.mjs (carte de pluie 24h mesurée) : découpage en tranches,
// fusion sans écraser les autres tranches, abandon sans commit si trop
// dégradé. Voir ce fichier pour les commentaires détaillés sur le pacing/
// retry, repris ici à l'identique.
//
// Différence : un seul appel par lot donne directement le cumul prévu pour
// les 7 prochains jours (`daily=precipitation_sum`), pas besoin de 7 grilles
// séparées — chaque point stocke un tableau `rain` aligné sur `dates`
// (partagé, écrit une fois par run).
//
// Une prévision change beaucoup moins vite qu'un cumul mesuré : le job
// planifié (.github/workflows/rain-forecast-grid.yml) tourne toutes les 3h,
// pas toutes les heures.

import { readFile, writeFile } from 'node:fs/promises'

const BOUNDS = { latMin: 42.6, latMax: 45.15, lonMin: -0.4, lonMax: 3.4 }
// Synchro à la main avec RAIN_GRID_STEP_DEG dans src/lib/config.ts.
const STEP_DEG = 0.03
const BATCH_SIZE = 100
const BATCH_DELAY_MS = 12000
const FORECAST_DAYS = 7

const SLICE_COUNT = Number(process.env.SLICE_COUNT ?? '1')
const SLICE_INDEX = Number(process.env.SLICE_INDEX ?? '0')

function buildGridPoints() {
  // Par INDEX, pas par accumulation `lat += STEP_DEG` : voir fetch-rain-grid.mjs.
  const rows = Math.floor((BOUNDS.latMax - BOUNDS.latMin) / STEP_DEG + 1e-6) + 1
  const cols = Math.floor((BOUNDS.lonMax - BOUNDS.lonMin) / STEP_DEG + 1e-6) + 1
  const points = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      points.push({
        lat: Math.round((BOUNDS.latMin + row * STEP_DEG) * 1000) / 1000,
        lon: Math.round((BOUNDS.lonMin + col * STEP_DEG) * 1000) / 1000,
      })
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

function pointKey(p) {
  return `${p.lat},${p.lon}`
}

// Renvoie { dates, values } — dates commun à tout le lot (même timezone/
// forecast_days pour tous les points), values un tableau de tableaux
// (un par point, aligné sur dates).
async function fetchBatch(points, attempt = 0) {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', points.map((p) => p.lat.toFixed(4)).join(','))
  url.searchParams.set('longitude', points.map((p) => p.lon.toFixed(4)).join(','))
  url.searchParams.set('daily', 'precipitation_sum')
  url.searchParams.set('forecast_days', String(FORECAST_DAYS))
  url.searchParams.set('timezone', 'Europe/Paris')
  url.searchParams.set('models', 'best_match')

  const MAX_ATTEMPTS = 5
  let res
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  } catch (err) {
    if (attempt >= MAX_ATTEMPTS) throw err
    console.log(`${err.message}, retry dans ${4 * (attempt + 1)}s…`)
    await wait(4000 * (attempt + 1))
    return fetchBatch(points, attempt + 1)
  }
  if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
    console.log(`${res.status}, retry dans ${4 * (attempt + 1)}s…`)
    await wait(4000 * (attempt + 1))
    return fetchBatch(points, attempt + 1)
  }
  if (!res.ok) throw new Error(`Open-Meteo: ${res.status}`)

  const data = await res.json()
  const results = Array.isArray(data) ? data : [data]
  let dates = []
  const values = results.map((entry) => {
    const daily = entry?.daily
    if (!daily) return []
    if (dates.length === 0) dates = daily.time
    return daily.precipitation_sum
  })
  return { dates, values }
}

const OUTPUT_PATH = new URL('../public/rain-forecast-grid.json', import.meta.url)

async function loadExisting() {
  try {
    const raw = await readFile(OUTPUT_PATH, 'utf-8')
    const data = JSON.parse(raw)
    const byKey = new Map()
    for (const p of data.points ?? []) byKey.set(pointKey(p), p)
    return { byKey, dates: data.dates ?? [] }
  } catch {
    return { byKey: new Map(), dates: [] } // premier run, ou fichier absent/corrompu
  }
}

async function writeMerged(byKey, allPoints, dates) {
  const merged = allPoints.map((p) => byKey.get(pointKey(p)) ?? { lat: p.lat, lon: p.lon, rain: [] })
  const output = { fetchedAt: new Date().toISOString(), dates, points: merged }
  await writeFile(OUTPUT_PATH, JSON.stringify(output))
}

// Voir fetch-rain-grid.mjs pour le raisonnement détaillé (ne jamais publier
// une tranche trop dégradée).
const MAX_FAILED_BATCH_RATIO = 0.05

async function main() {
  const allPoints = buildGridPoints()
  const slicePoints = allPoints.filter((_, i) => i % SLICE_COUNT === SLICE_INDEX)
  const batches = chunk(slicePoints, BATCH_SIZE)
  const { byKey: existing, dates: existingDates } = await loadExisting()
  let dates = existingDates

  console.log(
    `Grille complète : ${allPoints.length} points. Tranche ${SLICE_INDEX + 1}/${SLICE_COUNT} : ${slicePoints.length} points, ${batches.length} lots.`,
  )

  let failedBatches = 0
  for (const [i, batch] of batches.entries()) {
    if (i > 0) await wait(BATCH_DELAY_MS)

    let values
    try {
      const batchResult = await fetchBatch(batch)
      if (batchResult.dates.length > 0) dates = batchResult.dates
      values = batchResult.values
    } catch (err) {
      failedBatches++
      console.log(`Lot ${i + 1}/${batches.length} abandonné (${err.message}).`)
      values = batch.map((p) => existing.get(pointKey(p))?.rain ?? [])
    }

    batch.forEach((p, j) => existing.set(pointKey(p), { lat: p.lat, lon: p.lon, rain: values[j] ?? [] }))
    await writeMerged(existing, allPoints, dates)
    console.log(`Lot ${i + 1}/${batches.length} ok.`)
  }

  const failedRatio = batches.length === 0 ? 0 : failedBatches / batches.length
  console.log(`Terminé : ${failedBatches}/${batches.length} lot(s) en échec sur cette tranche (${Math.round(failedRatio * 100)}%).`)

  if (failedRatio > MAX_FAILED_BATCH_RATIO) {
    console.error(`Trop de lots en échec (>${Math.round(MAX_FAILED_BATCH_RATIO * 100)}%) — run abandonné, rien ne sera commité.`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
