#!/usr/bin/env python3
"""Collecte de l'historique horaire des stations, exécutée par Home Assistant.

Équivalent Python (bibliothèque standard uniquement : aucune installation) de
scripts/fetch-station-history.mjs + scripts/merge-station-history.mjs, pour que
la collecte ne dépende plus des runners GitHub Actions (incident du 05/10/2026 :
"The job was not acquired by Runner").

Fonctionnement :
  1. lit l'historique actuel sur GitHub (public/station-history.json) ;
  2. repère les heures des 23 dernières heures où moins de 95 % des stations ont
     un point (+ les 3 dernières) : l'API "Paquet Observations" de Météo-France
     renvoie TOUTES les stations d'une heure en UN appel ;
  3. fusionne (un point déjà présent n'est jamais modifié) ;
  4. s'il y a du neuf, écrit le fichier dans le dépôt via l'API GitHub, avec le
     sha lu à l'étape 1 : si quelqu'un d'autre (le traitement GitHub, par
     exemple) a écrit entre-temps, GitHub refuse (409/422) et on recommence à
     l'étape 1 — jamais d'écrasement.

Clés lues dans /config/secrets.yaml (ou HA_SECRETS) :
  github_dispatch_auth        : "Bearer github_pat_..." (permission « Contents :
                                lecture et écriture » en plus de « Actions »)
  meteochampignon_mf_token    : clé API Météo-France

Usage : python3 stations.py [--dry-run | --check]
          --dry-run : fait tout SAUF écrire dans le dépôt
          --check   : test sans rien écrire : clé Météo-France, lecture de l'historique et
                      PERMISSION D'ÉCRITURE du jeton (voir check())
Sortie : une ligne JSON {"ok":…, …} ; code de sortie 0 si OK, 1 sinon.
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
HISTORY_PATH = "public/station-history.json"
STATIONS_PATH = "src/data/stations-midi-pyrenees.json"
PAQUET_URL = "https://public-api.meteofrance.fr/public/DPPaquetObs/v2/paquet/stations/horaire"
SECRETS_FILE = os.environ.get("HA_SECRETS", "/config/secrets.yaml")
GITHUB_API = os.environ.get("GITHUB_API_BASE", "https://api.github.com")  # surchargé par les tests uniquement

WINDOW_HOURS = 23          # limite stricte de l'API Paquet (< 24h)
KEEP_HOURS = 240           # fenêtre glissante de l'historique (10 jours)
PUBLICATION_LAG_MIN = 15   # l'observation de l'heure H est publiée vers H+10 min
COMPLETE_RATIO = 0.95
ALWAYS_REFETCH_LAST_HOURS = 3
MAX_WRITE_ATTEMPTS = 3
DRY_RUN = "--dry-run" in sys.argv
CHECK = "--check" in sys.argv


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def read_secret(name):
    """Lit `name: "valeur"` dans secrets.yaml (sans dépendance YAML)."""
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


def iso_hour(dt):
    return dt.strftime("%Y-%m-%dT%H:00:00Z")


def to_point(obs):
    t = obs.get("t")
    rr1 = obs.get("rr1")
    return {
        "time": obs["validity_time"],
        "rr1": max(0, rr1) if isinstance(rr1, (int, float)) else None,
        "temp": round(t - 273.15, 1) if isinstance(t, (int, float)) else None,
    }


def load_stations(auth):
    status, body = http(
        f"{GITHUB_API}/repos/{REPO}/contents/{STATIONS_PATH}?ref={BRANCH}", gh_headers(auth, raw=True)
    )
    if status != 200:
        raise RuntimeError(f"liste des stations illisible (HTTP {status})")
    return [s["id"] for s in json.loads(body)]


def load_history(auth):
    """Renvoie (historique, sha) : le sha est celui du contenu lu, pour l'écriture."""
    status, meta = http(f"{GITHUB_API}/repos/{REPO}/contents/{HISTORY_PATH}?ref={BRANCH}", gh_headers(auth))
    if status != 200:
        raise RuntimeError(f"métadonnées de l'historique illisibles (HTTP {status})")
    sha = json.loads(meta)["sha"]
    # Le contenu est lu au MÊME sha (blob) : jamais un état plus récent que celui qu'on enverra.
    status, body = http(f"{GITHUB_API}/repos/{REPO}/git/blobs/{sha}", gh_headers(auth, raw=True))
    if status != 200:
        raise RuntimeError(f"historique illisible (HTTP {status})")
    return json.loads(body), sha


def hours_to_fetch(stations, history, now):
    first = (now - timedelta(hours=WINDOW_HOURS)).replace(minute=0, second=0, microsecond=0)
    if first < now - timedelta(hours=WINDOW_HOURS):
        first += timedelta(hours=1)
    last = (now - timedelta(minutes=PUBLICATION_LAG_MIN)).replace(minute=0, second=0, microsecond=0)
    have = {}
    wanted = set(stations)
    for sid, points in history.get("stations", {}).items():
        if sid in wanted:
            for p in points:
                have[p["time"]] = have.get(p["time"], 0) + 1
    hours, t = [], first
    while t <= last:
        iso = iso_hour(t)
        recent = (last - t) < timedelta(hours=ALWAYS_REFETCH_LAST_HOURS)
        if recent or have.get(iso, 0) < COMPLETE_RATIO * len(stations):
            hours.append(iso)
        t += timedelta(hours=1)
    return hours


def fetch_hour(mf_key, iso):
    url = f"{PAQUET_URL}?date={urllib.parse.quote(iso)}&format=json"
    for attempt in range(3):
        try:
            status, body = http(url, {"apikey": mf_key}, timeout=60)
        except OSError as err:
            log(f"  {iso}: erreur réseau ({err}), essai {attempt + 1}/3")
            time.sleep(3 * (attempt + 1))
            continue
        if status == 200:
            return json.loads(body)
        if status == 429 or status >= 500:
            time.sleep(5 * (attempt + 1))
            continue
        log(f"  {iso}: HTTP {status}")
        return None
    return None


def merge(history, collected, now):
    stations = history.setdefault("stations", {})
    cutoff = now - timedelta(hours=KEEP_HOURS)
    added = 0
    for sid, points in collected.items():
        existing = stations.get(sid, [])
        known = {p["time"] for p in existing}
        fresh = [p for p in points if p["time"] not in known]
        added += len(fresh)
        merged = existing + fresh
        merged = [p for p in merged if datetime.strptime(p["time"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc) >= cutoff]
        merged.sort(key=lambda p: p["time"])
        stations[sid] = merged
    # Élagage de TOUTES les stations : une station qui a cessé de transmettre n'est plus dans
    # `collected` et gardait sinon éternellement ses vieux points.
    for sid, points in stations.items():
        stations[sid] = [p for p in points if datetime.strptime(p["time"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc) >= cutoff]
    if added:
        history["fetchedAt"] = now.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    return added


def check():
    """Test sans écriture. La permission d'écriture est vérifiée par un PUT avec un
    sha volontairement FAUX : avec « Contents : Read and write », GitHub répond
    409/422 (sha incorrect, rien n'est écrit) ; sans cette permission, 403/404."""
    auth = read_secret("github_dispatch_auth")
    mf_key = read_secret("meteochampignon_mf_token")
    now = datetime.now(timezone.utc)
    report = {"ok": True}

    status, _ = http(f"{GITHUB_API}/repos/{REPO}", gh_headers(auth))
    report["github_lecture"] = "OK" if status == 200 else f"ERREUR HTTP {status} (jeton refusé ou expiré ?)"
    status, _ = http(
        f"{GITHUB_API}/repos/{REPO}/contents/{HISTORY_PATH}",
        {**gh_headers(auth), "Content-Type": "application/json"},
        data=json.dumps({"message": "test de permission (jamais écrit)", "content": "e30=", "sha": "0" * 40, "branch": BRANCH}).encode(),
        method="PUT",
    )
    if status in (409, 422):
        report["github_ecriture"] = "OK (permission « Contents : Read and write » présente)"
    else:
        report["github_ecriture"] = f"REFUSÉE (HTTP {status}) : ajoutez « Contents : Read and write » au jeton" if status in (403, 404) else f"inattendu (HTTP {status})"
        report["ok"] = False
    if report["github_lecture"] != "OK":
        report["ok"] = False

    try:
        history, _sha = load_history(auth)
        n = sum(len(p) for p in history.get("stations", {}).values())
        report["historique"] = f"OK ({len(history.get('stations', {}))} stations, {n} points)"
    except Exception as err:  # noqa: BLE001
        report["historique"] = f"ERREUR ({err})"
        report["ok"] = False

    last = (now - timedelta(minutes=PUBLICATION_LAG_MIN)).replace(minute=0, second=0, microsecond=0)
    data = fetch_hour(mf_key, iso_hour(last))
    if data is None:
        report["meteofrance"] = "ERREUR : clé refusée ou service indisponible"
        report["ok"] = False
    else:
        report["meteofrance"] = f"OK ({len(data)} stations reçues pour {iso_hour(last)})"
    print(json.dumps(report, ensure_ascii=False, indent=1))
    return 0 if report["ok"] else 1


def main():
    if CHECK:
        return check()
    auth = read_secret("github_dispatch_auth")
    mf_key = read_secret("meteochampignon_mf_token")
    now = datetime.now(timezone.utc)

    stations = load_stations(auth)
    for attempt in range(1, MAX_WRITE_ATTEMPTS + 1):
        history, sha = load_history(auth)
        hours = hours_to_fetch(stations, history, now)
        wanted = set(stations)
        collected, received = {}, 0
        for i, iso in enumerate(hours):
            if i:
                time.sleep(0.7)
            data = fetch_hour(mf_key, iso)
            if data is None:
                continue
            received += 1
            for obs in data:
                if obs.get("geo_id_insee") in wanted and obs.get("validity_time"):
                    collected.setdefault(obs["geo_id_insee"], []).append(to_point(obs))
        if hours and received == 0:
            return fail("API Paquet indisponible (aucune heure reçue)", heures_demandees=len(hours))

        added = merge(history, collected, now)
        result = {"ok": True, "heures_demandees": len(hours), "heures_recues": received, "points_ajoutes": added}
        if added == 0:
            print(json.dumps({**result, "ecrit": False}, ensure_ascii=False))
            return 0
        if DRY_RUN:
            print(json.dumps({**result, "ecrit": False, "dry_run": True}, ensure_ascii=False))
            return 0

        content = base64.b64encode(json.dumps(history, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).decode()
        payload = json.dumps(
            {
                "message": "Accumuler l'historique des stations (Home Assistant)",
                "content": content,
                "sha": sha,
                "branch": BRANCH,
            }
        ).encode()
        status, body = http(
            f"{GITHUB_API}/repos/{REPO}/contents/{HISTORY_PATH}",
            {**gh_headers(auth), "Content-Type": "application/json"},
            data=payload,
            method="PUT",
            timeout=120,
        )
        if status in (200, 201):
            print(json.dumps({**result, "ecrit": True}, ensure_ascii=False))
            return 0
        if status in (409, 422) and attempt < MAX_WRITE_ATTEMPTS:
            log(f"conflit d'écriture (HTTP {status}) : quelqu'un a écrit entre-temps, nouvel essai {attempt + 1}")
            time.sleep(2)
            continue
        hint = {401: "jeton refusé", 403: "le jeton n'a pas « Contents : lecture et écriture » sur le dépôt", 404: "fichier/branche introuvable"}.get(status, "")
        return fail(f"écriture GitHub refusée (HTTP {status}) {hint}".strip(), details=body[:200].decode("utf-8", "replace"))
    return fail("trop de conflits d'écriture")


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as err:  # noqa: BLE001 : le code de sortie + la ligne JSON suffisent à HA
        sys.exit(fail(f"{type(err).__name__}: {err}"))
