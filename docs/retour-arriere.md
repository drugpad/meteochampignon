# Retour arrière : tout ce qui a été changé du 03 au 05/10/2026, et comment le défaire

Quatre « couches » **indépendantes**. Vous pouvez en défaire une sans toucher aux
autres. Dites-moi laquelle et je m'en occupe, ou suivez les commandes ci-dessous.

| Couche | Ce que c'est | Risque de la défaire |
|---|---|---|
| 1. Dépôt GitHub | code, workflows, cartes AROME, collecte des stations | retour de l'ancienne grille Open-Meteo (hors quota) |
| 2. Comptes et jetons | clé Météo-France, abonnement Paquet, jeton GitHub | aucun |
| 3. Home Assistant | paquet, tableau de bord, scripts Python, 2 clés dans `secrets.yaml` | aucun, tout est supprimable |
| 4. Votre PC | paquets Python d'essai, `.env.local` | aucun |

> **Règle d'or pour le dépôt** : ne jamais forcer un push sur `master` (des
> commits automatiques y arrivent plusieurs fois par jour). On annule avec
> `git revert` (qui ajoute un commit d'annulation), pas avec `reset --hard` ni
> `push --force`. Toujours `git pull --rebase` avant `git push`.

---

## Couche 1 : dépôt GitHub

**Point de départ avant tout cela : le commit `a065312`** (« Decale le cron de
rain-forecast-grid.yml ») : ancienne architecture, avec les grilles de pluie
interrogées sur l'API Open-Meteo.

### Les commits, du plus ancien au plus récent

| Commit | Contenu |
|---|---|
| `e07863c` | bouton « Voir la station sur Météociel » |
| `976f5b2` | job des stations toutes les heures + rattrapage manuel |
| `b4a1b7c` | messages « historique incomplet » sur les stations |
| `bbbc5ea` | correctifs : fuseau horaire des cartes, recherche, jours à l'heure de Paris |
| `22d192b` | données : 23 h d'historique des stations récupérées |
| `c683271` | stations via l'API « Paquet Observations », job auto-réparant |
| `e8bd281`, `ddbd5f3` | **cartes de pluie AROME 1,5 km** (nouveau générateur Python, branche `data`, suppression des anciennes grilles) |
| `bb3a4cb` | message d'erreur des cartes lisible, `ubuntu-24.04`, actions en v6 |
| `f31aa88` | prévision ponctuelle par modèle, 7 jours (AIFS), rattrapage profond, alertes de retard |
| `22ad448`, `6e26c36` | paquet et tableau de bord Home Assistant, guides |
| `2f546f8` | collecte des stations par Home Assistant |

### Voir ce que ça changerait avant de décider

```powershell
git fetch
git diff a065312 origin/master --stat       # tous les fichiers différents de l'ancienne version
git show <commit>                            # le détail d'un commit
```

### Défaire UN commit (le plus sûr)

```powershell
git pull --rebase
git revert <commit>          # crée un commit d'annulation
git push
```

Les commits sont liés : défaire `ddbd5f3` seul peut laisser le code incohérent
(les commits suivants modifient les mêmes fichiers). Défaites-les **du plus
récent au plus ancien**, ou demandez-moi.

### Voir l'ancienne version sans rien changer

```powershell
git checkout -b essai-retour a065312         # branche de test, master intact
git push -u origin essai-retour              # Vercel crée une page de prévisualisation
git checkout master                          # revenir
```

### Revenir à l'ancienne carte de pluie : à éviter, et pourquoi

L'ancienne grille consommait **12 000 à 18 000 appels par jour** à Open-Meteo
pour une limite gratuite de 10 000 : hors règle, avec un risque de blocage « sans
préavis ». Elle était aussi moins précise (3,3 km contre 1,5 km). Si vous le
voulez quand même, l'ancienne carte et le nouveau code d'interface sont liés :
**demandez-le-moi plutôt que de restaurer des fichiers à la main**.

### Arrêter des traitements sans rien supprimer

```powershell
gh workflow disable maps.yml                    # arrête les cartes
gh workflow disable station-history.yml         # arrête la collecte GitHub des stations
gh workflow enable maps.yml                     # les remet en marche
```

### La branche `data`

Elle contient uniquement les cartes publiées, écrasées à chaque génération.
Ne la supprimez que si l'application ne la lit plus :

```powershell
git push origin --delete data
```

---

## Couche 2 : comptes et jetons

| Élément | Où il se défait |
|---|---|
| Secret GitHub `METEOFRANCE_API_TOKEN` (posé le 04/10) | `gh secret delete METEOFRANCE_API_TOKEN` (les collectes s'arrêtent alors). L'**ancienne** clé n'a pas été sauvegardée : la nouvelle fonctionne partout, il n'y a rien à restaurer |
| Abonnement « Paquet Observations » | portail Météo-France > l'API > Se désabonner |
| Jeton GitHub `home-assistant-meteochampignon` | <https://github.com/settings/personal-access-tokens> > le jeton > **Delete** |
| Variable Vercel `VITE_METEOFRANCE_API_TOKEN` | à **supprimer** (inutilisée) : *Settings* > *Environment Variables* |

---

## Couche 3 : Home Assistant

### Ce qui a été ajouté ou modifié

| Fichier | Nature |
|---|---|
| `packages/meteochampignon.yaml` | **ajouté** |
| `dashboards/meteochampignon.yaml` | **ajouté** |
| `meteochampignon/stations.py`, `maps.py`, `install_deps.py`, `check_env.py`, `build_rain_maps.py` | **ajoutés** |
| `meteochampignon/pydeps/` (créé seulement si vous cliquez « Installer les dépendances ») | **paquets des cartes**, à part du Python de Home Assistant : supprimer le dossier suffit |
| `meteochampignon/maps-out/`, `*.log`, `*-status.json`, `maps.lock` | fichiers de travail des scripts (supprimables) |
| `configuration.yaml` | **2 lignes ajoutées en tête** (`homeassistant:` puis `packages: !include_dir_named packages`) |
| `secrets.yaml` | **2 clés ajoutées** : `github_dispatch_auth` et `meteochampignon_mf_token` |

Rien d'autre n'a été modifié dans votre configuration (j'ai seulement *lu*
`configuration.yaml`, les traces et la liste des dossiers).

### Sauvegardes qui existent déjà (à côté des fichiers)

- `configuration.yaml.bak-20261005-214229` : `configuration.yaml` **d'origine**
- `secrets.yaml.bak-20261005-212511` : `secrets.yaml` **d'origine**
- `secrets.yaml.bak-20261005-221217` : `secrets.yaml` avant l'ajout de la clé Météo-France

### Tout retirer (PowerShell, depuis votre PC)

```powershell
$HA = '\\homeassistant\config'
$u8 = New-Object System.Text.UTF8Encoding($false)

# 1. les fichiers ajoutés
Remove-Item "$HA\packages\meteochampignon.yaml", "$HA\dashboards\meteochampignon.yaml" -Force
Remove-Item "$HA\meteochampignon" -Recurse -Force

# 2. les 2 lignes de configuration.yaml (le reste du fichier est conservé tel quel)
$f = "$HA\configuration.yaml"
$t = [IO.File]::ReadAllText($f)
$t = $t -replace '^homeassistant:\r?\n  packages: !include_dir_named packages\r?\n\r?\n', ''
[IO.File]::WriteAllText($f, $t, $u8)

# 3. les 2 clés de secrets.yaml (le reste est conservé)
$s = "$HA\secrets.yaml"
$lines = Get-Content $s | Where-Object { $_ -notmatch '^(github_dispatch_auth|meteochampignon_mf_token)\s*:' -and $_ -notmatch '^# M.t.ochampignon' }
[IO.File]::WriteAllLines($s, [string[]]$lines, $u8)
```

Puis dans Home Assistant : *Outils de développement* > *YAML* > **Vérifier la
configuration**, **redémarrer**, et enfin supprimer les entités orphelines
(*Paramètres* > *Appareils et services* > *Entités*, filtre `meteochampignon`).

Si le dossier `packages/` ne contenait que ce fichier, vous pouvez aussi le
supprimer. **Ne restaurez pas** `secrets.yaml` depuis une sauvegarde sans la
relire : vous pourriez avoir ajouté d'autres secrets depuis.

### Le Python de Home Assistant n'est jamais modifié

Les paquets des cartes (`s3fs`, `omfiles`…) s'installent **uniquement** dans
`meteochampignon\pydeps` (option `--target` de pip, sans toucher aux paquets de
Home Assistant). Retour arrière : **supprimer ce dossier**. Pour arrêter seulement
la génération des cartes par Home Assistant (GitHub reprend dans les 90 min) :
désactiver l'automatisation « Météochampignon - générer les cartes (Home Assistant) ».

---

## Couche 4 : votre PC

- **`.env.local`** : la clé Météo-France y a été remplacée par la nouvelle (la
  copie de l'ancienne a été supprimée exprès, elle contenait un jeton).
- **Paquets Python installés pour mes essais** sur votre Python 3.12 global :
  `numpy scipy pillow s3fs fsspec omfiles tzdata pyyaml jinja2` (et leurs
  dépendances `aiohttp`, `aiobotocore`, `botocore`…). Certains existaient peut-être
  déjà. Pour les retirer, **après avoir vérifié** qu'aucun de vos autres scripts ne
  s'en sert :

```powershell
python -m pip uninstall -y omfiles s3fs fsspec aiobotocore botocore aioitertools jmespath wrapt pyyaml jinja2 tzdata
# numpy, scipy et pillow : seulement si vous êtes sûr de ne pas les utiliser ailleurs
```

---

## Ce qui ne peut pas être « défait » complètement

- **La valeur de l'ancienne clé Météo-France** : elle n'a pas été conservée. Elle
  reste valable sur le portail jusqu'à son expiration, mais on n'en a plus la copie.
  Pas de conséquence, la nouvelle clé fait tout.
- **Les données ajoutées à `public/station-history.json`** : ce sont des mesures
  réelles. Les annuler (`git revert 22d192b`) ferait *perdre* des heures de pluie.

## Après un retour arrière, vérifiez

```powershell
git status                       # rien d'inattendu
gh run list --limit 5            # les traitements restants tournent
```
et ouvrez <https://meteochampignon.vercel.app/> : stations, cartes et prévisions
doivent s'afficher sans message d'erreur.
