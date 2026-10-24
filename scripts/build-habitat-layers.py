"""Couches d'habitat des champignons sur Midi-Pyrénées (à lancer rarement, sur le poste).

Ramène sur UNE grille commune (celle des cartes de pluie, 4 fois plus fine : 0,0025°, ~250 m) des données
publiques et ouvertes :
  - BD Forêt V2 (IGN, Etalab 2.0) : part de chaque groupe d'essences dans la case ;
  - Copernicus DEM GLO-90 (bucket public AWS) : altitude, pente, orientation ;
  - SoilGrids 2.0 (ISRIC, CC BY 4.0) : pH de l'eau du sol, 0-5 cm ;
  - ESA WorldCover 2021 (CC BY 4.0) : prairies et lisières (coulemelle).
Écrit .cache-habitat/layers.npz, lu par scripts/build-habitat.py (les règles par espèce, rapides à
retoucher). Les téléchargements sont mis en cache dans .cache-habitat/ (non versionné).

Lancement : .venv-habitat/Scripts/python scripts/build-habitat-layers.py
(dépendances : rasterio pyproj pyshp numpy scipy pillow ; 7-Zip pour la BD Forêt)
"""
import glob
import json
import os
import subprocess
import sys
import urllib.request

import numpy as np
import rasterio
import shapefile
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.transform import from_bounds
from rasterio.warp import reproject

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache-habitat")
os.makedirs(CACHE, exist_ok=True)

# Même emprise que les cartes de pluie (maps.json) ; 4 cases d'habitat par case de pluie dans chaque sens.
LAT_MIN, LAT_MAX, LON_MIN, LON_MAX = 42.595, 45.155, -0.405, 3.405
ROWS, COLS = 256 * 4, 381 * 4
TRANSFORM = from_bounds(LON_MIN, LAT_MIN, LON_MAX, LAT_MAX, COLS, ROWS)  # ligne 0 = nord
FINE = 5  # sur-échantillonnage pour la BD Forêt (cases de ~50 m), puis parts par case de 250 m
DEPTS = ["09", "12", "31", "32", "46", "65", "81", "82"]


def log(msg):
    print(msg, flush=True)


# --------------------------------------------------------------------------------------------------
# BD Forêt : groupe d'essences par code TFV.
GROUPS = [
    "aucun",  # 0 : hors formation végétale cartographiée
    "chene",  # chênes décidus (pédonculé, rouvre, pubescent)
    "chene_vert",  # chênes sempervirents (yeuse, liège)
    "hetre",
    "chataignier",
    "feuillus",  # mélange de feuillus, autre feuillu, îlots
    "robinier",
    "peuplier",
    "mixte",  # feuillus + conifères
    "pins",
    "sapin_epicea",
    "autres_conif",  # douglas, mélèze, autres conifères
    "lande",  # lande ligneuse
    "herbe",  # formation herbacée, forêt sans couvert
]
G = {name: i for i, name in enumerate(GROUPS)}


def group_of(code):
    if code.startswith("FF1G01"):
        return G["chene"]
    if code.startswith("FF1G06"):
        return G["chene_vert"]
    if code.startswith("FF1-09"):
        return G["hetre"]
    if code.startswith("FF1-10"):
        return G["chataignier"]
    if code.startswith("FF1-14"):
        return G["robinier"]
    if code == "FP":
        return G["peuplier"]
    if code.startswith(("FF31", "FF32", "FO3")):
        return G["mixte"]
    if code.startswith(("FF2-5", "FF2G5", "FF2-80", "FF2-81", "FF2-57", "FF2G57")):
        return G["pins"]
    if code.startswith("FF2G61"):
        return G["sapin_epicea"]
    if code.startswith(("FF2", "FO2")):
        return G["autres_conif"]
    if code.startswith(("FF1", "FO1")):
        return G["feuillus"]
    if code.startswith("LA4"):
        return G["lande"]
    if code.startswith(("LA6", "FF0", "FO0")):
        return G["herbe"]
    return None


def forest_layers():
    out = os.path.join(CACHE, "bdforet-fractions.npz")
    if os.path.exists(out):
        return np.load(out)
    to_wgs = Transformer.from_crs("EPSG:2154", "EPSG:4326", always_xy=True)
    fine = np.zeros((ROWS * FINE, COLS * FINE), np.uint8)
    open_forest = np.zeros_like(fine)
    fine_tr = from_bounds(LON_MIN, LAT_MIN, LON_MAX, LAT_MAX, COLS * FINE, ROWS * FINE)
    unknown = {}
    for dept in DEPTS:
        paths = glob.glob(os.path.join(CACHE, "bdforet", f"*_D0{dept}_*", "**", "FORMATION_VEGETALE.shp"), recursive=True)
        if not paths:
            sys.exit(f"BD Forêt du {dept} absente : télécharger et décompresser dans .cache-habitat/bdforet/")
        reader = shapefile.Reader(paths[0], encoding="utf-8")
        shapes, opens = [], []
        for sr in reader.iterShapeRecords():
            code = sr.record["CODE_TFV"]
            g = group_of(code)
            if g is None:
                unknown[code] = unknown.get(code, 0) + 1
                continue
            geo = sr.shape.__geo_interface__
            geo = _transform_geom(geo, to_wgs)
            shapes.append((geo, g))
            if code.startswith("FO"):
                opens.append((geo, 1))
        log(f"BD Forêt {dept} : {len(shapes)} polygones")
        # Pas de recouvrement entre départements (sauf bord) : le dernier écrit gagne, sans conséquence.
        layer = rasterize(shapes, out_shape=fine.shape, transform=fine_tr, fill=0, dtype="uint8")
        fine = np.where(layer > 0, layer, fine)
        if opens:
            o = rasterize(opens, out_shape=fine.shape, transform=fine_tr, fill=0, dtype="uint8")
            open_forest |= o
    if unknown:
        log(f"Codes TFV ignorés : {unknown}")
    # Parts de chaque groupe dans chaque case de 250 m (moyenne des 25 sous-cases).
    blocks = fine.reshape(ROWS, FINE, COLS, FINE)
    fractions = np.stack([(blocks == g).mean(axis=(1, 3)) for g in range(len(GROUPS))]).astype(np.float32)
    open_frac = open_forest.reshape(ROWS, FINE, COLS, FINE).mean(axis=(1, 3)).astype(np.float32)
    np.savez_compressed(out, fractions=fractions, open=open_frac)
    return np.load(out)


def _transform_geom(geo, tr):
    def ring(coords):
        xs, ys = zip(*[(c[0], c[1]) for c in coords])
        lon, lat = tr.transform(xs, ys)
        return list(zip(lon, lat))

    if geo["type"] == "Polygon":
        return {"type": "Polygon", "coordinates": [ring(r) for r in geo["coordinates"]]}
    return {"type": "MultiPolygon", "coordinates": [[ring(r) for r in p] for p in geo["coordinates"]]}


# --------------------------------------------------------------------------------------------------
def warp_to_grid(src_path_or_url, resampling, band=1, dtype=np.float32, nodata=np.nan, shape=(ROWS, COLS), transform=TRANSFORM):
    dst = np.full(shape, nodata, dtype)
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif"):
        with rasterio.open(src_path_or_url) as src:
            reproject(
                rasterio.band(src, band),
                dst,
                dst_transform=transform,
                dst_crs="EPSG:4326",
                resampling=resampling,
                dst_nodata=nodata,
            )
    return dst


def dem_layers():
    out = os.path.join(CACHE, "dem.npz")
    if os.path.exists(out):
        return np.load(out)
    alt = np.full((ROWS, COLS), np.nan, np.float32)
    for lat in range(42, 46):
        for lon in range(-1, 4):
            ns, ew = ("N" if lat >= 0 else "S"), ("E" if lon >= 0 else "W")
            name = f"Copernicus_DSM_COG_30_{ns}{abs(lat):02d}_00_{ew}{abs(lon):03d}_00_DEM"
            local = os.path.join(CACHE, "dem", name + ".tif")
            if not os.path.exists(local):
                os.makedirs(os.path.dirname(local), exist_ok=True)
                url = f"https://copernicus-dem-90m.s3.amazonaws.com/{name}/{name}.tif"
                try:
                    urllib.request.urlretrieve(url, local)
                except Exception as err:  # tuile en mer / absente
                    log(f"DEM {name} absent ({err})")
                    continue
            part = warp_to_grid(local, Resampling.average)
            alt = np.where(np.isnan(alt), part, alt)
            log(f"DEM {name} ok")
    # Pente et orientation sur la grille de 250 m (dimensions réelles des cases en mètres).
    lat_c = LAT_MAX - (np.arange(ROWS) + 0.5) * (LAT_MAX - LAT_MIN) / ROWS
    dy = (LAT_MAX - LAT_MIN) / ROWS * 111_320
    dx = (LON_MAX - LON_MIN) / COLS * 111_320 * np.cos(np.radians(lat_c))[:, None]
    a = np.nan_to_num(alt, nan=0)
    gy, gx = np.gradient(a)  # gy : vers le sud (ligne 0 = nord)
    dzdx = gx / dx
    dzdy = -gy / dy  # vers le nord
    slope = np.degrees(np.arctan(np.hypot(dzdx, dzdy))).astype(np.float32)
    aspect = (np.degrees(np.arctan2(-dzdx, -dzdy)) % 360).astype(np.float32)  # direction de la descente, 0 = nord
    np.savez_compressed(out, alt=alt, slope=slope, aspect=aspect)
    return np.load(out)


def soil_ph():
    out = os.path.join(CACHE, "ph.npz")
    if os.path.exists(out):
        return np.load(out)
    local = os.path.join(CACHE, "soilgrids-phh2o-0-5cm.tif")
    if not os.path.exists(local):
        url = (
            "https://maps.isric.org/mapserv?map=/map/phh2o.map&SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage"
            "&COVERAGEID=phh2o_0-5cm_mean&FORMAT=image/tiff&SUBSETTINGCRS=http://www.opengis.net/def/crs/EPSG/0/4326"
            f"&OUTPUTCRS=http://www.opengis.net/def/crs/EPSG/0/4326&SUBSET=lat({LAT_MIN},{LAT_MAX})&SUBSET=long({LON_MIN},{LON_MAX})"
            "&RESOLUTION=lat(0.0025)&RESOLUTION=long(0.0025)"
        )
        log("SoilGrids : téléchargement du pH…")
        urllib.request.urlretrieve(url, local)
    ph = warp_to_grid(local, Resampling.bilinear) / 10.0  # SoilGrids : pH x 10
    ph[ph <= 0] = np.nan
    np.savez_compressed(out, ph=ph.astype(np.float32))
    return np.load(out)


def worldcover():
    """Part de prairie (classe 30), d'arbres (10) et de cultures (40) par case, via les aperçus des COG."""
    out = os.path.join(CACHE, "worldcover.npz")
    if os.path.exists(out):
        return np.load(out)
    sub = 5  # lecture à ~50 m (aperçus du COG), puis parts par case de 250 m
    fine_tr = from_bounds(LON_MIN, LAT_MIN, LON_MAX, LAT_MAX, COLS * sub, ROWS * sub)
    classes = np.zeros((ROWS * sub, COLS * sub), np.uint8)
    for lat in (42,):
        for lon in (-3, 0, 3):
            for la in (lat, lat + 3):
                ew = "E" if lon >= 0 else "W"
                name = f"ESA_WorldCover_10m_2021_v200_N{la:02d}{ew}{abs(lon):03d}_Map"
                url = f"/vsicurl/https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/{name}.tif"
                try:
                    part = warp_to_grid(url, Resampling.mode, dtype=np.uint8, nodata=0, shape=classes.shape, transform=fine_tr)
                except Exception as err:
                    log(f"WorldCover {name} : {err}")
                    continue
                classes = np.where(classes == 0, part, classes)
                log(f"WorldCover {name} ok")
    blocks = classes.reshape(ROWS, sub, COLS, sub)
    res = {k: (blocks == v).mean(axis=(1, 3)).astype(np.float32) for k, v in (("trees", 10), ("grass", 30), ("crops", 40), ("built", 50))}
    np.savez_compressed(out, **res)
    return np.load(out)


def region_mask():
    """1 dans les 8 départements (contour de src/data, déjà utilisé par l'appli)."""
    path = os.path.join(ROOT, "src", "data", "midi-pyrenees-outline.json")
    cands = glob.glob(os.path.join(ROOT, "src", "data", "*outline*.json")) + glob.glob(os.path.join(ROOT, "src", "data", "*region*.json"))
    path = cands[0] if cands else path
    geo = json.load(open(path, encoding="utf-8"))
    feats = geo["features"] if geo.get("type") == "FeatureCollection" else [geo]
    geoms = [(f.get("geometry", f), 1) for f in feats]
    return rasterize(geoms, out_shape=(ROWS, COLS), transform=TRANSFORM, fill=0, dtype="uint8")


def main():
    forest = forest_layers()
    dem = dem_layers()
    ph = soil_ph()
    wc = worldcover()
    mask = region_mask()
    np.savez_compressed(
        os.path.join(CACHE, "layers.npz"),
        groups=np.array(GROUPS),
        fractions=forest["fractions"],
        open=forest["open"],
        alt=dem["alt"],
        slope=dem["slope"],
        aspect=dem["aspect"],
        ph=ph["ph"],
        trees=wc["trees"],
        grass=wc["grass"],
        crops=wc["crops"],
        built=wc["built"],
        mask=mask,
    )
    f = forest["fractions"]
    inside = mask == 1
    log("Parts moyennes dans la région : " + ", ".join(f"{g} {f[i][inside].mean():.3f}" for i, g in enumerate(GROUPS)))
    log(f"pH : {np.nanmin(ph['ph'][inside]):.1f}-{np.nanmax(ph['ph'][inside]):.1f} ; altitude max {np.nanmax(dem['alt'][inside]):.0f} m")


if __name__ == "__main__":
    main()
