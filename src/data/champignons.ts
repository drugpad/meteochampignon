// Fiches d'identification des champignons (page « Champignons »).
//
// Contenu recoupé le 06/10/2026 sur les fiches Wikipédia de chaque espèce
// (et de chaque sosie) et sur les recommandations de l'Anses pour la
// cueillette — sources affichées au bas de chaque fiche. Les tags de
// comestibilité suivent l'usage des guides français : « Comestible + » =
// réputé bon à excellent. Ne rien ajouter ici sans source : cette page sert
// à reconnaître, jamais à décider seul de manger (avertissement affiché).
import { PHOTOS, type PhotoId } from './champignonPhotos'

export type Edibility = 'excellent' | 'comestible' | 'non-comestible' | 'toxique' | 'mortel'

export const EDIBILITY_LABEL: Record<Edibility, string> = {
  excellent: 'Comestible +',
  comestible: 'Comestible',
  'non-comestible': 'Non comestible',
  toxique: 'Toxique',
  mortel: 'Mortel',
}

export type Photo = {
  src: string
  author: string
  license: string
  licenseUrl: string | undefined
  sourceUrl: string
}

/** Espèce qui ressemble à l'une des fiches (sosie), décrite une seule fois. */
export type Lookalike = {
  name: string
  latin: string
  edibility: Edibility
  photo?: PhotoId
  /** Ce qu'elle provoque ou pourquoi on l'évite. */
  danger: string
  wiki?: string
}

export type Confusion = {
  /** Clé de LOOKALIKES. */
  with: keyof typeof LOOKALIKES
  /** Comment la distinguer de l'espèce de la fiche. */
  howToTell: string[]
}

export type Species = {
  id: string
  name: string
  latin: string
  edibility: Edibility
  photo: PhotoId
  /** Précaution indispensable (cuisson, quantité…), affichée en encadré. */
  warning?: string
  identification: string[]
  habitat: string
  season: string
  tips?: string
  confusions: Confusion[]
  /** Quand aucun sosie dangereux n'est connu. */
  noDangerousLookalike?: boolean
  wiki: string
}

export function photoOf(id: PhotoId): Photo {
  return PHOTOS[id]
}

const WIKI = 'https://fr.wikipedia.org/wiki/'

export const LOOKALIKES = {
  gyromitre: {
    name: 'Gyromitre',
    latin: 'Gyromitra esculenta',
    edibility: 'mortel',
    photo: 'gyromitra-esculenta',
    danger:
      'Contient de la gyromitrine : intoxications parfois mortelles, même après cuisson, et effet cumulatif d’un repas à l’autre. Vente interdite en France depuis 1991.',
    wiki: WIKI + 'Gyromitra_esculenta',
  },
  verpe: {
    name: 'Verpe de Bohême',
    latin: 'Verpa bohemica',
    edibility: 'toxique',
    photo: 'verpa-bohemica',
    danger: 'Toxique crue ou mal cuite ; troubles digestifs et de la coordination signalés même cuite chez certaines personnes.',
    wiki: WIKI + 'Verpa_bohemica',
  },
  'bolet-amer': {
    name: 'Bolet amer (bolet de fiel)',
    latin: 'Tylopilus felleus',
    edibility: 'non-comestible',
    photo: 'tylopilus-felleus',
    danger: 'Pas dangereux, mais d’une amertume extrême qui augmente à la cuisson : un seul exemplaire gâche tout le plat.',
    wiki: WIKI + 'Tylopilus_felleus',
  },
  'bolet-satan': {
    name: 'Bolet de Satan',
    latin: 'Rubroboletus satanas',
    edibility: 'toxique',
    photo: 'rubroboletus-satanas',
    danger: 'Gastro-entérite violente (vomissements répétés, diarrhées parfois sanglantes), même cuit.',
    wiki: WIKI + 'Rubroboletus_satanas',
  },
  'fausse-girolle': {
    name: 'Fausse girolle',
    latin: 'Hygrophoropsis aurantiaca',
    edibility: 'non-comestible',
    photo: 'hygrophoropsis-aurantiaca',
    danger: 'Sans intérêt culinaire et de comestibilité discutée (troubles digestifs anciennement rapportés) : à ne pas consommer.',
    wiki: WIKI + 'Hygrophoropsis_aurantiaca',
  },
  'clitocybe-olivier': {
    name: 'Clitocybe de l’olivier',
    latin: 'Omphalotus olearius',
    edibility: 'toxique',
    photo: 'omphalotus-olearius',
    danger: 'Syndrome gastro-intestinal parfois sévère (nausées, fortes diarrhées). Très commun dans le Midi.',
    wiki: WIKI + 'Omphalotus_olearius',
  },
  'cortinaires-mortels': {
    name: 'Cortinaire couleur de rocou et cortinaire très joli',
    latin: 'Cortinarius orellanus, C. rubellus',
    edibility: 'mortel',
    photo: 'cortinarius-orellanus',
    danger:
      'Orellanine : détruit les reins. Les premiers signes peuvent n’apparaître que plusieurs jours après le repas, quand les reins sont déjà atteints (insuffisance rénale parfois définitive, ou décès).',
    wiki: WIKI + 'Cortinarius_orellanus',
  },
  'amanite-tue-mouches': {
    name: 'Amanite tue-mouches',
    latin: 'Amanita muscaria',
    edibility: 'toxique',
    photo: 'amanita-muscaria',
    danger: 'Syndrome panthérinien (confusion, agitation, somnolence), très rarement mortel.',
    wiki: WIKI + 'Amanita_muscaria',
  },
  'amanite-phalloide': {
    name: 'Amanite phalloïde',
    latin: 'Amanita phalloides',
    edibility: 'mortel',
    photo: 'amanita-phalloides',
    danger:
      'Responsable de la plupart des décès par champignon. Environ 30 g (un demi-chapeau) peuvent tuer un adulte : destruction du foie, premiers symptômes digestifs plusieurs heures après le repas, fausse amélioration, puis atteinte grave du foie.',
    wiki: WIKI + 'Amanita_phalloides',
  },
  'petites-lepiotes': {
    name: 'Petites lépiotes (lépiote brun incarnat…)',
    latin: 'Lepiota brunneoincarnata, L. helveola…',
    edibility: 'mortel',
    photo: 'lepiota-brunneoincarnata',
    danger: 'Contiennent les mêmes toxines que l’amanite phalloïde (amatoxines) : intoxications mortelles documentées.',
    wiki: WIKI + 'Lepiota_brunneoincarnata',
  },
  'lepiote-veneneuse': {
    name: 'Lépiote vénéneuse (lépiote brune)',
    latin: 'Chlorophyllum brunneum',
    edibility: 'toxique',
    photo: 'chlorophyllum-brunneum',
    danger: 'Troubles digestifs.',
    wiki: WIKI + 'Chlorophyllum_brunneum',
  },
  'amanite-panthere': {
    name: 'Amanite panthère',
    latin: 'Amanita pantherina',
    edibility: 'toxique',
    photo: 'amanita-pantherina',
    danger: 'Syndrome panthérinien (confusion, agitation, troubles de la conscience), plus marqué qu’avec la tue-mouches.',
    wiki: WIKI + 'Amanita_pantherina',
  },
  'lactaire-toison': {
    name: 'Lactaire à toison',
    latin: 'Lactarius torminosus',
    edibility: 'toxique',
    photo: 'lactarius-torminosus',
    danger: 'Très irritant pour le tube digestif (vomissements, diarrhées).',
    wiki: WIKI + 'Lactarius_torminosus',
  },
  'lactaire-delicieux': {
    name: 'Lactaire délicieux',
    latin: 'Lactarius deliciosus',
    edibility: 'comestible',
    photo: 'lactarius-deliciosus',
    danger: 'Aucun : confusion sans conséquence (voir sa fiche).',
  },
  'lactaire-sanguin': {
    name: 'Lactaire sanguin',
    latin: 'Lactarius sanguifluus',
    edibility: 'excellent',
    photo: 'lactarius-sanguifluus',
    danger: 'Aucun : confusion sans conséquence (voir sa fiche).',
  },
  'tricholome-tigre': {
    name: 'Tricholome tigré',
    latin: 'Tricholoma pardinum',
    edibility: 'toxique',
    photo: 'tricholoma-pardinum',
    danger:
      'L’un des tricholomes les plus toxiques : vomissements et diarrhées violents dans les 15 min à 2 h, pendant plusieurs jours, hospitalisation parfois nécessaire.',
    wiki: WIKI + 'Tricholoma_pardinum',
  },
  'tricholome-josserand': {
    name: 'Tricholome de Josserand',
    latin: 'Tricholoma josserandii',
    edibility: 'toxique',
    danger: 'Troubles digestifs.',
  },
  'tricholome-vergete': {
    name: 'Tricholome vergeté',
    latin: 'Tricholoma virgatum',
    edibility: 'non-comestible',
    danger: 'Amer et âcre, immangeable.',
  },
  'helvelle-lacuneuse': {
    name: 'Helvelle lacuneuse',
    latin: 'Helvella lacunosa',
    edibility: 'toxique',
    danger: 'Toxique crue ou mal cuite.',
  },
  'chanterelles-grises': {
    name: 'Chanterelle cendrée, chanterelle sinueuse',
    latin: 'Craterellus cinereus, Pseudocraterellus undulatus',
    edibility: 'comestible',
    danger: 'Aucun : comestibles elles aussi.',
  },
  leotie: {
    name: 'Léotie lubrique',
    latin: 'Leotia lubrica',
    edibility: 'non-comestible',
    danger: 'Suspecte, sans intérêt.',
  },
  'hydne-roussissant': {
    name: 'Hydne roussissant',
    latin: 'Hydnum rufescens',
    edibility: 'comestible',
    danger: 'Aucun : comestible lui aussi.',
  },
  'bolets-rudes': {
    name: 'Autres bolets rudes (bolet orangé des chênes, des bouleaux…)',
    latin: 'Leccinum aurantiacum, L. versipelle…',
    edibility: 'comestible',
    danger: 'Aucun s’ils sont bien cuits (même précaution que le bolet orangé des peupliers).',
  },
  'bolet-blafard': {
    name: 'Bolet blafard',
    latin: 'Suillellus luridus',
    edibility: 'comestible',
    danger: 'Comestible seulement bien cuit, mais très proche de bolets toxiques : réservé aux connaisseurs.',
  },
  'russules-acres': {
    name: 'Russules à saveur âcre (russule émétique…)',
    latin: 'Russula emetica…',
    edibility: 'toxique',
    danger: 'Troubles digestifs (vomissements).',
  },
  'bolets-visqueux': {
    name: 'Bolet granulé, bolet élégant',
    latin: 'Suillus granulatus, S. grevillei',
    edibility: 'comestible',
    danger: 'Aucun : comestibles moyens, mêmes précautions (retirer la peau visqueuse).',
  },
  ramaires: {
    name: 'Clavaires / ramaires (clavaire élégante…)',
    latin: 'Ramaria formosa…',
    edibility: 'toxique',
    danger: 'Plusieurs sont purgatives (troubles digestifs).',
  },
  'sparassis-brevipes': {
    name: 'Sparassis à pied court',
    latin: 'Sparassis brevipes',
    edibility: 'non-comestible',
    danger: 'Odeur désagréable (eau de Javel, urine) : à laisser.',
  },
  'autres-cepes': {
    name: 'Les autres cèpes (bordeaux, bronzé, des pins, d’été)',
    latin: 'Boletus edulis, B. aereus, B. pinophilus, B. reticulatus',
    edibility: 'excellent',
    danger: 'Aucun : les quatre cèpes sont tous d’excellents comestibles.',
  },
} satisfies Record<string, Lookalike>

// --- Confusions qui reviennent sur plusieurs fiches -----------------------

const MORILLE_CONFUSIONS: Confusion[] = [
  {
    with: 'gyromitre',
    howToTell: [
      'Chapeau en circonvolutions, comme un cerveau, brun-roux : PAS d’alvéoles en nid d’abeille.',
      'Coupée en deux dans la longueur, elle est cloisonnée en plusieurs chambres irrégulières ; une morille est creuse d’une seule cavité, du sommet du chapeau au bas du pied.',
      'Souvent sous les conifères, au printemps comme les morilles.',
    ],
  },
  {
    with: 'verpe',
    howToTell: [
      'Chapeau en clochette fixé seulement tout en haut du pied : on peut glisser un doigt entre le chapeau et le pied. Chez la morille, le chapeau est soudé au pied sur tout son bord inférieur.',
      'Pied rempli d’une moelle cotonneuse, pas creux d’un seul tenant.',
      'Chapeau couvert de plis en long plutôt que de vraies alvéoles.',
    ],
  },
]

const MORILLE_WARNING =
  'Toxique crue ou mal cuite : toujours bien cuire (l’Anses recommande 20 à 30 min à la poêle pour les champignons sauvages). Même cuites, de grandes quantités au même repas ont provoqué des troubles neurologiques (vertiges, tremblements, troubles de la vue) : rester raisonnable.'

const CEPE_CONFUSIONS: Confusion[] = [
  {
    with: 'bolet-amer',
    howToTell: [
      'Pores blancs puis rose sale en vieillissant ; ceux d’un cèpe passent au jaune puis au vert olive, jamais au rose.',
      'Réseau sur le pied brun foncé, grossier et en relief ; chez le cèpe, il est fin et blanchâtre à brun clair.',
      'En cas de doute, goûter une miette crue du bout de la langue puis la recracher : l’amertume est immédiate et intense.',
    ],
  },
  {
    with: 'bolet-satan',
    howToTell: [
      'Pores rouges à orangés ; un cèpe n’a jamais les pores rouges.',
      'Chapeau blanchâtre à gris pâle, pied ventru rouge couvert d’un réseau.',
      'Chair qui bleuit à la coupe (celle des cèpes reste blanche) ; odeur désagréable en vieillissant.',
      'Plutôt l’été, sur sol calcaire, sous les chênes, hêtres ou charmes.',
    ],
  },
]

const CEPE_TIPS =
  'Règle des cèpes : pores blancs, jaunes ou vert olive (jamais rouges ni roses), chair blanche qui ne change pas de couleur à la coupe, réseau fin et clair sur le pied.'

export const SPECIES: Species[] = [
  {
    id: 'morille-commune',
    name: 'Morille commune',
    latin: 'Morchella esculenta',
    edibility: 'excellent',
    photo: 'morchella-esculenta',
    warning: MORILLE_WARNING,
    identification: [
      'Chapeau arrondi à ovoïde, jaune-ocre à beige, couvert d’alvéoles irrégulières en nid d’abeille séparées par des côtes.',
      'Chapeau soudé directement au pied sur tout son bord inférieur, sans partie libre.',
      'Coupée en deux dans la longueur, elle est entièrement creuse, d’une seule cavité continue du sommet du chapeau au bas du pied.',
      'Pied blanchâtre, granuleux, souvent élargi à la base.',
    ],
    habitat:
      'Sols calcaires ou sablonneux bien drainés : sous les frênes et les ormes, en lisière, dans les vieux vergers, au bord des cours d’eau.',
    season: 'Printemps : mars à mai.',
    confusions: MORILLE_CONFUSIONS,
    wiki: WIKI + 'Morchella_esculenta',
  },
  {
    id: 'morille-conique',
    name: 'Morille conique',
    latin: 'Morchella conica (groupe elata)',
    edibility: 'excellent',
    photo: 'morchella-conica',
    warning: MORILLE_WARNING,
    identification: [
      'Chapeau conique, pointu, gris-brun à brun foncé presque noir.',
      'Alvéoles allongées, rangées entre des côtes verticales à peu près parallèles, souvent plus sombres.',
      'Chapeau soudé au pied, parfois avec un petit sillon à la jonction.',
      'Comme toutes les morilles : entièrement creuse d’une seule cavité quand on la coupe en long.',
    ],
    habitat:
      'Surtout en montagne et moyenne montagne, sous les conifères (sapins, épicéas), sur les places de feu et débris de bois ; parfois sur copeaux dans les jardins.',
    season: 'Printemps : mars à juin, plus tard en altitude.',
    confusions: MORILLE_CONFUSIONS,
    wiki: WIKI + 'Morchella_conica',
  },
  {
    id: 'cepe-de-bordeaux',
    name: 'Cèpe de Bordeaux',
    latin: 'Boletus edulis',
    edibility: 'excellent',
    photo: 'boletus-edulis',
    identification: [
      'Chapeau brun clair à brun foncé, souvent bordé d’une fine marge plus pâle, lisse, un peu gras par temps humide.',
      'Dessous à tubes et pores : blancs chez le jeune, puis jaunâtres, puis vert olive.',
      'Pied ventru, blanchâtre à brun pâle, couvert d’un fin réseau blanc en relief, surtout dans sa moitié haute.',
      'Chair blanche et ferme qui ne change pas de couleur à la coupe (un peu rosée juste sous la peau du chapeau).',
    ],
    habitat: 'Sous les chênes, hêtres, châtaigniers, sapins et épicéas ; clairières et lisières.',
    season: 'Fin d’été et automne, surtout septembre-octobre, environ 10 jours après de bonnes pluies.',
    tips: CEPE_TIPS,
    confusions: [...CEPE_CONFUSIONS, { with: 'autres-cepes', howToTell: ['Teinte du chapeau, réseau du pied et habitat : voir les autres fiches de cèpes.'] }],
    wiki: WIKI + 'Boletus_edulis',
  },
  {
    id: 'cepe-bronze',
    name: 'Cèpe bronzé',
    latin: 'Boletus aereus',
    edibility: 'excellent',
    photo: 'boletus-aereus',
    identification: [
      'Chapeau brun-noir à noirâtre, sec, mat et velouté.',
      'Pores blancs, puis jaunes, puis vert olive.',
      'Pied brun, trapu, avec un réseau fin peu visible.',
      'Chair blanche, très ferme, qui ne change pas de couleur à la coupe.',
    ],
    habitat:
      'Espèce de chaleur : chênes et châtaigniers sur sols acides bien drainés, clairières ensoleillées, jusqu’à environ 1 100 m.',
    season: 'Fin de printemps à l’automne, surtout l’été, 7 à 10 jours après de fortes pluies orageuses.',
    tips: CEPE_TIPS,
    confusions: CEPE_CONFUSIONS,
    wiki: WIKI + 'Boletus_aereus',
  },
  {
    id: 'cepe-des-pins',
    name: 'Cèpe des pins',
    latin: 'Boletus pinophilus',
    edibility: 'excellent',
    photo: 'boletus-pinophilus',
    identification: [
      'Chapeau brun-rouge acajou à bordeaux, ridé ou bosselé, souvent bordé d’une pruine blanche chez le jeune.',
      'Pores blancs, puis jaunes, puis vert olive.',
      'Pied blanc rosé en haut, brun-rouille vers la base, réseau blanc sur les deux tiers supérieurs.',
      'Chair blanche ferme, qui ne change pas de couleur à la coupe.',
    ],
    habitat: 'Surtout sous les pins, mais aussi sapins, épicéas, hêtres et châtaigniers, souvent en montagne, sur sols acides.',
    season: 'Du printemps (mai-juin) à l’automne.',
    tips: CEPE_TIPS,
    confusions: CEPE_CONFUSIONS,
    wiki: WIKI + 'Boletus_pinophilus',
  },
  {
    id: 'cepe-d-ete',
    name: 'Cèpe d’été (cèpe réticulé)',
    latin: 'Boletus reticulatus (= B. aestivalis)',
    edibility: 'excellent',
    photo: 'boletus-reticulatus',
    identification: [
      'Chapeau brun clair noisette, sec, velouté, qui se craquelle souvent par temps sec.',
      'Pores blancs, puis jaunes, puis vert olive.',
      'Réseau bien marqué sur toute la longueur du pied, souvent jusqu’à la base.',
      'Chair blanche, qui ne change pas de couleur, plus tendre que celle du cèpe de Bordeaux ; souvent véreux.',
    ],
    habitat: 'Surtout sous les chênes, aussi hêtres et châtaigniers ; lisières, parcs, bois clairs. Aime la chaleur.',
    season: 'Mai à octobre, pic en juillet après les orages, seconde poussée en octobre.',
    tips: CEPE_TIPS,
    confusions: CEPE_CONFUSIONS,
    wiki: WIKI + 'Boletus_reticulatus',
  },
  {
    id: 'girolle',
    name: 'Girolle',
    latin: 'Cantharellus cibarius',
    edibility: 'excellent',
    photo: 'cantharellus-cibarius',
    identification: [
      'Champignon entièrement jaune d’œuf à jaune orangé.',
      'Sous le chapeau, PAS de vraies lames : des plis épais et peu profonds, fourchus et reliés entre eux, qui descendent sur le pied.',
      'Chapeau irrégulier, marge enroulée puis ondulée, s’évasant en entonnoir.',
      'Chair blanche à jaunâtre, ferme, qui se déchire en long ; odeur fruitée (abricot).',
      'Pousse sur la terre, jamais sur le bois.',
    ],
    habitat: 'Sous les feuillus et les conifères, sur sols acides, souvent dans la mousse.',
    season: 'Juin à novembre.',
    confusions: [
      {
        with: 'fausse-girolle',
        howToTell: [
          'Vraies lames fines et serrées, régulièrement fourchues, orange vif, qui se détachent à l’ongle.',
          'Chair mince et molle, pied plus sombre.',
          'Pousse souvent sur des débris de bois de conifères.',
        ],
      },
      {
        with: 'clitocybe-olivier',
        howToTell: [
          'Vraies lames, fines et serrées.',
          'Pousse en touffes sur du bois : souches ou pieds d’olivier, de chêne, de châtaignier, parfois sur des racines enterrées.',
          'Plus grand, orange vif à brun-rouge.',
        ],
      },
      {
        with: 'cortinaires-mortels',
        howToTell: [
          'Vraies lames, orange-fauve puis rouille.',
          'Chez le jeune, un voile en toile d’araignée (cortine) relie le bord du chapeau au pied.',
          'Chapeau roux-orangé à brun-rouge, chair plus fibreuse, pied souvent strié de fibres.',
        ],
      },
    ],
    wiki: WIKI + 'Cantharellus_cibarius',
  },
  {
    id: 'bolet-orange-des-peupliers',
    name: 'Bolet orangé des peupliers',
    latin: 'Leccinum albostipitatum',
    edibility: 'comestible',
    photo: 'leccinum-albostipitatum',
    warning: 'Toxique cru ou mal cuit (troubles digestifs) : toujours bien cuire. Le pied, fibreux, est souvent écarté.',
    identification: [
      'Chapeau orange vif puis orange terne, 4 à 20 cm.',
      'Pores blanchâtres puis gris-beige.',
      'Pied haut et blanc couvert de fines mèches (scabres) d’abord blanches, qui roussissent puis noircissent au toucher.',
      'Chair blanche qui rosit, grisaille puis noircit à la coupe : c’est normal pour ce groupe.',
    ],
    habitat: 'Uniquement sous les peupliers, surtout les trembles.',
    season: 'Été et automne.',
    confusions: [
      {
        with: 'bolets-rudes',
        howToTell: [
          'Le bolet orangé des chênes a des mèches rousses sur le pied ; le bolet des bouleaux, des mèches noires.',
          'Les arbres voisins donnent la meilleure indication.',
        ],
      },
    ],
    noDangerousLookalike: true,
    wiki: WIKI + 'Leccinum_albostipitatum',
  },
  {
    id: 'tricholome-pretentieux',
    name: 'Tricholome prétentieux (petit-gris)',
    latin: 'Tricholoma portentosum',
    edibility: 'excellent',
    photo: 'tricholoma-portentosum',
    identification: [
      'Chapeau gris à gris-noir, souvent mamelonné, couvert de fines fibrilles noires rayonnantes ; visqueux par temps humide, la peau se pèle.',
      'Lames blanches à reflets jaunâtres.',
      'Pied blanc, souvent teinté de jaune pâle. Ni anneau, ni volve.',
      'Odeur de farine.',
    ],
    habitat: 'Pinèdes (pin sylvestre surtout), souvent en troupes.',
    season: 'Fin d’automne : octobre à décembre, souvent après les premières gelées.',
    tips: 'Les deux signes qui le confirment : reflets jaunes sur les lames et le pied, et chapeau à fibrilles noires dont la peau se pèle.',
    confusions: [
      {
        with: 'tricholome-tigre',
        howToTell: [
          'Chapeau couvert de petites écailles grises disposées en cercles concentriques, pas de fibrilles rayonnantes.',
          'Lames et pied sans reflets jaunes.',
          'Plutôt sur sol calcaire, en montagne, sous les hêtres et les sapins.',
        ],
      },
      {
        with: 'tricholome-josserand',
        howToTell: ['Pas de reflets jaunes, chapeau lisse sans fibrilles noires, peau qui ne se pèle pas.', 'Odeur de farine rance.'],
      },
      {
        with: 'tricholome-vergete',
        howToTell: ['Chapeau conique et pointu, sans jaune sur les lames ni le pied.', 'Saveur amère et âcre ; plutôt sous les épicéas.'],
      },
      {
        with: 'amanite-phalloide',
        howToTell: [
          'Anneau blanc sous le chapeau et volve blanche en forme de sac à la base du pied : toujours déterrer le pied entier.',
          'Chapeau vert olive à verdâtre, lames blanches.',
        ],
      },
    ],
    wiki: WIKI + 'Tricholoma_portentosum',
  },
  {
    id: 'oronge',
    name: 'Oronge (amanite des Césars)',
    latin: 'Amanita caesarea',
    edibility: 'excellent',
    photo: 'amanita-caesarea',
    warning:
      'Ne jamais ramasser d’« œufs » encore fermés : à ce stade, aucun de ses caractères n’est visible et elle peut être confondue avec l’amanite phalloïde, mortelle.',
    identification: [
      'Chapeau orange vif à rouge-orangé, 8 à 20 cm, lisse, normalement sans flocons blancs, marge striée.',
      'Lames JAUNES.',
      'Pied JAUNE avec un anneau jaune.',
      'À la base, une grande volve BLANCHE en forme de sac : le champignon sort d’un « œuf » blanc.',
    ],
    habitat: 'Régions chaudes : sous les chênes et les châtaigniers, lisières et bois clairs ensoleillés.',
    season: 'Juillet à octobre, surtout après les orages d’été.',
    tips: 'Lames jaunes + pied jaune + volve blanche en sac : cette combinaison n’existe chez aucune autre amanite d’Europe.',
    confusions: [
      {
        with: 'amanite-tue-mouches',
        howToTell: [
          'Lames et pied BLANCS : c’est le critère qui tranche.',
          'Flocons blancs sur le chapeau… que la pluie peut laver, et le rouge peut pâlir vers l’orange : ne jamais se fier au seul chapeau.',
          'Base du pied entourée de bourrelets, pas d’une volve en sac.',
        ],
      },
      {
        with: 'amanite-phalloide',
        howToTell: [
          'À l’état d’œuf, impossible de les distinguer sans couper : coupé en long, l’œuf d’oronge montre déjà un chapeau orange et des lames jaunes, celui de la phalloïde est tout blanc ou verdâtre. Le plus sûr est de ne pas cueillir les œufs.',
          'Adulte : chapeau vert olive à blanchâtre, lames et pied blancs.',
        ],
      },
    ],
    wiki: WIKI + 'Amanita_caesarea',
  },
  {
    id: 'trompette-de-la-mort',
    name: 'Trompette de la mort',
    latin: 'Craterellus cornucopioides',
    edibility: 'excellent',
    photo: 'craterellus-cornucopioides',
    identification: [
      'Forme de trompette ou de corne d’abondance, creuse jusqu’à la base.',
      'Intérieur gris-brun à noir ; extérieur gris cendré, lisse ou à peine ridé, sans lames ni plis marqués.',
      'Chair très mince, élastique. Pousse en troupes serrées.',
    ],
    habitat: 'Sous les feuillus (hêtres, chênes, châtaigniers), sur sol argileux et humide, dans les feuilles mortes et les coins sombres.',
    season: 'Août à novembre.',
    confusions: [
      {
        with: 'chanterelles-grises',
        howToTell: ['Plis bien visibles sous le chapeau chez la chanterelle cendrée ; forme moins régulière en cornet chez la sinueuse.'],
      },
      {
        with: 'helvelle-lacuneuse',
        howToTell: ['Chapeau en selle tourmentée, gris-noir, posé sur un pied creusé de côtes et de trous : pas une trompette.'],
      },
    ],
    noDangerousLookalike: true,
    wiki: WIKI + 'Craterellus_cornucopioides',
  },
  {
    id: 'pied-de-mouton',
    name: 'Pied-de-mouton',
    latin: 'Hydnum repandum',
    edibility: 'excellent',
    photo: 'hydnum-repandum',
    identification: [
      'Chapeau crème à orangé pâle, irrégulier et épais.',
      'Dessous sans lames ni pores : des aiguillons (petits picots de 3 à 6 mm) serrés, crème, qui se détachent facilement.',
      'Pied blanc, court et épais, souvent décentré.',
      'Chair blanche, ferme et cassante.',
    ],
    habitat: 'Sous les feuillus et les conifères, souvent sur sol calcaire, en groupes, en lignes ou en cercles.',
    season: 'Août à décembre.',
    tips: 'Les vieux exemplaires deviennent amers : préférer les jeunes, on peut gratter les aiguillons.',
    confusions: [
      {
        with: 'hydne-roussissant',
        howToTell: ['Plus petit et plus fin, chapeau plus orangé-roux, aiguillons qui ne descendent pas sur le pied.'],
      },
    ],
    noDangerousLookalike: true,
    wiki: WIKI + 'Hydnum_repandum',
  },
  {
    id: 'bolet-bai',
    name: 'Bolet bai',
    latin: 'Imleria badia',
    edibility: 'excellent',
    photo: 'imleria-badia',
    identification: [
      'Chapeau brun bai (marron acajou), velouté et sec, gluant par temps humide.',
      'Pores jaunes à vert-jaune qui bleuissent nettement quand on appuie.',
      'Pied brun, strié en long, SANS réseau.',
      'Chair blanc-jaunâtre, qui bleuit légèrement à la coupe.',
    ],
    habitat: 'Surtout sous les conifères, aussi en forêt mixte ; sols acides, bois frais et moussus.',
    season: 'Été et automne, parfois jusqu’au début de l’hiver.',
    tips: 'Retirer le pied s’il est fibreux. Le bleuissement des pores est normal chez cette espèce.',
    confusions: [
      {
        with: 'bolet-amer',
        howToTell: ['Pores blancs puis rose sale (jamais jaunes), qui ne bleuissent pas ; réseau brun foncé sur le pied ; goût très amer.'],
      },
    ],
    noDangerousLookalike: true,
    wiki: WIKI + 'Imleria_badia',
  },
  {
    id: 'lepiote-elevee',
    name: 'Lépiote élevée (coulemelle)',
    latin: 'Macrolepiota procera',
    edibility: 'excellent',
    photo: 'macrolepiota-procera',
    warning: 'Ne jamais cueillir une lépiote dont le chapeau ouvert fait moins de 10 cm : plusieurs petites lépiotes sont mortelles.',
    identification: [
      'Grand chapeau (10 à 25 cm ouvert), d’abord en baguette de tambour puis en parasol, mamelon brun au centre et écailles brunes sur fond crème.',
      'Lames blanches, libres (non attachées au pied).',
      'Pied très haut, mince, bulbeux à la base, chiné de bandes brunes comme une peau de serpent.',
      'Anneau double, épais, qui coulisse le long du pied. Pas de volve.',
    ],
    habitat: 'Prairies, lisières, clairières et bois clairs.',
    season: 'Juillet à novembre.',
    tips: 'Seul le chapeau se mange : le pied est trop fibreux.',
    confusions: [
      {
        with: 'petites-lepiotes',
        howToTell: [
          'Chapeau de moins de 10 cm, anneau fin et fixe (qui ne coulisse pas), souvent rosé ou brun-rosé.',
          'Règle de sécurité : jamais de lépiote de moins de 10 cm.',
        ],
      },
      {
        with: 'lepiote-veneneuse',
        howToTell: [
          'Pied lisse, sans chinures, plus court que le diamètre du chapeau.',
          'Anneau simple ; chair qui rougit fortement quand on la gratte ou la coupe.',
          'Souvent près des composts et dans les jardins.',
        ],
      },
      {
        with: 'amanite-panthere',
        howToTell: [
          'Pied blanc et lisse, sans chinures, avec un bourrelet (volve) en bas du pied.',
          'Chapeau brun couvert de petites verrues blanches.',
        ],
      },
    ],
    wiki: WIKI + 'Macrolepiota_procera',
  },
  {
    id: 'lactaire-delicieux',
    name: 'Lactaire délicieux',
    latin: 'Lactarius deliciosus',
    edibility: 'comestible',
    photo: 'lactarius-deliciosus',
    identification: [
      'Chapeau orange carotte, zoné de cercles plus foncés, creusé au centre, taché de vert avec l’âge.',
      'Cassé, il laisse couler un lait ORANGE CAROTTE qui rougit très lentement.',
      'Lames orange ; tout le champignon verdit en vieillissant ou au froissement.',
      'Pied orange, creux, marqué de petites fossettes.',
    ],
    habitat: 'Exclusivement sous les pins.',
    season: 'Septembre à novembre.',
    tips: 'Colore l’urine en rouge : c’est sans danger.',
    confusions: [
      {
        with: 'lactaire-toison',
        howToTell: [
          'Lait BLANC qui ne change pas de couleur.',
          'Chapeau rose saumon dont la marge enroulée est laineuse, poilue.',
          'Plutôt sous les bouleaux.',
        ],
      },
      {
        with: 'lactaire-sanguin',
        howToTell: ['Lait rouge vineux dès la cassure (pas orange).'],
      },
    ],
    wiki: WIKI + 'Lactarius_deliciosus',
  },
  {
    id: 'lactaire-sanguin',
    name: 'Lactaire sanguin',
    latin: 'Lactarius sanguifluus',
    edibility: 'excellent',
    photo: 'lactarius-sanguifluus',
    identification: [
      'Chapeau orange terne à rose-vineux, taché de vert avec l’âge.',
      'Cassé, il laisse couler un lait ROUGE VINEUX dès la cassure.',
      'Pied court et trapu, marqué de petites fossettes.',
    ],
    habitat: 'Sous les pins, sur sol calcaire.',
    season: 'Septembre à novembre.',
    tips: 'Souvent considéré comme le meilleur des lactaires. Colore l’urine en rouge, sans danger.',
    confusions: [
      {
        with: 'lactaire-delicieux',
        howToTell: ['Lait orange carotte qui ne rougit que lentement.'],
      },
      {
        with: 'lactaire-toison',
        howToTell: ['Lait BLANC, chapeau rose saumon à marge laineuse, sous les bouleaux.'],
      },
    ],
    wiki: WIKI + 'Lactarius_sanguifluus',
  },
  {
    id: 'chanterelle-en-tube',
    name: 'Chanterelle en tube',
    latin: 'Craterellus tubaeformis',
    edibility: 'excellent',
    photo: 'craterellus-tubaeformis',
    identification: [
      'Petit chapeau brun-gris de 3 à 7 cm, en entonnoir percé au centre.',
      'Dessous : PAS de vraies lames, des plis jaunâtres à gris, fourchus, qui descendent sur le pied.',
      'Pied jaune, creux, souple, souvent aplati et sillonné.',
      'Pousse en troupes nombreuses.',
    ],
    habitat: 'Forêts de conifères et de feuillus très humides, dans la mousse, près du bois pourri.',
    season: 'De la mi-automne aux premières gelées.',
    confusions: [
      {
        with: 'cortinaires-mortels',
        howToTell: [
          'Vraies lames, fauves puis couleur rouille.',
          'Pied plein (pas creux), voile en toile d’araignée chez le jeune.',
          'Ne jamais ramasser « en vrac » : vérifier chaque exemplaire.',
        ],
      },
      {
        with: 'leotie',
        howToTell: ['Petite tête gélatineuse, bosselée, jaune-vert, sans plis ni lames.'],
      },
    ],
    wiki: WIKI + 'Craterellus_tubaeformis',
  },
  {
    id: 'sparassis-crepu',
    name: 'Sparassis crépu (morille des pins)',
    latin: 'Sparassis crispa',
    edibility: 'comestible',
    photo: 'sparassis-crispa',
    identification: [
      'Grosse boule de 10 à 40 cm qui évoque un chou-fleur ou une éponge.',
      'Faite de lames aplaties, ondulées et frisées, serrées et entremêlées.',
      'Crème à beige, brunissant avec l’âge ; une base épaisse commune.',
    ],
    habitat: 'Au pied des conifères, surtout des pins, ou sur leurs souches ; revient souvent au même endroit.',
    season: 'Septembre à novembre.',
    tips: 'Ne cueillir que les jeunes (les vieux deviennent coriaces et indigestes) et bien nettoyer terre et aiguilles.',
    confusions: [
      { with: 'sparassis-brevipes', howToTell: ['Plus petit et plus jaune, odeur d’eau de Javel ou d’urine.'] },
      {
        with: 'ramaires',
        howToTell: ['Rameaux cylindriques dressés comme du corail, pas de lames aplaties et frisées.', 'Souvent jaunes, orangés ou rosés.'],
      },
    ],
    wiki: WIKI + 'Sparassis_crispa',
  },
  {
    id: 'bolet-a-pied-rouge',
    name: 'Bolet à pied rouge',
    latin: 'Neoboletus erythropus',
    edibility: 'comestible',
    photo: 'neoboletus-erythropus',
    warning: 'Toxique cru : à consommer seulement bien cuit (au moins 15 à 20 min).',
    identification: [
      'Chapeau brun foncé, velouté.',
      'Pores rouges qui bleuissent instantanément au toucher.',
      'Pied jaune couvert de fines ponctuations rouges, SANS réseau.',
      'Chair jaune qui bleuit immédiatement et intensément à la coupe.',
    ],
    habitat: 'Sous les conifères et les feuillus, sur sols acides.',
    season: 'Juin à novembre.',
    tips: 'Un bolet à pores rouges dont le pied porte un RÉSEAU (et non des ponctuations) n’est pas un bolet à pied rouge : laisser aux connaisseurs.',
    confusions: [
      {
        with: 'bolet-satan',
        howToTell: [
          'Chapeau blanchâtre à gris pâle (pas brun foncé).',
          'Pied couvert d’un réseau, pas de ponctuations.',
          'Chair qui ne bleuit que modérément ; odeur désagréable en vieillissant ; sur sol calcaire.',
        ],
      },
      {
        with: 'bolet-blafard',
        howToTell: ['Pied couvert d’un réseau ; pores plutôt orangés.'],
      },
    ],
    wiki: WIKI + 'Neoboletus_erythropus',
  },
  {
    id: 'russule-charbonniere',
    name: 'Russule charbonnière',
    latin: 'Russula cyanoxantha',
    edibility: 'excellent',
    photo: 'russula-cyanoxantha',
    identification: [
      'Chapeau très variable : violet, bleu-gris, vert, souvent mêlés.',
      'Lames blanches, serrées, souples et grasses au toucher (lardacées) : on peut y passer le doigt sans les casser, ce qui est rare chez les russules.',
      'Pied blanc, parfois teinté de violet, qui casse net comme de la craie. Ni anneau, ni volve.',
      'Chair blanche, saveur douce.',
    ],
    habitat: 'Sous les feuillus (hêtres, chênes), aussi sous les conifères ; bois clairs.',
    season: 'Juin à novembre.',
    confusions: [
      {
        with: 'amanite-phalloide',
        howToTell: [
          'Anneau sous le chapeau et volve en sac à la base : toujours déterrer le pied entier, la volve reste souvent dans la terre.',
          'Chapeau vert olive, pied fibreux qui ne casse pas comme de la craie.',
        ],
      },
      {
        with: 'russules-acres',
        howToTell: ['Lames cassantes (elles s’effritent sous le doigt) ; chapeau souvent rouge vif.'],
      },
    ],
    wiki: WIKI + 'Russula_cyanoxantha',
  },
  {
    id: 'bolet-jaune',
    name: 'Bolet jaune (nonnette voilée)',
    latin: 'Suillus luteus',
    edibility: 'comestible',
    photo: 'suillus-luteus',
    warning: 'Plus ou moins laxatif selon les personnes : retirer la peau visqueuse du chapeau et commencer par de petites quantités.',
    identification: [
      'Chapeau brun chocolat, très visqueux (gluant) par temps humide ; la peau se pèle facilement.',
      'Pores jaunes, petits.',
      'Grand anneau membraneux sur le pied (blanchâtre à violacé).',
    ],
    habitat: 'Exclusivement sous les pins, en plaine comme en montagne.',
    season: 'Août à décembre.',
    tips: 'Prendre les jeunes exemplaires et retirer le pied.',
    confusions: [
      {
        with: 'bolets-visqueux',
        howToTell: ['Bolet granulé : pas d’anneau. Bolet élégant : chapeau jaune-orangé, sous les mélèzes.'],
      },
    ],
    noDangerousLookalike: true,
    wiki: WIKI + 'Suillus_luteus',
  },
]

export const ANSES_URL = 'https://www.anses.fr/fr/content/intoxications-liees-la-cueillette-de-champignons-restez-vigilants'
