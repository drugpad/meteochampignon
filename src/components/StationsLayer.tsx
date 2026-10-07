// Couche des stations cliquables (mode Historique) — un marqueur par
// station, détail chargé à la demande (pas de requête tant qu'on n'a pas
// cliqué, voir StationPopup.tsx pour le contenu). Sur desktop, le détail
// s'affiche dans une popup Leaflet classique ; sur mobile, dans un écran
// plein-écran séparé (StationFullscreen.tsx) — une popup ancrée sur un
// petit point de carte est peu ergonomique au doigt (retour utilisateur).
import L from 'leaflet'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Marker, Popup, useMap, useMapEvents } from 'react-leaflet'
import { fetchStationDetail, loadRainTotals, STATIC_STATIONS } from '../lib/stations'
import { rainBubble, rainReference, type RainBubble, type StationRainTotal } from '../lib/stationRain'
import { useIsMobile } from '../lib/useIsMobile'
import { StationFullscreen } from './StationFullscreen'
import { StationPopup } from './StationPopup'
import type { Station, StationDetailState } from '../types'

// Trois états selon le zoom (239 marqueurs : trop serrés pour tout afficher de loin) :
//  - far  (< 9)  : petite pastille chiffrée et colorée SEULE (la bulle fait office de marqueur : le chiffre est
//                  lisible dès le zoom de départ) ;
//  - mid  (9)    : point + bulle chiffrée ;
//  - near (≥ 10) : pastille 🌧️ + bulle chiffrée.
type ZoomClass = 'far' | 'mid' | 'near'
const zoomClassOf = (zoom: number): ZoomClass => (zoom >= 10 ? 'near' : zoom >= 9 ? 'mid' : 'far')

const bubbleHtml = (b: RainBubble, offsetPx: number, solo = false) =>
  `<div class="station-marker__rain${solo ? ' station-marker__rain--solo' : ''}" title="${b.title}" style="background:${b.bg};color:${b.fg};--off:${offsetPx}px">${b.label}</div>`

// Les icônes ne dépendent que de (zoom, couleur, texte) : on les réutilise (239 stations, peu de valeurs distinctes).
const iconCache = new Map<string, L.DivIcon>()
function stationIcon(zoomClass: ZoomClass, bubble: RainBubble): L.DivIcon {
  const key = `${zoomClass}|${bubble.bg}|${bubble.label}`
  let icon = iconCache.get(key)
  if (!icon) {
    const dot = (px: number) =>
      `<div class="station-marker__dot" style="width:${px}px;height:${px}px;background:${bubble.bg}"></div>`
    const html =
      zoomClass === 'near'
        ? '<div class="station-marker__pin">🌧️</div>' + bubbleHtml(bubble, 15)
        : zoomClass === 'mid'
          ? dot(14) + bubbleHtml(bubble, 9)
          : bubbleHtml(bubble, 0, true)
    icon = L.divIcon({ className: 'station-marker', html, iconSize: [28, 28], iconAnchor: [14, 14] })
    iconCache.set(key, icon)
  }
  return icon
}

// Au zoom de départ, 239 pastilles de 26 px se recouvrent complètement (surtout sur téléphone) : en
// dessous du zoom 10, de simples points. La zone cliquable reste de 28 px (doigt), seul le dessin rétrécit.
function useZoomClass(): ZoomClass {
  const map = useMap()
  const [zoom, setZoom] = useState(() => map.getZoom())
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) })
  return zoomClassOf(zoom)
}

// Cumuls de pluie des 3 derniers jours, rechargés toutes les 10 min tant que la couche est affichée.
function useRainTotals(): Record<string, StationRainTotal> | null {
  const [totals, setTotals] = useState<Record<string, StationRainTotal> | null>(null)
  useEffect(() => {
    let alive = true
    const load = () =>
      loadRainTotals()
        .then((t) => alive && setTotals(t))
        .catch(() => undefined) // sans historique : bulles grises « – », les marqueurs restent cliquables
    load()
    const timer = window.setInterval(load, 10 * 60 * 1000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])
  return totals
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
function StationMarkerDesktop({ station, icon, zIndexOffset }: { station: Station; icon: L.DivIcon; zIndexOffset: number }) {
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
    <Marker position={[station.lat, station.lon]} icon={icon} zIndexOffset={zIndexOffset} eventHandlers={{ popupopen: handleOpen }}>
      <Popup minWidth={290} maxWidth={310}>
        <StationPopup state={state} />
      </Popup>
    </Marker>
  )
}

// Mobile : pas de popup Leaflet, le clic déclenche le chargement et
// notifie le parent (un seul écran plein-écran partagé, pas un par
// marqueur — voir StationsLayer).
function StationMarkerMobile({
  station,
  icon,
  zIndexOffset,
  onOpen,
}: {
  station: Station
  icon: L.DivIcon
  zIndexOffset: number
  onOpen: (station: Station) => void
}) {
  return (
    <Marker
      position={[station.lat, station.lon]}
      icon={icon}
      zIndexOffset={zIndexOffset}
      eventHandlers={{ click: () => onOpen(station) }}
    />
  )
}

export function StationsLayer() {
  const isMobile = useIsMobile()
  const zoomClass = useZoomClass()
  const totals = useRainTotals()
  const reference = useMemo(() => (totals ? rainReference(totals) : 5), [totals])
  const iconOf = (station: Station) => stationIcon(zoomClass, rainBubble(totals?.[station.id], reference))
  // Les stations les plus arrosées au premier plan : quand les pastilles se chevauchent, ce sont les plus
  // intéressantes qui restent visibles, pas les stations sèches.
  const zOf = (station: Station) => Math.round(totals?.[station.id]?.mm ?? 0)
  const [mobileSelection, setMobileSelection] = useState<{ station: Station; state: StationDetailState } | null>(null)

  const handleMobileOpen = (station: Station) => {
    setMobileSelection({ station, state: { status: 'loading', station } })
    loadDetail(station, (state) => setMobileSelection({ station, state }))
  }

  if (!isMobile) {
    return (
      <>
        {STATIC_STATIONS.map((station) => (
          <StationMarkerDesktop key={station.id} station={station} icon={iconOf(station)} zIndexOffset={zOf(station)} />
        ))}
      </>
    )
  }

  return (
    <>
      {STATIC_STATIONS.map((station) => (
        <StationMarkerMobile key={station.id} station={station} icon={iconOf(station)} zIndexOffset={zOf(station)} onOpen={handleMobileOpen} />
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
