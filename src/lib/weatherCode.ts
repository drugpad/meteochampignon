// Codes météo WMO renvoyés par Open-Meteo (weather_code) — mapping simplifié
// vers un émoji + libellé court, largement suffisant pour l'usage visé
// (repérer un temps humide/sec, pas une appli météo grand public complète).
const WEATHER_CODES: Record<number, { emoji: string; label: string }> = {
  0: { emoji: '☀️', label: 'Ciel dégagé' },
  1: { emoji: '🌤️', label: 'Plutôt dégagé' },
  2: { emoji: '⛅', label: 'Partiellement nuageux' },
  3: { emoji: '☁️', label: 'Couvert' },
  45: { emoji: '🌫️', label: 'Brouillard' },
  48: { emoji: '🌫️', label: 'Brouillard givrant' },
  51: { emoji: '🌦️', label: 'Bruine légère' },
  53: { emoji: '🌦️', label: 'Bruine' },
  55: { emoji: '🌦️', label: 'Bruine dense' },
  56: { emoji: '🌧️', label: 'Bruine verglaçante' },
  57: { emoji: '🌧️', label: 'Bruine verglaçante forte' },
  61: { emoji: '🌧️', label: 'Pluie faible' },
  63: { emoji: '🌧️', label: 'Pluie' },
  65: { emoji: '🌧️', label: 'Pluie forte' },
  66: { emoji: '🌧️', label: 'Pluie verglaçante' },
  67: { emoji: '🌧️', label: 'Pluie verglaçante forte' },
  71: { emoji: '🌨️', label: 'Neige faible' },
  73: { emoji: '🌨️', label: 'Neige' },
  75: { emoji: '❄️', label: 'Neige forte' },
  77: { emoji: '🌨️', label: 'Neige en grains' },
  80: { emoji: '🌦️', label: 'Averses faibles' },
  81: { emoji: '🌧️', label: 'Averses' },
  82: { emoji: '⛈️', label: 'Averses violentes' },
  85: { emoji: '🌨️', label: 'Averses de neige faibles' },
  86: { emoji: '❄️', label: 'Averses de neige fortes' },
  95: { emoji: '⛈️', label: 'Orage' },
  96: { emoji: '⛈️', label: 'Orage + grêle' },
  99: { emoji: '⛈️', label: 'Orage violent + grêle' },
}

export function weatherCodeInfo(code: number): { emoji: string; label: string } {
  return WEATHER_CODES[code] ?? { emoji: '❓', label: 'Inconnu' }
}
