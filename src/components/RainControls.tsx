// Panneau de contrôle de la carte de pluie 24h (mode Historique) : état des
// cartes (générées par le job GitHub Actions maps.yml, voir CLAUDE.md),
// période couverte, légende. Repliable (retour utilisateur : reste "en
// grand" et gêne la carte sinon) — replié une fois la carte chargée, pour ne
// pas s'imposer une fois qu'il n'y a plus rien à faire dessus.
import { useEffect, useRef, useState } from 'react'
import './RainControls.css'
import { RAIN_LEGEND_STOPS } from '../lib/color'
import { formatRelativeAge } from '../lib/formatRelativeAge'
import type { RainImageState, RainMapsState } from '../types'

const TIME_FORMATTER = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })
const PERIOD_FORMATTER = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })

type Props = {
  maps: RainMapsState
  image: RainImageState
  onRetry: () => void
}

export function RainControls({ maps, image, onRetry }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  // Se replie tout seul dès que la carte est prête, une seule fois (pas à
  // chaque nouveau "ready", sinon impossible de le rouvrir).
  const autoCollapsedRef = useRef(false)
  const ready = maps.status === 'ready' && image.status === 'ready'
  useEffect(() => {
    if (ready && !autoCollapsedRef.current) {
      autoCollapsedRef.current = true
      setCollapsed(true)
    }
  }, [ready])

  const error = maps.status === 'error' ? maps.message : image.status === 'error' ? image.message : null
  const loading = maps.status === 'loading' || image.status === 'loading'

  return (
    <div className={collapsed ? 'rain-controls rain-controls--collapsed' : 'rain-controls'}>
      <button type="button" className="rain-controls__header" onClick={() => setCollapsed((c) => !c)}>
        <span>🌧️ Carte de pluie — cumul 24h</span>
        <span className="rain-controls__chevron">{collapsed ? '▸' : '▾'}</span>
      </button>

      {!collapsed && (
        <div className="rain-controls__body">
          {loading && <div className="rain-controls__status">Chargement…</div>}

          {error && (
            <>
              <div className="rain-controls__error">{error}</div>
              <button type="button" className="rain-controls__load-btn" onClick={onRetry}>
                Réessayer
              </button>
            </>
          )}

          {maps.status === 'ready' && image.status === 'ready' && (
            <>
              <div className="rain-controls__status">
                Du {PERIOD_FORMATTER.format(new Date(maps.meta.rain24h.from))} au{' '}
                {PERIOD_FORMATTER.format(new Date(maps.meta.rain24h.to))}
                <br />
                Actualisé à {TIME_FORMATTER.format(new Date(maps.meta.fetchedAt))} (
                {formatRelativeAge(new Date(maps.meta.fetchedAt).getTime())}) · AROME HD 1,5 km
              </div>
              <div className="rain-controls__legend">
                {RAIN_LEGEND_STOPS.map((stop) => (
                  <div key={stop.label} className="rain-controls__legend-item">
                    <span className="rain-controls__legend-swatch" style={{ background: stop.color }} />
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
