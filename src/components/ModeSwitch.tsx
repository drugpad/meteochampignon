// Sélecteur de mode Carte / Prévisions / Historique (voir spec) — même principe
// visuel que le sélecteur de fond de carte d'Unmask (petit panneau flottant).
// « Carte » : le fond seul, sans couche météo (pour marcher avec les sentiers et le GPS).
import './ModeSwitch.css'
import type { AppMode } from '../types'

type Props = { mode: AppMode; onChange: (mode: AppMode) => void }

const MODES: { key: AppMode; icon: string; label: string }[] = [
  { key: 'carte', icon: '🗺️', label: 'Carte' },
  { key: 'previsions', icon: '☀️', label: 'Prévisions' },
  { key: 'historique', icon: '🕓', label: 'Historique' },
]

export function ModeSwitch({ mode, onChange }: Props) {
  return (
    <div className="mode-switch" role="tablist">
      {MODES.map(({ key, icon, label }) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={mode === key}
          className={mode === key ? 'mode-switch__btn mode-switch__btn--active' : 'mode-switch__btn'}
          onClick={() => onChange(key)}
        >
          {icon} {label}
        </button>
      ))}
    </div>
  )
}
