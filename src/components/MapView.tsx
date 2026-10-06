// Carte principale : fond plan/satellite (repris du socle Unmask), sélecteur
// de mode Prévision/Historique, et les couches propres à chaque mode.
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MapContainer, LayersControl, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import { zoomForResultType, type GeocodeResult } from '../lib/geocoding'
import { getDailyForecast } from '../lib/openMeteo'
import { IGN_PLAN_URL, readOfflineInfo } from '../lib/offline'
import { fetchRainImage, fetchRainMapsMeta, firstCurrentDayIndex } from '../lib/rainMaps'
import { REGION_BOUNDS } from '../lib/regionOutline'
import { useIsMobile } from '../lib/useIsMobile'
import { useMushroomGuide } from '../lib/useMushroomGuide'
import { ForecastFullscreen } from './ForecastFullscreen'
import { ForecastPanel } from './ForecastPanel'
import { ForecastRainControls } from './ForecastRainControls'
import './MapView.css'
import { ModeSwitch } from './ModeSwitch'
import { OfflinePanel } from './OfflinePanel'
import { MushroomGuide } from './MushroomGuide'
import { RainControls } from './RainControls'
import { RainOverlay } from './RainOverlay'
import { RegionOutline } from './RegionOutline'
import { SearchBar } from './SearchBar'
import { StationsLayer } from './StationsLayer'
import type { AppMode, ForecastState, RainImageState, RainMapsState } from '../types'

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

// Mentions obligatoires des données météo affichées : Open-Meteo (CC BY 4.0
// impose l'attribution) et Météo-France (modèles AROME/ARPEGE, observations).
const DATA_ATTRIBUTION =
  'Météo : <a href="https://open-meteo.com/">Open-Meteo.com</a> (CC BY 4.0), <a href="https://meteofrance.fr/">Météo-France</a>'

function DataAttribution() {
  const map = useMap()
  useEffect(() => {
    map.attributionControl.addAttribution(DATA_ATTRIBUTION)
    return () => {
      map.attributionControl.removeAttribution(DATA_ATTRIBUTION)
    }
  }, [map])
  return null
}

// Croix posée là où l'on a cliqué pour la prévision. Contour blanc + trait
// sombre : lisible sur le fond clair, le satellite et les couleurs de la carte
// de pluie. Non interactive : un clic dessus passe au fond de carte, donc
// recliquer au même endroit relance bien la prévision.
const FORECAST_CROSS_ICON = L.divIcon({
  className: 'forecast-cross',
  html:
    '<svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">' +
    '<path d="M14 3v22M3 14h22" stroke="#fff" stroke-width="6" stroke-linecap="round" fill="none"/>' +
    '<path d="M14 3v22M3 14h22" stroke="#111827" stroke-width="3" stroke-linecap="round" fill="none"/>' +
    '</svg>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
})

function ForecastCross({ point }: { point: { lat: number; lon: number } | null }) {
  if (!point) return null
  return <Marker position={[point.lat, point.lon]} icon={FORECAST_CROSS_ICON} interactive={false} keyboard={false} zIndexOffset={1000} />
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

// Sans réseau au démarrage, on ouvre directement le fond enregistré (le Plan OSM ne s'afficherait pas).
const START_OFFLINE = typeof navigator !== 'undefined' && !navigator.onLine
const OFFLINE_INFO = readOfflineInfo()

export function MapView() {
  const isMobile = useIsMobile()
  const [mode, setMode] = useState<AppMode>('previsions')
  const guide = useMushroomGuide()
  const [forecastState, setForecastState] = useState<ForecastState>({ status: 'idle' })
  const [mapsState, setMapsState] = useState<RainMapsState>({ status: 'loading' })
  const [images, setImages] = useState<Record<string, RainImageState>>({})
  const [selectedForecastDay, setSelectedForecastDay] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)
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

  // Cartes de pluie (générées par le job maps.yml, voir lib/rainMaps.ts) :
  // maps.json d'abord (dates, modèles, emprise), puis UNE image à la fois,
  // celle qu'on affiche (cumul 24h en Historique, le jour choisi en
  // Prévisions) — pas les 8 PNG d'un coup.
  const requestedRef = useRef(new Set<string>())
  useEffect(() => {
    let cancelled = false
    fetchRainMapsMeta()
      .then((meta) => {
        if (cancelled) return
        setSelectedForecastDay(firstCurrentDayIndex(meta.forecast))
        setMapsState({ status: 'ready', meta })
      })
      .catch((err: Error) => {
        if (!cancelled) setMapsState({ status: 'error', message: err.message })
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  // Recharge tout (maps.json puis image affichée). Les remises à zéro d'état
  // sont faites ici, dans le gestionnaire, et non dans l'effet qui charge.
  const reloadMaps = useCallback(() => {
    requestedRef.current.clear()
    setImages({})
    setMapsState({ status: 'loading' })
    setReloadKey((k) => k + 1)
  }, [])

  // Un onglet laissé ouvert pendant des heures ne doit pas rester sur des
  // cartes périmées : au retour sur l'onglet, on recharge si elles ont plus
  // de 20 min.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || mapsState.status !== 'ready') return
      if (Date.now() - new Date(mapsState.meta.fetchedAt).getTime() > 20 * 60 * 1000) reloadMaps()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [mapsState, reloadMaps])

  const neededFile =
    mapsState.status === 'ready'
      ? mode === 'historique'
        ? mapsState.meta.rain24h.file
        : mapsState.meta.forecast[selectedForecastDay]?.file
      : undefined

  useEffect(() => {
    if (mapsState.status !== 'ready' || !neededFile) return
    const meta = mapsState.meta
    const key = meta.fetchedAt + neededFile
    if (requestedRef.current.has(key)) return
    requestedRef.current.add(key)
    setImages((prev) => ({ ...prev, [neededFile]: { status: 'loading' } }))
    fetchRainImage(meta, neededFile)
      .then((image) => setImages((prev) => ({ ...prev, [neededFile]: { status: 'ready', image } })))
      .catch((err: Error) => {
        requestedRef.current.delete(key) // permet un nouvel essai
        setImages((prev) => ({ ...prev, [neededFile]: { status: 'error', message: err.message } }))
      })
  }, [mapsState, neededFile])

  const currentImage: RainImageState = (neededFile && images[neededFile]) || { status: 'idle' }
  const handleRetry = reloadMaps

  return (
    <div className="map-view">
      {guide.view && <MushroomGuide view={guide.view} onOpenSpecies={guide.openSpecies} onBack={guide.back} />}
      <div className="floating-controls">
        <div className="floating-controls__row">
          <ModeSwitch mode={mode} onChange={setMode} />
          <button type="button" className="guide-open" onClick={guide.open} aria-label="Champignons">
            🍄<span className="guide-open__label"> Champignons</span>
          </button>
          <OfflinePanel />
          <SearchBar onSelect={setSearchTarget} />
        </div>

        {mode === 'historique' && (
          <RainControls maps={mapsState} image={currentImage} onRetry={handleRetry} />
        )}
        {mode === 'previsions' && (
          <ForecastRainControls
            maps={mapsState}
            image={currentImage}
            selectedDay={selectedForecastDay}
            onSelectDay={setSelectedForecastDay}
            onRetry={handleRetry}
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
        <DataAttribution />

        <LayersControl position="bottomleft">
          <LayersControl.BaseLayer checked={!START_OFFLINE} name="Plan">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              eventHandlers={{ tileerror: handleTileError }}
            />
          </LayersControl.BaseLayer>
          {/* Plan IGN : seul fond enregistrable pour le hors ligne (OSM l'interdit, voir lib/offline.ts).
              Hors ligne, les zooms au-delà de la copie sont agrandis plutôt que laissés vides. */}
          <LayersControl.BaseLayer checked={START_OFFLINE} name="Plan IGN (hors ligne)">
            <TileLayer
              attribution='&copy; <a href="https://www.ign.fr">IGN</a> - Géoplateforme'
              url={IGN_PLAN_URL}
              maxNativeZoom={START_OFFLINE ? (OFFLINE_INFO?.maxZoom ?? 12) : 18}
              crossOrigin="anonymous"
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

        {mode === 'historique' && <StationsLayer />}

        {mode === 'previsions' && <ForecastCross point={forecastState.status === 'idle' ? null : forecastState.point} />}

        {mapsState.status === 'ready' && currentImage.status === 'ready' && (
          <RainOverlay image={currentImage.image} bounds={mapsState.meta.bounds} />
        )}
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
