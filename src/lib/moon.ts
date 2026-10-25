// Clin d'œil « lune » du mode Coins (demande utilisateur du 25/10/2026) : croyance populaire des cueilleurs,
// SANS preuve scientifique, désactivée par défaut. Règle la plus répandue : les champignons sortent à la lune
// montante, jusqu'à quelques jours après la pleine lune. Activée, elle module le score de pousse :
// +15 % de la nouvelle lune à 3 jours après la pleine lune, -10 % le reste de la lune décroissante.
const SYNODIC = 29.530588853 // jours (mois lunaire moyen)
const NEW_MOON_REF = Date.UTC(2000, 0, 6, 18, 14) // nouvelle lune de référence (6 janvier 2000, 18 h 14 UTC)
const KEY = 'mc-moon'

// Âge de la lune (jours depuis la dernière nouvelle lune, 0 à 29,5) à midi le jour donné (yyyy-mm-dd).
export function moonAge(date: string): number {
  const t = Date.parse(`${date}T12:00:00Z`)
  const age = ((t - NEW_MOON_REF) / 86400000) % SYNODIC
  return age < 0 ? age + SYNODIC : age
}

const PHASES: [number, string, string][] = [
  [1.84, '🌑', 'Nouvelle lune'],
  [5.54, '🌒', 'Premier croissant'],
  [9.23, '🌓', 'Premier quartier'],
  [12.92, '🌔', 'Lune gibbeuse croissante'],
  [16.61, '🌕', 'Pleine lune'],
  [20.3, '🌖', 'Lune gibbeuse décroissante'],
  [23.99, '🌗', 'Dernier quartier'],
  [27.68, '🌘', 'Dernier croissant'],
  [SYNODIC, '🌑', 'Nouvelle lune'],
]

export function moonPhase(date: string): { emoji: string; label: string; factor: number; effect: string } {
  const age = moonAge(date)
  const [, emoji, label] = PHASES.find(([limit]) => age < limit)!
  // Lune montante, et jusqu'à 3 jours après la pleine lune (~14,8 + 3 jours) : la période réputée favorable.
  const favorable = age < 17.8
  return {
    emoji,
    label,
    factor: favorable ? 1.15 : 0.9,
    effect: favorable ? 'réputée favorable (+15 %)' : 'réputée moins favorable (-10 %)',
  }
}

export function moonEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setMoonEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    // mémorisation facultative
  }
}
