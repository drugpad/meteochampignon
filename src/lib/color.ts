// Échelle de couleur pour le cumul de pluie 24h (mm), utilisée par
// RainOverlay.tsx et la légende. Paliers inspirés des échelles Météo-France
// habituelles (bleu clair = faible, violet = très fort).
const STOPS: [number, [number, number, number]][] = [
  [0, [255, 255, 255]], // pas de pluie : transparent (voir alpha dans rainColor)
  [1, [186, 228, 255]],
  [5, [107, 190, 255]],
  [10, [46, 138, 240]],
  [20, [40, 90, 220]],
  [40, [130, 60, 200]],
  [70, [190, 30, 150]],
  [120, [140, 10, 60]],
]

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

// Renvoie une couleur "rgba(...)" pour un cumul de pluie donné, avec une
// opacité qui grandit avec l'intensité (0mm quasi invisible, fortes pluies
// bien visibles) — pensé pour être peint par-dessus un fond de carte.
export function rainColor(mm: number | null): string {
  if (mm === null || mm <= 0) return 'rgba(255,255,255,0)'

  let lower = STOPS[0]
  let upper = STOPS[STOPS.length - 1]
  for (let i = 0; i < STOPS.length - 1; i++) {
    if (mm >= STOPS[i][0] && mm <= STOPS[i + 1][0]) {
      lower = STOPS[i]
      upper = STOPS[i + 1]
      break
    }
  }
  const [v0, c0] = lower
  const [v1, c1] = upper
  const t = v1 === v0 ? 1 : (mm - v0) / (v1 - v0)
  const r = Math.round(lerp(c0[0], c1[0], t))
  const g = Math.round(lerp(c0[1], c1[1], t))
  const b = Math.round(lerp(c0[2], c1[2], t))
  const alpha = Math.min(0.85, 0.15 + mm / 60)
  return `rgba(${r},${g},${b},${alpha.toFixed(2)})`
}

export const RAIN_LEGEND_STOPS = STOPS.slice(1).map(([mm, rgb]) => ({
  mm,
  color: `rgb(${rgb.join(',')})`,
}))
