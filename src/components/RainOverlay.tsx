// Carte de pluie : peint une image de pluie (un niveau 0-255 par cellule de
// 1 km, voir lib/rainMaps.ts) avec la palette de la légende, puis l'affiche
// sur la carte via un ImageOverlay Leaflet.
//
// Les niveaux sont d'abord agrandis par lissage bilinéaire (canvas), PUIS
// colorés : les contours des paliers de la légende restent nets et suivent le
// champ de pluie réel, au lieu d'un lissage de couleurs qui mélangerait les
// paliers entre eux.
import L from 'leaflet'
import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import { rainColor, rainColorExtended } from '../lib/color'
import type { RainImage, RainMapsMeta } from '../types'

const UPSCALE = 3
const OPACITY = 0.75

// extended : échelle prolongée au-delà de 20 mm (historique jour par jour et cumuls, voir lib/color.ts).
type Props = { image: RainImage; bounds: RainMapsMeta['bounds']; extended?: boolean }

// Table niveau (0-255) -> RGBA, une par échelle (0,1 mm par niveau pour les cartes de pluie, 0,5 mm pour
// l'historique jour par jour) : une seule table en cache aurait coloré la 2e échelle avec la 1re.
const luts = new Map<string, Uint8ClampedArray>()
function paletteLut(mmPerLevel: number, extended: boolean): Uint8ClampedArray {
  const key = `${mmPerLevel}|${extended}`
  const cached = luts.get(key)
  if (cached) return cached
  const lut = new Uint8ClampedArray(256 * 4)
  luts.set(key, lut)
  const colorOf = extended ? rainColorExtended : rainColor
  for (let level = 0; level < 256; level++) {
    const m = colorOf(level * mmPerLevel).match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/)
    if (!m) continue
    lut[level * 4] = Number(m[1])
    lut[level * 4 + 1] = Number(m[2])
    lut[level * 4 + 2] = Number(m[3])
    lut[level * 4 + 3] = Math.round((m[4] !== undefined ? parseFloat(m[4]) : 1) * 255)
  }
  return lut
}

function renderDataUrl(image: RainImage, extended: boolean): string {
  // 1) niveaux -> canvas source (gris dans le canal rouge)
  const src = document.createElement('canvas')
  src.width = image.width
  src.height = image.height
  const sctx = src.getContext('2d')!
  const srcData = sctx.createImageData(image.width, image.height)
  for (let i = 0; i < image.levels.length; i++) {
    srcData.data[i * 4] = image.levels[i]
    srcData.data[i * 4 + 3] = 255
  }
  sctx.putImageData(srcData, 0, 0)

  // 2) agrandissement lissé
  const big = document.createElement('canvas')
  big.width = image.width * UPSCALE
  big.height = image.height * UPSCALE
  const bctx = big.getContext('2d', { willReadFrequently: true })!
  bctx.imageSmoothingEnabled = true
  bctx.imageSmoothingQuality = 'high'
  bctx.drawImage(src, 0, 0, big.width, big.height)

  // 3) coloration par palette
  const px = bctx.getImageData(0, 0, big.width, big.height)
  const table = paletteLut(image.mmPerLevel, extended)
  for (let i = 0; i < px.data.length; i += 4) {
    const level = px.data[i]
    px.data[i] = table[level * 4]
    px.data[i + 1] = table[level * 4 + 1]
    px.data[i + 2] = table[level * 4 + 2]
    px.data[i + 3] = table[level * 4 + 3]
  }
  bctx.putImageData(px, 0, 0)
  return big.toDataURL()
}

export function RainOverlay({ image, bounds, extended = false }: Props) {
  const map = useMap()
  const overlayRef = useRef<L.ImageOverlay | null>(null)

  useEffect(() => {
    const dataUrl = renderDataUrl(image, extended)
    const latLngBounds = L.latLngBounds([bounds.latMin, bounds.lonMin], [bounds.latMax, bounds.lonMax])
    if (overlayRef.current) {
      overlayRef.current.setUrl(dataUrl)
      overlayRef.current.setBounds(latLngBounds)
    } else {
      overlayRef.current = L.imageOverlay(dataUrl, latLngBounds, { opacity: OPACITY, interactive: false }).addTo(map)
    }
  }, [image, bounds, map, extended])

  useEffect(() => {
    return () => {
      overlayRef.current?.remove()
      overlayRef.current = null
    }
  }, [map])

  return null
}
