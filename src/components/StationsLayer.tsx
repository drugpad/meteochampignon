// Couche des stations cliquables (mode Historique) — un marqueur par
// station, détail chargé à la demande (pas de requête tant qu'on n'a pas
// cliqué, voir StationPopup.tsx pour le contenu). Sur desktop, le détail
// s'affiche dans une popup Leaflet classique ; sur mobile, dans un écran
// plein-écran séparé (StationFullscreen.tsx) — une popup ancrée sur un
// petit point de carte est peu ergonomique au doigt (retour utilisateur).
import L from 'leaflet'
import { useState } from 'react'
import { Marker, Popup } from 'react-leaflet'
import { fetchStationDetail, STATIC_STATIONS } from '../lib/stations'
import { useIsMobile } from '../lib/useIsMobile'
import { StationFullscreen } from './StationFullscreen'
import { StationPopup } from './StationPopup'
import type { Station, StationDetailState } from '../types'

const STATION_ICON = L.divIcon({
  className: 'station-marker',
  html: '<div class="station-marker__pin">🌧️</div>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
})

function loadDetail(station: Station, setState: (s: StationDetailState) => void) {
  setState({ status: 'loading', station })
  fetchStationDetail(station)
    .then((detail) => setState({ status: 'ready', detail }))
    .catch((err: Error) => setState({ status: 'error', station, message: err.message }))
}

// Desktop : popup Leaflet classique, chargement au popupopen (comportement
// inchangé).
function StationMarkerDesktop({ station }: { station: Station }) {
  const [state, setState] = useState<StationDetailState>({ status: 'idle' })

  const handleOpen = () => {
    if (state.status === 'ready' || state.status === 'loading') return
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
    <Marker position={[station.lat, station.lon]} icon={STATION_ICON} eventHandlers={{ popupopen: handleOpen }}>
      <Popup minWidth={290} maxWidth={310}>
        <StationPopup state={state} />
      </Popup>
    </Marker>
  )
}

// Mobile : pas de popup Leaflet, le clic déclenche le chargement et
// notifie le parent (un seul écran plein-écran partagé, pas un par
// marqueur — voir StationsLayer).
function StationMarkerMobile({ station, onOpen }: { station: Station; onOpen: (station: Station) => void }) {
  return (
    <Marker
      position={[station.lat, station.lon]}
      icon={STATION_ICON}
      eventHandlers={{ click: () => onOpen(station) }}
    />
  )
}

export function StationsLayer() {
  const isMobile = useIsMobile()
  const [mobileSelection, setMobileSelection] = useState<{ station: Station; state: StationDetailState } | null>(null)

  const handleMobileOpen = (station: Station) => {
    setMobileSelection({ station, state: { status: 'loading', station } })
    loadDetail(station, (state) => setMobileSelection({ station, state }))
  }

  if (!isMobile) {
    return (
      <>
        {STATIC_STATIONS.map((station) => (
          <StationMarkerDesktop key={station.id} station={station} />
        ))}
      </>
    )
  }

  return (
    <>
      {STATIC_STATIONS.map((station) => (
        <StationMarkerMobile key={station.id} station={station} onOpen={handleMobileOpen} />
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
