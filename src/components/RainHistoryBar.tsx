// Mode Historique : curseur à DEUX poignées sur les 15 derniers jours (J-15 à J-1). Les deux poignées sur le même
// jour = la pluie de ce jour-là ; écartées = le CUMUL de pluie sur la plage (ex. de J-10 à J-8). Bouton « 24 h » pour
// revenir à la carte glissante des 24 dernières heures ; ▶ / ⏸ fait défiler les jours un par un (animation radar).
import { RAIN_EXTENDED_LEGEND } from '../lib/color'
import type { RainDay } from '../lib/rainDays'
import './RainHistoryBar.css'

const DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
const fmtDay = (d: string) => DAY.format(new Date(`${d}T12:00:00`))
const mm = (v: number) => `${v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} mm`

// Plage en « décalages » : 1 = hier (J-1) … n = le jour le plus ancien ; from >= to.
export type RainRange = { from: number; to: number }

type Props = {
  days: RainDay[] // du plus ancien au plus récent
  range: RainRange | null // null = 24 dernières heures
  onRange: (r: RainRange | null) => void
  maxMm: number | null // maximum de la carte affichée (jour ou cumul)
  playing: boolean
  onPlay: () => void
  loading: boolean
}

export function RainHistoryBar({ days, range, onRange, maxMm, playing, onPlay, loading }: Props) {
  const n = days.length
  if (n === 0) return null
  const r = range ?? { from: 1, to: 1 }
  const dayAt = (offset: number) => days[n - offset]
  const first = dayAt(r.from)
  const last = dayAt(r.to)
  const count = r.from - r.to + 1
  const allCorrected = range ? days.slice(n - r.from, n - r.to + 1).every((d) => d.corrected) : true

  // Valeurs des deux curseurs : position = -décalage (gauche = plus ancien).
  const setFrom = (v: number) => onRange({ from: Math.max(-v, r.to), to: r.to })
  const setTo = (v: number) => onRange({ from: r.from, to: Math.min(-v, r.from) })

  return (
    <div className="rain-history" role="group" aria-label="Historique de pluie">
      <button type="button" className="rain-history__play" onClick={onPlay} aria-label={playing ? 'Pause' : 'Faire défiler les jours'}>
        {playing ? '⏸' : '▶'}
      </button>
      <div className="rain-history__main">
        <div className="rain-history__label">
          {range ? (
            <>
              <b className="rain-history__date">
                {count === 1 ? fmtDay(first.date) : `du ${fmtDay(first.date)} au ${fmtDay(last.date)}`}
              </b>
              <span>
                {count > 1 ? ` · cumul ${count} jours` : ` · J-${r.from}`}
                {maxMm !== null && ` · max ${mm(maxMm)}`}
                {allCorrected ? ' · corrigée par les pluviomètres' : ' · en partie modèle seul'}
              </span>
            </>
          ) : (
            <b>24 dernières heures</b>
          )}
          {loading && <span className="rain-history__loading"> · chargement…</span>}
        </div>
        <div className={range ? 'rain-history__slider' : 'rain-history__slider rain-history__slider--off'}>
          <input
            type="range"
            min={-n}
            max={-1}
            step={1}
            value={-r.from}
            onChange={(e) => setFrom(Number(e.target.value))}
            aria-label="Premier jour"
          />
          <input
            type="range"
            min={-n}
            max={-1}
            step={1}
            value={-r.to}
            onChange={(e) => setTo(Number(e.target.value))}
            aria-label="Dernier jour"
          />
        </div>
        <div className="rain-history__ticks" aria-hidden="true">
          <span>J-{n}</span>
          <span>J-1</span>
        </div>
        <div className="rain-history__legend" aria-hidden="true">
          {RAIN_EXTENDED_LEGEND.map((l) => (
            <span key={l.label} title={`${l.label} mm`}>
              <i style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
        </div>
      </div>
      <button
        type="button"
        className={range ? 'rain-history__24h' : 'rain-history__24h rain-history__24h--on'}
        onClick={() => onRange(range ? null : { from: 1, to: 1 })}
        aria-pressed={!range}
        title="Pluie des 24 dernières heures"
      >
        24 h
      </button>
    </div>
  )
}
