# Pipeline GymLocator v2 — E2SFCA sur carroyage INSEE

Produit les fichiers statiques consommés par `gymlocator.html` :
`grid.bin` + `grid.bin.gz` (couches par carreau 1 km), `gyms.json` (offre fusionnée),
`meta.json` (paramètres du modèle — source unique lue par le front — + backtest).

À relancer seulement pour rafraîchir les données (nouvelles salles SIRENE, nouveau
millésime INSEE) — le workflow `.github/workflows/refresh-data.yml` le fait chaque mois.
Prérequis : Node 18+, ~250 Mo de disque. Durée totale : ~2 minutes hors téléchargements.

## 0. Télécharger les données brutes (dossier `data/`, non versionné)

```bash
mkdir -p data data/filosofi2021
# Population / âges / niveau de vie — INSEE Filosofi 2021 carroyé 1 km (~16 Mo, CSV directs)
curl -sL -o data/filosofi2021.zip "https://www.insee.fr/fr/statistiques/fichier/8735171/Filosofi2021_carreaux_1km_csv.zip"
unzip -o data/filosofi2021.zip -d data/filosofi2021
# N.B. depuis 2021, lcog_geo peut contenir plusieurs communes entre guillemets —
# 01-demand.mjs gère ces champs (ne pas parser avec un split(',') naïf).

# Salles de musculation/cardio — Data ES (ministère des Sports)
curl -s -o data/dataes.json "https://equipements.sports.gouv.fr/api/explore/v2.1/catalog/datasets/data-es/exports/json?where=equip_type_name%3D%22Salle%20de%20musculation%2Fcardiotraining%22&select=equip_numero,inst_nom,equip_nom,equip_surf,equip_service_date,equip_coordonnees,inst_siret,inst_adresse,inst_cp,new_name,dep_code,equip_ouv_public_bool,equip_prop_type,equip_gest_type"

# Établissements actifs NAF 93.13Z géolocalisés — SIRENE (via OpenDataSoft)
curl -s -o data/sirene.json "https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/economicref-france-sirene-v3/exports/json?where=activiteprincipaleetablissement%3D%2293.13Z%22%20and%20etatadministratifetablissement%3D%22Actif%22&select=siret,datecreationetablissement,enseigne1etablissement,denominationusuelleetablissement,denominationunitelegale,geolocetablissement,codepostaletablissement,libellecommuneetablissement,trancheeffectifsetablissement"
```

## 1–4. Lancer le pipeline

```bash
npm install            # proj4 (conversion EPSG:3035 → WGS84)
node 01-demand.mjs     # demande par carreau (pénétration par âge ancrée 10 % + revenu)
node 02-supply.mjs     # offre fusionnée SIRENE ∪ Data ES → ../gyms.json
node 03-e2sfca.mjs     # E2SFCA national → ../grid.bin + ../meta.json
node 04-backtest.mjs   # validation ouvertures ≥ 2023 → complète ../meta.json
```

Chaque script affiche des contrôles (population totale ≈ 63 M, Basic-Fit ≈ 930, etc.).

## Mesurer l'effet d'un changement : `audit.mjs`

Avant de modifier le modèle, figer une référence ; après chaque changement, relancer la mesure
et lire les écarts. Toutes les branches sont ainsi jugées avec le même étalon.

```bash
npm run audit:figer        # une fois, AVANT de toucher au code (sur les données actuelles de data/)
node 02-supply.mjs         # … relancer les étapes modifiées du pipeline …
npm run audit              # mesures + écarts à la référence
npm run audit:sensibilite  # idem + variantes de paramètres (~3 min de plus)
```

L'outil lit uniquement `data/` et écrit dans `build/audit/` (non versionné, comme `data/`) :

- **Offre** : part de capacité à surface par défaut, équipements Data ES non ouverts au public,
  lignes Data ES en double pour une même installation, établissements SIRENE sans salarié,
  surfaces mesurées vs par défaut des chaînes, salle Hall b.
- **Modèle** : Aref, déficit par classe de densité, 20 meilleurs sites (maxima à 20 km l'un de
  l'autre), zone 15 min de Hall b en somme brute et pondérée.
- **Backtest** sur des ouvertures **figées** au premier lancement (`audit/ouvertures-figees.json`) :
  toutes, avec salariés, chaînes ; métrique pondérée (celle de 04) et brute (celle de la carte).
  Le percentile ne peut donc pas bouger simplement parce que l'offre a été nettoyée.
- **Stabilité** par rapport à la référence : corrélation de rang du déficit de zone, top 1 % des
  carreaux conservé, top 20 sites retrouvés à 10 km près.

La référence dépend de `data/` : après un nouveau téléchargement des sources, la refiger
**avant** de modifier le code, sinon les écarts mélangent effet des données et effet du code.
Le calcul des couches reprend les étapes de `03-e2sfca.mjs` et le signale s'il ne reproduit
plus `grid.bin` (quand celui-ci vient des mêmes données) : l'aligner si 03 change.

## Raffinement possible : temps de trajet OSRM

Le modèle utilise une vitesse porte-à-porte analytique (21–62 km/h selon la densité).
Pour des temps routiers exacts, remplacer `speedKmh`/distance dans `lib-e2sfca.mjs`
par des appels à l'API `table` d'un OSRM local (le graphe France est déjà préparé
dans `../pipeline/osrm-data/`, voir `../pipeline/README.md`). Le reste du pipeline
et le front sont inchangés.
