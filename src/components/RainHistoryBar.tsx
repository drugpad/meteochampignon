// Mode Historique : curseur de la pluie jour par jour, de J-15 à J-1, plus « 24 dernières heures » tout à droite
// (la carte glissante habituelle), avec ▶ / ⏸ qui fait défiler les jours comme une animation radar.
import type { RainDay } from '../lib/rainDays'
import './RainHistoryBar.css'

const DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
const mm = (v: number) => `${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} mm`

type Props = {
  days: RainDay[] // du plus ancien au plus récent
  // Position : 0 = 24 dernières heures ; 1 = hier (J-1) ; … ; days.length = le plus ancien.
  offset: number
  onOffset: (o: number) => void
  playing: boolean
  onPlay: () => void
  loading: boolean
}

export function RainHistoryBar({ days, offset, onOffset, playing, onPlay, loading }: Props) {
  const n = days.length
  if (n === 0) return null
  const day = offset > 0 ? days[n - offset] : null
  return (
    <div className="rain-history" role="group" aria-label="Historique de pluie">
      <button type="button" className="rain-history__play" onClick={onPlay} aria-label={playing ? 'Pause' : 'Faire défiler les jours'}>
        {playing ? '⏸' : '▶'}
      </button>
      <div className="rain-history__main">
        <div className="rain-history__label">
          {day ? (
            <>
              <b className="rain-history__date">{DAY.format(new Date(`${day.date}T12:00:00`))}</b>
              <span>
                {' '}
                · J-{offset} · max {mm(day.maxMm)}
                {day.corrected ? ' · corrigée par les pluviomètres' : ' · modèle seul'}
              </span>
            </>
          ) : (
            <b>24 dernières heures</b>
          )}
          {loading && <span className="rain-history__loading"> · chargement…</span>}
        </div>
        <input
          type="range"
          min={-n}
          max={0}
          step={1}
          value={-offset}
          onChange={(e) => onOffset(-Number(e.target.value))}
          aria-label="Jour affiché"
          aria-valuetext={day ? `${DAY.format(new Date(`${day.date}T12:00:00`))}, J-${offset}` : '24 dernières heures'}
        />
        <div className="rain-history__ticks" aria-hidden="true">
          <span>J-{n}</span>
          {/* « J-1 » à sa vraie place : l'avant-dernière graduation, tout près de la droite. */}
          <span className="rain-history__tick-j1" style={{ left: `${((n - 1) / n) * 100}%` }}>
            J-1
          </span>
          <span>24 h</span>
        </div>
      </div>
    </div>
  )
}
