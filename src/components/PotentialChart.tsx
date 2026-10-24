// Courbe du potentiel d'un endroit jour par jour (fiche du mode « Coins ») : trait plein sur les 7 jours de
// prévision fiables, pointillés au-delà (modèle AIFS seul, jours 8 à 15), meilleur jour marqué.
import { scoreLabel, type SeriesPoint } from '../lib/coins'

const W = 320
const H = 120
const PAD = { l: 62, r: 10, t: 10, b: 24 }
// Bandes de niveau (mêmes seuils que la légende et scoreLabel).
const BANDS = [
  { from: 0, to: 0.12, label: 'Faible', color: '#f3f4f6' },
  { from: 0.12, to: 0.35, label: 'Possible', color: '#fef3c7' },
  { from: 0.35, to: 0.5, label: 'Bon', color: '#fde2c8' },
  { from: 0.5, to: 1, label: 'Très bon', color: '#fbd0c4' },
]
const DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })

export function PotentialChart({ series, today }: { series: SeriesPoint[]; today: string }) {
  if (series.length < 2) return null
  const top = Math.max(0.6, ...series.map((p) => p.value)) * 1.05
  const x = (i: number) => PAD.l + (i / (series.length - 1)) * (W - PAD.l - PAD.r)
  const y = (v: number) => PAD.t + (1 - Math.min(v, top) / top) * (H - PAD.t - PAD.b)
  const firstLong = series.findIndex((p) => !p.reliable)
  const solidEnd = firstLong === -1 ? series.length - 1 : Math.max(0, firstLong - 1)
  const path = (from: number, to: number) =>
    series
      .slice(from, to + 1)
      .map((p, k) => `${k === 0 ? 'M' : 'L'}${x(from + k).toFixed(1)},${y(p.value).toFixed(1)}`)
      .join(' ')
  const best = series.reduce((b, p, i) => (p.value > series[b].value ? i : b), 0)
  const ticks = series.map((p, i) => ({ i, p })).filter(({ i }) => i === 0 || i === series.length - 1 || i % 3 === 0)

  return (
    <figure className="potential">
      <figcaption>
        Potentiel sur les {series.length} prochains jours
        {series[best].value >= 0.12 && (
          <span className="potential__best">
            {' '}
            · meilleur : {series[best].date === today ? "aujourd'hui" : DAY.format(new Date(series[best].date))} ({scoreLabel(series[best].value).toLowerCase()})
          </span>
        )}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Courbe du potentiel jour par jour">
        {BANDS.map((b) => (
          <g key={b.label}>
            <rect x={PAD.l} width={W - PAD.l - PAD.r} y={y(Math.min(b.to, top))} height={Math.max(0, y(b.from) - y(Math.min(b.to, top)))} fill={b.color} />
            {b.from < top && (
              <text x={PAD.l - 6} y={(y(b.from) + y(Math.min(b.to, top))) / 2 + 4} textAnchor="end" className="potential__band">
                {b.label}
              </text>
            )}
          </g>
        ))}
        {firstLong > 0 && (
          <text x={x(firstLong) + 2} y={PAD.t + 9} className="potential__note">
            tendance
          </text>
        )}
        <path d={path(0, solidEnd)} fill="none" stroke="#b45309" strokeWidth="2.5" strokeLinejoin="round" />
        {firstLong > 0 && <path d={path(solidEnd, series.length - 1)} fill="none" stroke="#b45309" strokeWidth="2" strokeDasharray="4 4" />}
        {series.map((p, i) => (
          <circle key={p.date} cx={x(i)} cy={y(p.value)} r={i === best ? 4.5 : 2.5} fill={i === best ? '#7c2d12' : '#b45309'} opacity={p.reliable ? 1 : 0.6} />
        ))}
        {ticks.map(({ i, p }) => (
          <text
            key={p.date}
            x={x(i)}
            y={H - 6}
            textAnchor={i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'}
            className="potential__tick"
          >
            {p.date === today ? 'auj.' : DAY.format(new Date(p.date))}
          </text>
        ))}
      </svg>
    </figure>
  )
}
