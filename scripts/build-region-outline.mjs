#!/usr/bin/env node
// Régénère src/data/midi-pyrenees-outline.json — le contour fusionné (une
// seule zone, sans les frontières internes entre départements) des 8
// départements de l'ex-région Midi-Pyrénées. Pas exécuté automatiquement
// (contrairement à fetch-rain-grid.mjs) : ce contour ne change jamais, ce
// script sert juste de trace de comment il a été produit, à relancer à la
// main si jamais la source change.
//
// Dépendances non listées dans package.json (pas utiles à l'app elle-même,
// seulement à la génération) : avant de lancer ce script,
//   npm install --no-save @turf/union
import { union } from '@turf/union'
import { writeFile } from 'node:fs/promises'

const DEPARTEMENT_CODES = ['09', '12', '31', '32', '46', '65', '81', '82']

async function main() {
  // Source : gregoiredavid/france-geojson (dépôt communautaire basé sur les
  // données IGN Admin Express, licence ouverte), contours de tous les
  // départements français.
  const res = await fetch('https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/departements.geojson')
  if (!res.ok) throw new Error(`Téléchargement échoué : ${res.status}`)
  const data = await res.json()

  const features = data.features.filter((f) => DEPARTEMENT_CODES.includes(f.properties.code))
  if (features.length !== DEPARTEMENT_CODES.length) {
    throw new Error(`Attendu ${DEPARTEMENT_CODES.length} départements, trouvé ${features.length}`)
  }

  // Fusion en un seul contour (dissout les frontières internes) plutôt que
  // d'empiler 8 polygones séparés, qui laisserait apparaître les limites
  // départementales — la spec demande "une grande zone", pas un
  // patchwork.
  let merged = features[0]
  for (let i = 1; i < features.length; i++) {
    merged = union({ type: 'FeatureCollection', features: [merged, features[i]] })
  }
  merged.properties = { nom: 'Midi-Pyrénées (09, 12, 31, 32, 46, 65, 81, 82)' }

  const output = { type: 'FeatureCollection', features: [merged] }
  await writeFile(new URL('../src/data/midi-pyrenees-outline.json', import.meta.url), JSON.stringify(output))
  console.log('Écrit dans src/data/midi-pyrenees-outline.json')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
