// Cumul de pluie des 3 derniers jours par station, affiché dans une bulle à côté de chaque station (mode
// Historique), avec une couleur bleue d'autant plus foncée qu'il a plus plu que sur les autres stations.
//
// Fonctions pures (pas de réseau, pas de React) : le chargement de l'historique est dans lib/stations.ts.

export const RAIN_TOTAL_HOURS = 72
const HOUR_MS = 3600000
// En dessous de cette part des heures attendues, le cumul est un minimum (« ≥ 4 ») : des mesures manquent.
const COMPLETE_RATIO = 0.8
// Référence de l'échelle de couleur : le 95e centile des cumuls des stations, mais jamais moins de 5 mm. Sans ce
// plancher, une semaine presque sèche (0,4 mm au maximum) peindrait la station « la plus arrosée » en bleu foncé.
const MIN_REFERENCE_MM = 5

export type StationRainTotal = { mm: number; hours: number }

type Point = { time: string; rr1: number | null }

// `rr1` est la pluie de l'heure qui PRÉCÈDE l'horodatage : les points de (maintenant - 72 h ; maintenant]
// couvrent exactement 72 heures.
export function computeRainTotals(
  stations: Record<string, Point[]>,
  now = Date.now(),
): Record<string, StationRainTotal> {
  const since = now - RAIN_TOTAL_HOURS * HOUR_MS
  const out: Record<string, StationRainTotal> = {}
  for (const [id, points] of Object.entries(stations)) {
    let mm = 0
    let hours = 0
    for (const p of points) {
      const t = new Date(p.time).getTime()
      if (t > since && t <= now && p.rr1 !== null) {
        mm += p.rr1
        hours++
      }
    }
    out[id] = { mm: Math.round(mm * 10) / 10, hours }
  }
  return out
}

// Cumul de référence (couleur la plus foncée) : voir MIN_REFERENCE_MM.
export function rainReference(totals: Record<string, StationRainTotal>): number {
  const values = Object.values(totals)
    .filter((t) => t.hours > 0)
    .map((t) => t.mm)
    .sort((a, b) => a - b)
  if (values.length === 0) return MIN_REFERENCE_MM
  const p95 = values[Math.min(values.length - 1, Math.floor(values.length * 0.95))]
  return Math.max(MIN_REFERENCE_MM, p95)
}

export type RainBubble = { bg: string; fg: string; label: string; title: string }

// Cumuls pas encore chargés : marqueur neutre SANS chiffre. Sans cela, toutes les stations s'affichaient d'abord
// avec la bulle grise « – » (= aucune mesure) avant de changer de couleur : un clignotement qui ressemble à de la lenteur.
export const BUBBLE_LOADING: RainBubble = { bg: '#e5e7eb', fg: '#6b7280', label: '', title: 'Chargement des cumuls de pluie…' }

const frNumber = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })

// Couleur et texte de la bulle d'une station. Intensité en racine carrée : la pluie est très « pointue » (beaucoup
// de petits cumuls, quelques gros), en linéaire presque toutes les stations seraient du même bleu pâle.
export function rainBubble(total: StationRainTotal | undefined, reference: number): RainBubble {
  if (!total || total.hours === 0) {
    return { bg: '#e5e7eb', fg: '#6b7280', label: '–', title: 'Pas de mesure sur les 3 derniers jours' }
  }
  const incomplete = total.hours < COMPLETE_RATIO * RAIN_TOTAL_HOURS
  const title =
    `${frNumber(total.mm)} mm sur 3 jours` +
    (incomplete ? ` (au moins : ${total.hours} h mesurées sur ${RAIN_TOTAL_HOURS})` : '')
  if (total.mm === 0) {
    return { bg: 'hsl(215 60% 96%)', fg: '#64748b', label: incomplete ? '≥0' : '0', title }
  }
  const intensity = Math.min(1, Math.sqrt(total.mm / reference))
  const lightness = 88 - 58 * intensity // 88 % (bleu très pâle) -> 30 % (bleu profond)
  const text = total.mm < 10 ? frNumber(total.mm) : String(Math.round(total.mm))
  return {
    bg: `hsl(215 85% ${lightness.toFixed(0)}%)`,
    fg: lightness < 58 ? '#ffffff' : '#1e3a8a',
    label: (incomplete ? '≥' : '') + text,
    title,
  }
}
