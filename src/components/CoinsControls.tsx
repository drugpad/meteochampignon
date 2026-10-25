// Mode « Coins » : choix de l'espèce et du jour, légende, palmarès des meilleurs secteurs (voir lib/coins.ts).
import { usePanelCollapse } from '../lib/usePanelCollapse'
import { useCallback, useEffect, useRef, useState } from 'react'
import { COINS_LEGEND, SPECIES, scoreLabel, type PousseMeta, type Species } from '../lib/coins'
import { formatRelativeAge } from '../lib/formatRelativeAge'
import { moonPhase } from '../lib/moon'
import { useParisToday } from '../lib/useParisToday'
import './CoinsControls.css'

const DAY_FORMATTER = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric' })

export type NamedSpot = { lat: number; lon: number; score: number; name: string | null }

type Props = {
  species: Species
  onSpecies: (s: Species) => void
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
}

export type CoinsView = 'meteo' | 'milieu'

export function CoinsControls({ species, onSpecies, dayIndex, onDay, meta, status, error, onRetry, spots, onSelectSpot, view, onView, moon, onMoon }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  // Mobile : replié quand on touche la carte ou qu'une fiche s'ouvre (lib/usePanelCollapse.ts).
  usePanelCollapse(useCallback(() => setCollapsed(true), []))
  const [showTop, setShowTop] = useState(false)
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
  const sp = SPECIES.find((s) => s.key === species)!
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
          <div className="coins__view" role="radiogroup" aria-label="Affichage">
            {(
              [
                ['meteo', '🌦️ Avec la météo'],
                ['milieu', '🌳 Milieu seul'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={view === key}
                className={view === key ? 'coins__view-btn coins__view-btn--on' : 'coins__view-btn'}
                onClick={() => onView(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="coins__hint">
            {view === 'milieu'
              ? 'Les meilleurs coins dans l’absolu : arbres, ouverture du bois, sol, altitude et exposition, sans tenir compte de la météo.'
              : 'Le milieu, multiplié par la pluie tombée et la météo prévue : où ça pousse en ce moment.'}
          </p>
          {(['cepe', 'autre'] as const).map((group) => (
            <div key={group} className="coins__group" role="radiogroup" aria-label={group === 'cepe' ? 'Cèpes' : 'Autres espèces'}>
              <div className="coins__group-title">{group === 'cepe' ? 'Cèpes' : 'Autres'}</div>
              <div className={group === 'cepe' ? 'coins__chips' : 'coins__chips coins__chips--3'}>
                {SPECIES.filter((s) => s.group === group).map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    role="radio"
                    aria-checked={s.key === species}
                    className={s.key === species ? 'coins__chip coins__chip--on' : 'coins__chip'}
                    onClick={() => onSpecies(s.key)}
                  >
                    {s.short}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="coins__hint">{sp.hint}</p>

          {meta && view === 'meteo' && (
            <div className="coins__days">
              {meta.days.map((d, i) =>
                // Jours 8 à 15 (AIFS seul, peu fiables) : seulement dans la courbe de la fiche, pas en carte.
                d.date < today || d.reliable === false ? null : (
                  <button
                    key={d.date}
                    type="button"
                    className={i === dayIndex ? 'coins__day coins__day--on' : 'coins__day'}
                    onClick={() => onDay(i)}
                  >
                    {dayLabel(d.date)}
                  </button>
                ),
              )}
            </div>
          )}

          {status === 'loading' && <div className="coins__status">Calcul des coins…</div>}
          {status === 'error' && (
            <>
              <div className="coins__error">{error ?? 'Coins indisponibles pour le moment.'}</div>
              <button type="button" className="coins__retry" onClick={onRetry}>
                Réessayer
              </button>
            </>
          )}

          <div className="coins__legend" aria-hidden="true">
            {COINS_LEGEND.map((l) => (
              <span key={l.label} style={{ background: l.color }} title={l.label} />
            ))}
          </div>
          <div className="coins__legend-labels">
            <span>possible</span>
            <span>excellent</span>
          </div>
          <div className="coins__zone-legend">
            <span className="coins__zone-swatch" aria-hidden="true" />
            Milieu favorable à l'espèce (quelle que soit la météo)
          </div>

          {status === 'ready' && (
            <button type="button" className="coins__top-toggle" onClick={() => setShowTop((v) => !v)} aria-expanded={showTop}>
              🏆 {view === 'milieu' ? 'Les 10 meilleurs milieux' : 'Les 10 meilleurs coins'} {showTop ? '▾' : '▸'}
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

          <label className="coins__moon">
            <input type="checkbox" checked={moon} onChange={(e) => onMoon(e.target.checked)} />
            <span>
              🌙 Lune <small>(croyance populaire)</small>
              {moon && day && view === 'meteo' && (
                <small className="coins__moon-phase">
                  {moonPhase(day.date).emoji} {moonPhase(day.date).label} : {moonPhase(day.date).effect}. Selon la tradition des
                  cueilleurs, sans preuve scientifique.
                </small>
              )}
              {moon && view === 'milieu' && <small className="coins__moon-phase">Sans effet en « Milieu seul » (pas de pousse à moduler).</small>}
            </span>
          </label>

          {meta && (
            <p className="coins__note">
              {view === 'milieu' ? (
                'Indice du milieu : essences (BD Forêt IGN), densité des arbres (Copernicus 2024), sol, altitude, exposition.'
              ) : (
                <>
                  Indice : milieu × météo (pluie tombée, corrigée par les pluviomètres, et prévisions). Calculé{' '}
                  {formatRelativeAge(new Date(meta.generatedAt).getTime())}.
                  {meta.history.missing.length > 3 && ` Historique météo incomplet (${meta.history.missing.length} jours manquants).`}
                </>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
