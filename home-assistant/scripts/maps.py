#!/usr/bin/env python3
"""Génère et publie les cartes de pluie DEPUIS Home Assistant.

Même générateur que GitHub Actions (scripts/build-rain-maps.py, copié ici sous le
nom build_rain_maps.py par install.ps1), mais calculé chez vous : les cartes
n'attendent plus un runner GitHub (incident du 05/10/2026 : « The job was not
acquired by Runner »). GitHub reste en SECOURS : le workflow maps.yml continue de
tourner si Home Assistant ne produit plus rien depuis plus de 75 min.

Modes :
  --launch        lance le calcul EN ARRIÈRE-PLAN (processus détaché, priorité basse)
                  et rend la main tout de suite. C'est ce que Home Assistant appelle :
                  sa commande shell est interrompue au bout de 60 s, le calcul dure
                  3 à 5 min.
  --run           fait le travail ici, maintenant (appelé par --launch).
  --force         ignore le garde-fou d'âge (cartes déjà récentes).
  --publish-only DOSSIER   (tests) publie un dossier déjà généré, sans calculer.

Déroulé de --run :
  1. verrou (jamais deux calculs en parallèle) ;
  2. garde-fou : si les cartes publiées ont moins de 50 min, on s'arrête ;
  3. génération dans <dossier>/maps-out (lecture partielle des fichiers de modèles
     d'Open-Meteo sur AWS S3 : aucun appel d'API, aucun quota) ;
  4. publication sur la branche `data` par l'API Git de GitHub : un seul commit sans
     parent (aucun historique), branche mise à jour en force — comme le fait le
     workflow GitHub ;
  5. résultat dans maps-status.json (lu par le tableau de bord si besoin).

Dépendances (s3fs, fsspec, omfiles…) : installées par install_deps.py dans
<dossier>/pydeps, SANS toucher au Python de Home Assistant.
"""
import base64
import calendar
import json
import os
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "pydeps"))  # paquets installés à part (voir install_deps.py)
sys.path.insert(0, HERE)

import stations as common  # noqa: E402  (read_secret, http, gh_headers : mêmes jetons et mêmes règles)

REPO = common.REPO
BRANCH = "data"
GITHUB_API = common.GITHUB_API
OUT_DIR = os.path.join(HERE, "maps-out")
STATUS = os.path.join(HERE, "maps-status.json")
LOCK = os.path.join(HERE, "maps.lock")
LOG = os.path.join(HERE, "maps.log")
MAPS_URL = os.environ.get("MAPS_JSON_URL", f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/maps.json")
FRESH_SECONDS = 50 * 60       # même garde-fou que .github/workflows/maps.yml
LOCK_STALE_SECONDS = 25 * 60  # un calcul dure 3 à 5 min : un verrou plus vieux est orphelin
FORCE = "--force" in sys.argv


def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def write_status(**fields):
    fields["fin"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    with open(STATUS, "w", encoding="utf-8") as fh:
        json.dump(fields, fh, ensure_ascii=False)


# --------------------------------------------------------------------------
def launch():
    """Lance --run en arrière-plan et rend la main immédiatement."""
    args = [sys.executable, os.path.abspath(__file__), "--run"] + (["--force"] if FORCE else [])
    env = dict(os.environ, MAPS_THREADS=os.environ.get("MAPS_THREADS", "3"), GENERATED_BY="home-assistant", OUT_DIR=OUT_DIR)
    logfile = open(LOG, "a", encoding="utf-8")
    kwargs = {"start_new_session": True} if os.name == "posix" else {}
    if os.name == "posix":
        kwargs["preexec_fn"] = lambda: os.nice(10)  # priorité basse : Home Assistant reste réactif
    subprocess.Popen(args, stdout=logfile, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, env=env, cwd=HERE, **kwargs)
    print(json.dumps({"ok": True, "lance": True, "journal": LOG}, ensure_ascii=False))
    return 0


def lock_holder_alive():
    """Le processus qui a posé le verrou tourne-t-il encore ? None si on ne peut pas le savoir.

    Un redémarrage de Home Assistant tue le calcul en cours et laisse le verrou : sans cette
    vérification, il bloquerait les tentatives suivantes pendant 25 min.
    """
    try:
        with open(LOCK) as f:
            pid = int(f.read().strip())
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            cmd = f.read()
    except FileNotFoundError:
        return False  # processus disparu (ou pid inexistant)
    except (OSError, ValueError):
        return None
    return b"maps.py" in cmd


def take_lock():
    try:
        fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        alive = lock_holder_alive()
        age = time.time() - os.path.getmtime(LOCK)
        if alive or (alive is None and age < LOCK_STALE_SECONDS):
            return False
        log("verrou orphelin (calcul interrompu, probablement par un redémarrage) : supprimé")
        os.remove(LOCK)
        fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    os.write(fd, str(os.getpid()).encode())
    os.close(fd)
    return True


def published_age_seconds():
    """Âge des cartes actuellement publiées, ou None si illisible."""
    try:
        with urllib.request.urlopen(MAPS_URL, timeout=30) as res:
            fetched = json.loads(res.read())["fetchedAt"]
        t = calendar.timegm(time.strptime(fetched, "%Y-%m-%dT%H:%M:%SZ"))  # UTC, indépendant du fuseau
        return max(0, time.time() - t)
    except Exception as err:  # noqa: BLE001
        log(f"âge des cartes illisible ({err}) : on génère")
        return None


# --------------------------------------------------------------------------
def api(auth, method, path, payload=None, timeout=120):
    data = None if payload is None else json.dumps(payload).encode()
    headers = {**common.gh_headers(auth), "Content-Type": "application/json"}
    status, body = common.http(f"{GITHUB_API}/repos/{REPO}{path}", headers, data=data, method=method, timeout=timeout)
    return status, (json.loads(body) if body else {})


def publish(folder, auth):
    """Un commit sans parent contenant les fichiers du dossier, branche `data` mise à jour en force."""
    names = sorted(n for n in os.listdir(folder) if os.path.isfile(os.path.join(folder, n)))
    if "maps.json" not in names:
        raise RuntimeError("maps.json absent du dossier généré")
    tree = []
    for name in names:
        with open(os.path.join(folder, name), "rb") as fh:
            content = base64.b64encode(fh.read()).decode()
        status, blob = api(auth, "POST", "/git/blobs", {"content": content, "encoding": "base64"})
        if status != 201:
            raise RuntimeError(f"blob {name} refusé (HTTP {status}) : {blob.get('message', '')}")
        tree.append({"path": name, "mode": "100644", "type": "blob", "sha": blob["sha"]})
    status, tr = api(auth, "POST", "/git/trees", {"tree": tree})
    if status != 201:
        raise RuntimeError(f"arbre refusé (HTTP {status}) : {tr.get('message', '')}")
    stamp = time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime())
    status, commit = api(auth, "POST", "/git/commits", {"message": f"Cartes de pluie {stamp} (Home Assistant)", "tree": tr["sha"], "parents": []})
    if status != 201:
        raise RuntimeError(f"commit refusé (HTTP {status}) : {commit.get('message', '')}")
    status, ref = api(auth, "PATCH", f"/git/refs/heads/{BRANCH}", {"sha": commit["sha"], "force": True})
    if status == 422 or status == 404:  # la branche n'existe pas encore
        status, ref = api(auth, "POST", "/git/refs", {"ref": f"refs/heads/{BRANCH}", "sha": commit["sha"]})
        if status != 201:
            raise RuntimeError(f"création de la branche refusée (HTTP {status}) : {ref.get('message', '')}")
    elif status != 200:
        hint = " (le jeton n'a pas « Contents : Read and write »)" if status in (403, 404) else ""
        raise RuntimeError(f"mise à jour de la branche refusée (HTTP {status}){hint} : {ref.get('message', '')}")
    return {"fichiers": len(names), "commit": commit["sha"][:7]}


def generate():
    """Appelle le générateur (même code que GitHub Actions)."""
    import build_rain_maps  # copié sous ce nom par install.ps1  # noqa: PLC0415

    build_rain_maps.OUT_DIR = OUT_DIR
    if os.path.isdir(OUT_DIR):
        for n in os.listdir(OUT_DIR):
            os.remove(os.path.join(OUT_DIR, n))
    build_rain_maps.main()


def run():
    started = time.time()
    if not take_lock():
        log("un calcul est déjà en cours : rien à faire")
        return 0
    try:
        if "--publish-only" in sys.argv:
            folder = sys.argv[sys.argv.index("--publish-only") + 1]
        else:
            age = None if FORCE else published_age_seconds()
            if age is not None and age < FRESH_SECONDS:
                log(f"cartes récentes ({age / 60:.0f} min) : rien à faire")
                write_status(ok=True, action="ignoré (cartes récentes)", age_min=round(age / 60))
                return 0
            log("génération des cartes…")
            generate()
            folder = OUT_DIR
        auth = common.read_secret("github_dispatch_auth")
        result = publish(folder, auth)
        log(f"publié : {result}")
        write_status(ok=True, action="publié", duree_s=round(time.time() - started), **result)
        return 0
    except BaseException as err:  # noqa: BLE001 : on veut TOUT journaliser, même un SystemExit
        log(f"ÉCHEC : {type(err).__name__}: {err}")
        write_status(ok=False, erreur=f"{type(err).__name__}: {err}", duree_s=round(time.time() - started))
        return 1
    finally:
        try:
            os.remove(LOCK)
        except OSError:
            pass


if __name__ == "__main__":
    if "--launch" in sys.argv:
        sys.exit(launch())
    sys.exit(run())
