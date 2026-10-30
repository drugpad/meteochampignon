"""Classe de « réaction du sol » d'une formation géologique (BRGM BD Charm-50), d'après son libellé (DESCR).

Le libellé est un texte libre ; on le range dans une classe par mots-clés, dans cet ordre de priorité :
  - DECALC : formations décalcifiées sur calcaire (argiles à silex, à chailles, sidérolithique, limons décarbonatés…) :
    sol ACIDE malgré le calcaire dessous — c'est là que poussent châtaigniers et cèpes de Bordeaux sur les causses ;
  - CALC   : roches carbonatées (calcaire, dolomie, craie, travertin, tuf calcaire) : sol basique ;
  - MARL   : marnes, molasses, argiles calcaires, flysch carbonaté : sol neutre à basique, lourd ;
  - ACID   : roches siliceuses (granite, gneiss, schistes, grès, quartzites, sables, arènes, rhyolites…) : sol acide ;
  - BASIC  : roches volcaniques ou métamorphiques basiques (basalte, amphibolite, serpentine…) : sol riche, neutre ;
  - ALLUV  : alluvions, colluvions, limons, éboulis non précisés : variable (pH estimé par SoilGrids).
Valeur de pH « typique » de l'horizon de surface forestier (pour corriger le pH SoilGrids, trop lissé à 250 m) :
fourchettes courantes des guides de stations forestières (CNPF/IDF, ONF) ; à affiner par les observations.
"""
import re
import unicodedata

CLASSES = ["NONE", "ACID", "DECALC", "ALLUV", "MARL", "BASIC", "CALC"]
TYPICAL_PH = {"ACID": 4.6, "DECALC": 5.0, "ALLUV": None, "MARL": 7.0, "BASIC": 6.3, "CALC": 7.6}


def _norm(s):
    s = unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", s)


DECALC = r"silex|chaille|remplissage des dolines|siderolith|decalcifi|decarbonat|argiles? (rouges? )?a (silex|chailles)|terra rossa|argiles? de decalcification|formations? residuelles?|argiles? residuelles?|altérites? sur calcaire|alterites? (de|sur|des) calcaires?"
CALC = r"calcaire|dolomi|craie|travertin|tuf calcaire|calcschiste|cargneule|marbre|lumachelle|oolith"
MARL = r"marne|marneu|molasse|argiles? calcaires?|flysch|calcareni|gres calcaire|sables? calcaires?|argiles? (a|et) (gypse|evaporites)|gypse|lacustre|lehm"
ACID = r"granit|gneiss|micaschiste|schiste|phyllade|quartzite|quartz|gres|sable|arene|rhyolit|migmatit|leucogranit|granodiorit|diorite|pegmatit|aplite|ardoise|pelite|grauwacke|conglomerat|poudingue|tonalit|orthogneiss|paragneiss|silt|argilite|corneenne|lydienne|tourbe|porphyro|leucocrate|diatexite|ectinite|leptynite|granitoide|anatexi|metagranit|monzogranit|syenogranit|rhyodacit|tuf volcanique acide"
BASIC = r"basalt|amphibolit|serpentin|gabbro|dolerit|ophite|peridotit|lherzolit|volcan|trachyt|andesit|spilite"
ALLUV = r"alluvion|colluvion|limon|eboulis|moraine|glaciaire|fluvio|terrasse|cone de dejection|depots? de pente|solifluxion|loess|anthropique|remblai|eau"


def classify(descr):
    d = _norm(descr)
    if re.search(DECALC, d):
        return "DECALC"
    calc = bool(re.search(CALC, d))
    marl = bool(re.search(MARL, d))
    acid = bool(re.search(ACID, d))
    if re.search(ALLUV, d) and not re.search(r"^(granit|gneiss|schiste|calcaire|marne|gres)", d):
        # Dépôts meubles (alluvions « sables et graviers », colluvions…) : nature selon l'origine, souvent mêlée.
        return "MARL" if calc else "ALLUV"
    if calc and not acid:
        return "CALC"
    if marl:
        return "MARL"
    if calc and acid:
        # « grès calcaires », « schistes et calcaires » : mélange, le carbonate tamponne le sol.
        return "MARL"
    if re.search(BASIC, d):
        return "BASIC"
    if acid:
        return "ACID"
    if re.search(ALLUV, d):
        return "ALLUV"
    return "ALLUV"
