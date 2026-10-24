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
export type PousseDay = { date: string; files: Record<Species, string>; info: string; tempModel: string }
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
export type CoinsResult = { score: Float32Array; width: number; height: number; bounds: Bounds; day: PousseDay; meta: PousseMeta }

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
  return { score, width, height, bounds: hmeta.bounds, day, meta }
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

function colorOf(v: number): [number, number, number, number] {
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

export function renderCoins(res: CoinsResult): string {
  const canvas = document.createElement('canvas')
  canvas.width = res.width
  canvas.height = res.height
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(res.width, res.height)
  for (let i = 0; i < res.score.length; i++) {
    const v = res.score[i]
    if (v < STOPS[0][0]) continue
    const [r, g, b, a] = colorOf(v)
    img.data[i * 4] = r
    img.data[i * 4 + 1] = g
    img.data[i * 4 + 2] = b
    img.data[i * 4 + 3] = a
  }
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
  const habitat = hab.values[i] / 255
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
  if (reasons.length === 0 && res.score[i] >= 0.35) reasons.push('Bon milieu, pluie suffisante au bon moment et températures douces.')

  return {
    score: res.score[i],
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
