// Couche de bulles « cumul de pluie » pour un réseau non cliquable (Infoclimat, Netatmo) : un marqueur par
// station, sans popup (le cumul s'affiche en infobulle native au survol — attribut title de la bulle).
//
// Allègement au dézoom (« apparition progressive ») : Netatmo peut compter des milliers de stations ; afficher
// tout de loin serait illisible. On ne garde donc, dans la vue courante, qu'UNE station (la plus arrosée) par
// cellule d'une grille dont la taille diminue avec le zoom — plus on zoome, plus il en apparaît.
import { useEffect, useMemo, useState } from 'react'
import { Marker, useMap, useMapEvents } from 'react-leaflet'
import { loadNetwork, cachedNetwork, type NetworkData, type NetworkId, type NetworkStation } from '../lib/networkStations'
import { stationIcon, useZoomClass } from '../lib/stationBubbleIcon'
import { rainBubble, rainReference } from '../lib/stationRain'

const EMOJI: Record<NetworkId, string> = { infoclimat: '🌧️', netatmo: '🏠' }

function useNetwork(network: NetworkId): NetworkData | null {
  const [data, setData] = useState<NetworkData | null>(() => cachedNetwork(network))
  useEffect(() => {
    let alive = true
    const load = () => loadNetwork(network).then((d) => alive && setData(d)).catch(() => undefined)
    load()
    const timer = window.setInterval(load, 10 * 60 * 1000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [network])
  return data
}

// Taille de cellule (en degrés) pour l'allègement, selon le zoom : ~la largeur d'une bulle à l'écran.
function cellSize(zoom: number): number {
  return 0.5 / 2 ** Math.max(0, zoom - 6)
}

// Suit la vue (déplacement/zoom) pour ne garder que les stations visibles et les ré-échantillonner.
function useViewport() {
  const map = useMap()
  const [v, setV] = useState(0)
  useMapEvents({ moveend: () => setV((n) => n + 1), zoomend: () => setV((n) => n + 1) })
  return useMemo(() => ({ bounds: map.getBounds().pad(0.1), zoom: map.getZoom() }), [map, v])
}

export function BubbleStationsLayer({ network }: { network: NetworkId }) {
  const data = useNetwork(network)
  const zoomClass = useZoomClass()
  const { bounds, zoom } = useViewport()

  const reference = useMemo(() => (data ? rainReference(Object.fromEntries(data.stations.map((s) => [s.id, s]))) : 5), [data])

  // Stations visibles, allégées : une par cellule (la plus arrosée).
  const shown = useMemo(() => {
    if (!data) return []
    const cell = cellSize(zoom)
    const best = new Map<string, NetworkStation>()
    for (const s of data.stations) {
      if (!bounds.contains([s.lat, s.lon])) continue
      const key = `${Math.round(s.lat / cell)}|${Math.round(s.lon / cell)}`
      const cur = best.get(key)
      if (!cur || s.mm > cur.mm) best.set(key, s)
    }
    return [...best.values()]
  }, [data, bounds, zoom])

  if (!data) return null
  return (
    <>
      {shown.map((s) => (
        <Marker
          key={s.id}
          position={[s.lat, s.lon]}
          icon={stationIcon(zoomClass, rainBubble(s, reference), EMOJI[network])}
          interactive={false}
          keyboard={false}
          zIndexOffset={Math.round(s.mm)}
        />
      ))}
    </>
  )
}
