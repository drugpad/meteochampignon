"""Ajoute des espèces à .cache-habitat/gbif/sp.json (mêmes champs et même zone que gbif_fetch_all.py).
Une espèce de la carte peut regrouper plusieurs taxons (pied de mouton = Hydnum repandum + H. rufescens, cueillis
ensemble sous ce nom). Usage : python gbif_fetch_add.py"""
import json
import os
import time
import urllib.parse
import urllib.request

HERE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".cache-habitat", "gbif")
BOX = {"decimalLatitude": "42.3,46.5", "decimalLongitude": "-2,4.5"}
FIELDS = ("key", "decimalLatitude", "decimalLongitude", "coordinateUncertaintyInMeters", "year", "month", "day",
          "eventDate", "basisOfRecord", "datasetKey", "scientificName", "taxonKey", "speciesKey", "license", "countryCode")
ADD = {
    "pied_mouton": ["Hydnum repandum", "Hydnum rufescens"],
    "chanterelle_tube": ["Craterellus tubaeformis"],
}


def get(url):
    err = None
    for k in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "meteochampignon-study"}), timeout=120) as r:
                return json.load(r)
        except Exception as e:
            err = e
            time.sleep(3 * (k + 1))
    raise err


def search(q):
    recs, off = [], 0
    while True:
        d = get("https://api.gbif.org/v1/occurrence/search?" + urllib.parse.urlencode(dict(q, limit=300, offset=off)))
        recs += [{k: r.get(k) for k in FIELDS} for r in d["results"]]
        off += 300
        if d["endOfRecords"] or off >= 30000:
            return recs


path = os.path.join(HERE, "sp.json")
sp = json.load(open(path))
for key, names in ADD.items():
    recs, keys = [], []
    for name in names:
        tk = get("https://api.gbif.org/v1/species/match?" + urllib.parse.urlencode({"name": name, "kingdom": "Fungi"})).get("usageKey")
        r = search(dict(BOX, taxonKey=tk, hasCoordinate="true", hasGeospatialIssue="false", occurrenceStatus="PRESENT"))
        recs += r
        keys.append(tk)
        print(key, name, tk, len(r), flush=True)
    sp[key] = {"taxonKey": keys, "matched": " + ".join(names), "recs": recs}
json.dump(sp, open(path, "w"))
print("sp.json :", list(sp))
