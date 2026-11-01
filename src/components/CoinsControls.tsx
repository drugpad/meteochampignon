// Mode « Coins » : choix de l'espèce et du jour, légende, palmarès des meilleurs secteurs (voir lib/coins.ts).
// Mise en page revue le 01/11/2026 (« long et mal organisé ») : Espèce, Quand ? (le « Milieu seul » est un choix
// parmi les jours), légende sur une ligne, palmarès, puis les réglages secondaires repliés dans « Options ».
import { usePanelCollapse } from '../lib/usePanelCollapse'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CHOICES, COINS_LEGEND, scoreLabel, type CoinsChoice, type PousseMeta } from '../lib/coins'
import { formatRelativeAge } from '../lib/formatRelativeAge'
import { moonPhase } from '../lib/moon'
import { useParisToday } from '../lib/useParisToday'
import './CoinsControls.css'

const DAY_FORMATTER = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric' })

export type NamedSpot = { lat: number; lon: number; score: number; name: string | null }

type Props = {
  species: CoinsChoice
  onSpecies: (s: CoinsChoice) => void
  dayIndex: number
  onDay: (i: number) => void
  meta: PousseMeta | null
  status: 'loading' | 'ready' | 'error'
  error: string | null
  onRetry: () => void
  spots: NamedSpot[]
  onSelectSpot: (s: NamedSpot) => void
  // « meteo » : milieu x météo de pousse du jour choisi ; « milieu » : le milieu seul (meilleurs coins dans l'absolu).
  view: CoinsView
  onView: (v: CoinsView) => void
  // Clin d'œil « lune » (croyance populaire, lib/moon.ts), désactivé par défaut.
  moon: boolean
  onMoon: (on: boolean) => void
  // Couche des trouvailles réelles (GBIF) ; obsCount = nombre de points pour l'espèce (null tant que non chargé).
  observations: boolean
  onObservations: (on: boolean) => void
  obsCount: number | null
  // Opacité de la carte des coins (0,2 à 1), réglée par un curseur.
  opacity: number
  onOpacity: (v: number) => void
}

export type CoinsView = 'meteo' | 'milieu'

export function CoinsControls({ species, onSpecies, dayIndex, onDay, meta, status, error, onRetry, spots, onSelectSpot, view, onView, moon, onMoon, observations, onObservations, obsCount, opacity, onOpacity }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  // Mobile : replié quand on touche la carte ou qu'une fiche s'ouvre (lib/usePanelCollapse.ts).
  usePanelCollapse(useCallback(() => setCollapsed(true), []))
  const [showTop, setShowTop] = useState(false)
  const [showOptions, setShowOptions] = useState(false)
  // Sur mobile, le panneau se replie une fois les coins calculés (une seule fois, sinon impossible de le
  // rouvrir) : il cachait la moitié de la carte.
  const autoCollapsed = useRef(false)
  useEffect(() => {
    if (status === 'ready' && !autoCollapsed.current) {
      autoCollapsed.current = true
      if (window.matchMedia('(max-width: 640px)').matches) setCollapsed(true)
    }
  }, [status])
  const { today, tomorrow } = useParisToday()
  const dayLabel = (date: string) => (date === today ? 'Auj.' : date === tomorrow ? 'Dem.' : DAY_FORMATTER.format(new Date(date)))
  const sp = CHOICES.find((s) => s.key === species)!
  const day = meta?.days[dayIndex]

  return (
    <div className={collapsed ? 'coins coins--collapsed' : 'coins'}>
      <button type="button" className="coins__header" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed}>
        <span>
          🎯 {sp.label}
          {view === 'milieu' ? <span className="coins__current"> · milieu</span> : day && <span className="coins__current"> · {dayLabel(day.date)}</span>}
        </span>
        <span className="coins__chevron">{collapsed ? '▸' : '▾'}</span>
      </button>

      {!collapsed && (
        <div className="coins__body">
          {(['cepe', 'autre'] as const).map((group) => (
            <div key={group} className="coins__chips" role="radiogroup" aria-label={group === 'cepe' ? 'Cèpes' : 'Autres espèces'}>
              {group === 'cepe' && <span className="coins__row-label">Cèpe</span>}
              {CHOICES.filter((s) => s.group === group).map((s) => (
                <button
                  key={s.key}
                  type="button"
                  role="radio"
                  aria-checked={s.key === species}
                  className={s.key === species ? 'coins__chip coins__chip--on' : 'coins__chip'}
                  onClick={() => onSpecies(s.key)}
                >
                  {s.key === 'cepes' ? 'tous' : s.short}
                </button>
              ))}
            </div>
          ))}
          <p className="coins__hint">{sp.hint}</p>

          <div className="coins__section-title">Quand ?</div>
          <div className="coins__days" role="radiogroup" aria-label="Jour ou milieu seul">
            {meta?.days.map((d, i) =>
              // Jours 8 à 15 (AIFS seul, peu fiables) : seulement dans la courbe de la fiche, pas en carte.
              d.date < today || d.reliable === false ? null : (
                <button
                  key={d.date}
                  type="button"
                  role="radio"
                  aria-checked={view === 'meteo' && i === dayIndex}
                  className={view === 'meteo' && i === dayIndex ? 'coins__day coins__day--on' : 'coins__day'}
                  onClick={() => {
                    onView('meteo')
                    onDay(i)
                  }}
                >
                  {dayLabel(d.date)}
                </button>
              ),
            )}
            <button
              type="button"
              role="radio"
              aria-checked={view === 'milieu'}
              className={view === 'milieu' ? 'coins__day coins__day--milieu coins__day--on' : 'coins__day coins__day--milieu'}
              onClick={() => onView('milieu')}
              title="Le milieu seul, sans tenir compte de la météo"
            >
              🌳 Milieu
            </button>
          </div>
          <p className="coins__hint coins__hint--muted">
            {view === 'milieu' ? 'Les meilleurs bois dans l’absolu, sans la météo.' : 'Milieu × pluie tombée et prévue : où ça pousse ce jour-là.'}
          </p>

          {status === 'loading' && <div className="coins__status">Calcul des coins…</div>}
          {status === 'error' && (
            <>
              <div className="coins__error">{error ?? 'Coins indisponibles pour le moment.'}</div>
              <button type="button" className="coins__retry" onClick={onRetry}>
                Réessayer
              </button>
            </>
          )}

          <div className="coins__legend-row">
            <span>possible</span>
            <div className="coins__legend" aria-hidden="true">
              {COINS_LEGEND.map((l) => (
                <span key={l.label} style={{ background: l.color }} title={l.label} />
              ))}
            </div>
            <span>excellent</span>
          </div>
          <div className="coins__zone-legend">
            <span className="coins__zone-swatch" aria-hidden="true" />
            Bon milieu (même sans pousse)
          </div>

          {status === 'ready' && (
            <button type="button" className="coins__top-toggle" onClick={() => setShowTop((v) => !v)} aria-expanded={showTop}>
              <span>🏆 {view === 'milieu' ? 'Les 10 meilleurs milieux' : 'Les 10 meilleurs coins'}</span>
              <span className="coins__chevron">{showTop ? '▾' : '▸'}</span>
            </button>
          )}
          {status === 'ready' && showTop && (
            <ol className="coins__top">
              {spots.length === 0 && <li className="coins__top-empty">Aucun coin favorable ce jour-là (trop sec, trop froid ou hors saison).</li>}
              {spots.map((s, i) => (
                <li key={`${s.lat},${s.lon}`}>
                  <button
                    type="button"
                    onClick={() => {
                      // Sur mobile, le panneau replié laisse voir la fiche et le coin sur la carte.
                      if (window.matchMedia('(max-width: 640px)').matches) setCollapsed(true)
                      onSelectSpot(s)
                    }}
                  >
                    <span className="coins__rank">{i + 1}</span>
                    <span className="coins__spot-name">{s.name ?? `${s.lat.toFixed(3)}, ${s.lon.toFixed(3)}`}</span>
                    <span className="coins__spot-score">{scoreLabel(s.score)}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}

          {meta && meta.history.missing.length > 3 && view === 'meteo' && (
            <p className="coins__warning">⚠ Historique météo incomplet ({meta.history.missing.length} jours manquants).</p>
          )}

          <button type="button" className="coins__options-toggle" onClick={() => setShowOptions((v) => !v)} aria-expanded={showOptions}>
            <span>
              ⚙️ Options
              {/* Rappel des options actives, panneau d'options replié. */}
              {!showOptions && (observations || moon || opacity < 1) && (
                <span className="coins__options-active">
                  {' ·'}
                  {observations && ' 📍'}
                  {moon && ' 🌙'}
                  {opacity < 1 && ` ${Math.round(opacity * 100)} %`}
                </span>
              )}
            </span>
            <span className="coins__chevron">{showOptions ? '▾' : '▸'}</span>
          </button>
          {showOptions && (
            <div className="coins__options">
              <label className="coins__opacity">
                <span>Opacité</span>
                <input
                  type="range"
                  min={20}
                  max={100}
                  step={5}
                  value={Math.round(opacity * 100)}
                  onChange={(e) => onOpacity(Number(e.target.value) / 100)}
                  aria-label="Opacité de la carte des coins"
                />
                <span className="coins__opacity-value">{Math.round(opacity * 100)} %</span>
              </label>

              <label className="coins__check">
                <input type="checkbox" checked={observations} onChange={(e) => onObservations(e.target.checked)} />
                <span>
                  📍 Observations réelles <small>(GBIF)</small>
                  {observations && (
                    <small className="coins__check-detail">
                      {obsCount === null ? 'Chargement…' : `${obsCount} trouvailles publiques (points blancs).`} Pas de point ≠ pas de champignons.
                    </small>
                  )}
                </span>
              </label>

              <label className="coins__check">
                <input type="checkbox" checked={moon} onChange={(e) => onMoon(e.target.checked)} />
                <span>
                  🌙 Lune <small>(croyance, non prouvée)</small>
                  {moon && day && view === 'meteo' && (
                    <small className="coins__check-detail">
                      {moonPhase(day.date).emoji} {moonPhase(day.date).label} : {moonPhase(day.date).effect}.
                    </small>
                  )}
                  {moon && view === 'milieu' && <small className="coins__check-detail">Sans effet en « Milieu ».</small>}
                </span>
              </label>

              {meta && (
                <p className="coins__note">
                  {view === 'milieu'
                    ? 'Milieu : essences (BD Forêt IGN), densité des arbres (Copernicus 2024), roche (BRGM), sol, altitude, pente ; règles vérifiées sur des observations réelles (GBIF).'
                    : `Indice = milieu × météo (pluie tombée corrigée par les pluviomètres, prévisions). Calculé ${formatRelativeAge(new Date(meta.generatedAt).getTime())}.`}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
