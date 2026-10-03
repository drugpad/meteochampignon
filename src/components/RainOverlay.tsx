// Carte de pluie 24h (Option A) : peint la grille interpolée dans un canvas,
// puis l'affiche sur la carte via un ImageOverlay Leaflet (recalculé à
// chaque nouvelle grille reçue).
import L from 'leaflet'
import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import { MIDI_PYRENEES_BOUNDS, RAIN_GRID_COLS, RAIN_GRID_ROWS, RAIN_GRID_STEP_DEG } from '../lib/config'
import { rainColor } from '../lib/color'
import type { RainGridPoint } from '../types'

const CANVAS_SIZE = 320 // résolution du rendu ; le dégradé lisse le reste

type Props = { points: RainGridPoint[] }

export function RainOverlay({ points }: Props) {
  const map = useMap()
  const overlayRef = useRef<L.ImageOverlay | null>(null)

  useEffect(() => {
    if (points.length === 0) return

    const { latMin, lonMin } = MIDI_PYRENEES_BOUNDS
    const rows = RAIN_GRID_ROWS
    const cols = RAIN_GRID_COLS
    // Étendue RÉELLE de la grille (dernier point), pas MIDI_PYRENEES_BOUNDS :
    // le pas ne tombe pas pile sur latMax/lonMax (3.38 vs 3.4 à l'est), et
    // caler l'image sur les bornes théoriques extrapolait au-delà du dernier
    // point de grille.
    const latMax = latMin + (rows - 1) * RAIN_GRID_STEP_DEG
    const lonMax = lonMin + (cols - 1) * RAIN_GRID_STEP_DEG

    // Index rapide grille régulière [row][col] -> rain24h.
    const grid: (number | null)[][] = Array.from({ length: rows }, () => Array(cols).fill(null))
    for (const p of points) {
      const col = Math.round((p.lon - lonMin) / RAIN_GRID_STEP_DEG)
      const row = Math.round((p.lat - latMin) / RAIN_GRID_STEP_DEG)
      if (row >= 0 && row < rows && col >= 0 && col < cols) grid[row][col] = p.rain24h
    }

    const canvas = document.createElement('canvas')
    canvas.width = CANVAS_SIZE
    canvas.height = CANVAS_SIZE
    const ctx = canvas.getContext('2d')!
    const imageData = ctx.createImageData(CANVAS_SIZE, CANVAS_SIZE)

    for (let py = 0; py < CANVAS_SIZE; py++) {
      // y=0 en haut du canvas = latMax (nord).
      const lat = latMax - (py / (CANVAS_SIZE - 1)) * (latMax - latMin)
      const rowF = (lat - latMin) / RAIN_GRID_STEP_DEG
      const row0 = Math.max(0, Math.min(rows - 2, Math.floor(rowF)))
      const ty = rowF - row0

      for (let px = 0; px < CANVAS_SIZE; px++) {
        const lon = lonMin + (px / (CANVAS_SIZE - 1)) * (lonMax - lonMin)
        const colF = (lon - lonMin) / RAIN_GRID_STEP_DEG
        const col0 = Math.max(0, Math.min(cols - 2, Math.floor(colF)))
        const tx = colF - col0

        // Interpolation bilinéaire des 4 points de grille encadrants. Un point
        // sans donnée (null) est écarté du calcul, ses poids reportés sur les
        // voisins qui en ont — plutôt que compté comme 0 mm, ce qui tirait la
        // pluie vers 0 autour de chaque trou (et laissait croire à une zone
        // sèche). Les 4 coins null → 0 (rien à afficher).
        let weighted = 0
        let totalWeight = 0
        const corners: [number | null, number][] = [
          [grid[row0][col0], (1 - tx) * (1 - ty)],
          [grid[row0][col0 + 1], tx * (1 - ty)],
          [grid[row0 + 1][col0], (1 - tx) * ty],
          [grid[row0 + 1][col0 + 1], tx * ty],
        ]
        for (const [v, w] of corners) {
          if (v === null) continue
          weighted += v * w
          totalWeight += w
        }
        const value = totalWeight > 0 ? weighted / totalWeight : 0

        const [r, g, b, a] = parseRgba(rainColor(value))
        const idx = (py * CANVAS_SIZE + px) * 4
        imageData.data[idx] = r
        imageData.data[idx + 1] = g
        imageData.data[idx + 2] = b
        imageData.data[idx + 3] = a
      }
    }

    ctx.putImageData(imageData, 0, 0)
    const dataUrl = canvas.toDataURL()

    const bounds = L.latLngBounds([latMin, lonMin], [latMax, lonMax])
    if (overlayRef.current) {
      overlayRef.current.setUrl(dataUrl)
      overlayRef.current.setBounds(bounds)
    } else {
      overlayRef.current = L.imageOverlay(dataUrl, bounds, { opacity: 0.75, interactive: false }).addTo(map)
    }
  }, [points, map])

  useEffect(() => {
    return () => {
      overlayRef.current?.remove()
      overlayRef.current = null
    }
  }, [map])

  return null
}

function parseRgba(css: string): [number, number, number, number] {
  const m = css.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/)
  if (!m) return [0, 0, 0, 0]
  const alpha = m[4] !== undefined ? parseFloat(m[4]) : 1
  return [Number(m[1]), Number(m[2]), Number(m[3]), Math.round(alpha * 255)]
}
