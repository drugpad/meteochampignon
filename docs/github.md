# Guide GitHub : ce que vous avez à faire (et ce que vous n'avez pas à faire)

Dépôt : <https://github.com/drugpad/meteochampignon> (public).

## Bonne nouvelle : les réglages du dépôt sont déjà bons

Vérifié le 05/10/2026 : Actions est activé, aucune protection de branche ne gêne
les traitements automatiques, et les workflows déclarent eux-mêmes les droits
dont ils ont besoin. **Vous n'avez rien à changer dans les paramètres du dépôt.**

Le secret `METEOFRANCE_API_TOKEN` (clé Météo-France) est déjà en place.

Il vous reste **trois choses** à faire côté GitHub/services :

1. créer un jeton pour Home Assistant (§ 1) ;
2. régler les mails d'alerte (§ 2, facultatif mais recommandé) ;
3. supprimer une variable inutile sur Vercel (§ 3).

---

## 1. Créer le jeton pour Home Assistant

Ce jeton permet à Home Assistant de **lancer les traitements** et de **lire leur
état**. Il est volontairement très limité : un seul dépôt, une seule permission.
Il ne peut ni lire ni modifier votre code.

1. Ouvrez <https://github.com/settings/personal-access-tokens/new>
   (ou : photo de profil > *Settings* > *Developer settings* > *Personal access
   tokens* > *Fine-grained tokens* > *Generate new token*).
2. **Token name** : `home-assistant-meteochampignon`
3. **Expiration** : 1 an (notez la date dans votre calendrier : à l'expiration,
   Home Assistant vous alertera, voir `docs/home-assistant.md`).
4. **Resource owner** : `drugpad`.
5. **Repository access** : *Only select repositories* > choisissez
   **`meteochampignon`** (et uniquement celui-là).
6. **Permissions** > *Repository permissions* > cherchez **Actions** > mettez
   **Read and write**. Ne touchez à rien d'autre (« Metadata : Read-only » se
   met tout seul).
7. **Generate token**.
8. **Copiez le jeton tout de suite** (`github_pat_…`) : GitHub ne l'affiche
   qu'une seule fois. Vous le collerez dans l'installeur Home Assistant.

> Ne le collez jamais dans un message, un fichier du dépôt ou une capture
> d'écran. S'il fuite : *Settings* > *Developer settings* > *Fine-grained
> tokens* > le jeton > **Delete**, puis recréez-en un.

## 2. Mails d'alerte en cas d'échec (recommandé)

GitHub envoie un mail quand un traitement planifié échoue, à la personne qui a
modifié le cron en dernier. Pour que ce soit bien le cas :

1. <https://github.com/settings/notifications>
2. Section **Actions** : cochez **Send notifications for failed workflows only**
   (et choisissez *Email*).

C'est un filet de plus : Home Assistant vous prévient déjà du retard et des échecs.

## 3. Supprimer la variable Vercel inutile

L'ancienne version de l'appli utilisait la clé Météo-France côté navigateur. Ce
n'est plus le cas, et une variable préfixée `VITE_` finit en clair dans le
code public. À supprimer :

1. <https://vercel.com> > votre projet **meteochampignon** > *Settings* >
   *Environment Variables*.
2. Repérez **`VITE_METEOFRANCE_API_TOKEN`** > menu ⋯ > **Delete**.
3. Pas besoin de redéployer.

---

## Comment travailler avec le dépôt depuis votre PC

Le dépôt reçoit des commits **automatiques** (le fichier
`public/station-history.json`, plusieurs fois par jour). Votre copie locale est
donc souvent « en retard ». Règle d'or :

```powershell
git pull --rebase      # AVANT de pousser, toujours
git push
```

Sinon GitHub refuse le `push` (« rejected… fetch first ») : ce n'est pas grave,
faites `git pull --rebase` puis `git push`.

### À ne jamais faire

- **`git add -A` ou `git add .` dans `scripts/`** : ce dossier contient vos
  fichiers de travail « biotope » (exclus de Git exprès, ils ne doivent jamais
  partir). Ajoutez toujours des fichiers **par leur nom** :
  `git add src/lib/rainMaps.ts`.
- **Toucher à la branche `data`** : elle est écrasée automatiquement à chaque
  génération de cartes. Ne la fusionnez pas, ne la supprimez pas.
- **Committer `.env.local`** : il est déjà ignoré, mais ne le forcez jamais.

### Commandes utiles (terminal du projet)

```powershell
gh run list --limit 10                                  # derniers traitements
gh run list --workflow=maps.yml --limit 5               # seulement les cartes
gh run view <numéro> --log                              # le journal d'un traitement
gh workflow run maps.yml -f force=true                  # régénérer les cartes tout de suite
gh workflow run station-history.yml                     # relancer les stations
```

Ces commandes demandent `gh` connecté à votre compte (`gh auth status` pour
vérifier).

## Où voir ce qui se passe

- **Tableau de bord Home Assistant « Météochampignon »** (voir
  `docs/home-assistant.md`) : le plus simple, tout y est.
- **Onglet Actions du dépôt** : <https://github.com/drugpad/meteochampignon/actions>
  - *Cartes de pluie* : génération des cartes (toutes les ~heures).
  - *Accumuler l'historique des stations* : collecte des mesures.
  - *Rattraper l'historique des stations* : manuel, pour combler un gros trou.
  - Une coche verte = succès. Un run « Cartes de pluie » de 3 secondes est
    normal : c'est le garde-fou (« cartes récentes : rien à faire »).
- **Branche `data`** : contient les cartes publiées
  (<https://github.com/drugpad/meteochampignon/tree/data>).

## Échéances à retenir

| Quoi | Échéance | Que faire |
|---|---|---|
| Jeton GitHub de Home Assistant | 1 an après sa création | en créer un nouveau (§ 1) et remplacer dans `secrets.yaml` |
| Clé Météo-France (`METEOFRANCE_API_TOKEN`) | **16/03/2028** | portail Météo-France > API > Utiliser > *Générer Token* (durée ~1 an), puis `gh secret set METEOFRANCE_API_TOKEN` (voir `CLAUDE.md` section 2) |
| Image GitHub `ubuntu-24.04` | quelques années | remplacer par la version suivante **après un essai manuel** des workflows |
| Dépôt inactif | 60 jours sans activité | GitHub désactive les workflows planifiés d'un dépôt public sans activité : les commits automatiques comptent normalement comme activité |

## Si ça ne marche pas

| Symptôme | Que faire |
|---|---|
| Les cartes ou les stations semblent figées | regarder le tableau de bord HA ; sinon `gh run list --limit 10` ; relancer avec `gh workflow run maps.yml -f force=true` |
| Un traitement est en rouge | `gh run view <numéro> --log` : l'erreur est dans l'étape marquée ❌. Cause la plus probable : clé Météo-France expirée (secret) ou service tiers indisponible |
| `git push` refusé | `git pull --rebase` puis `git push` |
| Conflit ou refus de `git pull --rebase` à cause de `public/station-history.json` | vous avez modifié ce fichier en local alors qu'il est géré par les traitements : `git rebase --abort` si besoin, puis `git checkout -- public/station-history.json` (abandonne votre version locale) et recommencez `git pull --rebase` |
| Je veux désactiver un traitement | onglet Actions > le workflow > menu ⋯ > *Disable workflow* (les crons s'arrêtent ; réactivez-le de la même façon) |
