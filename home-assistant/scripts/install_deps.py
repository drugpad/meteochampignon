#!/usr/bin/env python3
"""Installe les paquets Python des cartes de pluie, À PART du Python de Home Assistant.

Tout va dans <dossier>/pydeps (option --target de pip) : rien n'est modifié dans les
paquets de Home Assistant, et le retour arrière tient en une ligne : supprimer le
dossier `pydeps`. maps.py ajoute ce dossier en tête de son chemin d'import.

Paquets (versions testées le 04/10/2026, mêmes que scripts/requirements-maps.txt) :
  omfiles, s3fs, fsspec, aiobotocore, botocore, aioitertools, jmespath, python-dateutil, six,
  wrapt, tzdata.
numpy, scipy et pillow sont DÉJÀ présents dans Home Assistant (vérifié par le
diagnostic) ; aiohttp et urllib3 aussi (HA les utilise). Les
paquets ci-dessus sont installés SANS leurs dépendances (--no-deps) pour ne
jamais remplacer une version que Home Assistant utilise.

Modes :
  --launch   lance l'installation en arrière-plan (la commande shell de HA est
             interrompue après 60 s) et rend la main tout de suite ;
  --run      installe ici, maintenant ;
  --check    n'installe rien : dit ce qui est déjà importable.
Résultat dans install-deps-status.json et install-deps.log.
"""
import importlib
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.environ.get("PYDEPS_TARGET", os.path.join(HERE, "pydeps"))
STATUS = os.path.join(HERE, "install-deps-status.json")
LOG = os.path.join(HERE, "install-deps.log")

PACKAGES = [
    "omfiles==1.2.0",
    "s3fs==2026.9.0",
    "fsspec==2026.9.0",
    "aiobotocore==3.9.2",
    "botocore==1.43.106",
    "aioitertools==0.13.0",
    "jmespath==1.1.0",
    "python-dateutil==2.9.0.post0",  # botocore en a besoin ; absent de certains Python de HA
    "six==1.17.0",                   # dépendance de python-dateutil
    "wrapt==2.5.0",
    "tzdata==2026.5",
]
MODULES = ["numpy", "scipy", "PIL", "aiohttp", "dateutil", "urllib3", "omfiles", "s3fs", "fsspec", "aiobotocore", "botocore", "jmespath", "wrapt"]


def check():
    sys.path.insert(0, TARGET)
    report = {}
    for name in MODULES:
        try:
            mod = importlib.import_module(name)
            report[name] = getattr(mod, "__version__", "ok")
        except Exception as err:  # noqa: BLE001
            report[name] = f"ABSENT ({type(err).__name__})"
    needed = ["numpy", "scipy", "PIL", "omfiles", "s3fs", "fsspec", "aiobotocore", "botocore", "dateutil"]
    ok = all(not str(report[n]).startswith("ABSENT") for n in needed)
    return ok, report


def run():
    started = time.time()
    os.makedirs(TARGET, exist_ok=True)
    cmd = [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "--no-deps", "--upgrade", "--target", TARGET, *PACKAGES]
    print("commande :", " ".join(cmd), flush=True)
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    print(proc.stdout[-4000:], flush=True)
    ok, report = check()
    status = {
        "ok": proc.returncode == 0 and ok,
        "pip_code": proc.returncode,
        "modules": report,
        "duree_s": round(time.time() - started),
        "fin": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "dossier": TARGET,
    }
    with open(STATUS, "w", encoding="utf-8") as fh:
        json.dump(status, fh, ensure_ascii=False)
    print(json.dumps(status, ensure_ascii=False), flush=True)
    return 0 if status["ok"] else 1


def launch():
    kwargs = {"start_new_session": True} if os.name == "posix" else {}
    logfile = open(LOG, "w", encoding="utf-8")
    subprocess.Popen([sys.executable, os.path.abspath(__file__), "--run"], stdout=logfile, stderr=subprocess.STDOUT,
                     stdin=subprocess.DEVNULL, cwd=HERE, **kwargs)
    print(json.dumps({"ok": True, "lance": True, "journal": LOG}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    if "--check" in sys.argv:
        ok, report = check()
        print(json.dumps({"ok": ok, "modules": report}, ensure_ascii=False, indent=1))
        sys.exit(0 if ok else 1)
    sys.exit(launch() if "--launch" in sys.argv else run())
