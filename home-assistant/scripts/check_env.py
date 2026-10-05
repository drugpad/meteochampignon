#!/usr/bin/env python3
"""Diagnostic : Home Assistant peut-il générer les cartes de pluie lui-même ?

Lancé par le script Home Assistant « Météochampignon - diagnostic », qui affiche
le résultat dans une notification. Ne modifie RIEN, n'installe RIEN : il se
contente de regarder ce qui est disponible.

Les cartes (scripts/build-rain-maps.py) ont besoin de :
  - Python 3.10+ et des paquets numpy, scipy, pillow, s3fs, fsspec, omfiles ;
  - ~600 Mo de mémoire libre pendant ~3 min, une fois par heure ;
  - l'accès réseau à AWS S3 (données des modèles) et à GitHub (publication).
"""
import importlib
import os
import platform
import shutil
import socket
import sys

lines = []


def add(ok, label, detail=""):
    lines.append(f"{'OK ' if ok else 'NON'} {label}{(' : ' + detail) if detail else ''}")


add(sys.version_info >= (3, 10), "Python 3.10+", platform.python_version() + " / " + platform.machine() + " / " + platform.libc_ver()[0] or "musl?")

for name in ["numpy", "scipy", "PIL", "s3fs", "fsspec", "omfiles"]:
    try:
        mod = importlib.import_module(name)
        add(True, f"module {name}", getattr(mod, "__version__", ""))
    except Exception as err:  # noqa: BLE001
        add(False, f"module {name}", f"absent ({type(err).__name__})")

pip_ok = shutil.which("pip") or shutil.which("pip3")
try:
    import pip  # noqa: F401
    pip_ok = True
except Exception:  # noqa: BLE001
    pass
add(bool(pip_ok), "pip disponible", "oui" if pip_ok else "non (installer des paquets sera compliqué)")

try:
    meminfo = {l.split(":")[0]: int(l.split()[1]) for l in open("/proc/meminfo")}
    avail = meminfo.get("MemAvailable", 0) // 1024
    add(avail >= 800, "mémoire disponible", f"{avail} Mo (il en faut ~600 Mo)")
    add(True, "mémoire totale", f"{meminfo.get('MemTotal', 0) // 1024} Mo")
except Exception as err:  # noqa: BLE001
    add(False, "mémoire", str(err))

add(True, "processeurs", str(os.cpu_count()))
try:
    free = shutil.disk_usage("/config").free // (1024 * 1024)
    add(free >= 500, "espace libre sur /config", f"{free} Mo")
except Exception as err:  # noqa: BLE001
    add(False, "espace disque", str(err))

for host in ["openmeteo.s3.amazonaws.com", "api.github.com", "public-api.meteofrance.fr"]:
    try:
        socket.create_connection((host, 443), timeout=8).close()
        add(True, f"réseau vers {host}")
    except Exception as err:  # noqa: BLE001
        add(False, f"réseau vers {host}", str(err))

missing = [l for l in lines if l.startswith("NON") and "module" in l]
lines.append("")
lines.append(
    "CONCLUSION : les cartes peuvent tourner ici telles quelles."
    if not [l for l in lines if l.startswith("NON")]
    else "CONCLUSION : il manque des éléments (lignes NON ci-dessus). Les STATIONS fonctionnent quand même "
    "(Python standard seulement) ; les cartes restent sur GitHub, avec Home Assistant comme déclencheur."
)
print("\n".join(lines))
