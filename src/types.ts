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

// Cartes de pluie (24h passées + prévisions par jour), générées par
// scripts/build-rain-maps.py et publiées sur la branche `data` : des PNG en
// niveaux de gris (valeur = mm x 10) accompagnés d'un maps.json.
export type RainMapsMeta = {
  fetchedAt: string // ISO, instant de génération
  bounds: { latMin: number; latMax: number; lonMin: number; lonMax: number }
  rows: number
  cols: number
  encoding: { mmPerLevel: number; maxMm: number }
  rain24h: { file: string; from: string; to: string; hours: number; model: string; run: string }
  forecast: { date: string; file: string; model: string; resolutionKm: number; run: string }[]
  attribution: string
}

// Image décodée : un niveau (0-255) par cellule, ligne 0 = nord.
export type RainImage = { width: number; height: number; levels: Uint8ClampedArray; mmPerLevel: number }

export type RainMapsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; meta: RainMapsMeta }

// État d'une image de carte (cumul 24h ou un jour de prévision).
export type RainImageState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; image: RainImage }

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

