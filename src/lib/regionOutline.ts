// Contour fusionné des 8 départements de l'ex-région Midi-Pyrénées (09, 12,
// 31, 32, 46, 65, 81, 82) — voir scripts/build-region-outline.mjs pour la
// provenance et comment le regénérer. Un seul polygone (les 8 départements
// étant contigus), pas de découpage interne par département.
import L from 'leaflet'
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson'
import outlineGeoJson from '../data/midi-pyrenees-outline.json'

export const REGION_OUTLINE = outlineGeoJson.features[0] as Feature<Polygon | MultiPolygon>

// Emprise (bounding box) du contour — sert au zoom initial et à limiter le
// déplacement de la carte (voir MapView.tsx).
export const REGION_BOUNDS = L.geoJSON(REGION_OUTLINE).getBounds()

// Rectangle englobant largement le globe, utilisé comme anneau extérieur du
// polygone "masque" ci-dessous (voir REGION_MASK) — assez grand pour
// couvrir tout niveau de zoom arrière raisonnable sans jamais laisser
// apparaître un bord.
const WORLD_RING: Position[] = [
  [-180, -85],
  [180, -85],
  [180, 85],
  [-180, 85],
  [-180, -85],
]

function ringsOf(geometry: Polygon | MultiPolygon): Position[][] {
  return geometry.type === 'Polygon' ? [geometry.coordinates[0]] : geometry.coordinates.map((poly) => poly[0])
}

// Polygone "masque" : un unique rectangle mondial avec un trou à la forme
// exacte du contour Midi-Pyrénées — rendu avec un remplissage semi-
// transparent, ça assombrit tout ce qui est hors zone sans jamais cacher
// complètement le contexte (relief, villes voisines...). Le trou (anneau
// intérieur GeoJSON) fonctionne grâce à la règle de remplissage even-odd
// que Leaflet applique par défaut à ses polygones SVG.
export const REGION_MASK: Feature<Polygon> = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [WORLD_RING, ...ringsOf(REGION_OUTLINE.geometry)],
  },
}
