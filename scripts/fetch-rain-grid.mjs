#!/usr/bin/env node
// Recalcule la grille de pluie 24h (Option A) et l'écrit dans
// public/rain-grid.json — lancé par GitHub Actions (voir
// .github/workflows/rain-grid.yml), pas par le navigateur : l'appli lit
// directement ce fichier statique (voir src/lib/rainGrid.ts), donc
// l'ouverture de la carte de pluie est quasi instantanée au lieu d'attendre
// plusieurs minutes que le navigateur tire la grille lui-même.
//
// Découpé en TRANCHES (voir SLICE_INDEX/SLICE_COUNT) : à 0.03° (~10800
// points), un run qui tire toute la grille d'affilée (~30-40 min) a fini
// par échouer de façon persistante après ~20-25 min de sollicitation
// continue (429 qui ne se dissipe plus malgré les retries) — alors qu'un
// run plus court (~1500 points, ~6 min, la config d'avant le resserrage à
// 0.03°) restait fiable. Les quotas documentés d'Open-Meteo (5000/h,
// 10000/j) n'expliquent pas vraiment ce comportement dans un sens ou
// l'autre (l'ancienne config les dépassait déjà largement si on compte par
// point, et la marchait quand même) — plutôt une limite liée à la durée/
// charge d'une session continue, pas un quota propre. D'où : ne plus jamais
// soutenir une session longue, quitte à répartir la grille complète sur
// plusieurs runs courts dans l'heure (chacun fusionne sa tranche dans le
// fichier existant, sans toucher aux points des autres tranches).
//
// Reprend volontairement la même logique (bbox, pas, pacing anti-429) que
// src/lib/rainGrid.ts / src/lib/config.ts / src/lib/openMeteo.ts, mais en
// JS pur (script Node exécuté par la CI, pas de build Vite ici) — pas de
// dépendance partagée entre les deux pour rester simple, à garder synchro
// à la main si un jour la grille change (bbox, pas, etc.).

import { readFile, writeFile } from 'node:fs/promises'

const BOUNDS = { latMin: 42.6, latMax: 45.15, lonMin: -0.4, lonMax: 3.4 }
// Synchro à la main avec RAIN_GRID_STEP_DEG dans src/lib/config.ts.
const STEP_DEG = 0.03
const BATCH_SIZE = 100
// Pacing conservé (~500 pts/min) : ce n'est pas le débit instantané qui a
// posé problème à 0.03°, c'est la durée totale de sollicitation continue
// (voir commentaire en tête de fichier) — réglée par le découpage en
// tranches, pas par un espacement plus long entre lots.
const BATCH_DELAY_MS = 12000

// Découpage en tranches : SLICE_COUNT tranches, ce run ne traite que
// SLICE_INDEX. Assignation entrelacée (index modulo, pas un bloc contigu
// de la grille) pour que chaque tranche couvre uniformément toute la zone
// plutôt qu'une région géographique précise — évite qu'un coin de la carte
// soit systématiquement plus "vieux" que les autres pendant le cycle.
const SLICE_COUNT = Number(process.env.SLICE_COUNT ?? '1')
const SLICE_INDEX = Number(process.env.SLICE_INDEX ?? '0')

function buildGridPoints() {
  // Par INDEX, pas par accumulation `lat += STEP_DEG` (les flottants faisaient
  // sauter la dernière ligne) — même calcul que RAIN_GRID_ROWS/COLS dans
  // src/lib/config.ts, à garder synchro.
  const rows = Math.floor((BOUNDS.latMax - BOUNDS.latMin) / STEP_DEG + 1e-6) + 1
  const cols = Math.floor((BOUNDS.lonMax - BOUNDS.lonMin) / STEP_DEG + 1e-6) + 1
  const points = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      points.push({
        lat: Math.round((BOUNDS.latMin + row * STEP_DEG) * 1000) / 1000,
        lon: Math.round((BOUNDS.lonMin + col * STEP_DEG) * 1000) / 1000,
      })
    }
  }
  return points
}

function chunk(arr, size) {
  const chunks = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function pointKey(p) {
  return `${p.lat},${p.lon}`
}

// `times` en secondes Unix (timeformat=unixtime dans la requête) : les heures
// renvoyées par défaut sont en heure murale de Paris SANS fuseau, et un
// `new Date("2026-10-03T21:00")` sur un runner GitHub (UTC) les lisait comme
// de l'UTC — la fenêtre 24h se terminait alors 1h (hiver) à 2h (été) trop tôt.
function rolling24hSum(times, values, now = new Date()) {
  const nowIndex = times.findIndex((t) => t * 1000 > now.getTime())
  const endIndex = (nowIndex === -1 ? times.length : nowIndex) - 1
  const startIndex = endIndex - 23
  if (endIndex < 0 || startIndex < 0) return null
  let sum = 0
  for (let i = startIndex; i <= endIndex; i++) sum += values[i] ?? 0
  return Math.round(sum * 10) / 10
}

async function fetchBatch(points, attempt = 0) {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', points.map((p) => p.lat.toFixed(4)).join(','))
  url.searchParams.set('longitude', points.map((p) => p.lon.toFixed(4)).join(','))
  url.searchParams.set('hourly', 'precipitation')
  url.searchParams.set('past_days', '1')
  url.searchParams.set('forecast_days', '1')
  url.searchParams.set('timezone', 'Europe/Paris')
  url.searchParams.set('timeformat', 'unixtime')
  url.searchParams.set('models', 'best_match')

  // fetch() lui-même peut rejeter (timeout de connexion, DNS, etc. — observé
  // en usage réel sur le runner GitHub Actions : "ConnectTimeoutError" isolé
  // au milieu d'une série de lots par ailleurs valides), pas seulement
  // renvoyer un statut HTTP en erreur. Les deux cas méritent un retry avec
  // pause croissante, une erreur définitive (400 mauvais paramètre, etc.) non.
  const MAX_ATTEMPTS = 5
  let res
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  } catch (err) {
    if (attempt >= MAX_ATTEMPTS) throw err
    console.log(`${err.message}, retry dans ${4 * (attempt + 1)}s…`)
    await wait(4000 * (attempt + 1))
    return fetchBatch(points, attempt + 1)
  }
  // 429 = rate-limit ; 5xx = erreur transitoire côté Open-Meteo (503 isolé
  // déjà observé aussi).
  if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
    console.log(`${res.status}, retry dans ${4 * (attempt + 1)}s…`)
    await wait(4000 * (attempt + 1))
    return fetchBatch(points, attempt + 1)
  }
  if (!res.ok) throw new Error(`Open-Meteo: ${res.status}`)

  const data = await res.json()
  const results = Array.isArray(data) ? data : [data]
  return results.map((entry) => {
    const hourly = entry?.hourly
    if (!hourly) return null
    return rolling24hSum(hourly.time, hourly.precipitation)
  })
}

const OUTPUT_PATH = new URL('../public/rain-grid.json', import.meta.url)

// Charge la grille déjà en place (toutes tranches confondues, éventuellement
// d'un cycle précédent) pour ne modifier que les points de CETTE tranche —
// un overwrite complet effacerait le travail des autres tranches pas encore
// repassées dans le cycle en cours.
async function loadExistingPoints() {
  try {
    const raw = await readFile(OUTPUT_PATH, 'utf-8')
    const data = JSON.parse(raw)
    const byKey = new Map()
    for (const p of data.points ?? []) byKey.set(pointKey(p), p)
    return byKey
  } catch {
    return new Map() // premier run, ou fichier absent/corrompu
  }
}

async function writeMergedPoints(byKey, allPoints) {
  // Toujours écrire la liste COMPLÈTE des points de la grille actuelle (pas
  // seulement ceux déjà vus) : si la bbox/le pas a changé depuis le dernier
  // run, les nouveaux points apparaissent à null plutôt que d'être absents.
  const merged = allPoints.map((p) => byKey.get(pointKey(p)) ?? { lat: p.lat, lon: p.lon, rain24h: null })
  const output = { fetchedAt: new Date().toISOString(), points: merged }
  await writeFile(OUTPUT_PATH, JSON.stringify(output))
  return merged
}

// Au-delà de ce taux de lots en échec, la tranche est jugée trop dégradée
// pour être mise en ligne — mieux vaut garder les valeurs précédentes de
// ces points (encore assez fraîches, rafraîchies au plus tard au cycle
// précédent) que de les remplacer par des trous affichés comme "0mm"
// (RainOverlay traite null comme 0, voir son commentaire) : ça pourrait
// laisser croire à tort qu'une zone est sèche. En dessous du seuil,
// quelques trous isolés sont un compromis acceptable plutôt que de perdre
// toute la tranche pour un 429 ponctuel.
const MAX_FAILED_BATCH_RATIO = 0.05

async function main() {
  const allPoints = buildGridPoints()
  const slicePoints = allPoints.filter((_, i) => i % SLICE_COUNT === SLICE_INDEX)
  const batches = chunk(slicePoints, BATCH_SIZE)
  const existing = await loadExistingPoints()

  console.log(
    `Grille complète : ${allPoints.length} points. Tranche ${SLICE_INDEX + 1}/${SLICE_COUNT} : ${slicePoints.length} points, ${batches.length} lots.`,
  )

  let failedBatches = 0
  for (const [i, batch] of batches.entries()) {
    if (i > 0) await wait(BATCH_DELAY_MS)

    // Un lot qui échoue malgré les retries ne doit pas faire perdre tout le
    // travail déjà fait sur les lots précédents de cette tranche — on garde
    // la valeur précédente du point (pas null, voir MAX_FAILED_BATCH_RATIO
    // ci-dessus) et on continue plutôt que de planter tout de suite.
    let values
    try {
      values = await fetchBatch(batch)
    } catch (err) {
      failedBatches++
      console.log(`Lot ${i + 1}/${batches.length} abandonné (${err.message}).`)
      values = batch.map((p) => existing.get(pointKey(p))?.rain24h ?? null)
    }

    batch.forEach((p, j) => existing.set(pointKey(p), { lat: p.lat, lon: p.lon, rain24h: values[j] }))
    // Écrit sur le disque du runner après chaque lot (pas seulement à la
    // fin) : rien n'est perdu en cas de Ctrl-C/timeout. Sans conséquence
    // tant que l'étape "Commit si changement" du workflow n'a pas tourné.
    await writeMergedPoints(existing, allPoints)
    console.log(`Lot ${i + 1}/${batches.length} ok.`)
  }

  const failedRatio = batches.length === 0 ? 0 : failedBatches / batches.length
  console.log(`Terminé : ${failedBatches}/${batches.length} lot(s) en échec sur cette tranche (${Math.round(failedRatio * 100)}%).`)

  if (failedRatio > MAX_FAILED_BATCH_RATIO) {
    // Le fichier local reste écrit (utile pour inspection dans les logs du
    // job), mais on sort en erreur pour que l'étape "Commit si changement"
    // du workflow ne s'exécute pas — la grille en prod n'est pas remplacée
    // par une version trop dégradée sur cette tranche.
    console.error(`Trop de lots en échec (>${Math.round(MAX_FAILED_BATCH_RATIO * 100)}%) — run abandonné, rien ne sera commité.`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
