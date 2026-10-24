"""Pousse des champignons : la météo est-elle favorable, aujourd'hui et les 6 jours suivants ?

Lancé par .github/workflows/maps.yml JUSTE APRÈS build-rain-maps.py (même runner, même OUT_DIR, mêmes
modèles lus sur le stockage public d'Open-Meteo : zéro appel d'API en régime normal).

1. Historique météo jour par jour (pluie, température moyenne et minimale) sur la grille des cartes de pluie,
   gardé 40 jours dans weather/ sur la branche data. Chaque run relit l'historique publié, recalcule les jours
   encore disponibles sur le stockage public (7 jours de rétention) et complète. Les jours plus anciens
   manquants (premier lancement, longue panne) sont repris UNE fois à l'API « historical forecast »
   d'Open-Meteo sur une grille de 0,1° (~1 000 points, sous le quota gratuit).
2. Pour chaque jour J (aujourd'hui + 6 jours prévus) et chaque espèce : un score météo de 0 à 1 =
     développement depuis une grosse pluie (degrés-jours depuis l'épisode, fenêtre propre à l'espèce)
   x humidité du sol (réservoir simple : pluie - évaporation selon la température)
   x température des 5 derniers jours  x  absence de gel  x  saison.
   Règles lisibles, tirées de la littérature mycologique (pas calées sur un service tiers).
3. Sorties publiées (OUT_DIR) : pousse-<espèce>-d<k>.png (score x 255, ligne 0 = nord), pousse-info-d<k>.png
   (R = pluie des 15 derniers jours / 2 mm, G = jours depuis la dernière grosse pluie (255 = aucune),
   B = (température moyenne des 5 derniers jours + 10) x 6), pousse.json, et weather/ (historique).

L'appli multiplie ce score par l'habitat de l'espèce (public/habitat/, scripts/build-habitat.py).
"""
import importlib.util
import io
import json
import os
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("rainmaps", os.path.join(HERE, "build-rain-maps.py"))
rm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rm)

OUT_DIR, WORK_DIR = rm.OUT_DIR, rm.WORK_DIR
REPO = os.environ.get("GITHUB_REPOSITORY", "drugpad/meteochampignon")
ARCHIVE_URL = os.environ.get("WEATHER_ARCHIVE_URL", f"https://raw.githubusercontent.com/{REPO}/data/weather")
KEEP_DAYS = 40
LONG_DAYS = 15  # courbe de potentiel : aujourd'hui + 14 jours
HISTORY_DAYS = 35  # profondeur utilisée par le modèle de pousse
log = rm.log


# --------------------------------------------------------------------------------------------------
# Historique : un PNG 16 bits par jour, 3 bandes empilées (pluie x10, tmoy et tmin en (T + 50) x 100),
# lignes vers le NORD comme les tableaux des modèles. PNG plutôt que .npz : octets identiques d'un run à
# l'autre pour un jour inchangé, donc aucun nouvel objet git sur la branche data.
def encode_day(rain, tmean, tmin):
    stack = np.concatenate(
        [np.clip(np.rint(rain * 10), 0, 65535), np.clip(np.rint((tmean + 50) * 100), 0, 65535), np.clip(np.rint((tmin + 50) * 100), 0, 65535)]
    ).astype(np.uint16)
    buf = io.BytesIO()
    Image.fromarray(stack).save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def decode_day(data, rows):
    a = np.asarray(Image.open(io.BytesIO(data))).astype(np.float32)
    return a[:rows] / 10, a[rows : 2 * rows] / 100 - 50, a[2 * rows :] / 100 - 50


def fetch(url, timeout=30):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.read()


def load_archive(rows):
    """{date: (pluie, tmoy, tmin, source)} depuis la branche data (vide au premier lancement)."""
    try:
        index = json.loads(fetch(f"{ARCHIVE_URL}/index.json"))
    except Exception as err:
        log(f"historique météo : pas d'index ({err}), on repart de zéro")
        return {}
    days = {}

    def one(item):
        d, src = item
        try:
            return d, (*decode_day(fetch(f"{ARCHIVE_URL}/{d}.png"), rows), src)
        except Exception as err:
            log(f"historique {d} illisible ({err})")
            return d, None

    with ThreadPoolExecutor(8) as ex:
        for d, v in ex.map(one, index.get("days", {}).items()):
            if v is not None:
                days[date.fromisoformat(d)] = v
    log(f"historique météo : {len(days)} jours relus")
    return days


def save_archive(days):
    os.makedirs(f"{OUT_DIR}/weather", exist_ok=True)
    for d, (rain, tmean, tmin, _src) in days.items():
        with open(f"{OUT_DIR}/weather/{d.isoformat()}.png", "wb") as fh:
            fh.write(encode_day(rain, tmean, tmin))
    index = {"days": {d.isoformat(): v[3] for d, v in sorted(days.items())}, "encoding": "PNG 16 bits, 3 bandes : pluie x10, (tmoy+50)x100, (tmin+50)x100, ligne 0 = sud"}
    with open(f"{OUT_DIR}/weather/index.json", "w", encoding="utf-8") as fh:
        json.dump(index, fh, ensure_ascii=False, separators=(",", ":"))


# --------------------------------------------------------------------------------------------------
# Température AROME « raccordée » : pour un instant passé, le run le plus récent qui le précède (échéance
# la plus courte) ; pour le futur, le dernier run. Toutes les 3 h (8 valeurs par jour suffisent pour la
# moyenne et un minimum approché).
class AromeTemp:
    def __init__(self, model):
        self.m = model
        self.cache = {}

    def at(self, t):
        if t in self.cache:
            return self.cache[t]
        base = min(rm.floor_hours(t, 3), self.m.ref)
        out = None
        for k in range(6):
            ref = base - timedelta(hours=3 * k)
            if t < ref:
                continue
            arr = self.m.read(t, ref, var="temperature_2m")
            if arr is not None:
                out = rm.crop_arome(arr, self.m)
                break
        self.cache[t] = out
        return out


def day_hours(d, step):
    _, start, end = rm.paris_day_bounds(d, 0)
    t = start + timedelta(hours=(step - start.hour % step) % step)
    out = []
    while t < end:
        out.append(t)
        t += timedelta(hours=step)
    return out


def arome_day(arome, temp, d):
    """(pluie, tmoy, tmin) d'un jour entier avec AROME, ou None si trop d'heures manquent."""
    _, start, end = rm.paris_day_bounds(d, 0)
    hours = [start + timedelta(hours=h + 1) for h in range(int((end - start).total_seconds() // 3600))]
    if hours[-1] > arome.m.valid[-1]:
        return None
    arome.prefetch(hours)  # lectures en parallèle (une par heure)
    rains = [arome.hour(t) for t in hours]
    if sum(r is None for r in rains) > 2:
        return None
    rain = sum(rm.crop_arome(r, arome.m) for r in rains if r is not None) * len(hours) / sum(r is not None for r in rains)
    with ThreadPoolExecutor(rm.THREADS) as ex:
        temps = [x for x in ex.map(temp.at, day_hours(d, 3)) if x is not None]
    if len(temps) < 6:
        return None
    t = np.stack(temps)
    return rain.astype(np.float32), t.mean(axis=0), t.min(axis=0)


def coarse_temp_day(model, d, rows, cols):
    """(tmoy, tmin) d'un jour avec un modèle plus grossier (ARPEGE, IFS, AIFS), ou None."""
    _, start, end = rm.paris_day_bounds(d, 0)
    times = [t for t in model.valid if start <= t < end]
    if len(times) < 3 or times[0] - start > timedelta(hours=6) or end - times[-1] > timedelta(hours=7):
        return None
    with ThreadPoolExecutor(rm.THREADS) as ex:
        arrs = [a for a in ex.map(lambda t: model.read(t, var="temperature_2m"), times) if a is not None]
    if len(arrs) < 3:
        return None
    grid = [rm.to_target_grid_raw(a, model, rows, cols) for a in arrs]
    t = np.stack(grid)
    return t.mean(axis=0), t.min(axis=0)


# --------------------------------------------------------------------------------------------------
# Repli pour les jours trop anciens pour le stockage public : API « historical forecast » d'Open-Meteo,
# grille de 0,1°, interpolée. Rarement utilisé (premier lancement ou panne de plus de 6 jours).
def backfill_open_meteo(dates, rows, cols):
    if not dates:
        return {}
    start, end = min(dates), max(dates)
    lats = np.round(np.arange(42.6, 45.15 + 1e-9, 0.1), 3)
    lons = np.round(np.arange(-0.4, 3.4 + 1e-9, 0.1), 3)
    pts = [(la, lo) for la in lats for lo in lons]
    ndays = (end - start).days + 1
    rain = np.zeros((ndays, len(pts)), np.float32)
    tmean = np.zeros_like(rain)
    tmin = np.zeros_like(rain)
    # Quota gratuit : 600 appels/min, chaque point compte (x nb de jours / 14). Paquets de 50 points espacés
    # de 10 s, et nouvel essai après 65 s si le service répond « trop de requêtes » (constaté le 24/10/2026
    # avec des paquets de 100 envoyés d'affilée).
    import time

    batch = 50
    log(f"repli Open-Meteo : {len(pts)} points, {start} -> {end}")
    for i in range(0, len(pts), batch):
        chunk = pts[i : i + batch]
        if i:
            time.sleep(10)
        url = (
            "https://historical-forecast-api.open-meteo.com/v1/forecast?"
            f"latitude={','.join(str(p[0]) for p in chunk)}&longitude={','.join(str(p[1]) for p in chunk)}"
            f"&start_date={start}&end_date={end}&daily=precipitation_sum,temperature_2m_mean,temperature_2m_min"
            "&models=meteofrance_seamless&timezone=Europe%2FParis"
        )
        # Nouvel essai sur « trop de requêtes » (429) ET sur coupure réseau / délai dépassé : le 24/10/2026, le
        # premier run sur GitHub a échoué sur « handshake operation timed out », sans nouvel essai.
        for attempt in range(4):
            try:
                data = json.loads(fetch(url, timeout=120))
                break
            except urllib.error.HTTPError as err:
                if err.code != 429 or attempt == 3:
                    raise
                log("  Open-Meteo : trop de requêtes, pause de 65 s")
                time.sleep(65)
            except (urllib.error.URLError, TimeoutError, OSError) as err:
                if attempt == 3:
                    raise
                log(f"  Open-Meteo injoignable ({err}), nouvel essai dans 20 s")
                time.sleep(20)
        data = data if isinstance(data, list) else [data]
        for j, loc in enumerate(data):
            dd = loc["daily"]
            rain[:, i + j] = [v or 0 for v in dd["precipitation_sum"]]
            tmean[:, i + j] = [v if v is not None else np.nan for v in dd["temperature_2m_mean"]]
            tmin[:, i + j] = [v if v is not None else np.nan for v in dd["temperature_2m_min"]]
    from scipy.interpolate import RegularGridInterpolator

    tl, tn = np.meshgrid(rm.target_lats(rows), rm.target_lons(cols), indexing="ij")
    q = np.stack([tl.ravel(), tn.ravel()], axis=-1)

    def grid(v):
        f = RegularGridInterpolator((lats, lons), v.reshape(len(lats), len(lons)), bounds_error=False, fill_value=None)
        return f(q).reshape(rows, cols).astype(np.float32)

    out = {}
    for k in range(ndays):
        d = start + timedelta(days=k)
        if d in dates and not np.isnan(tmean[k]).all():
            out[d] = (np.clip(grid(rain[k]), 0, None), grid(np.nan_to_num(tmean[k], nan=np.nanmean(tmean[k]))), grid(np.nan_to_num(tmin[k], nan=np.nanmean(tmin[k]))), "open-meteo")
    return out


# --------------------------------------------------------------------------------------------------
# Correction de la pluie passée par les pluviomètres Météo-France (historique horaire de 10 jours publié
# sur la branche live par la collecte des stations). Le modèle donne une valeur partout ; les stations
# disent ce qui est vraiment tombé là où elles sont. Méthode : l'écart (mesure - modèle) de chaque station
# est réparti autour d'elle avec un poids gaussien (portée ~10 km) ; loin de toute station, le poids du
# modèle seul (W0) l'emporte et la carte reste celle du modèle. Correction ADDITIVE : une station peut
# ajouter la pluie d'un orage que le modèle a placé à côté. L'historique stocké reste le modèle brut.
STATIONS_URL = os.environ.get("STATIONS_URL", f"https://raw.githubusercontent.com/{REPO}/live/public/station-history.json")
CORR_RANGE_KM = 10.0
CORR_W0 = 0.15  # poids « modèle seul » : une station à ~20 km ne corrige presque plus


def load_stations():
    """[(lat, lon, {datetime UTC: rr1})] des stations, ou [] si indisponible."""
    try:
        hist = json.loads(fetch(STATIONS_URL, timeout=60))["stations"]
        coords = {s["id"]: (s["lat"], s["lon"]) for s in json.load(open(os.path.join(HERE, "..", "src", "data", "stations-midi-pyrenees.json"), encoding="utf-8"))}
    except Exception as err:
        log(f"stations indisponibles ({err}) : pluie du modèle seul")
        return []
    out = []
    for sid, obs in hist.items():
        if sid not in coords:
            continue
        rr = {}
        for o in obs:
            if o.get("rr1") is not None:
                rr[datetime.strptime(o["time"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=rm.UTC)] = float(o["rr1"])
        out.append((*coords[sid], rr))
    log(f"stations : {len(out)} pluviomètres relus")
    return out


def station_totals(stations, d):
    """[(lat, lon, mm)] pour le jour d (Paris) : rr1 = pluie de l'heure qui PRÉCÈDE l'horodatage, donc les
    observations de ]minuit, minuit]. Jour complet exigé (au moins 22 heures sur 24)."""
    _, start, end = rm.paris_day_bounds(d, 0)
    res = []
    for lat, lon, rr in stations:
        vals = [v for t, v in rr.items() if start < t <= end]
        if len(vals) >= 22:
            res.append((lat, lon, sum(vals) * 24 / len(vals)))
    return res


def correct_rain(rain, totals, rows, cols):
    """Carte de pluie corrigée par les stations, et (écart moyen avant, après) aux stations."""
    if len(totals) < 10:
        return rain, None
    lats, lons = rm.target_lats(rows), rm.target_lons(cols)
    from scipy.interpolate import RegularGridInterpolator

    f = RegularGridInterpolator((lats, lons), rain, bounds_error=False, fill_value=None)
    st = np.array([(t[0], t[1]) for t in totals])
    meas = np.array([t[2] for t in totals])
    model = f(st)
    resid = meas - model
    la, lo = np.meshgrid(lats, lons, indexing="ij")
    num = np.zeros_like(rain, dtype=np.float64)
    den = np.full(rain.shape, CORR_W0, dtype=np.float64)
    for (slat, slon), r in zip(st, resid):
        dy = (la - slat) * 111.32
        dx = (lo - slon) * 111.32 * np.cos(np.radians(slat))
        w = np.exp(-(dx * dx + dy * dy) / (2 * CORR_RANGE_KM**2))
        num += w * r
        den += w
    out = np.clip(rain + num / den, 0, None).astype(np.float32)
    after = RegularGridInterpolator((lats, lons), out, bounds_error=False, fill_value=None)(st)
    return out, (float(np.abs(resid).mean()), float(np.abs(meas - after).mean()))


# --------------------------------------------------------------------------------------------------
# Modèle de pousse (règles par espèce).
SPECIES = {
    # seuil : pluie sur 3 jours qui déclenche une pousse (mm) ; dd : degrés-jours (base 4 °C) depuis
    # l'épisode -> début, pic, fin de la fenêtre de pousse ; temp : courbe de la température moyenne des
    # 5 derniers jours ; saison : facteur par mois (janvier -> décembre).
    # Cèpes de chaleur : sortent vite après un orage par temps chaud, de juin à septembre.
    "cepe_ete": {"seuil": 25, "dd": (60, 100, 190), "temp": [(10, 0), (14, 0.6), (17, 1), (26, 1), (30, 0.5)],
                 "saison": [0, 0, 0, 0, 0.4, 0.9, 1, 1, 0.8, 0.3, 0.05, 0]},
    # Assoupli le 24/10/2026 : la tête de nègre donne encore un peu en octobre, voire début novembre les
    # automnes doux, dans les coteaux (1re version : éteinte sous 10 °C et octobre réduit de moitié).
    "cepe_bronze": {"seuil": 25, "dd": (70, 115, 210), "temp": [(8, 0), (11, 0.5), (15, 1), (25, 1), (29, 0.5)],
                    "saison": [0, 0, 0, 0, 0.1, 0.4, 0.8, 1, 1, 0.9, 0.35, 0.05]},
    # Cèpes d'automne : il leur faut de la fraîcheur (nuits qui rafraîchissent), septembre à novembre.
    "cepe_bordeaux": {"seuil": 30, "dd": (90, 140, 260), "temp": [(4, 0), (7, 0.5), (10, 1), (17, 1), (21, 0.5), (25, 0.15)],
                      "saison": [0, 0, 0, 0, 0.1, 0.2, 0.2, 0.4, 0.9, 1, 0.7, 0.15]},
    "cepe_pins": {"seuil": 30, "dd": (90, 140, 260), "temp": [(4, 0), (7, 0.5), (10, 1), (18, 1), (22, 0.5)],
                  "saison": [0, 0, 0, 0, 0.1, 0.3, 0.5, 0.6, 1, 1, 0.5, 0.1]},
    "girolle": {"seuil": 20, "dd": (100, 180, 380), "temp": [(6, 0), (10, 0.6), (14, 1), (22, 1), (26, 0.5)],
                "saison": [0, 0, 0, 0, 0.3, 0.8, 1, 1, 1, 0.8, 0.4, 0.1]},
    "coulemelle": {"seuil": 15, "dd": (70, 120, 240), "temp": [(6, 0), (10, 0.6), (13, 1), (22, 1), (26, 0.5)],
                   "saison": [0, 0, 0, 0, 0.1, 0.4, 0.8, 1, 1, 0.9, 0.4, 0.05]},
    "trompette": {"seuil": 25, "dd": (100, 160, 300), "temp": [(3, 0), (6, 0.6), (9, 1), (16, 1), (20, 0.6), (24, 0.3)],
                  "saison": [0.2, 0.05, 0, 0, 0, 0, 0.3, 0.6, 0.9, 1, 1, 0.5]},
}
W_MAX = 60  # réserve d'eau utile de la litière et du sol superficiel (mm)


def curve(x, pts):
    xs, ys = zip(*pts)
    return np.interp(x, xs, ys)


def season_factor(sp, d):
    # Interpolation entre milieux de mois (pas de saut au 1er du mois).
    s = SPECIES[sp]["saison"]
    pos = d.month - 1 + (d.day - 15) / 30
    i = int(np.floor(pos)) % 12
    frac = pos - np.floor(pos)
    return s[i] * (1 - frac) + s[(i + 1) % 12] * frac


def pousse(series, dates, k_target, sp):
    """Score 0-1 pour le jour dates[k_target] à partir des séries (jours, lignes, colonnes)."""
    P, Tm, Tn = series
    cfg = SPECIES[sp]
    start_dd, peak_dd, end_dd = cfg["dd"]
    k0 = max(0, k_target - HISTORY_DAYS)
    W = np.full(P.shape[1:], 20.0, np.float32)
    dev = np.zeros(P.shape[1:], np.float32)
    for k in range(k0, k_target + 1):
        et = np.maximum(0.3, 0.1 * Tm[k] + 0.3)
        W = np.clip(W + P[k] - et, 0, W_MAX)
    # Épisodes de pluie : chaque jour e où la pluie sur 3 jours dépasse le seuil ouvre une fenêtre ; on garde
    # la meilleure fenêtre en cours (degrés-jours depuis e, pondérés par la force de l'épisode).
    for e in range(k0 + 2, k_target + 1):
        p3 = P[e - 2 : e + 1].sum(axis=0)
        strong = p3 >= cfg["seuil"]
        if not strong.any():
            continue
        dd = np.maximum(0, Tm[e + 1 : k_target + 1] - 4).sum(axis=0) if e < k_target else np.zeros_like(p3)
        f = np.where(
            dd < start_dd,
            0,
            np.where(dd < peak_dd, (dd - start_dd) / (peak_dd - start_dd), np.clip(1 - (dd - peak_dd) / (end_dd - peak_dd), 0, 1)),
        )
        force = 0.6 + 0.4 * np.clip(p3 / (cfg["seuil"] * 2), 0, 1)
        dev = np.maximum(dev, np.where(strong, f * force, 0))
    moist = curve(W, [(0, 0.1), (5, 0.25), (10, 0.6), (20, 1), (W_MAX, 1)])
    t5 = Tm[max(0, k_target - 4) : k_target + 1].mean(axis=0)
    temp = curve(t5, cfg["temp"])
    frost = np.where(Tn[max(0, k_target - 2) : k_target + 1].min(axis=0) < -1, 0.3, 1.0)
    return np.clip(dev * moist * temp * frost * season_factor(sp, dates[k_target]), 0, 1)


def info_layer(series, dates, k_target):
    P, Tm, _ = series
    rain15 = P[max(0, k_target - 14) : k_target + 1].sum(axis=0)
    since = np.full(P.shape[1:], 255, np.float32)
    for e in range(k_target, max(1, k_target - 60), -1):
        p3 = P[max(0, e - 2) : e + 1].sum(axis=0)
        hit = (p3 >= 20) & (since == 255)
        since[hit] = k_target - e
    t5 = Tm[max(0, k_target - 4) : k_target + 1].mean(axis=0)
    rgb = np.stack([np.clip(np.rint(rain15 / 2), 0, 255), np.clip(since, 0, 255), np.clip(np.rint((t5 + 10) * 6), 0, 255)], axis=-1)
    return rgb.astype(np.uint8)


def save_png(arr01_or_rgb, path):
    a = arr01_or_rgb
    if a.ndim == 2:
        a = np.rint(np.clip(a, 0, 1) * 255).astype(np.uint8)
    Image.fromarray(np.ascontiguousarray(a[::-1])).save(path, optimize=True, compress_level=9)  # ligne 0 = nord


# --------------------------------------------------------------------------------------------------
def main():
    now = datetime.now(rm.UTC)
    today = now.astimezone(rm.PARIS).date()
    rows = rm.out_shape()[1] - rm.out_shape()[0]
    cols = rm.out_shape()[3] - rm.out_shape()[2]

    archive = load_archive(rows)
    # Garde-fou : quoi qu'il arrive ensuite, l'historique relu est republié (sinon un échec du calcul de
    # pousse effacerait 40 jours d'historique de la branche data, écrasée à chaque run).
    save_archive({d: v for d, v in archive.items() if d >= today - timedelta(days=KEEP_DAYS)})

    arome = rm.Arome(now)
    temp = AromeTemp(arome.m)
    # Jours passés recalculés depuis le stockage public : hier et avant-hier toujours (derniers runs), les
    # autres seulement s'ils manquent. Aujourd'hui fait partie des jours de prévision ci-dessous.
    for back in range(1, 7):
        d = today - timedelta(days=back)
        if back > 2 and d in archive and archive[d][3] == "arome":
            continue
        got = arome_day(arome, temp, d)
        if got is not None:
            archive[d] = (*got, "arome")
            log(f"{d} : AROME, pluie moyenne {got[0].mean():.1f} mm, tmoy {got[1].mean():.1f} °C")
        elif d not in archive:
            log(f"{d} : plus disponible sur le stockage public")

    missing = [today - timedelta(days=b) for b in range(1, HISTORY_DAYS + 1) if today - timedelta(days=b) not in archive]
    if missing:
        try:
            archive.update(backfill_open_meteo(set(missing), rows, cols))
        except Exception as err:
            log(f"repli Open-Meteo échoué ({err}) : les jours manquants comptent comme secs et doux")
    save_archive({d: v for d, v in archive.items() if d >= today - timedelta(days=KEEP_DAYS)})

    # Jours prévus (aujourd'hui compris) : pluie non plafonnée laissée par build-rain-maps.py ; température
    # AROME tant qu'il couvre la journée, puis ARPEGE / IFS / AIFS corrigés du biais constaté par rapport à
    # AROME sur un jour commun (les modèles grossiers ignorent le relief : 10-25 km de maille).
    forecast_days = []
    for k in range(7):
        d = today + timedelta(days=k)
        path = f"{WORK_DIR}/rain-{d.isoformat()}.npy"
        if not os.path.exists(path):
            break
        forecast_days.append((d, np.load(path)))
    if not forecast_days:
        raise RuntimeError("pas de pluie prévue laissée par build-rain-maps.py")
    # Jours 8 à 15 : modèle d'IA d'ECMWF (AIFS, 15 jours d'échéance, maille de 25 km), pour la courbe de
    # potentiel de la fiche d'un endroit. Prévision peu fiable au-delà d'une semaine : marquée « reliable »
    # = false dans pousse.json, tracée en pointillés dans l'appli. Les cartes et les jours cliquables restent
    # limités aux 7 premiers jours.
    aifs = rm.load_model("ecmwf_aifs025_single") if len(forecast_days) == 7 else None
    while aifs is not None and len(forecast_days) < LONG_DAYS:
        d = today + timedelta(days=len(forecast_days))
        _, start, end = rm.paris_day_bounds(d, 0)
        field = rm.stepped_field(aifs, start, end, rows, cols)
        if field is None:
            break
        forecast_days.append((d, field))
    log(f"jours prévus : {len(forecast_days)} (dont {max(0, len(forecast_days) - 7)} avec AIFS seul)")

    coarse = {}
    bias = {}
    temps = {}
    for d, _rain in forecast_days:
        got = None
        ar = [temp.at(t) for t in day_hours(d, 3)] if day_hours(d, 3)[-1] <= arome.m.valid[-1] else []
        ar = [x for x in ar if x is not None]
        if len(ar) >= 6:
            t = np.stack(ar)
            got = (t.mean(axis=0), t.min(axis=0))
        else:
            for name in ("meteofrance_arpege_europe", "ecmwf_ifs025", "ecmwf_aifs025_single"):
                if name not in coarse:
                    coarse[name] = rm.load_model(name)
                model = coarse[name]
                if model is None:
                    continue
                if name not in bias:
                    # Biais = AROME - modèle grossier, sur le premier jour couvert par les deux.
                    bias[name] = None
                    for dref, _ in forecast_days:
                        if dref in temps and temps[dref][2] == "arome":
                            c = coarse_temp_day(model, dref, rows, cols)
                            if c is not None:
                                bias[name] = (temps[dref][0] - c[0], temps[dref][1] - c[1])
                                log(f"biais AROME - {name} : moyenne {bias[name][0].mean():+.1f} °C, max {np.abs(bias[name][0]).max():.1f}")
                                break
                c = coarse_temp_day(model, d, rows, cols)
                if c is not None:
                    b = bias[name] or (0, 0)
                    got = (c[0] + b[0], c[1] + b[1])
                    temps[d] = (*got, name)
                    break
        if got is None:
            log(f"{d} : pas de température, prévision arrêtée là")
            break
        temps.setdefault(d, (*got, "arome"))

    days = sorted(set(archive) | set(temps))
    days = [d for d in days if d >= today - timedelta(days=HISTORY_DAYS)]
    rain_of = {d: r for d, r in forecast_days}
    P, Tm, Tn = [], [], []
    for d in [today - timedelta(days=b) for b in range(HISTORY_DAYS, 0, -1)] + [d for d, _ in forecast_days if d in temps]:
        if d in temps:
            P.append(rain_of[d])
            Tm.append(temps[d][0])
            Tn.append(temps[d][1])
        elif d in archive:
            P.append(archive[d][0])
            Tm.append(archive[d][1])
            Tn.append(archive[d][2])
        else:  # jour introuvable : sec et doux (n'invente ni pluie ni gel)
            P.append(np.zeros((rows, cols), np.float32))
            Tm.append(np.full((rows, cols), 12, np.float32))
            Tn.append(np.full((rows, cols), 6, np.float32))
    # Pluie des jours passés corrigée par les pluviomètres (les 10 jours couverts par leur historique).
    stations = load_stations()
    corrected = 0
    for k, d in enumerate([today - timedelta(days=b) for b in range(HISTORY_DAYS, 0, -1)]):
        if not stations or d not in archive:
            continue
        totals = station_totals(stations, d)
        P[k], err = correct_rain(P[k], totals, rows, cols)
        if err:
            corrected += 1
            log(f"{d} : {len(totals)} pluviomètres, écart moyen modèle {err[0]:.2f} mm -> {err[1]:.2f} mm après correction")
    series = (np.stack(P), np.stack(Tm), np.stack(Tn))
    timeline = [today - timedelta(days=b) for b in range(HISTORY_DAYS, 0, -1)] + [d for d, _ in forecast_days if d in temps]

    out_days = []
    for d in [d for d, _ in forecast_days if d in temps]:
        k = timeline.index(d)
        files = {}
        for sp in SPECIES:
            score = pousse(series, timeline, k, sp)
            fname = f"pousse-{sp}-d{len(out_days)}.png"
            save_png(score, f"{OUT_DIR}/{fname}")
            files[sp] = fname
        info = f"pousse-info-d{len(out_days)}.png"
        save_png(info_layer(series, timeline, k), f"{OUT_DIR}/{info}")
        out_days.append({"date": d.isoformat(), "files": files, "info": info, "tempModel": temps[d][2], "reliable": len(out_days) < 7})
        log(f"{d} : " + ", ".join(f"{sp} {np.asarray(Image.open(f'{OUT_DIR}/{files[sp]}')).mean() / 255:.3f}" for sp in SPECIES))

    missing_now = [d.isoformat() for d in timeline[:HISTORY_DAYS] if d not in archive]
    meta = {
        "generatedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "bounds": json.load(open(f"{OUT_DIR}/maps.json", encoding="utf-8"))["bounds"],
        "rows": rows,
        "cols": cols,
        "species": list(SPECIES),
        "days": out_days,
        "history": {"days": HISTORY_DAYS, "missing": missing_now, "sources": sorted({v[3] for v in archive.values()}), "stationCorrectedDays": corrected},
        "info": {"r": "pluie des 15 derniers jours / 2 (mm)", "g": "jours depuis la dernière pluie de 20 mm en 3 jours (255 = aucune)", "b": "(température moyenne des 5 derniers jours + 10) x 6"},
    }
    with open(f"{OUT_DIR}/pousse.json", "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, separators=(",", ":"))
    log(f"pousse : {len(out_days)} jours, historique manquant : {len(missing_now)} jours")


if __name__ == "__main__":
    try:
        main()
    except Exception as err:
        import traceback

        traceback.print_exc()
        log(f"ÉCHEC pousse : {err}")
        sys.exit(1)
