// Mode « Coins », zoom 10 et plus : habitat à 20 m (tuiles de scripts/build-habitat-fine.py) x météo de
// pousse (~1 km, interpolée pixel par pixel), calculé dans le navigateur pour l'espèce et le jour choisis.
// En dessous du zoom 10, CoinsLayer affiche la carte à 250 m (plus légère pour une vue d'ensemble).
import L from 'leaflet'
import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import { displayValue, FINE_MAX_ZOOM, FINE_MIN_ZOOM, fineLevel, loadFineTile, paintZones, type CoinsResult } from '../lib/coins'

type Props = { result: CoinsResult; speciesIndex: number }

export function CoinsFineLayer({ result, speciesIndex }: Props) {
  const map = useMap()
  const stateRef = useRef({ result, speciesIndex })
  const layerRef = useRef<L.GridLayer | null>(null)

  useEffect(() => {
    const FineLayer = L.GridLayer.extend({
      createTile(coords: L.Coords, done: L.DoneCallback) {
        const tile = document.createElement('canvas')
        tile.width = tile.height = 256
        const { z, x, y } = coords
        void loadFineTile(z, x, y).then((px) => {
          if (px) paint(tile, px.rgba, z, x, y)
          done(undefined, tile)
        })
        return tile
      },
    })

    const paint = (tile: HTMLCanvasElement, rgba: Uint8ClampedArray, z: number, x: number, y: number) => {
      const { result: res, speciesIndex: idx } = stateRef.current
      const ctx = tile.getContext('2d')!
      const img = ctx.createImageData(256, 256)
      const n = 2 ** z
      const b = res.bounds
      const g = res.pousse
      // Position de chaque colonne / ligne de la tuile dans la grille météo (interpolation bilinéaire).
      const gx = new Float32Array(256)
      const gy = new Float32Array(256)
      for (let i = 0; i < 256; i++) {
        const lon = ((x + (i + 0.5) / 256) / n) * 360 - 180
        gx[i] = Math.min(Math.max(((lon - b.lonMin) / (b.lonMax - b.lonMin)) * g.width - 0.5, 0), g.width - 1)
        const m = Math.PI * (1 - (2 * (y + (i + 0.5) / 256)) / n)
        const lat = (Math.atan(Math.sinh(m)) * 180) / Math.PI
        gy[i] = Math.min(Math.max(((b.latMax - lat) / (b.latMax - b.latMin)) * g.height - 0.5, 0), g.height - 1)
      }
      const v = g.values
      const score = new Float32Array(256 * 256)
      const levels = new Uint8Array(256 * 256)
      for (let r = 0; r < 256; r++) {
        const y0 = Math.floor(gy[r])
        const y1 = Math.min(y0 + 1, g.height - 1)
        const wy = gy[r] - y0
        for (let c = 0; c < 256; c++) {
          const i = r * 256 + c
          const level = fineLevel(rgba, i, idx)
          levels[i] = level
          if (level === 0) continue
          // « Milieu seul » : l'habitat à 20 m, sans la météo.
          if (res.habitatOnly) {
            score[i] = level / 7
            continue
          }
          const x0 = Math.floor(gx[c])
          const x1 = Math.min(x0 + 1, g.width - 1)
          const wx = gx[c] - x0
          const p =
            ((v[y0 * g.width + x0] * (1 - wx) + v[y0 * g.width + x1] * wx) * (1 - wy) +
              (v[y1 * g.width + x0] * (1 - wx) + v[y1 * g.width + x1] * wx) * wy) /
            255
          score[i] = Math.min(1, (level / 7) * p * res.moonFactor)
        }
      }
      // Zone favorable = habitat ≥ 4/7 (≥ 50 %) : voile + contour, couleur de pousse par-dessus.
      paintZones(img.data, 256, 256, (i) => displayValue(res, score[i]), (i) => levels[i] >= 4)
      ctx.putImageData(img, 0, 0)
    }

    // Calque propre, au-dessus des fonds de carte : le sélecteur de fonds (LayersControl) renumérote le
    // zIndex de ses couches au fil des changements (fond actif à 6 constaté), ce qui passait le fond
    // par-dessus ces tuiles dans le calque commun des tuiles.
    if (!map.getPane('coinsFine')) map.createPane('coinsFine').style.zIndex = '350'
    const layer = new (FineLayer as unknown as new (o: L.GridLayerOptions) => L.GridLayer)({
      pane: 'coinsFine',
      minZoom: FINE_MIN_ZOOM,
      maxNativeZoom: FINE_MAX_ZOOM,
      maxZoom: 20,
      opacity: 0.85,
      className: 'coins-fine',
    })
    layer.addTo(map)
    layerRef.current = layer
    return () => {
      layer.remove()
      layerRef.current = null
    }
  }, [map])

  // Espèce ou jour changés : on repeint (les tuiles d'habitat restent en mémoire, seul le calcul est refait).
  useEffect(() => {
    stateRef.current = { result, speciesIndex }
    layerRef.current?.redraw()
  }, [result, speciesIndex])

  return null
}
