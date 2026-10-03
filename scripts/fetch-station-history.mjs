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
// Ce script ne fait QUE collecter : il écrit les points de l'heure dans un
// fichier temporaire (HISTORY_TMP), et le workflow les fusionne ensuite dans
// public/station-history.json (scripts/merge-station-history.mjs) à partir de
// la dernière version de master — voir ce fichier pour le pourquoi (conflits
// de rebase sur un JSON d'une seule ligne). Fenêtre glissante de 10 jours
// (240h) appliquée à la fusion. Un run manqué (échec du job, redéploiement,
// etc.) laisse simplement un trou dans la série pour cette heure-là — toléré,
// pas bloquant (même philosophie que les trous horaires déjà tolérés dans
// stations.ts).
import { readFile, writeFile } from 'node:fs/promises'

const DPOBS_BASE_URL = 'https://public-api.meteofrance.fr/public/DPObs/v2'
const TMP_PATH = process.env.HISTORY_TMP ?? 'history-new-points.json'
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

  // Plus patient que le strict nécessaire : ce job peut chevaucher le
  // rattrapage ponctuel (backfill-station-history.yml), qui partage la
  // limite de débit de l'API.
  if (res.status === 429 && attempt < 4) {
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

async function main() {
  const key = apiKey()
  const stations = JSON.parse(await readFile(STATIONS_PATH, 'utf-8'))
  const collected = {}

  console.log(`Stations : ${stations.length}, espacement ${REQUEST_DELAY_MS}ms.`)

  try {
    for (const [i, station] of stations.entries()) {
      if (i > 0) await wait(REQUEST_DELAY_MS)
      const point = await fetchStationHour(station.id, key)
      if (point) collected[station.id] = [point]
    }
  } finally {
    // Même si le run est interrompu en cours de route, on garde ce qui a
    // déjà été collecté (le workflow fusionne avec `if: always()`).
    await writeFile(TMP_PATH, JSON.stringify(collected))
    console.log(`${Object.keys(collected).length}/${stations.length} stations collectées -> ${TMP_PATH}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
