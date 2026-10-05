# Home Assistant : déclencher et suivre les traitements

## À quoi ça sert

Les données (cartes de pluie, historique des stations) sont calculées par des
traitements GitHub Actions. Le « cron » de GitHub, qui devait les lancer, ne
part que dans **10 à 30 % des cas** (mesuré), avec des trous de 8 à 15 h : les
données restent justes (les traitements rattrapent ce qui manque) mais ne sont
mises à jour que toutes les quelques heures.

Home Assistant tourne en continu. Ce paquet :

1. **appelle GitHub toutes les 15 min** pour lancer les deux traitements (un
   appel direct n'est pas soumis aux pertes du cron) ;
2. **surveille** la fraîcheur des cartes et des stations et l'état du dernier
   traitement, dans un **tableau de bord dédié** ;
3. **vous alerte** (notification dans Home Assistant) si quelque chose est en
   retard de plus de 3 h ou en échec pendant plus de 15 min ;
4. fournit un bouton **« Lancer maintenant »**.

Les traitements se protègent d'un excès d'appels : les cartes ne sont
régénérées que si elles ont plus de 50 min, et les stations ne commitent rien
quand il n'y a rien de neuf. Appeler toutes les 15 min est sans conséquence.

Si Home Assistant ou le jeton tombe, **rien ne casse** : les crons GitHub
continuent (avec leurs trous habituels) et les données sont juste moins fraîches.

## Collecte directe par Home Assistant (stations)

GitHub Actions peut tomber (incident du 05/10/2026 : « The job was not acquired
by Runner », des traitements restés 15 min en file puis annulés). Pour que les
**stations ne dépendent plus de GitHub Actions**, Home Assistant fait lui-même
les appels à l'API Météo-France :

- le script `stations.py` (Python standard, **rien à installer**) tourne dans
  Home Assistant à **:15 et :45** de chaque heure ;
- un seul appel renvoie toutes les stations d'une heure ; chaque passage
  rattrape les heures manquées des 23 dernières heures ;
- il écrit le résultat dans le dépôt par l'API GitHub, avec le `sha` du fichier
  lu : si GitHub (ou autre chose) a écrit entre-temps, il est refusé puis
  recommence — **jamais d'écrasement** (testé avec un conflit simulé) ;
- les traitements GitHub restent en **secours** : si Home Assistant est éteint,
  GitHub prend le relais, et inversement.

**Une seule chose à faire pour que ça marche** : le jeton GitHub doit avoir la
permission **Contents : Read and write** en plus d'Actions. Sans elle, la collecte
échoue avec une notification claire (rien n'est perdu, GitHub continue).

1. <https://github.com/settings/personal-access-tokens> > votre jeton
   `home-assistant-meteochampignon` > **Edit**.
2. *Repository permissions* > **Contents** > **Read and write**.
3. **Update**. La valeur du jeton ne change pas : rien à recopier.

Puis relancez l'installeur (il copie les scripts et ajoute la clé Météo-France à
`secrets.yaml`, lue dans `.env.local`, sans la redemander) et redémarrez Home
Assistant.

### Et les cartes de pluie ?

Elles demandent des paquets Python lourds (numpy, scipy, s3fs, omfiles) que
je ne peux pas essayer sur votre machine. Le bouton **« Diagnostic Python »** du
tableau de bord (ou le script *Météochampignon - diagnostic Python*) regarde
si Home Assistant les a, la mémoire disponible et le réseau, et affiche le
résultat dans une notification, sans rien modifier ni installer. Tant qu'il
n'est pas concluant, les cartes restent calculées sur GitHub, lancées par Home
Assistant toutes les 15 min.

## Contenu du dossier `home-assistant/`

| Fichier | Rôle |
|---|---|
| `meteochampignon.yaml` | Le paquet : appels GitHub, capteurs, voyants, alertes, script, déclaration du tableau de bord |
| `dashboard.yaml` | Le tableau de bord « Météochampignon » (carte de suivi) |
| `scripts/stations.py` | Collecte des stations exécutée par Home Assistant (Python standard) |
| `scripts/check_env.py` | Diagnostic : Home Assistant peut-il générer les cartes ? |
| `install.ps1` | Copie tout sur votre partage Samba et ajoute le jeton et la clé Météo-France à `secrets.yaml` |

## Installation en 4 étapes

### 1. Créer le jeton GitHub (2 min, à faire une seule fois)

Voir [docs/github.md](github.md), section « Créer le jeton ». Résumé : jeton
*fine-grained*, limité au dépôt `meteochampignon`, avec la seule permission
**Actions : Read and write**. Gardez-le sous la main (il ne s'affiche qu'une fois).

### 2. Lancer l'installeur (depuis votre PC Windows)

Ouvrez PowerShell **dans le dossier du projet**
(`C:\Users\au\Documents\Meteochampignon`) puis :

```powershell
.\home-assistant\install.ps1
```

Par défaut il cherche le partage `\\homeassistant\config`. Si le nom ne
fonctionne pas, donnez l'adresse IP de Home Assistant (ou le nom exact de votre
partage Samba, celui qui contient `configuration.yaml`) :

```powershell
.\home-assistant\install.ps1 -Ha '\\192.168.1.50\config'
```

Le script :
- vérifie que c'est bien le dossier de configuration de Home Assistant ;
- copie `packages\meteochampignon.yaml` et `dashboards\meteochampignon.yaml` ;
- vous demande le jeton (**saisie masquée**) et l'ajoute à `secrets.yaml`
  (après une sauvegarde datée de ce fichier) ;
- vérifie `configuration.yaml` et vous dit quoi ajouter si les *packages* n'y
  sont pas chargés. **Il ne modifie jamais `configuration.yaml`.**

Si PowerShell refuse d'exécuter le script (« l'exécution de scripts est
désactivée »), utilisez :

```powershell
powershell -ExecutionPolicy Bypass -File .\home-assistant\install.ps1
```

### 3. Vérifier puis redémarrer Home Assistant

1. *Outils de développement* > *YAML* > **Vérifier la configuration** : il doit
   afficher « La configuration ne contient pas d'erreur ».
2. **Redémarrer** Home Assistant. Le tableau de bord **Météochampignon**
   apparaît dans le menu latéral (adresse `/meteo-champignon`).

Prérequis : Home Assistant **2024.10 ou plus récent**. Si `configuration.yaml`
ne contient pas déjà ces lignes, ajoutez-les (l'installeur vous le dit) :

```yaml
homeassistant:
  packages: !include_dir_named packages
```

### 4. Tester

*Paramètres* > *Automatisations* > **Météochampignon - déclencher les
traitements GitHub** > menu ⋮ > **Exécuter**. Puis regardez l'onglet **Actions**
du dépôt GitHub : deux runs « workflow_dispatch » doivent apparaître (stations
et cartes ; celui des cartes peut se terminer en 3 secondes si les cartes sont
déjà récentes : c'est le garde-fou, pas une erreur).

## Le tableau de bord

Il montre, en un coup d'œil :

- **État général** : 🟢 tout est à jour, ou 🔴 avec la liste de ce qui ne va pas ;
- **Cartes de pluie** : voyant de retard (> 3 h), date de la dernière génération,
  résultat du dernier traitement GitHub, qui l'a lancé (`schedule` = cron GitHub,
  `workflow_dispatch` = Home Assistant ou vous), lien vers le run ;
- **Historique des stations** : voyant de retard, date de la dernière donnée
  réellement enregistrée, dernier traitement ;
- **Déclencheur Home Assistant** : date du dernier appel, voyant d'échec ;
- **Retards sur 3 jours** : historique visuel ;
- le bouton **Lancer les traitements maintenant**.

Les capteurs sont rafraîchis toutes les 5 min.

## Alertes

Notifications dans Home Assistant (cloche) :

| Notification | Quand | Disparaît |
|---|---|---|
| *GitHub a refusé le déclenchement* | un appel ne renvoie pas HTTP 204 (jeton expiré, droits…) | au prochain appel réussi |
| *Traitement en retard ou en échec* | un voyant reste allumé plus de 15 min | au retour à la normale |

Pour recevoir ces alertes sur votre téléphone, remplacez
`persistent_notification.create` par votre service `notify.mobile_app_<téléphone>`
dans `home-assistant/meteochampignon.yaml`, puis relancez `install.ps1`.

## Dépannage

| Symptôme | Cause probable |
|---|---|
| Notification « GitHub a refusé… HTTP 401 » | jeton expiré, mal copié, ou `Bearer ` manquant dans `secrets.yaml` |
| … HTTP 403 ou 404 | le jeton n'a pas **Actions : Read and write** sur ce dépôt |
| … HTTP 422 | nom de branche incorrect (doit être `master`) ou workflow sans `workflow_dispatch` |
| Notification « la collecte des stations par Home Assistant a échoué » | 403 : jeton sans « Contents : Read and write » (voir ci-dessus) ; 401 : jeton refusé ; « API Paquet indisponible » : clé Météo-France absente de `secrets.yaml` (relancer `install.ps1`) ou service Météo-France en panne |
| Capteurs « indisponible » | réseau de Home Assistant, ou limite de requêtes GitHub (60/h sans jeton) : vérifier que le jeton est bien dans `secrets.yaml` |
| « Cartes en retard » alors que tout tourne | la source `raw.githubusercontent.com` est injoignable depuis HA, ou la branche `data` n'a pas été publiée |
| Erreur « dashboards » en double à la vérification | vous avez déjà une section `lovelace:` avec ses `dashboards:` : fusionnez le bloc `lovelace:` du paquet dans la vôtre |
| « Url path needs to contain a hyphen » à la vérification | l'identifiant du tableau de bord doit contenir un tiret : il s'appelle `meteo-champignon` dans `lovelace: dashboards:` (corrigé le 05/10/2026 ; mettez à jour `packages/meteochampignon.yaml` depuis le dépôt) |
| Le tableau de bord n'apparaît pas | redémarrage non fait, ou `show_in_sidebar` masqué dans votre profil |

## Renouvellement

Le jeton GitHub expire (1 an au maximum). Quand il expire, les appels
renvoient 401 et la notification vous prévient. Pour le renouveler : créez un
nouveau jeton (voir [docs/github.md](github.md)) puis remplacez la valeur de
`github_dispatch_auth` dans `secrets.yaml` (`Bearer github_pat_…`) et
redémarrez, ou rechargez les *rest_command*.

## Désinstaller

Supprimez `packages/meteochampignon.yaml`, `dashboards/meteochampignon.yaml` et
la ligne `github_dispatch_auth` de `secrets.yaml`, puis redémarrez.
