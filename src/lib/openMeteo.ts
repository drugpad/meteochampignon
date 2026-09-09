// Wrapper autour de l'API Open-Meteo (https://open-meteo.com/) — pas de clé,
// JSON simple, CORS ouvert (confirmé : access-control-allow-origin: *).
import type { ForecastDay, Point } from '../types'

const BASE_URL = 'https://api.open-meteo.com/v1/forecast'

type DailyResponse = {
  daily: {
    time: string[]
    weather_code: number[]
    temperature_2m_max: number[]
    temperature_2m_min: number[]
    precipitation_sum: number[]
    precipitation_probability_max: (number | null)[]
    wind_speed_10m_max: number[]
  }
}

function daysFromResponse(data: DailyResponse): ForecastDay[] {
  const { daily } = data
  return daily.time.map((date, i) => ({
    date,
    weatherCode: daily.weather_code[i],
    tempMin: daily.temperature_2m_min[i],
    tempMax: daily.temperature_2m_max[i],
    precipitationSum: daily.precipitation_sum[i],
    precipitationProbabilityMax: daily.precipitation_probability_max?.[i] ?? null,
    windSpeedMax: daily.wind_speed_10m_max[i],
  }))
}

// Prévisions journalières pour un point (module Prévisions 7 jours, et
// mini-prévision 5 jours des stations). `forecastDays` par défaut à 7 comme
// demandé par la spec ; les stations en utilisent 5.
export async function getDailyForecast(point: Point, forecastDays = 7): Promise<ForecastDay[]> {
  const url = new URL(BASE_URL)
  url.searchParams.set('latitude', point.lat.toFixed(4))
  url.searchParams.set('longitude', point.lon.toFixed(4))
  url.searchParams.set('daily', [
    'weather_code',
    'temperature_2m_max',
    'temperature_2m_min',
    'precipitation_sum',
    'precipitation_probability_max',
    'wind_speed_10m_max',
  ].join(','))
  url.searchParams.set('forecast_days', String(forecastDays))
  url.searchParams.set('timezone', 'Europe/Paris')
  // best_match : blend multi-modèles (AROME/ARPEGE les 2 premiers jours,
  // relais sur d'autres modèles ensuite pour la précision moyen terme) — voir
  // spec.
  url.searchParams.set('models', 'best_match')

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Open-Meteo: ${res.status}`)
  const data = (await res.json()) as DailyResponse
  return daysFromResponse(data)
}

export type HourlyPrecipTemp = {
  time: string[]
  precipitation: number[]
  temperature: number[]
}

// Historique horaire (pluie + température) des dernières 24h pour un point —
// sert au graphique de station (3.x du module Stations) quand on veut une
// source de secours ou un point de comparaison Open-Meteo à côté des
// données de la station elle-même.
export async function getHourlyHistory(point: Point): Promise<HourlyPrecipTemp> {
  const url = new URL(BASE_URL)
  url.searchParams.set('latitude', point.lat.toFixed(4))
  url.searchParams.set('longitude', point.lon.toFixed(4))
  url.searchParams.set('hourly', 'precipitation,temperature_2m')
  url.searchParams.set('past_days', '1')
  url.searchParams.set('forecast_days', '1')
  url.searchParams.set('timezone', 'Europe/Paris')
  url.searchParams.set('models', 'best_match')

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Open-Meteo: ${res.status}`)
  const data = await res.json()
  return {
    time: data.hourly.time,
    precipitation: data.hourly.precipitation,
    temperature: data.hourly.temperature_2m,
  }
}

// Cumul de pluie sur les dernières 24h glissantes (par opposition au cumul
// "hier" du daily.precipitation_sum avec past_days=1, qui correspond à une
// journée calendaire et non aux 24h qui précèdent l'instant présent) —
// sert à la fois à la carte de pluie Option A (rainGrid.ts) et à l'historique
// station.
export function rolling24hSum(hourly: HourlyPrecipTemp, now = new Date()): number | null {
  const nowIndex = hourly.time.findIndex((t) => new Date(t).getTime() > now.getTime())
  // Le point juste avant le premier horaire "futur" est l'heure courante.
  const endIndex = (nowIndex === -1 ? hourly.time.length : nowIndex) - 1
  const startIndex = endIndex - 23
  if (endIndex < 0 || startIndex < 0) return null
  let sum = 0
  for (let i = startIndex; i <= endIndex; i++) {
    sum += hourly.precipitation[i] ?? 0
  }
  return Math.round(sum * 10) / 10
}

// Requête groupée multi-points en un seul appel HTTP (Open-Meteo accepte des
// listes lat/lon séparées par des virgules, testé jusqu'à 150 points) — sert
// à la grille de pluie Option A (rainGrid.ts) pour limiter le nombre
// d'appels.
export async function getHourlyPrecipitationBatch(points: Point[]): Promise<(number | null)[]> {
  if (points.length === 0) return []
  const url = new URL(BASE_URL)
  url.searchParams.set('latitude', points.map((p) => p.lat.toFixed(4)).join(','))
  url.searchParams.set('longitude', points.map((p) => p.lon.toFixed(4)).join(','))
  url.searchParams.set('hourly', 'precipitation')
  url.searchParams.set('past_days', '1')
  url.searchParams.set('forecast_days', '1')
  url.searchParams.set('timezone', 'Europe/Paris')
  url.searchParams.set('models', 'best_match')

  const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`Open-Meteo: ${res.status}`)
  const data = await res.json()
  // Un seul point → l'API renvoie un objet, pas un tableau.
  const results: unknown[] = Array.isArray(data) ? data : [data]

  return results.map((entry) => {
    const hourly = (entry as { hourly?: HourlyPrecipTemp }).hourly
    if (!hourly) return null
    return rolling24hSum(hourly)
  })
}
