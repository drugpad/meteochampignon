// Couche des stations cliquables (mode Historique) — un marqueur par
// station, popup chargée à la demande (pas de requête tant qu'on n'a pas
// cliqué, voir StationPopup.tsx pour le contenu).
import L from 'leaflet'
import { useState } from 'react'
import { Marker, Popup } from 'react-leaflet'
import { fetchStationDetail, STATIC_STATIONS } from '../lib/stations'
import { StationPopup } from './StationPopup'
import type { StationDetailState } from '../types'

const STATION_ICON = L.divIcon({
  className: 'station-marker',
  html: '<div class="station-marker__pin">🌧️</div>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
})

function StationMarker({ station }: { station: (typeof STATIC_STATIONS)[number] }) {
  const [state, setState] = useState<StationDetailState>({ status: 'idle' })

  const handleOpen = () => {
    if (state.status === 'ready' || state.status === 'loading') return
    setState({ status: 'loading', station })
    fetchStationDetail(station)
      .then((detail) => setState({ status: 'ready', detail }))
      .catch((err: Error) => setState({ status: 'error', station, message: err.message }))
  }

  return (
    <Marker position={[station.lat, station.lon]} icon={STATION_ICON} eventHandlers={{ popupopen: handleOpen }}>
      <Popup minWidth={260} maxWidth={280}>
        <StationPopup state={state} />
      </Popup>
    </Marker>
  )
}

export function StationsLayer() {
  return (
    <>
      {STATIC_STATIONS.map((station) => (
        <StationMarker key={station.id} station={station} />
      ))}
    </>
  )
}
