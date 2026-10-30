import json,numpy as np
from PIL import Image
import os; root=os.environ.get('HABITAT_DIR','public/habitat/')
groups=json.load(open(root+'habitat.json'))['groups']
info=np.array(Image.open(root+'info.png').convert('RGB'));H,W=info.shape[:2]
b=dict(latMin=42.595,latMax=45.155,lonMin=-0.405,lonMax=3.405)
def rc(la,lo):
    r=((b['latMax']-la)/(b['latMax']-b['latMin'])*H).astype(int);c=((lo-b['lonMin'])/(b['lonMax']-b['lonMin'])*W).astype(int)
    return np.clip(r,0,H-1),np.clip(c,0,W-1)
G=info[...,0];PH=info[...,1]/25.0;ALT=info[...,2].astype(int)*10
tree=[i for i,g in enumerate(groups) if g not in('aucun','herbe','lande')]
forest=np.isin(G,tree)
bg=json.load(open('bg.json'));d=json.load(open('gbif.json'))
def pts(R,flt):
    R=[r for r in R if r['year'] and r['year']>=1995 and flt(r['coordinateUncertaintyInMeters'])]
    return np.array([r['decimalLatitude'] for r in R]),np.array([r['decimalLongitude'] for r in R])
def auc(pos,neg):
    neg=np.sort(neg);lo=np.searchsorted(neg,pos,'left');hi=np.searchsorted(neg,pos,'right');return float(np.mean((lo+0.5*(hi-lo))/len(neg)))
CL={'<=1000m ou inconnue':lambda u:u is None or u<=1000}
flt=CL['<=1000m ou inconnue']
bla,blo=pts(bg,flt);br,bc=rc(bla,blo);bF=forest[br,bc]
print('fond : ',len(bla),'points,',round(bF.mean()*100),'% en forêt')
rep={}
for key,v in d.items():
    hab=np.array(Image.open(root+key+'.png').convert('L'),float)/255
    la,lo=pts(v['recs'],flt);r,c=rc(la,lo);F=forest[r,c]
    s=hab[r,c];sb=hab[br,bc]
    o=dict(n=len(la),forest_share_obs=float(F.mean()),forest_share_bg=float(bF.mean()))
    # dans la forêt seulement : le score discrimine-t-il ?
    if F.sum()>=15:
        o['n_forest']=int(F.sum());o['auc_in_forest']=auc(s[F],sb[bF]);o['med_obs']=float(np.median(s[F]));o['med_bg']=float(np.median(sb[bF]))
        o['share>=0.5_obs']=float((s[F]>=0.5).mean());o['share>=0.5_bg']=float((sb[bF]>=0.5).mean())
        # fréquence relative par tranche de score
        bins=[0,0.15,0.35,0.5,0.7,1.01]
        o['ratio_by_score']=[]
        for lo_,hi_ in zip(bins[:-1],bins[1:]):
            po=((s[F]>=lo_)&(s[F]<hi_)).mean();pb=((sb[bF]>=lo_)&(sb[bF]<hi_)).mean()
            o['ratio_by_score'].append((f'{lo_:.2f}-{min(hi_,1):.2f}',round(po/pb,2) if pb>0 else None,round(po,2),round(pb,2)))
        # altitude
        alt_o=ALT[r,c][F];alt_b=ALT[br,bc][bF]
        o['alt']=[]
        for a in range(0,2400,200):
            po=((alt_o>=a)&(alt_o<a+200)).mean();pb=((alt_b>=a)&(alt_b<a+200)).mean()
            if pb>0.01 or po>0.01: o['alt'].append((a,round(po/pb,2) if pb>0 else None,round(po,2),round(pb,2)))
        # essences
        gr=G[r,c][F];gb=G[br,bc][bF];o['groupes']=[]
        for i in tree:
            po=(gr==i).mean();pb=(gb==i).mean()
            if pb>0.02: o['groupes'].append((groups[i],round(po/pb,2),round(po,2),round(pb,2)))
        # pH
        ph_o=PH[r,c][F];ph_b=PH[br,bc][bF];o['ph']=[]
        for a in (3.5,4.5,5.0,5.5,6.0,6.5,7.0,7.5):
            po=((ph_o>=a)&(ph_o<a+0.5)).mean();pb=((ph_b>=a)&(ph_b<a+0.5)).mean()
            if pb>0.01 or po>0.01: o['ph'].append((a,round(po/pb,2) if pb>0 else None,round(po,2),round(pb,2)))
    rep[key]=o
json.dump(rep,open('rep2.json','w'),indent=0)
for k,o in rep.items():
    print('\n==',k,'n',o['n'],'| en forêt obs',round(o['forest_share_obs']*100),'% / fond',round(o['forest_share_bg']*100),'%')
    if 'auc_in_forest' in o:
        print('  AUC dans la forêt',round(o['auc_in_forest'],2),'| médiane obs',round(o['med_obs'],2),'vs fond',round(o['med_bg'],2),'| part >=0,5 obs',round(o['share>=0.5_obs'],2),'vs fond',round(o['share>=0.5_bg'],2),'(n forêt',o['n_forest'],')')
        print('  fréquence relative par score:',o['ratio_by_score'])
        print('  altitude (tranche, rapport, part obs, part fond):',o['alt'])
        print('  essences:',o['groupes'])
        print('  pH:',o['ph'])
