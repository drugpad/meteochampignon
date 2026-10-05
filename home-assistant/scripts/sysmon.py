#!/usr/bin/env python3
"""Mesures de charge de la machine qui fait tourner Home Assistant (CPU, mémoire, charge).

Utilisé par les capteurs « command_line » du paquet meteochampignon.yaml, pour voir
si les traitements (cartes de pluie, collecte des stations) pèsent sur Home Assistant.
Bibliothèque standard seulement, lecture de /proc : aucune dépendance, rien d'écrit.

    sysmon.py cpu    -> utilisation du processeur en % (mesurée sur 2 s)
    sysmon.py ram    -> mémoire utilisée en % (hors cache : « disponible » déduite)
    sysmon.py load   -> charge moyenne sur 1 min
"""
import sys
import time


def _cpu_times():
    with open("/proc/stat") as f:
        v = [int(x) for x in f.readline().split()[1:9]]
    return v[3] + v[4], sum(v)  # idle + iowait, total


def cpu():
    i1, t1 = _cpu_times()
    time.sleep(2)
    i2, t2 = _cpu_times()
    total = t2 - t1
    print(round(100.0 * (1 - (i2 - i1) / total), 1) if total > 0 else 0.0)


def ram():
    m = {}
    with open("/proc/meminfo") as f:
        for line in f:
            k, _, rest = line.partition(":")
            m[k] = int(rest.split()[0])
    total = m["MemTotal"]
    avail = m["MemAvailable"] if "MemAvailable" in m else m.get("MemFree", 0) + m.get("Buffers", 0) + m.get("Cached", 0)
    print(round(100.0 * (total - avail) / total, 1))


def load():
    with open("/proc/loadavg") as f:
        print(f.read().split()[0])


if __name__ == "__main__":
    {"cpu": cpu, "ram": ram, "load": load}.get(sys.argv[1] if len(sys.argv) > 1 else "", cpu)()
