// Types partagés de l'appli.

export type Point = { lat: number; lon: number }

export type AppMode = 'previsions' | 'historique'

// Un jour de prévision (module Prévisions 7 jours, Open-Meteo best_match).
export type ForecastDay = {
  date: string // ISO yyyy-mm-dd
  weatherCode: number
  tempMin: number
  tempMax: number
  precipitationSum: number // mm
  precipitationProbabilityMax: number | null // %
  windSpeedMax: number // km/h
}

export type ForecastState =
  | { status: 'idle' }
  | { status: 'loading'; point: Point }
  | { status: 'error'; point: Point; message: string }
  | { status: 'ready'; point: Point; days: ForecastDay[] }

// Une station météo (Infoclimat StatIC/SYNOP ou Météo-France) affichée sur
// la carte en mode Historique.
export type Station = {
  id: string
  name: string
  lat: number
  lon: number
  // Réseau d'origine, pour distinguer visuellement (SYNOP officiel Météo-
  // France vs StatIC amateur Infoclimat, moins fiable mais plus dense).
  network: 'synop' | 'static'
  altitude?: number
}

// Un point de la grille de pluie (Option A, cumul 24h interpolé).
export type RainGridPoint = {
  lat: number
  lon: number
  rain24h: number | null // mm, null si la requête a échoué pour ce point
}

export type RainGridState =
  | { status: 'idle' }
  | { status: 'loading'; loaded: number; total: number }
  | { status: 'error'; message: string }
  | { status: 'ready'; points: RainGridPoint[]; fetchedAt: number }

// Un point de la grille de pluie PRÉVUE (mode Prévisions, recouvrement carte)
// — même grille géographique que RainGridPoint, mais un cumul par jour
// (jusqu'à 7) au lieu d'une seule valeur 24h glissante.
export type RainForecastGridPoint = {
  lat: number
  lon: number
  rain: (number | null)[] // mm/jour, un par entrée de RainForecastGridState.dates
}

export type RainForecastGridState =
  | { status: 'idle' }
  | { status: 'loading'; loaded: number; total: number }
  | { status: 'error'; message: string }
  | { status: 'ready'; points: RainForecastGridPoint[]; dates: string[]; fetchedAt: number }

// Historique 24h + cumul quotidien 10j + mini-prévision 5 jours pour une
// station cliquée.
export type StationDetail = {
  station: Station
  rainHistory: { time: string; rain: number }[] // mm/h, 24 dernières heures
  tempHistory: { time: string; temp: number }[] // °C, 24 dernières heures
  // mm/jour, jusqu'à 10 derniers jours ; complete=false : trop peu d'heures
  // observées ce jour-là, le cumul est un minimum.
  dailyRain: { date: string; rain: number; complete: boolean }[]
  last24hCoverage: number // nombre d'heures observées sur les 24 dernières (sur 24)
  miniForecast: ForecastDay[] // 5 jours, source Open-Meteo pour ce point
}

export type StationDetailState =
  | { status: 'idle' }
  | { status: 'loading'; station: Station }
  | { status: 'error'; station: Station; message: string }
  | { status: 'ready'; detail: StationDetail }

// Source de la carte de pluie 24h : Option A (Open-Meteo interpolé, toujours
// disponible) ou Option B (radar Météo-France, nécessite un token — voir
// meteoFranceRadar.ts). Toggle de comparaison, voir CLAUDE.md.
export type RainMapSource = 'open-meteo' | 'radar'
