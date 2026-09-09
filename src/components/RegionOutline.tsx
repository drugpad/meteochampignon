// Affiche la carte "recentrée" sur les 8 départements de Midi-Pyrénées :
// contour en pointillés + zone hors périmètre assombrie (voir
// lib/regionOutline.ts). Purement visuel, ne bloque aucun clic (les couches
// de données restent cliquables par-dessus).
import { GeoJSON } from 'react-leaflet'
import { REGION_MASK, REGION_OUTLINE } from '../lib/regionOutline'

export function RegionOutline() {
  return (
    <>
      <GeoJSON data={REGION_MASK} interactive={false} style={{ fillColor: '#1e293b', fillOpacity: 0.35, stroke: false }} />
      <GeoJSON
        data={REGION_OUTLINE}
        interactive={false}
        style={{ fill: false, color: '#2563eb', weight: 2, dashArray: '6 5' }}
      />
    </>
  )
}
