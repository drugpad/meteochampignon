#!/usr/bin/env node
// Rattrapage ponctuel de public/station-history.json : l'API Météo-France
// (DPObs v2, /station/horaire) accepte un paramètre `date` et garde environ
// 4 jours d'observations horaires (vérifié le 03/10/2026 : réponse vide avant
// le 29/09 00:00 UTC). Sert à combler les heures manquées quand le job
// horaire tournait seulement toutes les 12h (voir station-history.yml : `rr1`
// ne couvre que l'heure précédente, donc les heures non échantillonnées
// étaient des averses perdues).
//
// Deux modes, pour pouvoir committer même si le run est interrompu et pour
// ne pas écraser les points écrits entre-temps par le job horaire :
//   collect : tire les heures manquantes de la tranche de stations
//             BACKFILL_SLICE / BACKFILL_SLICE_COUNT dans un fichier temporaire
//             (BACKFILL_TMP), sauvegardé après chaque station.
//   merge   : fusionne ce fichier temporaire dans le fichier d'historique
//             FRAIS (relu juste avant d'écrire), sans toucher aux autres points.
import { readFile, writeFile } from 'node:fs/promises'
import { mergeStationHistory } from './merge-station-history.mjs'

const DPOBS_BASE_URL = 'https://public-api.meteofrance.fr/public/DPObs/v2'
const RETENTION_DAYS = 4 // l'API garde ~J-4 00:00 UTC
const OUTPUT_PATH = new URL('../public/station-history.json', import.meta.url)
const STATIONS_PATH = new URL('../src/data/stations-midi-pyrenees.json', import.meta.url)
const TMP_PATH = process.env.BACKFILL_TMP ?? 'backfill-points.json'

// ~40 req/min (limite API : 50/min). Le job horaire tourne en parallèle
// ~7 min par heure : les 429 sont attendus pendant ce chevauchement et
// réessayés (voir fetchHour).
const REQUEST_DELAY_MS = 1500

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function apiKey() {
  const key = process.env.METEOFRANCE_API_TOKEN
  if (!key) throw new Error('METEOFRANCE_API_TOKEN manquant (secret GitHub Actions).')
  return key
}

// `null` = pas de donnée pour cette heure (hors rétention, station muette) ;
// ne fait jamais échouer le run.
async function fetchHour(stationId, hourIso, key, attempt = 0) {
  const url = new URL(`${DPOBS_BASE_URL}/station/horaire`)
  url.searchParams.set('id_station', stationId)
  url.searchParams.set('date', hourIso)
  url.searchParams.set('format', 'json')

  let res
  try {
    res = await fetch(url, { headers: { apikey: key }, signal: AbortSignal.timeout(15000) })
  } catch {
    if (attempt >= 3) return null
    await wait(3000 * (attempt + 1))
    return fetchHour(stationId, hourIso, key, attempt + 1)
  }
  if (res.status === 429 && attempt < 5) {
    await wait(15000 * (attempt + 1))
    return fetchHour(stationId, hourIso, key, attempt + 1)
  }
  if (!res.ok) return null

  const obs = (await res.json())[0]
  if (!obs || !obs.validity_time) return null
  return {
    time: obs.validity_time,
    rr1: typeof obs.rr1 === 'number' ? Math.max(0, obs.rr1) : null,
    temp: typeof obs.t === 'number' ? Math.round((obs.t - 273.15) * 10) / 10 : null,
  }
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf-8'))
  } catch {
    return fallback
  }
}

// Heures pleines UTC, de J-RETENTION_DAYS 00:00 jusqu'à l'heure pleine courante.
function candidateHours() {
  const now = new Date()
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - RETENTION_DAYS)
  const end = Math.floor(now.getTime() / 3600000) * 3600000
  const hours = []
  for (let t = start; t <= end; t += 3600000) hours.push(new Date(t).toISOString().replace('.000Z', 'Z'))
  return hours
}

async function collect() {
  const key = apiKey()
  const sliceIndex = Number(process.env.BACKFILL_SLICE ?? 0)
  const sliceCount = Number(process.env.BACKFILL_SLICE_COUNT ?? 1)
  const all = JSON.parse(await readFile(STATIONS_PATH, 'utf-8'))
  const stations = all.filter((_, i) => i % sliceCount === sliceIndex)
  const history = (await readJson(OUTPUT_PATH, {})).stations ?? {}
  const hours = candidateHours()
  const collected = await readJson(TMP_PATH, {})

  console.log(`Tranche ${sliceIndex + 1}/${sliceCount} : ${stations.length} stations, ${hours.length} heures candidates.`)

  let calls = 0
  for (const [n, station] of stations.entries()) {
    const have = new Set((history[station.id] ?? []).map((p) => p.time))
    const points = collected[station.id] ?? []
    for (const p of points) have.add(p.time)

    for (const hourIso of hours) {
      if (have.has(hourIso)) continue
      await wait(REQUEST_DELAY_MS)
      calls++
      const point = await fetchHour(station.id, hourIso, key)
      if (point && !have.has(point.time)) {
        points.push(point)
        have.add(point.time)
      }
    }
    collected[station.id] = points
    await writeFile(TMP_PATH, JSON.stringify(collected))
    console.log(`  ${n + 1}/${stations.length} ${station.id} : ${points.length} points, ${calls} appels.`)
  }
}

// Conservé pour les workflows déjà lancés (ils l'appellent après leur
// `git reset --hard origin/master`) — la logique vit dans
// merge-station-history.mjs, partagée avec le job horaire.
async function merge() {
  const added = await mergeStationHistory(TMP_PATH)
  console.log(`${added} points ajoutés à public/station-history.json`)
}

const mode = process.argv[2]
const run = mode === 'collect' ? collect : mode === 'merge' ? merge : null
if (!run) {
  console.error('Usage : node backfill-station-history.mjs collect|merge')
  process.exit(1)
}
run().catch((err) => {
  console.error(err)
  process.exit(1)
})
