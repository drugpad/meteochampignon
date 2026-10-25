// Historique de pluie jour par jour (curseur J-15 à J-1 du mode Historique) : rain-days.json + un PNG par jour,
// publiés sur la branche data par scripts/build-pousse.py. Pluie de minuit à minuit (Paris), corrigée par les
// pluviomètres Météo-France quand on l'a (« corrected »), sinon celle du modèle AROME.
import { fetchDataJson, fetchPixels } from './rainMaps'
import type { RainImage } from '../types'

export type RainDay = { date: string; file: string; corrected: boolean; meanMm: number; maxMm: number }
export type RainDaysMeta = {
  generatedAt: string
  bounds: { latMin: number; latMax: number; lonMin: number; lonMax: number }
  rows: number
  cols: number
  encoding: { mmPerLevel: number; maxMm: number }
  days: RainDay[] // du plus ancien au plus récent
}

let cache: { meta: RainDaysMeta; base: string } | null = null
const images = new Map<string, Promise<RainImage>>()

export async function loadRainDays(force = false): Promise<RainDaysMeta> {
  if (!cache || force) {
    const { data, base } = await fetchDataJson<RainDaysMeta>('rain-days.json')
    if (!Array.isArray(data.days)) throw new Error('format inattendu')
    cache = { meta: data, base }
    images.clear()
  }
  return cache.meta
}

export function loadRainDayImage(day: RainDay): Promise<RainImage> {
  if (!cache) return Promise.reject(new Error('historique de pluie non chargé'))
  const { meta, base } = cache
  if (!images.has(day.file)) {
    const p = fetchPixels(`${base}/${day.file}?v=${encodeURIComponent(meta.generatedAt)}`).then((px) => {
      const levels = new Uint8ClampedArray(px.width * px.height)
      for (let i = 0; i < levels.length; i++) levels[i] = px.rgba[i * 4]
      return { width: px.width, height: px.height, levels, mmPerLevel: meta.encoding.mmPerLevel }
    })
    p.catch(() => images.delete(day.file)) // nouvel essai possible
    images.set(day.file, p)
  }
  return images.get(day.file)!
}
