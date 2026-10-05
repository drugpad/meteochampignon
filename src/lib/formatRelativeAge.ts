// Vrai si l'instant ISO est plus ancien que `hours` heures. Fonction à part
// plutôt qu'un Date.now() dans le rendu d'un composant (appel impur, signalé
// par le lint).
export function isOlderThanHours(iso: string, hours: number, now = Date.now()): boolean {
  return now - new Date(iso).getTime() > hours * 3600e3
}

// Âge relatif d'une donnée mise en cache (cartes de pluie, voir
// RainControls.tsx / ForecastRainControls.tsx) — le cron GitHub saute
// souvent des créneaux, donc l'heure absolue seule ("Actualisé à 10:39") ne
// dit pas d'un coup d'œil si c'est frais ou vieux de plusieurs heures ;
// l'âge relatif comble ça.
export function formatRelativeAge(fetchedAt: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - fetchedAt) / 60000))
  if (minutes < 1) return "à l'instant"
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `il y a ${hours}h`
  const days = Math.floor(hours / 24)
  return `il y a ${days}j`
}
