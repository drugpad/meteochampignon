// Chargement des cumuls de pluie d'un réseau de stations (Infoclimat, Netatmo) : un fichier JSON préparé côté
// serveur (Home Assistant), de la forme { generatedAt, stations: [{id,name,lat,lon,mm,hours}] }. Même source que
// l'historique Météo-France : lu sur raw.githubusercontent (cache ~5 min), repli sur le fichier du déploiement.
import type { StationRainTotal } from './stationRain'

export type NetworkStation = { id: string; name: string; lat: number; lon: number } & StationRainTotal
export type NetworkData = { generatedAt: string; stations: NetworkStation[] }

const RAW = 'https://raw.githubusercontent.com/drugpad/meteochampignon/master/public'

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
  for (const url of [`${RAW}/${file}`, `/${file}`]) {
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
