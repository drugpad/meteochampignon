// Contenu du popup affiché au clic sur une station (voir spec module
// Stations) : graphique pluie 24h, graphique température, mini prévision 5j.
import { Bar, BarChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import './StationPopup.css'
import { weatherCodeInfo } from '../lib/weatherCode'
import type { StationDetailState } from '../types'

const HOUR_FORMATTER = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit' })
const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' })

type Props = { state: StationDetailState }

export function StationPopup({ state }: Props) {
  if (state.status === 'idle') return null

  if (state.status === 'loading') {
    return <div className="station-popup station-popup--message">Chargement…</div>
  }

  if (state.status === 'error') {
    return <div className="station-popup station-popup--message station-popup--error">{state.message}</div>
  }

  const { station, rainHistory, tempHistory, miniForecast } = state.detail
  const rainData = rainHistory.map((p) => ({ time: HOUR_FORMATTER.format(new Date(p.time)), rain: p.rain }))
  const tempData = tempHistory.map((p) => ({ time: HOUR_FORMATTER.format(new Date(p.time)), temp: p.temp }))
  const totalRain = Math.round(rainHistory.reduce((sum, p) => sum + p.rain, 0) * 10) / 10

  return (
    <div className="station-popup">
      <div className="station-popup__title">{station.name}</div>
      {station.altitude !== undefined && <div className="station-popup__altitude">{station.altitude} m d'altitude</div>}

      <div className="station-popup__section-title">Pluie — 24 dernières heures ({totalRain} mm cumulés)</div>
      <ResponsiveContainer width="100%" height={90}>
        <BarChart data={rainData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <XAxis dataKey="time" fontSize={10} interval={3} />
          <YAxis fontSize={10} width={30} />
          <Tooltip formatter={(v) => [`${v} mm`, 'Pluie']} />
          <Bar dataKey="rain" fill="#2563eb" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>

      <div className="station-popup__section-title">Température — 24 dernières heures</div>
      <ResponsiveContainer width="100%" height={90}>
        <LineChart data={tempData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <XAxis dataKey="time" fontSize={10} interval={3} />
          <YAxis fontSize={10} width={30} domain={['auto', 'auto']} />
          <Tooltip formatter={(v) => [`${v}°C`, 'Température']} />
          <Line type="monotone" dataKey="temp" stroke="#dc2626" dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>

      <div className="station-popup__section-title">Mini prévision 5 jours</div>
      <div className="station-popup__mini-forecast">
        {miniForecast.map((day) => {
          const { emoji } = weatherCodeInfo(day.weatherCode)
          return (
            <div key={day.date} className="station-popup__mini-day">
              <div>{WEEKDAY_FORMATTER.format(new Date(day.date))}</div>
              <div>{emoji}</div>
              <div>
                {Math.round(day.tempMax)}°/{Math.round(day.tempMin)}°
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
