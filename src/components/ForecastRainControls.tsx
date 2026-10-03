// Panneau de contrôle de la carte de pluie PRÉVUE (mode Prévisions,
// recouvrement carte) : sélecteur de jour (jusqu'à 7), état de la grille
// (normalement pré-calculée par le job GitHub Actions, voir CLAUDE.md) et
// légende — même principe que RainControls.tsx (carte de pluie 24h mesurée,
// mode Historique), dupliqué plutôt que partagé : les deux évoluent pour
// des raisons différentes (l'un un jour sélectionné parmi 7, l'autre une
// seule valeur 24h) et le partage aurait forcé une abstraction prématurée.
import { useEffect, useRef, useState } from 'react'
import './ForecastRainControls.css'
import { RAIN_LEGEND_STOPS } from '../lib/color'
import { formatRelativeAge } from '../lib/formatRelativeAge'
import { todayParisKey, tomorrowParisKey } from '../lib/rainForecastGrid'
import type { RainForecastGridState } from '../types'

const TIME_FORMATTER = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })
const DAY_FORMATTER = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric' })

type Props = {
  state: RainForecastGridState
  selectedDay: number
  onSelectDay: (day: number) => void
  // Recalcule la grille en direct dans le navigateur (lent) — secours
  // manuel si le cache pré-calculé est absent/trop vieux, voir
  // lib/rainForecastGrid.ts.
  onForceRefresh: () => void
}

export function ForecastRainControls({ state, selectedDay, onSelectDay, onForceRefresh }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const today = todayParisKey()
  const tomorrow = tomorrowParisKey()
  // Même logique que RainControls : repliable, mais ne se replie tout seul
  // qu'une fois (pas à chaque nouveau "ready" sinon impossible à rouvrir).
  const autoCollapsedRef = useRef(false)
  useEffect(() => {
    if (state.status === 'ready' && !autoCollapsedRef.current) {
      autoCollapsedRef.current = true
      setCollapsed(true)
    }
  }, [state.status])

  return (
    <div className={collapsed ? 'forecast-rain-controls forecast-rain-controls--collapsed' : 'forecast-rain-controls'}>
      <button type="button" className="forecast-rain-controls__header" onClick={() => setCollapsed((c) => !c)}>
        <span>🌦️ Pluie prévue (7j)</span>
        <span className="forecast-rain-controls__chevron">{collapsed ? '▸' : '▾'}</span>
      </button>

      {!collapsed && (
        <div className="forecast-rain-controls__body">
          {state.status === 'loading' && (
            <div className="forecast-rain-controls__status">
              Chargement{state.total > 1 ? ` (${state.loaded}/${state.total})` : '…'}
            </div>
          )}

          {(state.status === 'idle' || state.status === 'error') && (
            <button type="button" className="forecast-rain-controls__load-btn" onClick={onForceRefresh}>
              Charger la pluie prévue
            </button>
          )}

          {state.status === 'error' && <div className="forecast-rain-controls__error">{state.message}</div>}

          {state.status === 'ready' && (
            <>
              <div className="forecast-rain-controls__status">
                Actualisé à {TIME_FORMATTER.format(state.fetchedAt)} ({formatRelativeAge(state.fetchedAt)})
              </div>

              <div className="forecast-rain-controls__days">
                {state.dates.map((date, i) =>
                  // Jours déjà écoulés (grille en cache vieille de plusieurs
                  // heures) : masqués, mais l'index `i` reste celui du
                  // tableau `rain` de chaque point.
                  date < today ? null : (
                    <button
                      key={date}
                      type="button"
                      className={
                        i === selectedDay
                          ? 'forecast-rain-controls__day forecast-rain-controls__day--active'
                          : 'forecast-rain-controls__day'
                      }
                      onClick={() => onSelectDay(i)}
                    >
                      {date === today ? 'Auj.' : date === tomorrow ? 'Dem.' : DAY_FORMATTER.format(new Date(date))}
                    </button>
                  ),
                )}
              </div>

              <button type="button" className="forecast-rain-controls__refresh-btn" onClick={onForceRefresh}>
                Recalculer maintenant (très lent, ~30 min)
              </button>

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
