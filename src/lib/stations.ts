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
// L'historique horaire (pluie + température, jusqu'à 10 jours) n'est PAS
// tiré en direct depuis le navigateur au clic : un job GitHub Actions
// (voir scripts/fetch-station-history.mjs) accumule un point par station et
// par heure dans public/station-history.json, lu ici une seule fois par
// session (même principe que public/rain-grid.json pour la carte de pluie).
// Deux raisons : 24 appels en parallèle par station tirés depuis le
// navigateur déclenchaient par moments des erreurs réseau pures ("Failed to
// fetch") en rafale, et l'API ne renvoie qu'une heure à la fois — remonter
// à 10 jours en direct aurait voulu dire 240 appels par clic.
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

const HISTORY_URL = '/station-history.json'

type HistoryPoint = { time: string; rr1: number | null; temp: number | null }
type HistoryByStation = Record<string, HistoryPoint[]>

// Un seul fetch du fichier statique par session (pas un par clic sur une
// station) : promesse mémoïsée, remise à zéro en cas d'échec pour permettre
// un nouvel essai au clic suivant plutôt que de rester bloqué sur une
// erreur transitoire (ex. déploiement en cours).
let historyPromise: Promise<HistoryByStation> | null = null

function loadHistory(): Promise<HistoryByStation> {
  if (!historyPromise) {
    historyPromise = fetch(HISTORY_URL, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error("Historique des stations indisponible (fichier absent).")
        return res.json() as Promise<{ stations: HistoryByStation }>
      })
      .then((data) => data.stations ?? {})
      .catch((err) => {
        historyPromise = null
        throw err
      })
  }
  return historyPromise
}

function dayKey(isoTime: string): string {
  return isoTime.slice(0, 10) // yyyy-mm-dd (validity_time est en UTC, comme pour la grille de pluie)
}

export async function fetchStationDetail(station: Station): Promise<StationDetail> {
  const [historyByStation, miniForecast] = await Promise.all([
    loadHistory(),
    getDailyForecast({ lat: station.lat, lon: station.lon }, 5),
  ])

  const points = (historyByStation[station.id] ?? []).slice().sort((a, b) => a.time.localeCompare(b.time))
  const last24h = points.slice(-24)

  const rainHistory = last24h
    .filter((p) => p.rr1 !== null)
    .map((p) => ({ time: p.time, rain: p.rr1 as number }))
  const tempHistory = last24h
    .filter((p) => p.temp !== null)
    .map((p) => ({ time: p.time, temp: p.temp as number }))

  // Cumul par jour calendaire (UTC) sur toute la fenêtre disponible (jusqu'à
  // 10 jours) — un jour partiel (premier jour de la fenêtre glissante, ou
  // jour courant pas terminé) reste inclus tel quel plutôt qu'exclu.
  const dailyTotals = new Map<string, number>()
  for (const p of points) {
    if (p.rr1 === null) continue
    const key = dayKey(p.time)
    dailyTotals.set(key, (dailyTotals.get(key) ?? 0) + p.rr1)
  }
  const dailyRain = [...dailyTotals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rain]) => ({ date, rain: Math.round(rain * 10) / 10 }))

  return { station, rainHistory, tempHistory, dailyRain, miniForecast }
}
