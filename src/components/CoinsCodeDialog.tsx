// Fenêtre de saisie du code d'accès au mode « Coins » (voir lib/coinsLock.ts).
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { tryUnlockCoins } from '../lib/coinsLock'
import './CoinsCodeDialog.css'

type Props = { onUnlocked: () => void; onCancel: () => void }

export function CoinsCodeDialog({ onUnlocked, onCancel }: Props) {
  const [code, setCode] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const ok = await tryUnlockCoins(code)
    setBusy(false)
    if (ok) onUnlocked()
    else {
      setError(true)
      setCode('')
      inputRef.current?.focus()
    }
  }

  return createPortal(
    <div className="coins-code" role="presentation" onClick={onCancel}>
      <form className="coins-code__card" role="dialog" aria-label="Code d'accès" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
        <div className="coins-code__icon" aria-hidden="true">
          🎯
        </div>
        <h2>Coins à champignons</h2>
        <p>Entrez le code d'accès. Il sera retenu sur cet appareil.</p>
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={12}
          value={code}
          onChange={(e) => {
            setCode(e.target.value)
            setError(false)
          }}
          aria-label="Code d'accès"
          aria-invalid={error}
          className={error ? 'coins-code__input coins-code__input--error' : 'coins-code__input'}
        />
        {error && <div className="coins-code__error">Code incorrect.</div>}
        <div className="coins-code__actions">
          <button type="button" className="coins-code__cancel" onClick={onCancel}>
            Annuler
          </button>
          <button type="submit" className="coins-code__ok" disabled={busy || code.trim() === ''}>
            Entrer
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
