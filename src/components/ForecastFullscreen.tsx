// Écran plein-écran mobile pour les prévisions 7 jours (voir
// StationFullscreen.tsx pour le même principe côté stations) : au clic sur
// la carte en mode Prévisions, plutôt que le panneau flottant en bas
// (peu pratique au doigt sur petit écran, retour utilisateur), un écran qui
// prend tout l'écran et glisse depuis la droite comme une vraie page.
// En tête : la commune (plutôt que des coordonnées) et un résumé de la semaine.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { reverseCity } from '../lib/geocoding'
import './ForecastFullscreen.css'
import { ForecastDayCard } from './ForecastDayCard'
import type { ForecastState } from '../types'

type Props = { state: Exclude<ForecastState, { status: 'idle' }>; onClose: () => void }

const mm = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })

export function ForecastFullscreen({ state, onClose }: Props) {
  const { lat, lon } = state.point
  const [place, setPlace] = useState<{ key: string; name: string | null } | null>(null)
  const key = `${lat},${lon}`
  useEffect(() => {
    let cancelled = false
    void reverseCity(lat, lon).then((name) => {
      if (!cancelled) setPlace({ key: `${lat},${lon}`, name })
    })
    return () => {
      cancelled = true
    }
  }, [lat, lon])
  const name = place?.key === key ? place.name : null

  const days = state.status === 'ready' ? state.days : []
  const total = days.reduce((s, d) => s + d.precipitationSum, 0)
  const wet = days.filter((d) => d.precipitationSum >= 1).length

  return createPortal(
    <div className="forecast-fullscreen">
      <div className="forecast-fullscreen__header">
        <button type="button" className="forecast-fullscreen__back" onClick={onClose} aria-label="Retour">
          ‹
        </button>
        <div className="forecast-fullscreen__title">
          <div className="forecast-fullscreen__name">{name ?? 'Prévisions 7 jours'}</div>
          <div className="forecast-fullscreen__coords">
            {name ? 'Prévisions 7 jours · ' : ''}
            {lat.toFixed(3)}, {lon.toFixed(3)}
          </div>
        </div>
      </div>

      <div className="forecast-fullscreen__body">
        {state.status === 'loading' && <div className="forecast-panel__message">Chargement…</div>}
        {state.status === 'error' && <div className="forecast-panel__message forecast-panel__message--error">{state.message}</div>}

        {state.status === 'ready' && (
          <>
            <div className="forecast-fullscreen__summary">
              <div>
                <b>{mm(total)} mm</b>
                <span>de pluie sur 7 jours</span>
              </div>
              <div>
                <b>{wet}</b>
                <span>jour{wet > 1 ? 's' : ''} de pluie</span>
              </div>
              <div>
                <b>
                  {Math.round(Math.min(...days.map((d) => d.tempMin)))}° / {Math.round(Math.max(...days.map((d) => d.tempMax)))}°
                </b>
                <span>mini / maxi</span>
              </div>
            </div>
            <div className="forecast-panel__days">
              {state.days.map((day) => (
                <ForecastDayCard key={day.date} day={day} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
