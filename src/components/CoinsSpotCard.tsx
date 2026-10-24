// Fiche d'un endroit en mode « Coins » : note, milieu, météo, et pourquoi c'est (ou non) un bon coin.
import { SPECIES, scoreLabel, type SeriesPoint, type Species, type SpotDetail } from '../lib/coins'
import { useParisToday } from '../lib/useParisToday'
import { PotentialChart } from './PotentialChart'
import './CoinsSpotCard.css'

type Props = {
  species: Species
  lat: number
  lon: number
  name: string | null
  detail: SpotDetail | null
  loading: boolean
  series: SeriesPoint[] | null
  onClose: () => void
}

export function CoinsSpotCard({ species, lat, lon, name, detail, loading, series, onClose }: Props) {
  const { today } = useParisToday()
  const sp = SPECIES.find((s) => s.key === species)!
  const nav = `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(5)},${lon.toFixed(5)}`
  return (
    <div className="spot-card" role="dialog" aria-label="Détail du coin">
      <div className="spot-card__head">
        <div>
          <div className="spot-card__title">{name ?? 'Endroit choisi'}</div>
          <div className="spot-card__sub">
            {sp.label} · {lat.toFixed(4)}, {lon.toFixed(4)}
          </div>
        </div>
        <button type="button" className="spot-card__close" onClick={onClose} aria-label="Fermer">
          ×
        </button>
      </div>

      {loading && <p className="spot-card__muted">Analyse de l'endroit…</p>}
      {!loading && !detail && <p className="spot-card__muted">Hors de la zone étudiée (Midi-Pyrénées).</p>}
      {detail && (
        <>
          <div className="spot-card__score">
            <span className="spot-card__badge">{scoreLabel(detail.score)}</span>
            <span className="spot-card__muted">
              milieu {Math.round(detail.habitat * 100)} % · météo {Math.round(detail.pousse * 100)} %
            </span>
          </div>
          <ul className="spot-card__facts">
            <li>
              🌳 <b>Milieu</b> : {detail.trees}
              {detail.ph !== null && `, sol pH ${detail.ph.toFixed(1)}`}, {detail.altitude} m
            </li>
            <li>
              🌧️ <b>Pluie</b> : {detail.rain15} mm ces 15 jours
              {detail.daysSinceRain !== null
                ? `, dernière grosse pluie il y a ${detail.daysSinceRain} j`
                : ', pas de grosse pluie récente'}
            </li>
            <li>
              🌡️ <b>Températures</b> : {detail.temp5.toFixed(0)} °C en moyenne ces 5 jours
            </li>
          </ul>
          {series && <PotentialChart series={series} today={today} />}
          {detail.reasons.length > 0 && (
            <ul className="spot-card__reasons">
              {detail.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          <a className="spot-card__nav" href={nav} target="_blank" rel="noreferrer">
            🧭 Itinéraire jusqu'ici
          </a>
          <p className="spot-card__muted spot-card__warn">
            Indicatif. Respectez les propriétés privées et la réglementation locale de cueillette.
          </p>
        </>
      )}
    </div>
  )
}
