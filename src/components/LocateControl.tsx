// Bouton « Me localiser » (GPS du téléphone) : point bleu + cercle de précision, suivi de la position.
// 1er appui : démarre le suivi et centre la carte ; la carte suit tant qu'on ne la déplace pas à la main.
// Appui suivant : recentre si on s'était éloigné, sinon arrête le suivi. Le GPS marche aussi hors ligne
// (pas de réseau nécessaire), mais le navigateur exige HTTPS (ou localhost) et l'autorisation de position.
// Direction visée : un cône sur le point bleu suit la boussole du téléphone (deviceorientation ; sur iPhone,
// autorisation demandée au premier appui) ; à défaut de boussole, le sens de la marche donné par le GPS.
import L from 'leaflet'
import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import './LocateControl.css'

const ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
  '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/></svg>'

const FIRST_FIX_MIN_ZOOM = 15

// Point bleu + cône de direction (masqué tant qu'aucune direction n'est connue).
const POSITION_ICON = L.divIcon({
  className: 'locate-position',
  html:
    '<div class="locate-position__beam"><svg viewBox="0 0 80 80" width="80" height="80" aria-hidden="true">' +
    '<defs><linearGradient id="locate-beam" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#2563eb" stop-opacity="0.55"/>' +
    '<stop offset="1" stop-color="#2563eb" stop-opacity="0"/></linearGradient></defs>' +
    '<path d="M40 40 L22 4 A40 40 0 0 1 58 4 Z" fill="url(#locate-beam)"/></svg></div>' +
    '<div class="locate-position__dot"></div>',
  iconSize: [80, 80],
  iconAnchor: [40, 40],
})

type CompassEvent = DeviceOrientationEvent & { webkitCompassHeading?: number }

function screenAngle(): number {
  return (screen.orientation?.angle ?? (window as { orientation?: number }).orientation ?? 0) || 0
}

function errorMessage(err: L.ErrorEvent): string {
  // Codes de GeolocationPositionError : 1 refusé, 2 indisponible, 3 délai dépassé.
  if (err.code === 1) return 'Position refusée : autorisez la localisation pour ce site dans le navigateur.'
  if (err.code === 3) return 'Position introuvable pour l’instant (délai dépassé). Réessayez à découvert.'
  return 'Position indisponible (GPS désactivé ?).'
}

export function LocateControl() {
  const map = useMap()

  useEffect(() => {
    if (!('geolocation' in navigator)) return

    let active = false
    let following = false
    let hasFix = false
    let last: L.LatLng | null = null
    let messageTimer: number | undefined

    const accuracy = L.circle([0, 0], { radius: 1, weight: 1, color: '#2563eb', fillColor: '#2563eb', fillOpacity: 0.12, interactive: false })
    const dot = L.marker([0, 0], { icon: POSITION_ICON, interactive: false, keyboard: false, zIndexOffset: 3000 })
    let heading: number | null = null // degrés depuis le nord, sens horaire
    let compassAt = 0 // dernier relevé de boussole (ms) : la boussole prime sur le GPS tant qu'elle répond

    const applyHeading = () => {
      const beam = dot.getElement()?.querySelector<HTMLElement>('.locate-position__beam')
      if (!beam) return
      beam.style.display = heading === null ? 'none' : 'block'
      if (heading !== null) beam.style.transform = `rotate(${heading}deg)`
    }

    // Lissage circulaire (la boussole tremble) ; passe correctement de 359° à 0°.
    const setHeading = (h: number) => {
      if (heading === null) heading = h
      else {
        const diff = ((h - heading + 540) % 360) - 180
        heading = (heading + diff * 0.3 + 360) % 360
      }
      applyHeading()
    }

    const onOrientation = (ev: Event) => {
      const e = ev as CompassEvent
      let h: number | null = null
      if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading // iPhone : déjà par rapport au nord
      else if (e.absolute && e.alpha !== null) h = 360 - e.alpha // Android : alpha compté dans l'autre sens
      if (h === null || Number.isNaN(h)) return
      compassAt = Date.now()
      setHeading((h + screenAngle()) % 360)
    }
    const orientationEvent = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation'
    let listening = false
    const startCompass = async () => {
      const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined
      // Écoute posée AVANT la demande d'autorisation, et gardée même en cas de refus : sur iPhone (iOS 13+)
      // l'autorisation est demandée dans le geste de l'utilisateur ; certains navigateurs exposent cette
      // demande et la refusent faute de capteur — sans boussole, aucun événement n'arrive, sans dommage.
      if (!listening) {
        window.addEventListener(orientationEvent, onOrientation)
        listening = true
      }
      try {
        if (DOE?.requestPermission) await DOE.requestPermission()
      } catch {
        // pas de boussole : le cône suivra le sens de la marche (GPS)
      }
    }
    const stopCompass = () => {
      window.removeEventListener(orientationEvent, onOrientation)
      listening = false
      heading = null
    }

    const control = new L.Control({ position: 'bottomright' })
    const container = L.DomUtil.create('div', 'leaflet-bar locate-control')
    const button = L.DomUtil.create('button', 'locate-control__button', container)
    button.type = 'button'
    button.innerHTML = ICON
    const message = L.DomUtil.create('div', 'locate-control__message', container)
    L.DomEvent.disableClickPropagation(container)
    control.onAdd = () => container

    const render = () => {
      container.classList.toggle('locate-control--active', active)
      container.classList.toggle('locate-control--waiting', active && !hasFix)
      container.classList.toggle('locate-control--following', active && following)
      const label = !active ? 'Me localiser' : following ? 'Arrêter la localisation' : 'Recentrer sur ma position'
      button.title = label
      button.setAttribute('aria-label', label)
    }

    const showMessage = (text: string) => {
      message.textContent = text
      message.style.display = 'block'
      window.clearTimeout(messageTimer)
      messageTimer = window.setTimeout(() => (message.style.display = 'none'), 6000)
    }

    const stop = () => {
      map.stopLocate()
      active = following = hasFix = false
      last = null
      accuracy.remove()
      dot.remove()
      stopCompass()
      render()
    }

    const onFound = (e: L.LocationEvent) => {
      last = e.latlng
      accuracy.setLatLng(e.latlng).setRadius(e.accuracy)
      dot.setLatLng(e.latlng)
      if (!map.hasLayer(dot)) {
        accuracy.addTo(map)
        dot.addTo(map)
      }
      // Sans boussole (ou si elle ne répond plus), le sens de la marche du GPS, seulement en mouvement.
      if (Date.now() - compassAt > 3000 && e.heading !== undefined && !Number.isNaN(e.heading) && (e.speed ?? 0) > 0.7) {
        setHeading(e.heading)
      }
      applyHeading()
      if (!hasFix) {
        hasFix = true
        map.setView(e.latlng, Math.max(map.getZoom(), FIRST_FIX_MIN_ZOOM))
      } else if (following) {
        map.panTo(e.latlng)
      }
      render()
    }

    const onError = (e: L.ErrorEvent) => {
      showMessage(errorMessage(e))
      // Refus d'autorisation : inutile de continuer à demander. Les autres erreurs (délai, signal perdu)
      // sont passagères, le suivi continue et la prochaine position reprendra la main.
      if (e.code === 1 || !hasFix) stop()
    }

    // Un déplacement de la carte à la main (glisser) coupe le suivi automatique, pas la localisation.
    const onDragStart = () => {
      if (following) {
        following = false
        render()
      }
    }

    L.DomEvent.on(button, 'click', () => {
      if (!active) {
        active = following = true
        hasFix = false
        message.style.display = 'none'
        render()
        void startCompass()
        map.locate({ watch: true, enableHighAccuracy: true, setView: false, timeout: 20000, maximumAge: 5000 })
      } else if (!following && last) {
        following = true
        map.setView(last, Math.max(map.getZoom(), FIRST_FIX_MIN_ZOOM))
        render()
      } else {
        stop()
      }
    })

    map.on('locationfound', onFound)
    map.on('locationerror', onError)
    map.on('dragstart', onDragStart)
    control.addTo(map)
    render()

    return () => {
      window.clearTimeout(messageTimer)
      map.off('locationfound', onFound)
      map.off('locationerror', onError)
      map.off('dragstart', onDragStart)
      map.stopLocate()
      stopCompass()
      accuracy.remove()
      dot.remove()
      control.remove()
    }
  }, [map])

  return null
}
