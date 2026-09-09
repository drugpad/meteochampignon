// Sélecteur de mode Prévision / Historique (voir spec) — même principe
// visuel que le sélecteur de fond de carte d'Unmask (petit panneau flottant).
import './ModeSwitch.css'
import type { AppMode } from '../types'

type Props = { mode: AppMode; onChange: (mode: AppMode) => void }

export function ModeSwitch({ mode, onChange }: Props) {
  return (
    <div className="mode-switch">
      <button
        type="button"
        className={mode === 'previsions' ? 'mode-switch__btn mode-switch__btn--active' : 'mode-switch__btn'}
        onClick={() => onChange('previsions')}
      >
        ☀️ Prévisions
      </button>
      <button
        type="button"
        className={mode === 'historique' ? 'mode-switch__btn mode-switch__btn--active' : 'mode-switch__btn'}
        onClick={() => onChange('historique')}
      >
        🕓 Historique
      </button>
    </div>
  )
}
