// Points des trouvailles réelles (GBIF) de l'espèce choisie, au-dessus de la carte des coins (lib/observations.ts).
import L from 'leaflet'
import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import { SPECIES, type Species } from '../lib/coins'
import { formatObservationDate, type ObservationsMeta } from '../lib/observations'

type Props = { meta: ObservationsMeta; species: Species }

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export function ObservationsLayer({ meta, species }: Props) {
  const map = useMap()

  useEffect(() => {
    // Calque propre au-dessus des coins (350) et sous les bulles ; rendu canvas (des centaines de points).
    if (!map.getPane('observations')) map.createPane('observations').style.zIndex = '450'
    const renderer = L.canvas({ pane: 'observations' })
    const label = SPECIES.find((s) => s.key === species)?.label ?? species
    const group = L.layerGroup()
    for (const [lat, lon, when, ds, unc] of meta.species[species] ?? []) {
      const dataset = meta.datasets[ds]
      const marker = L.circleMarker([lat, lon], {
        pane: 'observations',
        renderer,
        radius: 5,
        weight: 2,
        color: '#1e293b',
        fillColor: '#ffffff',
        fillOpacity: 0.95,
        // Sans ça, toucher un point ouvrirait aussi la fiche du coin en dessous.
        bubblingMouseEvents: false,
      })
      marker.bindPopup(
        `<strong>${escape(label)}</strong> trouvé ici<br>` +
          `${escape(formatObservationDate(when))}<br>` +
          `<small>Position ${unc >= 0 ? `à ${unc < 1000 ? `${unc} m` : `${(unc / 1000).toLocaleString('fr-FR')} km`} près` : 'de précision inconnue'}</small><br>` +
          `<small>Source : <a href="https://www.gbif.org/dataset/${encodeURIComponent(dataset.key)}" target="_blank" rel="noopener">${escape(dataset.title || 'GBIF')}</a> (${escape(dataset.license)}), via GBIF.org</small>`,
      )
      group.addLayer(marker)
    }
    group.addTo(map)
    return () => {
      group.remove()
    }
  }, [map, meta, species])

  return null
}
