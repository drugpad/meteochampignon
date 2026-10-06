// Bouton « Hors ligne » : enregistre l'appli, les cartes, les stations, le guide et le fond de carte
// dans le navigateur pour l'utiliser sans réseau (voir lib/offline.ts et public/sw.js).
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  canInstall,
  deleteOffline,
  downloadOffline,
  isIos,
  isOnline,
  isStandalone,
  LEVELS,
  offlineSupported,
  promptInstall,
  readOfflineInfo,
  subscribe,
  type OfflineInfo,
  type OfflineLevel,
  type OfflineProgress,
} from '../lib/offline'
import './OfflinePanel.css'

const formatMo = (bytes: number) => `${Math.max(1, Math.round(bytes / 1048576))} Mo`
const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export function OfflinePanel() {
  const online = useSyncExternalStore(subscribe, isOnline)
  const installable = useSyncExternalStore(subscribe, canInstall)
  const [open, setOpen] = useState(false)
  const [level, setLevel] = useState<OfflineLevel>('standard')
  const [info, setInfo] = useState<OfflineInfo | null>(() => readOfflineInfo())
  const [progress, setProgress] = useState<OfflineProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const running = progress !== null

  // Le service worker ne tourne qu'en production (build Vercel) : en développement, rien à proposer.
  const supported = offlineSupported()

  useEffect(() => () => abortRef.current?.abort(), [])

  const start = async () => {
    setError(null)
    const controller = new AbortController()
    abortRef.current = controller
    setProgress({ done: 0, total: 1, stage: 'Préparation' })
    try {
      setInfo(await downloadOffline(level, setProgress, controller.signal))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setInfo(readOfflineInfo())
    } finally {
      setProgress(null)
      abortRef.current = null
    }
  }

  const remove = async () => {
    await deleteOffline()
    setInfo(null)
  }

  const pct = progress ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0

  return (
    <div className="offline">
      <button
        type="button"
        className={`offline__open${online ? '' : ' offline__open--off'}`}
        onClick={() => setOpen((o) => !o)}
        aria-label="Hors ligne"
        aria-expanded={open}
      >
        {online ? '📥' : '📴'}
        <span className="offline__label">{online ? ' Hors ligne' : ' Sans réseau'}</span>
      </button>

      {open && (
        <div className="offline__card" role="dialog" aria-label="Utiliser sans réseau">
          <div className="offline__head">
            <strong>Utiliser sans réseau</strong>
            <button type="button" className="offline__close" onClick={() => setOpen(false)} aria-label="Fermer">
              ×
            </button>
          </div>

          {!online && (
            <p className="offline__note offline__note--warn">
              Pas de réseau : l'appli utilise la copie enregistrée
              {info ? ` le ${formatWhen(info.savedAt)}` : " (aucune : enregistre-la quand tu as du réseau)"}.
            </p>
          )}

          {!supported ? (
            <p className="offline__note">Ce navigateur (ou ce mode de navigation) ne permet pas le hors ligne.</p>
          ) : (
            <>
              <p className="offline__note">
                Enregistre sur cet appareil : l'appli, les cartes de pluie, les stations, le guide des champignons
                (photos comprises) et le fond de carte <b>Plan IGN</b>. À faire avec du réseau (idéalement en Wi-Fi).
              </p>

              <fieldset className="offline__levels" disabled={running}>
                {(Object.keys(LEVELS) as OfflineLevel[]).map((key) => (
                  <label key={key} className="offline__level">
                    <input type="radio" name="offline-level" checked={level === key} onChange={() => setLevel(key)} />
                    <span>
                      <b>{LEVELS[key].label}</b> — environ {LEVELS[key].approxMo} Mo
                      <small>{LEVELS[key].hint}</small>
                    </span>
                  </label>
                ))}
              </fieldset>

              {running ? (
                <div className="offline__progress">
                  <div className="offline__bar">
                    <i style={{ width: `${pct}%` }} />
                  </div>
                  <div className="offline__row">
                    <span>
                      {progress.stage} — {pct} %
                    </span>
                    <button type="button" className="offline__link" onClick={() => abortRef.current?.abort()}>
                      Annuler
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="offline__primary" onClick={start} disabled={!online}>
                  {info ? 'Mettre à jour la copie' : 'Enregistrer pour le hors ligne'}
                </button>
              )}

              {error && <p className="offline__note offline__note--error">{error}</p>}

              {info && !running && (
                <div className="offline__saved">
                  <div>
                    ✓ Copie du <b>{formatWhen(info.savedAt)}</b> — {LEVELS[info.level].label}, {formatMo(info.bytes)}
                  </div>
                  <small>
                    Cartes de pluie enregistrées : {info.mapsFetchedAt ? formatWhen(info.mapsFetchedAt) : '—'}. La copie ne
                    se met à jour que si tu rappuies sur le bouton.
                  </small>
                  <button type="button" className="offline__link" onClick={remove}>
                    Supprimer la copie
                  </button>
                </div>
              )}
            </>
          )}

          {installable && (
            <button type="button" className="offline__secondary" onClick={() => void promptInstall()}>
              📲 Installer l'appli sur l'écran d'accueil
            </button>
          )}
          {!installable && isIos() && !isStandalone() && (
            <p className="offline__note offline__note--warn">
              <b>Sur iPhone</b> : installe d'abord l'appli (bouton Partager, puis « Sur l'écran d'accueil »), ouvre-la
              depuis son icône, <b>puis</b> enregistre la copie depuis là. Une copie faite dans Safari n'est pas
              partagée avec l'appli installée, et Safari l'efface après 7 jours sans visite.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
