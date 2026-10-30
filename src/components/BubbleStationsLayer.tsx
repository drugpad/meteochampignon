// Couche de bulles « cumul de pluie » pour un réseau amateur (Infoclimat, Netatmo) : un marqueur par station ;
// au toucher, une fiche avec la frise jour par jour (fichiers publiés par Home Assistant, 15 jours).
//
// Allègement au dézoom (« apparition progressive ») : Netatmo peut compter des milliers de stations ; afficher
// tout de loin serait illisible. On ne garde donc, dans la vue courante, qu'UNE station (la plus arrosée) par
// cellule d'une grille dont la taille diminue avec le zoom — plus on zoome, plus il en apparaît.
import { useEffect, useMemo, useState } from 'react'
import { Marker, Popup, useMap, useMapEvents } from 'react-leaflet'
import { loadNetwork, cachedNetwork, networkFriseDays, type NetworkData, type NetworkId, type NetworkStation } from '../lib/networkStations'
import { stationIcon, useZoomClass } from '../lib/stationBubbleIcon'
import { rainBubble, rainReference } from '../lib/stationRain'
import { DayRainFrise } from './DayRainFrise'
import './StationPopup.css'

const EMOJI: Record<NetworkId, string> = { infoclimat: '🌧️', netatmo: '🏠' }
const LABEL: Record<NetworkId, string> = { infoclimat: 'Station Infoclimat (StatIC)', netatmo: 'Station Netatmo' }
const fr = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })

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
          zIndexOffset={Math.round(s.mm)}
        >
          <Popup minWidth={260} maxWidth={300}>
            <NetworkStationCard network={network} data={data} station={s} />
          </Popup>
        </Marker>
      ))}
    </>
  )
}

function NetworkStationCard({ network, data, station }: { network: NetworkId; data: NetworkData; station: NetworkStation }) {
  const days = useMemo(() => networkFriseDays(data, station), [data, station])
  const name = network === 'netatmo' ? LABEL[network] : station.name
  const age = new Date(data.generatedAt)
  return (
    <div className="station-popup station-popup--network">
      <div className="station-popup__title">{name}</div>
      <div className="station-popup__altitude">
        {network === 'netatmo' ? 'Pluviomètre d\'un particulier (réseau Netatmo)' : LABEL[network]} · {station.lat.toFixed(3)}, {station.lon.toFixed(3)}
      </div>
      <div className="station-popup__section-title">
        Pluie des 3 derniers jours : {station.hours > 0 ? `${fr(station.mm)} mm` : 'pas de mesure'}
        {station.hours > 0 && station.hours < 0.8 * 72 && ` (au moins : ${station.hours} h mesurées sur 72)`}
      </div>
      {days.length > 0 ? (
        <>
          <div className="station-popup__section-title">Pluie jour par jour</div>
          <DayRainFrise days={days} />
          {days.some((d) => d.partial || d.mm === null) && (
            <div className="station-popup__notice">
              {network === 'netatmo'
                ? "Netatmo ne fournit pas d'historique : les jours avant le début de notre collecte, ou avec des heures manquantes, sont vides ou incomplets (hachurés)."
                : 'Jours hachurés ou vides : heures de mesure manquantes.'}
            </div>
          )}
        </>
      ) : (
        <div className="station-popup__message">Détail jour par jour pas encore publié pour ce réseau (prochaine collecte).</div>
      )}
      <div className="station-popup__altitude">Données mises à jour {age.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
    </div>
  )
}
