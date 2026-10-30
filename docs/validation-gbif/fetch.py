import json,urllib.request,urllib.parse,time,sys
SP={'cepe_ete':'Boletus reticulatus','cepe_bronze':'Boletus aereus','cepe_bordeaux':'Boletus edulis','cepe_pins':'Boletus pinophilus','girolle':'Cantharellus cibarius','coulemelle':'Macrolepiota procera','trompette':'Craterellus cornucopioides'}
def get(url):
    for k in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'meteochampignon-study'}),timeout=60) as r: return json.load(r)
        except Exception as e:
            time.sleep(2*(k+1)); err=e
    raise err
out={}
for key,name in SP.items():
    m=get('https://api.gbif.org/v1/species/match?'+urllib.parse.urlencode({'name':name,'kingdom':'Fungi'}))
    tk=m.get('usageKey'); print(key,name,'->',m.get('scientificName'),tk,m.get('matchType'),m.get('status'),flush=True)
    recs=[];off=0
    while True:
        q={'taxonKey':tk,'decimalLatitude':'42.6,45.15','decimalLongitude':'-0.4,3.4','hasCoordinate':'true','hasGeospatialIssue':'false','limit':300,'offset':off,'occurrenceStatus':'PRESENT'}
        d=get('https://api.gbif.org/v1/occurrence/search?'+urllib.parse.urlencode(q))
        for r in d['results']:
            recs.append({k:r.get(k) for k in ('decimalLatitude','decimalLongitude','coordinateUncertaintyInMeters','year','month','day','elevation','basisOfRecord','datasetName','publishingOrgKey','identificationVerificationStatus','taxonRank','scientificName','collectionCode','institutionCode','license')})
        off+=300
        if d['endOfRecords'] or off>=20000: break
    out[key]={'taxonKey':tk,'matched':m.get('scientificName'),'n':len(recs),'recs':recs}
    print('  records',len(recs),flush=True)
json.dump(out,open('gbif.json','w'))
