// Panneau de contrôle de la carte de pluie 24h (mode Historique) : bouton de
// chargement (Option A), légende, et toggle Option A / Option B si un token
// radar Météo-France est configuré (voir CLAUDE.md).
import './RainControls.css'
import { RAIN_LEGEND_STOPS } from '../lib/color'
import type { RainGridState, RainMapSource } from '../types'

const HAS_RADAR_TOKEN = Boolean(import.meta.env.VITE_METEOFRANCE_API_TOKEN)

type Props = {
  state: RainGridState
  source: RainMapSource
  onSourceChange: (source: RainMapSource) => void
  onLoad: () => void
}

export function RainControls({ state, source, onSourceChange, onLoad }: Props) {
  return (
    <div className="rain-controls">
      <div className="rain-controls__header">Carte de pluie — cumul 24h</div>

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

      {source === 'open-meteo' && state.status !== 'ready' && (
        <button type="button" className="rain-controls__load-btn" onClick={onLoad} disabled={state.status === 'loading'}>
          {state.status === 'loading' ? `Chargement… (${state.loaded}/${state.total})` : 'Charger la carte de pluie 24h'}
        </button>
      )}
      {source === 'open-meteo' && state.status === 'ready' && (
        <button type="button" className="rain-controls__load-btn" onClick={onLoad}>
          Rafraîchir
        </button>
      )}
      {state.status === 'error' && <div className="rain-controls__error">{state.message}</div>}

      {source === 'open-meteo' && state.status === 'ready' && (
        <div className="rain-controls__legend">
          {RAIN_LEGEND_STOPS.map((stop) => (
            <div key={stop.mm} className="rain-controls__legend-item">
              <span className="rain-controls__legend-swatch" style={{ background: stop.color }} />
              {stop.mm}mm
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
  )
}
