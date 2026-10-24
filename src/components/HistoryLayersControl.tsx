// Mode Historique : 3 cases à cocher pour choisir les réseaux de stations affichés (bulles « cumul de pluie »).
// Le recouvrement coloré de pluie 24h reste indépendant (voir RainControls).
//
// Case 1 (Météo-France) : opérationnelle. Cases 2 (Infoclimat) et 3 (Netatmo) : branchées dès que la collecte
// côté serveur de ces réseaux est en place (clés d'API à créer, voir docs). Tant que c'est le cas, elles sont
// désactivées avec la mention « bientôt », pour ne jamais afficher de fausses données.
import { usePanelCollapse } from '../lib/usePanelCollapse'
import { useCallback, useState } from 'react'
import './HistoryLayersControl.css'

export type HistoryLayers = { meteofrance: boolean; infoclimat: boolean; netatmo: boolean }

const STORAGE_KEY = 'mc-history-layers'
const DEFAULT: HistoryLayers = { meteofrance: true, infoclimat: false, netatmo: false }

export function loadHistoryLayers(): HistoryLayers {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULT, ...(JSON.parse(raw) as Partial<HistoryLayers>) }
  } catch {
    // stockage indisponible : valeurs par défaut
  }
  return DEFAULT
}

type Props = {
  value: HistoryLayers
  onChange: (value: HistoryLayers) => void
  // Réseaux dont la collecte n'est pas encore disponible (pas de données) : case désactivée.
  disabled?: Partial<Record<keyof HistoryLayers, boolean>>
}

const ROWS: { key: keyof HistoryLayers; label: string; hint: string }[] = [
  { key: 'meteofrance', label: 'Météo-France', hint: 'cumul 3 jours' },
  { key: 'infoclimat', label: 'Infoclimat', hint: 'cumul 3 jours' },
  { key: 'netatmo', label: 'Netatmo', hint: 'cumul 3 jours' },
]

// Replié par défaut sur mobile (la carte d'abord), ouvert sur grand écran.
const START_COLLAPSED = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches

export function HistoryLayersControl({ value, onChange, disabled }: Props) {
  const [collapsed, setCollapsed] = useState(START_COLLAPSED)
  // Mobile : replié quand on touche la carte ou qu'une fiche s'ouvre (lib/usePanelCollapse.ts).
  usePanelCollapse(useCallback(() => setCollapsed(true), []))
  const shown = ROWS.filter(({ key }) => value[key] && !disabled?.[key]).length
  return (
    <div className={collapsed ? 'history-layers history-layers--collapsed' : 'history-layers'}>
      <button type="button" className="history-layers__title" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed}>
        <span>📍 Stations <span className="history-layers__count">{shown}/{ROWS.length}</span></span>
        <span className="history-layers__chevron">{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && ROWS.map(({ key, label, hint }) => {
        const off = disabled?.[key]
        return (
          <label key={key} className={off ? 'history-layers__row history-layers__row--off' : 'history-layers__row'}>
            <input
              type="checkbox"
              checked={value[key] && !off}
              disabled={off}
              onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
            />
            <span className="history-layers__label">{label}</span>
            <span className="history-layers__hint">{off ? 'bientôt' : hint}</span>
          </label>
        )
      })}
    </div>
  )
}
