// Panneau de contrôle de la carte de pluie PRÉVUE (mode Prévisions,
// recouvrement carte) : sélecteur de jour, modèle utilisé, état et légende —
// même principe que RainControls.tsx (carte de pluie 24h mesurée, mode
// Historique), dupliqué plutôt que partagé : les deux évoluent pour des
// raisons différentes (l'un un jour sélectionné parmi 7, l'autre une seule
// valeur 24h) et le partage aurait forcé une abstraction prématurée.
import { useEffect, useRef, useState } from 'react'
import './ForecastRainControls.css'
import { RAIN_LEGEND_STOPS } from '../lib/color'
import { formatRelativeAge } from '../lib/formatRelativeAge'
import { MODEL_LABELS, todayParisKey, tomorrowParisKey } from '../lib/rainMaps'
import type { RainImageState, RainMapsState } from '../types'

const TIME_FORMATTER = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })
const DAY_FORMATTER = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric' })

type Props = {
  maps: RainMapsState
  image: RainImageState
  selectedDay: number
  onSelectDay: (day: number) => void
  onRetry: () => void
}

export function ForecastRainControls({ maps, image, selectedDay, onSelectDay, onRetry }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const today = todayParisKey()
  const tomorrow = tomorrowParisKey()
  // Même logique que RainControls : repliable, mais ne se replie tout seul
  // qu'une fois (pas à chaque nouveau "ready" sinon impossible à rouvrir).
  const autoCollapsedRef = useRef(false)
  const ready = maps.status === 'ready' && image.status === 'ready'
  useEffect(() => {
    if (ready && !autoCollapsedRef.current) {
      autoCollapsedRef.current = true
      setCollapsed(true)
    }
  }, [ready])

  const error = maps.status === 'error' ? maps.message : image.status === 'error' ? image.message : null
  const day = maps.status === 'ready' ? maps.meta.forecast[selectedDay] : undefined

  return (
    <div className={collapsed ? 'forecast-rain-controls forecast-rain-controls--collapsed' : 'forecast-rain-controls'}>
      <button type="button" className="forecast-rain-controls__header" onClick={() => setCollapsed((c) => !c)}>
        <span>🌦️ Pluie prévue ({maps.status === 'ready' ? maps.meta.forecast.length : 7}j)</span>
        <span className="forecast-rain-controls__chevron">{collapsed ? '▸' : '▾'}</span>
      </button>

      {!collapsed && (
        <div className="forecast-rain-controls__body">
          {(maps.status === 'loading' || image.status === 'loading') && (
            <div className="forecast-rain-controls__status">Chargement…</div>
          )}

          {error && (
            <>
              <div className="forecast-rain-controls__error">{error}</div>
              <button type="button" className="forecast-rain-controls__load-btn" onClick={onRetry}>
                Réessayer
              </button>
            </>
          )}

          {maps.status === 'ready' && (
            <>
              <div className="forecast-rain-controls__status">
                Actualisé à {TIME_FORMATTER.format(new Date(maps.meta.fetchedAt))} (
                {formatRelativeAge(new Date(maps.meta.fetchedAt).getTime())})
              </div>

              <div className="forecast-rain-controls__days">
                {maps.meta.forecast.map((d, i) =>
                  // Jours déjà écoulés (cartes vieilles de plusieurs heures) :
                  // masqués, mais l'index `i` reste celui de maps.json.
                  d.date < today ? null : (
                    <button
                      key={d.date}
                      type="button"
                      className={
                        i === selectedDay
                          ? 'forecast-rain-controls__day forecast-rain-controls__day--active'
                          : 'forecast-rain-controls__day'
                      }
                      onClick={() => onSelectDay(i)}
                    >
                      {d.date === today ? 'Auj.' : d.date === tomorrow ? 'Dem.' : DAY_FORMATTER.format(new Date(d.date))}
                    </button>
                  ),
                )}
              </div>

              {day && (
                <div className="forecast-rain-controls__status">
                  Modèle : {MODEL_LABELS[day.model] ?? day.model} · {day.resolutionKm.toLocaleString('fr-FR')} km
                  {day.resolutionKm > 5 && ' (résolution réelle du modèle à cette échéance)'}
                </div>
              )}

              <div className="forecast-rain-controls__legend">
                {RAIN_LEGEND_STOPS.map((stop) => (
                  <div key={stop.label} className="forecast-rain-controls__legend-item">
                    <span className="forecast-rain-controls__legend-swatch" style={{ background: stop.color }} />
                    {stop.label}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
