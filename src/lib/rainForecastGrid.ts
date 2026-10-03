// Carte de pluie PRÉVUE (mode Prévisions, recouvrement carte) — même grille
// géographique que la carte de pluie 24h (rainGrid.ts), mais un cumul par
// jour (jusqu'à 7) au lieu d'une seule valeur 24h glissante. Voir
// rainGrid.ts pour les commentaires détaillés sur le pacing/retry, repris
// ici à l'identique.
import { RAIN_GRID_BATCH_DELAY_MS, RAIN_GRID_BATCH_SIZE } from './config'
import { buildGridPoints } from './rainGrid'
import { getDailyPrecipitationBatch } from './openMeteo'
import type { RainForecastGridPoint } from '../types'

const CACHED_GRID_URL = '/rain-forecast-grid.json'
// Contrairement à rainGrid.ts (cumul 24h glissant, reste valable même vieux
// de quelques heures — voir son commentaire sur la suppression de tout
// seuil d'âge), ici `dates[0]` = "aujourd'hui" au moment du fetch : passé un
// certain âge, ce n'est plus juste une donnée "un peu vieille", les dates
// elles-mêmes sont fausses (le jour a changé). Seuil généreux (36h, pas 3h)
// pour absorber les trous occasionnels du cron (toutes les 2h en théorie,
// jusqu'à ~8h de trou observé en pratique) sans jamais cacher la carte pour
// ça — seulement si le job est vraiment resté en panne plus d'un jour.
const CACHED_GRID_MAX_AGE_MS = 36 * 60 * 60 * 1000

const PARIS_DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }) // yyyy-mm-dd

// Date du jour (yyyy-mm-dd) à Paris — même référentiel que `dates` de la
// grille (requêtes en timezone=Europe/Paris), quel que soit le fuseau du
// navigateur.
export function todayParisKey(now = new Date()): string {
  return PARIS_DAY_FORMATTER.format(now)
}

export function tomorrowParisKey(now = new Date()): string {
  return PARIS_DAY_FORMATTER.format(new Date(now.getTime() + 24 * 3600 * 1000))
}

// Index du premier jour de la grille qui n'est pas déjà passé. La grille en
// cache peut dater de plusieurs heures (jusqu'à 36h), donc `dates[0]` n'est
// pas forcément aujourd'hui : l'index 0 serait alors une journée écoulée,
// affichée à tort comme « Auj. ».
export function firstCurrentDayIndex(dates: string[], now = new Date()): number {
  const today = todayParisKey(now)
  const index = dates.findIndex((d) => d >= today)
  return index === -1 ? 0 : index
}

export type CachedRainForecastGrid = { points: RainForecastGridPoint[]; dates: string[]; fetchedAt: number }

export async function fetchCachedRainForecastGrid(): Promise<CachedRainForecastGrid | null> {
  try {
    const res = await fetch(CACHED_GRID_URL, { cache: 'no-store' })
    if (!res.ok) return null
    const data = (await res.json()) as { fetchedAt: string; dates: string[]; points: RainForecastGridPoint[] }
    const fetchedAt = new Date(data.fetchedAt).getTime()
    if (Number.isNaN(fetchedAt) || data.points.length === 0 || Date.now() - fetchedAt > CACHED_GRID_MAX_AGE_MS) return null
    return { points: data.points, dates: data.dates, fetchedAt }
  } catch {
    return null
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchBatchWithRetry(
  batch: { lat: number; lon: number }[],
  attempt = 0,
): Promise<{ dates: string[]; values: (number | null)[][] }> {
  try {
    return await getDailyPrecipitationBatch(batch)
  } catch (err) {
    const retryable = err instanceof Error && (!err.message.startsWith('Open-Meteo:') || /Open-Meteo: (429|5\d\d)/.test(err.message))
    if (attempt >= 5 || !retryable) throw err
    await wait(4000 * (attempt + 1))
    return fetchBatchWithRetry(batch, attempt + 1)
  }
}

// Calcule la grille en direct dans le navigateur — solution de secours
// manuelle (bouton "Recalculer maintenant"), pas le chemin normal (voir
// fetchCachedRainForecastGrid ci-dessus). `onProgress` permet d'afficher
// l'avancement.
export async function fetchRainForecastGrid(
  onProgress?: (loaded: number, total: number) => void,
): Promise<{ points: RainForecastGridPoint[]; dates: string[] }> {
  const points = buildGridPoints()
  const batches = chunk(points, RAIN_GRID_BATCH_SIZE)
  const results: RainForecastGridPoint[] = []
  let dates: string[] = []

  for (const [i, batch] of batches.entries()) {
    if (i > 0) await wait(RAIN_GRID_BATCH_DELAY_MS)

    let values: (number | null)[][]
    try {
      const batchResult = await fetchBatchWithRetry(batch)
      if (batchResult.dates.length > 0) dates = batchResult.dates
      values = batchResult.values
    } catch {
      values = batch.map(() => [])
    }

    batch.forEach((p, j) => {
      results.push({ lat: p.lat, lon: p.lon, rain: values[j] ?? [] })
    })
    onProgress?.(results.length, points.length)
  }

  return { points: results, dates }
}
