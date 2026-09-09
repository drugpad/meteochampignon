// Carte de pluie 24h — Option B (précise, radar Météo-France).
//
// API souscrite le 09/09/2026 sur portail-api.meteofrance.fr :
// "Données radar" (DonneesPubliquesRadar v1), qui expose bien la "lame
// d'eau" (cumul de précipitations radar, produit ACRR) en plus de la
// réflectivité — voir la doc en ligne :
// https://portail-api.meteofrance.fr/web/fr/api/DonneesPubliquesRadar
//
// Auth : un token "API Key" généré depuis le portail (valide 1 an), à
// mettre dans VITE_METEOFRANCE_API_TOKEN (voir .env.example) et envoyé tel
// quel dans le header `apikey`.
//
// État d'avancement (vérifié le 09/09/2026 avec un vrai token) :
// - Zone "METROPOLE" confirmée sur /mosaiques.
// - Observation "LAME_D_EAU" confirmée sur /mosaiques/METROPOLE/observations
//   (à côté de "REFLECTIVITE").
// - /produit accepte un paramètre `maille` : 1000 (m) renvoie du
//   application/octet-stream+gzip, 500 (m) renvoie du application/x-hdf
//   (HDF5) — exactement ce qu'annonçait la spec (résolution 500m-1km).
// Le DÉCODAGE du fichier n'est PAS encore branché sur la carte : décoder du
// HDF5 (ou le GRIB probablement contenu dans le gzip à maille=1000) dans le
// navigateur demande soit une lib WASM dédiée (ex. h5wasm pour HDF5), soit
// une petite fonction serveur de conversion — dans les deux cas, ce n'est
// plus "quasi entièrement frontend" comme l'Option A. Prochaine étape :
// choisir l'une des deux approches et brancher le rendu sur RainOverlay
// (actuellement câblé uniquement sur la grille Open-Meteo) — voir CLAUDE.md.

const BASE_URL = 'https://public-api.meteofrance.fr/public/DPRadar/v1'

function apiKey(): string {
  const key = import.meta.env.VITE_METEOFRANCE_API_TOKEN
  if (!key) {
    throw new Error(
      "VITE_METEOFRANCE_API_TOKEN manquant — voir .env.example (Option B carte de pluie radar).",
    )
  }
  return key
}

async function radarFetch(path: string): Promise<Response> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { apikey: apiKey() },
  })
  if (!res.ok) throw new Error(`Météo-France radar: ${res.status} sur ${path}`)
  return res
}

// Zone couvrant la France métropolitaine (dont Midi-Pyrénées) — les autres
// zones disponibles (ANTILLES, REUNION, NOUVELLE-CALEDONIE) ne nous
// concernent pas ici.
export const RADAR_ZONE_METROPOLE = 'METROPOLE'

// Observation "lame d'eau" (cumul de précipitations radar) — celle qui sert
// la carte de pluie. L'autre observation disponible est "REFLECTIVITE".
export const RADAR_OBSERVATION_LAME_EAU = 'LAME_D_EAU'

type LinkList = { links: { href: string; type: string; title: string; validity_time?: string }[] }

// Liste les zones de mosaïque disponibles.
export async function listRadarZones(): Promise<LinkList> {
  const res = await radarFetch('/mosaiques')
  return res.json()
}

// Liste les observations disponibles pour une zone (réflectivité, lame
// d'eau).
export async function listRadarObservations(zone: string): Promise<LinkList> {
  const res = await radarFetch(`/mosaiques/${encodeURIComponent(zone)}/observations`)
  return res.json()
}

// Télécharge le fichier de mosaïque le plus récent pour une zone + une
// observation données. `maille` (mètres) vaut 500 (HDF5, la plus précise) ou
// 1000 (octet-stream gzippé) — voir constat ci-dessus. Renvoie la réponse
// brute (pas de .json(), ce n'est pas du JSON) : à consommer en
// arrayBuffer()/blob() côté appelant une fois le décodage branché.
export async function fetchLatestMosaicProduct(
  zone: string,
  observation: string,
  maille: 500 | 1000 = 500,
): Promise<Response> {
  return radarFetch(
    `/mosaiques/${encodeURIComponent(zone)}/observations/${encodeURIComponent(observation)}/produit?maille=${maille}`,
  )
}
