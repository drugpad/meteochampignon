"""Observations GBIF des 7 espèces (large Sud-Ouest, avec dates) + fond « tous champignons » (même zone).
Zone large (lat 42,3-46,5 ; lon -2-4,5) : la validation de la météo n'a besoin que du point et de la date ;
la validation du milieu filtre ensuite sur l'emprise Midi-Pyrénées. Sortie : sp.json, bg.json (ce dossier)."""
import json, os, time, urllib.parse, urllib.request

HERE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".cache-habitat", "gbif")
SP = {'cepe_ete': 'Boletus reticulatus', 'cepe_bronze': 'Boletus aereus', 'cepe_bordeaux': 'Boletus edulis',
      'cepe_pins': 'Boletus pinophilus', 'girolle': 'Cantharellus cibarius', 'coulemelle': 'Macrolepiota procera',
      'trompette': 'Craterellus cornucopioides'}
BOX = {'decimalLatitude': '42.3,46.5', 'decimalLongitude': '-2,4.5'}
FIELDS = ('key', 'decimalLatitude', 'decimalLongitude', 'coordinateUncertaintyInMeters', 'year', 'month', 'day',
          'eventDate', 'basisOfRecord', 'datasetKey', 'scientificName', 'taxonKey', 'speciesKey', 'license', 'countryCode')


def get(url):
    err = None
    for k in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'meteochampignon-study'}), timeout=120) as r:
                return json.load(r)
        except Exception as e:
            err = e
            time.sleep(3 * (k + 1))
    raise err


def search(q, cap):
    recs, off = [], 0
    while off < cap:
        d = get('https://api.gbif.org/v1/occurrence/search?' + urllib.parse.urlencode(dict(q, limit=300, offset=off)))
        recs += [{k: r.get(k) for k in FIELDS} for r in d['results']]
        off += 300
        if d['endOfRecords']:
            break
    return recs, d.get('count')


out = {}
for key, name in SP.items():
    m = get('https://api.gbif.org/v1/species/match?' + urllib.parse.urlencode({'name': name, 'kingdom': 'Fungi'}))
    tk = m.get('usageKey')
    recs, n = search(dict(BOX, taxonKey=tk, hasCoordinate='true', hasGeospatialIssue='false', occurrenceStatus='PRESENT'), 30000)
    out[key] = {'taxonKey': tk, 'matched': m.get('scientificName'), 'recs': recs}
    print(key, m.get('scientificName'), tk, len(recs), '/', n, flush=True)
json.dump(out, open(os.path.join(HERE, 'sp.json'), 'w'))

bg = []
for year_rng in ['1995,2014', '2015,2019', '2020,2022', '2023,2026']:
    for month in range(1, 13):
        recs, n = search(dict(BOX, kingdomKey=5, hasCoordinate='true', hasGeospatialIssue='false', occurrenceStatus='PRESENT',
                              year=year_rng, month=month, basisOfRecord='HUMAN_OBSERVATION'), 6000)
        bg += recs
        print('fond', year_rng, month, len(recs), '/', n, flush=True)
json.dump(bg, open(os.path.join(HERE, 'bg.json'), 'w'))
print('fond total', len(bg))
