// Lecture des cartes de probabilité de présence des essences forestières,
// espèce par espèce, directement dans les COG distants d'EcoDataCube
// (OpenGeoHub, licence CC-BY-SA 4.0) — 30 m de résolution, Europe entière.
//
// Pourquoi ces données : le service commercial de référence affiche une
// liste d'essences avec un pourcentage chacune, sous le sigle "rpp"
// (Relative Probability of Presence). Ça vient du jeu JRC/FISE, à 1 km —
// dont les liens de téléchargement officiels (w3id.org) ne résolvent plus.
// EcoDataCube fournit l'équivalent à 30 m, soit ~33x plus fin.
//
// À noter : leurs pourcentages totalisent 129% sur notre point de
// calibration, donc ce ne sont pas des parts d'un peuplement (qui feraient
// 100%) mais bien des probabilités indépendantes espèce par espèce — même
// nature que ce qu'on lit ici.
//
// Astuce technique : chaque fichier pèse ~790 Mo, mais ce sont des
// Cloud-Optimized GeoTIFF et le serveur accepte les requêtes par plage
// d'octets. geotiff.js ne télécharge donc que les quelques kilo-octets
// couvrant le pixel demandé.
import { fromUrl } from 'geotiff'
import proj4 from 'proj4'

// ETRS89-LAEA, la projection de toutes les grilles européennes EEA.
proj4.defs('EPSG:3035', '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs')

const PERIOD = '20180101_20201231' // la période la plus récente publiée

// Espèces couvertes par EcoDataCube en distribution "actual" (anv), avec
// leur nom courant. Le jeu JRC utilisé par le service de référence couvre
// plus d'espèces (chêne rouvre, chêne pubescent, frêne, bouleau...), mais
// pour le cèpe l'essentiel est là : châtaignier, chêne pédonculé, hêtre.
export const SPECIES = [
  { id: 'castanea.sativa', nom: 'châtaignier' },
  { id: 'fagus.sylvatica', nom: 'hêtre commun' },
  { id: 'quercus.robur', nom: 'chêne pédonculé' },
  { id: 'quercus.cerris', nom: 'chêne chevelu' },
  { id: 'quercus.ilex', nom: 'chêne vert' },
  { id: 'quercus.suber', nom: 'chêne-liège' },
  { id: 'corylus.avellana', nom: 'noisetier' },
  { id: 'prunus.avium', nom: 'merisier' },
  { id: 'salix.caprea', nom: 'saule marsault' },
  { id: 'abies.alba', nom: 'sapin blanc' },
  { id: 'pinus.sylvestris', nom: 'pin sylvestre' },
  { id: 'pinus.nigra', nom: 'pin noir' },
  { id: 'pinus.halepensis', nom: "pin d'Alep" },
  { id: 'pinus.pinea', nom: 'pin parasol' },
  { id: 'olea.europaea', nom: 'olivier' },
]

function cogUrl(speciesId) {
  return (
    `https://s3.ecodatacube.eu/arco/veg_${speciesId}_anv.eml_p_30m_0..0cm_` +
    `${PERIOD}_eumap_epsg3035_v0.3.tif`
  )
}

// Les en-têtes de chaque COG sont réutilisés d'un point à l'autre : on les
// garde en cache, sinon chaque lecture recommencerait par re-télécharger
// l'index du fichier (coûteux, et inutile).
const imageCache = new Map()

async function imageFor(speciesId) {
  if (!imageCache.has(speciesId)) {
    imageCache.set(speciesId, fromUrl(cogUrl(speciesId)).then((tiff) => tiff.getImage()))
  }
  return imageCache.get(speciesId)
}

export async function readSpeciesProbability(speciesId, lat, lon) {
  const image = await imageFor(speciesId)
  const [originX, originY] = image.getOrigin()
  const [resX, resY] = image.getResolution()
  const [x, y] = proj4('EPSG:4326', 'EPSG:3035', [lon, lat])

  const px = Math.round((x - originX) / resX)
  const py = Math.round((y - originY) / resY)
  if (px < 0 || py < 0 || px >= image.getWidth() || py >= image.getHeight()) return null

  const data = await image.readRasters({ window: [px, py, px + 1, py + 1] })
  const value = data[0][0]
  // 255 = nodata dans ces rasters.
  return value === 255 ? null : value
}

// Liste complète des essences d'un point, triée par probabilité
// décroissante — la même présentation que le service de référence.
export async function readSpeciesComposition(lat, lon) {
  const results = await Promise.all(
    SPECIES.map(async (s) => ({ ...s, probability: await readSpeciesProbability(s.id, lat, lon) })),
  )
  return results
    .filter((s) => s.probability !== null && s.probability > 0)
    .sort((a, b) => b.probability - a.probability)
}
