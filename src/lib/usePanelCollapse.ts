// Sur mobile, un seul panneau à la fois : toucher la carte ou ouvrir une fiche replie les panneaux du haut
// (pluie, stations, coins), qui sinon s'empilent et cachent la carte (retour utilisateur : « des fois
// certaines fenêtres cachent tout »). Signal global simple : un événement sur window.
import { useEffect } from 'react'

const EVENT = 'mc-collapse-panels'
const isMobile = () => window.matchMedia('(max-width: 640px)').matches

export function collapsePanels(): void {
  if (isMobile()) window.dispatchEvent(new Event(EVENT))
}

export function usePanelCollapse(collapse: () => void): void {
  useEffect(() => {
    window.addEventListener(EVENT, collapse)
    return () => window.removeEventListener(EVENT, collapse)
  }, [collapse])
}
