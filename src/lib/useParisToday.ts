// « Aujourd'hui » et « demain » à l'heure de Paris, tenus À JOUR : un onglet laissé ouvert après minuit
// affichait sinon toujours la veille (boutons « Auj. »/« Dem. » de la carte de pluie décalés d'un jour,
// jour sélectionné déjà passé) jusqu'au rechargement de la page.
//
// Le minuteur de l'onglet est ralenti ou suspendu quand l'onglet est en arrière-plan (surtout sur
// téléphone) : on revérifie donc aussi au retour de l'utilisateur sur l'onglet.
import { useEffect, useState } from 'react'
import { todayParisKey, tomorrowParisKey } from './rainMaps'

type ParisDays = { today: string; tomorrow: string }

function currentDays(): ParisDays {
  const now = new Date()
  return { today: todayParisKey(now), tomorrow: tomorrowParisKey(now) }
}

export function useParisToday(): ParisDays {
  const [days, setDays] = useState(currentDays)

  useEffect(() => {
    // Ne change l'état (donc ne refait un rendu) que si le jour a réellement changé.
    const refresh = () => setDays((prev) => (prev.today === todayParisKey() ? prev : currentDays()))
    const timer = window.setInterval(refresh, 60 * 1000)
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  return days
}
