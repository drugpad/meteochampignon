#!/usr/bin/env python3
"""Collecte les cumuls de pluie 3 jours des stations Infoclimat (réseau StatIC) de Midi-Pyrénées.

Contrairement à Météo-France, l'API OpenData d'Infoclimat (infoclimat.fr/opendata) fournit l'HISTORIQUE :
on redemande donc les 72 dernières heures à chaque passage et on recalcule le cumul (pas d'accumulation).
Écrit `public/infoclimat-stations.json` dans le dépôt par l'API GitHub (comme stations.py) :
  { "generatedAt": ISO, "stations": [ {"id","name","lat","lon","mm","hours"} ] }
L'appli lit ce fichier et affiche une bulle par station (même rendu que Météo-France, lib/stationRain.ts).

Secrets (secrets.yaml) : meteochampignon_infoclimat_token (clé OpenData « Non-commercial »), github_dispatch_auth.
Options : --dry-run (ne pas écrire), --check (diagnostic).
"""
import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

REPO = "drugpad/meteochampignon"
BRANCH = "master"
OUTPUT_PATH = "public/infoclimat-stations.json"
STATIONS_URL = "https://www.infoclimat.fr/opendata/stations_xhr.php"
OPENDATA_URL = "https://www.infoclimat.fr/opendata/"
SECRETS_FILE = os.environ.get("HA_SECRETS", "/config/secrets.yaml")
GITHUB_API = os.environ.get("GITHUB_API_BASE", "https://api.github.com")

# Emprise Midi-Pyrénées (identique à src/lib/config.ts / regionOutline).
LAT_MIN, LAT_MAX, LON_MIN, LON_MAX = 42.6, 45.15, -0.4, 3.4
WINDOW_HOURS = 72
BATCH = 20          # stations par requête OpenData (testé : ~20 OK)
PAUSE = 0.5
DRY_RUN = "--dry-run" in sys.argv
CHECK = "--check" in sys.argv
UA = {"User-Agent": "home-assistant-meteochampignon"}


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def read_secret(name):
    try:
        text = open(SECRETS_FILE, encoding="utf-8").read()
    except OSError as err:
        raise SystemExit(fail(f"secrets.yaml illisible ({err})"))
    m = re.search(rf'^\s*{re.escape(name)}\s*:\s*["\']?(.*?)["\']?\s*$', text, re.M)
    if not m or not m.group(1):
        raise SystemExit(fail(f"clé '{name}' absente de secrets.yaml"))
    return m.group(1)


def fail(message, **extra):
    print(json.dumps({"ok": False, "erreur": message, **extra}, ensure_ascii=False))
    return 1


def http(url, headers=None, data=None, method=None, timeout=60):
    req = urllib.request.Request(url, headers=headers or {}, data=data, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()


def gh_headers(auth, raw=False):
    return {
        "Authorization": auth,
        "Accept": "application/vnd.github.raw+json" if raw else "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "home-assistant-meteochampignon",
    }


def zone_stations():
    status, body = http(STATIONS_URL, UA, timeout=40)
    if status != 200:
        raise RuntimeError(f"liste Infoclimat illisible (HTTP {status})")
    out = []
    for s in json.loads(body):
        try:
            lat, lon = float(s["latitude"]), float(s["longitude"])
        except (KeyError, ValueError, TypeError):
            continue
        if LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX:
            out.append({"id": s["id"], "name": s.get("libelle") or s["id"], "lat": round(lat, 5), "lon": round(lon, 5)})
    return out


def fetch_batch(ids, token, start, end):
    params = [("method", "get"), ("format", "json"), ("start", start), ("end", end), ("token", token)]
    params += [("stations[]", i) for i in ids]
    url = OPENDATA_URL + "?" + urllib.parse.urlencode(params)
    status, body = http(url, UA, timeout=60)
    if status != 200:
        return {}
    try:
        hourly = json.loads(body).get("hourly", {})
    except ValueError:
        return {}
    return {k: v for k, v in hourly.items() if k != "_params"}


def cumul(points, now):
    """Somme la pluie horaire (pluie_1h échantillonnée à chaque heure ronde) sur les 72 dernières heures.

    Les stations StatIC rapportent souvent toutes les ~6 min : sommer tous les pluie_1h (= pluie de l'heure
    écoulée) compterait 6 fois chaque averse. On garde donc une valeur par heure ronde (la plus proche de HH:00).
    """
    since = now - timedelta(hours=WINDOW_HOURS)
    by_hour = {}
    for p in points:
        try:
            dt = datetime.strptime(p["dh_utc"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        except (KeyError, ValueError):
            continue
        v = p.get("pluie_1h")
        if since < dt <= now and v not in (None, ""):
            hk = dt.replace(minute=0, second=0, microsecond=0)
            if hk not in by_hour or dt.minute < by_hour[hk][0]:
                by_hour[hk] = (dt.minute, max(0.0, float(v)))
    total = sum(v for _, v in by_hour.values())
    return round(total, 1), len(by_hour)


def collect(token):
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    stations = zone_stations()
    start = (now - timedelta(hours=WINDOW_HOURS + 1)).strftime("%Y-%m-%d")
    end = (now + timedelta(days=1)).strftime("%Y-%m-%d")
    by_id = {s["id"]: s for s in stations}
    result = []
    ids = list(by_id)
    for i in range(0, len(ids), BATCH):
        if i:
            time.sleep(PAUSE)
        hourly = fetch_batch(ids[i : i + BATCH], token, start, end)
        for sid, points in hourly.items():
            mm, hours = cumul(points, now)
            if hours > 0:
                result.append({**by_id[sid], "mm": mm, "hours": hours})
    result.sort(key=lambda s: s["id"])
    return {"generatedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "stations": result}, len(stations)


def publish(payload, auth):
    url = f"{GITHUB_API}/repos/{REPO}/contents/{OUTPUT_PATH}"
    content = base64.b64encode(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()).decode()
    for attempt in range(3):
        status, meta = http(f"{url}?ref={BRANCH}", gh_headers(auth))
        sha = json.loads(meta)["sha"] if status == 200 else None
        body = {"message": "Cumuls Infoclimat (Home Assistant)", "content": content, "branch": BRANCH}
        if sha:
            body["sha"] = sha
        st, resp = http(url, {**gh_headers(auth), "Content-Type": "application/json"}, data=json.dumps(body).encode(), method="PUT", timeout=60)
        if st in (200, 201):
            return
        if st in (409, 422) and attempt < 2:
            time.sleep(2)
            continue
        hint = " (jeton sans « Contents : lecture et écriture » ?)" if st in (403, 404) else ""
        raise RuntimeError(f"écriture GitHub refusée (HTTP {st}){hint}: {resp[:200].decode('utf-8', 'replace')}")


def check():
    token = read_secret("meteochampignon_infoclimat_token")
    report = {"ok": True}
    try:
        stations = zone_stations()
        report["stations_zone"] = len(stations)
        hourly = fetch_batch([s["id"] for s in stations[:5]], token, (datetime.now(timezone.utc) - timedelta(days=2)).strftime("%Y-%m-%d"), datetime.now(timezone.utc).strftime("%Y-%m-%d"))
        report["token"] = "OK" if hourly else "aucune donnée (clé ou zone ?)"
        report["ok"] = bool(hourly)
    except Exception as err:  # noqa: BLE001
        report["erreur"] = str(err)
        report["ok"] = False
    print(json.dumps(report, ensure_ascii=False, indent=1))
    return 0 if report["ok"] else 1


def main():
    if CHECK:
        return check()
    token = read_secret("meteochampignon_infoclimat_token")
    try:
        payload, total = collect(token)
    except Exception as err:  # noqa: BLE001
        return fail(f"collecte Infoclimat échouée: {err}")
    actives = len(payload["stations"])
    result = {"ok": True, "stations_zone": total, "stations_actives": actives}
    if DRY_RUN:
        top = sorted(payload["stations"], key=lambda s: -s["mm"])[:5]
        print(json.dumps({**result, "ecrit": False, "dry_run": True, "top": [[s["name"], s["mm"]] for s in top]}, ensure_ascii=False))
        return 0
    try:
        publish(payload, read_secret("github_dispatch_auth"))
    except Exception as err:  # noqa: BLE001
        return fail(str(err), **result)
    print(json.dumps({**result, "ecrit": True}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
