// Contenu du popup affiché au clic sur une station (voir spec module
// Stations) : pluie + température des 24 dernières heures sur un même
// graphique (retour utilisateur : les avoir sur deux graphiques séparés
// prenait trop de place), et mini prévision 5 jours elle aussi en graphique.
import { Bar, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import './StationPopup.css'
import { formatRelativeAge, isOlderThanHours } from '../lib/formatRelativeAge'
import { COMPLETE_RATIO, meteocielStationUrl } from '../lib/stations'
import { weatherCodeInfo } from '../lib/weatherCode'
import type { StationDetailState } from '../types'

const HOUR_FORMATTER = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit' })
const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' })
const DAY_FORMATTER = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' })

type Props = {
  state: StationDetailState
  // 'popup' (défaut) : bulle Leaflet classique, largeur fixe, titre inclus.
  // 'page' : plein écran mobile (voir StationFullscreen.tsx) — largeur
  // fluide, pas de titre (déjà affiché dans l'en-tête de la page).
  variant?: 'popup' | 'page'
}

// Tick d'axe X personnalisé pour la mini prévision : weekday + emoji météo
// empilés, positionnés par Recharts lui-même (donc alignés pile sous
// chaque barre/point, contrairement à une rangée d'emoji posée à côté à la
// main).
function DayTick({ x, y, payload }: { x: number; y: number; payload: { value: string } }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <text dy={10} textAnchor="middle" fontSize={10} fill="#444">
        {payload.value}
      </text>
    </g>
  )
}

export function StationPopup({ state, variant = 'popup' }: Props) {
  const rootClassName = variant === 'page' ? 'station-popup station-popup--page' : 'station-popup'

  if (state.status === 'idle') return null

  if (state.status === 'loading') {
    return <div className={`${rootClassName} station-popup--message`}>Chargement…</div>
  }

  if (state.status === 'error') {
    return <div className={`${rootClassName} station-popup--message station-popup--error`}>{state.message}</div>
  }

  const { station, rainHistory, tempHistory, dailyRain, miniForecast, last24hCoverage, lastObservation } = state.detail
  const observationLate = lastObservation !== null && isOlderThanHours(lastObservation, 6)
  // Avertissements calculés sur la couverture réelle des données (voir
  // fetchStationDetail) : ils disparaissent seuls quand les trous sont comblés.
  const incomplete24h = last24hCoverage < COMPLETE_RATIO * 24
  const hasIncompleteDays = dailyRain.some((d) => !d.complete)
  const totalRain = Math.round(rainHistory.reduce((sum, p) => sum + p.rain, 0) * 10) / 10
  const totalRain10d = Math.round(dailyRain.reduce((sum, d) => sum + d.rain, 0) * 10) / 10
  const dailyRainData = dailyRain.map((d) => ({ ...d, label: DAY_FORMATTER.format(new Date(d.date)) }))

  // Fusion pluie + température par horodatage (les deux viennent des mêmes
  // observations horaires mais une valeur peut manquer côté station pour
  // l'une sans l'autre — voir fetchStationDetail, stations.ts).
  const byTime = new Map<string, { time: string; rain?: number; temp?: number }>()
  for (const p of rainHistory) byTime.set(p.time, { ...byTime.get(p.time), time: p.time, rain: p.rain })
  for (const p of tempHistory) byTime.set(p.time, { ...byTime.get(p.time), time: p.time, temp: p.temp })
  const hourlyData = [...byTime.values()]
    .sort((a, b) => a.time.localeCompare(b.time))
    .map((p) => ({ ...p, label: HOUR_FORMATTER.format(new Date(p.time)) }))

  const forecastData = miniForecast.map((day) => {
    const { emoji } = weatherCodeInfo(day.weatherCode)
    return {
      label: `${WEEKDAY_FORMATTER.format(new Date(day.date))} ${emoji}`,
      precip: day.precipitationSum,
      tempMax: Math.round(day.tempMax),
      tempMin: Math.round(day.tempMin),
    }
  })

  return (
    <div className={rootClassName}>
      {variant === 'popup' && (
        <>
          <div className="station-popup__title">{station.name}</div>
          {station.altitude !== undefined && <div className="station-popup__altitude">{station.altitude} m d'altitude</div>}
        </>
      )}

      {lastObservation !== null && (
        <div className={observationLate ? 'station-popup__notice' : 'station-popup__altitude'}>
          Dernière mesure reçue : {formatRelativeAge(new Date(lastObservation as string).getTime())}
          {observationLate && ' — mise à jour en retard (les mesures arrivent par lots)'}
        </div>
      )}

      <a
        className="station-popup__link"
        href={meteocielStationUrl(station.id)}
        target="_blank"
        rel="noopener noreferrer"
      >
        Voir la station sur Météociel ↗
      </a>

      <div className="station-popup__section-title">
        Pluie ({totalRain} mm cumulés) et température — 24 dernières heures
      </div>
      {incomplete24h && (
        <div className="station-popup__notice">
          Historique incomplet sur les dernières 24 h ({last24hCoverage} h reçues sur 24) : la pluie est
          probablement sous-estimée. Mise à jour en cours, ou station qui n'a pas transmis.
        </div>
      )}
      <div className="station-popup__legend">
        <span className="station-popup__legend-item">
          <span className="station-popup__legend-dot" style={{ background: '#2563eb' }} /> Pluie (mm)
        </span>
        <span className="station-popup__legend-item">
          <span className="station-popup__legend-dot" style={{ background: '#dc2626' }} /> Température (°C)
        </span>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <ComposedChart data={hourlyData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <XAxis dataKey="label" fontSize={10} interval={3} />
          <YAxis yAxisId="rain" fontSize={10} width={28} />
          <YAxis yAxisId="temp" orientation="right" fontSize={10} width={28} domain={['auto', 'auto']} />
          <Tooltip formatter={(v, name) => (name === 'temp' ? [`${v}°C`, 'Température'] : [`${v} mm`, 'Pluie'])} />
          <Bar yAxisId="rain" dataKey="rain" fill="#2563eb" radius={[2, 2, 0, 0]} barSize={6} />
          <Line yAxisId="temp" type="monotone" dataKey="temp" stroke="#dc2626" dot={false} strokeWidth={2} />
        </ComposedChart>
      </ResponsiveContainer>

      <div className="station-popup__section-title">
        Cumul de pluie par jour ({totalRain10d} mm sur {dailyRain.length} jours)
      </div>
      {dailyRainData.length > 0 ? (
        <>
          <ResponsiveContainer width="100%" height={100}>
            <ComposedChart data={dailyRainData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <XAxis dataKey="label" fontSize={10} interval={dailyRainData.length > 6 ? 1 : 0} />
              <YAxis fontSize={10} width={28} />
              <Tooltip formatter={(v) => [`${v} mm`, 'Pluie']} />
              <Bar dataKey="rain" fill="#2563eb" radius={[2, 2, 0, 0]} barSize={14}>
                {dailyRainData.map((d) => (
                  <Cell key={d.date} fill={d.complete ? '#2563eb' : '#bfdbfe'} />
                ))}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
          {hasIncompleteDays && (
            <div className="station-popup__notice">
              Barres claires : jours aux données horaires incomplètes, cumul sous-estimé possible.
            </div>
          )}
        </>
      ) : (
        <div className="station-popup__message">
          Historique pas encore accumulé pour cette station (revenir dans quelques heures).
        </div>
      )}

      <div className="station-popup__section-title">Mini prévision 5 jours</div>
      <div className="station-popup__legend">
        <span className="station-popup__legend-item">
          <span className="station-popup__legend-dot" style={{ background: '#2563eb' }} /> Pluie (mm)
        </span>
        <span className="station-popup__legend-item">
          <span className="station-popup__legend-dot" style={{ background: '#dc2626' }} /> Max (°C)
        </span>
        <span className="station-popup__legend-item">
          <span className="station-popup__legend-dot" style={{ background: '#f59e0b' }} /> Min (°C)
        </span>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <ComposedChart data={forecastData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <XAxis dataKey="label" interval={0} tick={<DayTick x={0} y={0} payload={{ value: '' }} />} tickLine={false} />
          <YAxis yAxisId="precip" fontSize={10} width={28} />
          <YAxis yAxisId="temp" orientation="right" fontSize={10} width={28} domain={['auto', 'auto']} />
          <Tooltip
            formatter={(v, name) => (name === 'precip' ? [`${v} mm`, 'Pluie'] : [`${v}°C`, name === 'tempMax' ? 'Max' : 'Min'])}
          />
          <Bar yAxisId="precip" dataKey="precip" fill="#2563eb" radius={[2, 2, 0, 0]} barSize={14} />
          <Line yAxisId="temp" type="monotone" dataKey="tempMax" stroke="#dc2626" dot={{ r: 2 }} strokeWidth={2} />
          <Line yAxisId="temp" type="monotone" dataKey="tempMin" stroke="#f59e0b" dot={{ r: 2 }} strokeWidth={2} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
