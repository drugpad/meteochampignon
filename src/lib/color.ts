// Échelle de couleur pour le cumul de pluie 24h (mm), utilisée par
// RainOverlay.tsx et la légende (RainControls.tsx). Paliers demandés
// explicitement (pas un dégradé continu) : 0-5mm vert clair, 5-10mm vert
// foncé, 10-15mm bleu clair, 15-20mm bleu foncé, 20mm+ violet (un seul
// palier au-delà pour l'instant — à affiner plus tard si besoin de
// distinguer les très fortes pluies).
const BINS: { max: number; color: [number, number, number]; label: string }[] = [
  { max: 5, color: [134, 239, 172], label: '0-5mm' },
  { max: 10, color: [22, 163, 74], label: '5-10mm' },
  { max: 15, color: [125, 211, 252], label: '10-15mm' },
  { max: 20, color: [29, 78, 216], label: '15-20mm' },
  { max: Infinity, color: [124, 58, 237], label: '20mm+' },
]

// Renvoie une couleur "rgba(...)" pour un cumul de pluie donné — 0mm (ou
// négatif, ne devrait pas arriver) reste transparent pour ne pas teinter les
// zones sans pluie ; au-dessus, palier fixe (pas d'interpolation entre
// couleurs, contrairement à une v1 en dégradé jugée moins lisible).
export function rainColor(mm: number | null): string {
  if (mm === null || mm <= 0) return 'rgba(255,255,255,0)'
  const bin = BINS.find((b) => mm <= b.max) ?? BINS[BINS.length - 1]
  const [r, g, b] = bin.color
  return `rgba(${r},${g},${b},0.65)`
}

export const RAIN_LEGEND_STOPS = BINS.map((bin) => ({
  label: bin.label,
  color: `rgb(${bin.color.join(',')})`,
}))

// Échelle PROLONGÉE pour l'historique jour par jour et les cumuls sur plusieurs jours (curseur du mode Historique,
// 25/10/2026) : mêmes couleurs jusqu'à 20 mm, puis des paliers au-delà — un cumul de quelques jours dépasse vite
// 20 mm (107 mm le 19/10/2026 sur un seul jour) et tout serait d'un violet uniforme. Les cartes 24 h et prévision,
// plafonnées à 25,5 mm, gardent l'échelle ci-dessus.
const EXTENDED_BINS: { max: number; color: [number, number, number]; label: string }[] = [
  ...BINS.slice(0, 4),
  { max: 30, color: [124, 58, 237], label: '20-30' },
  { max: 50, color: [219, 39, 119], label: '30-50' },
  { max: 80, color: [220, 38, 38], label: '50-80' },
  { max: Infinity, color: [127, 29, 29], label: '80+' },
]

export function rainColorExtended(mm: number | null): string {
  if (mm === null || mm <= 0) return 'rgba(255,255,255,0)'
  const bin = EXTENDED_BINS.find((b) => mm <= b.max) ?? EXTENDED_BINS[EXTENDED_BINS.length - 1]
  const [r, g, b] = bin.color
  return `rgba(${r},${g},${b},0.65)`
}

export const RAIN_EXTENDED_LEGEND = EXTENDED_BINS.map((bin) => ({
  label: bin.label.replace('mm', ''),
  color: `rgb(${bin.color.join(',')})`,
}))
