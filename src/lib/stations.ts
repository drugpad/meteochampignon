// Module Stations — points cliquables sur la carte en mode Historique.
//
// Utilise l'API "Données d'observation" de Météo-France (DPObs v2),
// souscrite avec le même token que le radar (voir meteoFranceRadar.ts) —
// gratuite, ~2000 stations RADOME nationales, pas de clé Infoclimat requise
// pour une bonne densité sur Midi-Pyrénées (239 stations dans l'emprise, la
// liste complète a été récupérée une fois via /liste-stations et filtrée
// dans src/data/stations-midi-pyrenees.json plutôt que refaite à chaque
// chargement — la liste des stations ne change quasiment jamais).
//
// Le réseau Infoclimat (StatIC), prévu en complément dans la spec pour
// densifier encore, nécessite son propre compte + clé API gratuite
// (https://www.infoclimat.fr/opendata/) — pas branché pour l'instant, voir
// CLAUDE.md "Comptes à créer".
import stationsData from '../data/stations-midi-pyrenees.json'
import { getDailyForecast } from './openMeteo'
import type { Station, StationDetail } from '../types'

export const STATIC_STATIONS: Station[] = (
  stationsData as { id: string; name: string; lat: number; lon: number; altitude: number }[]
).map((s) => ({ ...s, network: 'synop' as const }))

const DPOBS_BASE_URL = 'https://public-api.meteofrance.fr/public/DPObs/v2'

function apiKey(): string {
  const key = import.meta.env.VITE_METEOFRANCE_API_TOKEN
  if (!key) {
    throw new Error(
      "VITE_METEOFRANCE_API_TOKEN manquant — voir .env.example (données de station Météo-France).",
    )
  }
  return key
}

type HourlyObservation = {
  validity_time: string
  t: number | null // Kelvin
  rr1: number | null // mm, cumul de l'heure précédente
}

// Une heure ronde UTC, `hoursAgo` heures avant maintenant (ex. "2026-09-09T14:00:00Z").
function hourTimestamp(hoursAgo: number): string {
  const date = new Date()
  date.setUTCMinutes(0, 0, 0)
  date.setUTCHours(date.getUTCHours() - hoursAgo)
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

async function fetchHourlyObservation(stationId: string, hoursAgo: number): Promise<HourlyObservation | null> {
  const url = new URL(`${DPOBS_BASE_URL}/station/horaire`)
  url.searchParams.set('id_station', stationId)
  url.searchParams.set('format', 'json')
  if (hoursAgo > 0) url.searchParams.set('date', hourTimestamp(hoursAgo))

  const res = await fetch(url, { headers: { apikey: apiKey() } })
  if (!res.ok) return null // heure sans donnée (trou de mesure) : on l'ignore plutôt que de faire échouer tout le graphique
  const data = (await res.json()) as HourlyObservation[]
  return data[0] ?? null
}

export async function fetchStationDetail(station: Station): Promise<StationDetail> {
  const hours = Array.from({ length: 24 }, (_, i) => 23 - i) // du plus ancien au plus récent
  const [observations, miniForecast] = await Promise.all([
    Promise.all(hours.map((h) => fetchHourlyObservation(station.id, h))),
    getDailyForecast({ lat: station.lat, lon: station.lon }, 5),
  ])

  const rainHistory: { time: string; rain: number }[] = []
  const tempHistory: { time: string; temp: number }[] = []
  observations.forEach((obs) => {
    if (!obs) return
    if (obs.rr1 !== null) rainHistory.push({ time: obs.validity_time, rain: Math.max(0, obs.rr1) })
    if (obs.t !== null) tempHistory.push({ time: obs.validity_time, temp: Math.round((obs.t - 273.15) * 10) / 10 })
  })

  return { station, rainHistory, tempHistory, miniForecast }
}
