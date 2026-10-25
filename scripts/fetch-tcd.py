"""Couvert forestier Copernicus 2024 (Tree Cover Density, 10 m) sur Midi-Pyrénées, en % par pixel.

Le téléchargement des valeurs brutes exige un compte Copernicus ; on lit à la place le service de tuiles PUBLIC
cité dans la fiche officielle du produit (land.copernicus.eu/cdse/tcd_europe_10m_yearly, WMTS), qui renvoie des
couleurs. La palette officielle du rendu (une couleur par valeur entière de 1 à 100 %, script publié par
Copernicus : eu-cdse/sentinel-hub-custom-scripts, clms_vlcc_tree-cover-density) permet une conversion EXACTE ;
transparent = 0 % (pas d'arbre). Zoom 13 (pixels de ~14 m à nos latitudes), assez fin pour la grille de 20 m.

Sortie : .cache-habitat/tcd2024-z13.tif (EPSG:3857, uint8, % de couvert ; 255 = pas de donnée), tuiles brutes en
cache dans .cache-habitat/tcd2024/. Service public : 4 requêtes à la fois, reprise possible (tuiles déjà là sautées).

Lancement : .venv-habitat/Scripts/python scripts/fetch-tcd.py
"""
import json
import math
import os
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.transform import from_origin
from rasterio.windows import Window

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache-habitat")
TILES = os.path.join(CACHE, "tcd2024")
OUT = os.path.join(CACHE, "tcd2024-z13.tif")
os.makedirs(TILES, exist_ok=True)

Z = 13
YEAR = 2024
URL = (
    "https://land.copernicus.eu/cdse/tcd_europe_10m_yearly?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0"
    "&LAYER=Tree%20Cover%20Density&STYLE=default&TILEMATRIXSET=PopularWebMercator256&TILEMATRIX={z}"
    "&TILEROW={y}&TILECOL={x}&FORMAT=image%2Ftiff%3Bdepth%3D8&TIME={year}-01-01"
)
HALF = 20037508.342789244

# Palette officielle (valeur 1 à 100 %), dans l'ordre.
PALETTE = [
    [253,255,115],[248,255,115],[246,255,115],[241,255,115],[239,255,115],[234,255,115],[232,255,115],[227,255,115],[222,255,115],[220,255,115],
    [215,255,115],[213,255,115],[208,255,115],[206,255,115],[201,255,115],[197,255,115],[194,255,115],[190,255,115],[187,255,115],[183,255,115],
    [180,255,115],[176,255,115],[171,255,115],[169,255,115],[164,255,115],[161,252,111],[157,252,106],[154,250,102],[151,250,97],[148,250,92],
    [143,247,87],[140,247,82],[135,245,76],[133,245,73],[130,245,69],[126,242,63],[123,242,58],[118,240,53],[117,240,50],[113,240,46],
    [109,237,40],[106,237,36],[102,235,30],[99,235,26],[97,235,23],[93,232,19],[90,232,14],[86,230,9],[83,230,5],[76,230,0],
    [79,227,5],[77,224,9],[73,219,11],[72,217,15],[71,214,19],[70,212,23],[68,209,25],[67,207,29],[67,204,33],[66,199,36],
    [68,196,39],[66,194,41],[66,191,44],[66,189,47],[66,186,50],[65,184,51],[65,181,54],[64,176,56],[65,173,59],[65,171,62],
    [64,168,62],[65,166,65],[67,163,69],[69,161,72],[70,158,74],[68,156,73],[66,153,70],[65,150,69],[64,148,69],[61,145,67],
    [59,140,64],[56,138,62],[55,135,61],[53,133,58],[52,130,59],[50,128,56],[49,125,55],[47,122,53],[46,120,52],[43,117,51],
    [42,115,50],[40,112,48],[38,110,46],[37,107,44],[36,105,44],[34,102,42],[32,99,40],[31,97,39],[29,94,38],[28,92,36],
]
PAL = np.array(PALETTE, dtype=np.int32)


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def tile_xy(lon, lat, z):
    n = 2**z
    return int((lon + 180) / 360 * n), int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)


def region_tiles():
    """Tuiles z13 qui touchent les 8 départements (contour de l'appli)."""
    x0, y0 = tile_xy(-0.405, 45.155, Z)
    x1, y1 = tile_xy(3.405, 42.595, Z)
    size = 2 * HALF / 2**Z
    geo = json.load(open(os.path.join(ROOT, "src", "data", "midi-pyrenees-outline.json"), encoding="utf-8"))
    from pyproj import Transformer

    tr = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)

    def ring(r):
        xs, ys = tr.transform([p[0] for p in r], [p[1] for p in r])
        return list(zip(xs, ys))

    shapes = []
    for f in geo["features"]:
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        shapes.append(({"type": "MultiPolygon", "coordinates": [[ring(r) for r in p] for p in polys]}, 1))
    w, h = x1 - x0 + 1, y1 - y0 + 1
    grid = rasterize(shapes, out_shape=(h, w), transform=from_origin(-HALF + x0 * size, HALF - y0 * size, size, size), all_touched=True, dtype="uint8")
    return x0, y0, w, h, [(x0 + c, y0 + r) for r in range(h) for c in range(w) if grid[r, c]]


FALLBACK_YEAR = 2023


def tile_path(x, y):
    """Tuile en cache : 2024, ou 2023 là où le serveur ne sert pas 2024 (voir fetch)."""
    for name in (f"{x}_{y}.tif", f"{x}_{y}_{FALLBACK_YEAR}.tif"):
        p = os.path.join(TILES, name)
        if os.path.exists(p):
            return p
    return None


def fetch(xy):
    x, y = xy
    if tile_path(x, y):
        return tile_path(x, y)
    path = os.path.join(TILES, f"{x}_{y}.tif")
    year = YEAR
    for attempt in range(5):
        try:
            with urllib.request.urlopen(URL.format(z=Z, x=x, y=y, year=year), timeout=60) as r:
                data = r.read()
            with open(path + ".tmp", "wb") as fh:
                fh.write(data)
            os.replace(path + ".tmp", path)
            time.sleep(0.15)  # service public : on reste discret
            return path
        except urllib.error.HTTPError as err:
            # 412 : panne côté Copernicus constatée le 25/10/2026 — une dalle source 2024 de 100 km
            # (CLMS_HRLVLCC_TCD_S2024_..._E35N23) modifiée sans réindexation (« Reingest tile … because one of its
            # files changed since ingestion »). Ce n'est pas un blocage : on prend 2023 pour ces tuiles.
            if err.code == 412 and year == YEAR:
                year = FALLBACK_YEAR
                path = os.path.join(TILES, f"{x}_{y}_{FALLBACK_YEAR}.tif")
                continue
            if attempt == 4:
                log(f"tuile {x},{y} : échec ({err})")
                return None
            time.sleep(3 * (attempt + 1))
        except Exception as err:
            if attempt == 4:
                log(f"tuile {x},{y} : échec ({err})")
                return None
            time.sleep(3 * (attempt + 1))


def decode(path):
    """Tuile RGBA -> % de couvert (0 = pas d'arbre)."""
    with rasterio.open(path) as s:
        a = s.read()
    rgb = a[:3].reshape(3, -1).T.astype(np.int32)
    alpha = a[3].ravel()
    out = np.zeros(rgb.shape[0], np.uint8)
    vis = alpha > 0
    if vis.any():
        cols, inv = np.unique(rgb[vis], axis=0, return_inverse=True)
        d = ((cols[:, None, :] - PAL[None, :, :]) ** 2).sum(-1)
        out[vis] = (d.argmin(1) + 1).astype(np.uint8)[inv.ravel()]
    return out.reshape(256, 256)


def main():
    x0, y0, w, h, tiles = region_tiles()
    log(f"{len(tiles)} tuiles z{Z} à lire (rectangle {w} x {h})")
    done = 0
    with ThreadPoolExecutor(4) as ex:
        for p in ex.map(fetch, tiles):
            done += 1
            if done % 250 == 0:
                log(f"  {done}/{len(tiles)}")
    size = 2 * HALF / 2**Z
    profile = dict(driver="GTiff", width=w * 256, height=h * 256, count=1, dtype="uint8", crs="EPSG:3857",
                   transform=from_origin(-HALF + x0 * size, HALF - y0 * size, size / 256, size / 256),
                   nodata=255, compress="deflate", tiled=True, blockxsize=256, blockysize=256, BIGTIFF="IF_SAFER")
    missing = 0
    fallback = 0
    with rasterio.open(OUT + ".tmp.tif", "w", **profile) as dst:
        for x, y in tiles:
            path = tile_path(x, y)
            if not path:
                missing += 1
                continue
            fallback += path.endswith(f"_{FALLBACK_YEAR}.tif")
            dst.write(decode(path), 1, window=Window((x - x0) * 256, (y - y0) * 256, 256, 256))
    os.replace(OUT + ".tmp.tif", OUT)
    log(f"mosaïque écrite : {OUT} ({os.path.getsize(OUT) / 1048576:.0f} Mo), tuiles manquantes : {missing}, tuiles en {FALLBACK_YEAR} faute de 2024 : {fallback}")


if __name__ == "__main__":
    main()
