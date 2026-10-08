#!/usr/bin/env python3
"""Collecte les cumuls de pluie 3 jours des stations Netatmo publiques de Midi-Pyrénées.

Netatmo n'expose PAS d'historique pour les stations qu'on ne possède pas : `getpublicdata` ne donne que la
pluie de la dernière heure (`rain_60min`). On l'accumule donc nous-mêmes, une fois par heure, pour reconstituer
un cumul 3 jours (il se remplit en ~3 jours). getpublicdata plafonne à ~700 stations par appel : on découpe la
région en quadrants, en subdivisant seulement là où c'est dense (quadtree adaptatif, ~85 appels, ~2 min).

État local (sur Home Assistant, pas dans le dépôt) :
  netatmo-history.json : {stations: {id: {lat, lon, h: {heureISO: mm}}}}, fenêtre 72 h.
  netatmo-token.txt    : dernier refresh token (si Netatmo le fait tourner).
Publié sur GitHub (lu par l'appli, comme Infoclimat) :
  public/netatmo-stations.json : {generatedAt, stations: [{id, lat, lon, mm, hours}]}.

Secrets (secrets.yaml) : meteochampignon_netatmo_client_id / _client_secret / _refresh_token, github_dispatch_auth.
Options : --launch (détaché, défaut via HA), --run (travail ici), --check (diagnostic).
"""
import base64
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

REPO = "drugpad/meteochampignon"
BRANCH = "master"
OUTPUT_PATH = "public/netatmo-stations.json"
SECRETS_FILE = os.environ.get("HA_SECRETS", "/config/secrets.yaml")
GITHUB_API = os.environ.get("GITHUB_API_BASE", "https://api.github.com")
HERE = os.path.dirname(os.path.abspath(__file__))
HISTORY = os.path.join(HERE, "netatmo-history.json")
TOKEN_FILE = os.path.join(HERE, "netatmo-token.txt")
LOCK = os.path.join(HERE, "netatmo.lock")
LOG = os.path.join(HERE, "netatmo.log")
STATUS = os.path.join(HERE, "netatmo-status.json")

LAT_MIN, LAT_MAX, LON_MIN, LON_MAX = 42.6, 45.15, -0.4, 3.4
KEEP_HOURS = 72
CAP = 380           # on subdivise un quadrant au-delà (plafond réel ~700, marge)
MAX_DEPTH = 5
PAUSE = 0.25
LOCK_STALE_SECONDS = 20 * 60
CHECK = "--check" in sys.argv


def log(msg):
    line = time.strftime("%H:%M:%S") + " " + msg
    print(line, flush=True)
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def fail(message, **extra):
    print(json.dumps({"ok": False, "erreur": message, **extra}, ensure_ascii=False))
    return 1


def read_secret(name):
    try:
        text = open(SECRETS_FILE, encoding="utf-8").read()
    except OSError as err:
        raise SystemExit(fail(f"secrets.yaml illisible ({err})"))
    m = re.search(rf'^\s*{re.escape(name)}\s*:\s*["\']?(.*?)["\']?\s*$', text, re.M)
    if not m or not m.group(1):
        raise SystemExit(fail(f"clé '{name}' absente de secrets.yaml"))
    return m.group(1)


def http(url, headers=None, data=None, method=None, timeout=60):
    req = urllib.request.Request(url, headers=headers or {}, data=data, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as err:
        return err.code, err.read()


def gh_headers(auth):
    return {
        "Authorization": auth,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "home-assistant-meteochampignon",
    }


# --------------------------------------------------------------------------
def access_token():
    """Jeton d'accès Netatmo via le refresh token (fichier local prioritaire : Netatmo peut le faire tourner)."""
    cid = read_secret("meteochampignon_netatmo_client_id")
    csec = read_secret("meteochampignon_netatmo_client_secret")
    rt = None
    if os.path.exists(TOKEN_FILE):
        rt = open(TOKEN_FILE, encoding="utf-8").read().strip() or None
    rt = rt or read_secret("meteochampignon_netatmo_refresh_token")
    data = urllib.parse.urlencode(
        {"grant_type": "refresh_token", "refresh_token": rt, "client_id": cid, "client_secret": csec}
    ).encode()
    status, body = http("https://api.netatmo.com/oauth2/token", data=data, method="POST", timeout=30)
    if status != 200:
        raise RuntimeError(f"Netatmo OAuth refusé (HTTP {status}) : {body[:200].decode('utf-8', 'replace')}")
    tok = json.loads(body)
    new_rt = tok.get("refresh_token")
    if new_rt and new_rt != rt:
        try:
            open(TOKEN_FILE, "w", encoding="utf-8").write(new_rt)
        except OSError:
            pass
    return tok["access_token"]


def getpublicdata(token, s, w, n, e):
    q = urllib.parse.urlencode({"lat_ne": n, "lon_ne": e, "lat_sw": s, "lon_sw": w, "filter": "false"})
    for attempt in range(3):
        status, body = http("https://api.netatmo.com/api/getpublicdata?" + q, {"Authorization": "Bearer " + token}, timeout=40)
        if status == 200:
            return json.loads(body).get("body", [])
        if status == 429:
            time.sleep(3 * (attempt + 1))
            continue
        return []
    return []


def collect(token):
    """Quadtree adaptatif : {id: {lat, lon, rain}} des stations publiques ayant un pluviomètre."""
    found, calls = {}, [0]

    def rain_of(station):
        for m in (station.get("measures") or {}).values():
            if isinstance(m, dict) and "rain_60min" in m:
                return m["rain_60min"]
        return None

    def recurse(s, w, n, e, depth):
        calls[0] += 1
        body = getpublicdata(token, s, w, n, e)
        if len(body) >= CAP and depth < MAX_DEPTH:
            mla, mlo = (s + n) / 2, (w + e) / 2
            recurse(s, w, mla, mlo, depth + 1)
            recurse(s, mlo, mla, e, depth + 1)
            recurse(mla, w, n, mlo, depth + 1)
            recurse(mla, mlo, n, e, depth + 1)
            return
        for st in body:
            sid = st.get("_id")
            loc = (st.get("place") or {}).get("location")
            r = rain_of(st)
            if sid and loc and r is not None:
                found[sid] = {"lat": round(loc[1], 5), "lon": round(loc[0], 5), "rain": max(0.0, float(r))}
        time.sleep(PAUSE)

    recurse(LAT_MIN, LON_MIN, LAT_MAX, LON_MAX, 0)
    log(f"{calls[0]} appels, {len(found)} stations avec pluviomètre")
    return found


def accumulate(found, now):
    """Ajoute la mesure horaire courante à l'historique local (une valeur par heure, fenêtre 72 h)."""
    try:
        hist = json.load(open(HISTORY, encoding="utf-8"))
    except (OSError, ValueError):
        hist = {"stations": {}}
    stations = hist.setdefault("stations", {})
    hour = now.strftime("%Y-%m-%dT%H:00:00Z")
    cutoff = (now - timedelta(hours=KEEP_HOURS)).strftime("%Y-%m-%dT%H:00:00Z")
    for sid, s in found.items():
        st = stations.get(sid) or {"h": {}}
        st["lat"], st["lon"] = s["lat"], s["lon"]
        st.setdefault("h", {})[hour] = round(s["rain"], 1)
        stations[sid] = st
    # Élagage : heures trop vieilles, stations sans aucune heure récente.
    for sid in list(stations):
        hrs = {k: v for k, v in stations[sid].get("h", {}).items() if k > cutoff}
        if hrs:
            stations[sid]["h"] = hrs
        else:
            del stations[sid]
    try:
        json.dump(hist, open(HISTORY, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    except OSError as err:
        log(f"écriture historique local échouée: {err}")
    return hist


def totals(hist, now):
    out = []
    for sid, s in hist.get("stations", {}).items():
        hrs = s.get("h", {})
        mm = round(sum(hrs.values()), 1)
        out.append({"id": sid, "lat": s["lat"], "lon": s["lon"], "mm": mm, "hours": len(hrs)})
    out.sort(key=lambda x: x["id"])
    return {"generatedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "stations": out}


def publish(payload, auth):
    url = f"{GITHUB_API}/repos/{REPO}/contents/{OUTPUT_PATH}"
    content = base64.b64encode(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()).decode()
    for attempt in range(3):
        status, meta = http(f"{url}?ref={BRANCH}", gh_headers(auth))
        sha = json.loads(meta)["sha"] if status == 200 else None
        body = {"message": "Cumuls Netatmo (Home Assistant)", "content": content, "branch": BRANCH}
        if sha:
            body["sha"] = sha
        st, resp = http(url, {**gh_headers(auth), "Content-Type": "application/json"}, data=json.dumps(body).encode(), method="PUT", timeout=60)
        if st in (200, 201):
            return
        if st in (409, 422) and attempt < 2:
            time.sleep(2)
            continue
        hint = " (jeton sans « Contents : lecture et écriture » ?)" if st in (403, 404) else ""
        raise RuntimeError(f"écriture GitHub refusée (HTTP {st}){hint}")


# --------------------------------------------------------------------------
def take_lock():
    try:
        fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        if time.time() - os.path.getmtime(LOCK) < LOCK_STALE_SECONDS:
            return False
        os.remove(LOCK)
        fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    os.write(fd, str(os.getpid()).encode())
    os.close(fd)
    return True


def launch():
    """Lance --run en arrière-plan (une commande shell de HA est coupée à 60 s ; la collecte dure ~2 min)."""
    args = [sys.executable, os.path.abspath(__file__), "--run"]
    kwargs = {"start_new_session": True} if os.name == "posix" else {}
    if os.name == "posix":
        kwargs["preexec_fn"] = lambda: os.nice(10)
    logfile = open(LOG, "a", encoding="utf-8")
    subprocess.Popen(args, stdout=logfile, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, cwd=HERE, **kwargs)
    print(json.dumps({"ok": True, "lance": True, "journal": LOG}, ensure_ascii=False))
    return 0


def run():
    if not take_lock():
        log("une collecte est déjà en cours : rien à faire")
        return 0
    started = time.time()
    try:
        now = datetime.now(timezone.utc)
        found = collect(access_token())
        if not found:
            raise RuntimeError("aucune station reçue (OAuth ou réseau)")
        hist = accumulate(found, now)
        payload = totals(hist, now)
        publish(payload, read_secret("github_dispatch_auth"))
        res = {"ok": True, "stations": len(payload["stations"]), "duree_s": round(time.time() - started)}
        log(f"publié : {res}")
        json.dump(res, open(STATUS, "w", encoding="utf-8"), ensure_ascii=False)
        return 0
    except BaseException as err:  # noqa: BLE001
        log(f"ÉCHEC : {type(err).__name__}: {err}")
        json.dump({"ok": False, "erreur": f"{type(err).__name__}: {err}"}, open(STATUS, "w", encoding="utf-8"), ensure_ascii=False)
        return 1
    finally:
        try:
            os.remove(LOCK)
        except OSError:
            pass


def check():
    report = {"ok": True}
    try:
        token = access_token()
        report["oauth"] = "OK"
        body = getpublicdata(token, 43.4, 1.1, 43.8, 1.7)  # petite zone Toulouse
        rain = sum(1 for s in body for m in (s.get("measures") or {}).values() if isinstance(m, dict) and "rain_60min" in m)
        report["getpublicdata"] = f"OK ({len(body)} stations, {rain} avec pluie)"
        report["ok"] = len(body) > 0
    except Exception as err:  # noqa: BLE001
        report["erreur"] = str(err)
        report["ok"] = False
    print(json.dumps(report, ensure_ascii=False, indent=1))
    return 0 if report["ok"] else 1


def main():
    if CHECK:
        return check()
    if "--run" in sys.argv:
        return run()
    return launch()


if __name__ == "__main__":
    sys.exit(main())
