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
