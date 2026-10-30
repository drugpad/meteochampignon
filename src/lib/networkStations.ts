// Chargement des cumuls de pluie d'un réseau de stations (Infoclimat, Netatmo) : un fichier JSON préparé côté
// serveur (Home Assistant), de la forme { generatedAt, stations: [{id,name,lat,lon,mm,hours}] }. Même source que
// l'historique Météo-France : branche « live » lue sur raw.githubusercontent (cache ~5 min), repli jsDelivr.
import type { StationRainTotal } from './stationRain'

// `d`/`n` : pluie (mm, null = aucune mesure) et heures mesurées pour chacun des jours de `days` (jours de Paris,
// le plus ancien d'abord) — absents des fichiers publiés avant l'ajout de la frise.
export type NetworkStation = { id: string; name: string; lat: number; lon: number; d?: (number | null)[]; n?: number[] } & StationRainTotal
export type NetworkData = { generatedAt: string; days?: string[]; stations: NetworkStation[] }

// Jours de la frise d'une station : un jour compte comme partiel s'il a moins de 80 % de ses heures mesurées
// (le jour en cours est comparé aux heures déjà écoulées).
export function networkFriseDays(data: NetworkData, station: NetworkStation, now = new Date()): { date: string; mm: number | null; partial: boolean }[] {
  const days = data.days
  if (!days || !station.d) return []
  const todayParis = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(now)
  const hourParis = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }).format(now)) % 24
  return days.map((date, k) => {
    const mm = station.d?.[k] ?? null
    const expected = date === todayParis ? Math.max(1, hourParis) : 24
    return { date, mm, partial: mm !== null && (station.n?.[k] ?? 0) < 0.8 * expected }
  })
}

const RAW = 'https://raw.githubusercontent.com/drugpad/meteochampignon/live/public'
const JSDELIVR = 'https://cdn.jsdelivr.net/gh/drugpad/meteochampignon@live/public'

export type NetworkId = 'infoclimat' | 'netatmo'
const FILE: Record<NetworkId, string> = {
  infoclimat: 'infoclimat-stations.json',
  netatmo: 'netatmo-stations.json',
}

const memo: Partial<Record<NetworkId, NetworkData>> = {}

export function cachedNetwork(network: NetworkId): NetworkData | null {
  if (memo[network]) return memo[network] ?? null
  try {
    const raw = localStorage.getItem('mc-network-' + network)
    if (!raw) return null
    const stored = JSON.parse(raw) as { at: number; data: NetworkData }
    if (Date.now() - stored.at > 12 * 3600 * 1000) return null
    return stored.data
  } catch {
    return null
  }
}

export async function loadNetwork(network: NetworkId): Promise<NetworkData> {
  const file = FILE[network]
  let data: NetworkData | null = null
  for (const url of [`${RAW}/${file}`, `${JSDELIVR}/${file}`]) {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      data = (await res.json()) as NetworkData
      break
    } catch {
      // source suivante
    }
  }
  if (!data || !Array.isArray(data.stations)) throw new Error(`Réseau ${network} indisponible.`)
  memo[network] = data
  try {
    localStorage.setItem('mc-network-' + network, JSON.stringify({ at: Date.now(), data }))
  } catch {
    // mémorisation facultative
  }
  return data
}
