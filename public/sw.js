/*
 * Service worker de Météo Midi-Pyrénées : fonctionnement hors ligne « à la demande ».
 *
 * Il ne remplit JAMAIS lui-même le cache : la copie hors ligne est écrite uniquement par le
 * bouton « Enregistrer pour le hors ligne » (src/lib/offline.ts), dans le cache OFFLINE_CACHE.
 * Une copie enregistrée reste donc figée tant qu'on ne rappuie pas sur le bouton.
 * Ici, on se contente de la RELIRE :
 *  - en ligne, tout se passe comme avant (le réseau est toujours préféré pour les données) ;
 *  - sans réseau (ou réseau trop lent), la copie enregistrée prend le relais.
 */
const OFFLINE_CACHE = 'mc-offline-v1'
const DATA_HOSTS = ['raw.githubusercontent.com', 'cdn.jsdelivr.net'] // cartes de pluie
const TILE_HOST = 'data.geopf.fr' // fond Plan IGN
const SLOW_NETWORK_MS = 8000 // au-delà, on préfère la copie enregistrée (si elle existe)

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

async function fromOffline(request, ignoreSearch) {
  const cache = await caches.open(OFFLINE_CACHE)
  return cache.match(request, { ignoreSearch, ignoreVary: true })
}

// Copie d'abord (tuiles, ressources de l'appli : leurs URL ne changent pas de contenu), réseau sinon.
async function cacheFirst(request) {
  const cached = await fromOffline(request, false)
  return cached || fetch(request)
}

function fetchWithTimeout(request, ms) {
  if (!ms) return fetch(request)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timer))
}

// Réseau d'abord ; en cas d'échec (hors ligne, lenteur, erreur serveur), la copie enregistrée.
async function networkFirst(request, offlineKey) {
  const cached = offlineKey
    ? await fromOffline(new Request(offlineKey), false)
    : await fromOffline(request, true) // ignoreSearch : le « ?v=<date> » des cartes change à chaque génération
  try {
    const response = await fetchWithTimeout(request, cached ? SLOW_NETWORK_MS : 0)
    if (!response.ok && cached) return cached
    return response
  } catch (err) {
    if (cached) return cached
    throw err
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  if (url.hostname === TILE_HOST) {
    event.respondWith(cacheFirst(request))
    return
  }
  if (DATA_HOSTS.includes(url.hostname)) {
    event.respondWith(networkFirst(request))
    return
  }
  if (url.origin !== self.location.origin) return // Open-Meteo, OSM, etc. : inchangé

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, self.location.origin + '/index.html'))
  } else if (url.pathname === '/station-history.json') {
    event.respondWith(networkFirst(request))
  } else if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/champignons/')) {
    event.respondWith(cacheFirst(request))
  } else {
    event.respondWith(networkFirst(request)) // manifeste, icônes, favicon
  }
})
