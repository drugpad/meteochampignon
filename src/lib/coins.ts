// Coins propices aux champignons : habitat de l'espèce (où elle PEUT pousser, public/habitat/, calculé une
// fois par scripts/build-habitat.py) x météo de pousse (si elle pousse EN CE MOMENT, branche data,
// recalculée à chaque génération des cartes par scripts/build-pousse.py).
//
// Les deux grilles partagent la même emprise que les cartes de pluie : l'habitat est 4 fois plus fin
// (~250 m) ; la météo (~1 km) est interpolée sur la grille de l'habitat.
import { nearbyMeasures, type NearbyMeasure } from './stations'
import { moonPhase } from './moon'
import { fetchDataJson, fetchPixels } from './rainMaps'

// Les quatre cèpes sont séparés : ils ne poussent ni aux mêmes endroits ni à la même saison.
export type Species = 'cepe_ete' | 'cepe_bronze' | 'cepe_bordeaux' | 'cepe_pins' | 'girolle' | 'coulemelle' | 'trompette'
export const SPECIES: { key: Species; label: string; short: string; group: 'cepe' | 'autre'; hint: string }[] = [
  { key: 'cepe_ete', label: "Cèpe d'été", short: "d'été", group: 'cepe', hint: 'chênes, châtaigniers ; juin-septembre, chaleur' },
  { key: 'cepe_bronze', label: 'Cèpe bronzé', short: 'bronzé', group: 'cepe', hint: 'tête de nègre ; chênes, châtaigniers, sols siliceux, coteaux chauds ; juillet-octobre' },
  { key: 'cepe_bordeaux', label: 'Cèpe de Bordeaux', short: 'de Bordeaux', group: 'cepe', hint: 'hêtres, sapins, châtaigniers, sols acides, surtout 600-1 200 m ; automne' },
  { key: 'cepe_pins', label: 'Cèpe des pins', short: 'des pins', group: 'cepe', hint: 'pins, sapins, sols acides, montagne ; printemps et automne' },
  { key: 'girolle', label: 'Girolle', short: 'Girolle', group: 'autre', hint: 'feuillus et conifères, sol acide, surtout 300-900 m' },
  { key: 'coulemelle', label: 'Coulemelle', short: 'Coulemelle', group: 'autre', hint: 'prairies, lisières, bois clairs ; fin d’été-automne' },
  { key: 'trompette', label: 'Trompette', short: 'Trompette', group: 'autre', hint: 'hêtres, chênes, châtaigniers ; sous-bois frais' },
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
  // « Milieu seul » : score = habitat, sans la météo (les meilleurs coins dans l'absolu, quelle que soit la saison).
  habitatOnly: boolean
  // Clin d'œil « lune » (croyance populaire, lib/moon.ts) : facteur appliqué au score de pousse, 1 si désactivé.
  moonFactor: number
}

export async function computeCoins(sp: Species, dayIndex: number, habitatOnly = false, moon = false): Promise<CoinsResult> {
  const [hmeta, meta] = await Promise.all([loadHabitatMeta(), loadPousseMeta()])
  const day = meta.days[Math.min(dayIndex, meta.days.length - 1)]
  // Espèce ajoutée dans l'appli mais pas encore calculée côté serveur (entre deux publications).
  if (!day.files[sp]) throw new Error('espèce pas encore calculée')
  const [hab, pou] = await Promise.all([loadHabitat(sp), loadPousse(day.files[sp])])
  const { width, height } = hab
  const score = new Float32Array(width * height)
  const moonFactor = moon && !habitatOnly ? moonPhase(day.date).factor : 1
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
      if (habitatOnly) {
        score[r * width + c] = h / 255
        continue
      }
      const x = Math.min(Math.max((c + 0.5) * fx - 0.5, 0), pou.width - 1)
      const x0 = Math.floor(x)
      const x1 = Math.min(x0 + 1, pou.width - 1)
      const wx = x - x0
      const p =
        (pou.values[y0 * pou.width + x0] * (1 - wx) + pou.values[y0 * pou.width + x1] * wx) * (1 - wy) +
        (pou.values[y1 * pou.width + x0] * (1 - wx) + pou.values[y1 * pou.width + x1] * wx) * wy
      score[r * width + c] = Math.min(1, (h / 255) * (p / 255) * moonFactor)
    }
  }
  return { score, width, height, bounds: hmeta.bounds, day, meta, species: sp, pousse: pou, habitat: hab, habitatOnly, moonFactor }
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
export const ZONE_FILL: [number, number, number, number] = [120, 53, 15, 48]
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

// Échelle de couleurs du mode « Milieu seul » : le milieu atteint facilement 60-90 %, alors que la palette est
// calée sur le score avec météo (bien plus bas) ; sans cette conversion, toute la forêt sortait en rouge foncé.
// Jaune à partir de 35 % de milieu, rouge foncé seulement au-delà de 90 %. Le pourcentage affiché reste le vrai.
const MILIEU_SCALE: [number, number][] = [[0, 0], [0.35, 0.12], [0.5, 0.2], [0.65, 0.35], [0.8, 0.5], [0.9, 0.7], [1, 1]]
export function displayValue(res: CoinsResult, v: number): number {
  if (!res.habitatOnly) return v
  for (let i = 1; i < MILIEU_SCALE.length; i++) {
    const [x1, y1] = MILIEU_SCALE[i]
    if (v <= x1) {
      const [x0, y0] = MILIEU_SCALE[i - 1]
      return y0 + ((v - x0) / (x1 - x0)) * (y1 - y0)
    }
  }
  return 1
}

export function renderCoins(res: CoinsResult): string {
  const canvas = document.createElement('canvas')
  canvas.width = res.width
  canvas.height = res.height
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(res.width, res.height)
  const threshold = ZONE_THRESHOLD * 255
  paintZones(img.data, res.width, res.height, (i) => displayValue(res, res.score[i]), (i) => res.habitat.values[i] >= threshold)
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
  // Mesures réelles des stations Météo-France proches (vérification du modèle) ; vide si aucune à moins de 30 km.
  nearby: NearbyMeasure[]
  // Le modèle est-il d'accord avec le pluviomètre proche le plus comparable ? (voir rainCheck)
  rainCheck: RainCheck
}

// Compare la pluie du modèle (15 jours) à ce que la station la plus comparable (distance + altitude) a mesuré, ramené à
// 15 jours (la collecte n'en a parfois que 10 ou 11). Seuil : écart d'au moins 10 mm ET d'au moins 40 % — en dessous,
// on ne conclut rien. Une seule station ne prouve pas tout (la pluie varie vite en montagne) : le texte reste prudent.
export type RainCheck = { status: 'ok' | 'lower' | 'higher' | 'unknown'; text: string }

export function rainCheck(modelRain15: number, nearby: NearbyMeasure[]): RainCheck {
  const ref = nearby.find((m) => m.days >= 5)
  if (!ref) return { status: 'unknown', text: 'Aucune station Météo-France comparable à moins de 30 km : la pluie est une estimation du modèle, non vérifiée sur place.' }
  const measured15 = (ref.rainMm * 15) / ref.days
  const gap = modelRain15 - measured15
  const fr = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })
  const where = `${ref.name} (${ref.altitude !== undefined ? ref.altitude + ' m, ' : ''}${ref.km} km)`
  if (gap >= 10 && measured15 < 0.6 * modelRain15) {
    return { status: 'lower', text: `⚠ Écart : le modèle compte ${modelRain15} mm sur 15 jours, mais ${where} n'a mesuré que ${fr(ref.rainMm)} mm en ${ref.days} jours (≈ ${Math.round(measured15)} mm sur 15). La pousse est probablement surestimée ici : à prendre avec prudence.` }
  }
  if (-gap >= 10 && measured15 > 1.4 * modelRain15) {
    return { status: 'higher', text: `⚠ Écart : ${where} a mesuré ${fr(ref.rainMm)} mm en ${ref.days} jours (≈ ${Math.round(measured15)} mm sur 15), plus que les ${modelRain15} mm du modèle. La pousse est peut-être sous-estimée ici.` }
  }
  return { status: 'ok', text: `✓ Cohérent avec ${where} : ${fr(ref.rainMm)} mm mesurés en ${ref.days} jours (modèle : ${modelRain15} mm sur 15 jours).` }
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

  const nearby = await nearbyMeasures(lat, lon, altitude > 0 ? altitude : null).catch(() => [] as NearbyMeasure[])
  const check = rainCheck(rain15, nearby)
  const reasons: string[] = []
  if (habitat === 0 && group === 'aucun') reasons.push('Pas de bois ni de prairie favorable cartographiés ici.')
  else if (habitat < 0.3) reasons.push(`Milieu peu favorable à l'espèce (${GROUP_LABELS[group] ?? group}).`)
  if (since === 255) {
    // Pas d'épisode (15 mm en 5 jours) : distinguer le vrai sec des pluies faibles et étalées.
    reasons.push(
      rain15 >= 15
        ? `Pluies faibles et étalées (${rain15} mm en 15 jours) : de quoi lancer au mieux une petite poussée.`
        : 'Pas de vraie pluie depuis plusieurs semaines : trop sec.',
    )
  }
  // Pas de promesse sur l'avenir ici : ce que la météo prévue fera de ce coin est calculé jour par jour dans la
  // courbe (voir outlook) ; cette liste ne contient que des constats sur le passé.
  if (temp5 < 6) reasons.push('Trop froid ces derniers jours.')
  else if (temp5 > 24) reasons.push('Trop chaud ces derniers jours.')
  // Modèle de pousse à fenêtres (30/10/2026) : la pluie d'il y a 1 à 6 semaines est celle qui fait sortir les
  // champignons ; quelques jours secs ensuite ne sont pas un mauvais signe en soi.
  if (rain15 < 10 && since !== 255)
    reasons.push(`Peu de pluie ces 15 derniers jours (${rain15} mm) : la pluie plus ancienne compte encore, les champignons sortent 1 à 3 semaines après.`)
  if (res.habitatOnly && habitat >= 0.6) reasons.unshift(`Très bon milieu pour l'espèce (${GROUP_LABELS[group] ?? group}), indépendamment de la météo.`)
  if (reasons.length === 0 && !res.habitatOnly && check.status !== 'lower' && (fine !== null ? habitat * pousse : res.score[i]) >= 0.35) reasons.push(`Bon milieu, ${rain15} mm de pluie en 15 jours et ${temp5.toFixed(0)} °C de moyenne : conditions réunies selon le modèle${check.status === 'ok' ? ', confirmées par les stations proches' : ''}.`)

  return {
    score: res.habitatOnly ? habitat : fine !== null ? Math.min(1, habitat * pousseAt(res, lat, lon) * res.moonFactor) : res.score[i],
    habitat,
    pousse,
    trees: GROUP_LABELS[group] ?? group,
    ph,
    altitude,
    rain15,
    daysSinceRain: since === 255 ? null : since,
    temp5,
    reasons,
    nearby,
    rainCheck: check,
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
    const moon = res.moonFactor !== 1 ? moonPhase(d.date).factor : 1
    return [{ date: d.date, value: Math.min(1, habitat * pousseAt({ ...res, pousse: g }, lat, lon) * moon), reliable: d.reliable !== false }]
  })
}

// --------------------------------------------------------------------------------------------------
// Verdict en clair d'un endroit : QUAND y aller, déduit de la courbe jour par jour (la même que celle affichée), jamais
// d'une phrase toute faite. Seuils = ceux de scoreLabel (0,12 = « possible »). Au-delà de 7 jours (reliable = false),
// c'est une tendance d'un seul modèle : le texte le dit.
export type Outlook = { headline: string; detail: string; tone: 'go' | 'soon' | 'no' }

const OUTLOOK_MIN = 0.12
const pct = (v: number) => `${Math.round(v * 100)} %`
const DAY_NAME = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

function dayName(iso: string, today: string): string {
  const t = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))
  const d = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))
  const diff = Math.round((d - t) / 86400000)
  if (diff === 0) return "aujourd'hui"
  if (diff === 1) return 'demain'
  return DAY_NAME.format(new Date(`${iso}T12:00:00Z`))
}

export function outlook(series: SeriesPoint[], today: string): Outlook | null {
  if (series.length < 2) return null
  const last = series[series.length - 1]
  const trend = (p: SeriesPoint) => (p.reliable ? '' : ' (tendance, moins sûre)')
  const peakOf = (pts: SeriesPoint[]) => pts.reduce((b, p) => (p.value > b.value ? p : b))
  const now = series[0]

  if (now.value >= OUTLOOK_MIN) {
    const end = series.findIndex((p) => p.value < OUTLOOK_MIN)
    const window = end === -1 ? series : series.slice(0, end)
    const lastGood = window[window.length - 1]
    const n = window.length
    if (end === -1) {
      const peak = peakOf(series)
      return {
        headline: `Favorable pendant toute la période prévue (jusqu'au ${dayName(last.date, today)})`,
        detail: `${pct(now.value)} aujourd'hui (${scoreLabel(now.value).toLowerCase()})${peak.date === now.date ? ', et c\'est le maximum de la période' : `, maximum ${pct(peak.value)} ${dayName(peak.date, today)}${trend(peak)}`}.`,
        tone: 'go',
      }
    }
    const rest = series.slice(end)
    const rebound = peakOf(rest)
    const after =
      rebound.value >= OUTLOOK_MIN
        ? ` Remontée possible vers ${pct(rebound.value)} ${dayName(rebound.date, today)}${trend(rebound)}.`
        : ` Aucune remontée prévue d'ici le ${dayName(last.date, today)}.`
    return {
      headline:
        n === 1
          ? `C'est le moment : seulement ${now.date === today ? "aujourd'hui" : dayName(now.date, today)}`
          : `C'est le moment : encore ${n} jours, jusqu'au ${dayName(lastGood.date, today)}`,
      detail: `${pct(now.value)} aujourd'hui (${scoreLabel(now.value).toLowerCase()}) ; sous ${pct(OUTLOOK_MIN)} (peu probable) dès ${dayName(series[end].date, today)}.${after}`,
      tone: 'go',
    }
  }

  const start = series.findIndex((p) => p.value >= OUTLOOK_MIN)
  if (start === -1) {
    const peak = peakOf(series)
    return {
      headline: `Pas de bon moment prévu d'ici le ${dayName(last.date, today)}`,
      detail: `Potentiel de ${pct(now.value)} aujourd'hui${peak.date === now.date ? '' : `, au mieux ${pct(peak.value)} ${dayName(peak.date, today)}${trend(peak)}`} : sauf nouvelle pluie importante, ça ne pousse pas ici.`,
      tone: 'no',
    }
  }
  const peak = peakOf(series.slice(start))
  return {
    headline: `Pas encore : à surveiller à partir du ${dayName(series[start].date, today)}`,
    detail: `${pct(now.value)} aujourd'hui ; monte vers ${pct(peak.value)} ${dayName(peak.date, today)} (${scoreLabel(peak.value).toLowerCase()})${trend(peak)}.`,
    tone: 'soon',
  }
}
