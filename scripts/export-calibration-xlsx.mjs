#!/usr/bin/env node
// Exporte les points de calibration (scripts/calibration-dataset.json) en
// classeur Excel lisible.
//
//   node scripts/export-calibration-xlsx.mjs [chemin-de-sortie.xlsx]
//
// Trois feuilles : les points avec toutes leurs données, la table des
// aptitudes par essence (référencée par une formule, donc modifiable), et
// une feuille de notes sur la provenance des données.
import { readFileSync } from 'node:fs'
import ExcelJS from 'exceljs'

const FONT = { name: 'Arial', size: 10 }
const FONT_BOLD = { ...FONT, bold: true }

// Aptitude de chaque essence à porter le cèpe d'été (Boletus aestivalis),
// mycorhizien : chêne et châtaignier en tête, hêtre juste derrière, aucun
// résineux. Reprise de scripts/compare-calibration.mjs.
const HOST_APTITUDE = {
  chataignier: 1, chene_pedoncule: 1, chene_rouvre: 1, chene_tauzin: 0.9,
  chene_pubescent: 0.85, chene_chevelu: 0.85, hetre: 0.9, chene_vert: 0.5,
  noisetier: 0.35, charme: 0.3, bouleau: 0.15, merisier: 0.1,
  saule_marsault: 0.1, tremble: 0.05,
}

const LABELS = {
  chataignier: 'Châtaignier', hetre: 'Hêtre commun', chene_pedoncule: 'Chêne pédonculé',
  chene_rouvre: 'Chêne rouvre', chene_pubescent: 'Chêne pubescent', chene_tauzin: 'Chêne tauzin',
  chene_vert: 'Chêne vert', chene_chevelu: 'Chêne chevelu', frene: 'Frêne commun',
  frene_orne: 'Frêne orne', bouleau: 'Bouleau verruqueux', saule_marsault: 'Saule marsault',
  epicea: 'Épicéa commun', epicea_sitka: 'Épicéa de Sitka', merisier: 'Merisier',
  tremble: 'Tremble', pin_noir: 'Pin noir', pin_sylvestre: 'Pin sylvestre',
  pin_maritime: 'Pin maritime', pin_mugo: 'Pin mugo', aulne: 'Aulne glutineux',
  noisetier: 'Noisetier', robinier: 'Robinier faux-acacia', sapin_blanc: 'Sapin blanc',
  douglas: 'Sapin de Douglas', erable: 'Érable champêtre', erable_sycomore: 'Érable sycomore',
  charme: 'Charme commun', tilleul: 'Tilleul', sorbier: 'Sorbier des oiseaux',
}

const APT_NOTES = {
  chataignier: 'Hôte de prédilection', chene_pedoncule: 'Hôte de prédilection',
  chene_rouvre: 'Hôte de prédilection', chene_tauzin: 'Chêne, un cran en dessous',
  chene_pubescent: 'Chêne de sols plus secs et calcaires', chene_chevelu: 'Chêne, peu fréquent ici',
  hetre: 'Hôte fréquent, juste derrière les chênes', chene_vert: 'Porte surtout d’autres bolets',
  noisetier: 'Accompagnateur, rarement porteur seul', charme: 'Accompagnateur',
  bouleau: 'Porte d’autres espèces (bolet rude)', merisier: 'Marginal',
  saule_marsault: 'Marginal', tremble: 'Marginal',
}

const data = JSON.parse(readFileSync(new URL('./calibration-dataset.json', import.meta.url), 'utf8'))
const points = data.points

// Toutes les essences rencontrées, hôtes d'abord (par aptitude décroissante)
// puis les autres : les colonnes qui comptent sont ainsi les plus à gauche.
const seen = new Set()
for (const p of points) for (const k of Object.keys(p.essences)) seen.add(k)
const species = [...seen].sort((a, b) => {
  const d = (HOST_APTITUDE[b] ?? 0) - (HOST_APTITUDE[a] ?? 0)
  return d !== 0 ? d : (LABELS[a] ?? a).localeCompare(LABELS[b] ?? b)
})

// Lignes qu'occuperont les aptitudes dans leur feuille — connues d'avance,
// ce qui permet d'écrire la feuille Points en premier (donc en premier
// onglet) tout en référençant l'autre.
const APT_FIRST = 2
const APT_LAST = species.length + 1

const colLetter = (n) => {
  let s = ''
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26 }
  return s
}

const wb = new ExcelJS.Workbook()
wb.creator = 'Météo Midi-Pyrénées'
wb.created = new Date()

// --- Feuille 1 : les points --------------------------------------------
const ws = wb.addWorksheet('Points')
const fixedCols = [
  { header: 'N°', key: 'n', width: 5 },
  { header: 'Latitude', key: 'lat', width: 12 },
  { header: 'Longitude', key: 'lon', width: 12 },
  { header: 'Score /100', key: 'score', width: 11 },
  { header: 'Libellé', key: 'libelle', width: 26 },
  { header: 'Altitude (m)', key: 'altitude', width: 12 },
  { header: 'pH du sol', key: 'ph', width: 10 },
  { header: 'Orientation (°)', key: 'orientation', width: 14 },
  { header: 'Pente (°)', key: 'pente', width: 10 },
  { header: 'Abondance hôtes', key: 'hotes', width: 16 },
]
ws.columns = [...fixedCols, ...species.map((s) => ({ header: LABELS[s] ?? s, key: s, width: 15 }))]

const FIRST = colLetter(fixedCols.length + 1)
const LAST = colLetter(fixedCols.length + species.length)

points.forEach((p, i) => {
  const row = {
    n: i + 1, lat: p.lat, lon: p.lon, score: p.score, libelle: p.libelle ?? '',
    altitude: p.altitude, ph: p.ph, orientation: p.orientation, pente: p.pente,
  }
  for (const s of species) row[s] = p.essences[s] ?? 0
  const added = ws.addRow(row)
  // Somme des essences pondérée par leur aptitude (feuille Aptitudes) :
  // c'est la variable la mieux corrélée au score après le pH. En formule
  // plutôt qu'en valeur figée, pour pouvoir retoucher les aptitudes et voir
  // l'effet immédiatement.
  added.getCell('hotes').value = {
    formula: `SUMPRODUCT(${FIRST}${added.number}:${LAST}${added.number},Aptitudes!$B$${APT_FIRST}:$B$${APT_LAST})`,
  }
})

ws.getRow(1).font = FONT_BOLD
ws.eachRow((r, i) => { if (i > 1) r.font = FONT })
ws.getColumn('lat').numFmt = '0.000000'
ws.getColumn('lon').numFmt = '0.000000'
ws.getColumn('ph').numFmt = '0.0'
ws.getColumn('hotes').numFmt = '0.0'
ws.views = [{ state: 'frozen', xSplit: 4, ySplit: 1 }]
ws.autoFilter = { from: 'A1', to: `${LAST}1` }

// --- Feuille 2 : les aptitudes (référencées ci-dessus) ------------------
const apt = wb.addWorksheet('Aptitudes')
apt.columns = [
  { header: 'Essence', key: 'nom', width: 24 },
  { header: 'Aptitude cèpe d’été', key: 'apt', width: 20 },
  { header: 'Justification', key: 'note', width: 52 },
]
for (const s of species) {
  apt.addRow({ nom: LABELS[s] ?? s, apt: HOST_APTITUDE[s] ?? 0, note: APT_NOTES[s] ?? 'Non hôte du cèpe d’été' })
}
apt.getRow(1).font = FONT_BOLD
apt.getColumn('apt').numFmt = '0.00'
apt.eachRow((r, i) => { if (i > 1) r.font = FONT })
apt.views = [{ state: 'frozen', ySplit: 1 }]

// --- Feuille 3 : provenance des données ---------------------------------
const notes = wb.addWorksheet('Notes')
notes.columns = [{ header: '', key: 'a', width: 22 }, { header: '', key: 'b', width: 96 }]
const NOTES = [
  ['Contenu', `${points.length} points de calibration relevés pour le cèpe d’été (Boletus aestivalis).`],
  ['Provenance', 'Valeurs affichées par le service chasseursdechampignons.com (abonnement personnel), relevées le 09/09/2026.'],
  ['Usage', 'Servent à vérifier notre propre modèle de potentiel biotope, calculé à partir de données ouvertes.'],
  ['', ''],
  ['Score /100', 'Note de potentiel biotope attribuée par le service, pour le cèpe d’été.'],
  ['Altitude', 'Altitude moyenne de la cellule. Correspond au MNT européen EU-DEM 25 m.'],
  ['pH du sol', 'pH mesuré en CaCl2 (environ 0,7 point sous le pH mesuré en eau de SoilGrids).'],
  ['Orientation', 'Direction vers laquelle descend la pente, en degrés depuis le nord (180° = plein sud).'],
  ['Pente', 'Pente en degrés, formule de Horn sur fenêtre de 25 m.'],
  ['Essences', 'Probabilité de présence par espèce ("rpp"), jeu JRC/FISE à 1 km, lu en interpolation bilinéaire.'],
  ['', 'Ce sont des probabilités indépendantes : leur somme dépasse 100 % et n’a pas à être normalisée.'],
  ['Abondance hôtes', 'Colonne calculée : somme des essences pondérées par leur aptitude (voir feuille Aptitudes).'],
  ['', ''],
  ['Note de lecture', 'Les cellules "Abondance hôtes" contiennent une formule, calculée par Excel à l’ouverture.'],
]
for (const [a, b] of NOTES) notes.addRow({ a, b })
notes.eachRow((r) => { r.font = FONT; r.getCell(1).font = FONT_BOLD; r.alignment = { vertical: 'top' } })

const out = process.argv[2] ?? 'points-calibration-cepe-ete.xlsx'
await wb.xlsx.writeFile(out)
console.log(`${points.length} points, ${species.length} essences → ${out}`)
