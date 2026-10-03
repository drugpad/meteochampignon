// Carte principale : fond plan/satellite (repris du socle Unmask), sélecteur
// de mode Prévision/Historique, et les couches propres à chaque mode.
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, LayersControl, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import { zoomForResultType, type GeocodeResult } from '../lib/geocoding'
import { getDailyForecast } from '../lib/openMeteo'
import { fetchCachedRainForecastGrid, fetchRainForecastGrid, firstCurrentDayIndex } from '../lib/rainForecastGrid'
import { fetchCachedRainGrid, fetchRainGrid } from '../lib/rainGrid'
import { REGION_BOUNDS } from '../lib/regionOutline'
import { useIsMobile } from '../lib/useIsMobile'
import { ForecastFullscreen } from './ForecastFullscreen'
import { ForecastPanel } from './ForecastPanel'
import { ForecastRainControls } from './ForecastRainControls'
import './MapView.css'
import { ModeSwitch } from './ModeSwitch'
import { RainControls } from './RainControls'
import { RainOverlay } from './RainOverlay'
import { RegionOutline } from './RegionOutline'
import { SearchBar } from './SearchBar'
import { StationsLayer } from './StationsLayer'
import type { AppMode, ForecastState, RainForecastGridState, RainGridPoint, RainGridState, RainMapSource } from '../types'

// Bug constaté sur Unmask (même fond Plan/Satellite) et reproduit ici : de
// grands carrés gris/blancs apparaissent sur la carte — des tuiles qui
// n'ont jamais fini de charger (le fond de `.leaflet-container` transparaît
// derrière une tuile en échec). Les tuiles Leaflet sont de simples <img>,
// donc hors de tout planificateur de débit — un panoramique/zoom rapide
// peut déclencher assez de requêtes en parallèle pour dépasser une limite
// de débit côté serveur de tuiles (429, timeout), sans que Leaflet ne
// réessaie jamais de lui-même par défaut. On relance donc nous-mêmes la
// tuile en échec, avec un paramètre anti-cache pour forcer une vraie
// nouvelle requête (sinon le navigateur peut resservir la même réponse en
// échec depuis son cache HTTP). Voir ../unmask/src/components/MapView.tsx.
const TILE_RETRY_DELAYS_MS = [1000, 2000, 4000]

function handleTileError(event: L.TileErrorEvent) {
  const tile = event.tile as HTMLImageElement & { _retryCount?: number }
  const retryIndex = tile._retryCount ?? 0
  if (retryIndex >= TILE_RETRY_DELAYS_MS.length) return
  tile._retryCount = retryIndex + 1
  const baseSrc = tile.src.replace(/&_retry=\d+$/, '')
  // + un peu de délai aléatoire (jusqu'à 500ms) : plusieurs tuiles échouent
  // souvent ensemble (même rafale à l'origine du dépassement de débit), les
  // relancer toutes exactement au même instant recréerait la même rafale.
  const jitterMs = Math.random() * 500
  window.setTimeout(() => {
    tile.src = `${baseSrc}&_retry=${Date.now()}`
  }, TILE_RETRY_DELAYS_MS[retryIndex] + jitterMs)
}

function ClickHandler({ enabled, onClick }: { enabled: boolean; onClick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      if (enabled) onClick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

// Recentre/zoome la carte sur le résultat sélectionné dans la barre de
// recherche (voir SearchBar.tsx).
function RecenterOnSelect({ target }: { target: GeocodeResult | null }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lon], zoomForResultType(target.type))
  }, [target, map])
  return null
}

// Sur mobile, la barre d'adresse du navigateur apparaît/disparaît au fil du
// scroll et des interactions (dont un simple clic) sans que la fenêtre ne
// déclenche toujours un `resize` classique — Leaflet, qui mesure son
// conteneur une fois au montage, se retrouvait alors avec une carte mal
// dimensionnée ou mal positionnée après un clic (retour utilisateur : "je
// clique, mais l'affichage n'est pas bon"). On observe donc directement la
// taille du conteneur (ResizeObserver, plus fiable que `resize`/
// `orientationchange` sur mobile) et on redemande à Leaflet de se
// remesurer à chaque changement.
function InvalidateSizeOnResize() {
  const map = useMap()
  useEffect(() => {
    const container = map.getContainer()
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(container)
    return () => observer.disconnect()
  }, [map])
  return null
}

export function MapView() {
  const isMobile = useIsMobile()
  const [mode, setMode] = useState<AppMode>('previsions')
  const [forecastState, setForecastState] = useState<ForecastState>({ status: 'idle' })
  const [rainState, setRainState] = useState<RainGridState>({ status: 'idle' })
  const [rainSource, setRainSource] = useState<RainMapSource>('open-meteo')
  const [forecastRainState, setForecastRainState] = useState<RainForecastGridState>({ status: 'idle' })
  const [selectedForecastDay, setSelectedForecastDay] = useState(0)
  const [searchTarget, setSearchTarget] = useState<GeocodeResult | null>(null)

  // Numéro du dernier clic : deux clics rapprochés lancent deux requêtes, et
  // la plus lente (donc souvent la première) ne doit pas écraser la réponse
  // du dernier point cliqué.
  const forecastRequestRef = useRef(0)
  const handleMapClick = useCallback((lat: number, lon: number) => {
    const point = { lat, lon }
    const requestId = ++forecastRequestRef.current
    setForecastState({ status: 'loading', point })
    getDailyForecast(point)
      .then((days) => {
        if (requestId === forecastRequestRef.current) setForecastState({ status: 'ready', point, days })
      })
      .catch((err: Error) => {
        if (requestId === forecastRequestRef.current) setForecastState({ status: 'error', point, message: err.message })
      })
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

  // Même principe que le cache de la carte 24h ci-dessus, mais au passage
  // en mode Prévisions (voir lib/rainForecastGrid.ts).
  const autoLoadForecastRainTriedRef = useRef(false)
  useEffect(() => {
    if (mode !== 'previsions' || autoLoadForecastRainTriedRef.current) return
    autoLoadForecastRainTriedRef.current = true
    setForecastRainState({ status: 'loading', loaded: 0, total: 1 })
    fetchCachedRainForecastGrid().then((cached) => {
      if (cached) setSelectedForecastDay(firstCurrentDayIndex(cached.dates))
      setForecastRainState(
        cached ? { status: 'ready', points: cached.points, dates: cached.dates, fetchedAt: cached.fetchedAt } : { status: 'idle' },
      )
    })
  }, [mode])

  const handleForecastRainForceRefresh = useCallback(() => {
    setForecastRainState({ status: 'loading', loaded: 0, total: 1 })
    fetchRainForecastGrid((loaded, total) => setForecastRainState({ status: 'loading', loaded, total }))
      .then(({ points, dates }) => {
        setSelectedForecastDay(firstCurrentDayIndex(dates))
        setForecastRainState({ status: 'ready', points, dates, fetchedAt: Date.now() })
      })
      .catch((err: Error) => setForecastRainState({ status: 'error', message: err.message }))
  }, [])

  // RainOverlay attend une seule valeur par point (voir RainGridPoint) —
  // projette le jour sélectionné du tableau `rain` de chaque point de la
  // grille prévue dans cette forme, plutôt que de généraliser RainOverlay
  // pour un gain qui ne concernerait que cet appelant.
  const selectedForecastRainPoints = useMemo((): RainGridPoint[] => {
    if (forecastRainState.status !== 'ready') return []
    return forecastRainState.points.map((p) => ({ lat: p.lat, lon: p.lon, rain24h: p.rain[selectedForecastDay] ?? null }))
  }, [forecastRainState, selectedForecastDay])

  return (
    <div className="map-view">
      <div className="floating-controls">
        <div className="floating-controls__row">
          <ModeSwitch mode={mode} onChange={setMode} />
          <SearchBar onSelect={setSearchTarget} />
        </div>

        {mode === 'historique' && (
          <RainControls state={rainState} source={rainSource} onSourceChange={setRainSource} onForceRefresh={handleForceRefresh} />
        )}
        {mode === 'previsions' && (
          <ForecastRainControls
            state={forecastRainState}
            selectedDay={selectedForecastDay}
            onSelectDay={setSelectedForecastDay}
            onForceRefresh={handleForecastRainForceRefresh}
          />
        )}
      </div>

      <MapContainer
        bounds={REGION_BOUNDS}
        maxBounds={REGION_BOUNDS.pad(0.25)}
        maxBoundsViscosity={1}
        zoomControl={false}
        style={{ height: '100%', width: '100%' }}
      >
        <ClickHandler enabled={mode === 'previsions'} onClick={handleMapClick} />
        <RecenterOnSelect target={searchTarget} />
        <InvalidateSizeOnResize />

        <LayersControl position="bottomleft">
          <LayersControl.BaseLayer checked name="Plan">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              eventHandlers={{ tileerror: handleTileError }}
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Satellite">
            <TileLayer
              attribution='&copy; <a href="https://www.ign.fr">IGN</a> - Géoplateforme'
              url="https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg"
              maxNativeZoom={19}
              crossOrigin="anonymous"
              eventHandlers={{ tileerror: handleTileError }}
            />
          </LayersControl.BaseLayer>
        </LayersControl>

        <RegionOutline />

        {mode === 'historique' && (
          <>
            <StationsLayer />
            {rainSource === 'open-meteo' && rainState.status === 'ready' && <RainOverlay points={rainState.points} />}
          </>
        )}

        {mode === 'previsions' && forecastRainState.status === 'ready' && <RainOverlay points={selectedForecastRainPoints} />}
      </MapContainer>

      {mode === 'previsions' && isMobile && forecastState.status !== 'idle' && (
        <ForecastFullscreen state={forecastState} onClose={() => setForecastState({ status: 'idle' })} />
      )}
      {mode === 'previsions' && (!isMobile || forecastState.status === 'idle') && (
        <ForecastPanel state={forecastState} onClose={() => setForecastState({ status: 'idle' })} />
      )}
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
