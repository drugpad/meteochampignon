// Panneau flottant affichant les prévisions 7 jours (Open-Meteo best_match)
// pour le point cliqué sur la carte, en mode Prévisions.
import './ForecastPanel.css'
import { weatherCodeInfo } from '../lib/weatherCode'
import type { ForecastState } from '../types'

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })

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
          {state.days.map((day) => {
            const { emoji, label } = weatherCodeInfo(day.weatherCode)
            return (
              <div key={day.date} className="forecast-day">
                <div className="forecast-day__date">{WEEKDAY_FORMATTER.format(new Date(day.date))}</div>
                <div className="forecast-day__emoji" title={label}>
                  {emoji}
                </div>
                <div className="forecast-day__temps">
                  <span className="forecast-day__max">{Math.round(day.tempMax)}°</span>
                  <span className="forecast-day__min">{Math.round(day.tempMin)}°</span>
                </div>
                <div className="forecast-day__precip">
                  💧 {day.precipitationSum.toFixed(1)}mm
                  {day.precipitationProbabilityMax !== null && ` (${day.precipitationProbabilityMax}%)`}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
