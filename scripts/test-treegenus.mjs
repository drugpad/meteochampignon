#!/usr/bin/env node
// Test de la piste la plus sérieuse trouvée : une carte européenne des
// genres d'arbres à 10 m (projet ForestPaths, dérivée de Sentinel-1/2,
// publiée en accès libre), là où les essences que le service de référence
// AFFICHE viennent d'une grille à 1 km — cent fois plus grossière.
//
// Pourquoi c'est la bonne piste : leur fondateur décrit publiquement un
// algorithme fondé sur « les essences d'arbres, l'acidité du sol, l'altitude
// et l'exposition », et leur site précise que leurs cartes reposent sur
// « des données libres ou des données à forte valeur ajoutée générées en
// interne ». Or on a mesuré que les essences affichées (1 km) n'expliquent
// presque rien des écarts entre cases voisines. Une carte d'essences à 10 m
// réconcilie les deux : même algorithme, mais nourri à une résolution
// qu'ils n'affichent pas.
//
// Classes du raster : 0 Larix, 1 Picea, 2 Pinus, 3 Fagus (hêtre),
// 4 Quercus (chênes), 5 autres résineux, 6 autres feuillus, 7 sans arbres.
//
//   node scripts/test-treegenus.mjs <dossier-des-dalles> [--all]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fromFile } from 'geotiff'
import proj4 from 'proj4'

proj4.defs(
  'EPSG:3035',
  '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
)

const GENRES = ['Larix', 'Picea', 'Pinus', 'Fagus', 'Quercus', 'autres résineux', 'autres feuillus', 'sans arbres']
// Aptitude de chaque genre à porter le cèpe d'été : chênes et hêtre sont ses
// hôtes, les résineux ne le portent pas.
const APTITUDE = [0, 0, 0, 0.8, 1, 0, 0.3, 0]

const dir = process.argv[2]
if (!dir) {
  console.log('Usage : node scripts/test-treegenus.mjs <dossier-des-dalles> [--all]')
  process.exit(1)
}
const all = process.argv.includes('--all')

const fichiers = readdirSync(dir).filter((f) => /\.tif$/i.test(f))
console.log(`\n${fichiers.length} dalles trouvées dans ${dir}`)

// Ouverture de chaque dalle + mémorisation de son emprise, pour router
// ensuite chaque point vers la bonne.
const dalles = []
for (const f of fichiers) {
  try {
    const img = await (await fromFile(`${dir}/${f}`)).getImage()
    const [ox, oy] = img.getOrigin()
    const [rx, ry] = img.getResolution()
    dalles.push({
      nom: f,
      img,
      ox,
      oy,
      rx,
      ry,
      x1: ox,
      x2: ox + img.getWidth() * rx,
      y1: oy + img.getHeight() * ry,
      y2: oy,
    })
  } catch (err) {
    console.log(`  (dalle illisible : ${f})`)
  }
}
console.log(`${dalles.length} dalles ouvertes.\n`)

const points = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8')).points
const cibles = all
  ? points
  : points.filter((p) => p.lat > 43.1 && p.lat < 43.103 && p.lon > 0.213 && p.lon < 0.216)

// Fenêtre de N x N pixels de 10 m autour du point : on veut la composition
// du peuplement autour de la case, pas seulement le pixel central.
async function composition(lat, lon, half = 3) {
  const [x, y] = proj4('EPSG:4326', 'EPSG:3035', [lon, lat])
  const d = dalles.find((t) => x >= t.x1 && x < t.x2 && y > t.y1 && y <= t.y2)
  if (!d) return null
  const px = Math.floor((x - d.ox) / d.rx)
  const py = Math.floor((y - d.oy) / d.ry)
  const win = [px - half, py - half, px + half + 1, py + half + 1]
  if (win[0] < 0 || win[1] < 0 || win[2] > d.img.getWidth() || win[3] > d.img.getHeight()) return null
  const raster = await d.img.readRasters({ window: win, interleave: true })
  const cells = Array.from(raster)
  const n = cells.length
  const part = (code) => cells.filter((c) => c === code).length / n
  return {
    partQuercus: part(4),
    partFagus: part(3),
    partAutresFeuillus: part(6),
    partResineux: part(0) + part(1) + part(2) + part(5),
    partSansArbre: part(7),
    // Aptitude moyenne du voisinage : l'équivalent fin de « l'abondance
    // d'hôtes » qu'on calculait jusqu'ici sur des données à 1 km.
    aptitude: cells.reduce((s, c) => s + (APTITUDE[c] ?? 0), 0) / n,
    genreDominant: GENRES[cells.sort((a, b) => cells.filter((v) => v === a).length - cells.filter((v) => v === b).length).pop()] ?? null,
  }
}

const rows = []
let sansDonnee = 0
for (const [i, p] of cibles.entries()) {
  const c = await composition(p.lat, p.lon)
  if (!c) sansDonnee++
  rows.push({ ...p, ...(c ?? {}) })
  process.stdout.write(`\r  ${i + 1}/${cibles.length}`)
}
console.log('\n')
if (sansDonnee) console.log(`  (${sansDonnee} points hors des dalles disponibles)\n`)

function pearson(xs, ys) {
  const ok = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
  if (ok.length < 5) return NaN
  const a = ok.map((o) => o[0])
  const b = ok.map((o) => o[1])
  const ma = a.reduce((s, v) => s + v, 0) / a.length
  const mb = b.reduce((s, v) => s + v, 0) / b.length
  const num = a.reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0)
  const den = Math.sqrt(a.reduce((s, v) => s + (v - ma) ** 2, 0) * b.reduce((s, v) => s + (v - mb) ** 2, 0))
  return num / den
}

const avec = rows.filter((r) => Number.isFinite(r.aptitude))
const scores = avec.map((r) => r.score)
console.log(`=== Essences à 10 m vs leur score (${avec.length} points) ===`)
for (const k of ['aptitude', 'partQuercus', 'partFagus', 'partAutresFeuillus', 'partResineux', 'partSansArbre']) {
  console.log(`  ${k.padEnd(20)} r=${pearson(avec.map((r) => r[k]), scores).toFixed(3)}`)
}

console.log('\n  rappel — les mêmes essences vues à 1 km (ce que le service affiche) :')
const HOST = { chataignier: 1, chene_pedoncule: 1, chene_rouvre: 1, chene_pubescent: 0.85, hetre: 0.9, chene_vert: 0.5, noisetier: 0.35, charme: 0.3, bouleau: 0.15, merisier: 0.1, saule_marsault: 0.1, tremble: 0.05, chene_tauzin: 0.9, chene_chevelu: 0.85 }
const abondance1km = avec.map((r) => Object.entries(r.essences).reduce((s, [k, v]) => s + v * (HOST[k] ?? 0), 0))
console.log(`  abondance d'hôtes    r=${pearson(abondance1km, scores).toFixed(3)}`)

writeFileSync(new URL(all ? './treegenus-all.json' : './treegenus-cluster.json', import.meta.url), JSON.stringify(rows, null, 1))
console.log(`\nÉcrit dans scripts/${all ? 'treegenus-all.json' : 'treegenus-cluster.json'}`)
