# Météo Midi-Pyrénées 🍄

Application web (mobile-first, compatible PC) affichant une carte de Midi-Pyrénées avec prévisions 7 jours, historique météo par station, et une carte de pluie 24h — pensée avant tout pour repérer les bonnes périodes de cueillette de champignons.

Quasi entièrement frontend, comme [Unmask](../unmask) dont le socle carte (Leaflet, fond plan/satellite IGN) a été repris : tous les calculs se font dans le navigateur, à partir d'API publiques.

## Fonctionnalités

- **Carte** : fond plan (OpenStreetMap) ou satellite (orthophotos IGN), sélecteur de mode Prévisions / Historique.
- **Prévisions 7 jours** (mode Prévisions) : clic n'importe où sur la carte → prévisions Open-Meteo `best_match` (blend multi-modèles AROME/ARPEGE + relais moyen terme) au point cliqué.
- **Stations** (mode Historique) : ~240 stations Météo-France (RADOME) réparties sur les 8 départements de Midi-Pyrénées. Clic sur une station → historique pluie 24h, historique température, mini prévision 5 jours.
- **Carte de pluie 24h** (mode Historique) : deux options en cours de comparaison (voir [CLAUDE.md](./CLAUDE.md)) —
  - **Option A** (active) : grille Open-Meteo interpolée (~8km de maille), rendu en dégradé sur la carte.
  - **Option B** (en cours) : radar Météo-France (lame d'eau, résolution 500m-1km) — client API prêt, décodage du fichier pas encore branché.

## Stack technique

- [Vite](https://vite.dev/) + [React](https://react.dev/) + TypeScript
- [Leaflet](https://leafletjs.com/) / [react-leaflet](https://react-leaflet.js.org/) pour la carte
- [Recharts](https://recharts.org/) pour les graphiques de station
- [Open-Meteo](https://open-meteo.com/) (prévisions, carte de pluie Option A) — sans clé API
- [API Météo-France](https://portail-api.meteofrance.fr/) (données d'observation par station, radar) — nécessite un token gratuit, voir `.env.example`

## Démarrage

```bash
npm install
cp .env.example .env.local   # puis renseigner VITE_METEOFRANCE_API_TOKEN
npm run dev
```

Voir [`CLAUDE.md`](./CLAUDE.md) pour le détail des choix techniques et l'état d'avancement.
