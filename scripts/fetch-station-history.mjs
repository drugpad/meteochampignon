#!/usr/bin/env node
// Collecte l'historique horaire (pluie + température) des stations Météo-
// France Midi-Pyrénées — lancé par GitHub Actions (voir
// .github/workflows/station-history.yml). Ce script ne fait QUE collecter :
// il écrit les points dans un fichier temporaire (HISTORY_TMP), et le workflow
// les fusionne ensuite dans public/station-history.json
// (scripts/merge-station-history.mjs) à partir de la dernière version de
// master — voir ce fichier pour le pourquoi (conflits de rebase sur un JSON
// d'une seule ligne).
//
// Source : API « Paquet Observations » (DPPaquetObs v2), endpoint
// /paquet/stations/horaire : UN appel renvoie toutes les stations de France
// pour UNE heure donnée (~1 Mo, ~2000 stations) — contre 239 appels avec
// l'API par station utilisée avant. Les valeurs sont identiques (54
// comparaisons pluie + température, 54 identiques).
//
// AUTO-RÉPARANT : le cron natif de GitHub n'en déclenche qu'environ un tiers
// (mesuré : 24 déclenchements sur 72 attendus sur 6 jours). Plutôt que de
// compter sur une exécution par heure, chaque run rattrape TOUTES les heures
// manquantes de la fenêtre de l'API (23h, limite stricte côté serveur : « date
// inférieure à date du jour moins 24h » -> HTTP 400). Un cron sauté ne perd
// donc plus rien tant qu'un run passe au moins une fois toutes les 23h (plus
// long trou observé : 15h). Au-delà, rattrapage manuel par station :
// backfill-station-history.yml (l'API par station remonte ~4 jours, non
// documenté — la doc officielle annonce 24h).
//
// Une heure H est publiée vers H+10 min. L'API Paquet est limitée à 100
// requêtes/minute (palier de la clé) ; on en fait 24 au plus, espacées.
import { readFile, writeFile } from 'node:fs/promises'

const PAQUET_URL = 'https://public-api.meteofrance.fr/public/DPPaquetObs/v2/paquet/stations/horaire'
const STATION_URL = 'https://public-api.meteofrance.fr/public/DPObs/v2/station/horaire'
const TMP_PATH = process.env.HISTORY_TMP ?? 'history-new-points.json'
// HISTORY_FILE : surcharge pour les tests (historique de substitution).
const HISTORY_PATH = process.env.HISTORY_FILE ?? new URL('../public/station-history.json', import.meta.url)
const STATIONS_PATH = new URL('../src/data/stations-midi-pyrenees.json', import.meta.url)

const HOUR_MS = 3600000
const WINDOW_HOURS = 23 // limite stricte de l'API Paquet (< 24h)
const PUBLICATION_LAG_MS = 15 * 60 * 1000 // observation de l'heure H publiée vers H+10 min
// Une heure est considérée comme déjà complète si au moins ce ratio des
// stations y a un point. Pas 100% : quelques stations ne transmettent pas
// toutes leurs heures (~3 sur 239 par heure), elles ne se rempliront jamais.
const COMPLETE_RATIO = 0.95
// Les dernières heures sont toujours re-demandées : les stations en retard
// de transmission complètent une heure après sa première publication.
const ALWAYS_REFETCH_LAST_HOURS = 3
const REQUEST_DELAY_MS = 700

// RATTRAPAGE PROFOND : au-delà de 23h le paquet ne répond plus (HTTP 400), mais
// l'API par station remonte ~4 jours en pratique (non documenté : la doc
// annonce 24h). Si un trou dépasse 23h (cron GitHub en panne plusieurs
// heures de suite), on comble station par station les heures encore
// récupérables, les plus anciennes d'abord (ce sont elles qui vont expirer).
// Budget d'appels par run pour rester sous la limite de 50 req/min de cette
// API et sous le timeout du job ; le reste est repris au run suivant.
const DEEP_MAX_HOURS = 95
const DEEP_CALL_BUDGET = Number(process.env.DEEP_BUDGET ?? 700)
const DEEP_DELAY_MS = 1450

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function apiKey() {
  const key = process.env.METEOFRANCE_API_TOKEN
  if (!key) throw new Error('METEOFRANCE_API_TOKEN manquant (secret GitHub Actions).')
  return key
}

const isoHour = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z')

function toPoint(obs) {
  return {
    time: obs.validity_time,
    rr1: typeof obs.rr1 === 'number' ? Math.max(0, obs.rr1) : null,
    temp: typeof obs.t === 'number' ? Math.round((obs.t - 273.15) * 10) / 10 : null,
  }
}

// GET avec retries ; renvoie { status, body } (body = JSON ou null). Un échec
// réseau ou 5xx ponctuel ne doit pas faire échouer tout le run ; le journal
// garde la CAUSE réelle de l'erreur réseau (err.cause), pas seulement
// « fetch failed ».
async function getJson(url, key, attempt = 0) {
  let res
  try {
    res = await fetch(url, { headers: { apikey: key }, signal: AbortSignal.timeout(30000) })
  } catch (err) {
    const cause = err.cause?.code ?? err.cause?.message ?? err.message
    if (attempt >= 3) {
      console.log(`  erreur réseau (${cause}), abandon.`)
      return { status: 0, body: null }
    }
    console.log(`  erreur réseau (${cause}), nouvel essai…`)
    await wait(3000 * (attempt + 1))
    return getJson(url, key, attempt + 1)
  }
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    await wait(5000 * (attempt + 1))
    return getJson(url, key, attempt + 1)
  }
  if (!res.ok) return { status: res.status, body: null }
  return { status: res.status, body: await res.json() }
}

async function loadHistory() {
  try {
    return JSON.parse(await readFile(HISTORY_PATH, 'utf-8')).stations ?? {}
  } catch {
    return {} // premier run, ou fichier absent/corrompu
  }
}

// Heures de la fenêtre à (re)demander : celles où trop peu de stations ont un
// point dans l'historique déjà en place, plus les dernières heures.
function hoursToFetch(history, stationIds, now) {
  const first = Math.ceil((now - WINDOW_HOURS * HOUR_MS) / HOUR_MS) * HOUR_MS
  const last = Math.floor((now - PUBLICATION_LAG_MS) / HOUR_MS) * HOUR_MS
  const have = new Map() // heure ISO -> nombre de stations ayant un point
  for (const id of stationIds) {
    for (const p of history[id] ?? []) have.set(p.time, (have.get(p.time) ?? 0) + 1)
  }
  const hours = []
  for (let t = first; t <= last; t += HOUR_MS) {
    const iso = isoHour(t)
    const recent = last - t < ALWAYS_REFETCH_LAST_HOURS * HOUR_MS
    if (recent || (have.get(iso) ?? 0) < COMPLETE_RATIO * stationIds.length) hours.push(iso)
  }
  return { hours, last }
}

// Heures de la zone profonde (de DEEP_MAX_HOURS à WINDOW_HOURS en arrière) où
// trop peu de stations ont un point, avec les stations manquantes de chacune.
function deepGaps(history, stationIds, now) {
  const first = Math.ceil((now - DEEP_MAX_HOURS * HOUR_MS) / HOUR_MS) * HOUR_MS
  const end = Math.ceil((now - WINDOW_HOURS * HOUR_MS) / HOUR_MS) * HOUR_MS // exclu : couvert par le paquet
  const present = new Map() // heure ISO -> Set des stations ayant un point
  for (const id of stationIds) {
    for (const p of history[id] ?? []) {
      if (!present.has(p.time)) present.set(p.time, new Set())
      present.get(p.time).add(id)
    }
  }
  const gaps = []
  for (let t = first; t < end; t += HOUR_MS) {
    const iso = isoHour(t)
    const have = present.get(iso) ?? new Set()
    if (have.size >= COMPLETE_RATIO * stationIds.length) continue
    gaps.push({ iso, missing: stationIds.filter((id) => !have.has(id)) })
  }
  return gaps
}

async function main() {
  const key = apiKey()
  const stations = JSON.parse(await readFile(STATIONS_PATH, 'utf-8'))
  const ids = stations.map((s) => s.id)
  const mine = new Set(ids)
  const history = await loadHistory()
  const now = Date.now()
  const { hours, last } = hoursToFetch(history, ids, now)

  console.log(`Fenêtre ${WINDOW_HOURS}h : ${hours.length} heure(s) à récupérer (1 appel chacune).`)

  const collected = {}
  let received = 0
  try {
    for (const [i, hour] of hours.entries()) {
      if (i > 0) await wait(REQUEST_DELAY_MS)
      const url = `${PAQUET_URL}?date=${encodeURIComponent(hour)}&format=json`
      const { status, body } = await getJson(url, key)
      if (!body) {
        console.log(`  ${hour} : HTTP ${status}, ignorée.`)
        continue
      }
      let n = 0
      for (const obs of body) {
        if (!mine.has(obs.geo_id_insee) || !obs.validity_time) continue
        ;(collected[obs.geo_id_insee] ??= []).push(toPoint(obs))
        n++
      }
      received++
      console.log(`  ${hour} : ${n}/${ids.length} stations.`)
    }

    // Filet de sécurité : si le paquet est totalement indisponible (abonnement
    // perdu, panne), on retombe sur l'API par station pour l'heure courante
    // seulement — de quoi ne pas laisser un trou systématique pendant la panne.
    if (hours.length > 0 && received === 0) {
      console.log('API Paquet indisponible : repli sur l\'API par station (heure courante).')
      const lastIso = isoHour(last)
      for (const [i, id] of ids.entries()) {
        if (i > 0) await wait(1700)
        const url = `${STATION_URL}?id_station=${id}&date=${encodeURIComponent(lastIso)}&format=json`
        const { body } = await getJson(url, key)
        const obs = body?.[0]
        if (obs?.validity_time) (collected[id] ??= []).push(toPoint(obs))
      }
      received = Object.keys(collected).length > 0 ? 1 : 0
    }

    // Rattrapage profond (voir DEEP_*), seulement si le paquet fonctionne :
    // sinon la clé ou le service est en cause et on ne martèle pas l'API.
    if (received > 0) {
      let budget = DEEP_CALL_BUDGET
      const gaps = deepGaps(history, ids, now)
      if (gaps.length > 0) {
        console.log(`Rattrapage profond : ${gaps.length} heure(s) hors fenêtre du paquet à compléter (budget ${budget} appels).`)
      }
      for (const gap of gaps) {
        if (budget <= 0) break
        let got = 0
        for (const id of gap.missing) {
          if (budget <= 0) break
          budget--
          await wait(DEEP_DELAY_MS)
          const url = `${STATION_URL}?id_station=${id}&date=${encodeURIComponent(gap.iso)}&format=json`
          const { body } = await getJson(url, key)
          const obs = body?.[0]
          if (obs?.validity_time === gap.iso) {
            ;(collected[id] ??= []).push(toPoint(obs))
            got++
          }
        }
        console.log(`  ${gap.iso} : +${got} point(s) (${gap.missing.length} stations manquantes).`)
      }
    }
  } finally {
    // Même si le run est interrompu en cours de route, on garde ce qui a
    // déjà été collecté (le workflow fusionne avec `if: always()`).
    await writeFile(TMP_PATH, JSON.stringify(collected))
    const points = Object.values(collected).reduce((s, a) => s + a.length, 0)
    console.log(`${points} point(s) collecté(s) -> ${TMP_PATH}`)
  }

  if (hours.length > 0 && received === 0) {
    console.error('Aucune donnée récupérée (ni Paquet, ni API par station).')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
