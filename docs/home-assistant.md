# Déclencher les jobs depuis Home Assistant

## Pourquoi

Le cron natif de GitHub Actions est best-effort : la doc dit que `schedule`
« peut être retardé » et que des déclenchements « peuvent être abandonnés ».
Mesuré sur ce dépôt : **9 à 33 % des créneaux** partent réellement, avec des
trous de 8 à 15 h. Les jobs sont conçus pour s'en remettre (ils rattrapent les
heures manquées), mais les données ne sont alors mises à jour que toutes les
quelques heures.

Home Assistant tourne en continu : il appelle l'API GitHub toutes les 15 min
pour lancer les deux workflows (`workflow_dispatch`), **ce qui n'est pas soumis
aux pertes du cron**. Les crons GitHub restent en place comme filet de sécurité.

Les workflows se protègent eux-mêmes d'un excès d'appels :
- `maps.yml` ne régénère rien si les cartes ont moins de 50 min ;
- `station-history.yml` ne commit rien s'il n'y a rien de neuf (~15 s) ;
- les deux ont un groupe `concurrency` : jamais deux exécutions en parallèle.

## 1. Créer un jeton GitHub limité à ce dépôt

GitHub > Settings > Developer settings > Personal access tokens >
**Fine-grained tokens** > Generate new token :

- **Repository access** : *Only select repositories* > `drugpad/meteochampignon`
- **Permissions** > Repository permissions > **Actions : Read and write**
  (rien d'autre : le jeton ne peut ni lire le code ni le modifier)
- **Expiration** : 1 an (prévoir de le renouveler)

## 2. `secrets.yaml` de Home Assistant

La valeur entière, avec le préfixe `Bearer `, car `!secret` doit remplacer toute
la valeur d'un champ :

```yaml
github_dispatch_auth: "Bearer github_pat_XXXXXXXX"
```

## 3. `configuration.yaml`

```yaml
rest_command:
  meteochampignon_stations:
    url: "https://api.github.com/repos/drugpad/meteochampignon/actions/workflows/station-history.yml/dispatches"
    method: POST
    headers:
      Authorization: !secret github_dispatch_auth
      Accept: "application/vnd.github+json"
      X-GitHub-Api-Version: "2022-11-28"
      Content-Type: "application/json"
    payload: '{"ref":"master"}'
    timeout: 20

  meteochampignon_cartes:
    url: "https://api.github.com/repos/drugpad/meteochampignon/actions/workflows/maps.yml/dispatches"
    method: POST
    headers:
      Authorization: !secret github_dispatch_auth
      Accept: "application/vnd.github+json"
      X-GitHub-Api-Version: "2022-11-28"
      Content-Type: "application/json"
    payload: '{"ref":"master"}'
    timeout: 20
```

## 4. Automatisation

```yaml
automation:
  - alias: "Météochampignon - déclencher les jobs GitHub"
    mode: single
    trigger:
      - platform: time_pattern
        minutes: "/15"
    action:
      - service: rest_command.meteochampignon_stations
      - service: rest_command.meteochampignon_cartes
```

GitHub répond **HTTP 204** quand le déclenchement est accepté. Pour
vérifier : redémarrer Home Assistant (ou recharger les `rest_command`), lancer
l'automatisation à la main (Paramètres > Automatisations > Exécuter), puis
regarder l'onglet Actions du dépôt : un run « workflow_dispatch » doit apparaître.

## Dépannage

| Réponse | Cause |
|---|---|
| 401 | jeton mal copié, expiré, ou `Bearer ` manquant dans `secrets.yaml` |
| 403 / 404 | le jeton n'a pas *Actions : Read and write* sur ce dépôt |
| 422 | le workflow n'a pas de `workflow_dispatch`, ou `ref` incorrect (doit être `master`) |

Quand le jeton arrive à expiration, les crons GitHub reprennent seuls (avec
leurs trous habituels) : rien ne casse, les données sont juste mises à jour
moins souvent.
