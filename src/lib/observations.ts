// Couche « Observations réelles » du mode Coins : trouvailles publiques des 7 espèces (GBIF), préparées par
// scripts/build-observations.py dans public/observations.json. Chaque point garde son jeu de données (titre +
// licence, affichés dans la bulle : obligatoire pour les licences CC BY / CC BY-NC).
import type { Species } from './coins'

export type ObservationDataset = { key: string; title: string; license: string }
// [lat, lon, date (AAAA-MM-JJ, AAAA-MM ou AAAA), index du jeu de données, incertitude de position en m (-1 = inconnue)]
export type ObservationPoint = [number, number, string, number, number]
export type ObservationsMeta = {
  generatedAt: string
  datasets: ObservationDataset[]
  species: Partial<Record<Species, ObservationPoint[]>>
}

let cache: Promise<ObservationsMeta | null> | null = null
export function loadObservations(): Promise<ObservationsMeta | null> {
  cache ??= fetch(`${import.meta.env.BASE_URL}observations.json`)
    .then((r) => (r.ok ? (r.json() as Promise<ObservationsMeta>) : null))
    .catch(() => null)
  return cache
}

const MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' })
const DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
export function formatObservationDate(when: string): string {
  const [y, m, d] = when.split('-').map(Number)
  if (d) return DAY.format(new Date(y, m - 1, d))
  if (m) return MONTH.format(new Date(y, m - 1, 1))
  return when || 'date inconnue'
}

const KEY = 'mc-coins-observations'
export function observationsEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}
export function setObservationsEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    // mémorisation facultative
  }
}
