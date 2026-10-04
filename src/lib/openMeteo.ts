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
