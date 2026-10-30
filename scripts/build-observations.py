"""Observations réelles des 7 espèces du mode Coins (GBIF) -> public/observations.json, pour la couche
« Observations réelles » de l'appli (on voit où l'espèce a vraiment été trouvée et notée).

Entrée : .cache-habitat/gbif/sp.json (scripts/validation/gbif_fetch_all.py). Gardées : emprise de la région, position
à 5 km près au plus (l'incertitude est affichée), une seule par espèce, lieu et jour. Chaque point garde son jeu de
données : titre et licence (CC0, CC BY, CC BY-NC) affichés dans l'appli, comme l'exigent ces licences ; usage non
commercial. Aucun nom d'observateur n'est repris.

Lancement : python scripts/build-observations.py   (à relancer après un nouveau téléchargement GBIF)
"""
import json
import os
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, ".cache-habitat", "gbif", "sp.json")
OUT = os.path.join(ROOT, "public", "observations.json")
LAT_MIN, LAT_MAX, LON_MIN, LON_MAX = 42.6, 45.15, -0.4, 3.4
MAX_UNC = 5000
LICENSES = {"by-nc": "CC BY-NC 4.0", "by": "CC BY 4.0", "zero": "CC0"}


def license_label(url):
    url = (url or "").lower()
    for key in ("by-nc", "zero", "by"):
        if f"/{key}/" in url or url.endswith(key):
            return LICENSES[key]
    return url or "?"


def main():
    sp = json.load(open(SRC))
    datasets, index, out = [], {}, {}
    for name, block in sp.items():
        seen, pts = set(), []
        for r in block["recs"]:
            lat, lon = r.get("decimalLatitude"), r.get("decimalLongitude")
            if lat is None or not (LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX):
                continue
            unc = r.get("coordinateUncertaintyInMeters")
            if unc is not None and unc > MAX_UNC:
                continue
            y, m, d = r.get("year"), r.get("month"), r.get("day")
            when = f"{y:04d}-{m:02d}-{d:02d}" if y and m and d else f"{y:04d}-{m:02d}" if y and m else str(y or "")
            key = (round(lat, 4), round(lon, 4), when)
            if key in seen:
                continue
            seen.add(key)
            ds = r.get("datasetKey")
            if ds not in index:
                index[ds] = len(datasets)
                datasets.append({"key": ds, "license": license_label(r.get("license"))})
            pts.append([round(lat, 4), round(lon, 4), when, index[ds], int(unc) if unc is not None else -1])
        pts.sort(key=lambda p: p[2])
        out[name] = pts
        print(f"{name:14s} {len(pts)} observations")
    for ds in datasets:
        try:
            with urllib.request.urlopen(f"https://api.gbif.org/v1/dataset/{ds['key']}", timeout=30) as resp:
                ds["title"] = json.load(resp).get("title", "")
        except Exception:
            ds["title"] = ""
    meta = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "GBIF.org — observations publiques ; licence de chaque jeu de données ci-dessous",
        "fields": ["lat", "lon", "date", "jeu de données (index de datasets)", "incertitude de position en m (-1 = inconnue)"],
        "datasets": datasets,
        "species": out,
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(datasets)} jeux de données, {os.path.getsize(OUT) // 1024} Ko")


if __name__ == "__main__":
    main()
