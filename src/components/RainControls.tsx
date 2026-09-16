// Panneau de contrôle de la carte de pluie 24h (mode Historique) : état de
// la grille (Option A, normalement pré-calculée par le job GitHub Actions —
// voir CLAUDE.md), légende, et toggle Option A / Option B si un token radar
// Météo-France est configuré. Repliable (retour utilisateur : reste "en
// grand" et gêne la carte sinon) — replié une fois la grille chargée, pour
// ne pas s'imposer une fois qu'il n'y a plus rien à faire dessus.
import { useEffect, useRef, useState } from 'react'
import './RainControls.css'
import { RAIN_LEGEND_STOPS } from '../lib/color'
import type { RainGridState, RainMapSource } from '../types'

const HAS_RADAR_TOKEN = Boolean(import.meta.env.VITE_METEOFRANCE_API_TOKEN)
const TIME_FORMATTER = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })

type Props = {
  state: RainGridState
  source: RainMapSource
  onSourceChange: (source: RainMapSource) => void
  // Recalcule la grille en direct dans le navigateur (lent, ~plusieurs
  // minutes) — secours manuel si le cache pré-calculé est absent/trop vieux,
  // voir lib/rainGrid.ts.
  onForceRefresh: () => void
}

export function RainControls({ state, source, onSourceChange, onForceRefresh }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  // Se replie tout seul dès que la grille est prête, une seule fois (pas à
  // chaque nouveau "ready", sinon impossible de le rouvrir : il se
  // reprendrait de force à chaque rafraîchissement).
  const autoCollapsedRef = useRef(false)
  useEffect(() => {
    if (state.status === 'ready' && !autoCollapsedRef.current) {
      autoCollapsedRef.current = true
      setCollapsed(true)
    }
  }, [state.status])

  return (
    <div className={collapsed ? 'rain-controls rain-controls--collapsed' : 'rain-controls'}>
      <button type="button" className="rain-controls__header" onClick={() => setCollapsed((c) => !c)}>
        <span>🌧️ Carte de pluie — cumul 24h</span>
        <span className="rain-controls__chevron">{collapsed ? '▸' : '▾'}</span>
      </button>

      {!collapsed && (
        <div className="rain-controls__body">
          {HAS_RADAR_TOKEN && (
            <div className="rain-controls__toggle">
              <button
                type="button"
                className={source === 'open-meteo' ? 'rain-controls__toggle-btn rain-controls__toggle-btn--active' : 'rain-controls__toggle-btn'}
                onClick={() => onSourceChange('open-meteo')}
              >
                Option A (rapide)
              </button>
              <button
                type="button"
                className={source === 'radar' ? 'rain-controls__toggle-btn rain-controls__toggle-btn--active' : 'rain-controls__toggle-btn'}
                onClick={() => onSourceChange('radar')}
              >
                Option B (radar)
              </button>
            </div>
          )}

          {source === 'open-meteo' && state.status === 'loading' && (
            <div className="rain-controls__status">
              Chargement{state.total > 1 ? ` (${state.loaded}/${state.total})` : '…'}
            </div>
          )}

          {source === 'open-meteo' && (state.status === 'idle' || state.status === 'error') && (
            <button type="button" className="rain-controls__load-btn" onClick={onForceRefresh}>
              Charger la carte de pluie 24h
            </button>
          )}

          {source === 'open-meteo' && state.status === 'ready' && (
            <>
              <div className="rain-controls__status">Actualisé à {TIME_FORMATTER.format(state.fetchedAt)}</div>
              <button type="button" className="rain-controls__refresh-btn" onClick={onForceRefresh}>
                Recalculer maintenant (très lent, ~30 min)
              </button>
            </>
          )}

          {state.status === 'error' && <div className="rain-controls__error">{state.message}</div>}

          {source === 'open-meteo' && state.status === 'ready' && (
            <div className="rain-controls__legend">
              {RAIN_LEGEND_STOPS.map((stop) => (
                <div key={stop.label} className="rain-controls__legend-item">
                  <span className="rain-controls__legend-swatch" style={{ background: stop.color }} />
                  {stop.label}
                </div>
              ))}
            </div>
          )}

          {source === 'radar' && (
            <div className="rain-controls__error" style={{ color: '#888' }}>
              Décodage des données radar pas encore branché sur la carte (voir CLAUDE.md).
            </div>
          )}
        </div>
      )}
    </div>
  )
}
