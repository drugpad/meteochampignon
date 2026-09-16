#!/usr/bin/env node
// Génère et vérifie (MNT réel + contour région) des points d'échantillonnage
// contrôlé pour affiner le modèle biotope — voir scripts/compare-calibration.mjs.
// Usage: node scripts/generate-sample-points.mjs

import fs from 'node:fs'

const outline = JSON.parse(fs.readFileSync(new URL('../src/data/midi-pyrenees-outline.json', import.meta.url)))
const polygons = outline.features[0].geometry.coordinates // MultiPolygon: [poly][ring][point]

function pointInRing(lon, lat, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function insideRegion(lat, lon) {
  return polygons.some((poly) => pointInRing(lon, lat, poly[0]))
}

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
  const [sw, s, se, w, , e, nw, n, ne] = z
  const dzdx = (se + 2 * e + ne - (sw + 2 * w + nw)) / (8 * cell)
  const dzdy = (nw + 2 * n + ne - (sw + 2 * s + se)) / (8 * cell)
  return {
    altitude: z[4],
    slopeDeg: (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI,
    aspectDeg: ((Math.atan2(-dzdx, -dzdy) * 180) / Math.PI + 360) % 360,
  }
}

function destPoint(lat, lon, bearingDeg, distM) {
  const R = 6371000
  const brng = (bearingDeg * Math.PI) / 180
  const lat1 = (lat * Math.PI) / 180
  const lon1 = (lon * Math.PI) / 180
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distM / R) + Math.cos(lat1) * Math.sin(distM / R) * Math.cos(brng))
  const lon2 =
    lon1 + Math.atan2(Math.sin(brng) * Math.sin(distM / R) * Math.cos(lat1), Math.cos(distM / R) - Math.sin(lat1) * Math.sin(lat2))
  return { lat: (lat2 * 180) / Math.PI, lon: (lon2 * 180) / Math.PI }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchSoilPhAt(lat, lon, retries = 3) {
  const url =
    `https://rest.isric.org/soilgrids/v2.0/properties/query` +
    `?lon=${lon}&lat=${lat}&property=phh2o&depth=5-15cm&value=mean`
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
      if (!res.ok) return null
      const data = await res.json()
      const raw = data.properties?.layers?.[0]?.depths?.[0]?.values?.mean
      return raw == null ? null : raw / 10 // SoilGrids renvoie le pH x10
    } catch (e) {
      if (attempt === retries - 1) return `ERREUR (${e.message})`
      await sleep(2000)
    }
  }
}

async function phScan(candidates, label) {
  console.log(`\n=== ${label} ===`)
  for (const [name, lat, lon] of candidates) {
    const inside = insideRegion(lat, lon)
    const ph = inside ? await fetchSoilPhAt(lat, lon) : null
    console.log(`${name.padEnd(30)} ${lat}, ${lon}  ` + (inside ? `pH(eau)=${ph}` : 'HORS CONTOUR - rejeté'))
    await sleep(600)
  }
}

async function forestScan(candidates, label) {
  console.log(`\n=== ${label} ===`)
  for (const [name, lat, lon] of candidates) {
    const inside = insideRegion(lat, lon)
    if (!inside) {
      console.log(`${name.padEnd(30)} ${lat}, ${lon}  HORS CONTOUR - rejeté`)
      continue
    }
    const m = 0.001 // ~100m de marge autour du point
    const bbox = `${lat - m},${lon - m},${lat + m},${lon + m},urn:ogc:def:crs:EPSG::4326`
    const url =
      `https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature` +
      `&TYPENAMES=BDFORETV1_BDD_FXX_LAMB93_20140403:resu_bdv1_shape` +
      `&BBOX=${bbox}&COUNT=1&OUTPUTFORMAT=application/json&PROPERTYNAME=libelle`
    let label2 = 'requête échouée'
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
        if (res.ok) {
          const data = await res.json()
          label2 = data.features?.[0]?.properties?.libelle ?? 'pas de donnée forêt ici'
        }
        break
      } catch (e) {
        if (attempt === 2) label2 = `ERREUR (${e.message})`
        else await sleep(2000)
      }
    }
    console.log(`${name.padEnd(30)} ${lat}, ${lon}  -> ${label2}`)
    await sleep(600)
  }
}

async function ringAroundHill(centerLat, centerLon, radiusM, label) {
  console.log(`\n=== ${label} : centre ${centerLat}, ${centerLon}, rayon ${radiusM}m ===`)
  const bearings = [0, 45, 90, 135, 180, 225, 270, 315]
  const rows = []
  for (const b of bearings) {
    const { lat, lon } = destPoint(centerLat, centerLon, b, radiusM)
    const inside = insideRegion(lat, lon)
    const terrain = inside ? await fetchTerrainEuDem(lat, lon) : null
    rows.push({ bearing: b, lat, lon, inside, ...terrain })
    await sleep(1100) // OpenTopoData: ~1 req/s
  }
  for (const r of rows) {
    console.log(
      `bearing ${String(r.bearing).padStart(3)}° -> ${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}  ` +
        (r.inside
          ? `alt=${r.altitude?.toFixed(0)}m pente=${r.slopeDeg?.toFixed(1)}° orient=${r.aspectDeg?.toFixed(0)}°`
          : 'HORS CONTOUR - rejeté'),
    )
  }
  return rows
}

async function transect(startLat, startLon, bearingDeg, distances, label) {
  console.log(`\n=== ${label} : départ ${startLat}, ${startLon}, cap ${bearingDeg}° ===`)
  const rows = []
  for (const d of distances) {
    const { lat, lon } = destPoint(startLat, startLon, bearingDeg, d)
    const inside = insideRegion(lat, lon)
    const terrain = inside ? await fetchTerrainEuDem(lat, lon) : null
    rows.push({ d, lat, lon, inside, ...terrain })
    await sleep(1100)
  }
  for (const r of rows) {
    console.log(
      `d=${String(r.d).padStart(4)}m -> ${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}  ` +
        (r.inside
          ? `alt=${r.altitude?.toFixed(0)}m pente=${r.slopeDeg?.toFixed(1)}° orient=${r.aspectDeg?.toFixed(0)}°`
          : 'HORS CONTOUR - rejeté'),
    )
  }
  return rows
}

async function main() {
  const only = process.argv[2] // 'A' | 'B' | 'C' | 'D' | undefined = tout
  if (only && only !== 'A') {
    // sauté
  } else await ringOnly()
  if (only && only !== 'B') {
    // sauté
  } else await transectOnly()
  if (only && only !== 'C') {
    // sauté
  } else await phOnly()
  if (only && only !== 'D') {
    // sauté
  } else await forestOnly()
}

async function ringOnly() {
  // Centre pris sur un point de calibration déjà vérifié (Hautes-Pyrénées,
  // relief réel confirmé : alt 527m, pente 15°, orientation 195° au centre)
  // plutôt qu'un lieu-dit choisi de mémoire (source d'erreur précédente).
  await ringAroundHill(43.086779, 0.313968, 200, "Série A - ring orientation (Tilhouse, Hautes-Pyrénées)")
}

async function transectOnly() {
  // Transect altitude : point d'ancrage 42.868315/0.586271 (Ariège, déjà
  // vérifié, alt 1366m, pente 26°, orientation 175° = versant sud) — on
  // descend le long de la pente (cap = orientation, donc vers l'aval) pour
  // garder une orientation à peu près constante et ne faire varier que
  // l'altitude.
  await transect(42.868315, 0.586271, 175, [0, 300, 600, 900, 1200, 1500], 'Série B - transect altitude (Ariège, versant sud)')
}

async function phOnly() {
  // Série C - contraste pH : causses calcaires (Lot/Aveyron, pH élevé
  // attendu) vs zones granitiques/schisteuses du Massif Central (Tarn/
  // Aveyron, pH acide attendu). Candidats larges, vérifiés un par un.
  await phScan(
    [
      ['Causse de Gramat (Lot)', 44.75, 1.72],
      ['Causse Comtal (Aveyron)', 44.35, 2.55],
      ['Causse de Séverac (Aveyron)', 44.32, 3.07],
      ['Sidobre granitique (Tarn)', 43.62, 2.42],
      ['Monts de Lacaune (Tarn)', 43.72, 2.68],
      ['Margeride / Aubrac fringe (Aveyron)', 44.62, 2.95],
    ],
    'Série C - contraste pH (causse calcaire vs granite/schiste)',
  )
}

async function forestOnly() {
  // Série D - plantations de résineux : zones connues de reboisement pin/
  // sapin dans les Monts de Lacaune et le Lévézou (Tarn/Aveyron), pour
  // enfin avoir des points où l'essence hôte du cèpe d'été est absente.
  await forestScan(
    [
      ['Lacaune centre (confirmé sapin-épicéa)', 43.7, 2.7],
      ['Lacaune +500m N', 43.7045, 2.7],
      ['Lacaune +500m E', 43.7, 2.7062],
      ['Lacaune +500m S', 43.6955, 2.7],
      ['Lacaune +500m W', 43.7, 2.6938],
      ['Lacaune +1km NE', 43.7064, 2.7089],
      ['Lacaune +1km SE', 43.6936, 2.7089],
      ['Lacaune +1km SW', 43.6936, 2.6911],
    ],
    'Série D - plantations de résineux autour du point confirmé (Lacaune, Tarn)',
  )
}

main()
