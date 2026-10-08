// Icônes Leaflet des stations (bulle « cumul de pluie »), partagées entre les réseaux (Météo-France,
// Infoclimat, Netatmo). Trois tailles selon le zoom (beaucoup de marqueurs : trop serrés de loin).
import L from 'leaflet'
import { useState } from 'react'
import { useMap, useMapEvents } from 'react-leaflet'
import type { RainBubble } from './stationRain'

export type ZoomClass = 'far' | 'mid' | 'near'
export const zoomClassOf = (zoom: number): ZoomClass => (zoom >= 10 ? 'near' : zoom >= 9 ? 'mid' : 'far')

const bubbleHtml = (b: RainBubble, offsetPx: number, solo = false) =>
  `<div class="station-marker__rain${solo ? ' station-marker__rain--solo' : ''}" title="${b.title}" style="background:${b.bg};color:${b.fg};--off:${offsetPx}px">${b.label}</div>`

// Les icônes ne dépendent que de (zoom, couleur, texte) : on les réutilise (peu de valeurs distinctes).
const iconCache = new Map<string, L.DivIcon>()
export function stationIcon(zoomClass: ZoomClass, bubble: RainBubble, emoji = '🌧️'): L.DivIcon {
  const key = `${zoomClass}|${bubble.bg}|${bubble.label}|${emoji}`
  let icon = iconCache.get(key)
  if (!icon) {
    const dot = (px: number) =>
      `<div class="station-marker__dot" style="width:${px}px;height:${px}px;background:${bubble.bg}"></div>`
    const loading = bubble.label === '' // cumuls pas encore chargés : marqueur neutre sans chiffre
    const html =
      zoomClass === 'near'
        ? `<div class="station-marker__pin">${emoji}</div>` + (loading ? '' : bubbleHtml(bubble, 15))
        : zoomClass === 'mid'
          ? dot(14) + (loading ? '' : bubbleHtml(bubble, 9))
          : loading
            ? dot(11)
            : bubbleHtml(bubble, 0, true)
    icon = L.divIcon({ className: 'station-marker', html, iconSize: [28, 28], iconAnchor: [14, 14] })
    iconCache.set(key, icon)
  }
  return icon
}

export function useZoomClass(): ZoomClass {
  const map = useMap()
  const [zoom, setZoom] = useState(() => map.getZoom())
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) })
  return zoomClassOf(zoom)
}
