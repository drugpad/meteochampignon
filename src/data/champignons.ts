// Fiches d'identification des champignons (page « Champignons »).
//
// Contenu recoupé le 06/10/2026 sur les fiches Wikipédia de chaque espèce
// (et de chaque sosie) et sur les recommandations de l'Anses pour la
// cueillette — sources affichées au bas de chaque fiche. Format volontairement
// court : un critère clé, une ligne par partie du champignon, les confusions
// en tableau face à face ; le texte long reste dans `details` (replié).
// Les tags suivent l'usage des guides français : « Comestible + » = réputé
// bon à excellent. Ne rien ajouter sans source : cette page sert à
// reconnaître, jamais à décider seul de manger (avertissement affiché).
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
  /** Nom court pour l'en-tête de colonne du tableau comparatif. */
  short: string
  latin: string
  edibility: Edibility
  photo?: PhotoId
  /** Ce qu'elle provoque, en une phrase. */
  danger: string
  wiki?: string
}

/** Ligne du tableau comparatif : [partie, l'espèce de la fiche, le sosie]. */
export type CompareRow = [string, string, string]

export type Confusion = {
  /** Clé de LOOKALIKES. */
  with: keyof typeof LOOKALIKES
  rows: CompareRow[]
  /** Remarque sous le tableau, si besoin. */
  note?: string
}

export type Trait = [string, string]

export type Species = {
  id: string
  name: string
  short: string
  latin: string
  edibility: Edibility
  /** Première = vue d'ensemble, puis les détails (dessous, pied, coupe…). */
  photos: { id: PhotoId; label: string }[]
  /** Le ou les signes qui tranchent. */
  key: string
  /** Précaution vitale, affichée en rouge. */
  warning?: string
  traits: Trait[]
  confusions: Confusion[]
  /** Quand aucun sosie dangereux n'est connu. */
  noDangerousLookalike?: boolean
  /** Texte complet, replié par défaut (« Plus de détails »). */
  details: string[]
  wiki: string
}

export function photoOf(id: PhotoId): Photo {
  return PHOTOS[id]
}

const WIKI = 'https://fr.wikipedia.org/wiki/'

export const LOOKALIKES = {
  gyromitre: {
    name: 'Gyromitre',
    short: 'Gyromitre',
    latin: 'Gyromitra esculenta',
    edibility: 'mortel',
    photo: 'gyromitra-esculenta',
    danger: 'Gyromitrine : intoxications parfois mortelles, même cuite, effet cumulatif. Vente interdite en France depuis 1991.',
    wiki: WIKI + 'Gyromitra_esculenta',
  },
  verpe: {
    name: 'Verpe de Bohême',
    short: 'Verpe',
    latin: 'Verpa bohemica',
    edibility: 'toxique',
    photo: 'verpa-bohemica',
    danger: 'Toxique crue ou mal cuite ; troubles digestifs et de coordination signalés même cuite.',
    wiki: WIKI + 'Verpa_bohemica',
  },
  'bolet-amer': {
    name: 'Bolet amer (bolet de fiel)',
    short: 'Bolet amer',
    latin: 'Tylopilus felleus',
    edibility: 'non-comestible',
    photo: 'tylopilus-felleus',
    danger: 'Pas dangereux, mais si amer qu’un seul exemplaire gâche tout le plat.',
    wiki: WIKI + 'Tylopilus_felleus',
  },
  'bolet-satan': {
    name: 'Bolet de Satan',
    short: 'B. de Satan',
    latin: 'Rubroboletus satanas',
    edibility: 'toxique',
    photo: 'rubroboletus-satanas',
    danger: 'Gastro-entérite violente (vomissements répétés), même cuit.',
    wiki: WIKI + 'Rubroboletus_satanas',
  },
  'fausse-girolle': {
    name: 'Fausse girolle',
    short: 'Fausse girolle',
    latin: 'Hygrophoropsis aurantiaca',
    edibility: 'non-comestible',
    photo: 'hygrophoropsis-aurantiaca',
    danger: 'Sans intérêt, comestibilité discutée : à laisser.',
    wiki: WIKI + 'Hygrophoropsis_aurantiaca',
  },
  'clitocybe-olivier': {
    name: 'Clitocybe de l’olivier',
    short: 'Clitocybe',
    latin: 'Omphalotus olearius',
    edibility: 'toxique',
    photo: 'omphalotus-olearius',
    danger: 'Troubles digestifs parfois sévères. Très commun dans le Midi.',
    wiki: WIKI + 'Omphalotus_olearius',
  },
  'cortinaires-mortels': {
    name: 'Cortinaire couleur de rocou, cortinaire très joli',
    short: 'Cortinaire',
    latin: 'Cortinarius orellanus, C. rubellus',
    edibility: 'mortel',
    photo: 'cortinarius-orellanus',
    danger: 'Détruit les reins. Premiers signes parfois plusieurs jours après le repas, quand il est trop tard.',
    wiki: WIKI + 'Cortinarius_orellanus',
  },
  'amanite-tue-mouches': {
    name: 'Amanite tue-mouches',
    short: 'Tue-mouches',
    latin: 'Amanita muscaria',
    edibility: 'toxique',
    photo: 'amanita-muscaria',
    danger: 'Confusion, agitation, somnolence ; très rarement mortelle.',
    wiki: WIKI + 'Amanita_muscaria',
  },
  'amanite-phalloide': {
    name: 'Amanite phalloïde',
    short: 'Phalloïde',
    latin: 'Amanita phalloides',
    edibility: 'mortel',
    photo: 'amanita-phalloides',
    danger: 'Première cause de décès par champignon : ~30 g peuvent tuer. Détruit le foie, symptômes retardés de plusieurs heures.',
    wiki: WIKI + 'Amanita_phalloides',
  },
  'petites-lepiotes': {
    name: 'Petites lépiotes (lépiote brun incarnat…)',
    short: 'Petite lépiote',
    latin: 'Lepiota brunneoincarnata, L. helveola…',
    edibility: 'mortel',
    photo: 'lepiota-brunneoincarnata',
    danger: 'Mêmes toxines que l’amanite phalloïde : intoxications mortelles.',
    wiki: WIKI + 'Lepiota_brunneoincarnata',
  },
  'lepiote-veneneuse': {
    name: 'Lépiote vénéneuse',
    short: 'L. vénéneuse',
    latin: 'Chlorophyllum brunneum',
    edibility: 'toxique',
    photo: 'chlorophyllum-brunneum',
    danger: 'Troubles digestifs.',
    wiki: WIKI + 'Chlorophyllum_brunneum',
  },
  'amanite-panthere': {
    name: 'Amanite panthère',
    short: 'Panthère',
    latin: 'Amanita pantherina',
    edibility: 'toxique',
    photo: 'amanita-pantherina',
    danger: 'Confusion, agitation, troubles de la conscience.',
    wiki: WIKI + 'Amanita_pantherina',
  },
  'lactaire-toison': {
    name: 'Lactaire à toison',
    short: 'L. à toison',
    latin: 'Lactarius torminosus',
    edibility: 'toxique',
    photo: 'lactarius-torminosus',
    danger: 'Très irritant pour le tube digestif.',
    wiki: WIKI + 'Lactarius_torminosus',
  },
  'lactaire-delicieux': {
    name: 'Lactaire délicieux',
    short: 'L. délicieux',
    latin: 'Lactarius deliciosus',
    edibility: 'comestible',
    photo: 'lactarius-deliciosus',
    danger: 'Aucun : confusion sans conséquence.',
  },
  'lactaire-sanguin': {
    name: 'Lactaire sanguin',
    short: 'L. sanguin',
    latin: 'Lactarius sanguifluus',
    edibility: 'excellent',
    photo: 'lactarius-sanguifluus',
    danger: 'Aucun : confusion sans conséquence.',
  },
  'tricholome-tigre': {
    name: 'Tricholome tigré',
    short: 'T. tigré',
    latin: 'Tricholoma pardinum',
    edibility: 'toxique',
    photo: 'tricholoma-pardinum',
    danger: 'L’un des tricholomes les plus toxiques : vomissements violents pendant plusieurs jours.',
    wiki: WIKI + 'Tricholoma_pardinum',
  },
  'tricholome-josserand': {
    name: 'Tricholome de Josserand',
    short: 'T. de Josserand',
    latin: 'Tricholoma josserandii',
    edibility: 'toxique',
    danger: 'Troubles digestifs.',
  },
  'tricholome-vergete': {
    name: 'Tricholome vergeté',
    short: 'T. vergeté',
    latin: 'Tricholoma virgatum',
    edibility: 'non-comestible',
    danger: 'Amer et âcre.',
  },
  'helvelle-lacuneuse': {
    name: 'Helvelle lacuneuse',
    short: 'Helvelle',
    latin: 'Helvella lacunosa',
    edibility: 'toxique',
    danger: 'Toxique crue ou mal cuite.',
  },
  'chanterelles-grises': {
    name: 'Chanterelle cendrée, chanterelle sinueuse',
    short: 'Ch. grises',
    latin: 'Craterellus cinereus, Pseudocraterellus undulatus',
    edibility: 'comestible',
    danger: 'Aucun : comestibles aussi.',
  },
  leotie: {
    name: 'Léotie lubrique',
    short: 'Léotie',
    latin: 'Leotia lubrica',
    edibility: 'non-comestible',
    danger: 'Suspecte, sans intérêt.',
  },
  'hydne-roussissant': {
    name: 'Hydne roussissant',
    short: 'H. roussissant',
    latin: 'Hydnum rufescens',
    edibility: 'comestible',
    danger: 'Aucun : comestible aussi.',
  },
  'bolets-rudes': {
    name: 'Autres bolets rudes (des chênes, des bouleaux…)',
    short: 'Autres rudes',
    latin: 'Leccinum aurantiacum, L. versipelle…',
    edibility: 'comestible',
    danger: 'Aucun s’ils sont bien cuits.',
  },
  'bolet-blafard': {
    name: 'Bolet blafard',
    short: 'B. blafard',
    latin: 'Suillellus luridus',
    edibility: 'comestible',
    danger: 'Comestible bien cuit seulement, proche de bolets toxiques : pour connaisseurs.',
  },
  'russules-acres': {
    name: 'Russules âcres (russule émétique…)',
    short: 'R. âcres',
    latin: 'Russula emetica…',
    edibility: 'toxique',
    danger: 'Vomissements.',
  },
  'bolets-visqueux': {
    name: 'Bolet granulé, bolet élégant',
    short: 'Autres Suillus',
    latin: 'Suillus granulatus, S. grevillei',
    edibility: 'comestible',
    danger: 'Aucun : mêmes précautions.',
  },
  ramaires: {
    name: 'Clavaires / ramaires',
    short: 'Ramaires',
    latin: 'Ramaria formosa…',
    edibility: 'toxique',
    danger: 'Plusieurs sont purgatives.',
  },
  'sparassis-brevipes': {
    name: 'Sparassis à pied court',
    short: 'S. pied court',
    latin: 'Sparassis brevipes',
    edibility: 'non-comestible',
    danger: 'Odeur désagréable : à laisser.',
  },
} satisfies Record<string, Lookalike>

// --- Morceaux partagés par plusieurs fiches -------------------------------

const MORILLE_CONFUSIONS: Confusion[] = [
  {
    with: 'gyromitre',
    rows: [
      ['Chapeau', 'alvéoles en nid d’abeille', 'circonvolutions de cerveau, brun-roux'],
      ['Coupée en long', 'creuse, une seule cavité', 'plusieurs chambres cloisonnées'],
    ],
  },
  {
    with: 'verpe',
    rows: [
      ['Attache du chapeau', 'soudé au pied tout autour', 'fixé seulement au sommet (doigt passe dessous)'],
      ['Pied', 'creux d’un seul tenant', 'rempli de moelle cotonneuse'],
    ],
  },
]

const MORILLE_WARNING = 'Toxique crue ou mal cuite : bien cuire, et pas de grosses quantités au même repas.'

const MORILLE_DETAILS = [
  'Cuisson : l’Anses recommande 20 à 30 min à la poêle pour tous les champignons sauvages.',
  'Même cuites, de grandes quantités au même repas ont provoqué des troubles neurologiques (vertiges, tremblements, troubles de la vue).',
]

const CEPE_CONFUSIONS: Confusion[] = [
  {
    with: 'bolet-amer',
    rows: [
      ['Pores', 'blancs → jaunes → olive', 'blancs → rose sale'],
      ['Réseau du pied', 'fin, clair', 'brun foncé, grossier'],
      ['Goût (cru, recraché)', 'doux', 'très amer'],
    ],
  },
  {
    with: 'bolet-satan',
    rows: [
      ['Chapeau', 'brun', 'blanchâtre à gris pâle'],
      ['Pores', 'blancs, jaunes ou olive', 'rouges à orangés'],
      ['Chair à la coupe', 'reste blanche', 'bleuit'],
    ],
    note: 'Été, sol calcaire, chênes : là où pousse aussi le cèpe d’été.',
  },
]

const CEPE_KEY = 'Chair blanche qui ne change pas à la coupe + pores jamais rouges ni roses + fin réseau clair sur le pied.'

export const SPECIES: Species[] = [
  {
    id: 'morille-commune',
    name: 'Morille commune',
    short: 'Morille',
    latin: 'Morchella esculenta',
    edibility: 'excellent',
    photos: [{ id: 'morchella-esculenta', label: 'Ensemble' }],
    key: 'Alvéoles en nid d’abeille + coupée en long, creuse d’une seule cavité du sommet à la base.',
    warning: MORILLE_WARNING,
    traits: [
      ['Chapeau', 'arrondi, jaune-ocre à beige, alvéoles irrégulières'],
      ['Attache', 'chapeau soudé au pied tout autour'],
      ['Pied', 'blanchâtre, granuleux, élargi à la base'],
      ['Intérieur', 'entièrement creux, une seule cavité'],
      ['Où', 'sols calcaires : frênes, ormes, vieux vergers, bords de rivières'],
      ['Quand', 'mars à mai'],
    ],
    confusions: MORILLE_CONFUSIONS,
    details: MORILLE_DETAILS,
    wiki: WIKI + 'Morchella_esculenta',
  },
  {
    id: 'morille-conique',
    name: 'Morille conique',
    short: 'Morille',
    latin: 'Morchella conica (groupe elata)',
    edibility: 'excellent',
    photos: [{ id: 'morchella-conica', label: 'Ensemble' }],
    key: 'Chapeau conique sombre à côtes verticales + creuse d’une seule cavité.',
    warning: MORILLE_WARNING,
    traits: [
      ['Chapeau', 'conique, pointu, gris-brun à presque noir'],
      ['Alvéoles', 'allongées entre des côtes verticales'],
      ['Attache', 'soudé au pied, parfois un petit sillon à la jonction'],
      ['Intérieur', 'entièrement creux, une seule cavité'],
      ['Où', 'montagne, conifères, places de feu, copeaux'],
      ['Quand', 'mars à juin (plus tard en altitude)'],
    ],
    confusions: MORILLE_CONFUSIONS,
    details: MORILLE_DETAILS,
    wiki: WIKI + 'Morchella_conica',
  },
  {
    id: 'cepe-de-bordeaux',
    name: 'Cèpe de Bordeaux',
    short: 'Cèpe',
    latin: 'Boletus edulis',
    edibility: 'excellent',
    photos: [
      { id: 'boletus-edulis', label: 'Ensemble' },
      { id: 'boletus-edulis--dessous', label: 'Pores' },
      { id: 'boletus-edulis--pied', label: 'Pied' },
      { id: 'boletus-edulis--coupe', label: 'Coupe' },
    ],
    key: CEPE_KEY,
    traits: [
      ['Chapeau', 'brun, fine marge plus claire, un peu gras'],
      ['Dessous', 'pores blancs → jaunâtres → vert olive'],
      ['Pied', 'ventru, fin réseau blanc en haut'],
      ['Chair', 'blanche, ferme, ne change pas'],
      ['Où', 'chênes, hêtres, châtaigniers, sapins, épicéas'],
      ['Quand', 'surtout sept.-oct., ~10 jours après de bonnes pluies'],
    ],
    confusions: CEPE_CONFUSIONS,
    details: ['Chair un peu rosée juste sous la peau du chapeau.', 'Les quatre cèpes (Bordeaux, bronzé, des pins, d’été) sont tous d’excellents comestibles : se tromper entre eux est sans conséquence.'],
    wiki: WIKI + 'Boletus_edulis',
  },
  {
    id: 'cepe-bronze',
    name: 'Cèpe bronzé',
    short: 'Cèpe',
    latin: 'Boletus aereus',
    edibility: 'excellent',
    photos: [
      { id: 'boletus-aereus', label: 'Ensemble' },
      { id: 'boletus-aereus--pied', label: 'Pied' },
      { id: 'boletus-aereus--coupe', label: 'Coupe' },
    ],
    key: CEPE_KEY,
    traits: [
      ['Chapeau', 'brun-noir à noirâtre, sec, velouté'],
      ['Dessous', 'pores blancs → jaunes → olive'],
      ['Pied', 'brun, trapu, réseau fin peu visible'],
      ['Chair', 'blanche, très ferme, ne change pas'],
      ['Où', 'chênes et châtaigniers, clairières chaudes, sol acide'],
      ['Quand', 'surtout l’été, 7 à 10 jours après des orages'],
    ],
    confusions: CEPE_CONFUSIONS,
    details: ['Espèce de chaleur, jusqu’à environ 1 100 m.'],
    wiki: WIKI + 'Boletus_aereus',
  },
  {
    id: 'cepe-des-pins',
    name: 'Cèpe des pins',
    short: 'Cèpe',
    latin: 'Boletus pinophilus',
    edibility: 'excellent',
    photos: [
      { id: 'boletus-pinophilus', label: 'Ensemble' },
      { id: 'boletus-pinophilus--dessous', label: 'Pores' },
      { id: 'boletus-pinophilus--pied', label: 'Pied' },
    ],
    key: CEPE_KEY,
    traits: [
      ['Chapeau', 'brun-rouge acajou, ridé, marge givrée jeune'],
      ['Dessous', 'pores blancs → jaunes → olive'],
      ['Pied', 'blanc rosé en haut, brun-rouille en bas, réseau blanc'],
      ['Chair', 'blanche, ferme, ne change pas'],
      ['Où', 'pins, aussi sapins, épicéas, hêtres, châtaigniers ; montagne'],
      ['Quand', 'mai à l’automne'],
    ],
    confusions: CEPE_CONFUSIONS,
    details: ['Chair un peu rosée sous la peau du chapeau.'],
    wiki: WIKI + 'Boletus_pinophilus',
  },
  {
    id: 'cepe-d-ete',
    name: 'Cèpe d’été',
    short: 'Cèpe',
    latin: 'Boletus reticulatus (= B. aestivalis)',
    edibility: 'excellent',
    photos: [
      { id: 'boletus-reticulatus', label: 'Ensemble' },
      { id: 'boletus-reticulatus--dessous', label: 'Pores' },
      { id: 'boletus-reticulatus--pied', label: 'Réseau' },
    ],
    key: CEPE_KEY + ' Ici, réseau sur TOUT le pied.',
    traits: [
      ['Chapeau', 'brun clair noisette, velouté, craquelé par temps sec'],
      ['Dessous', 'pores blancs → jaunes → olive'],
      ['Pied', 'réseau marqué jusqu’à la base'],
      ['Chair', 'blanche, plus tendre, ne change pas ; souvent véreux'],
      ['Où', 'chênes surtout, hêtres, châtaigniers, lisières'],
      ['Quand', 'mai à octobre, pic en juillet'],
    ],
    confusions: CEPE_CONFUSIONS,
    details: ['Aime la chaleur ; seconde poussée en octobre.'],
    wiki: WIKI + 'Boletus_reticulatus',
  },
  {
    id: 'girolle',
    name: 'Girolle',
    short: 'Girolle',
    latin: 'Cantharellus cibarius',
    edibility: 'excellent',
    photos: [
      { id: 'cantharellus-cibarius', label: 'Ensemble' },
      { id: 'cantharellus-cibarius--dessous', label: 'Plis' },
      { id: 'cantharellus-cibarius--pied', label: 'Profil' },
    ],
    key: 'Pas de vraies lames : des plis épais, fourchus, qui descendent sur le pied. Pousse sur la terre, jamais sur le bois.',
    traits: [
      ['Chapeau', 'jaune d’œuf, irrégulier, en entonnoir'],
      ['Dessous', 'plis épais, peu profonds, reliés entre eux'],
      ['Chair', 'blanche à jaunâtre, ferme, se déchire en long'],
      ['Odeur', 'fruitée (abricot)'],
      ['Où', 'feuillus et conifères, sol acide, mousse'],
      ['Quand', 'juin à novembre'],
    ],
    confusions: [
      {
        with: 'fausse-girolle',
        rows: [
          ['Dessous', 'plis épais', 'vraies lames fines et serrées'],
          ['Couleur', 'jaune d’œuf', 'orange vif'],
          ['Chair', 'ferme', 'mince et molle'],
        ],
      },
      {
        with: 'clitocybe-olivier',
        rows: [
          ['Dessous', 'plis épais', 'vraies lames'],
          ['Pousse', 'sur la terre', 'en touffes, sur bois ou souches'],
        ],
      },
      {
        with: 'cortinaires-mortels',
        rows: [
          ['Dessous', 'plis jaunes', 'vraies lames fauves puis rouille'],
          ['Jeune', '—', 'voile en toile d’araignée sous le chapeau'],
        ],
      },
    ],
    details: [],
    wiki: WIKI + 'Cantharellus_cibarius',
  },
  {
    id: 'bolet-orange-des-peupliers',
    name: 'Bolet orangé des peupliers',
    short: 'B. orangé',
    latin: 'Leccinum albostipitatum',
    edibility: 'comestible',
    photos: [
      { id: 'leccinum-albostipitatum', label: 'Ensemble' },
      { id: 'leccinum-albostipitatum--pied', label: 'Pied' },
    ],
    key: 'Chapeau orange + pied blanc hérissé de mèches qui noircissent, sous les peupliers.',
    warning: 'Toxique cru ou mal cuit : toujours bien cuire.',
    traits: [
      ['Chapeau', 'orange vif puis terne, 4 à 20 cm'],
      ['Dessous', 'pores blanchâtres puis gris-beige'],
      ['Pied', 'haut, blanc, mèches blanches qui roussissent puis noircissent'],
      ['Chair', 'blanche, rosit puis noircit à la coupe (normal)'],
      ['Où', 'uniquement sous peupliers, surtout trembles'],
      ['Quand', 'été et automne'],
    ],
    confusions: [
      {
        with: 'bolets-rudes',
        rows: [['Mèches du pied', 'blanches au début', 'rousses (chênes) ou noires (bouleaux)']],
      },
    ],
    noDangerousLookalike: true,
    details: ['Le pied, fibreux, est souvent écarté.'],
    wiki: WIKI + 'Leccinum_albostipitatum',
  },
  {
    id: 'tricholome-pretentieux',
    name: 'Tricholome prétentieux',
    short: 'Prétentieux',
    latin: 'Tricholoma portentosum',
    edibility: 'excellent',
    photos: [
      { id: 'tricholoma-portentosum', label: 'Ensemble' },
      { id: 'tricholoma-portentosum--chapeau', label: 'Chapeau' },
      { id: 'tricholoma-portentosum--dessous', label: 'Lames' },
      { id: 'tricholoma-portentosum--coupe', label: 'Coupe' },
    ],
    key: 'Chapeau gris à fibrilles noires dont la peau se pèle + reflets jaunes sur les lames et le pied.',
    traits: [
      ['Chapeau', 'gris à gris-noir, fibrilles noires rayonnantes, visqueux humide'],
      ['Dessous', 'lames blanches à reflets jaunes'],
      ['Pied', 'blanc teinté de jaune pâle ; ni anneau ni volve'],
      ['Odeur', 'farine'],
      ['Où', 'pinèdes (pin sylvestre), en troupes'],
      ['Quand', 'oct. à déc., souvent après les premières gelées'],
    ],
    confusions: [
      {
        with: 'tricholome-tigre',
        rows: [
          ['Chapeau', 'fibrilles rayonnantes', 'petites écailles en cercles'],
          ['Reflets jaunes', 'oui', 'non'],
          ['Où', 'pins', 'calcaire, montagne, hêtres et sapins'],
        ],
      },
      {
        with: 'tricholome-josserand',
        rows: [
          ['Reflets jaunes', 'oui', 'non'],
          ['Chapeau', 'fibrilles, peau qui se pèle', 'lisse, ne se pèle pas'],
          ['Odeur', 'farine', 'farine rance'],
        ],
      },
      {
        with: 'tricholome-vergete',
        rows: [
          ['Chapeau', 'mamelonné', 'conique, pointu'],
          ['Reflets jaunes', 'oui', 'non'],
          ['Goût', 'doux', 'amer, âcre'],
        ],
      },
      {
        with: 'amanite-phalloide',
        rows: [
          ['Chapeau', 'gris à fibrilles noires', 'vert olive'],
          ['Pied', 'ni anneau ni volve', 'anneau + volve en sac à la base'],
        ],
        note: 'Toujours déterrer le pied entier : la volve reste souvent dans la terre.',
      },
    ],
    details: [],
    wiki: WIKI + 'Tricholoma_portentosum',
  },
  {
    id: 'oronge',
    name: 'Oronge',
    short: 'Oronge',
    latin: 'Amanita caesarea',
    edibility: 'excellent',
    photos: [
      { id: 'amanita-caesarea', label: 'Ensemble' },
      { id: 'amanita-caesarea--dessous', label: 'Lames' },
      { id: 'amanita-caesarea--pied', label: 'Pied et volve' },
      { id: 'amanita-caesarea--oeuf', label: 'Œuf coupé' },
    ],
    key: 'Lames JAUNES + pied JAUNE + volve BLANCHE en sac : combinaison unique chez les amanites d’Europe.',
    warning: 'Jamais d’« œufs » fermés : à ce stade, elle peut être confondue avec l’amanite phalloïde, mortelle.',
    traits: [
      ['Chapeau', 'orange vif à rouge-orangé, lisse, marge striée'],
      ['Dessous', 'lames jaunes'],
      ['Pied', 'jaune, anneau jaune'],
      ['Base', 'grande volve blanche en sac'],
      ['Où', 'chênes et châtaigniers, bois clairs chauds'],
      ['Quand', 'juillet à octobre, après les orages'],
    ],
    confusions: [
      {
        with: 'amanite-tue-mouches',
        rows: [
          ['Lames et pied', 'jaunes', 'BLANCS'],
          ['Chapeau', 'lisse', 'flocons blancs (la pluie peut les laver)'],
          ['Base', 'volve en sac', 'bourrelets'],
        ],
      },
      {
        with: 'amanite-phalloide',
        rows: [
          ['Œuf coupé en long', 'chapeau orange, lames jaunes', 'tout blanc ou verdâtre'],
          ['Adulte', 'orange, lames jaunes', 'vert olive, lames blanches'],
        ],
      },
    ],
    details: [],
    wiki: WIKI + 'Amanita_caesarea',
  },
  {
    id: 'trompette-de-la-mort',
    name: 'Trompette de la mort',
    short: 'Trompette',
    latin: 'Craterellus cornucopioides',
    edibility: 'excellent',
    photos: [
      { id: 'craterellus-cornucopioides', label: 'Ensemble' },
      { id: 'craterellus-cornucopioides--profil', label: 'Extérieur' },
    ],
    key: 'Trompette noire creuse jusqu’à la base, extérieur gris presque lisse.',
    traits: [
      ['Forme', 'trompette, creuse jusqu’en bas'],
      ['Intérieur', 'gris-brun à noir'],
      ['Extérieur', 'gris cendré, lisse ou à peine ridé'],
      ['Chair', 'très mince, élastique'],
      ['Où', 'hêtres, chênes, châtaigniers ; sol argileux humide, coins sombres'],
      ['Quand', 'août à novembre'],
    ],
    confusions: [
      {
        with: 'chanterelles-grises',
        rows: [['Extérieur', 'presque lisse', 'plis bien visibles']],
      },
      {
        with: 'helvelle-lacuneuse',
        rows: [['Forme', 'trompette creuse', 'chapeau en selle tourmentée sur pied côtelé']],
      },
    ],
    noDangerousLookalike: true,
    details: ['Pousse en troupes serrées dans les feuilles mortes.'],
    wiki: WIKI + 'Craterellus_cornucopioides',
  },
  {
    id: 'pied-de-mouton',
    name: 'Pied-de-mouton',
    short: 'Pied-de-mouton',
    latin: 'Hydnum repandum',
    edibility: 'excellent',
    photos: [
      { id: 'hydnum-repandum', label: 'Ensemble' },
      { id: 'hydnum-repandum--dessous', label: 'Aiguillons' },
      { id: 'hydnum-repandum--pied', label: 'Dessous' },
    ],
    key: 'Sous le chapeau : des aiguillons (petits picots), ni lames ni pores.',
    traits: [
      ['Chapeau', 'crème à orangé pâle, épais, irrégulier'],
      ['Dessous', 'aiguillons de 3-6 mm, crème, se détachent facilement'],
      ['Pied', 'blanc, court, épais, souvent décentré'],
      ['Chair', 'blanche, ferme, cassante'],
      ['Où', 'feuillus et conifères, souvent calcaire, en cercles'],
      ['Quand', 'août à décembre'],
    ],
    confusions: [
      {
        with: 'hydne-roussissant',
        rows: [
          ['Taille', 'trapu', 'plus petit, plus fin'],
          ['Aiguillons', 'descendent sur le pied', 'ne descendent pas'],
        ],
      },
    ],
    noDangerousLookalike: true,
    details: ['Les vieux deviennent amers : prendre les jeunes, on peut gratter les aiguillons.'],
    wiki: WIKI + 'Hydnum_repandum',
  },
  {
    id: 'bolet-bai',
    name: 'Bolet bai',
    short: 'Bolet bai',
    latin: 'Imleria badia',
    edibility: 'excellent',
    photos: [
      { id: 'imleria-badia', label: 'Ensemble' },
      { id: 'imleria-badia--dessous', label: 'Pores bleuis' },
      { id: 'imleria-badia--pied', label: 'Pied' },
    ],
    key: 'Chapeau marron acajou + pores jaunes qui bleuissent au toucher + pied SANS réseau.',
    traits: [
      ['Chapeau', 'brun bai, velouté sec, gluant humide'],
      ['Dessous', 'pores jaunes à vert-jaune, bleuissent nettement'],
      ['Pied', 'brun, strié, sans réseau'],
      ['Chair', 'blanc-jaunâtre, bleuit un peu'],
      ['Où', 'conifères surtout, sol acide, mousse'],
      ['Quand', 'été à début d’hiver'],
    ],
    confusions: [
      {
        with: 'bolet-amer',
        rows: [
          ['Pores', 'jaunes, bleuissent', 'blancs → rose sale'],
          ['Pied', 'sans réseau', 'réseau brun foncé'],
        ],
      },
    ],
    noDangerousLookalike: true,
    details: ['Le bleuissement est normal chez cette espèce. Retirer le pied s’il est fibreux.'],
    wiki: WIKI + 'Imleria_badia',
  },
  {
    id: 'lepiote-elevee',
    name: 'Lépiote élevée (coulemelle)',
    short: 'Coulemelle',
    latin: 'Macrolepiota procera',
    edibility: 'excellent',
    photos: [
      { id: 'macrolepiota-procera', label: 'Ensemble' },
      { id: 'macrolepiota-procera--anneau', label: 'Anneau' },
      { id: 'macrolepiota-procera--pied', label: 'Pied chiné' },
      { id: 'macrolepiota-procera--dessous', label: 'Lames' },
    ],
    key: 'Grand chapeau (plus de 10 cm) + anneau double qui coulisse + pied chiné comme une peau de serpent.',
    warning: 'Jamais de lépiote de moins de 10 cm : plusieurs petites lépiotes sont mortelles.',
    traits: [
      ['Chapeau', '10 à 25 cm, mamelon brun, écailles brunes sur fond crème'],
      ['Dessous', 'lames blanches, libres'],
      ['Pied', 'très haut, bulbeux, chiné de brun'],
      ['Anneau', 'double, épais, coulissant ; pas de volve'],
      ['Où', 'prairies, lisières, clairières'],
      ['Quand', 'juillet à novembre'],
    ],
    confusions: [
      {
        with: 'petites-lepiotes',
        rows: [
          ['Chapeau', 'plus de 10 cm', 'moins de 10 cm, souvent rosé'],
          ['Anneau', 'double, coulisse', 'fin, fixe'],
        ],
      },
      {
        with: 'lepiote-veneneuse',
        rows: [
          ['Pied', 'chiné, plus long que le chapeau est large', 'lisse, plus court'],
          ['Chair grattée', 'ne change pas', 'rougit fortement'],
        ],
        note: 'Souvent près des composts et dans les jardins.',
      },
      {
        with: 'amanite-panthere',
        rows: [
          ['Pied', 'chiné', 'blanc lisse, bourrelet à la base'],
          ['Chapeau', 'écailles brunes', 'brun à verrues blanches'],
        ],
      },
    ],
    details: ['Seul le chapeau se mange : le pied est trop fibreux.'],
    wiki: WIKI + 'Macrolepiota_procera',
  },
  {
    id: 'lactaire-delicieux',
    name: 'Lactaire délicieux',
    short: 'L. délicieux',
    latin: 'Lactarius deliciosus',
    edibility: 'comestible',
    photos: [
      { id: 'lactarius-deliciosus', label: 'Ensemble' },
      { id: 'lactarius-deliciosus--dessous', label: 'Lames et lait' },
      { id: 'lactarius-deliciosus--lait', label: 'Lait qui rougit' },
    ],
    key: 'Cassé, il laisse couler un lait ORANGE CAROTTE. Sous les pins.',
    traits: [
      ['Chapeau', 'orange carotte, cercles plus foncés, taché de vert'],
      ['Dessous', 'lames orange'],
      ['Lait', 'orange carotte, rougit très lentement'],
      ['Pied', 'orange, creux, petites fossettes'],
      ['Où', 'exclusivement sous les pins'],
      ['Quand', 'septembre à novembre'],
    ],
    confusions: [
      {
        with: 'lactaire-toison',
        rows: [
          ['Lait', 'orange', 'BLANC'],
          ['Chapeau', 'orange, zoné', 'rose saumon, marge laineuse'],
          ['Où', 'pins', 'bouleaux'],
        ],
      },
      { with: 'lactaire-sanguin', rows: [['Lait', 'orange carotte', 'rouge vin dès la cassure']] },
    ],
    details: ['Verdit en vieillissant ou au froissement.', 'Colore l’urine en rouge : sans danger.'],
    wiki: WIKI + 'Lactarius_deliciosus',
  },
  {
    id: 'lactaire-sanguin',
    name: 'Lactaire sanguin',
    short: 'L. sanguin',
    latin: 'Lactarius sanguifluus',
    edibility: 'excellent',
    photos: [
      { id: 'lactarius-sanguifluus', label: 'Ensemble' },
      { id: 'lactarius-sanguifluus--dessous', label: 'Lames' },
      { id: 'lactarius-sanguifluus--lait', label: 'Lait' },
    ],
    key: 'Cassé, il laisse couler un lait ROUGE VIN dès la cassure. Sous les pins, sur calcaire.',
    traits: [
      ['Chapeau', 'orange terne à rose-vineux, taché de vert'],
      ['Lait', 'rouge vineux immédiatement'],
      ['Pied', 'court, trapu, petites fossettes'],
      ['Où', 'pins, sol calcaire'],
      ['Quand', 'septembre à novembre'],
    ],
    confusions: [
      { with: 'lactaire-delicieux', rows: [['Lait', 'rouge vin', 'orange carotte']] },
      {
        with: 'lactaire-toison',
        rows: [
          ['Lait', 'rouge vin', 'BLANC'],
          ['Où', 'pins', 'bouleaux'],
        ],
      },
    ],
    details: ['Souvent considéré comme le meilleur des lactaires.', 'Colore l’urine en rouge : sans danger.'],
    wiki: WIKI + 'Lactarius_sanguifluus',
  },
  {
    id: 'chanterelle-en-tube',
    name: 'Chanterelle en tube',
    short: 'Ch. en tube',
    latin: 'Craterellus tubaeformis',
    edibility: 'excellent',
    photos: [
      { id: 'craterellus-tubaeformis', label: 'Ensemble' },
      { id: 'craterellus-tubaeformis--dessous', label: 'Plis' },
    ],
    key: 'Chapeau brun percé au centre + plis (pas de lames) + pied jaune creux.',
    traits: [
      ['Chapeau', 'brun-gris, 3 à 7 cm, entonnoir percé'],
      ['Dessous', 'plis gris-jaunâtre, fourchus'],
      ['Pied', 'jaune, creux, souple, aplati'],
      ['Où', 'mousse, bois très humides, près du bois pourri'],
      ['Quand', 'mi-automne aux premières gelées'],
    ],
    confusions: [
      {
        with: 'cortinaires-mortels',
        rows: [
          ['Dessous', 'plis', 'vraies lames fauves puis rouille'],
          ['Pied', 'creux', 'plein'],
        ],
        note: 'Ne jamais ramasser en vrac : vérifier chaque exemplaire.',
      },
      { with: 'leotie', rows: [['Tête', 'chapeau à plis', 'petite tête gélatineuse sans plis']] },
    ],
    details: ['Pousse en troupes nombreuses.'],
    wiki: WIKI + 'Craterellus_tubaeformis',
  },
  {
    id: 'sparassis-crepu',
    name: 'Sparassis crépu',
    short: 'Sparassis',
    latin: 'Sparassis crispa',
    edibility: 'comestible',
    photos: [
      { id: 'sparassis-crispa', label: 'Ensemble' },
      { id: 'sparassis-crispa--detail', label: 'Lames frisées' },
      { id: 'sparassis-crispa--base', label: 'Sur souche' },
    ],
    key: 'Grosse boule en chou-fleur faite de lames plates et frisées, au pied des pins.',
    traits: [
      ['Forme', 'boule de 10 à 40 cm, lames aplaties, ondulées'],
      ['Couleur', 'crème à beige, brunit avec l’âge'],
      ['Où', 'pied ou souche de conifères, surtout pins ; revient au même endroit'],
      ['Quand', 'septembre à novembre'],
    ],
    confusions: [
      { with: 'sparassis-brevipes', rows: [['Odeur', 'agréable', 'Javel ou urine']] },
      { with: 'ramaires', rows: [['Forme', 'lames plates frisées', 'rameaux cylindriques dressés']] },
    ],
    details: ['Ne prendre que les jeunes (les vieux sont coriaces) et bien nettoyer terre et aiguilles.'],
    wiki: WIKI + 'Sparassis_crispa',
  },
  {
    id: 'bolet-a-pied-rouge',
    name: 'Bolet à pied rouge',
    short: 'Pied rouge',
    latin: 'Neoboletus erythropus',
    edibility: 'comestible',
    photos: [
      { id: 'neoboletus-erythropus', label: 'Ensemble' },
      { id: 'neoboletus-erythropus--dessous', label: 'Pores et pied' },
      { id: 'neoboletus-erythropus--coupe', label: 'Bleuissement' },
    ],
    key: 'Chapeau brun foncé + pores rouges + pied ponctué de rouge SANS réseau + chair qui bleuit aussitôt.',
    warning: 'Toxique cru : au moins 15 à 20 min de cuisson.',
    traits: [
      ['Chapeau', 'brun foncé, velouté'],
      ['Dessous', 'pores rouges, bleuissent au toucher'],
      ['Pied', 'jaune ponctué de rouge, sans réseau'],
      ['Chair', 'jaune, bleuit immédiatement et fort'],
      ['Où', 'conifères et feuillus, sol acide'],
      ['Quand', 'juin à novembre'],
    ],
    confusions: [
      {
        with: 'bolet-satan',
        rows: [
          ['Chapeau', 'brun foncé', 'blanchâtre'],
          ['Pied', 'ponctuations', 'réseau'],
          ['Sol', 'acide', 'calcaire'],
        ],
      },
      { with: 'bolet-blafard', rows: [['Pied', 'ponctuations', 'réseau']] },
    ],
    details: ['Pores rouges + pied à RÉSEAU : ce n’est pas lui, laisser aux connaisseurs.'],
    wiki: WIKI + 'Neoboletus_erythropus',
  },
  {
    id: 'russule-charbonniere',
    name: 'Russule charbonnière',
    short: 'Charbonnière',
    latin: 'Russula cyanoxantha',
    edibility: 'excellent',
    photos: [
      { id: 'russula-cyanoxantha', label: 'Ensemble' },
      { id: 'russula-cyanoxantha--dessous', label: 'Lames' },
    ],
    key: 'Lames souples et grasses au toucher (elles ne cassent pas) + pied qui casse net comme de la craie.',
    traits: [
      ['Chapeau', 'violet, bleu-gris, vert, souvent mêlés'],
      ['Dessous', 'lames blanches, serrées, souples (lardacées)'],
      ['Pied', 'blanc, cassant ; ni anneau ni volve'],
      ['Chair', 'blanche, saveur douce'],
      ['Où', 'hêtres, chênes, aussi conifères'],
      ['Quand', 'juin à novembre'],
    ],
    confusions: [
      {
        with: 'amanite-phalloide',
        rows: [
          ['Pied', 'ni anneau ni volve, casse comme de la craie', 'anneau + volve en sac, fibreux'],
          ['Chapeau', 'violet-vert mêlé', 'vert olive uniforme'],
        ],
        note: 'Toujours déterrer le pied entier.',
      },
      { with: 'russules-acres', rows: [['Lames', 'souples', 'cassantes (s’effritent)']] },
    ],
    details: [],
    wiki: WIKI + 'Russula_cyanoxantha',
  },
  {
    id: 'bolet-jaune',
    name: 'Bolet jaune (nonnette voilée)',
    short: 'Bolet jaune',
    latin: 'Suillus luteus',
    edibility: 'comestible',
    photos: [
      { id: 'suillus-luteus', label: 'Ensemble' },
      { id: 'suillus-luteus--dessous', label: 'Pores et anneau' },
      { id: 'suillus-luteus--pied', label: 'Pied' },
    ],
    key: 'Chapeau brun gluant + pores jaunes + grand anneau sur le pied. Sous les pins.',
    warning: 'Laxatif chez certains : retirer la peau gluante, commencer petit.',
    traits: [
      ['Chapeau', 'brun chocolat, très gluant, peau qui se pèle'],
      ['Dessous', 'pores jaunes, petits'],
      ['Pied', 'grand anneau membraneux'],
      ['Où', 'exclusivement sous les pins'],
      ['Quand', 'août à décembre'],
    ],
    confusions: [
      {
        with: 'bolets-visqueux',
        rows: [['Anneau', 'oui', 'non (granulé) ; sous mélèzes (élégant)']],
      },
    ],
    noDangerousLookalike: true,
    details: ['Prendre les jeunes et retirer le pied.'],
    wiki: WIKI + 'Suillus_luteus',
  },
]

export const ANSES_URL = 'https://www.anses.fr/fr/content/intoxications-liees-la-cueillette-de-champignons-restez-vigilants'
