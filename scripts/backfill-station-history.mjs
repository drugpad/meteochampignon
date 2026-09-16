#!/usr/bin/env node
// Backfill ponctuel (à lancer une fois à la main, pas par CI) : remplit
// public/station-history.json avec les dernières 24h de chaque station,
// plutôt que d'attendre 24 runs du job horaire (fetch-station-history.mjs)
// pour obtenir la même profondeur.
//
// Limite dure de l'API Météo-France (DonneesPubliquesObservation) : l'
// endpoint /station/horaire ne conserve que 24h d'historique par station
// (une date plus ancienne renvoie la donnée la plus ancienne disponible,
// pas une erreur) — impossible de remonter plus loin d'un coup. Au-delà de
// ces 24h, le cumul 10 jours ne peut que continuer à s'accumuler heure par
// heure via le job planifié (voir station-history.yml).
//
// Écrit le fichier après CHAQUE station (pas seulement à la fin) : ce script
// tourne ~2h30 (239 stations × 24h × pacing anti rate-limit), un
// Ctrl-C ou crash au milieu ne doit pas perdre la progression déjà faite.
import { readFile, writeFile } from 'node:fs/promises'

const DPOBS_BASE_URL = 'https://public-api.meteofrance.fr/public/DPObs/v2'
const HISTORY_WINDOW_HOURS = 240 // 10 jours (voir fetch-station-history.mjs)
const OUTPUT_PATH = new URL('../public/station-history.json', import.meta.url)
const STATIONS_PATH = new URL('../src/data/stations-midi-pyrenees.json', import.meta.url)

// 50 req/min max côté API — on vise ~45/min pour garder de la marge.
const REQUEST_DELAY_MS = 1300

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function apiKey() {
  const key = process.env.METEOFRANCE_API_TOKEN
  if (!key) throw new Error('METEOFRANCE_API_TOKEN manquant dans l\'environnement.')
  return key
}

// Une heure ronde UTC, `hoursAgo` heures avant maintenant — même logique que
// l'ancienne version (navigateur) de stations.ts, avant son passage au
// fichier statique.
function hourTimestamp(hoursAgo) {
  const date = new Date()
  date.setUTCMinutes(0, 0, 0)
  date.setUTCHours(date.getUTCHours() - hoursAgo)
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

async function fetchStationHour(stationId, hoursAgo, key, attempt = 0) {
  const url = new URL(`${DPOBS_BASE_URL}/station/horaire`)
  url.searchParams.set('id_station', stationId)
  url.searchParams.set('format', 'json')
  if (hoursAgo > 0) url.searchParams.set('date', hourTimestamp(hoursAgo))

  let res
  try {
    res = await fetch(url, { headers: { apikey: key }, signal: AbortSignal.timeout(15000) })
  } catch (err) {
    if (attempt >= 2) return null // trou de mesure : erreur réseau ponctuelle ignorée
    await wait(3000 * (attempt + 1))
    return fetchStationHour(stationId, hoursAgo, key, attempt + 1)
  }

  if (res.status === 429 && attempt < 2) {
    await wait(5000 * (attempt + 1))
    return fetchStationHour(stationId, hoursAgo, key, attempt + 1)
  }
  if (!res.ok) return null

  const data = await res.json()
  const obs = data[0]
  if (!obs || !obs.validity_time) return null
  return {
    time: obs.validity_time,
    rr1: typeof obs.rr1 === 'number' ? Math.max(0, obs.rr1) : null,
    temp: typeof obs.t === 'number' ? Math.round((obs.t - 273.15) * 10) / 10 : null,
  }
}

async function loadExistingHistory() {
  try {
    const raw = await readFile(OUTPUT_PATH, 'utf-8')
    return JSON.parse(raw).stations ?? {}
  } catch {
    return {}
  }
}

async function writeHistory(history) {
  const output = { fetchedAt: new Date().toISOString(), stations: history }
  await writeFile(OUTPUT_PATH, JSON.stringify(output))
}

async function main() {
  const key = apiKey()
  const stations = JSON.parse(await readFile(STATIONS_PATH, 'utf-8'))
  const history = await loadExistingHistory()
  const cutoff = Date.now() - HISTORY_WINDOW_HOURS * 60 * 60 * 1000
  const hours = Array.from({ length: 24 }, (_, i) => 23 - i) // du plus ancien au plus récent

  console.log(`Backfill : ${stations.length} stations × 24h, espacement ${REQUEST_DELAY_MS}ms (~${Math.round((stations.length * 24 * REQUEST_DELAY_MS) / 60000)} min estimées).`)

  let requestCount = 0
  for (const [si, station] of stations.entries()) {
    const points = []
    for (const h of hours) {
      if (requestCount > 0) await wait(REQUEST_DELAY_MS)
      requestCount++
      const point = await fetchStationHour(station.id, h, key)
      if (point) points.push(point)
    }

    const existing = history[station.id] ?? []
    const byTime = new Map(existing.map((p) => [p.time, p]))
    for (const p of points) byTime.set(p.time, p) // le backfill écrase un éventuel doublon du job horaire
    history[station.id] = [...byTime.values()]
      .filter((p) => new Date(p.time).getTime() >= cutoff)
      .sort((a, b) => a.time.localeCompare(b.time))

    await writeHistory(history) // checkpoint après chaque station

    console.log(`${si + 1}/${stations.length} ${station.id} (${station.name}) : ${points.length}/24 points.`)
  }

  console.log('Backfill terminé.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
