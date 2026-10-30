// Fiche d'un endroit en mode « Coins » : note, milieu, météo, et pourquoi c'est (ou non) un bon coin.
// Sur mobile, tiroir à deux hauteurs : version courte par défaut (nom, note, meilleur jour, itinéraire)
// pour garder la carte visible, dépliée d'un appui sur l'en-tête (retour utilisateur : « des fois certaines
// fenêtres cachent tout »). Sur grand écran, toujours dépliée.
import { useEffect, useRef, useState } from 'react'
import { outlook as buildOutlook, SPECIES, scoreLabel, type SeriesPoint, type Species, type SpotDetail } from '../lib/coins'
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
  // Mode « Milieu seul » : le pourcentage est celui du milieu, sans la météo.
  milieuOnly?: boolean
  onClose: () => void
}

const DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric' })
const isMobile = () => window.matchMedia('(max-width: 640px)').matches

export function CoinsSpotCard({ species, lat, lon, name, detail, loading, series, milieuOnly = false, onClose }: Props) {
  const { today } = useParisToday()
  const [expanded, setExpanded] = useState(() => !isMobile())
  const sp = SPECIES.find((s) => s.key === species)!
  const nav = `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(5)},${lon.toFixed(5)}`
  const best = series?.length ? series.reduce((b, p) => (p.value > b.value ? p : b)) : null
  const rawOutlook = !milieuOnly && series ? buildOutlook(series, today) : null
  // Si les pluviomètres proches contredisent le modèle (pluie bien plus basse), on ne dit plus « c'est le moment ».
  const outlook =
    rawOutlook && detail?.rainCheck.status === 'lower' && rawOutlook.tone === 'go'
      ? { ...rawOutlook, headline: `À confirmer sur place : ${rawOutlook.headline.replace("C'est le moment : ", '').replace(/^F/, 'f')}`, tone: 'soon' as const }
      : rawOutlook

  // Mobile : les boutons ronds (GPS, fonds) remontent au-dessus du tiroir, quelle que soit sa hauteur.
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const root = document.documentElement
    const update = () => root.style.setProperty('--sheet-h', `${el.offsetHeight}px`)
    const ro = new ResizeObserver(update)
    ro.observe(el)
    root.classList.add('mc-sheet-open')
    update()
    return () => {
      ro.disconnect()
      root.classList.remove('mc-sheet-open')
      root.style.removeProperty('--sheet-h')
    }
  }, [])

  return (
    <div ref={ref} className={expanded ? 'spot-card spot-card--open' : 'spot-card'} role="dialog" aria-label="Détail du coin">
      <button
        type="button"
        className="spot-card__handle"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        aria-label={expanded ? 'Réduire la fiche' : 'Afficher le détail'}
      />
      <div className="spot-card__head">
        <button type="button" className="spot-card__head-main" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
          <span className="spot-card__title">{name ?? 'Endroit choisi'}</span>
          <span className="spot-card__sub">
            {sp.label}
            {detail && (
              <>
                {' · '}
                <span className="spot-card__badge">
                  {Math.round(detail.score * 100)} % · {scoreLabel(detail.score)}
                </span>
              </>
            )}
          </span>
        </button>
        <button type="button" className="spot-card__close" onClick={onClose} aria-label="Fermer">
          ×
        </button>
      </div>

      {loading && <p className="spot-card__muted">Analyse de l'endroit…</p>}
      {!loading && !detail && <p className="spot-card__muted">Hors de la zone étudiée (Midi-Pyrénées).</p>}

      {detail && !expanded && (
        <div className="spot-card__compact">
          <span className="spot-card__muted">
            {outlook
              ? outlook.headline
              : best && best.value >= 0.12
              ? `Meilleur jour : ${best.date === today ? "aujourd'hui" : DAY.format(new Date(best.date))}`
              : milieuOnly
                ? `Milieu ${Math.round(detail.habitat * 100)} % (sans la météo)`
                : `Milieu ${Math.round(detail.habitat * 100)} % · météo ${Math.round(detail.pousse * 100)} %`}
          </span>
          <button type="button" className="spot-card__more" onClick={() => setExpanded(true)}>
            Détails ▴
          </button>
        </div>
      )}

      {detail && expanded && (
        <>
          <div className="spot-card__score spot-card__muted">
            {milieuOnly
              ? `Potentiel du milieu ${Math.round(detail.habitat * 100)} % (sans la météo)`
              : `Potentiel ${Math.round(detail.score * 100)} % = milieu ${Math.round(detail.habitat * 100)} % × météo ${Math.round(detail.pousse * 100)} %`}{' '}
            · {lat.toFixed(4)}, {lon.toFixed(4)}
          </div>
          <ul className="spot-card__facts">
            <li>
              🌳 <b>Milieu</b> : {detail.trees}
              {detail.ph !== null && `, sol pH ${detail.ph.toFixed(1)}`}, {detail.altitude} m
            </li>
            <li>
              🌧️ <b>Pluie</b> : {detail.rain15} mm ces 15 jours
              {detail.daysSinceRain !== null
                ? `, dernier épisode de pluie (≥ 15 mm en 5 jours) il y a ${detail.daysSinceRain} j`
                : ', pas d’épisode de pluie (≥ 15 mm en 5 jours) récent'}{' '}
              <span className="spot-card__muted">(estimation du modèle, corrigée par les pluviomètres proches)</span>
            </li>
            <li>
              🌡️ <b>Températures</b> : {detail.temp5.toFixed(0)} °C en moyenne ces 5 jours{' '}
              <span className="spot-card__muted">(modèle)</span>
            </li>
            {detail.nearby.map((m) => (
              <li key={m.name}>
                📏 <b>Mesuré</b> à {m.name} ({m.altitude !== undefined ? `${m.altitude} m, ` : ''}{m.km} km) :{' '}
                {m.rainMm.toLocaleString('fr-FR')} mm sur {m.days} jours
                {m.tminC !== null && `, minimale ${m.tminC.toLocaleString('fr-FR')} °C ces 3 jours`}
              </li>
            ))}
          </ul>
          <p className={`spot-card__check spot-card__check--${detail.rainCheck.status}`}>{detail.rainCheck.text}</p>
          {outlook && (
            <div className={`spot-card__outlook spot-card__outlook--${outlook.tone}`}>
              <b>{outlook.headline}</b>
              <span>{outlook.detail}</span>
            </div>
          )}
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
          <p className="spot-card__muted spot-card__warn">Indicatif. Respectez les propriétés privées et la réglementation locale de cueillette.</p>
        </>
      )}
    </div>
  )
}
