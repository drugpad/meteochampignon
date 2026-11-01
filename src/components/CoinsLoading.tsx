// Pastille animée « Calcul des coins… » au centre de la carte, tant que la carte des coins se calcule ou que
// ses tuiles fines se dessinent (01/11/2026, demande utilisateur : « parfois ça met du temps, j'aimerais savoir si
// c'est en cours »). Ne bloque pas la carte (pointer-events: none).
import './CoinsLoading.css'

export function CoinsLoading({ text }: { text: string }) {
  return (
    <div className="coins-loading" role="status" aria-live="polite">
      <span className="coins-loading__spinner" aria-hidden="true" />
      {text}
    </div>
  )
}
