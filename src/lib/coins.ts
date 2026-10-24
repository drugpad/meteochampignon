// Coins propices aux champignons : habitat de l'espèce (où elle PEUT pousser, public/habitat/, calculé une
// fois par scripts/build-habitat.py) x météo de pousse (si elle pousse EN CE MOMENT, branche data,
// recalculée à chaque génération des cartes par scripts/build-pousse.py).
//
// Les deux grilles partagent la même emprise que les cartes de pluie : l'habitat est 4 fois plus fin
// (~250 m) ; la météo (~1 km) est interpolée sur la grille de l'habitat.
import { fetchDataJson, fetchPixels } from './rainMaps'

// Les quatre cèpes sont séparés : ils ne poussent ni aux mêmes endroits ni à la même saison.
export type Species = 'cepe_ete' | 'cepe_bronze' | 'cepe_bordeaux' | 'cepe_pins' | 'girolle' | 'coulemelle' | 'trompette'
export const SPECIES: { key: Species; label: string; short: string; group: 'cepe' | 'autre'; hint: string }[] = [
  { key: 'cepe_ete', label: "Cèpe d'été", short: "d'été", group: 'cepe', hint: 'chênes, châtaigniers ; juin-septembre, chaleur' },
  { key: 'cepe_bronze', label: 'Cèpe bronzé', short: 'bronzé', group: 'cepe', hint: 'tête de nègre ; chênes, coteaux chauds ; été-début automne' },
  { key: 'cepe_bordeaux', label: 'Cèpe de Bordeaux', short: 'de Bordeaux', group: 'cepe', hint: 'feuillus et sapins, jusqu’en montagne ; automne, fraîcheur' },
  { key: 'cepe_pins', label: 'Cèpe des pins', short: 'des pins', group: 'cepe', hint: 'pins, sapins, surtout en altitude ; automne' },
  { key: 'girolle', label: 'Girolle', short: 'Girolle', group: 'autre', hint: 'feuillus et conifères, sol acide' },
  { key: 'coulemelle', label: 'Coulemelle', short: 'Coulemelle', group: 'autre', hint: 'prairies, lisières, clairières' },
  { key: 'trompette', label: 'Trompette', short: 'Trompette', group: 'autre', hint: 'hêtres et chênes, sol argileux' },
]
export const isSpecies = (v: unknown): v is Species => SPECIES.some((s) => s.key === v)

type Bounds = { latMin: number; latMax: number; lonMin: number; lonMax: number }
type HabitatMeta = { bounds: Bounds; rows: number; cols: number; groups: string[]; species: Species[] }
// reliable = false : jours 8 à 15 (modèle AIFS seul), seulement pour la courbe de la fiche, en pointillés.
export type PousseDay = { date: string; files: Record<Species, string>; info: string; tempModel: string; reliable?: boolean }
export type PousseMeta = {
  generatedAt: string
  bounds: Bounds
  rows: number
  cols: number
  species: Species[]
  days: PousseDay[]
  history: { days: number; missing: string[]; sources: string[] }
}

export type Grid = { width: number; height: number; values: Uint8ClampedArray }
type Rgb = { width: number; height: number; rgba: Uint8ClampedArray }

// Libellés des groupes d'essences de la BD Forêt (build-habitat-layers.py).
const GROUP_LABELS: Record<string, string> = {
  aucun: 'hors forêt cartographiée',
  chene: 'chênes',
  chene_vert: 'chênes verts',
  hetre: 'hêtres',
  chataignier: 'châtaigniers',
  feuillus: 'feuillus mélangés',
  robinier: 'robiniers',
  peuplier: 'peupliers',
  mixte: 'feuillus et conifères',
  pins: 'pins',
  sapin_epicea: 'sapins, épicéas',
  autres_conif: 'autres conifères',
  lande: 'lande',
  herbe: 'prairie, clairière',
}

// --------------------------------------------------------------------------------------------------
let habitatMeta: Promise<HabitatMeta> | null = null
const habitatGrids = new Map<string, Promise<Grid>>()
let habitatInfo: Promise<Rgb> | null = null

const toGrid = (p: Rgb): Grid => {
  const values = new Uint8ClampedArray(p.width * p.height)
  for (let i = 0; i < values.length; i++) values[i] = p.rgba[i * 4]
  return { width: p.width, height: p.height, values }
}

function loadHabitatMeta(): Promise<HabitatMeta> {
  habitatMeta ??= fetch('/habitat/habitat.json').then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json() as Promise<HabitatMeta>
  })
  return habitatMeta
}

export function loadHabitat(sp: Species): Promise<Grid> {
  if (!habitatGrids.has(sp)) {
    const p = fetchPixels(`/habitat/${sp}.png`).then(toGrid)
    p.catch(() => habitatGrids.delete(sp)) // nouvel essai possible
    habitatGrids.set(sp, p)
  }
  return habitatGrids.get(sp)!
}

function loadHabitatInfo(): Promise<Rgb> {
  habitatInfo ??= fetchPixels('/habitat/info.png')
  return habitatInfo
}

// --------------------------------------------------------------------------------------------------
let pousseCache: { meta: PousseMeta; base: string } | null = null
const pousseGrids = new Map<string, Promise<Grid>>()
const pousseInfos = new Map<string, Promise<Rgb>>()

export async function loadPousseMeta(force = false): Promise<PousseMeta> {
  if (!pousseCache || force) {
    const { data, base } = await fetchDataJson<PousseMeta>('pousse.json')
    if (!Array.isArray(data.days) || data.days.length === 0) throw new Error('format inattendu')
    pousseCache = { meta: data, base }
    pousseGrids.clear()
    pousseInfos.clear()
  }
  return pousseCache.meta
}

const pousseUrl = (file: string) => `${pousseCache!.base}/${file}?v=${encodeURIComponent(pousseCache!.meta.generatedAt)}`

function loadPousse(file: string): Promise<Grid> {
  if (!pousseGrids.has(file)) {
    const p = fetchPixels(pousseUrl(file)).then(toGrid)
    p.catch(() => pousseGrids.delete(file))
    pousseGrids.set(file, p)
  }
  return pousseGrids.get(file)!
}

function loadPousseInfo(file: string): Promise<Rgb> {
  if (!pousseInfos.has(file)) {
    const p = fetchPixels(pousseUrl(file))
    p.catch(() => pousseInfos.delete(file))
    pousseInfos.set(file, p)
  }
  return pousseInfos.get(file)!
}

// --------------------------------------------------------------------------------------------------
// Score combiné sur la grille de l'habitat : habitat x météo (interpolation bilinéaire de la météo).
export type CoinsResult = {
  score: Float32Array
  width: number
  height: number
  bounds: Bounds
  day: PousseDay
  meta: PousseMeta
  species: Species
  pousse: Grid // météo de pousse de l'espèce (~1 km), réutilisée par les tuiles à 20 m
  habitat: Grid // habitat de l'espèce (250 m), pour le contour des zones favorables
}

export async function computeCoins(sp: Species, dayIndex: number): Promise<CoinsResult> {
  const [hmeta, meta] = await Promise.all([loadHabitatMeta(), loadPousseMeta()])
  const day = meta.days[Math.min(dayIndex, meta.days.length - 1)]
  // Espèce ajoutée dans l'appli mais pas encore calculée côté serveur (entre deux publications).
  if (!day.files[sp]) throw new Error('espèce pas encore calculée')
  const [hab, pou] = await Promise.all([loadHabitat(sp), loadPousse(day.files[sp])])
  const { width, height } = hab
  const score = new Float32Array(width * height)
  const fx = pou.width / width
  const fy = pou.height / height
  for (let r = 0; r < height; r++) {
    const y = Math.min(Math.max((r + 0.5) * fy - 0.5, 0), pou.height - 1)
    const y0 = Math.floor(y)
    const y1 = Math.min(y0 + 1, pou.height - 1)
    const wy = y - y0
    for (let c = 0; c < width; c++) {
      const h = hab.values[r * width + c]
      if (h === 0) continue
      const x = Math.min(Math.max((c + 0.5) * fx - 0.5, 0), pou.width - 1)
      const x0 = Math.floor(x)
      const x1 = Math.min(x0 + 1, pou.width - 1)
      const wx = x - x0
      const p =
        (pou.values[y0 * pou.width + x0] * (1 - wx) + pou.values[y0 * pou.width + x1] * wx) * (1 - wy) +
        (pou.values[y1 * pou.width + x0] * (1 - wx) + pou.values[y1 * pou.width + x1] * wx) * wy
      score[r * width + c] = (h / 255) * (p / 255)
    }
  }
  return { score, width, height, bounds: hmeta.bounds, day, meta, species: sp, pousse: pou, habitat: hab }
}

// Palette : transparent sous 0,12, puis jaune -> orange -> rouge -> violet foncé.
const STOPS: [number, [number, number, number, number]][] = [
  [0.12, [255, 237, 160, 0]],
  [0.2, [254, 217, 118, 150]],
  [0.35, [253, 141, 60, 185]],
  [0.5, [240, 59, 32, 205]],
  [0.7, [189, 0, 38, 220]],
  [1, [110, 1, 90, 235]],
]
export const COINS_LEGEND = [
  { label: 'Possible', color: 'rgb(254,217,118)' },
  { label: 'Favorable', color: 'rgb(253,141,60)' },
  { label: 'Bon', color: 'rgb(240,59,32)' },
  { label: 'Très bon', color: 'rgb(189,0,38)' },
  { label: 'Excellent', color: 'rgb(110,1,90)' },
]

export function colorOf(v: number): [number, number, number, number] {
  if (v < STOPS[0][0]) return [0, 0, 0, 0]
  for (let i = 1; i < STOPS.length; i++) {
    if (v <= STOPS[i][0]) {
      const [a, ca] = STOPS[i - 1]
      const [b, cb] = STOPS[i]
      const t = (v - a) / (b - a)
      return [0, 1, 2, 3].map((k) => Math.round(ca[k] + (cb[k] - ca[k]) * t)) as [number, number, number, number]
    }
  }
  return STOPS[STOPS.length - 1][1]
}

// Zones où le MILIEU convient à l'espèce (habitat ≥ 50 %), dessinées quelle que soit la météo : un léger
// voile et un trait sur leur bord. Hors saison, la carte montre ainsi toujours où chercher ; la couleur de
// pousse (jaune -> violet) se pose par-dessus quand la météo s'y prête.
export const ZONE_THRESHOLD = 0.5
export const ZONE_FILL: [number, number, number, number] = [120, 53, 15, 34]
export const ZONE_EDGE: [number, number, number, number] = [92, 40, 10, 215]

// Peint une grille (score + habitat, même taille) : voile de zone, couleur de pousse, puis contour.
export function paintZones(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  scoreAt: (i: number) => number,
  goodAt: (i: number) => boolean,
): void {
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const i = r * width + c
      const good = goodAt(i)
      let px: [number, number, number, number] = [0, 0, 0, 0]
      if (good) px = ZONE_FILL
      const v = scoreAt(i)
      if (v >= STOPS[0][0]) px = colorOf(v)
      // Bord de zone : case favorable dont un voisin (gauche, droite, haut, bas) ne l'est pas.
      if (
        good &&
        ((c > 0 && !goodAt(i - 1)) || (c < width - 1 && !goodAt(i + 1)) || (r > 0 && !goodAt(i - width)) || (r < height - 1 && !goodAt(i + width)))
      ) {
        px = ZONE_EDGE
      }
      if (px[3] === 0) continue
      data[i * 4] = px[0]
      data[i * 4 + 1] = px[1]
      data[i * 4 + 2] = px[2]
      data[i * 4 + 3] = px[3]
    }
  }
}

export function renderCoins(res: CoinsResult): string {
  const canvas = document.createElement('canvas')
  canvas.width = res.width
  canvas.height = res.height
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(res.width, res.height)
  const threshold = ZONE_THRESHOLD * 255
  paintZones(img.data, res.width, res.height, (i) => res.score[i], (i) => res.habitat.values[i] >= threshold)
  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL()
}

export function scoreLabel(v: number): string {
  if (v >= 0.7) return 'Excellent'
  if (v >= 0.5) return 'Très bon'
  if (v >= 0.35) return 'Bon'
  if (v >= 0.2) return 'Favorable'
  if (v >= 0.12) return 'Possible'
  return 'Peu probable'
}

// --------------------------------------------------------------------------------------------------
// Palmarès : les meilleurs secteurs (moyenne sur ~750 m pour préférer un vrai secteur à une case isolée),
// au moins 10 km les uns des autres (à 5 km, 8 coins sur 10 se tassaient dans un même massif).
export type Spot = { lat: number; lon: number; score: number; row: number; col: number }

export function topSpots(res: CoinsResult, count = 10, minKm = 10): Spot[] {
  const { width, height, score, bounds } = res
  const smooth = new Float32Array(width * height)
  for (let r = 1; r < height - 1; r++) {
    for (let c = 1; c < width - 1; c++) {
      let s = 0
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) s += score[(r + dr) * width + c + dc]
      smooth[r * width + c] = s / 9
    }
  }
  const order: number[] = []
  for (let i = 0; i < smooth.length; i++) if (smooth[i] >= 0.12) order.push(i)
  order.sort((a, b) => smooth[b] - smooth[a])
  const latStep = (bounds.latMax - bounds.latMin) / height
  const lonStep = (bounds.lonMax - bounds.lonMin) / width
  const picked: Spot[] = []
  for (const i of order) {
    const row = Math.floor(i / width)
    const col = i % width
    const lat = bounds.latMax - (row + 0.5) * latStep
    const lon = bounds.lonMin + (col + 0.5) * lonStep
    if (picked.some((p) => kmBetween(p.lat, p.lon, lat, lon) < minKm)) continue
    picked.push({ lat, lon, score: smooth[i], row, col })
    if (picked.length >= count) break
  }
  return picked
}

function kmBetween(a: number, b: number, c: number, d: number): number {
  const dy = (c - a) * 111.32
  const dx = (d - b) * 111.32 * Math.cos(((a + c) / 2) * (Math.PI / 180))
  return Math.hypot(dx, dy)
}

// --------------------------------------------------------------------------------------------------
// Explication d'un endroit : pourquoi c'est (ou non) un bon coin.
export type SpotDetail = {
  score: number
  habitat: number
  pousse: number
  trees: string
  ph: number | null
  altitude: number
  rain15: number
  daysSinceRain: number | null
  temp5: number
  reasons: string[]
}

export async function describeSpot(res: CoinsResult, sp: Species, lat: number, lon: number): Promise<SpotDetail | null> {
  const { bounds, width, height } = res
  const row = Math.floor(((bounds.latMax - lat) / (bounds.latMax - bounds.latMin)) * height)
  const col = Math.floor(((lon - bounds.lonMin) / (bounds.lonMax - bounds.lonMin)) * width)
  if (row < 0 || col < 0 || row >= height || col >= width) return null
  const [hmeta, hab, info, pou, pinfo] = await Promise.all([
    loadHabitatMeta(),
    loadHabitat(sp),
    loadHabitatInfo(),
    loadPousse(res.day.files[sp]),
    loadPousseInfo(res.day.info),
  ])
  const i = row * width + col
  // Habitat à 20 m du point exact quand les tuiles fines existent (cohérent avec les couleurs affichées en
  // zoomant), sinon celui de la case de 250 m.
  const fine = await sampleFineHabitat(sp, lat, lon)
  const habitat = fine ?? hab.values[i] / 255
  const group = hmeta.groups[info.rgba[i * 4]] ?? 'aucun'
  const phRaw = info.rgba[i * 4 + 1]
  const altitude = info.rgba[i * 4 + 2] * 10
  const pr = Math.min(pou.height - 1, Math.floor(((bounds.latMax - lat) / (bounds.latMax - bounds.latMin)) * pou.height))
  const pc = Math.min(pou.width - 1, Math.floor(((lon - bounds.lonMin) / (bounds.lonMax - bounds.lonMin)) * pou.width))
  const j = pr * pou.width + pc
  const pousse = pou.values[j] / 255
  const rain15 = pinfo.rgba[j * 4] * 2
  const since = pinfo.rgba[j * 4 + 1]
  const temp5 = pinfo.rgba[j * 4 + 2] / 6 - 10
  const ph = phRaw > 0 ? phRaw / 25 : null

  const reasons: string[] = []
  if (habitat === 0 && group === 'aucun') reasons.push('Pas de bois ni de prairie favorable cartographiés ici.')
  else if (habitat < 0.3) reasons.push(`Milieu peu favorable à l'espèce (${GROUP_LABELS[group] ?? group}).`)
  if (since === 255) reasons.push('Aucune grosse pluie (20 mm en 3 jours) depuis plusieurs semaines : trop sec.')
  else if (since <= 6) {
    const ago = `il y a ${since} jour${since > 1 ? 's' : ''}`
    // La pousse du moment peut venir de pluies plus anciennes : ne pas annoncer « pas encore démarré »
    // quand la météo est déjà favorable.
    reasons.push(
      pousse >= 0.3
        ? `Pousse en cours grâce aux pluies précédentes ; la grosse pluie ${ago} devrait relancer une nouvelle vague d'ici une à deux semaines.`
        : `Grosse pluie ${ago} : la pousse n'a pas encore démarré, elle est attendue d'ici une à deux semaines si la douceur se maintient.`,
    )
  }
  if (temp5 < 6) reasons.push('Trop froid ces derniers jours.')
  else if (temp5 > 24) reasons.push('Trop chaud ces derniers jours.')
  if (rain15 < 10 && since !== 255) reasons.push('Sol qui s’assèche (peu de pluie ces 15 jours).')
  if (reasons.length === 0 && (fine !== null ? habitat * pousse : res.score[i]) >= 0.35) reasons.push('Bon milieu, pluie suffisante au bon moment et températures douces.')

  return {
    score: fine !== null ? habitat * pousseAt(res, lat, lon) : res.score[i],
    habitat,
    pousse,
    trees: GROUP_LABELS[group] ?? group,
    ph,
    altitude,
    rain15,
    daysSinceRain: since === 255 ? null : since,
    temp5,
    reasons,
  }
}

// --------------------------------------------------------------------------------------------------
// Habitat à 20 m : tuiles Web Mercator (zooms 10 à 13) de scripts/build-habitat-fine.py, publiées sur la
// branche orpheline « habitat ». Une tuile RGB contient les 7 espèces : 3 bits chacune (8 niveaux).
export const FINE_TILES_URL: string =
  import.meta.env.VITE_HABITAT_TILES_URL ?? 'https://raw.githubusercontent.com/drugpad/meteochampignon/habitat'
export const FINE_MIN_ZOOM = 10
export const FINE_MAX_ZOOM = 13

let fineMeta: Promise<{ species: Species[] } | null> | null = null
export function loadFineMeta(): Promise<{ species: Species[] } | null> {
  fineMeta ??= fetch(`${FINE_TILES_URL}/habitat-tiles.json`)
    .then((r) => (r.ok ? (r.json() as Promise<{ species: Species[] }>) : null))
    .catch(() => null)
  return fineMeta
}

const fineTiles = new Map<string, Promise<Rgb | null>>()
export function loadFineTile(z: number, x: number, y: number): Promise<Rgb | null> {
  const key = `${z}/${x}/${y}`
  if (!fineTiles.has(key)) {
    // 404 = pas d'habitat dans cette tuile (hors région) : tuile vide, pas une erreur.
    const p = fetchPixels(`${FINE_TILES_URL}/${key}.png`).catch(() => null)
    fineTiles.set(key, p)
    if (fineTiles.size > 400) fineTiles.delete(fineTiles.keys().next().value!) // mémoire bornée
  }
  return fineTiles.get(key)!
}

export const fineLevel = (rgba: Uint8ClampedArray, i: number, speciesIndex: number): number => {
  const v = (rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2]
  return (v >> (3 * speciesIndex)) & 7
}

// Habitat à 20 m d'un point (0-1), ou null si les tuiles fines sont indisponibles.
export async function sampleFineHabitat(sp: Species, lat: number, lon: number): Promise<number | null> {
  const meta = await loadFineMeta()
  const idx = meta?.species.indexOf(sp) ?? -1
  if (idx < 0) return null
  const z = FINE_MAX_ZOOM
  const n = 2 ** z
  const fx = ((lon + 180) / 360) * n
  const fy = ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n
  const tile = await loadFineTile(z, Math.floor(fx), Math.floor(fy))
  if (!tile) return 0
  const px = Math.min(255, Math.floor((fx % 1) * 256))
  const py = Math.min(255, Math.floor((fy % 1) * 256))
  return fineLevel(tile.rgba, py * 256 + px, idx) / 7
}

// Météo de pousse (0-1) à un point, interpolée comme pour la carte.
export function pousseAt(res: CoinsResult, lat: number, lon: number): number {
  const b = res.bounds
  const g = res.pousse
  const x = Math.min(Math.max(((lon - b.lonMin) / (b.lonMax - b.lonMin)) * g.width - 0.5, 0), g.width - 1)
  const y = Math.min(Math.max(((b.latMax - lat) / (b.latMax - b.latMin)) * g.height - 0.5, 0), g.height - 1)
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(x0 + 1, g.width - 1)
  const y1 = Math.min(y0 + 1, g.height - 1)
  const wx = x - x0
  const wy = y - y0
  const v = g.values
  return (
    ((v[y0 * g.width + x0] * (1 - wx) + v[y0 * g.width + x1] * wx) * (1 - wy) +
      (v[y1 * g.width + x0] * (1 - wx) + v[y1 * g.width + x1] * wx) * wy) /
    255
  )
}

// --------------------------------------------------------------------------------------------------
// Courbe de potentiel d'un endroit : habitat (fixe) x météo de pousse de chaque jour publié (jusqu'à 15).
export type SeriesPoint = { date: string; value: number; reliable: boolean }

export async function potentialSeries(res: CoinsResult, sp: Species, lat: number, lon: number, habitat: number): Promise<SeriesPoint[]> {
  const days = res.meta.days.filter((d) => d.files[sp])
  const grids = await Promise.all(days.map((d) => loadPousse(d.files[sp]).catch(() => null)))
  return days.flatMap((d, k) => {
    const g = grids[k]
    if (!g) return []
    return [{ date: d.date, value: habitat * pousseAt({ ...res, pousse: g }, lat, lon), reliable: d.reliable !== false }]
  })
}
