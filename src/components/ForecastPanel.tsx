// Panneau flottant affichant les prévisions 7 jours (Open-Meteo best_match)
// pour le point cliqué sur la carte, en mode Prévisions.
import './ForecastPanel.css'
import { ForecastDayCard } from './ForecastDayCard'
import type { ForecastState } from '../types'

type Props = { state: ForecastState; onClose: () => void }

export function ForecastPanel({ state, onClose }: Props) {
  if (state.status === 'idle') {
    // Rien n'a encore été cliqué — sans ce message, le mode Prévisions
    // paraît vide/cassé (retour utilisateur : "je vois rien").
    return <div className="forecast-panel forecast-panel--hint">👆 Clique n'importe où sur la carte pour voir les prévisions à 7 jours</div>
  }

  return (
    <div className="forecast-panel">
      <div className="forecast-panel__header">
        <span>
          {state.status === 'ready'
            ? `Prévisions 7 jours — ${state.point.lat.toFixed(3)}, ${state.point.lon.toFixed(3)}`
            : 'Prévisions 7 jours'}
        </span>
        <button type="button" className="forecast-panel__close" onClick={onClose} aria-label="Fermer">
          ✕
        </button>
      </div>

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
  )
}
