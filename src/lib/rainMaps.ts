// Cartes de pluie : lecture des PNG + maps.json générés par
// scripts/build-rain-maps.py (voir .github/workflows/maps.yml).
//
// Les fichiers sont publiés sur la branche orpheline `data` (écrasée à chaque
// run : aucun historique, aucun déploiement Vercel) et servis par
// raw.githubusercontent.com (CORS ouvert, cache ~5 min). VITE_MAPS_BASE_URL
// permet de pointer ailleurs en développement (ex. /dev-maps).
import type { RainImage, RainMapsMeta } from '../types'

export const MAPS_BASE_URL: string =
  import.meta.env.VITE_MAPS_BASE_URL ?? 'https://raw.githubusercontent.com/drugpad/meteochampignon/data'

export async function fetchRainMapsMeta(): Promise<RainMapsMeta> {
  const res = await fetch(`${MAPS_BASE_URL}/maps.json`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Cartes de pluie indisponibles (HTTP ${res.status}).`)
  const meta = (await res.json()) as RainMapsMeta
  if (!meta.rain24h || !Array.isArray(meta.forecast)) throw new Error('Cartes de pluie : format inattendu.')
  return meta
}

// Décode un PNG en niveaux de gris : le niveau est lu dans le canal rouge.
// `colorSpaceConversion: 'none'` évite toute correction de couleur qui
// altérerait les valeurs (ce sont des données, pas une image à afficher).
export async function fetchRainImage(meta: RainMapsMeta, file: string): Promise<RainImage> {
  // `v` (instant de génération) : une nouvelle génération = une nouvelle URL,
  // donc pas de PNG périmé servi par le cache à côté d'un maps.json récent.
  const res = await fetch(`${MAPS_BASE_URL}/${file}?v=${encodeURIComponent(meta.fetchedAt)}`)
  if (!res.ok) throw new Error(`Carte indisponible (HTTP ${res.status}).`)
  const bitmap = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none' })
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0)
  const rgba = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data
  const levels = new Uint8ClampedArray(bitmap.width * bitmap.height)
  for (let i = 0; i < levels.length; i++) levels[i] = rgba[i * 4]
  return { width: bitmap.width, height: bitmap.height, levels, mmPerLevel: meta.encoding.mmPerLevel }
}

const PARIS_DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }) // yyyy-mm-dd

// Date du jour (yyyy-mm-dd) à Paris — même référentiel que les dates des
// prévisions (jours calendaires de Paris), quel que soit le fuseau du
// navigateur.
export function todayParisKey(now = new Date()): string {
  return PARIS_DAY_FORMATTER.format(now)
}

export function tomorrowParisKey(now = new Date()): string {
  return PARIS_DAY_FORMATTER.format(new Date(now.getTime() + 24 * 3600 * 1000))
}

// Index du premier jour de prévision qui n'est pas déjà passé : si le cron a
// sauté des créneaux, le premier jour du maps.json peut être hier, et ne doit
// pas être affiché comme « Auj. ».
export function firstCurrentDayIndex(days: { date: string }[], now = new Date()): number {
  const today = todayParisKey(now)
  const index = days.findIndex((d) => d.date >= today)
  return index === -1 ? 0 : index
}

export const MODEL_LABELS: Record<string, string> = {
  meteofrance_arome_france_hd: 'AROME HD',
  meteofrance_arpege_europe: 'ARPEGE',
  ecmwf_ifs025: 'ECMWF IFS',
}
