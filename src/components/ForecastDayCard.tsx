// Une journée de la prévision ponctuelle (panneau flottant et écran plein-écran
// mobile : même rendu, un seul composant).
import { MODEL_LABELS } from '../lib/rainMaps'
import { weatherCodeInfo } from '../lib/weatherCode'
import type { ForecastDay } from '../types'

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })

// Désaccord notable entre le modèle affiché et un autre : au moins 5 mm
// d'écart ET un rapport d'au moins 2 (pas la peine d'alerter pour 0,2 contre
// 0,5 mm, ni pour 20 contre 24 mm).
function disagreeing(day: ForecastDay): ForecastDay['otherModels'] {
  return day.otherModels.filter((o) => {
    const hi = Math.max(o.mm, day.precipitationSum)
    const lo = Math.min(o.mm, day.precipitationSum)
    return hi - lo >= 5 && hi >= 2 * lo
  })
}

const mm = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })

export function ForecastDayCard({ day }: { day: ForecastDay }) {
  const { emoji, label } = weatherCodeInfo(day.weatherCode)
  const divergent = disagreeing(day)
  return (
    <div className="forecast-day">
      <div className="forecast-day__date">{WEEKDAY_FORMATTER.format(new Date(day.date))}</div>
      <div className="forecast-day__emoji" title={label}>
        {emoji}
      </div>
      <div className="forecast-day__temps">
        <span className="forecast-day__max">{Math.round(day.tempMax)}°</span>
        <span className="forecast-day__min">{Math.round(day.tempMin)}°</span>
      </div>
      <div className="forecast-day__precip">
        💧 {day.precipitationSum.toFixed(1)}mm
        {day.precipitationProbabilityMax !== null && ` (${day.precipitationProbabilityMax}%)`}
      </div>
      {day.precipitationModel && (
        <div className="forecast-day__model">{MODEL_LABELS[day.precipitationModel] ?? day.precipitationModel}</div>
      )}
      {divergent.length > 0 && (
        <div className="forecast-day__warn">
          ⚠ modèles divergents :{' '}
          {divergent.map((o) => `${MODEL_LABELS[o.model] ?? o.model} ${mm(o.mm)} mm`).join(' · ')}
        </div>
      )}
    </div>
  )
}
