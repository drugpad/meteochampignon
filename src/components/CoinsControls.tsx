// Mode « Coins » : choix de l'espèce et du jour, légende, palmarès des meilleurs secteurs (voir lib/coins.ts).
import { usePanelCollapse } from '../lib/usePanelCollapse'
import { useCallback, useEffect, useRef, useState } from 'react'
import { COINS_LEGEND, SPECIES, scoreLabel, type PousseMeta, type Species } from '../lib/coins'
import { formatRelativeAge } from '../lib/formatRelativeAge'
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
}

export function CoinsControls({ species, onSpecies, dayIndex, onDay, meta, status, error, onRetry, spots, onSelectSpot }: Props) {
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
          {day && <span className="coins__current"> · {dayLabel(day.date)}</span>}
        </span>
        <span className="coins__chevron">{collapsed ? '▸' : '▾'}</span>
      </button>

      {!collapsed && (
        <div className="coins__body">
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

          {meta && (
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
              🏆 Les 10 meilleurs coins {showTop ? '▾' : '▸'}
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

          {meta && (
            <p className="coins__note">
              Indicatif : milieu (forêts IGN, sol, relief) × météo (pluie, températures). Calculé{' '}
              {formatRelativeAge(new Date(meta.generatedAt).getTime())}.
              {meta.history.missing.length > 3 && ` Historique météo incomplet (${meta.history.missing.length} jours manquants).`}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
