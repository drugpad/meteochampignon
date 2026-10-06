// Navigation de la page « Champignons » (MushroomGuide.tsx) branchée sur
// l'historique du navigateur : le bouton retour du téléphone ramène de la
// fiche à la liste puis à la carte, au lieu de quitter l'appli.
import { useCallback, useEffect, useState } from 'react'

/** null = page fermée, 'list' = liste, sinon id de l'espèce affichée. */
export type GuideView = null | 'list' | string

const HISTORY_KEY = 'champignons'

function viewFromHistory(state: unknown): GuideView {
  const value = (state as Record<string, unknown> | null)?.[HISTORY_KEY]
  return typeof value === 'string' ? value : null
}

export function useMushroomGuide() {
  const [view, setView] = useState<GuideView>(() => viewFromHistory(window.history.state))

  useEffect(() => {
    const onPop = (event: PopStateEvent) => setView(viewFromHistory(event.state))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const go = useCallback((next: string) => {
    window.history.pushState({ [HISTORY_KEY]: next }, '')
    setView(next)
  }, [])

  return {
    view,
    open: useCallback(() => go('list'), [go]),
    openSpecies: go,
    back: useCallback(() => window.history.back(), []),
  }
}
