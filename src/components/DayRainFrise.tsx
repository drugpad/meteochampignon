// Frise coulissante du cumul de pluie jour par jour d'une station (fiche Météo-France, Infoclimat, Netatmo) :
// une barre par jour, un curseur (ou ◀ ▶, ou un appui sur une barre) pour passer d'un jour à l'autre, avec la pluie
// du jour choisi et le cumul depuis le premier jour de la frise.
import { useEffect, useState } from 'react'
import './DayRainFrise.css'

export type FriseDay = {
  date: string // yyyy-mm-dd (jour calendaire de Paris)
  mm: number | null // null = aucune mesure ce jour-là
  partial?: boolean // mesures incomplètes : le cumul est un minimum
}

const LONG = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
const SHORT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'numeric' })
const fr = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })
// Midi UTC : évite qu'un décalage de fuseau fasse glisser le jour affiché.
const at = (date: string) => new Date(`${date}T12:00:00Z`)

export function DayRainFrise({ days }: { days: FriseDay[] }) {
  const [index, setIndex] = useState(days.length - 1)
  // Les jours changent (autre station, rechargement) : retour sur le plus récent.
  useEffect(() => setIndex(days.length - 1), [days])

  if (days.length === 0) return null
  const i = Math.min(index, days.length - 1)
  const day = days[i]
  const max = Math.max(1, ...days.map((d) => d.mm ?? 0))
  const cumul = days.slice(0, i + 1).reduce((s, d) => s + (d.mm ?? 0), 0)
  const missing = days.slice(0, i + 1).some((d) => d.mm === null || d.partial)

  return (
    <div className="frise">
      <div className="frise__head">
        <button type="button" className="frise__step" onClick={() => setIndex(Math.max(0, i - 1))} disabled={i === 0} aria-label="Jour précédent">
          ◀
        </button>
        <div className="frise__day">
          <div className="frise__date">{LONG.format(at(day.date))}</div>
          <div className="frise__mm">
            {day.mm === null ? <span className="frise__none">pas de mesure</span> : <>{(day.partial ? '≥ ' : '') + fr(day.mm)} mm</>}
          </div>
        </div>
        <button type="button" className="frise__step" onClick={() => setIndex(Math.min(days.length - 1, i + 1))} disabled={i === days.length - 1} aria-label="Jour suivant">
          ▶
        </button>
      </div>

      <div className="frise__bars" role="presentation">
        {days.map((d, k) => (
          <button
            key={d.date}
            type="button"
            className={'frise__bar' + (k === i ? ' frise__bar--on' : '') + (d.mm === null ? ' frise__bar--none' : '') + (d.partial ? ' frise__bar--partial' : '')}
            onClick={() => setIndex(k)}
            title={`${SHORT.format(at(d.date))} : ${d.mm === null ? 'pas de mesure' : fr(d.mm) + ' mm'}`}
            aria-label={`${LONG.format(at(d.date))} : ${d.mm === null ? 'pas de mesure' : fr(d.mm) + ' mm'}`}
          >
            <span className="frise__fill" style={{ height: `${d.mm === null ? 0 : Math.max(d.mm > 0 ? 6 : 0, (d.mm / max) * 100)}%` }} />
          </button>
        ))}
      </div>

      <input
        className="frise__range"
        type="range"
        min={0}
        max={days.length - 1}
        step={1}
        value={i}
        onChange={(e) => setIndex(Number(e.target.value))}
        aria-label="Faire défiler les jours"
      />
      <div className="frise__axis">
        <span>{SHORT.format(at(days[0].date))}</span>
        <span>{SHORT.format(at(days[days.length - 1].date))}</span>
      </div>
      <div className="frise__cumul">
        Cumul du {SHORT.format(at(days[0].date))} au {SHORT.format(at(day.date))} : <b>{(missing ? '≥ ' : '') + fr(Math.round(cumul * 10) / 10)} mm</b>
        {missing && <span className="frise__note"> (jours sans mesure ou incomplets inclus)</span>}
      </div>
    </div>
  )
}
