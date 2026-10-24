"""Habitat des champignons à 20 m, découpé en tuiles (à lancer rarement, sur le poste).

Même règles que scripts/build-habitat.py (importées de ce fichier : une seule source de vérité), mais sur une
grille de 20 m en Lambert-93 (EPSG:2154, projection native de la BD Forêt) au lieu de 250 m :
  - BD Forêt V2 rasterisée à 20 m (essence de la parcelle, forêt ouverte) ;
  - Copernicus DEM GLO-30 (altitude, pente) ;
  - SoilGrids pH (250 m, interpolé : pas plus fin disponible) ;
  - ESA WorldCover 2021 (10 m) pour les prairies, lisières et clairières (coulemelle).
Les 7 habitats (0-1) sont ramenés à 8 niveaux (3 bits) et rangés dans UNE image RGB par tuile :
  valeur 24 bits v = somme(niveau_i << 3*i), i = ordre de build-habitat.SPECIES ; R = v >> 16, G = v >> 8, B = v.
Tuiles Web Mercator 256 px, zooms 10 à 13 (13 ~ 14 m par pixel), seulement là où il y a de l'habitat.

Sorties : .cache-habitat/fine/habitat-20m.tif (raster complet, cache), .cache-habitat/tiles/{z}/{x}/{y}.png
(publiées sur la branche orpheline « habitat », voir CLAUDE.md), tiles/habitat-tiles.json.

Lancement : .venv-habitat/Scripts/python scripts/build-habitat-fine.py
"""
import glob
import importlib.util
import json
import math
import os
import sys
import time

import numpy as np
import rasterio
import shapefile
from PIL import Image
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.transform import from_origin
from rasterio.warp import reproject
from rasterio.windows import Window
from scipy.ndimage import map_coordinates, maximum_filter, uniform_filter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(ROOT, ".cache-habitat")
FINE = os.path.join(CACHE, "fine")
TILES = os.path.join(CACHE, "tiles")
os.makedirs(FINE, exist_ok=True)


def _load(name, file):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, file))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


hb = _load("habitat", "build-habitat.py")  # règles (HOSTS, PH, ALT, SLOPE, SPECIES, curve)
hl = _load("layers", "build-habitat-layers.py")  # groupes d'essences (group_of, GROUPS)

RES = 20
X0, Y1 = 428_000, 6_440_000  # coin nord-ouest (Lambert-93)
W, H = 15_420, 13_800  # -> 736 400 E, 6 164 000 N
TRANSFORM = from_origin(X0, Y1, RES, RES)
BLOCK = 2048
MARGIN = 16  # cases de marge pour pente, lisières et voisinage
SPECIES = hb.SPECIES
GROUPS = hl.GROUPS
to_wgs = Transformer.from_crs("EPSG:2154", "EPSG:4326", always_xy=True)


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# --------------------------------------------------------------------------------------------------
def forest_raster():
    """Groupe d'essences par case de 20 m (bit 0x80 = forêt ouverte), sur disque (memmap)."""
    path = os.path.join(FINE, "forest-20m.u8")
    done = path + ".ok"  # marqueur : sous Windows, un memmap encore ouvert ne peut pas être renommé
    if os.path.exists(done):
        return np.memmap(path, dtype=np.uint8, mode="r", shape=(H, W))
    arr = np.memmap(path, dtype=np.uint8, mode="w+", shape=(H, W))
    for dept in hl.DEPTS:
        p = glob.glob(os.path.join(CACHE, "bdforet", f"*_D0{dept}_*", "**", "FORMATION_VEGETALE.shp"), recursive=True)[0]
        shapes = []
        for sr in shapefile.Reader(p, encoding="utf-8").iterShapeRecords():
            code = sr.record["CODE_TFV"]
            g = hl.group_of(code)
            if g is None:
                continue
            shapes.append((sr.shape.__geo_interface__, g | (0x80 if code.startswith("FO") else 0)))
        # Par bandes de 2048 lignes : rasteriser 212 millions de cases d'un coup demanderait trop de mémoire.
        for r0 in range(0, H, BLOCK):
            h = min(BLOCK, H - r0)
            tr = from_origin(X0, Y1 - r0 * RES, RES, RES)
            part = rasterize(shapes, out_shape=(h, W), transform=tr, fill=0, dtype="uint8", all_touched=False)
            band = arr[r0 : r0 + h]
            np.copyto(band, part, where=part > 0)
        log(f"BD Forêt {dept} : {len(shapes)} polygones rasterisés à 20 m")
    arr.flush()
    open(done, "w").close()
    return arr


def region_mask_block(r0, c0, h, w):
    geo = json.load(open(os.path.join(ROOT, "src", "data", "midi-pyrenees-outline.json"), encoding="utf-8"))
    tr = from_origin(X0 + c0 * RES, Y1 - r0 * RES, RES, RES)
    to_l93 = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)

    def ring(r):
        xs, ys = to_l93.transform([p[0] for p in r], [p[1] for p in r])
        return list(zip(xs, ys))

    shapes = []
    for f in geo["features"]:
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        shapes.append(({"type": "MultiPolygon", "coordinates": [[ring(r) for r in p] for p in polys]}, 1))
    return rasterize(shapes, out_shape=(h, w), transform=tr, fill=0, dtype="uint8")


DEM_FILES = sorted(glob.glob(os.path.join(CACHE, "dem30", "*.tif")))


def dem_block(r0, c0, h, w):
    alt = np.full((h, w), np.nan, np.float32)
    tr = from_origin(X0 + c0 * RES, Y1 - r0 * RES, RES, RES)
    for f in DEM_FILES:
        part = np.full((h, w), np.nan, np.float32)
        with rasterio.open(f) as src:
            reproject(rasterio.band(src, 1), part, dst_transform=tr, dst_crs="EPSG:2154", resampling=Resampling.bilinear, dst_nodata=np.nan)
        alt = np.where(np.isnan(alt), part, alt)
    return alt


WC_URL = "/vsicurl/https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{}_Map.tif"
WC_TILES = ["N42W003", "N42E000", "N42E003", "N45W003", "N45E000", "N45E003"]


def worldcover_block(r0, c0, h, w):
    cls = np.zeros((h, w), np.uint8)
    tr = from_origin(X0 + c0 * RES, Y1 - r0 * RES, RES, RES)
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif", GDAL_HTTP_MAX_RETRY="4", GDAL_HTTP_RETRY_DELAY="2"):
        for t in WC_TILES:
            part = np.zeros((h, w), np.uint8)
            try:
                with rasterio.open(WC_URL.format(t)) as src:
                    reproject(rasterio.band(src, 1), part, dst_transform=tr, dst_crs="EPSG:2154", resampling=Resampling.mode, dst_nodata=0)
            except Exception as err:
                log(f"  WorldCover {t} : {err}")
                continue
            cls = np.where(cls == 0, part, cls)
    return cls


# pH SoilGrids (grille 250 m de build-habitat-layers, lignes vers le sud depuis 45,155°N).
PH = np.load(os.path.join(CACHE, "ph.npz"))["ph"]
PH = np.where(np.isnan(PH) | (PH < 3), 6.0, PH)


def ph_block(r0, c0, h, w):
    xs = X0 + (c0 + np.arange(w) + 0.5) * RES
    ys = Y1 - (r0 + np.arange(h) + 0.5) * RES
    # Grille creuse (une case sur 8) puis interpolation : le pH est à 250 m, inutile de projeter 4 M de points.
    step = 8
    gx, gy = np.meshgrid(xs[::step], ys[::step])
    lon, lat = to_wgs.transform(gx, gy)
    rows = (hl.LAT_MAX - lat) / (hl.LAT_MAX - hl.LAT_MIN) * hl.ROWS - 0.5
    cols = (lon - hl.LON_MIN) / (hl.LON_MAX - hl.LON_MIN) * hl.COLS - 0.5
    coarse = map_coordinates(PH, [rows, cols], order=1, mode="nearest")
    fy = (np.arange(h) / step)
    fx = (np.arange(w) / step)
    my, mx = np.meshgrid(fy, fx, indexing="ij")
    return map_coordinates(coarse, [my, mx], order=1, mode="nearest").astype(np.float32)


# --------------------------------------------------------------------------------------------------
def habitat_block(forest, alt, ph, wc, mask, slope):
    """Habitats (7, h, w) entre 0 et 1, mêmes règles que build-habitat.py."""
    group = forest & 0x7F
    open_forest = (forest & 0x80) > 0
    is_forest = (group > 0) & ~np.isin(group, [GROUPS.index("lande"), GROUPS.index("herbe")])
    trees = is_forest | (wc == 10)
    grass = wc == 30
    out = []
    for sp in SPECIES:
        if sp in hb.HOSTS:
            lut = np.zeros(32, np.float32)
            for g, wgt in hb.HOSTS[sp].items():
                lut[GROUPS.index(g)] = wgt
            host = lut[group]
        else:
            # Coulemelle à 20 m : prairie à moins de ~100 m d'arbres, lisières (bande de ~40 m de part et
            # d'autre de la limite du bois), forêts ouvertes, landes.
            near_trees = maximum_filter(trees, size=11) > 0
            edge = (maximum_filter(is_forest, size=5) > 0) & (maximum_filter(~is_forest, size=5) > 0)
            host = np.maximum.reduce([
                0.9 * (grass & near_trees),
                0.7 * edge,
                0.6 * open_forest,
                0.4 * (group == GROUPS.index("lande")),
            ]).astype(np.float32)
        h = host * hb.curve(ph, hb.PH[sp]) * hb.curve(alt, hb.ALT[sp]) * slope
        h[mask == 0] = 0
        out.append(h)
    return np.stack(out)


def pack(habitats):
    levels = np.clip(np.rint(habitats * 7), 0, 7).astype(np.uint32)
    v = np.zeros(habitats.shape[1:], np.uint32)
    for i in range(levels.shape[0]):
        v |= levels[i] << (3 * i)
    return np.stack([(v >> 16) & 255, (v >> 8) & 255, v & 255]).astype(np.uint8)


def build_raster():
    out = os.path.join(FINE, "habitat-20m.tif")
    if os.path.exists(out):
        return out
    forest = forest_raster()
    profile = dict(driver="GTiff", width=W, height=H, count=3, dtype="uint8", crs="EPSG:2154", transform=TRANSFORM,
                   compress="deflate", tiled=True, blockxsize=512, blockysize=512, BIGTIFF="IF_SAFER")
    nb = math.ceil(H / BLOCK) * math.ceil(W / BLOCK)
    k = 0
    with rasterio.open(out + ".tmp.tif", "w", **profile) as dst:
        for r0 in range(0, H, BLOCK):
            for c0 in range(0, W, BLOCK):
                k += 1
                h, w = min(BLOCK, H - r0), min(BLOCK, W - c0)
                # Bloc avec marge (pente, lisières), recadré ensuite.
                R0, C0 = max(0, r0 - MARGIN), max(0, c0 - MARGIN)
                R1, C1 = min(H, r0 + h + MARGIN), min(W, c0 + w + MARGIN)
                hh, ww = R1 - R0, C1 - C0
                mask = region_mask_block(R0, C0, hh, ww)
                if not mask.any():
                    log(f"bloc {k}/{nb} hors région")
                    continue
                f = np.asarray(forest[R0:R1, C0:C1])
                alt = dem_block(R0, C0, hh, ww)
                a = np.nan_to_num(alt, nan=0)
                gy, gx = np.gradient(a, RES)
                slope = hb.curve(np.degrees(np.arctan(np.hypot(gx, gy))), hb.SLOPE)
                ph = ph_block(R0, C0, hh, ww)
                wc = worldcover_block(R0, C0, hh, ww)
                hab = habitat_block(f, a, ph, wc, mask, slope)
                packed = pack(hab)[:, r0 - R0 : r0 - R0 + h, c0 - C0 : c0 - C0 + w]
                dst.write(packed, window=Window(c0, r0, w, h))
                log(f"bloc {k}/{nb} : " + ", ".join(f"{sp} {hab[i][mask > 0].mean():.2f}" for i, sp in enumerate(SPECIES)))
    os.replace(out + ".tmp.tif", out)
    return out


# --------------------------------------------------------------------------------------------------
def lonlat_to_tile(lon, lat, z):
    n = 2**z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def tile_bounds_merc(x, y, z):
    half = 20037508.342789244
    size = 2 * half / 2**z
    return -half + x * size, half - (y + 1) * size, -half + (x + 1) * size, half - y * size


def build_tiles(raster, zooms=(10, 11, 12, 13)):
    from rasterio.transform import from_bounds

    count = 0
    total = 0
    with rasterio.open(raster) as src:
        for z in zooms:
            x0, y0 = lonlat_to_tile(-0.4, 45.15, z)
            x1, y1 = lonlat_to_tile(3.4, 42.6, z)
            for x in range(x0, x1 + 1):
                for y in range(y0, y1 + 1):
                    b = tile_bounds_merc(x, y, z)
                    dst = np.zeros((3, 256, 256), np.uint8)
                    reproject(rasterio.band(src, (1, 2, 3)), dst, dst_transform=from_bounds(*b, 256, 256), dst_crs="EPSG:3857",
                              # src_nodata=0 OBLIGATOIRE : sinon GDAL remplace chaque vrai 0 par 1 pour le distinguer
                              # du « sans donnée » de destination, et (1, 1, 1) se décodait en « cèpe de Bordeaux 4/7,
                              # coulemelle 2/7 » partout, hors région et champs compris (constaté le 24/10/2026).
                              resampling=Resampling.nearest, src_nodata=0, dst_nodata=0)
                    if not dst.any():
                        continue
                    path = os.path.join(TILES, str(z), str(x), f"{y}.png")
                    os.makedirs(os.path.dirname(path), exist_ok=True)
                    Image.fromarray(np.moveaxis(dst, 0, -1), mode="RGB").save(path, optimize=True)
                    count += 1
                    total += os.path.getsize(path)
            log(f"zoom {z} : {count} tuiles, {total / 1048576:.0f} Mo")
    meta = {
        "species": SPECIES,
        "levels": 8,
        "packing": "v = R<<16 | G<<8 | B ; niveau de l'espèce i = (v >> 3i) & 7 ; habitat = niveau / 7",
        "minZoom": min(zooms),
        "maxZoom": max(zooms),
        "resolutionM": RES,
        "tiles": count,
        "sources": "BD Forêt V2 (IGN, Etalab 2.0), Copernicus DEM GLO-30, SoilGrids 2.0 (ISRIC, CC BY 4.0), ESA WorldCover 2021 (CC BY 4.0)",
    }
    json.dump(meta, open(os.path.join(TILES, "habitat-tiles.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    if not DEM_FILES:
        sys.exit("Relief GLO-30 absent : télécharger les tuiles dans .cache-habitat/dem30/")
    raster = build_raster()
    build_tiles(raster)
