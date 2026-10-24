// Écran plein-écran mobile pour le détail d'une station (voir
// StationsLayer.tsx) : une popup Leaflet classique est peu ergonomique au
// doigt sur petit écran (retour utilisateur), donc sur mobile on affiche
// plutôt un panneau qui prend tout l'écran et glisse depuis la droite,
// comme une vraie page — sans routeur pour autant (pas de changement
// d'URL, fermeture par la flèche retour uniquement, pas le bouton retour
// du téléphone/navigateur, voir CLAUDE.md si le compromis doit un jour
// changer).
import { createPortal } from 'react-dom'
import { cachedRainTotals, prettyStationName } from '../lib/stations'
import './StationFullscreen.css'
import { StationPopup } from './StationPopup'
import type { Station, StationDetailState } from '../types'

type Props = { station: Station; state: StationDetailState; onClose: () => void }

const mm = (v: number) => `${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} mm`

export function StationFullscreen({ station, state, onClose }: Props) {
  // Résumé en tête (même principe que l'écran de prévision) : pluie 24 h, 3 jours, 10 jours, température.
  const detail = state.status === 'ready' ? state.detail : null
  const rain24 = detail ? detail.rainHistory.reduce((s, p) => s + p.rain, 0) : null
  const rain3d = cachedRainTotals()?.[station.id]?.mm ?? null
  const rain10 = detail ? detail.dailyRain.reduce((s, d) => s + d.rain, 0) : null
  const lastTemp = detail?.tempHistory.length ? detail.tempHistory[detail.tempHistory.length - 1].temp : null
  // Portail vers document.body : les panneaux Leaflet (marqueurs, popups)
  // vivent dans un conteneur affecté par les transforms CSS du panning de
  // la carte, qui casseraient un `position: fixed` imbriqué dedans.
  return createPortal(
    <div className="station-fullscreen">
      <div className="station-fullscreen__header">
        <button type="button" className="station-fullscreen__back" onClick={onClose} aria-label="Retour">
          ‹
        </button>
        <div className="station-fullscreen__title">
          <div className="station-fullscreen__name">{prettyStationName(station.name)}</div>
          {station.altitude !== undefined && (
            <div className="station-fullscreen__altitude">{station.altitude} m d'altitude</div>
          )}
        </div>
      </div>
      <div className="station-fullscreen__body">
        {detail && (
          <div className="station-fullscreen__summary">
            <div>
              <b>{rain24 !== null ? mm(rain24) : '–'}</b>
              <span>pluie 24 h</span>
            </div>
            <div>
              <b>{rain3d !== null ? mm(rain3d) : '–'}</b>
              <span>3 jours</span>
            </div>
            <div>
              <b>{rain10 !== null ? mm(rain10) : '–'}</b>
              <span>{detail.dailyRain.length} jours</span>
            </div>
            <div>
              <b>{lastTemp !== null ? `${Math.round(lastTemp)}°` : '–'}</b>
              <span>température</span>
            </div>
          </div>
        )}
        <StationPopup state={state} variant="page" />
      </div>
    </div>,
    document.body,
  )
}
