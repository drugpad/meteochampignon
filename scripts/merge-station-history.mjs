#!/usr/bin/env node
// Fusionne des points horaires fraîchement collectés (fichier temporaire
// { stationId: [{ time, rr1, temp }] }) dans public/station-history.json.
//
// Séparé de la collecte pour que les workflows puissent, avant chaque
// tentative de push, repartir de la dernière version de master
// (`git reset --hard origin/master`) puis refaire CETTE fusion — au lieu d'un
// `git rebase` : le fichier d'historique tient sur une seule ligne, donc deux
// jobs qui le modifient en parallèle (job horaire + rattrapage) se
// retrouvaient toujours en conflit de rebase et l'un des deux perdait ses
// points.
//
// Usage : node scripts/merge-station-history.mjs <fichier-temporaire>
//         (ou variable d'environnement HISTORY_TMP)
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const HISTORY_WINDOW_HOURS = 240 // 10 jours
const OUTPUT_PATH = new URL('../public/station-history.json', import.meta.url)

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf-8'))
  } catch {
    return fallback
  }
}

// Renvoie le nombre de points ajoutés. Ne touche pas aux points déjà
// présents (un doublon d'horodatage est ignoré, l'existant gagne).
export async function mergeStationHistory(tmpPath) {
  const collected = await readJson(tmpPath, {})
  const current = await readJson(OUTPUT_PATH, { fetchedAt: new Date().toISOString(), stations: {} })
  const cutoff = Date.now() - HISTORY_WINDOW_HOURS * 3600000
  let added = 0
  for (const [id, points] of Object.entries(collected)) {
    const existing = current.stations[id] ?? []
    const known = new Set(existing.map((p) => p.time))
    const fresh = points.filter((p) => !known.has(p.time))
    added += fresh.length
    current.stations[id] = [...existing, ...fresh]
      .filter((p) => new Date(p.time).getTime() >= cutoff)
      .sort((a, b) => a.time.localeCompare(b.time))
  }
  if (added > 0) current.fetchedAt = new Date().toISOString()
  await writeFile(OUTPUT_PATH, JSON.stringify(current))
  return added
}

// Exécuté directement (pas importé par backfill-station-history.mjs).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tmpPath = process.argv[2] ?? process.env.HISTORY_TMP
  if (!tmpPath) {
    console.error('Usage : node merge-station-history.mjs <fichier-temporaire>')
    process.exit(1)
  }
  mergeStationHistory(tmpPath)
    .then((added) => console.log(`${added} points ajoutés à public/station-history.json`))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
