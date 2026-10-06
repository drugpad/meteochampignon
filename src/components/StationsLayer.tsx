// Couche des stations cliquables (mode Historique) — un marqueur par
// station, détail chargé à la demande (pas de requête tant qu'on n'a pas
// cliqué, voir StationPopup.tsx pour le contenu). Sur desktop, le détail
// s'affiche dans une popup Leaflet classique ; sur mobile, dans un écran
// plein-écran séparé (StationFullscreen.tsx) — une popup ancrée sur un
// petit point de carte est peu ergonomique au doigt (retour utilisateur).
import L from 'leaflet'
import { useRef, useState } from 'react'
import { Marker, Popup, useMap, useMapEvents } from 'react-leaflet'
import { fetchStationDetail, STATIC_STATIONS } from '../lib/stations'
import { useIsMobile } from '../lib/useIsMobile'
import { StationFullscreen } from './StationFullscreen'
import { StationPopup } from './StationPopup'
import type { Station, StationDetailState } from '../types'

const PIN_ICON = L.divIcon({
  className: 'station-marker',
  html: '<div class="station-marker__pin">🌧️</div>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
})

// Au zoom de départ, 239 pastilles de 26 px se recouvrent complètement (surtout sur téléphone) : en
// dessous du zoom 10, de simples points, plus petits tant qu'on est loin. La zone cliquable reste
// de 28 px (doigt), seul le point dessiné rétrécit.
const dotIcon = (px: number) =>
  L.divIcon({
    className: 'station-marker',
    html: `<div class="station-marker__dot" style="width:${px}px;height:${px}px"></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })
const DOT_FAR = dotIcon(9)
const DOT_MID = dotIcon(14)
const iconForZoom = (zoom: number) => (zoom >= 10 ? PIN_ICON : zoom >= 9 ? DOT_MID : DOT_FAR)

function useIconForZoom() {
  const map = useMap()
  const [zoom, setZoom] = useState(() => map.getZoom())
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) })
  return iconForZoom(zoom)
}

// Âge au-delà duquel rouvrir une popup recharge le détail (même seuil que le
// cache de l'historique, voir HISTORY_MAX_AGE_MS dans lib/stations.ts).
const DETAIL_MAX_AGE_MS = 10 * 60 * 1000

function loadDetail(station: Station, setState: (s: StationDetailState) => void) {
  setState({ status: 'loading', station })
  fetchStationDetail(station)
    .then((detail) => setState({ status: 'ready', detail }))
    .catch((err: Error) => setState({ status: 'error', station, message: err.message }))
}

// Desktop : popup Leaflet classique, chargement au popupopen (comportement
// inchangé).
function StationMarkerDesktop({ station, icon }: { station: Station; icon: L.DivIcon }) {
  const [state, setState] = useState<StationDetailState>({ status: 'idle' })
  const loadedAtRef = useRef(0)

  const handleOpen = () => {
    if (state.status === 'loading') return
    if (state.status === 'ready') {
      // Détail déjà affiché : le rafraîchir EN SILENCE s'il date (un onglet
      // resté ouvert des heures montrait sinon toujours les données du
      // premier clic). Pas de passage par "Chargement…" : ça ferait
      // clignoter la popup à chaque réouverture.
      if (Date.now() - loadedAtRef.current < DETAIL_MAX_AGE_MS) return
      loadedAtRef.current = Date.now()
      fetchStationDetail(station)
        .then((detail) => setState({ status: 'ready', detail }))
        .catch(() => undefined) // on garde l'ancien détail plutôt que de l'effacer
      return
    }
    loadedAtRef.current = Date.now()
    loadDetail(station, setState)
  }

  // Leaflet ne recalcule le positionnement/l'autoPan de la popup qu'à
  // l'ouverture — à ce moment-là le contenu n'est encore que "Chargement…".
  // Le correctif est dans StationPopup.css : `.station-popup--message`
  // réserve déjà la même hauteur (plafonnée, défilement interne) que le
  // contenu final, donc le seul autoPan qui se déclenche (celui de
  // l'ouverture) voit déjà la bonne taille — pas de repositionnement après
  // coup nécessaire.
  return (
    <Marker position={[station.lat, station.lon]} icon={icon} eventHandlers={{ popupopen: handleOpen }}>
      <Popup minWidth={290} maxWidth={310}>
        <StationPopup state={state} />
      </Popup>
    </Marker>
  )
}

// Mobile : pas de popup Leaflet, le clic déclenche le chargement et
// notifie le parent (un seul écran plein-écran partagé, pas un par
// marqueur — voir StationsLayer).
function StationMarkerMobile({ station, icon, onOpen }: { station: Station; icon: L.DivIcon; onOpen: (station: Station) => void }) {
  return (
    <Marker
      position={[station.lat, station.lon]}
      icon={icon}
      eventHandlers={{ click: () => onOpen(station) }}
    />
  )
}

export function StationsLayer() {
  const isMobile = useIsMobile()
  const icon = useIconForZoom()
  const [mobileSelection, setMobileSelection] = useState<{ station: Station; state: StationDetailState } | null>(null)

  const handleMobileOpen = (station: Station) => {
    setMobileSelection({ station, state: { status: 'loading', station } })
    loadDetail(station, (state) => setMobileSelection({ station, state }))
  }

  if (!isMobile) {
    return (
      <>
        {STATIC_STATIONS.map((station) => (
          <StationMarkerDesktop key={station.id} station={station} icon={icon} />
        ))}
      </>
    )
  }

  return (
    <>
      {STATIC_STATIONS.map((station) => (
        <StationMarkerMobile key={station.id} station={station} icon={icon} onOpen={handleMobileOpen} />
      ))}
      {mobileSelection && (
        <StationFullscreen
          station={mobileSelection.station}
          state={mobileSelection.state}
          onClose={() => setMobileSelection(null)}
        />
      )}
    </>
  )
}
