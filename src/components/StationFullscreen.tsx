// Écran plein-écran mobile pour le détail d'une station (voir
// StationsLayer.tsx) : une popup Leaflet classique est peu ergonomique au
// doigt sur petit écran (retour utilisateur), donc sur mobile on affiche
// plutôt un panneau qui prend tout l'écran et glisse depuis la droite,
// comme une vraie page — sans routeur pour autant (pas de changement
// d'URL, fermeture par la flèche retour uniquement, pas le bouton retour
// du téléphone/navigateur, voir CLAUDE.md si le compromis doit un jour
// changer).
import { createPortal } from 'react-dom'
import './StationFullscreen.css'
import { StationPopup } from './StationPopup'
import type { Station, StationDetailState } from '../types'

type Props = { station: Station; state: StationDetailState; onClose: () => void }

export function StationFullscreen({ station, state, onClose }: Props) {
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
          <div className="station-fullscreen__name">{station.name}</div>
          {station.altitude !== undefined && (
            <div className="station-fullscreen__altitude">{station.altitude} m d'altitude</div>
          )}
        </div>
      </div>
      <div className="station-fullscreen__body">
        <StationPopup state={state} variant="page" />
      </div>
    </div>,
    document.body,
  )
}
