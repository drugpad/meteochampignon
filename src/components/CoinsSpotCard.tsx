// Fiche d'un endroit en mode « Coins » : note, milieu, météo, et pourquoi c'est (ou non) un bon coin.
// Sur mobile, tiroir : version courte par défaut (nom, note, meilleur jour) pour garder la carte visible, dépliée d'un
// appui sur l'en-tête (retour utilisateur : « des fois certaines fenêtres cachent tout »). Sur grand écran, dépliée.
// Revue le 01/11/2026 (« très verbeux », « quand on scroll, la croix disparaît », « pouvoir bouger cette carte ») :
// en-tête fixe (seul le contenu défile), fiche déplaçable par l'en-tête, chiffres en 4 cases, détails repliés.
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { choiceLabel, outlook as buildOutlook, scoreLabel, type CoinsChoice, type SeriesPoint, type SpotDetail } from '../lib/coins'
import { useParisToday } from '../lib/useParisToday'
import { PotentialChart } from './PotentialChart'
import './CoinsSpotCard.css'

type Props = {
  species: CoinsChoice
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

// L'indice n'est pas une probabilité : 100 = milieu idéal par la meilleure météo, presque jamais atteint. Le rang dans la
// région dit ce qu'il vaut ce jour-là.
function rankText(rank: number, milieuOnly: boolean): string {
  const when = milieuOnly ? '' : " aujourd'hui"
  if (rank >= 0.995) return `Parmi les meilleurs endroits de la région${when} (mieux que 99,5 % des bois et prairies).`
  if (rank >= 0.9) return `Dans les ${Math.max(1, Math.round((1 - rank) * 100))} % meilleurs endroits de la région${when}.`
  return `Mieux que ${Math.round(rank * 100)} % des bois et prairies de la région${when}.`
}
// Version courte, à côté de la note.
function rankShort(rank: number): string {
  if (rank >= 0.995) return 'top 0,5 %'
  if (rank >= 0.9) return `top ${Math.max(1, Math.round((1 - rank) * 100))} %`
  return `mieux que ${Math.round(rank * 100)} %`
}
const isMobile = () => window.matchMedia('(max-width: 640px)').matches
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))
// Mobile : hauteur du tiroir lâché sous laquelle on revient à la version courte, puis sous laquelle on ferme.
const SHEET_COMPACT_PX = 170
const SHEET_CLOSE_PX = 70

type Drag = { x0: number; y0: number; ox: number; oy: number; rect: DOMRect; mobile: boolean; moved: boolean }

export function CoinsSpotCard({ species, lat, lon, name, detail, loading, series, milieuOnly = false, onClose }: Props) {
  const { today } = useParisToday()
  const [expanded, setExpanded] = useState(() => !isMobile())
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

  // Déplacer la fiche en la tenant par l'en-tête : sur ordinateur, on la pose où l'on veut (l'en-tête reste à
  // l'écran) ; sur mobile, on tire le tiroir vers le haut (plus grand) ou vers le bas (version courte, puis fermeture).
  // Un simple appui garde son effet (déplier / replier).
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [sheetH, setSheetH] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<Drag | null>(null)
  // Un glisser se termine par un « click » : on l'ignore (sinon la fiche se replierait).
  const justDragged = useRef(false)
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.spot-card__close') || !ref.current) return
    justDragged.current = false
    drag.current = { x0: e.clientX, y0: e.clientY, ox: offset.x, oy: offset.y, rect: ref.current.getBoundingClientRect(), mobile: isMobile(), moved: false }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x0
    const dy = e.clientY - d.y0
    if (!d.moved) {
      if (Math.hypot(dx, dy) < 6) return
      d.moved = true
      setDragging(true)
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    if (d.mobile) setSheetH(clamp(d.rect.height - dy, 40, window.innerHeight * 0.88))
    else
      setOffset({
        x: d.ox + clamp(dx, 60 - d.rect.right, window.innerWidth - 60 - d.rect.left),
        y: d.oy + clamp(dy, -d.rect.top, window.innerHeight - 50 - d.rect.top),
      })
  }
  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    if (!d?.moved) return
    justDragged.current = true
    setDragging(false)
    if (!d.mobile) return
    const h = ref.current?.offsetHeight ?? 0
    if (h < SHEET_CLOSE_PX) onClose()
    else if (h < SHEET_COMPACT_PX) {
      setExpanded(false)
      setSheetH(null)
    } else setExpanded(true)
  }
  const toggle = () => {
    if (justDragged.current) {
      justDragged.current = false
      return
    }
    setSheetH(null)
    setExpanded((v) => !v)
  }
  const style: CSSProperties = sheetH !== null ? { height: sheetH, maxHeight: 'none' } : {}
  if (offset.x || offset.y) style.translate = `${offset.x}px ${offset.y}px`

  const bestDay = best && best.value >= 0.12 ? (best.date === today ? "aujourd'hui" : DAY.format(new Date(best.date))) : null
  const ranked = detail !== null && detail.score > 0.02

  return (
    <div
      ref={ref}
      className={`spot-card${expanded ? ' spot-card--open' : ''}${dragging ? ' spot-card--dragging' : ''}`}
      style={style}
      role="dialog"
      aria-label="Détail du coin"
    >
      <div className="spot-card__grip" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <button type="button" className="spot-card__handle" onClick={toggle} aria-expanded={expanded} aria-label={expanded ? 'Réduire la fiche' : 'Afficher le détail'} />
        <div className="spot-card__head">
          <button type="button" className="spot-card__head-main" onClick={toggle} aria-expanded={expanded} title="Glisser pour déplacer la fiche">
            <span className="spot-card__title">{name ?? 'Endroit choisi'}</span>
            <span className="spot-card__sub">
              {/* « Tous les cèpes » : le cèpe le plus probable ici. */}
              {detail?.bestSpecies ? choiceLabel(detail.bestSpecies) : choiceLabel(species)}
              {detail && (
                <span className="spot-card__badge">
                  {Math.round(detail.score * 100)}/100 · {scoreLabel(detail.score)}
                </span>
              )}
              {ranked && <span className="spot-card__rank">{rankShort(detail.regionRank)}</span>}
            </span>
          </button>
          <button type="button" className="spot-card__close" onClick={onClose} aria-label="Fermer">
            ×
          </button>
        </div>
      </div>

      <div className="spot-card__body">
        {loading && <p className="spot-card__muted">Analyse de l'endroit…</p>}
        {!loading && !detail && <p className="spot-card__muted">Hors de la zone étudiée (Midi-Pyrénées).</p>}

        {detail && !expanded && (
          <div className="spot-card__compact">
            <span className="spot-card__muted">
              {outlook
                ? outlook.headline
                : bestDay
                  ? `Meilleur jour : ${bestDay}`
                  : `Milieu ${Math.round(detail.habitat * 100)} %${milieuOnly ? '' : ` · météo ${Math.round(detail.pousse * 100)} %`}`}
            </span>
            <button type="button" className="spot-card__more" onClick={toggle}>
              Détails ▴
            </button>
          </div>
        )}

        {detail && expanded && (
          <>
            {outlook && (
              <div className={`spot-card__outlook spot-card__outlook--${outlook.tone}`}>
                <b>{outlook.headline}</b>
                <span>{outlook.detail}</span>
              </div>
            )}
            {series && <PotentialChart series={series} today={today} />}

            <div className="spot-card__stats">
              <div>
                <span>🌳 Milieu</span>
                <b>{Math.round(detail.habitat * 100)} %</b>
                <small>{detail.trees}</small>
              </div>
              <div>
                <span>🌧️ Pluie 15 j</span>
                <b>{detail.rain15} mm</b>
                <small>{detail.daysSinceRain !== null ? `épisode J-${detail.daysSinceRain}` : 'aucun épisode'}</small>
              </div>
              <div>
                <span>🌡️ 5 derniers j</span>
                <b>{detail.temp5.toFixed(0)} °C</b>
                <small>en moyenne</small>
              </div>
              <div>
                <span>⛰️ Altitude</span>
                <b>{detail.altitude} m</b>
                <small>{detail.ph !== null ? `sol pH ${detail.ph.toFixed(1)}` : ' '}</small>
              </div>
            </div>
            <p className={`spot-card__check spot-card__check--${detail.rainCheck.status}`}>{detail.rainCheck.short}</p>

            {detail.reasons.length > 0 && (
              <ul className="spot-card__reasons">
                {detail.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}

            <details className="spot-card__details">
              <summary>Mesures et calcul</summary>
              <p>
                {milieuOnly
                  ? `Indice du milieu ${Math.round(detail.habitat * 100)}/100 (sans la météo).`
                  : `Indice ${Math.round(detail.score * 100)}/100 = milieu ${Math.round(detail.habitat * 100)} % × météo ${Math.round(detail.pousse * 100)} %.`}
                {ranked && ` ${rankText(detail.regionRank, milieuOnly)}`}
              </p>
              <p>{detail.rainCheck.text}</p>
              {detail.nearby.length > 0 && (
                <ul>
                  {detail.nearby.map((m) => (
                    <li key={m.name}>
                      📏 {m.name} ({m.altitude !== undefined ? `${m.altitude} m, ` : ''}
                      {m.km} km) : {m.rainMm.toLocaleString('fr-FR')} mm en {m.days} j
                      {m.tminC !== null && `, mini ${m.tminC.toLocaleString('fr-FR')} °C (3 j)`}
                    </li>
                  ))}
                </ul>
              )}
              <p>
                Pluie et température : modèle météo, corrigé par les pluviomètres proches. Position {lat.toFixed(4)}, {lon.toFixed(4)}.
              </p>
            </details>

            <a className="spot-card__nav" href={nav} target="_blank" rel="noreferrer">
              🧭 Itinéraire
            </a>
            <p className="spot-card__muted spot-card__warn">Indicatif · respectez les propriétés privées et la réglementation.</p>
          </>
        )}
      </div>
    </div>
  )
}
