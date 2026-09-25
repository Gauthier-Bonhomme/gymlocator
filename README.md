# GymLocator — où ouvrir une salle de sport en France ?

> Geospatial site-selection tool for gyms in France: an E2SFCA accessibility model computed on the
> INSEE 1-km population grid, fully client-side (static files + one HTML page).
> **[Démo en ligne](https://gauthier-bonhomme.github.io/gymlocator/gymlocator.html)**

GymLocator cartographie, carreau de 1 km par carreau de 1 km, l'équilibre entre la **demande**
(combien d'abonnés potentiels habitent à proximité) et l'**offre** (quelles salles existantes
captent déjà cette demande) sur toute la France métropolitaine. Le résultat est une carte de
**déficit relatif** — l'écart à la couverture moyenne nationale — qui sert de **filtre de marché** :
repérer en quelques secondes les zones les plus sous-équipées par rapport à la moyenne, puis
approfondir avec les outils d'analyse intégrés. L'indicateur est relatif : il ne dit pas si un
marché est saturé en absolu (voir la modale « Méthode »).

Le projet a été développé pour la salle de sport **[Hall b](https://www.hallb.fr)** (Saint-Dionisy, 30) :
une première version a servi au choix de son emplacement réel en 2025 ; cette version 2 est une
reconstruction complète du modèle, plus rigoureuse et validée par backtest.

## La carte en bref

| | |
|---|---|
| **Maille** | carroyage INSEE **Filosofi 2021** 1 km — 374 511 carreaux habités |
| **Demande** | population × taux de pratique ancré à 10 %, modulé par structure d'âge et niveau de vie (±15 %) |
| **Offre** | ≈ 10 000 salles : établissements **SIRENE** NAF 93.13Z actifs ∪ **Data ES** (ministère des Sports, regroupé par installation), fusionnés par SIRET/proximité ; chaînes au format publié de l'enseigne, indépendants sans surface mesurée estimés par tranche d'effectifs ; écartés : équipements à accès réservé, coachs sans salle, sièges de franchisés, activités hors salle (détail dans `build/README.md`) |
| **Modèle** | **E2SFCA** (Enhanced Two-Step Floating Catchment Area), rayon 15 min porte-à-porte, décroissance gaussienne (σ = 6 min), vitesse analytique 21–62 km/h selon la densité |
| **Capacité** | 1,4 membre par m² de plateau ; simulation d'une nouvelle salle de 1 200 m² |

Toutes les constantes du modèle vivent dans **`meta.json`** — le front les lit au chargement,
il n'y a donc qu'une seule source de vérité (chiffres de la modale « Méthode » compris).

## Utiliser l'application

- **Clic sur la carte** → estimation instantanée de la zone de chalandise ≤ 15 min : population,
  demande, couverture, déficit relatif et écart à la moyenne nationale en équivalent salles
  (« petit bassin » ≠ « au niveau de la moyenne »).
- **Zones sous-équipées** → repérage glouton des N zones où le déficit relatif cumulé sur 15 min
  est le plus grand — une présélection à vérifier, pas une recommandation d'emplacement.
- **Analyse exacte** → isochrone détaillée sur les mêmes couches et les mêmes unités que
  l'estimation (pas de mélange pondéré/brut).
- **Cases à cocher par type de salle** (chaînes, indépendants, équipements publics…) →
  le score E2SFCA national est **recalculé côté client** sur le sous-ensemble (~2,5 s),
  échelle de couleur et référence comprises.
- **Permalien** `#lat,lon,zoom,vue` pour partager une analyse.
- **Modale « Méthode »** : mode d'emploi complet et limites du modèle, en 6 sections.

Aucun serveur : la page charge `grid.bin.gz` (2,4 Mo, décompressé nativement par le navigateur
via `DecompressionStream`, repli `grid.bin` 4,5 Mo), `gyms.json` et `meta.json`.

## Validation — ce que le score dit, et ce qu'il ne dit pas

Backtest sur les **≈ 2 000 ouvertures de salles depuis 2023** (SIRENE, après nettoyage de l'offre)
contre la carte de déficit calculée sur les données antérieures : les ouvertures se situent autour
du **43ᵉ percentile médian** du déficit (un tirage au hasard donnerait 50).

Autrement dit : **les opérateurs ne ciblent pas les zones les plus déficitaires** — leurs choix
suivent d'autres logiques (foncier, visibilité, zones commerciales). Le score GymLocator doit donc
se lire comme un **filtre de marché côté habitant** (où la demande est-elle mal servie ?), pas
comme un prédicteur des implantations réelles. Les chiffres détaillés du backtest sont dans
`meta.json` et affichés dans la modale Méthode.

## Architecture

```
gymlocator.html          Application complète (une page, Leaflet, zéro dépendance serveur)
grid.bin / grid.bin.gz   Couches précalculées par carreau (Float32, ordre ligne/colonne EPSG:3035)
gyms.json                Offre fusionnée (position, surface, type, enseigne)
meta.json                Constantes du modèle + backtest — source unique lue par le front
build/                   Pipeline Node (01-demand → 02-supply → 03-e2sfca → 04-backtest)
pipeline/                Héritage v3 : graphe routier OSRM France (~15 Go, non versionné),
                         conservé pour un futur raffinement temps de trajet — voir pipeline/README.md
gymlocator-v1.html       Première version (score gravitaire bi-critères), archivée
```

### Régénérer les données

```bash
cd build
npm install
# télécharger les 3 sources ouvertes (INSEE Filosofi, Data ES, SIRENE) — voir build/README.md
node 01-demand.mjs && node 02-supply.mjs && node 03-e2sfca.mjs && node 04-backtest.mjs
```

~2 minutes hors téléchargements. Chaque script vérifie des invariants (population totale ≈ 63 M,
Basic-Fit ≈ 930…) et échoue bruyamment en cas de dérive des formats sources — depuis Filosofi 2021,
`lcog_geo` peut par exemple contenir plusieurs communes entre guillemets, piège intercepté par les
assertions de `03-e2sfca.mjs`.

Le workflow **`.github/workflows/refresh-data.yml`** rejoue ce pipeline **chaque mois** et ne
committe que si les couches ont changé (l'offre bouge vite : ~2 200 créations en 30 mois).

## Données sources

| Source | Usage | Licence |
|---|---|---|
| [INSEE Filosofi 2021 carroyé 1 km](https://www.insee.fr/fr/statistiques/8735171) | population, âges, niveau de vie | Licence Ouverte |
| [SIRENE](https://www.sirene.fr) (via OpenDataSoft, NAF 93.13Z) | établissements actifs, dates de création | Licence Ouverte |
| [Data ES](https://equipements.sports.gouv.fr) (ministère des Sports) | équipements sportifs, surfaces | Licence Ouverte |

## Historique

- **v1** (2025) — score gravitaire bi-critères (densité de population × concurrence OSM) ; a servi
  au choix de l'emplacement réel de Hall b. Archivée dans `gymlocator-v1.html`.
- **v3 « flux »** (2026) — affectation des navettes domicile-travail sur le réseau routier OSRM ;
  abandonnée : le « passage » confondait taille de marché et qualité de site.
- **v2 actuelle** (juillet 2026) — E2SFCA sur carroyage INSEE, backtest de validation, pipeline
  reproductible et rafraîchissement mensuel automatique.
