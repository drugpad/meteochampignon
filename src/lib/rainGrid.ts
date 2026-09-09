// Carte de pluie 24h — Option A (rapide, grille Open-Meteo interpolée).
// Voir spec : maille ~5-10km sur Midi-Pyrénées, cumul 24h par point, puis
// interpolation en dégradé (le rendu du dégradé est fait par RainOverlay.tsx
// avec un canvas ; ce module ne fait que construire la grille de valeurs).
import { MIDI_PYRENEES_BOUNDS, RAIN_GRID_BATCH_DELAY_MS, RAIN_GRID_BATCH_SIZE, RAIN_GRID_STEP_DEG } from './config'
import { getHourlyPrecipitationBatch } from './openMeteo'
import type { RainGridPoint } from '../types'

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

// Un lot qui échoue en 429 est retenté après une pause croissante, plutôt
// que de faire échouer toute la grille. Observé en usage réel : Open-Meteo
// limite le débit par nombre de POINTS traités (pas juste par requête HTTP),
// donc une dizaine de lots de ~100 points tirés à la suite déclenche vite un
// 429, même sans clé API — d'où des pauses longues ci-dessous (voir aussi
// l'espacement entre lots dans fetchRainGrid).
async function fetchBatchWithRetry(batch: { lat: number; lon: number }[], attempt = 0): Promise<(number | null)[]> {
  try {
    return await getHourlyPrecipitationBatch(batch)
  } catch (err) {
    if (attempt >= 5 || !(err instanceof Error) || !err.message.includes('429')) throw err
    await wait(4000 * (attempt + 1))
    return fetchBatchWithRetry(batch, attempt + 1)
  }
}

// Récupère le cumul de pluie 24h sur toute la grille, par lots de
// RAIN_GRID_BATCH_SIZE points (un appel HTTP par lot, espacés d'une pause
// pour rester sous la limite de débit d'Open-Meteo — voir commentaire
// ci-dessus). `onProgress` permet d'afficher un état de chargement (la
// grille complète prend maintenant plusieurs dizaines de secondes,
// volontairement lent pour ne pas se faire rejeter).
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
