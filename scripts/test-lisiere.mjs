#!/usr/bin/env node
// La variable que tout ramasseur connaît et qu'on n'avait jamais testée :
// la LISIÈRE.
//
// Un cèpe pousse en bordure de massif, près d'une clairière, d'un chemin ou
// d'une trouée — pas au cœur d'une futaie fermée. Cette distance à la
// lisière varie sur quelques dizaines de mètres, exactement l'échelle de
// l'information qui nous manque (corrélation des résidus à 0.68 sous 30 m,
// nulle au-delà de 60 m).
//
// On la calcule sur la carte des genres d'arbres à 10 m déjà téléchargée :
// la classe « sans arbres » y matérialise clairières, chemins, prairies et
// bords de massif.
//
//   node scripts/test-lisiere.mjs <dossier-des-dalles> [--all]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fromFile } from 'geotiff'
import proj4 from 'proj4'

proj4.defs(
  'EPSG:3035',
  '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
)
const SANS_ARBRE = 7
const RESINEUX = new Set([0, 1, 2, 5])

const dir = process.argv[2]
const all = process.argv.includes('--all')
const dalles = []
for (const f of readdirSync(dir).filter((f) => /\.tif$/i.test(f))) {
  try {
    const img = await (await fromFile(`${dir}/${f}`)).getImage()
    const [ox, oy] = img.getOrigin()
    const [rx, ry] = img.getResolution()
    dalles.push({ img, ox, oy, rx, ry, x1: ox, x2: ox + img.getWidth() * rx, y1: oy + img.getHeight() * ry, y2: oy })
  } catch {
    /* dalle illisible */
  }
}

const points = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8')).points
const cibles = all ? points : points.filter((p) => p.lat > 43.1 && p.lat < 43.103 && p.lon > 0.213 && p.lon < 0.216)

const RAYON = 30 // pixels de 10 m → on regarde jusqu'à 300 m autour

async function mesures(lat, lon) {
  const [x, y] = proj4('EPSG:4326', 'EPSG:3035', [lon, lat])
  const d = dalles.find((t) => x >= t.x1 && x < t.x2 && y > t.y1 && y <= t.y2)
  if (!d) return null
  const px = Math.floor((x - d.ox) / d.rx)
  const py = Math.floor((y - d.oy) / d.ry)
  const win = [px - RAYON, py - RAYON, px + RAYON + 1, py + RAYON + 1]
  if (win[0] < 0 || win[1] < 0 || win[2] > d.img.getWidth() || win[3] > d.img.getHeight()) return null
  const bloc = Array.from(await d.img.readRasters({ window: win, interleave: true }))
  const largeur = win[2] - win[0]
  const at = (i, j) => bloc[(i + RAYON) * largeur + (j + RAYON)] // i,j relatifs au centre

  // Distance au pixel « sans arbre » le plus proche = distance à la lisière.
  let distLisiere = Infinity
  for (let i = -RAYON; i <= RAYON; i++) {
    for (let j = -RAYON; j <= RAYON; j++) {
      if (at(i, j) !== SANS_ARBRE) continue
      const dist = Math.hypot(i, j) * 10
      if (dist < distLisiere) distLisiere = dist
    }
  }

  // Ouverture du milieu à différentes échelles : part de « sans arbre ».
  const partOuvert = (rayonPx) => {
    let n = 0
    let ouv = 0
    for (let i = -rayonPx; i <= rayonPx; i++) {
      for (let j = -rayonPx; j <= rayonPx; j++) {
        if (Math.hypot(i, j) > rayonPx) continue
        n++
        if (at(i, j) === SANS_ARBRE) ouv++
      }
    }
    return ouv / n
  }

  // Diversité du peuplement autour : un mélange d'essences (donc plusieurs
  // genres différents dans le voisinage) plutôt qu'une plantation homogène.
  const voisins = []
  for (let i = -5; i <= 5; i++) for (let j = -5; j <= 5; j++) voisins.push(at(i, j))
  const genres = new Set(voisins.filter((v) => v !== SANS_ARBRE))

  return {
    distLisiere: Number.isFinite(distLisiere) ? distLisiere : 300,
    ouvert50: partOuvert(5),
    ouvert100: partOuvert(10),
    ouvert200: partOuvert(20),
    nbGenres: genres.size,
    partResineuxProche: voisins.filter((v) => RESINEUX.has(v)).length / voisins.length,
  }
}

const rows = []
for (const [i, p] of cibles.entries()) {
  rows.push({ ...p, ...((await mesures(p.lat, p.lon)) ?? {}) })
  process.stdout.write(`\r  ${i + 1}/${cibles.length}`)
}
console.log('\n')

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

const avec = rows.filter((r) => Number.isFinite(r.distLisiere))
const scores = avec.map((r) => r.score)
console.log(`=== Effet de lisière et d'ouverture du milieu (${avec.length} points) ===`)
for (const k of ['distLisiere', 'ouvert50', 'ouvert100', 'ouvert200', 'nbGenres', 'partResineuxProche']) {
  console.log(`  ${k.padEnd(20)} r=${pearson(avec.map((r) => r[k]), scores).toFixed(3)}`)
}
const d = avec.map((r) => r.distLisiere)
console.log(`\n  distance à la lisière observée : ${Math.min(...d)} à ${Math.max(...d)} m`)

writeFileSync(new URL(all ? './lisiere-all.json' : './lisiere-cluster.json', import.meta.url), JSON.stringify(rows, null, 1))
