// Wrapper autour de l'API Open-Meteo (https://open-meteo.com/) — pas de clé,
// JSON simple, CORS ouvert (confirmé : access-control-allow-origin: *).
import type { ForecastDay, Point } from '../types'

const BASE_URL = 'https://api.open-meteo.com/v1/forecast'

// Modèles utilisés pour les prévisions ponctuelles, du plus fin au plus
// lointain : MÊME politique que les cartes de pluie (scripts/build-rain-maps.py,
// un modèle par jour, le plus fin qui couvre toute la journée). Avant, le clic
// utilisait `best_match` (mélange opaque) pendant que la carte affichait AROME :
// à Condom le 06/10/2026, la carte montrait 21-25 mm (AROME HD : 15,8 mm à
// l'API) et le panneau 0,6 mm — deux sources qui se contredisaient sur un même
// écran. Les modèles eux-mêmes divergent parfois fortement (AROME 15,8 /
// IFS 7,2 / ARPEGE 0 ce jour-là) : on le signale (voir otherModels).
const POINT_MODELS = [
  'meteofrance_arome_france_hd',
  'meteofrance_arpege_europe',
  'ecmwf_ifs025',
  'ecmwf_aifs025_single',
]
// Nombre de jours (à partir d'aujourd'hui) que chaque modèle couvre dans les
// cartes : AROME 51h (2 jours), ARPEGE ~4 jours, IFS 144h (6 jours) dans le
// stockage utilisé par les cartes — l'API, elle, sert l'IFS jusqu'à 10 jours,
// mais on s'aligne sur les cartes pour que les deux écrans ne se contredisent
// pas (le 7e jour vient de l'AIFS, comme sur la carte).
const MODEL_DAYS: Record<string, number> = {
  meteofrance_arome_france_hd: 2,
  meteofrance_arpege_europe: 4,
  ecmwf_ifs025: 6,
  ecmwf_aifs025_single: Infinity,
}
// best_match ne sert que de repli pour les variables qu'un modèle ne fournit
// pas (ex. weather_code de l'AIFS).
const FALLBACK_MODEL = 'best_match'

const DAILY_VARIABLES = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
  'precipitation_probability_max',
  'wind_speed_10m_max',
] as const

// Avec plusieurs modèles, Open-Meteo suffixe chaque variable : `precipitation_sum_<modèle>`.
type DailyResponse = { daily: { time: string[] } & Record<string, (number | null)[] | string[]> }

function daysFromResponse(data: DailyResponse): ForecastDay[] {
  const { daily } = data
  const get = (name: string, model: string, i: number): number | null => {
    const series = daily[`${name}_${model}`] as (number | null)[] | undefined
    return series?.[i] ?? null
  }

  return daily.time.map((date, i) => {
    // Modèle retenu : le premier de la liste qui couvre ce jour dans les cartes
    // ET a un cumul de pluie (l'API renvoie null au-delà de l'horizon d'un modèle).
    const chosen = POINT_MODELS.find((m) => i < MODEL_DAYS[m] && get('precipitation_sum', m, i) !== null) ?? null
    const pick = (name: string): number | null =>
      (chosen ? get(name, chosen, i) : null) ?? get(name, FALLBACK_MODEL, i)

    return {
      date,
      weatherCode: pick('weather_code') ?? 0,
      tempMin: pick('temperature_2m_min') ?? 0,
      tempMax: pick('temperature_2m_max') ?? 0,
      precipitationSum: (chosen ? get('precipitation_sum', chosen, i) : null) ?? get('precipitation_sum', FALLBACK_MODEL, i) ?? 0,
      // Probabilité : seulement si le modèle retenu la fournit (l'IFS) — celle
      // de best_match n'a aucun rapport avec le cumul d'un autre modèle.
      precipitationProbabilityMax: chosen ? get('precipitation_probability_max', chosen, i) : null,
      windSpeedMax: pick('wind_speed_10m_max') ?? 0,
      precipitationModel: chosen,
      otherModels: POINT_MODELS.filter((m) => m !== chosen)
        .map((model) => ({ model, mm: get('precipitation_sum', model, i) }))
        .filter((o): o is { model: string; mm: number } => o.mm !== null),
    }
  })
}

// Prévisions journalières pour un point (module Prévisions 7 jours, et
// mini-prévision 5 jours des stations). `forecastDays` par défaut à 7 comme
// demandé par la spec ; les stations en utilisent 5.
export async function getDailyForecast(point: Point, forecastDays = 7): Promise<ForecastDay[]> {
  const url = new URL(BASE_URL)
  url.searchParams.set('latitude', point.lat.toFixed(4))
  url.searchParams.set('longitude', point.lon.toFixed(4))
  url.searchParams.set('daily', DAILY_VARIABLES.join(','))
  url.searchParams.set('forecast_days', String(forecastDays))
  url.searchParams.set('timezone', 'Europe/Paris')
  url.searchParams.set('models', [FALLBACK_MODEL, ...POINT_MODELS].join(','))

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Open-Meteo: ${res.status}`)
  const data = (await res.json()) as DailyResponse
  return daysFromResponse(data)
}
