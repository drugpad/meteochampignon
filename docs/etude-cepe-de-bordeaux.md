# Étude : milieu et météo du cèpe de Bordeaux (*Boletus edulis*) — 30/10/2026

**Pourquoi cette étude.** Sur la carte « Coins », mon milieu donne 60 à 100 % à presque toute une hêtraie ou sapinière de 1000 à 1400 m (34 % des cases ≥ 50 % entre Bagnères et Payolle, 69 % entre 1000 et 1400 m), alors qu'un autre service affiche des taches isolées à ~26 %. Cette étude cherche dans la littérature ce qui justifie (ou non) mes règles de `scripts/build-habitat.py`.

**Limites de la méthode (à lire d'abord).** Les articles complets n'étaient pas accessibles depuis la session (domaines non autorisés : bioRxiv, Springer, Frontiers, DergiPark). Je n'ai lu que des **résumés rendus par la recherche web**. Les chiffres ci-dessous sont donc de seconde main ; chaque ligne porte un niveau de confiance. Rien n'a été validé sur des observations de terrain (GBIF inaccessible aussi).

## 1. Ce que la littérature établit

| Facteur | Ce que disent les sources | Confiance | Mon modèle actuel |
|---|---|---|---|
| **Arbres hôtes** | Ectomycorhizien à large spectre : hêtre, épicéa, sapin, pins, chênes, châtaignier ; aussi cistes en Espagne. Un saule nain à 2 440 m en Suisse. | Haute (qualitatif) | Hêtre et sapin/épicéa = 1, chênes/châtaignier 0,9 : cohérent |
| **Sol** | Acide, drainé, siliceux. pH relevé 4,8-5,8 (une source), ~4,2 sur les 20 premiers cm (une autre). | Moyenne (sources secondaires, chiffres divergents) | Plateau 1 entre pH 4,2 et 5,8 : cohérent |
| **Densité du peuplement** | La surface terrière est le meilleur prédicteur de stand : courbe **en cloche**. Optimum ~15-20 m²/ha (pinèdes des Pyrénées centrales) ; 30-40 m²/ha (pinèdes du nord de l'Espagne, ~40 à Soria). Éclaircie moyenne favorable, retrait de la litière défavorable (Italie). Une revue : préfère les bois ouverts et ensoleillés à la canopée dense. | **Moyenne à haute** (plusieurs études, mais sur *Pinus sylvestris* ; aucune sur hêtre/épicéa trouvée) | Plateau 1 de 40 à 88 % de couvert : **trop plat**, ne départage rien |
| **Âge du peuplement** | Contradictoire : production/ha qui baisse avec l'âge (une source) ; classe 51-70 ans la plus productive (une autre) ; croissance plus rapide < 30 ans ; diversité génétique maximale en peuplement jeune ; *B. edulis* remplacé par *B. badius* dans les vieux peuplements (Salerni & Perini 2004). | Moyenne (sens général : peuplements jeunes à mûrs, pas les vieux fermés) | **Absent** (je n'ai aucune donnée d'âge) |
| **Variabilité locale** | Dans UNE forêt de pins, la productivité des placettes va de **0 à 38,5 kg/ha/an**, et elle n'est **pas corrélée** à la quantité de mycélium du sol. | Haute | Mon 100 % suppose qu'un bon milieu produit partout : c'est faux |
| **Exposition / pente** | Variables importantes dans le modèle des Pyrénées centrales. Une source (non identifiée dans mes résultats) indique une productivité plus faible en exposition nord et en forte pente. | **Faible** | J'ai mis une préférence nord-nord-est (−12 % au plus à l'opposé) : **non étayée** |
| **Altitude** | Aucune source rigoureuse. Fourchettes citées : 300-600, 500-1 300, 600-1 200 (« populations les plus denses »), 600-1 800 m ; Apennins 500-1 700 m ; Casentino 800-1 200 m sous hêtre/châtaignier/sapin ; record 2 440 m. | **Faible** | Plateau 1 de 0 à 1 600 m : **aucune base pour le resserrer ou le garder** |
| **Pluie** | La pluie d'automne est le principal moteur. Pluie intense (≥ 20 mm) : effet maximal ~12 jours après (Italie). Fenêtre pluie de 7 à 21 jours avant la sortie (seconde main, préprint hêtraie allemande). | Moyenne | Pic à ~14 jours après la grosse pluie : cohérent |
| **Température** | Optimum ~13,2 °C (préprint, hêtraie près de Bielefeld, non relu). Les hausses brutales de température maximale freinent la production dans les peuplements non éclaircis (Mt Amiata, sapin). Certains travaux espagnols ne trouvent **aucun** effet de la température. | Faible à moyenne | Plateau 1 de 10 à 17 °C : plausible mais plat ; pas de pénalité de pic de chaleur |
| **Espèces voisines** | *B. reticulatus* (chênaies, été), *B. aereus* (chênes méditerranéens, chaud), *B. pinophilus* : lignées distinctes. | Haute | Déjà séparées dans l'appli |

## 2. Ce que ça explique (et n'explique pas)

1. **Pourquoi ma carte est si « rouge »** : tous mes critères valent 1 sur de larges plages et se multiplient, donc 100 % dès que l'essence, le sol, l'altitude et le couvert sont « acceptables ». La littérature décrit au contraire un phénomène **très patchy** (0 à 38,5 kg/ha/an dans une même forêt). Un score de 100 % n'a pas de sens : même le meilleur milieu n'est productif que sur une petite partie de sa surface.
2. **Pourquoi un autre service peut afficher 26 %** : s'il exprime une probabilité (ou un rendement relatif), un bon milieu ne dépasse pas ce niveau. Ce n'est pas la même échelle que mon « milieu favorable ».
3. **Ce que la littérature ne dit pas** : rien de solide sur l'altitude optimale en hêtraie-sapinière pyrénéenne. Je ne peux donc pas justifier un resserrement par les articles.

## 3. Recommandations (classées par solidité)

1. **Courbe en cloche sur la densité** (solide) : remplacer le plateau 40-88 % de couvert par un optimum moyen (à régler, par ex. ~45-70 %) avec baisse vers les bois très denses. Limite : couvert satellite ≠ surface terrière.
2. **Supprimer la préférence nord** (moyen) : mettre l'exposition à neutre tant qu'aucune source ne l'étaye. Gain : un critère inventé en moins.
3. **Changer le sens du chiffre** (solide) : présenter le milieu comme un **indice relatif**, jamais 100 % ; par exemple plafonner l'habitat à ~0,7 ou réserver la couleur la plus foncée au 10 % supérieur de la région.
4. **Pénalité de pic de chaleur** (faible) : réduire la pousse après un coup de chaud (> ~25 °C de maximale), à tester.
5. **Altitude** : ne pas la modifier sans données. À calibrer sur observations.
6. **Âge/structure** : non réalisable avec mes données actuelles (BD Forêt donne l'essence, pas l'âge). Piste : type de peuplement (futaie / taillis) de la BD Forêt, à explorer.

## 4. Validation prévue (non faite)

Télécharger les observations ouvertes de *B. edulis* (GBIF / iNaturalist) dans la région, comparer le score du modèle à ces points et à des points forestiers tirés au hasard, puis régler les courbes pour que les observations tombent plus haut que le hasard. **Nécessite d'autoriser `api.gbif.org` dans le réseau de la session.**

## 5. Sources

- Génétique et âge du peuplement : <https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7428248/>
- Pyrénées centrales, production et richesse en pinèdes (surface terrière) : <https://cdnsciencepub.com/doi/10.1139/X09-198>
- Modèles de rendement *P. sylvestris* / *P. pinaster* : <https://link.springer.com/article/10.1186/s40663-019-0211-1>
- Surface terrière et rendement (cas d'étude) : <https://oppla.eu/casestudy/20556>
- Mycélium et productivité variable (gradient 0-38,5 kg/ha/an) : <https://link.springer.com/article/10.1007/s00572-011-0382-2>
- Production par classe d'âge (Martínez-Peña et al. 2012) : <https://link.springer.com/article/10.1007/s00572-011-0389-8>
- Gestion forestière, climat et mycélium : <https://www.sciencedirect.com/science/article/abs/pii/S0378112717301317>
- Éclaircie et litière, Italie (Salerni & Perini 2004) : <https://www.researchgate.net/publication/223100960_Experimental_study_for_increasing_productivity_of_Boletus_edulis_sl_in_Italy>
- Climat et éclaircie, sapinières du Mt Amiata (Salerni et al. 2023) : <https://italianmycology.unibo.it/article/view/16464>
- Déclencheurs météo en hêtraie (préprint, non relu) : <https://www.biorxiv.org/content/10.64898/2025.12.12.693895.full.pdf>
- Revue sols/gestion : <https://www.frontiersin.org/journals/soil-science/articles/10.3389/fsoil.2023.1159793/full>
- Cistes et niche climatique en Espagne : <https://portaldelaciencia.uva.es/documentos/61a1fd45bd93e62bb60204f1>
- Phylogénie des cèpes : <https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0037567>
- Record d'altitude (2 440 m, saule nain) : <https://swissplantscienceweb.unibas.ch/en/news/details/altitude-record-for-porcini-mushrooms/>
- Fiches grand public (altitudes, sol, lisières ; qualité variable) : <https://lescartesterroirs.fr/blogs/infos/guide-complet-la-prospection-des-coins-a-cepes-de-bordeaux>, <https://www.first-nature.com/fungi/boletus-edulis.php>, <https://www.idealista.it/en/news/node/464993>
- Observation à confirmer (productivité selon exposition/altitude, Turquie) : <https://dergipark.org.tr/en/pub/artvinofd/article/449736>
