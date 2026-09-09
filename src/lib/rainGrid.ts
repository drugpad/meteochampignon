// Carte de pluie 24h — Option A (rapide, grille Open-Meteo interpolée).
// Voir spec : maille ~5-10km sur Midi-Pyrénées, cumul 24h par point, puis
// interpolation en dégradé (le rendu du dégradé est fait par RainOverlay.tsx
// avec un canvas ; ce module ne fait que construire la grille de valeurs).
import { MIDI_PYRENEES_BOUNDS, RAIN_GRID_BATCH_DELAY_MS, RAIN_GRID_BATCH_SIZE, RAIN_GRID_STEP_DEG } from './config'
import { getHourlyPrecipitationBatch } from './openMeteo'
import type { RainGridPoint } from '../types'

// La grille complète prend plusieurs minutes à calculer en direct dans le
// navigateur (voir plus bas, pacing anti rate-limit Open-Meteo) — bien trop
// lent pour une ouverture d'appli. Un job GitHub Actions (voir
// .github/workflows/rain-grid.yml + scripts/fetch-rain-grid.mjs) la
// recalcule toutes les 30 min côté serveur et l'écrit dans ce fichier
// statique, servi par Vercel comme n'importe quel asset public — l'appli le
// lit d'abord (quasi instantané) et ne retombe sur le calcul en direct
// (fetchRainGrid ci-dessous) que si ce cache est absent ou trop vieux.
const CACHED_GRID_URL = '/rain-grid.json'
const CACHED_GRID_MAX_AGE_MS = 90 * 60 * 1000 // 90 min — au-delà, le job a dû s'arrêter (voir CLAUDE.md)

export type CachedRainGrid = { points: RainGridPoint[]; fetchedAt: number }

// Tente de lire la grille pré-calculée par le job planifié. Renvoie `null`
// si le fichier n'existe pas encore (avant le premier run du job, ou en dev
// local sans avoir lancé le script), ou s'il est trop vieux pour être fiable
// — dans les deux cas l'appelant sait qu'il doit retomber sur fetchRainGrid.
export async function fetchCachedRainGrid(): Promise<CachedRainGrid | null> {
  try {
    const res = await fetch(CACHED_GRID_URL, { cache: 'no-store' })
    if (!res.ok) return null
    const data = (await res.json()) as { fetchedAt: string; points: RainGridPoint[] }
    const fetchedAt = new Date(data.fetchedAt).getTime()
    if (Number.isNaN(fetchedAt) || Date.now() - fetchedAt > CACHED_GRID_MAX_AGE_MS) return null
    return { points: data.points, fetchedAt }
  } catch {
    return null
  }
}

export function buildGridPoints(): { lat: number; lon: number }[] {
  const { latMin, latMax, lonMin, lonMax } = MIDI_PYRENEES_BOUNDS
  const points: { lat: number; lon: number }[] = []
  for (let lat = latMin; lat <= latMax; lat += RAIN_GRID_STEP_DEG) {
    for (let lon = lonMin; lon <= lonMax; lon += RAIN_GRID_STEP_DEG) {
      points.push({ lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000 })
    }
  }
  return points
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Un lot qui échoue en 429 (rate-limit — Open-Meteo semble limiter le débit
// par nombre de POINTS traités, pas juste par requête HTTP : une dizaine de
// lots de ~100 points tirés à la suite déclenche vite un 429, même sans clé
// API) ou en 5xx (erreur transitoire côté Open-Meteo, observée aussi en
// usage réel) est retenté après une pause croissante, plutôt que de faire
// échouer toute la grille — voir aussi l'espacement entre lots dans
// fetchRainGrid.
async function fetchBatchWithRetry(batch: { lat: number; lon: number }[], attempt = 0): Promise<(number | null)[]> {
  try {
    return await getHourlyPrecipitationBatch(batch)
  } catch (err) {
    const retryable = err instanceof Error && /Open-Meteo: (429|5\d\d)/.test(err.message)
    if (attempt >= 5 || !retryable) throw err
    await wait(4000 * (attempt + 1))
    return fetchBatchWithRetry(batch, attempt + 1)
  }
}

// Calcule la grille en direct dans le navigateur, par lots de
// RAIN_GRID_BATCH_SIZE points (un appel HTTP par lot, espacés d'une pause
// pour rester sous la limite de débit d'Open-Meteo — voir commentaire
// ci-dessus). Lent (plusieurs minutes) — sert de solution de secours
// manuelle (bouton "Recalculer maintenant") quand fetchCachedRainGrid() ne
// renvoie rien, pas le chemin normal (voir cette fonction plus haut).
// `onProgress` permet d'afficher l'avancement.
export async function fetchRainGrid(
  onProgress?: (loaded: number, total: number) => void,
): Promise<RainGridPoint[]> {
  const points = buildGridPoints()
  const batches = chunk(points, RAIN_GRID_BATCH_SIZE)
  const results: RainGridPoint[] = []

  for (const [i, batch] of batches.entries()) {
    if (i > 0) await wait(RAIN_GRID_BATCH_DELAY_MS)
    const values = await fetchBatchWithRetry(batch)
    batch.forEach((p, j) => {
      results.push({ lat: p.lat, lon: p.lon, rain24h: values[j] })
    })
    onProgress?.(results.length, points.length)
  }

  return results
}
