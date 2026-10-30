"""Fond « champignons du sol à chapeau » (Agaricales, Boletales, Russulales, Cantharellales, Gomphales, Thelephorales) :
même biais d'observateur que les espèces étudiées, SANS les lichens (rochers, murs, troncs) du fond précédent."""
import json, os, time, urllib.parse, urllib.request
HERE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".cache-habitat", "gbif")
ORDERS = [1499, 1063, 1144, 1300, 1303, 530]
BOX = {'decimalLatitude': '42.3,46.5', 'decimalLongitude': '-2,4.5'}
FIELDS = ('key','decimalLatitude','decimalLongitude','coordinateUncertaintyInMeters','year','month','day','basisOfRecord','datasetKey','orderKey','familyKey','speciesKey','scientificName')
def get(url):
    err = None
    for k in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'meteochampignon-study'}), timeout=120) as r:
                return json.load(r)
        except Exception as e:
            err = e; time.sleep(3 * (k + 1))
    raise err
bg = []
for yr in ['1995,2012', '2013,2017', '2018,2020', '2021,2022', '2023,2024', '2025,2026']:
    for month in range(1, 13):
        off, n = 0, None
        while True:
            q = dict(BOX, hasCoordinate='true', hasGeospatialIssue='false', occurrenceStatus='PRESENT', year=yr, month=month, limit=300, offset=off)
            url = 'https://api.gbif.org/v1/occurrence/search?' + urllib.parse.urlencode(q) + ''.join(f'&taxonKey={o}' for o in ORDERS)
            d = get(url)
            bg += [{k: r.get(k) for k in FIELDS} for r in d['results']]
            n = d.get('count'); off += 300
            if d['endOfRecords'] or off >= 9900: break
        print('fond', yr, month, min(off, n), '/', n, flush=True)
json.dump(bg, open(os.path.join(HERE, 'bg2.json'), 'w'))
print('total', len(bg))
