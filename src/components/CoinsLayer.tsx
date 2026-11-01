// Mode « Coins » sur la carte : coloration des secteurs propices et marqueurs numérotés du palmarès.
import L from 'leaflet'
import { useEffect, useMemo, useRef } from 'react'
import { Marker, useMap } from 'react-leaflet'
import { renderCoins, type CoinsResult } from '../lib/coins'
import type { NamedSpot } from './CoinsControls'

const rankIcon = (n: number) =>
  L.divIcon({ className: '', html: `<div class="coins-rank-marker">${n}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] })

// hideFromZoom : la carte à 250 m s'efface à partir de ce zoom (les tuiles à 20 m prennent le relais).
// hidden : la carte fine à 20 m a fini de se dessiner à ce zoom (elle prend le relais) ; tant qu'elle charge, cette
// carte d'ensemble reste visible (01/11/2026 : au passage du zoom 10, l'écran restait vide sur téléphone).
type Props = { result: CoinsResult; spots: NamedSpot[]; onSelectSpot: (s: NamedSpot) => void; hidden?: boolean; opacity: number }

export function CoinsLayer({ result, spots, onSelectSpot, hidden = false, opacity }: Props) {
  const map = useMap()
  const overlayRef = useRef<L.ImageOverlay | null>(null)

  useEffect(() => {
    const url = renderCoins(result)
    const b = result.bounds
    const bounds = L.latLngBounds([b.latMin, b.lonMin], [b.latMax, b.lonMax])
    if (overlayRef.current) {
      overlayRef.current.setUrl(url)
      overlayRef.current.setBounds(bounds)
    } else {
      overlayRef.current = L.imageOverlay(url, bounds, { opacity, interactive: false, className: 'coins-overlay' }).addTo(map)
    }
  }, [result, map])

  useEffect(() => {
    overlayRef.current?.setOpacity(hidden ? 0 : opacity)
  }, [hidden, result, opacity])

  useEffect(
    () => () => {
      overlayRef.current?.remove()
      overlayRef.current = null
    },
    [map],
  )

  const icons = useMemo(() => spots.map((_, i) => rankIcon(i + 1)), [spots])
  return (
    <>
      {spots.map((s, i) => (
        <Marker
          key={`${s.lat},${s.lon}`}
          position={[s.lat, s.lon]}
          icon={icons[i]}
          zIndexOffset={2000 - i}
          eventHandlers={{ click: () => onSelectSpot(s) }}
        />
      ))}
    </>
  )
}
