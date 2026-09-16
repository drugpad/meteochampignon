#!/usr/bin/env node
// Accumule l'historique horaire (pluie + température) des stations Météo-
// France Midi-Pyrénées dans public/station-history.json — lancé toutes les
// heures par GitHub Actions (voir .github/workflows/station-history.yml).
//
// Remplace les 24 appels en parallèle que faisait le navigateur au clic sur
// une station (src/lib/stations.ts) : en rafale, ces 24 appels simultanés
// vers l'API Météo-France déclenchaient par moments des erreurs réseau pures
// ("Failed to fetch", pas un statut HTTP) — un souci de fiabilité en plus
// d'empêcher tout historique au-delà de 24h. Ici, un seul point par station
// est tiré à chaque run (239 appels espacés, pas 24 en rafale), accumulé
// heure après heure dans un fichier statique que l'appli lit directement
// (comme public/rain-grid.json pour la carte de pluie) — même principe :
// quasi instantané côté navigateur, plus aucun appel direct au clic.
//
// Fenêtre glissante de 10 jours (240h) : les entrées plus anciennes sont
// purgées à chaque run. Un run manqué (échec du job, redéploiement, etc.)
// laisse simplement un trou dans la série pour cette heure-là — toléré,
// pas bloquant (même philosophie que les trous horaires déjà tolérés dans
// stations.ts).
import { readFile, writeFile } from 'node:fs/promises'

const DPOBS_BASE_URL = 'https://public-api.meteofrance.fr/public/DPObs/v2'
const HISTORY_WINDOW_HOURS = 240 // 10 jours
const OUTPUT_PATH = new URL('../public/station-history.json', import.meta.url)
const STATIONS_PATH = new URL('../src/data/stations-midi-pyrenees.json', import.meta.url)

// Espacement entre appels (ms) — l'API Données d'observation est limitée à
// 50 req/min ; on vise ~35/min pour garder de la marge (le run entier tient
// alors dans le timeout du job, voir station-history.yml).
const REQUEST_DELAY_MS = 1700

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function apiKey() {
  const key = process.env.METEOFRANCE_API_TOKEN
  if (!key) throw new Error('METEOFRANCE_API_TOKEN manquant (secret GitHub Actions).')
  return key
}

// Un échec réseau ponctuel (timeout, DNS, reset) ou un statut HTTP en erreur
// pour UNE station ne doit pas faire échouer tout le run — voir même logique
// dans fetch-rain-grid.mjs (retry avec pause croissante) et le commentaire
// en tête de fichier.
async function fetchStationHour(stationId, key, attempt = 0) {
  const url = new URL(`${DPOBS_BASE_URL}/station/horaire`)
  url.searchParams.set('id_station', stationId)
  url.searchParams.set('format', 'json')

  let res
  try {
    res = await fetch(url, { headers: { apikey: key }, signal: AbortSignal.timeout(15000) })
  } catch (err) {
    if (attempt >= 2) {
      console.log(`  ${stationId} : erreur réseau (${err.message}), abandon pour ce run.`)
      return null
    }
    await wait(3000 * (attempt + 1))
    return fetchStationHour(stationId, key, attempt + 1)
  }

  if (res.status === 429 && attempt < 2) {
    await wait(5000 * (attempt + 1))
    return fetchStationHour(stationId, key, attempt + 1)
  }
  if (!res.ok) return null // trou de mesure pour cette station à cette heure : ignoré

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
    return {} // premier run, ou fichier absent/corrompu
  }
}

async function main() {
  const key = apiKey()
  const stations = JSON.parse(await readFile(STATIONS_PATH, 'utf-8'))
  const history = await loadExistingHistory()
  const cutoff = Date.now() - HISTORY_WINDOW_HOURS * 60 * 60 * 1000

  console.log(`Stations : ${stations.length}, espacement ${REQUEST_DELAY_MS}ms.`)

  let updated = 0
  for (const [i, station] of stations.entries()) {
    if (i > 0) await wait(REQUEST_DELAY_MS)
    const point = await fetchStationHour(station.id, key)
    if (!point) continue

    const existing = history[station.id] ?? []
    // Le run tourne pile à l'heure, mais évite un doublon si relancé à la
    // main (workflow_dispatch) sur la même heure que le dernier run auto.
    const withoutDuplicate = existing.filter((p) => p.time !== point.time)
    const merged = [...withoutDuplicate, point]
      .filter((p) => new Date(p.time).getTime() >= cutoff)
      .sort((a, b) => a.time.localeCompare(b.time))
    history[station.id] = merged
    updated++
  }

  console.log(`${updated}/${stations.length} stations mises à jour.`)

  const output = { fetchedAt: new Date().toISOString(), stations: history }
  await writeFile(OUTPUT_PATH, JSON.stringify(output))
  console.log('Écrit dans public/station-history.json')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
