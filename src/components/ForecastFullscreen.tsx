// Écran plein-écran mobile pour les prévisions 7 jours (voir
// StationFullscreen.tsx pour le même principe côté stations) : au clic sur
// la carte en mode Prévisions, plutôt que le panneau flottant en bas
// (peu pratique au doigt sur petit écran, retour utilisateur), un écran qui
// prend tout l'écran et glisse depuis la droite comme une vraie page.
import { createPortal } from 'react-dom'
import './ForecastFullscreen.css'
import { ForecastDayCard } from './ForecastDayCard'
import type { ForecastState } from '../types'

type Props = { state: Exclude<ForecastState, { status: 'idle' }>; onClose: () => void }

export function ForecastFullscreen({ state, onClose }: Props) {
  return createPortal(
    <div className="forecast-fullscreen">
      <div className="forecast-fullscreen__header">
        <button type="button" className="forecast-fullscreen__back" onClick={onClose} aria-label="Retour">
          ‹
        </button>
        <div className="forecast-fullscreen__title">
          <div className="forecast-fullscreen__name">Prévisions 7 jours</div>
          <div className="forecast-fullscreen__coords">
            {state.point.lat.toFixed(3)}, {state.point.lon.toFixed(3)}
          </div>
        </div>
      </div>

      <div className="forecast-fullscreen__body">
        {state.status === 'loading' && <div className="forecast-panel__message">Chargement…</div>}
        {state.status === 'error' && <div className="forecast-panel__message forecast-panel__message--error">{state.message}</div>}

        {state.status === 'ready' && (
          <div className="forecast-panel__days">
            {state.days.map((day) => (
              <ForecastDayCard key={day.date} day={day} />
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
