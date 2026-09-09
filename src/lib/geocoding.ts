// Géocodage IGN (repris d'Unmask, src/lib/geocoding.ts) — recherche
// d'adresse/ville avec autocomplétion, gratuit et sans clé.
export type GeocodeResultType = 'housenumber' | 'street' | 'locality' | 'municipality' | 'poi'

export interface GeocodeResult {
  label: string
  lat: number
  lon: number
  type: GeocodeResultType
}

interface GeoportailFeature {
  properties?: {
    label?: string
    type?: string
    _type?: string
    name?: string[]
    city?: string[]
  }
  geometry: { coordinates: [number, number] }
}

interface GeoportailResponse {
  features?: GeoportailFeature[]
}

function parseResultType(type: string | undefined): GeocodeResultType {
  if (type === 'housenumber' || type === 'street' || type === 'locality' || type === 'municipality') return type
  return 'municipality'
}

function formatPoiLabel(properties: GeoportailFeature['properties']): string {
  const name = properties?.name?.[0]?.trim()
  const city = properties?.city?.[0]?.trim()
  if (name && city) return `${name} (${city})`
  return name || city || "Point d'intérêt"
}

// Niveau de zoom Leaflet à appliquer selon la précision du résultat choisi —
// zoomer sur une simple commune comme sur une adresse de rue serait soit
// trop large soit trop serré.
export function zoomForResultType(type: GeocodeResultType): number {
  switch (type) {
    case 'housenumber':
      return 14
    case 'street':
      return 13
    case 'poi':
      return 13
    case 'locality':
      return 12
    case 'municipality':
      return 11
  }
}

// Recherche combinée adresse + point d'intérêt (mairies, gares...) via le
// géocodeur IGN (data.geopf.fr, même domaine que les fonds de carte, déjà
// autorisé — aucune nouvelle dépendance).
export async function searchAddress(query: string): Promise<GeocodeResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const url = `https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(trimmed)}&index=address,poi&limit=5`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Erreur de géocodage (${response.status})`)
  }

  const data: GeoportailResponse = await response.json()
  return (data.features ?? []).map((feature) => {
    const isPoi = feature.properties?._type === 'poi'
    return {
      label: isPoi ? formatPoiLabel(feature.properties) : (feature.properties?.label ?? 'Résultat sans nom'),
      lon: feature.geometry.coordinates[0],
      lat: feature.geometry.coordinates[1],
      type: isPoi ? 'poi' : parseResultType(feature.properties?.type),
    }
  })
}
