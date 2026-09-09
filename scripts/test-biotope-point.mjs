#!/usr/bin/env node
// Évalue le potentiel biotope d'un point précis et affiche le détail de
// chaque critère — sert à calibrer le modèle (src/lib/biotope.ts) en
// comparant à des points de référence connus sur le terrain.
//
//   node scripts/test-biotope-point.mjs 43.086779 0.313968
//
// Toutes les sources sont ouvertes et sans clé :
//   - altitude / pente / orientation : deux MNT, comparés côte à côte —
//     RGE ALTI (IGN, 1-5m, le plus précis) et EU-DEM 25m (européen, via
//     OpenTopoData). Voir la note "MNT de référence" plus bas.
//   - essence forestière : BD Forêt V1 (IGN, WFS data.geopf.fr)
//   - pH du sol : SoilGrids (ISRIC, rest.isric.org), en pH eau
//
// == MNT de référence ==
// Sur le point de calibration 43.086779 / 0.313968, le service commercial
// de référence affiche alt 527m, pente 15°, orientation 195° (Sud).
//   - RGE ALTI (IGN)  → 517m, 10.6°, 189°
//   - EU-DEM 25m      → 525.5m, 14.6°, 185°  ← colle à leurs valeurs
// Leur chaîne repose donc très probablement sur EU-DEM 25m, pas sur les
// données IGN. Le script affiche les deux : EU-DEM pour comparer à eux,
// RGE ALTI parce qu'il est objectivement plus précis (1-5m contre 25m) et
// que c'est lui qu'on voudra pour la version régionale (API IGN batchable,
// contrairement à OpenTopoData qui est limité à ~1 requête/seconde).
//
// ⚠ La formule de score est dupliquée depuis src/lib/biotope.ts (script Node
// pur, pas de build TS ici) — même compromis que fetch-rain-grid.mjs vs
// lib/rainGrid.ts : à garder synchronisé à la main.

import { readSpeciesComposition } from './lib-species.mjs'

const SAMPLE_DISTANCE_M = 30

// Aptitude de chaque essence à porter le cèpe d'été (Boletus aestivalis),
// qui est mycorhizien : sans arbre hôte compatible, pas de cèpe, quelles que
// soient les conditions de terrain. Chêne et châtaignier sont ses hôtes de
// prédilection, le hêtre juste derrière ; les résineux ne le portent pas
// (ce sont d'autres bolets qui les accompagnent).
const HOST_APTITUDE = {
  'quercus.robur': 1,
  'quercus.cerris': 0.9,
  'castanea.sativa': 1,
  'fagus.sylvatica': 0.95,
  'quercus.ilex': 0.6, // chêne vert : porte surtout d'autres bolets
  'quercus.suber': 0.5,
  'corylus.avellana': 0.35,
  'prunus.avium': 0.1,
  'salix.caprea': 0.1,
  'abies.alba': 0,
  'pinus.sylvestris': 0,
  'pinus.nigra': 0,
  'pinus.halepensis': 0,
  'pinus.pinea': 0,
  'olea.europaea': 0,
}

// --- Récupération des entrées ------------------------------------------

// Altitude au point + pente/orientation calculées sur une grille 3x3 de
// 30m autour (formule de Horn, la référence en analyse de MNT).
async function fetchTerrain(lat, lon) {
  const dLat = SAMPLE_DISTANCE_M / 111320
  const dLon = SAMPLE_DISTANCE_M / (111320 * Math.cos((lat * Math.PI) / 180))
  const lats = []
  const lons = []
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      lats.push((lat + i * dLat).toFixed(6))
      lons.push((lon + j * dLon).toFixed(6))
    }
  }

  const url =
    `https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json` +
    `?lon=${lons.join('|')}&lat=${lats.join('|')}&resource=ign_rge_alti_wld&delimiter=|`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`RGE ALTI : ${res.status}`)
  const data = await res.json()
  const z = data.elevations.map((e) => e.z)

  // Ordre de la grille : sud→nord (i), ouest→est (j).
  const [sw, s, se, w, center, e, nw, n, ne] = z
  const cell = SAMPLE_DISTANCE_M
  const dzdx = (se + 2 * e + ne - (sw + 2 * w + nw)) / (8 * cell)
  const dzdy = (nw + 2 * n + ne - (sw + 2 * s + se)) / (8 * cell)

  return {
    altitude: center,
    slopeDeg: (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI,
    // Direction vers laquelle la pente descend, en degrés depuis le nord
    // (0 = nord, 90 = est, 180 = sud). C'est l'opposé du gradient (qui,
    // lui, pointe vers le haut de la pente).
    aspectDeg: ((Math.atan2(-dzdx, -dzdy) * 180) / Math.PI + 360) % 360,
  }
}

async function fetchForest(lat, lon) {
  const m = 0.001 // ~100m de marge autour du point
  const bbox = `${lat - m},${lon - m},${lat + m},${lon + m},urn:ogc:def:crs:EPSG::4326`
  const url =
    `https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature` +
    `&TYPENAMES=BDFORETV1_BDD_FXX_LAMB93_20140403:resu_bdv1_shape` +
    `&BBOX=${bbox}&COUNT=1&OUTPUTFORMAT=application/json&PROPERTYNAME=libelle`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`BD Forêt : ${res.status}`)
  const data = await res.json()
  return data.features[0]?.properties?.libelle ?? null
}

// Même calcul de pente/orientation, mais sur EU-DEM 25m (le MNT que semble
// utiliser le service de référence — voir l'en-tête). Fenêtre de 25m, soit
// la résolution native du MNT.
async function fetchTerrainEuDem(lat, lon, cell = 25) {
  const dLat = cell / 111320
  const dLon = cell / (111320 * Math.cos((lat * Math.PI) / 180))
  const points = []
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      points.push(`${(lat + i * dLat).toFixed(7)},${(lon + j * dLon).toFixed(7)}`)
    }
  }

  const res = await fetch(`https://api.opentopodata.org/v1/eudem25m?locations=${points.join('|')}`)
  if (!res.ok) return null
  const data = await res.json()
  if (!data.results) return null
  const z = data.results.map((r) => r.elevation)

  const [sw, s, se, w, center, e, nw, n, ne] = z
  const dzdx = (se + 2 * e + ne - (sw + 2 * w + nw)) / (8 * cell)
  const dzdy = (nw + 2 * n + ne - (sw + 2 * s + se)) / (8 * cell)

  return {
    altitude: center,
    // "Altitude moyenne" de la cellule, comme l'affiche le service de
    // référence — moyenne des 9 échantillons plutôt que la valeur centrale.
    altitudeMean: z.reduce((a, b) => a + b, 0) / z.length,
    slopeDeg: (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI,
    aspectDeg: ((Math.atan2(-dzdx, -dzdy) * 180) / Math.PI + 360) % 360,
  }
}

async function fetchSoilPh(lat, lon) {
  const url =
    `https://rest.isric.org/soilgrids/v2.0/properties/query` +
    `?lon=${lon}&lat=${lat}&property=phh2o&depth=5-15cm&value=mean`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = await res.json()
  const raw = data.properties?.layers?.[0]?.depths?.[0]?.values?.mean
  return raw == null ? null : raw / 10 // SoilGrids renvoie le pH x10
}

// --- Modèle de score (miroir de src/lib/biotope.ts) --------------------

// Score d'essence hôte à partir des probabilités de présence par espèce
// (EcoDataCube, 30m). On prend le meilleur hôte présent plutôt qu'une
// moyenne : un peuplement où le châtaignier est quasi certain vaut autant
// qu'un autre où châtaignier ET chêne le sont — un seul hôte suffit à
// porter le champignon. Les essences non hôtes ne pénalisent donc pas, mais
// une forêt qui n'a QUE des résineux tombe naturellement à zéro.
export function hostScoreFromSpecies(composition) {
  let best = 0
  for (const s of composition) {
    const aptitude = HOST_APTITUDE[s.id] ?? 0
    best = Math.max(best, (s.probability / 100) * aptitude)
  }
  return best
}

function hostScore(label) {
  if (!label) return 0 // hors forêt : pas de cèpe
  const l = label.toLowerCase()
  if (/châtaign|chataign/.test(l)) return 1
  if (/chêne|chene/.test(l)) return 1
  if (/hêtre|hetre/.test(l)) return 0.95
  if (/peupleraie|lande|friche|inculte|espace vert|verger|vigne/.test(l)) return 0.05
  if (/douglas|épicéa|epicea|sapin|pin\b|conifère|conifere/.test(l)) {
    return /feuillus majoritaires/.test(l) ? 0.5 : 0.15
  }
  if (/feuillus/.test(l)) {
    // Feuillus non identifiés : dans le Sud-Ouest, très majoritairement
    // chênes/châtaigniers, donc bon potentiel — juste un cran sous une
    // chênaie confirmée, faute de connaître l'essence exacte.
    // NB : les qualificatifs "pauvre / moyen / riche" de BD Forêt décrivent
    // la structure du peuplement (proportion futaie/taillis), pas la
    // qualité pour les champignons — un taillis de chênes est au contraire
    // un terrain à cèpes classique. On ne les pénalise donc pas.
    return 0.8
  }
  if (/boisement/.test(l)) return 0.6
  return 0.4
}

// Plateau optimal avec décroissance linéaire de part et d'autre.
function plateau(value, lowKo, lowOk, highOk, highKo) {
  if (value <= lowKo || value >= highKo) return 0
  if (value < lowOk) return (value - lowKo) / (lowOk - lowKo)
  if (value > highOk) return (highKo - value) / (highKo - highOk)
  return 1
}

// Cèpe d'été (Boletus aestivalis) : le plus précoce des cèpes, thermophile,
// donc favorisé par les versants chauds — contrairement au cèpe de Bordeaux
// qu'on cherchera plutôt à l'ombre en fin d'été.
function aspectScore(aspectDeg) {
  // 1 plein sud (180°), 0.35 plein nord — cosinus recentré sur le sud.
  const rad = ((aspectDeg - 180) * Math.PI) / 180
  return 0.35 + 0.65 * ((Math.cos(rad) + 1) / 2)
}

export function scoreCepeEte({ altitude, slopeDeg, aspectDeg, forestLabel, soilPh }) {
  const host = hostScore(forestLabel)
  const criteria = {
    altitude: plateau(altitude, 0, 250, 900, 1600),
    exposition: aspectScore(aspectDeg),
    pente: plateau(slopeDeg, -1, 3, 20, 40),
    ph: soilPh == null ? 0.7 : plateau(soilPh, 3.2, 4.5, 6.5, 7.8),
  }
  const weights = { altitude: 0.3, exposition: 0.25, pente: 0.2, ph: 0.25 }
  const terrain = Object.entries(criteria).reduce((sum, [k, v]) => sum + v * weights[k], 0)

  // L'essence hôte agit en multiplicateur, pas en simple moyenne : un
  // versant sud parfait dans une plantation d'épicéas ne donnera jamais de
  // cèpe d'été. Le terrain, lui, module entre 25% et 100% du potentiel.
  return {
    score: Math.round(100 * host * (0.25 + 0.75 * terrain)),
    host,
    criteria,
    terrain,
  }
}

// --- Point d'entrée ----------------------------------------------------

async function main() {
  const lat = Number(process.argv[2])
  const lon = Number(process.argv[3])
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    console.error('Usage : node scripts/test-biotope-point.mjs <lat> <lon>')
    process.exit(1)
  }

  const [terrain, euDem, forestLabel, soilPh] = await Promise.all([
    fetchTerrain(lat, lon),
    fetchTerrainEuDem(lat, lon),
    fetchForest(lat, lon),
    fetchSoilPh(lat, lon),
  ])

  // On score sur EU-DEM quand il répond, pour rester comparable au service
  // de référence ; sinon on retombe sur l'IGN.
  const terrainForScore = euDem ?? terrain
  const result = scoreCepeEte({ ...terrainForScore, forestLabel, soilPh })

  console.log(`\nPoint ${lat}, ${lon}`)
  console.log('─'.repeat(58))
  console.log('                  RGE ALTI (IGN)   EU-DEM 25m')
  const line = (name, a, b, unit) =>
    console.log(`${name.padEnd(16)}  ${(a + unit).padEnd(16)}  ${b === null ? '—' : b + unit}`)
  line('Altitude', terrain.altitude.toFixed(0), euDem ? euDem.altitudeMean.toFixed(0) : null, ' m')
  line('Pente', terrain.slopeDeg.toFixed(1), euDem ? euDem.slopeDeg.toFixed(1) : null, '°')
  line('Orientation', terrain.aspectDeg.toFixed(0), euDem ? euDem.aspectDeg.toFixed(0) : null, '°')
  console.log('─'.repeat(58))
  // Le service de référence affiche un pH nettement plus bas que SoilGrids
  // (5.2 contre 5.9 sur le point de calibration) : l'écart correspond à la
  // différence classique entre pH mesuré en CaCl2 et pH mesuré en eau
  // (~0.7 point). Ils utilisent donc probablement le pH CaCl2 des données
  // européennes LUCAS/ESDAC. On affiche les deux.
  console.log(`pH du sol     : ${soilPh ?? 'inconnu'} (eau) → ${soilPh ? (soilPh - 0.7).toFixed(1) : '?'} (CaCl2 estimé)`)
  console.log(`Peuplement    : ${forestLabel ?? 'hors forêt'}`)
  console.log('─'.repeat(58))
  console.log(`Essence hôte  : ${(result.host * 100).toFixed(0)}/100`)
  for (const [k, v] of Object.entries(result.criteria)) {
    console.log(`${k.padEnd(14)}: ${(v * 100).toFixed(0)}/100`)
  }
  console.log('─'.repeat(58))
  console.log(`SCORE CÈPE D'ÉTÉ : ${result.score}/100\n`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
