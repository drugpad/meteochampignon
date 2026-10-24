// Bouton « Me localiser » (GPS du téléphone) : point bleu + cercle de précision, suivi de la position.
// 1er appui : démarre le suivi et centre la carte ; la carte suit tant qu'on ne la déplace pas à la main.
// Appui suivant : recentre si on s'était éloigné, sinon arrête le suivi. Le GPS marche aussi hors ligne
// (pas de réseau nécessaire), mais le navigateur exige HTTPS (ou localhost) et l'autorisation de position.
import L from 'leaflet'
import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import './LocateControl.css'

const ICON =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
  '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/></svg>'

const FIRST_FIX_MIN_ZOOM = 15

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
    const dot = L.circleMarker([0, 0], { radius: 7, weight: 3, color: '#fff', fillColor: '#2563eb', fillOpacity: 1, interactive: false })

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
      accuracy.remove()
      dot.remove()
      control.remove()
    }
  }, [map])

  return null
}
