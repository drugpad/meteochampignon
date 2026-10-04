#!/usr/bin/env python3
"""Cartes de pluie (24h passées + 7 jours prévus) à partir des données brutes
des modèles Météo-France, lues sur le stockage public d'Open-Meteo.

Pourquoi pas l'API Open-Meteo : une grille de points interrogée par l'API coûte
UN appel par point (règle documentée : 10 000 appels/jour en usage gratuit non
commercial) — la grille précédente (10 922 points, deux cartes) en consommait
12 000 à 18 000 par jour, et jusqu'à 44 000 si le cron avait tourné à 100 %.
Ici on lit les fichiers du bucket public `s3://openmeteo` (AWS Open Data,
licence CC BY 4.0, aucun quota annoncé) : une grille complète par heure, dont
on ne télécharge que NOTRE fenêtre (lecture partielle du format .om).

Gain de précision : AROME HD à 1,5 km (grille de 0,01°) au lieu de 3,3 km.
Vérifié contre les pluviomètres de 228 stations pour une heure donnée : ce
fichier fait au moins aussi bien que l'API (corrélation 0,44 contre 0,41,
erreur absolue moyenne 0,46 contre 0,68 mm).

Sorties (dossier OUT_DIR) :
  rain24h.png            cumul des 24 dernières heures (AROME HD)
  forecast-day{0..6}.png cumul prévu par jour calendaire (Paris)
  maps.json              métadonnées (emprise, dates, modèles, encodage)
Chaque PNG est en niveaux de gris 8 bits : valeur = mm * 10 (plafonné à
25,5 mm : le dernier palier de la légende est « 20mm+ »), ligne 0 = nord.

Modèle par jour de prévision : le plus fin qui couvre TOUTE la journée —
AROME HD (51h), puis ARPEGE Europe (0,1°, ~4 jours), puis IFS ECMWF (0,25°,
10 jours). Au-delà de 2 jours aucun modèle ne descend plus bas que ces
résolutions : on ne perd rien par rapport à la réalité.

Dépendances : numpy scipy s3fs omfiles pillow.
"""
import json
import os
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import numpy as np
import s3fs
from omfiles import OmFileReader
from PIL import Image
from scipy.interpolate import RegularGridInterpolator

OUT_DIR = os.environ.get("OUT_DIR", "maps-out")
BUCKET = "openmeteo"
S3_HTTP = "https://openmeteo.s3.amazonaws.com"

# Emprise de la carte (identique à MIDI_PYRENEES_BOUNDS, src/lib/config.ts).
LAT_MIN, LAT_MAX, LON_MIN, LON_MAX = 42.6, 45.15, -0.4, 3.4

MM_SCALE = 10      # 1 niveau = 0,1 mm
MM_MAX = 25.5      # 255 / MM_SCALE
THREADS = 8
PARIS = ZoneInfo("Europe/Paris")
UTC = timezone.utc

fs = s3fs.S3FileSystem(anon=True, client_kwargs={"region_name": "us-west-2"})


def log(msg):
    print(msg, flush=True)


# --------------------------------------------------------------------------
# Grilles des modèles. Origine (sud-ouest) et pas déduits du CRS du latest.json
# et de la forme du tableau ; vérifiés : lignes croissantes vers le nord.
# --------------------------------------------------------------------------
class Model:
    def __init__(self, name):
        self.name = name
        meta = json.load(urllib.request.urlopen(f"{S3_HTTP}/data_spatial/{name}/latest.json", timeout=30))
        if not meta.get("completed"):
            raise RuntimeError(f"{name}: dernier run incomplet")
        self.ref = parse_ref(meta["reference_time"])
        self.valid = [parse_ref(v) for v in meta["valid_times"]]
        # BBOX[S, W, N, E] dans le WKT (centres des cellules extrêmes).
        s0, w0, n0, e0 = [float(x) for x in re.search(r"BBOX\[([^\]]+)\]", meta["crs_wkt"]).group(1).split(",")]
        self.s0, self.w0, self.n0, self.e0 = s0, w0, n0, e0
        probe = self.reader(self.valid[-1])
        self.ny, self.nx = probe.shape
        self.dy = (n0 - s0) / (self.ny - 1)
        self.dx = (e0 - w0) / (self.nx - 1)
        log(f"{name}: run {self.ref:%Y-%m-%d %HZ}, {len(self.valid)} pas, grille {self.ny}x{self.nx} pas {self.dy:.4f}/{self.dx:.4f}")

    def path(self, valid, ref=None):
        ref = ref or self.ref
        return f"{BUCKET}/data_spatial/{self.name}/{ref:%Y/%m/%d}/{ref:%H}00Z/{valid:%Y-%m-%dT%H}00.om"

    def reader(self, valid, ref=None):
        return OmFileReader.from_fsspec(fs, self.path(valid, ref)).get_child_by_name("precipitation")

    def window_indices(self, margin=1):
        i0 = int(np.floor((LAT_MIN - self.s0) / self.dy)) - margin
        i1 = int(np.ceil((LAT_MAX - self.s0) / self.dy)) + 1 + margin
        j0 = int(np.floor((LON_MIN - self.w0) / self.dx)) - margin
        j1 = int(np.ceil((LON_MAX - self.w0) / self.dx)) + 1 + margin
        return i0, i1, j0, j1

    def read(self, valid, ref=None, retries=3):
        """Fenêtre de précipitation (mm) ; None si le fichier n'existe pas."""
        i0, i1, j0, j1 = self.window_indices()
        for attempt in range(retries):
            try:
                arr = self.reader(valid, ref).read_array((slice(i0, i1), slice(j0, j1)))
                return np.nan_to_num(np.asarray(arr, dtype=np.float32), nan=0.0).clip(min=0)
            except FileNotFoundError:
                return None
            except Exception as err:  # réseau / fichier en cours d'écriture
                if "NoSuchKey" in str(err) or "404" in str(err) or "Not Found" in str(err):
                    return None
                if attempt == retries - 1:
                    log(f"  lecture échouée {self.name} {valid:%d %Hh}: {err}")
                    return None
        return None

    def coords(self):
        i0, i1, j0, j1 = self.window_indices()
        lats = self.s0 + self.dy * np.arange(i0, i1)
        lons = self.w0 + self.dx * np.arange(j0, j1)
        return lats, lons


def parse_ref(s):
    # reference_time : « 2026-10-04T12:00:00Z », valid_times : « 2026-10-04T12:00Z ».
    fmt = "%Y-%m-%dT%H:%M:%SZ" if s.count(":") == 2 else "%Y-%m-%dT%H:%MZ"
    return datetime.strptime(s, fmt).replace(tzinfo=UTC)


def floor_hours(dt, n):
    return dt.replace(minute=0, second=0, microsecond=0) - timedelta(hours=dt.hour % n)


# --------------------------------------------------------------------------
# AROME HD : pluie horaire « raccordée » (comme le fait Open-Meteo pour le
# passé) — pour une heure passée, le run le plus récent qui la précède avec
# l'échéance la plus courte ; pour le futur, le dernier run complet.
# La valeur au temps T est le cumul de l'heure (T-1h, T].
# --------------------------------------------------------------------------
class Arome:
    def __init__(self, now):
        self.m = Model("meteofrance_arome_france_hd")
        self.now = now
        self.cache = {}

    def hour(self, t):
        """Pluie (mm) sur l'heure se terminant à t (UTC), ou None."""
        if t in self.cache:
            return self.cache[t]
        base = min(floor_hours(t - timedelta(hours=1), 3), self.m.ref)
        out = None
        for k in range(6):  # jusqu'à 15h d'échéance en plus
            ref = base - timedelta(hours=3 * k)
            if t <= ref:
                continue
            out = self.m.read(t, ref)
            if out is not None:
                break
        self.cache[t] = out
        return out

    def prefetch(self, times):
        with ThreadPoolExecutor(THREADS) as ex:
            list(ex.map(self.hour, times))


def to_target_grid(coarse, model, rows, cols):
    """Interpolation bilinéaire d'un champ du modèle vers la grille de sortie."""
    lats, lons = model.coords()
    f = RegularGridInterpolator((lats, lons), coarse, method="linear", bounds_error=False, fill_value=0.0)
    tl, tn = np.meshgrid(target_lats(rows), target_lons(cols), indexing="ij")
    return f(np.stack([tl.ravel(), tn.ravel()], axis=-1)).reshape(rows, cols).clip(min=0).astype(np.float32)


# Grille de sortie = cellules AROME HD de la fenêtre (0,01°), lignes vers le nord.
AROME_S0, AROME_W0, AROME_STEP = 37.5, -12.0, 0.01


def out_shape():
    i0 = round((LAT_MIN - AROME_S0) / AROME_STEP)
    i1 = round((LAT_MAX - AROME_S0) / AROME_STEP) + 1
    j0 = round((LON_MIN - AROME_W0) / AROME_STEP)
    j1 = round((LON_MAX - AROME_W0) / AROME_STEP) + 1
    return i0, i1, j0, j1


def target_lats(rows):
    i0, _, _, _ = out_shape()
    return AROME_S0 + AROME_STEP * (i0 + np.arange(rows))


def target_lons(cols):
    _, _, j0, _ = out_shape()
    return AROME_W0 + AROME_STEP * (j0 + np.arange(cols))


def crop_arome(arr, model):
    """Fenêtre lue (avec marge) -> grille de sortie exacte."""
    mi0, _, mj0, _ = model.window_indices()
    i0, i1, j0, j1 = out_shape()
    return arr[i0 - mi0 : i1 - mi0, j0 - mj0 : j1 - mj0]


# --------------------------------------------------------------------------
# Encodage / écriture
# --------------------------------------------------------------------------
def save_png(mm, path):
    levels = np.rint(np.clip(mm, 0, MM_MAX) * MM_SCALE).astype(np.uint8)
    Image.fromarray(np.ascontiguousarray(levels[::-1])).save(path, optimize=True, compress_level=9)  # ligne 0 = nord


def paris_day_bounds(today, offset):
    d = today + timedelta(days=offset)
    start = datetime(d.year, d.month, d.day, tzinfo=PARIS).astimezone(UTC)
    nxt = d + timedelta(days=1)
    end = datetime(nxt.year, nxt.month, nxt.day, tzinfo=PARIS).astimezone(UTC)
    return d, start, end


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    now = datetime.now(UTC)
    arome = Arome(now)
    rows = out_shape()[1] - out_shape()[0]
    cols = out_shape()[3] - out_shape()[2]
    log(f"Grille de sortie: {rows} x {cols} cellules (0,01°)")

    # --- 1) cumul des 24 dernières heures -------------------------------
    end_h = now.replace(minute=0, second=0, microsecond=0)
    hours24 = [end_h - timedelta(hours=h) for h in range(23, -1, -1)]
    today = now.astimezone(PARIS).date()
    days = [paris_day_bounds(today, k) for k in range(7)]

    # Heures AROME à lire : les 24 dernières + tout ce que couvrent D0 et D1.
    wanted = set(hours24)
    for _, start, end in days[:2]:
        t = start + timedelta(hours=1)
        while t <= end:
            wanted.add(t)
            t += timedelta(hours=1)
    wanted = sorted(t for t in wanted if t <= arome.m.valid[-1])
    arome.prefetch(wanted)

    got24 = [t for t in hours24 if arome.hour(t) is not None]
    log(f"24h: {len(got24)}/24 heures disponibles")
    if len(got24) < 22:
        raise RuntimeError(f"Trop peu d'heures AROME pour la carte 24h ({len(got24)}/24)")
    acc = sum(crop_arome(arome.hour(t), arome.m) for t in got24)
    save_png(acc, f"{OUT_DIR}/rain24h.png")
    log(f"rain24h: moyenne {acc.mean():.2f} mm, max {acc.max():.1f} mm")

    # --- 2) prévisions par jour calendaire (Paris) ------------------------
    arpege = ifs = None
    forecast = []
    for k, (d, start, end) in enumerate(days):
        hours = []
        t = start + timedelta(hours=1)
        while t <= end:
            hours.append(t)
            t += timedelta(hours=1)

        model_name = None
        field = None
        arome_cover = [arome.hour(t) for t in hours] if hours[-1] <= arome.m.valid[-1] else None
        if arome_cover is not None and sum(a is None for a in arome_cover) <= 2:
            field = sum(crop_arome(a, arome.m) for a in arome_cover if a is not None)
            model_name, res_km = "meteofrance_arome_france_hd", 1.5
            run = arome.m.ref
        else:
            if arpege is None:
                arpege = Model("meteofrance_arpege_europe")
            if hours[-1] <= arpege.valid[-1] and start >= arpege.ref:
                with ThreadPoolExecutor(THREADS) as ex:
                    parts = list(ex.map(lambda t: arpege.read(t), hours))
                if sum(p is None for p in parts) <= 2:
                    field = to_target_grid(sum(p for p in parts if p is not None), arpege, rows, cols)
                    model_name, res_km, run = "meteofrance_arpege_europe", 11, arpege.ref
            if field is None:
                if ifs is None:
                    ifs = Model("ecmwf_ifs025")
                # Pas de 3h puis 6h : chaque fichier est le cumul de l'intervalle
                # (t_prev, t] ; on en répartit la part qui tombe dans la journée.
                steps = [(ifs.valid[i - 1], ifs.valid[i]) for i in range(1, len(ifs.valid))]
                inter = [(p, q) for p, q in steps if q > start and p < end]
                if not inter or inter[-1][1] < end:
                    log(f"jour {d}: hors de portée de tous les modèles, ignoré")
                    continue
                with ThreadPoolExecutor(THREADS) as ex:
                    parts = list(ex.map(lambda pq: ifs.read(pq[1]), inter))
                tot = 0
                for (p, q), arr in zip(inter, parts):
                    if arr is None:
                        continue
                    overlap = (min(q, end) - max(p, start)).total_seconds() / (q - p).total_seconds()
                    tot = tot + arr * overlap
                field = to_target_grid(tot, ifs, rows, cols)
                model_name, res_km, run = "ecmwf_ifs025", 25, ifs.ref

        fname = f"forecast-day{k}.png"
        save_png(field, f"{OUT_DIR}/{fname}")
        forecast.append({
            "date": d.isoformat(), "file": fname, "model": model_name,
            "resolutionKm": res_km, "run": run.strftime("%Y-%m-%dT%H:%MZ"),
        })
        log(f"{d} -> {model_name}: moyenne {field.mean():.2f} mm, max {field.max():.1f} mm")

    if not forecast:
        raise RuntimeError("Aucune prévision produite")

    # Contrôle de cohérence entre modèles sur le jour de recouvrement (info).
    if arpege is not None and len(forecast) > 1 and forecast[1]["model"] == "meteofrance_arome_france_hd":
        log("contrôle: voir moyennes AROME (D1) et ARPEGE (D2) ci-dessus (ordres de grandeur comparables attendus)")

    half = AROME_STEP / 2  # les cellules sont centrées sur les coordonnées
    meta = {
        "fetchedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "bounds": {
            "latMin": round(target_lats(rows)[0] - half, 4), "latMax": round(target_lats(rows)[-1] + half, 4),
            "lonMin": round(target_lons(cols)[0] - half, 4), "lonMax": round(target_lons(cols)[-1] + half, 4),
        },
        "rows": rows, "cols": cols,
        "encoding": {"mmPerLevel": 1 / MM_SCALE, "maxMm": MM_MAX},
        "rain24h": {
            "file": "rain24h.png", "from": (hours24[0] - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%MZ"),
            "to": hours24[-1].strftime("%Y-%m-%dT%H:%MZ"), "hours": len(got24),
            "model": "meteofrance_arome_france_hd", "run": arome.m.ref.strftime("%Y-%m-%dT%H:%MZ"),
        },
        "forecast": forecast,
        "attribution": "Données : Météo-France (AROME, ARPEGE), ECMWF (IFS) via Open-Meteo.com (CC BY 4.0)",
    }
    with open(f"{OUT_DIR}/maps.json", "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, separators=(",", ":"))
    total = sum(os.path.getsize(f"{OUT_DIR}/{f}") for f in os.listdir(OUT_DIR))
    log(f"OK: {len(forecast)} jours de prévision, {total/1024:.0f} Ko au total")


if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        log(f"ÉCHEC: {err}")
        sys.exit(1)
