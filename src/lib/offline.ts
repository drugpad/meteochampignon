// Mode hors ligne « à la demande » : le bouton enregistre dans le navigateur (Cache API)
// tout ce qu'il faut pour utiliser l'appli sans réseau — l'appli elle-même, les cartes de pluie,
// l'historique des stations, les photos du guide des champignons et le fond de carte Plan IGN.
// Le service worker (public/sw.js) ne fait que RELIRE cette copie quand le réseau manque : elle
// reste figée tant qu'on ne rappuie pas sur le bouton.
//
// Fond de carte : le Plan IGN (Géoplateforme, données ouvertes), PAS OpenStreetMap — la politique
// d'usage des tuiles OSM interdit le téléchargement en masse pour un usage hors ligne.
import { PHOTOS } from '../data/champignonPhotos'
import { fetchRainMapsMeta, rainMapsUrls } from './rainMaps'
import { REGION_BOUNDS } from './regionOutline'

export const OFFLINE_CACHE = 'mc-offline-v1' // même nom que dans public/sw.js
const INFO_KEY = 'mc-offline-info'

export const IGN_PLAN_URL =
  'https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png'

// Poids MESURÉ le 06/10/2026 : zoom ≤ 11 = 756 tuiles = 12 Mo (≈ 17 Ko par tuile en moyenne, les
// zones rurales sont bien plus légères que les villes) ; zoom ≤ 12 ≈ 2 300 tuiles, zoom ≤ 13 ≈ 8 500.
export type OfflineLevel = 'standard' | 'detaille' | 'fin'
export const LEVELS: Record<OfflineLevel, { label: string; maxZoom: number; approxMo: number; hint: string }> = {
  standard: { label: 'Standard', maxZoom: 11, approxMo: 15, hint: "zoom jusqu'à la vallée / la ville (≈ 20 s)" },
  detaille: { label: 'Détaillé', maxZoom: 12, approxMo: 55, hint: "zoom jusqu'au village (≈ 1 min)" },
  fin: { label: 'Fin', maxZoom: 13, approxMo: 190, hint: "zoom jusqu'aux chemins (≈ 3 à 4 min, en Wi-Fi)" },
}
const MIN_ZOOM = 7
const AVG_TILE_BYTES = 24 * 1024 // marge au-dessus de la moyenne mesurée (17 Ko), pour le test de place
// Requêtes en parallèle vers la Géoplateforme. Débit mesuré le 06/10/2026 (tuiles de 20 à 90 Ko, le
// délai de réponse domine) : 6 → 17 tuiles/s, 12 → 31, 24 → 60, 48 → 63 (et un échec). 20 = presque le
// plafond, sans dépasser ce que fait un navigateur qui affiche une grande carte.
const CONCURRENCY = 20
const MAX_TILE_FAILURES_RATIO = 0.01 // au-delà de 1 % de tuiles manquantes, la copie est déclarée incomplète

export type OfflineInfo = {
  savedAt: string // ISO
  level: OfflineLevel
  maxZoom: number
  files: number
  bytes: number
  mapsFetchedAt: string | null // date de génération des cartes de pluie enregistrées
}

export type OfflineProgress = { done: number; total: number; stage: string }

// ---------------------------------------------------------------------------------------------
export function offlineSupported(): boolean {
  return typeof caches !== 'undefined' && 'serviceWorker' in navigator
}

export function readOfflineInfo(): OfflineInfo | null {
  try {
    const raw = localStorage.getItem(INFO_KEY)
    return raw ? (JSON.parse(raw) as OfflineInfo) : null
  } catch {
    return null
  }
}

function writeOfflineInfo(info: OfflineInfo | null) {
  try {
    if (info) localStorage.setItem(INFO_KEY, JSON.stringify(info))
    else localStorage.removeItem(INFO_KEY)
  } catch {
    // stockage indisponible (navigation privée) : la copie reste utilisable, seul le récapitulatif manque
  }
}

export async function deleteOffline(): Promise<void> {
  if (typeof caches !== 'undefined') await caches.delete(OFFLINE_CACHE)
  writeOfflineInfo(null)
}

// ---------------------------------------------------------------------------------------------
// Tuiles de la région (projection Web Mercator, même grille que Leaflet).
const lonToX = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z)
const latToY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z)
}

export function tileUrls(maxZoom: number): string[] {
  const b = REGION_BOUNDS.pad(0.03)
  const urls: string[] = []
  for (let z = MIN_ZOOM; z <= maxZoom; z++) {
    const x0 = lonToX(b.getWest(), z)
    const x1 = lonToX(b.getEast(), z)
    const y0 = latToY(b.getNorth(), z)
    const y1 = latToY(b.getSouth(), z)
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        urls.push(IGN_PLAN_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)))
      }
    }
  }
  return urls
}

// ---------------------------------------------------------------------------------------------
const abs = (path: string) => new URL(path, location.origin).href

// Erreur HTTP avec son code : un 404 sur une tuile veut dire « pas de tuile ici » (mer, hors couverture),
// pas une panne.
class HttpError extends Error {
  status: number
  constructor(status: number, url: string) {
    super(`HTTP ${status} pour ${url}`)
    this.status = status
  }
}

async function store(cache: Cache, url: string, init?: RequestInit): Promise<number> {
  const res = await fetch(url, init)
  if (!res.ok) throw new HttpError(res.status, url)
  const size = (await res.clone().arrayBuffer()).byteLength
  await cache.put(url, res)
  return size
}

async function runPool<T>(items: T[], worker: (item: T) => Promise<void>, signal: AbortSignal) {
  let next = 0
  const lanes = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      if (signal.aborted) return
      await worker(items[next++])
    }
  })
  await Promise.all(lanes)
}

// Ressources de l'appli : index.html, ses scripts/feuilles de style, et tout ce que ceux-ci
// référencent dans /assets/ (icônes Leaflet, polices…). L'appli n'ayant qu'un bundle (pas de
// chargement différé), cela suffit à la faire démarrer sans réseau.
async function discoverShell(cache: Cache): Promise<{ urls: string[]; bytes: number }> {
  let bytes = 0
  const found = new Set<string>()
  const indexRes = await fetch(abs('/index.html'), { cache: 'reload' })
  if (!indexRes.ok) throw new Error(`index.html introuvable (HTTP ${indexRes.status})`)
  const html = await indexRes.clone().text()
  bytes += (await indexRes.clone().arrayBuffer()).byteLength
  await cache.put(abs('/index.html'), indexRes)

  for (const m of html.matchAll(/(?:src|href)="(\/[^"]+)"/g)) found.add(abs(m[1]))
  for (const p of ['/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/favicon.svg']) {
    found.add(abs(p))
  }
  const assetRx = /\/assets\/[A-Za-z0-9_.-]+\.(?:png|svg|jpe?g|webp|gif|woff2?|css|js)/g
  for (const url of [...found]) {
    if (!/\.(js|css)$/.test(new URL(url).pathname)) continue
    const res = await fetch(url)
    if (!res.ok) continue
    const text = await res.clone().text()
    for (const m of text.matchAll(assetRx)) found.add(abs(m[0]))
    bytes += (await res.clone().arrayBuffer()).byteLength
    await cache.put(url, res)
    found.delete(url) // déjà enregistré
  }
  return { urls: [...found], bytes }
}

// ---------------------------------------------------------------------------------------------
export async function downloadOffline(
  level: OfflineLevel,
  onProgress: (p: OfflineProgress) => void,
  signal: AbortSignal,
): Promise<OfflineInfo> {
  if (!offlineSupported()) throw new Error("Ce navigateur ne permet pas l'enregistrement hors ligne.")
  const { maxZoom } = LEVELS[level]
  const tiles = tileUrls(maxZoom)
  const photos = [...new Set(Object.values(PHOTOS).map((p) => abs(import.meta.env.BASE_URL + p.src)))]

  // Place disponible : on refuse plutôt que d'échouer à 80 % (stockage plein = copie corrompue).
  const wanted = tiles.length * AVG_TILE_BYTES + 12 * 1024 * 1024
  try {
    const est = await navigator.storage?.estimate?.()
    if (est?.quota !== undefined && est.usage !== undefined && est.quota - est.usage < wanted * 1.1) {
      throw new Error(
        `Pas assez de place sur cet appareil (il faut ~${Math.round(wanted / 1048576)} Mo). Essaie le niveau Standard ou libère de la place.`,
      )
    }
    await navigator.storage?.persist?.() // demande de ne pas effacer la copie en cas de manque de place
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Pas assez')) throw err
  }

  const cache = await caches.open(OFFLINE_CACHE)
  let bytes = 0
  let files = 0
  let done = 0
  const total = tiles.length + photos.length + 14 // + fichiers de l'appli et des données
  const tick = (stage: string) => onProgress({ done, total, stage })
  tick('Fond de carte')

  // 1) Tuiles (le plus gros, et le plus susceptible d'échouer : en premier, avant de toucher aux données).
  // Mesuré le 06/10/2026 sur la région : ~0,5 % de tuiles en 404 (la mer au large du golfe du Lion n'a pas
  // de tuile à fort zoom) — normal, pas un échec — et quelques coupures de connexion ou 502 passagers
  // (réessayés 3 fois avec attente). Les tuiles déjà enregistrées sont sautées : une reprise après
  // échec, ou le passage d'un niveau au suivant, ne retélécharge pas ce qu'on a déjà.
  const RETRY_WAIT_MS = [800, 2500]
  let failures = 0
  let absent = 0
  await runPool(
    tiles,
    async (url) => {
      if (await cache.match(url, { ignoreVary: true })) {
        files++
      } else {
        for (let attempt = 0; attempt <= RETRY_WAIT_MS.length; attempt++) {
          try {
            bytes += await store(cache, url, { mode: 'cors' })
            files++
            break
          } catch (err) {
            if (err instanceof HttpError && err.status === 404) {
              absent++
              break
            }
            if (signal.aborted) break
            if (attempt === RETRY_WAIT_MS.length) failures++
            else await new Promise((r) => setTimeout(r, RETRY_WAIT_MS[attempt]))
          }
        }
      }
      done++
      if (done % 10 === 0) tick('Fond de carte')
    },
    signal,
  )
  if (signal.aborted) throw new Error('Téléchargement annulé.')
  if (failures > Math.max(5, tiles.length * MAX_TILE_FAILURES_RATIO)) {
    throw new Error(
      `Fond de carte incomplet (${failures} tuiles manquantes sur ${tiles.length}). Réessaie : seules les tuiles manquantes seront retéléchargées.`,
    )
  }
  void absent // tuiles sans équivalent côté IGN (mer) : rien à enregistrer

  // 2) Photos du guide des champignons.
  tick('Guide des champignons')
  await runPool(
    photos,
    async (url) => {
      try {
        bytes += await store(cache, url)
        files++
      } catch {
        // une photo manquante n'empêche pas l'usage du guide (le texte, lui, est dans l'appli)
      }
      done++
      if (done % 5 === 0) tick('Guide des champignons')
    },
    signal,
  )

  // 3) L'appli elle-même.
  tick("Application")
  const shell = await discoverShell(cache)
  bytes += shell.bytes
  files += 2
  await runPool(
    shell.urls,
    async (url) => {
      try {
        bytes += await store(cache, url)
        files++
      } catch {
        // ressource facultative
      }
      done++
    },
    signal,
  )

  // 4) Données (en dernier : si quelque chose a échoué avant, l'ancienne copie des données reste cohérente).
  tick('Cartes de pluie et stations')
  const meta = await fetchRainMapsMeta()
  for (const [i, url] of rainMapsUrls(meta).entries()) {
    bytes += await store(cache, url, i === 0 ? { cache: 'no-store' } : undefined)
    files++
    done++
  }
  bytes += await store(cache, abs('/station-history.json'), { cache: 'no-store' })
  files++
  done = total
  tick('Terminé')

  const info: OfflineInfo = {
    savedAt: new Date().toISOString(),
    level,
    maxZoom,
    files,
    bytes,
    mapsFetchedAt: meta.fetchedAt,
  }
  writeOfflineInfo(info)
  return info
}

// ---------------------------------------------------------------------------------------------
// État du réseau et installation de l'appli (écran d'accueil), exposés à React.
type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let installEvent: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function isOnline(): boolean {
  return navigator.onLine
}

export function canInstall(): boolean {
  return installEvent !== null
}

export async function promptInstall(): Promise<void> {
  if (!installEvent) return
  const ev = installEvent
  installEvent = null
  notify()
  await ev.prompt()
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
}

export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

// À appeler une fois au démarrage (main.tsx) : enregistre le service worker et écoute les événements.
export function initOffline() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    installEvent = e as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    installEvent = null
    notify()
  })
  window.addEventListener('online', notify)
  window.addEventListener('offline', notify)
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // pas de service worker (navigation privée, HTTP) : l'appli marche en ligne comme avant
      })
    })
  }
}
