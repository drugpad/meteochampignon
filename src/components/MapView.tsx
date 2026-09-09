// Carte principale : fond plan/satellite (repris du socle Unmask), sélecteur
// de mode Prévision/Historique, et les couches propres à chaque mode.
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MapContainer, LayersControl, TileLayer, useMapEvents } from 'react-leaflet'
import { MIDI_PYRENEES_CENTER, MIDI_PYRENEES_DEFAULT_ZOOM } from '../lib/config'
import { getDailyForecast } from '../lib/openMeteo'
import { fetchCachedRainGrid, fetchRainGrid } from '../lib/rainGrid'
import { ForecastPanel } from './ForecastPanel'
import './MapView.css'
import { ModeSwitch } from './ModeSwitch'
import { RainControls } from './RainControls'
import { RainOverlay } from './RainOverlay'
import { StationsLayer } from './StationsLayer'
import type { AppMode, ForecastState, RainGridState, RainMapSource } from '../types'

function ClickHandler({ enabled, onClick }: { enabled: boolean; onClick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      if (enabled) onClick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

export function MapView() {
  const [mode, setMode] = useState<AppMode>('previsions')
  const [forecastState, setForecastState] = useState<ForecastState>({ status: 'idle' })
  const [rainState, setRainState] = useState<RainGridState>({ status: 'idle' })
  const [rainSource, setRainSource] = useState<RainMapSource>('open-meteo')

  const handleMapClick = useCallback((lat: number, lon: number) => {
    const point = { lat, lon }
    setForecastState({ status: 'loading', point })
    getDailyForecast(point)
      .then((days) => setForecastState({ status: 'ready', point, days }))
      .catch((err: Error) => setForecastState({ status: 'error', point, message: err.message }))
  }, [])

  // Au passage en mode Historique, on tente une seule fois le cache
  // pré-calculé par le job GitHub Actions (quasi instantané) — voir
  // lib/rainGrid.ts. Le calcul en direct (lent, handleForceRefresh
  // ci-dessous) reste disponible en secours (bouton) si ce cache est absent
  // ou trop vieux. Un ref (pas un state) pour "déjà tenté" : ça ne doit
  // jamais redéclencher cet effet lui-même (sinon boucle avec le
  // setRainState ci-dessous, vu que rainState.status fait partie des deps).
  const autoLoadTriedRef = useRef(false)
  useEffect(() => {
    if (mode !== 'historique' || rainSource !== 'open-meteo' || autoLoadTriedRef.current) return
    autoLoadTriedRef.current = true
    setRainState({ status: 'loading', loaded: 0, total: 1 })
    fetchCachedRainGrid().then((cached) => {
      setRainState(
        cached ? { status: 'ready', points: cached.points, fetchedAt: cached.fetchedAt } : { status: 'idle' },
      )
    })
  }, [mode, rainSource])

  const handleForceRefresh = useCallback(() => {
    setRainState({ status: 'loading', loaded: 0, total: 1 })
    fetchRainGrid((loaded, total) => setRainState({ status: 'loading', loaded, total }))
      .then((points) => setRainState({ status: 'ready', points, fetchedAt: Date.now() }))
      .catch((err: Error) => setRainState({ status: 'error', message: err.message }))
  }, [])

  return (
    <div className="map-view">
      <ModeSwitch mode={mode} onChange={setMode} />

      {mode === 'historique' && (
        <RainControls state={rainState} source={rainSource} onSourceChange={setRainSource} onForceRefresh={handleForceRefresh} />
      )}

      <MapContainer
        center={MIDI_PYRENEES_CENTER}
        zoom={MIDI_PYRENEES_DEFAULT_ZOOM}
        zoomControl={false}
        style={{ height: '100%', width: '100%' }}
      >
        <ClickHandler enabled={mode === 'previsions'} onClick={handleMapClick} />

        <LayersControl position="bottomleft">
          <LayersControl.BaseLayer checked name="Plan">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Satellite">
            <TileLayer
              attribution='&copy; <a href="https://www.ign.fr">IGN</a> - Géoplateforme'
              url="https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg"
              maxNativeZoom={19}
              crossOrigin="anonymous"
            />
          </LayersControl.BaseLayer>
        </LayersControl>

        {mode === 'historique' && (
          <>
            <StationsLayer />
            {rainSource === 'open-meteo' && rainState.status === 'ready' && <RainOverlay points={rainState.points} />}
          </>
        )}
      </MapContainer>

      {mode === 'previsions' && <ForecastPanel state={forecastState} onClose={() => setForecastState({ status: 'idle' })} />}
    </div>
  )
}

// Leaflet cherche ses icônes par défaut à des URL cassées une fois packagé
// par Vite — même correctif que dans Unmask.
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})
