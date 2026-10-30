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
bins=np.arange(0,2600,200)
def fit(alt_o,g_o,alt_b,g_b,k=3.0):
    # rapport (obs/fond) lissé par pseudo-comptes : (n_obs+k*p_bg)/(...)
    wa=np.ones(len(bins)-1);wg=np.ones(len(groups))
    for j in range(len(bins)-1):
        po=((alt_o>=bins[j])&(alt_o<bins[j+1])).sum();pb=((alt_b>=bins[j])&(alt_b<bins[j+1])).mean()
        wa[j]=(po+k*pb)/(len(alt_o)*pb+k*pb+1e-9)
    common=[i for i in tree if (g_b==i).mean()>=0.02]
    for i in common:
        po=(g_o==i).sum();pb=(g_b==i).mean()
        wg[i]=(po+k*pb)/(len(g_o)*pb+k*pb+1e-9)
    m=max(wg[i] for i in common)
    for i in range(len(groups)):
        wg[i]=wg[i]/m if i in common else 1.0 if i not in tree else wg[i]
    wg=np.where([i in common for i in range(len(groups))],wg,np.minimum(wg,1.0))
    return wa/wa.max(),wg
def apply(hab,alt,g,wa,wg):
    j=np.clip(np.digitize(alt,bins)-1,0,len(wa)-1);return hab*wa[j]*wg[g]
rng=np.random.default_rng(3)
print('espèce          n_forêt  actuel | altitude seule | essences seules (>=2%) | les deux (validation croisée 5 plis x 10)')
out={}
for key,v in d.items():
    hab=np.array(Image.open(root+key+'.png').convert('L'),float)/255
    la,lo=pts(v['recs']);r,c=rc(la,lo);F=forest[r,c]
    if F.sum()<40: print(f'{key:14s} {int(F.sum()):5d}   (trop peu d\'observations en forêt)');continue
    ho=hab[r,c][F];ao=ALT[r,c][F];go=G[r,c][F];hb=hab[br,bc][bF];ab=ALT[br,bc][bF];gb=G[br,bc][bF]
    res_old=[];res_new=[];res_alt=[];res_grp=[]
    for rep in range(10):
        fo=rng.permutation(len(ho))%5;fb=rng.permutation(len(hb))%5
        for k in range(5):
            tr_o=fo!=k;te_o=fo==k;tr_b=fb!=k;te_b=fb==k
            wa,wg=fit(ao[tr_o],go[tr_o],ab[tr_b],gb[tr_b])
            s_old=auc(ho[te_o],hb[te_b]);s_new=auc(apply(ho[te_o],ao[te_o],go[te_o],wa,wg),apply(hb[te_b],ab[te_b],gb[te_b],wa,wg))
            one=np.ones(len(wg));onea=np.ones(len(wa))
            s_alt=auc(apply(ho[te_o],ao[te_o],go[te_o],wa,one),apply(hb[te_b],ab[te_b],gb[te_b],wa,one))
            s_grp=auc(apply(ho[te_o],ao[te_o],go[te_o],onea,wg),apply(hb[te_b],ab[te_b],gb[te_b],onea,wg))
            res_old.append(s_old);res_new.append(s_new);res_alt.append(s_alt);res_grp.append(s_grp)
    print(f'{key:14s} {int(F.sum()):5d}   {np.mean(res_old):.2f} |     {np.mean(res_alt):.2f}       |       {np.mean(res_grp):.2f}          |  {np.mean(res_new):.2f} ± {np.std(res_new):.2f}')
    wa,wg=fit(ao,go,ab,gb);out[key]={'alt_bins':bins[:-1].tolist(),'w_alt':[round(float(x),2) for x in wa],'w_group':{groups[i]:round(float(wg[i]),2) for i in tree}}
json.dump(out,open('weights.json','w'))

for k in ('cepe_bordeaux','girolle','trompette','cepe_ete'):
    o=out[k];print('\n',k,'altitude (poids/200 m, jusqu\'à 2000):',dict(zip(o['alt_bins'][:11],o['w_alt'][:11])));print('   essences courantes:',{g:w for g,w in o['w_group'].items() if g in('chene','hetre','feuillus','mixte','sapin_epicea','pins')})
