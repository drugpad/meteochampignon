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
from scipy.ndimage import map_coordinates, maximum_filter, uniform_filter  # noqa: F401

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
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
from geol_classes import CLASSES as GEOL_CLASSES  # noqa: E402

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


def geology_raster():
    """Classe de réaction du sol par case de 20 m (index de geol_classes.CLASSES, 0 = inconnu), d'après la carte
    géologique harmonisée au 1/50 000 du BRGM (BD Charm-50, Licence Ouverte 2.0), sur disque (memmap)."""
    import geol_classes as gc

    path = os.path.join(FINE, "geology-20m.u8")
    done = path + ".ok"
    if os.path.exists(done):
        return np.memmap(path, dtype=np.uint8, mode="r", shape=(H, W))
    arr = np.memmap(path, dtype=np.uint8, mode="w+", shape=(H, W))
    for p in sorted(glob.glob(os.path.join(CACHE, "geol", "*", "*_S_FGEOL_2154.shp"))):
        shapes = [(sr.shape.__geo_interface__, gc.CLASSES.index(gc.classify(sr.record["DESCR"])))
                  for sr in shapefile.Reader(p, encoding="latin-1").iterShapeRecords()]
        for r0 in range(0, H, BLOCK):
            h = min(BLOCK, H - r0)
            part = rasterize(shapes, out_shape=(h, W), transform=from_origin(X0, Y1 - r0 * RES, RES, RES), fill=0, dtype="uint8")
            band = arr[r0 : r0 + h]
            np.copyto(band, part, where=(part > 0) & (band == 0))
        log(f"géologie {os.path.basename(p)[:16]} : {len(shapes)} polygones rasterisés à 20 m")
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
TCD_FILE = os.path.join(CACHE, "tcd2024-z13.tif")


def tcd_block(r0, c0, h, w):
    """Couvert forestier Copernicus 2024 (% d'arbres) moyenné sur chaque case de 20 m ; NaN = pas de donnée."""
    out = np.full((h, w), np.nan, np.float32)
    if not os.path.exists(TCD_FILE):
        return out
    tr = from_origin(X0 + c0 * RES, Y1 - r0 * RES, RES, RES)
    with rasterio.open(TCD_FILE) as src:
        reproject(rasterio.band(src, 1), out, dst_transform=tr, dst_crs="EPSG:2154", resampling=Resampling.average,
                  src_nodata=255, dst_nodata=np.nan)
    return out


def habitat_block(forest, alt, ph, wc, mask, slope_deg, aspect_deg, tcd, geol=None):
    """Habitats (7, h, w) entre 0 et 1 : arbres hôtes (proches) x ouverture du bois x sol x altitude x pente x
    exposition, règles de build-habitat.py (HOSTS, OPENNESS, PH, ALT, SLOPE, ASPECT, SMALL_WOODS…)."""
    group = forest & 0x7F
    open_forest = (forest & 0x80) > 0
    is_forest = (group > 0) & ~np.isin(group, [GROUPS.index("lande"), GROUPS.index("herbe")])
    # Couvert : Copernicus 2024 ; sans donnée, on se rabat sur la BD Forêt / WorldCover.
    cover = np.where(np.isnan(tcd), np.where(is_forest, 70.0, np.where(wc == 10, 50.0, 0.0)), tcd).astype(np.float32)
    near_px = max(1, round(hb.TREES_NEAR_M / RES))
    trees_near = maximum_filter(cover >= 20, size=2 * near_px + 1)
    # Coupe récente : case de forêt (BD Forêt) avec moins de 10 % d'arbres en 2024. 1re version : seulement sans
    # aucun arbre à 30 m, donc presque toute coupe (bordée d'arbres) restait notée comme une lisière (constaté le
    # 25/10/2026 : 0,17-0,19 en moyenne pour le cèpe d'été sur les parcelles déboisées).
    small_woods = ~is_forest & trees_near  # haies, bosquets, arbres isolés hors BD Forêt
    under_px = max(1, round(hb.MEADOW_TREE_M / RES))
    trees_under = maximum_filter(cover >= 20, size=2 * under_px + 1)
    excluded = np.isin(wc, hb.EXCLUDED_LANDCOVER) & ~is_forest  # bâti, cultures, eau (sauf parcelle forestière)
    w_slope = np.clip((slope_deg - 3) / 12, 0, 1)
    slope_f = hb.curve(slope_deg, hb.SLOPE)
    grass = wc == 30
    out = []
    for sp in SPECIES:
        if sp in hb.HOSTS:
            lut = np.zeros(32, np.float32)
            for g, wgt in hb.HOSTS[sp].items():
                lut[GROUPS.index(g)] = wgt
            host = lut[group]
            host = np.where(small_woods, np.maximum(host, hb.SMALL_WOODS[sp]), host)
            cut = is_forest & (cover < 10)
            host = np.where(cut, host * np.where(trees_under, hb.CUT_EDGE_FACTOR, hb.CUT_FACTOR), host)
            host = np.where(trees_near, host, 0)  # mycorhizien : pas d'arbre à moins de 30 m, pas de champignon
            # Prairie (hors forêt) : seulement sous la couronne d'un arbre (~20 m), et moins qu'en sous-bois.
            meadow = grass & ~is_forest
            host = np.where(meadow, np.where(trees_under, host * hb.MEADOW_FACTOR, 0), host)
        else:
            # Coulemelle : prairie (surtout près d'arbres), lisières (± 40 m), forêts ouvertes, landes, et sous-bois.
            # Révision du 30/10/2026 : 45 % des observations de la région sont SOUS les arbres (forêts claires ou non,
            # Krieglsteiner : « presque toutes les forêts mésophiles ») et les prairies loin des arbres comptent aussi
            # (rapport prairie 1,8) ; la 1re version donnait 0 aux deux.
            trees = cover >= 20
            near_trees = maximum_filter(trees, size=11) > 0
            edge = (maximum_filter(trees, size=5) > 0) & (maximum_filter(~trees, size=5) > 0)
            host = np.maximum.reduce([
                0.9 * (grass & near_trees),
                0.75 * grass,
                0.7 * edge,
                0.6 * open_forest,
                0.55 * is_forest,
                0.4 * (group == GROUPS.index("lande")),
            ]).astype(np.float32)
        openness = hb.curve(cover, hb.OPENNESS[sp])
        ph_f = np.maximum(hb.curve(ph, hb.PH[sp]), hb.PH_FLOOR)
        if geol is not None:
            # Carte géologique (plus fine que SoilGrids) : son facteur REMPLACE la courbe de pH dans les classes listées.
            for cls, f in hb.GEOL.get(sp, {}).items():
                ph_f = np.where(geol == GEOL_CLASSES.index(cls), f, ph_f)
        alt_f = hb.curve(alt, hb.ALT[sp])
        if sp in hb.ASPECT:
            best, depth = hb.ASPECT[sp]
            aspect_f = 1 - depth * w_slope * (1 - np.cos(np.radians(aspect_deg - best))) / 2
        else:
            aspect_f = 1
        h = host * openness * ph_f * alt_f * slope_f * aspect_f
        h[excluded] = 0
        h[mask == 0] = 0
        out.append(np.clip(h, 0, 1).astype(np.float32))
    return np.stack(out)


def pack(habitats):
    levels = np.clip(np.rint(habitats * 7), 0, 7).astype(np.uint32)
    v = np.zeros(habitats.shape[1:], np.uint32)
    for i in range(levels.shape[0]):
        v |= levels[i] << (3 * i)
    return np.stack([(v >> 16) & 255, (v >> 8) & 255, v & 255]).astype(np.uint8)


FULL = os.path.join(FINE, "habitat-20m-7b.tif")  # 7 bandes (habitat x 255), pour la carte d'ensemble à 250 m
# Variables du milieu à 20 m, calculées UNE fois (WorldCover est lu à distance, le relief reprojeté…) : un nouveau
# réglage des règles se recalcule ensuite en quelques minutes, et la validation lit les mêmes valeurs aux points
# d'observation. uint8 : forêt (groupe | 0x80 forêt ouverte), géologie, pente x 4, exposition / 2, pH x 20, WorldCover,
# couvert % (255 = sans donnée), masque région ; uint16 à part : altitude (m).
COV = os.path.join(FINE, "covariates-20m.tif")
COV_ALT = os.path.join(FINE, "altitude-20m.tif")
COV_BANDS = ["forest", "geol", "slope4", "aspect2", "ph20", "wc", "tcd", "mask"]


def covariate_raster():
    if os.path.exists(COV) and os.path.exists(COV_ALT):
        return
    forest = forest_raster()
    geol = geology_raster()
    profile = dict(driver="GTiff", width=W, height=H, count=len(COV_BANDS), dtype="uint8", crs="EPSG:2154", transform=TRANSFORM,
                   compress="deflate", predictor=2, tiled=True, blockxsize=512, blockysize=512, BIGTIFF="YES")
    nb = math.ceil(H / BLOCK) * math.ceil(W / BLOCK)
    k = 0
    with rasterio.open(COV + ".tmp.tif", "w", **profile) as dst, \
            rasterio.open(COV_ALT + ".tmp.tif", "w", **dict(profile, count=1, dtype="uint16")) as dalt:
        for r0 in range(0, H, BLOCK):
            for c0 in range(0, W, BLOCK):
                k += 1
                h, w = min(BLOCK, H - r0), min(BLOCK, W - c0)
                # Bloc avec marge (pente), recadré ensuite.
                R0, C0 = max(0, r0 - MARGIN), max(0, c0 - MARGIN)
                R1, C1 = min(H, r0 + h + MARGIN), min(W, c0 + w + MARGIN)
                hh, ww = R1 - R0, C1 - C0
                mask = region_mask_block(R0, C0, hh, ww)
                if not mask.any():
                    log(f"variables : bloc {k}/{nb} hors région")
                    continue
                alt = np.nan_to_num(dem_block(R0, C0, hh, ww), nan=0)
                gy, gx = np.gradient(alt, RES)  # gy : vers le sud (ligne 0 = nord)
                slope_deg = np.degrees(np.arctan(np.hypot(gx, gy)))
                aspect_deg = np.degrees(np.arctan2(-gx, gy)) % 360  # direction de la descente, 0 = nord
                tcd = tcd_block(R0, C0, hh, ww)
                bands = [
                    np.asarray(forest[R0:R1, C0:C1]),
                    np.asarray(geol[R0:R1, C0:C1]),
                    np.clip(np.rint(slope_deg * 4), 0, 255),
                    np.rint(aspect_deg / 2) % 180,
                    np.clip(np.rint(ph_block(R0, C0, hh, ww) * 20), 0, 255),
                    worldcover_block(R0, C0, hh, ww),
                    np.where(np.isnan(tcd), 255, np.clip(np.rint(tcd), 0, 100)),
                    mask,
                ]
                sl = (slice(r0 - R0, r0 - R0 + h), slice(c0 - C0, c0 - C0 + w))
                dst.write(np.stack([b[sl] for b in bands]).astype(np.uint8), window=Window(c0, r0, w, h))
                dalt.write(np.clip(np.rint(alt[sl]), 0, 65535).astype(np.uint16)[None], window=Window(c0, r0, w, h))
                log(f"variables : bloc {k}/{nb}")
    os.replace(COV + ".tmp.tif", COV)
    os.replace(COV_ALT + ".tmp.tif", COV_ALT)


def read_covariates(r0, c0, h, w):
    """Variables du milieu sur une fenêtre (lignes, colonnes de la grille 20 m), comme dict de tableaux."""
    win = Window(c0, r0, w, h)
    with rasterio.open(COV) as src:
        b = dict(zip(COV_BANDS, src.read(window=win, boundless=True, fill_value=0)))
    with rasterio.open(COV_ALT) as src:
        alt = src.read(1, window=win, boundless=True, fill_value=0).astype(np.float32)
    tcd = b["tcd"].astype(np.float32)
    return dict(
        forest=b["forest"], geol=b["geol"], alt=alt, slope=b["slope4"] / 4.0, aspect=b["aspect2"] * 2.0,
        ph=b["ph20"] / 20.0, wc=b["wc"], tcd=np.where(b["tcd"] == 255, np.nan, tcd), mask=b["mask"],
    )


def habitat_from_cov(c):
    return habitat_block(c["forest"], c["alt"], c["ph"], c["wc"], c["mask"], c["slope"], c["aspect"], c["tcd"], c["geol"])


def build_raster():
    out = os.path.join(FINE, "habitat-20m.tif")
    if os.path.exists(out):
        return out
    covariate_raster()
    profile = dict(driver="GTiff", width=W, height=H, count=3, dtype="uint8", crs="EPSG:2154", transform=TRANSFORM,
                   compress="deflate", tiled=True, blockxsize=512, blockysize=512, BIGTIFF="IF_SAFER")
    nb = math.ceil(H / BLOCK) * math.ceil(W / BLOCK)
    k = 0
    full_profile = dict(profile, count=len(SPECIES))
    with rasterio.open(out + ".tmp.tif", "w", **profile) as dst, rasterio.open(FULL + ".tmp.tif", "w", **full_profile) as full:
        for r0 in range(0, H, BLOCK):
            for c0 in range(0, W, BLOCK):
                k += 1
                h, w = min(BLOCK, H - r0), min(BLOCK, W - c0)
                # Bloc avec marge (lisières, voisinage), recadré ensuite.
                R0, C0 = r0 - MARGIN, c0 - MARGIN
                cov = read_covariates(R0, C0, h + 2 * MARGIN, w + 2 * MARGIN)
                if not cov["mask"].any():
                    log(f"bloc {k}/{nb} hors région")
                    continue
                mask = cov["mask"]
                hab = habitat_from_cov(cov)
                crop = hab[:, MARGIN : MARGIN + h, MARGIN : MARGIN + w]
                dst.write(pack(crop), window=Window(c0, r0, w, h))
                full.write(np.rint(crop * 255).astype(np.uint8), window=Window(c0, r0, w, h))
                log(f"bloc {k}/{nb} : " + ", ".join(f"{sp} {hab[i][mask > 0].mean():.2f}" for i, sp in enumerate(SPECIES)))
    os.replace(out + ".tmp.tif", out)
    os.replace(FULL + ".tmp.tif", FULL)
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
        "sources": "BD Forêt V2 (IGN, Etalab 2.0), Copernicus DEM GLO-30, SoilGrids 2.0 (ISRIC, CC BY 4.0), ESA WorldCover 2021 (CC BY 4.0), Copernicus Tree Cover Density 2024, carte géologique harmonisée 1/50 000 BD Charm-50 (BRGM, Licence Ouverte 2.0)",
    }
    json.dump(meta, open(os.path.join(TILES, "habitat-tiles.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)


def build_coarse():
    """Carte d'ensemble à 250 m (public/habitat/<espèce>.png) tirée de l'habitat à 20 m : une seule source de vérité.
    Valeur d'une case = 3e QUARTILE de ses cases de 20 m (révision du 31/10/2026) : la case s'allume dès qu'un quart de
    sa surface est un bon milieu. La MOYENNE d'avant diluait les bons bois dans les prés et champs voisins : 1,5 % de la
    région au-dessus de 0,5 pour le cèpe de Bordeaux, contre 3,9 % à 20 m (l'Aubrac, zone la mieux confirmée par les
    observations, disparaissait au dézoom) ; 2,8 % avec le 3e quartile ; le maximum (5,4 %) aurait exagéré."""
    from PIL import Image
    from rasterio.transform import from_bounds

    rows, cols = hl.ROWS, hl.COLS
    tr = from_bounds(hl.LON_MIN, hl.LAT_MIN, hl.LON_MAX, hl.LAT_MAX, cols, rows)
    outdir = os.path.join(ROOT, "public", "habitat")
    with rasterio.open(FULL) as src:
        for i, sp in enumerate(SPECIES):
            dst = np.zeros((rows, cols), np.float32)
            reproject(rasterio.band(src, i + 1), dst, dst_transform=tr, dst_crs="EPSG:4326", resampling=Resampling.q3,
                      src_nodata=None, dst_nodata=0)
            Image.fromarray(np.clip(np.rint(dst), 0, 255).astype(np.uint8), mode="L").save(os.path.join(outdir, f"{sp}.png"), optimize=True)
            log(f"carte d'ensemble {sp} : moyenne {dst[dst > 0].mean() / 255:.3f}, cases >= 0,5 : {(dst >= 128).mean() * 100:.1f} %")


if __name__ == "__main__":
    if not DEM_FILES:
        sys.exit("Relief GLO-30 absent : télécharger les tuiles dans .cache-habitat/dem30/")
    if not os.path.exists(TCD_FILE):
        sys.exit("Couvert Copernicus 2024 absent : lancer d'abord scripts/fetch-tcd.py")
    raster = build_raster()
    build_coarse()
    build_tiles(raster)
