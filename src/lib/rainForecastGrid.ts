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
