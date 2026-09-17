#!/usr/bin/env node
// Et si on cherchait la donnée au mauvais endroit depuis le début ?
//
// On avait noté en début de projet que les coordonnées affichées par le
// service ne coïncident pas exactement avec la case qu'il calcule. Si leur
// grille est décalée de quelques dizaines de mètres par rapport aux
// coordonnées annoncées, alors tous les rasters externes qu'on échantillonne
// le sont au mauvais endroit — ce qui suffit à détruire n'importe quelle
// corrélation, même avec la bonne variable.
//
// On balaie donc systématiquement les décalages possibles : pour chaque
// (dx, dy), on ré-échantillonne la carte des genres d'arbres à 10 m et on
// mesure la corrélation avec leur score. Si un décalage particulier fait
// bondir la corrélation, on aura trouvé l'alignement de leur grille.
//
//   node scripts/test-offset.mjs <dossier-des-dalles>
import { readFileSync, readdirSync } from 'node:fs'
import { fromFile } from 'geotiff'
import proj4 from 'proj4'

proj4.defs(
  'EPSG:3035',
  '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
)
const APTITUDE = [0, 0, 0, 0.8, 1, 0, 0.3, 0] // Larix, Picea, Pinus, Fagus, Quercus, autres rés., autres feuil., sans arbre

const dir = process.argv[2]
const dalles = []
for (const f of readdirSync(dir).filter((f) => /\.tif$/i.test(f))) {
  try {
    const img = await (await fromFile(`${dir}/${f}`)).getImage()
    const [ox, oy] = img.getOrigin()
    const [rx, ry] = img.getResolution()
    dalles.push({ img, ox, oy, rx, ry, x1: ox, x2: ox + img.getWidth() * rx, y1: oy + img.getHeight() * ry, y2: oy })
  } catch {
    /* dalle illisible, ignorée */
  }
}

const points = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8')).points
const cluster = points.filter((p) => p.lat > 43.1 && p.lat < 43.103 && p.lon > 0.213 && p.lon < 0.216)
const scores = cluster.map((p) => p.score)

// Pré-chargement d'une grande fenêtre autour du cluster : on lit une fois
// pour toutes, puis on balaie les décalages en mémoire (sinon le balayage
// ferait des milliers de lectures disque).
const centre = proj4('EPSG:4326', 'EPSG:3035', [
  cluster.reduce((s, p) => s + p.lon, 0) / cluster.length,
  cluster.reduce((s, p) => s + p.lat, 0) / cluster.length,
])
const dalle = dalles.find((t) => centre[0] >= t.x1 && centre[0] < t.x2 && centre[1] > t.y1 && centre[1] <= t.y2)
if (!dalle) {
  console.log('Cluster hors des dalles disponibles.')
  process.exit(1)
}
const MARGE = 60 // pixels de 10 m autour du cluster
const pxC = Math.floor((centre[0] - dalle.ox) / dalle.rx)
const pyC = Math.floor((centre[1] - dalle.oy) / dalle.ry)
const win = [pxC - MARGE, pyC - MARGE, pxC + MARGE, pyC + MARGE]
const bloc = Array.from(await dalle.img.readRasters({ window: win, interleave: true }))
const largeur = win[2] - win[0]
const valeurA = (px, py) => {
  const i = (py - win[1]) * largeur + (px - win[0])
  return i >= 0 && i < bloc.length ? bloc[i] : null
}

function aptitudeAutour(lat, lon, dx, dy, half = 2) {
  const [x, y] = proj4('EPSG:4326', 'EPSG:3035', [lon, lat])
  const px = Math.floor((x + dx - dalle.ox) / dalle.rx)
  const py = Math.floor((y + dy - dalle.oy) / dalle.ry)
  let somme = 0
  let n = 0
  for (let i = -half; i <= half; i++) {
    for (let j = -half; j <= half; j++) {
      const v = valeurA(px + j, py + i)
      if (v === null) continue
      somme += APTITUDE[v] ?? 0
      n++
    }
  }
  return n ? somme / n : NaN
}

function pearson(xs, ys) {
  const ok = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
  if (ok.length < 5) return NaN
  const a = ok.map((o) => o[0])
  const b = ok.map((o) => o[1])
  const ma = a.reduce((s, v) => s + v, 0) / a.length
  const mb = b.reduce((s, v) => s + v, 0) / b.length
  const num = a.reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0)
  const den = Math.sqrt(a.reduce((s, v) => s + (v - ma) ** 2, 0) * b.reduce((s, v) => s + (v - mb) ** 2, 0))
  return den === 0 ? NaN : num / den
}

const PAS = [-80, -60, -40, -20, 0, 20, 40, 60, 80]
console.log(`\nBalayage des décalages sur ${cluster.length} cases du cluster (aptitude des essences à 10 m)\n`)
console.log('         ' + PAS.map((d) => String(d).padStart(7)).join('') + '   ← décalage est-ouest (m)')

let best = { r: 0 }
for (const dy of PAS) {
  const ligne = []
  for (const dx of PAS) {
    const r = pearson(cluster.map((p) => aptitudeAutour(p.lat, p.lon, dx, dy)), scores)
    ligne.push(Number.isFinite(r) ? (r >= 0 ? '+' : '') + r.toFixed(2) : '  n/a')
    if (Number.isFinite(r) && Math.abs(r) > Math.abs(best.r)) best = { r, dx, dy }
  }
  console.log(`  ${String(dy).padStart(5)} ` + ligne.map((s) => s.padStart(7)).join(''))
}
console.log('   ↑ décalage nord-sud (m)')
console.log(
  `\n  meilleur : décalage (${best.dx} m est, ${best.dy} m nord) → corrélation ${best.r.toFixed(3)}` +
    ` (contre ${pearson(cluster.map((p) => aptitudeAutour(p.lat, p.lon, 0, 0)), scores).toFixed(3)} sans décalage)`,
)
console.log(
  Math.abs(best.r) > 0.5
    ? "\n  → Un décalage franc fait apparaître la corrélation : leur grille n'est pas alignée\n    sur les coordonnées affichées, et on échantillonnait au mauvais endroit."
    : "\n  → Aucun décalage ne fait apparaître de corrélation : le problème n'est pas\n    l'alignement.",
)
