import json,urllib.request,urllib.parse,time
def get(url):
    for k in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'meteochampignon-study'}),timeout=90) as r: return json.load(r)
        except Exception as e:
            time.sleep(2*(k+1)); err=e
    raise err
recs=[]
for month in range(1,13):
    off=0;n=0
    while off<4500:
        q={'kingdomKey':5,'decimalLatitude':'42.6,45.15','decimalLongitude':'-0.4,3.4','hasCoordinate':'true','hasGeospatialIssue':'false','limit':300,'offset':off,'occurrenceStatus':'PRESENT','year':'1995,2026','month':month,'basisOfRecord':'HUMAN_OBSERVATION'}
        d=get('https://api.gbif.org/v1/occurrence/search?'+urllib.parse.urlencode(q))
        for r in d['results']:
            recs.append({k:r.get(k) for k in ('decimalLatitude','decimalLongitude','coordinateUncertaintyInMeters','year','month')})
        n+=len(d['results']);off+=300
        if d['endOfRecords']: break
    print('mois',month,n,'(total dispo',d.get('count'),')',flush=True)
json.dump(recs,open('bg.json','w'))
print(len(recs))
