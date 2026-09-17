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
// Synchro à la main avec RAIN_GRID_STEP_DEG dans src/lib/config.ts.
const STEP_DEG = 0.03
const BATCH_SIZE = 100
// 12s -> 15s après le passage à 0.03° (10800 points, ~40 min de run soutenu)
// : au-delà d'une grille à ~1500 points (~6 min), des 429 persistants
// apparaissaient en fin de run malgré le retry par lot (voir plus bas) —
// signe d'un quota cumulé sur la durée, pas juste un débit instantané.
const BATCH_DELAY_MS = 15000

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
  // MAX_ATTEMPTS et le backoff sont plus généreux que la version initiale
  // (5 tentatives, 4s*attempt) : à 10800 points, un 429 en fin de run met
  // parfois plus longtemps à se dissiper (observé : encore en échec après
  // 4+8+12+16+20s de pauses cumulées).
  const MAX_ATTEMPTS = 6
  let res
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  } catch (err) {
    if (attempt >= MAX_ATTEMPTS) throw err
    console.log(`${err.message}, retry dans ${6 * (attempt + 1)}s…`)
    await wait(6000 * (attempt + 1))
    return fetchBatch(points, attempt + 1)
  }
  // 429 = rate-limit (Open-Meteo semble limiter le débit par nombre de
  // points traités, pas juste par requête HTTP) ; 5xx = erreur transitoire
  // côté Open-Meteo (503 isolé déjà observé aussi).
  if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
    console.log(`${res.status}, retry dans ${6 * (attempt + 1)}s…`)
    await wait(6000 * (attempt + 1))
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

const OUTPUT_PATH = new URL('../public/rain-grid.json', import.meta.url)

async function writeResults(results) {
  const output = { fetchedAt: new Date().toISOString(), points: results }
  await writeFile(OUTPUT_PATH, JSON.stringify(output))
}

// Au-delà de ce taux de lots en échec, le run est jugé trop dégradé pour
// être mis en ligne — mieux vaut garder l'ancienne grille (encore bonne)
// que de publier une carte trouée où les zones manquantes s'afficheraient
// comme "0mm" (RainOverlay traite null comme 0, voir son commentaire) :
// ça pourrait laisser croire qu'une zone est sèche alors qu'on n'a
// simplement pas pu vérifier. En dessous du seuil, quelques trous isolés
// sont un compromis acceptable plutôt que de perdre tout le run pour un
// 429 ponctuel.
const MAX_FAILED_BATCH_RATIO = 0.05

async function main() {
  const points = buildGridPoints()
  const batches = chunk(points, BATCH_SIZE)
  const results = []
  let failedBatches = 0

  console.log(`Grille : ${points.length} points, ${batches.length} lots.`)

  for (const [i, batch] of batches.entries()) {
    if (i > 0) await wait(BATCH_DELAY_MS)

    // Un lot qui échoue malgré les retries (429 persistant en fin de run,
    // voir BATCH_DELAY_MS) ne doit pas faire perdre tout le travail déjà
    // fait sur les lots précédents — on le marque en trou (points à null)
    // et on continue, plutôt que de planter tout le run immédiatement.
    // Écrit sur le disque du runner après chaque lot (pas seulement à la
    // fin) : rien n'est perdu en cas de Ctrl-C/timeout, mais ça reste sans
    // conséquence tant que l'étape "Commit si changement" du workflow n'a
    // pas tourné (le disque du runner est jeté à la fin du job) — voir le
    // seuil MAX_FAILED_BATCH_RATIO plus bas, qui décide si on va jusque-là.
    let values
    try {
      values = await fetchBatch(batch)
    } catch (err) {
      failedBatches++
      console.log(`Lot ${i + 1}/${batches.length} abandonné (${err.message}) — points laissés à null.`)
      values = batch.map(() => null)
    }

    batch.forEach((p, j) => results.push({ lat: p.lat, lon: p.lon, rain24h: values[j] }))
    await writeResults(results)
    console.log(`Lot ${i + 1}/${batches.length} ok (${results.length}/${points.length} points)`)
  }

  const failedRatio = failedBatches / batches.length
  console.log(`Terminé : ${failedBatches}/${batches.length} lot(s) en échec (${Math.round(failedRatio * 100)}%).`)

  if (failedRatio > MAX_FAILED_BATCH_RATIO) {
    // Le fichier local reste écrit (utile pour inspection dans les logs du
    // job), mais on sort en erreur pour que l'étape "Commit si changement"
    // du workflow ne s'exécute pas — l'ancienne grille en prod n'est pas
    // remplacée par une version trop dégradée.
    console.error(`Trop de lots en échec (>${Math.round(MAX_FAILED_BATCH_RATIO * 100)}%) — run abandonné, rien ne sera commité.`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
