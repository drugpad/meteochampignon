import json,numpy as np
from PIL import Image
import os; root=os.environ.get('HABITAT_DIR','public/habitat/')
groups=json.load(open(root+'habitat.json'))['groups']
info=np.array(Image.open(root+'info.png').convert('RGB'));H,W=info.shape[:2]
b=dict(latMin=42.595,latMax=45.155,lonMin=-0.405,lonMax=3.405)
def rc(la,lo):
    r=((b['latMax']-la)/(b['latMax']-b['latMin'])*H).astype(int);c=((lo-b['lonMin'])/(b['lonMax']-b['lonMin'])*W).astype(int)
    return np.clip(r,0,H-1),np.clip(c,0,W-1)
G=info[...,0];ALT=info[...,2].astype(int)*10
tree=[i for i,g in enumerate(groups) if g not in('aucun','herbe','lande')];forest=np.isin(G,tree)
bg=json.load(open('bg.json'));d=json.load(open('gbif.json'))
flt=lambda u:u is None or u<=1000
def pts(R):
    R=[r for r in R if r['year'] and r['year']>=1995 and flt(r['coordinateUncertaintyInMeters'])]
    return np.array([r['decimalLatitude'] for r in R]),np.array([r['decimalLongitude'] for r in R])
def auc(pos,neg):
    neg=np.sort(neg);lo=np.searchsorted(neg,pos,'left');hi=np.searchsorted(neg,pos,'right');return float(np.mean((lo+0.5*(hi-lo))/len(neg)))
bla,blo=pts(bg);br,bc=rc(bla,blo);bF=forest[br,bc]
rng=np.random.default_rng(7)
print('=== A. AUC toutes cases (observations vs fond champignons), et coulemelle hors forêt')
for key,v in d.items():
    hab=np.array(Image.open(root+key+'.png').convert('L'),float)/255
    la,lo=pts(v['recs']);r,c=rc(la,lo);s=hab[r,c];sb=hab[br,bc]
    line=f'{key:14s} n={len(la):3d} AUC global {auc(s,sb):.2f}'
    F=forest[r,c]
    if (~F).sum()>=15: line+=f' | hors forêt n={int((~F).sum())} AUC {auc(s[~F],sb[~bF]):.2f} (score médian {np.median(s[~F]):.2f} vs fond {np.median(sb[~bF]):.2f}, part à 0: {np.mean(s[~F]==0):.2f} vs {np.mean(sb[~bF]==0):.2f})'
    print(line)
print('\n=== B. Bordeaux : rapports par altitude et essence avec intervalles (bootstrap 2000)')
hab=np.array(Image.open(root+'cepe_bordeaux.png').convert('L'),float)/255
la,lo=pts(d['cepe_bordeaux']['recs']);r,c=rc(la,lo);F=forest[r,c]
alt_o=ALT[r,c][F];alt_b=ALT[br,bc][bF];gr=G[r,c][F];gb=G[br,bc][bF]
def ratio(a_o,a_b,lo_,hi_):
    return ((a_o>=lo_)&(a_o<hi_)).mean()/max(1e-9,((a_b>=lo_)&(a_b<hi_)).mean())
for lo_,hi_ in [(0,400),(400,600),(600,800),(800,1000),(1000,1200),(1200,1400),(1400,1600),(1600,2400)]:
    bs=[]
    for _ in range(2000):
        so=rng.choice(alt_o,len(alt_o));sb_=rng.choice(alt_b,len(alt_b))
        bs.append(ratio(so,sb_,lo_,hi_))
    print(f'  alt {lo_}-{hi_} m : rapport {ratio(alt_o,alt_b,lo_,hi_):.2f}  IC95% [{np.percentile(bs,2.5):.2f} ; {np.percentile(bs,97.5):.2f}]  (n obs {int(((alt_o>=lo_)&(alt_o<hi_)).sum())})')
for name in ('chene','hetre','sapin_epicea','mixte','feuillus'):
    i=groups.index(name);bs=[]
    for _ in range(2000):
        so=rng.choice(gr,len(gr));sb_=rng.choice(gb,len(gb));bs.append((so==i).mean()/max(1e-9,(sb_==i).mean()))
    print(f'  essence {name:13s}: rapport {((gr==i).mean()/(gb==i).mean()):.2f} IC95% [{np.percentile(bs,2.5):.2f} ; {np.percentile(bs,97.5):.2f}]')
print('\n=== C. Saisons corrigées de l\'effort d\'observation (part de chaque mois / total champignons du mois, normalisé au pic)')
tot={m:0 for m in range(1,13)}
for r_ in bg: tot[r_['month']]+=0
totals={1:3409,2:2867,3:3967,4:7771,5:6172,6:7330,7:12224,8:13887,9:24272,10:29082,11:14285,12:4990}
mine={'cepe_ete':[0,0,0,0,0.4,0.9,1,1,0.8,0.3,0.05,0],'cepe_bronze':[0,0,0,0,0.1,0.4,0.8,1,1,0.7,0.15,0],'cepe_bordeaux':[0,0,0,0,0.1,0.2,0.2,0.4,0.9,1,0.7,0.15],'cepe_pins':[0,0,0,0,0.1,0.3,0.5,0.6,1,1,0.5,0.1],'girolle':[0,0,0,0,0.3,0.8,1,1,1,0.8,0.4,0.1],'coulemelle':[0,0,0,0,0.1,0.4,0.8,1,1,0.9,0.4,0.05],'trompette':[0.2,0.05,0,0,0,0,0.3,0.6,0.9,1,1,0.5]}
for key,v in d.items():
    R=[r_ for r_ in v['recs'] if r_['year'] and r_['year']>=1995 and r_['basisOfRecord']=='HUMAN_OBSERVATION' and r_['month']]
    cnt=np.array([sum(1 for r_ in R if r_['month']==m) for m in range(1,13)],float)
    rate=cnt/np.array([totals[m] for m in range(1,13)]);rel=rate/rate.max()
    raw=cnt/cnt.max()
    print(f'{key:14s} n={int(cnt.sum())}')
    print('   mois          :',' '.join(f'{m:>4d}' for m in range(1,13)))
    print('   bruts/pic     :',' '.join(f'{x:4.2f}' for x in raw))
    print('   corrigé effort:',' '.join(f'{x:4.2f}' for x in rel))
    print('   mon modèle    :',' '.join(f'{x:4.2f}' for x in mine[key]))
