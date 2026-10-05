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
// session (les cartes de pluie suivent le même principe : fichiers statiques
// générés par un job planifié, voir rainMaps.ts).
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

// Page d'observations Météociel d'une station. Météociel accepte l'identifiant
// Météo-France numérique (sans le zéro initial, ex. "09024004" -> 9024004) dans
// `code2`, y compris pour les stations qui ont aussi un code OMM (ex.
// 31069001 Toulouse-Blagnac redirige bien vers la même page que code2=7630).
export function meteocielStationUrl(stationId: string): string {
  return `https://www.meteociel.fr/temps-reel/obs_villes.php?code2=${Number(stationId)}`
}

const HISTORY_URL = '/station-history.json'

type HistoryPoint = { time: string; rr1: number | null; temp: number | null }
type HistoryByStation = Record<string, HistoryPoint[]>

// Le fichier statique est lu une fois puis gardé en mémoire (promesse
// mémoïsée : pas un fetch par clic sur une station), mais seulement
// HISTORY_MAX_AGE_MS — un onglet resté ouvert pendant des heures doit voir
// les nouvelles heures (et la disparition des avertissements « incomplet »)
// sans rechargement de la page. Remise à zéro aussi en cas d'échec, pour
// permettre un nouvel essai au clic suivant plutôt que de rester bloqué sur
// une erreur transitoire (ex. déploiement en cours).
const HISTORY_MAX_AGE_MS = 10 * 60 * 1000
let historyPromise: Promise<HistoryByStation> | null = null
let historyLoadedAt = 0

function loadHistory(): Promise<HistoryByStation> {
  if (historyPromise && Date.now() - historyLoadedAt > HISTORY_MAX_AGE_MS) historyPromise = null
  if (!historyPromise) {
    historyLoadedAt = Date.now()
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

const HOUR_MS = 3600000
const HISTORY_WINDOW_MS = 240 * HOUR_MS // même fenêtre que fetch-station-history.mjs
// Latence de publication d'une observation horaire côté Météo-France : on
// n'attend pas encore la dernière heure ronde juste après qu'elle a sonné.
const PUBLICATION_LAG_MS = 30 * 60 * 1000
export const COMPLETE_RATIO = 0.8

// Jours calendaires à l'heure de PARIS (pas UTC) : c'est la journée que
// l'utilisateur a vécue et celle que Météociel affiche — en UTC, la pluie
// tombée entre minuit et 2h (été) était comptée sur la veille. Une
// observation horaire (`rr1`) est la pluie de l'heure qui PRÉCÈDE son horodatage :
// l'observation de 00:00 locale appartient donc à la veille (d'où le décalage
// d'une heure).
const PARIS_DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }) // yyyy-mm-dd

function dayKeyOfObservation(timeMs: number): string {
  return PARIS_DAY_FORMATTER.format(new Date(timeMs - HOUR_MS))
}

// Nombre d'observations attendues par jour dans la fenêtre glissante, de la
// plus ancienne heure encore conservée jusqu'à maintenant : un jour partiel
// (début de fenêtre, jour courant) est comparé à ce qui pouvait exister.
function expectedObservationsPerDay(now: number): Map<string, number> {
  const expected = new Map<string, number>()
  const first = Math.ceil((now - HISTORY_WINDOW_MS) / HOUR_MS) * HOUR_MS
  const last = Math.floor((now - PUBLICATION_LAG_MS) / HOUR_MS) * HOUR_MS
  for (let t = first; t <= last; t += HOUR_MS) {
    const key = dayKeyOfObservation(t)
    expected.set(key, (expected.get(key) ?? 0) + 1)
  }
  return expected
}

export async function fetchStationDetail(station: Station): Promise<StationDetail> {
  const [historyByStation, miniForecast] = await Promise.all([
    loadHistory(),
    getDailyForecast({ lat: station.lat, lon: station.lon }, 5),
  ])

  const points = (historyByStation[station.id] ?? []).slice().sort((a, b) => a.time.localeCompare(b.time))
  const now = Date.now()
  // 24 dernières HEURES (pas les 24 derniers points : avec un historique
  // clairsemé, 24 points peuvent s'étaler sur plusieurs jours).
  const last24h = points.filter((p) => new Date(p.time).getTime() > now - 24 * HOUR_MS)

  const rainHistory = last24h
    .filter((p) => p.rr1 !== null)
    .map((p) => ({ time: p.time, rain: p.rr1 as number }))
  const tempHistory = last24h
    .filter((p) => p.temp !== null)
    .map((p) => ({ time: p.time, temp: p.temp as number }))

  // Cumul par jour calendaire (Paris) sur toute la fenêtre disponible
  // (jusqu'à 10 jours) — un jour partiel (premier jour de la fenêtre
  // glissante, ou jour courant pas terminé) reste inclus tel quel plutôt
  // qu'exclu.
  const dailyTotals = new Map<string, number>()
  const pointsPerDay = new Map<string, number>()
  for (const p of points) {
    const key = dayKeyOfObservation(new Date(p.time).getTime())
    pointsPerDay.set(key, (pointsPerDay.get(key) ?? 0) + 1)
    if (p.rr1 !== null) dailyTotals.set(key, (dailyTotals.get(key) ?? 0) + p.rr1)
  }
  // Un jour est "complet" s'il a au moins 80% des observations attendues
  // (voir expectedObservationsPerDay). Calculé sur la couverture réelle, pas
  // sur un drapeau posé à la main : le message disparaît tout seul quand le
  // job horaire / le rattrapage a comblé les trous (ou quand le jour sort de
  // la fenêtre de 10 jours).
  const expectedPerDay = expectedObservationsPerDay(now)
  const dailyRain = [...dailyTotals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rain]) => ({
      date,
      rain: Math.round(rain * 10) / 10,
      complete: (pointsPerDay.get(date) ?? 0) >= COMPLETE_RATIO * (expectedPerDay.get(date) ?? 1),
    }))

  return {
    station,
    rainHistory,
    tempHistory,
    dailyRain,
    miniForecast,
    last24hCoverage: last24h.length,
    lastObservation: points.length > 0 ? points[points.length - 1].time : null,
  }
}
