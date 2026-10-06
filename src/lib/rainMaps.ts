// Cartes de pluie : lecture des PNG + maps.json générés par
// scripts/build-rain-maps.py (voir .github/workflows/maps.yml).
//
// Les fichiers sont publiés sur la branche orpheline `data` (écrasée à chaque
// run : aucun historique, aucun déploiement Vercel). Source principale :
// raw.githubusercontent.com (CORS ouvert, cache ~5 min). Source de secours :
// jsDelivr, qui sert la même branche (cache plus long, parfois de plusieurs
// heures : acceptable en secours, l'âge réel reste affiché). VITE_MAPS_BASE_URL
// force une source unique (ex. /dev-maps en développement).
import type { RainImage, RainMapsMeta } from '../types'

const FORCED_BASE: string | undefined = import.meta.env.VITE_MAPS_BASE_URL
const BASES: string[] = FORCED_BASE
  ? [FORCED_BASE]
  : [
      'https://raw.githubusercontent.com/drugpad/meteochampignon/data',
      'https://cdn.jsdelivr.net/gh/drugpad/meteochampignon@data',
    ]

// Source qui a répondu pour maps.json : les PNG sont lus au même endroit, pour
// rester cohérents avec ce maps.json.
let activeBase = BASES[0]

// Message affiché dans le panneau de la carte : toujours en français et lisible,
// jamais l'erreur brute du navigateur (« Failed to fetch », « Unexpected token
// '<' … is not valid JSON » quand un serveur répond une page HTML).
const UNAVAILABLE = 'Cartes de pluie indisponibles pour le moment. Réessaie dans un instant.'

export async function fetchRainMapsMeta(): Promise<RainMapsMeta> {
  let meta: RainMapsMeta | null = null
  for (const base of BASES) {
    try {
      const res = await fetch(`${base}/maps.json`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const candidate = (await res.json()) as RainMapsMeta
      if (!candidate.rain24h || !Array.isArray(candidate.forecast) || candidate.forecast.length === 0) {
        throw new Error('format inattendu')
      }
      meta = candidate
      activeBase = base
      break
    } catch {
      // source suivante
    }
  }
  if (!meta) throw new Error(UNAVAILABLE)
  return meta
}

// URL de tous les fichiers des cartes actuelles (maps.json en premier) : sert à les enregistrer
// pour le mode hors ligne (src/lib/offline.ts). Même source et mêmes URL que fetchRainImage.
export function rainMapsUrls(meta: RainMapsMeta): string[] {
  const v = encodeURIComponent(meta.fetchedAt)
  const files = [meta.rain24h.file, ...meta.forecast.map((d) => d.file)]
  return [`${activeBase}/maps.json`, ...files.map((f) => `${activeBase}/${f}?v=${v}`)]
}

// Décode un PNG en niveaux de gris : le niveau est lu dans le canal rouge.
// `colorSpaceConversion: 'none'` évite toute correction de couleur qui
// altérerait les valeurs (ce sont des données, pas une image à afficher).
export async function fetchRainImage(meta: RainMapsMeta, file: string): Promise<RainImage> {
  // `v` (instant de génération) : une nouvelle génération = une nouvelle URL,
  // donc pas de PNG périmé servi par le cache à côté d'un maps.json récent.
  let bitmap: ImageBitmap
  try {
    const res = await fetch(`${activeBase}/${file}?v=${encodeURIComponent(meta.fetchedAt)}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    bitmap = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none' })
  } catch {
    throw new Error(UNAVAILABLE)
  }
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

// Au-delà de cet âge, les cartes sont signalées comme en retard dans le
// panneau (le cron GitHub saute parfois plusieurs heures de suite).
export const STALE_MAPS_HOURS = 6

export const MODEL_LABELS: Record<string, string> = {
  meteofrance_arome_france_hd: 'AROME HD',
  meteofrance_arpege_europe: 'ARPEGE',
  ecmwf_ifs025: 'ECMWF IFS',
  ecmwf_aifs025_single: 'ECMWF AIFS',
}
