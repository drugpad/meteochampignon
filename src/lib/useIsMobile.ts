// Même seuil que les media queries mobiles existantes (SearchBar.css,
// RainControls.css, ForecastPanel.css) — centralisé ici pour les cas où le
// choix mobile/desktop se fait en JS (quel composant rendre), pas juste en
// CSS (à quoi il ressemble).
import { useEffect, useState } from 'react'

const MOBILE_QUERY = '(max-width: 640px)'

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches)

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY)
    const handleChange = () => setIsMobile(mql.matches)
    mql.addEventListener('change', handleChange)
    return () => mql.removeEventListener('change', handleChange)
  }, [])

  return isMobile
}
