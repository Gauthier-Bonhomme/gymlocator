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
curl -s -o data/dataes.json "https://equipements.sports.gouv.fr/api/explore/v2.1/catalog/datasets/data-es/exports/json?where=equip_type_name%3D%22Salle%20de%20musculation%2Fcardiotraining%22&select=equip_numero,inst_numero,inst_nom,equip_nom,equip_surf,equip_service_date,equip_coordonnees,inst_siret,inst_adresse,inst_cp,new_name,dep_code,equip_ouv_public_bool,equip_prop_type,equip_gest_type"

# Établissements actifs NAF 93.13Z géolocalisés — SIRENE (via OpenDataSoft)
curl -s -o data/sirene.json "https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/economicref-france-sirene-v3/exports/json?where=activiteprincipaleetablissement%3D%2293.13Z%22%20and%20etatadministratifetablissement%3D%22Actif%22&select=siret,datecreationetablissement,enseigne1etablissement,denominationusuelleetablissement,denominationunitelegale,geolocetablissement,codepostaletablissement,libellecommuneetablissement,trancheeffectifsetablissement"

# NAF 93.11Z, 93.12Z, 85.51Z : sur-ensemble filtré par nom côté serveur (≈ 18 000 lignes sur 330 000),
# 02 affine. Une enseigne ajoutée à ENSEIGNES doit aussi l'être à ces termes de recherche.
curl -s -G -o data/sirene-autres.json "https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/economicref-france-sirene-v3/exports/json" \
  --data-urlencode 'where=activiteprincipaleetablissement in ("93.11Z","93.12Z","85.51Z") and etatadministratifetablissement="Actif" and (search("fitness") or search("fit") or search("gym") or search("muscu") or search("musculation") or search("kc") or search("keep cool") or search("keepcool") or search("basicfit") or search("on air") or search("orange bleue") or search("appart") or search("magic form") or search("vita liberte") or search("vita libre") or search("elancia") or search("wellness") or search("gigafit") or search("neoness") or search("movida") or search("episod") or search("neofit") or search("interval") or search("cmg") or search("usine") or search("amazonia") or search("health city") or search("healthcity") or search("holmes place"))' \
  --data-urlencode 'select=siret,datecreationetablissement,enseigne1etablissement,denominationusuelleetablissement,denominationunitelegale,geolocetablissement,codepostaletablissement,libellecommuneetablissement,trancheeffectifsetablissement,activiteprincipaleetablissement,categoriejuridiqueunitelegale,caractereemployeuretablissement'

# Salles de sport d'OpenStreetMap (leisure=fitness_centre, ~4 500) — Overpass exige un User-Agent
curl -s --fail --retry 3 --retry-delay 30 -m 300 -A "GymLocator (+https://github.com/Gauthier-Bonhomme/gymlocator)" -o data/osm-fitness.json \
  --data-urlencode 'data=[out:json][timeout:180];area["ISO3166-1"="FR"][admin_level=2]->.fr;nwr["leisure"="fitness_centre"](area.fr);out center tags;' \
  https://overpass-api.de/api/interpreter
```

## 1–4. Lancer le pipeline

```bash
npm install            # proj4 (conversion EPSG:3035 → WGS84)
node 01-demand.mjs     # demande par carreau (pénétration par âge ancrée 10 % + revenu)
node 02-supply.mjs     # offre fusionnée SIRENE ∪ Data ES ∪ OSM → ../gyms.json
node 03-e2sfca.mjs     # E2SFCA national → ../grid.bin + ../meta.json
node 04-backtest.mjs   # validation ouvertures ≥ 2023 → complète ../meta.json
```

Chaque script affiche des contrôles (population totale ≈ 63 M, etc.). 02 échoue si un grand
réseau de franchise passe sous son seuil (`reseaux.mjs` : 85 % du réseau publié, Keep Cool excepté)
ou si une source arrive tronquée : la CI ne publie alors rien.

## Règles de l'offre (`02-supply.mjs`)

Chaque exclusion est tracée dans `data/offre-journal.json` (règle, nom, position, capacité perdue).

- **Data ES regroupé par installation** (`inst_numero`) : une ligne = un équipement, et certains
  déclarants listent chaque vélo ou chaque salle. Surface = somme des surfaces *distinctes*
  (L'Appart Oullins répète 600 m² sur 10 lignes ; CMG détaille salle par salle).
- **Accès réservé** : « non ouvert au public » veut dire « sur abonnement » pour une salle
  commerciale ou associative (Basic-Fit Laon est déclaré ainsi) → gardée ; lycées, prisons,
  casernes, hôtels, salles d'entreprise, clubs d'un autre sport (aviron, athlétisme…) et gymnases
  municipaux réservés aux clubs → écartés.
- **Chaînes** : format publié de l'enseigne (annuaires de franchise, 09/2026) pour *tous* ses
  clubs, qu'ils soient mesurés par Data ES ou non — Data ES ne mesure que la salle muscu/cardio
  (Keep Cool : 300 m² mesurés pour des clubs de 300–800 m²). Table `ENSEIGNES`.
- **Autres codes NAF** (93.11Z, 93.12Z, 85.51Z) : des clubs de chaîne y sont déclarés (Fitness Park :
  74 établissements en 93.11Z), mais surtout des associations (gym volontaire, gymnastique) et des
  coachs. Retenus : une enseigne connue, ou un nom de salle (fitness, fit, gym, muscu — pas la
  gymnastique) porté par une société ou un employeur ; sans enseigne, il faut encore un salarié ou un
  équipement Data ES (règle `autre-naf-non-atteste`). Associations et personnes publiques écartées :
  leur salle est déjà dans Data ES.
- **Enseigne d'un franchisé** : lue dans l'enseigne, le nom usuel puis la raison sociale ; sinon
  **SIREN connu** (un autre établissement de l'unité légale porte l'enseigne, raison sociale « KC … »
  de Keep Cool, installation Data ES ou SIRET OpenStreetMap de l'enseigne), si l'établissement est
  attesté par un salarié ou un équipement Data ES ; sinon **OpenStreetMap** : la salle sans enseigne
  à ≤ 150 m d'un club de la chaîne (≤ 1 km si son SIREN est connu de l'enseigne) est ce club. Un club
  repris garde parfois son ancienne étiquette dans SIRENE (les Amazonia de KC NANCY CENTRE, KC METZ
  GARE… sont des Keep Cool) : SIREN connu + club OSM au même lieu ⇒ enseigne d'OSM.
- **Clubs de chaîne d'OpenStreetMap** : chaque club OSM est apparié au club de même enseigne le
  plus proche à ≤ 3 km, un pour un ; ceux qui restent sont ajoutés (`src = 'osm'`, format de
  l'enseigne), sauf une salle d'une autre enseigne à ≤ 50 m (même local).
- **Même enseigne** : une installation Data ES est rattachée au club SIRENE de même enseigne à
  < 500 m, ou à < 3 km quand c'est le seul club de l'enseigne dans la commune des deux côtés
  (Basic-Fit Béthune, Keep Cool Narbonne) ; deux clubs de même enseigne à < 150 m n'en font qu'un
  (règle `doublon-meme-enseigne`).
- **Coachs sans salle** : sans salarié, sans Data ES, nom de coach sans mot désignant un local
  (« Studio Coaching » reste), ou entrepreneur individuel sans nom diffusé.
- **Même point exact** : sièges de franchisés domiciliés chez le gérant et SIRET en double. Une
  enseigne, un salarié ou un équipement Data ES attestent un club (les zones commerciales n'ont
  souvent qu'une adresse) ; les doublons du même club et les établissements non attestés sont
  écartés, et un point portant ≥ 3 établissements tous non attestés est une adresse de domiciliation.
- **Activités hors salle** (épilation, UV, cryothérapie, spa, minceur) sauf si le nom évoque
  aussi une salle (« Fit & Spa »).
- **Valeurs réelles** (table `REELLES`, clé SIRET) : surface, adhérents et segment communiqués par
  l'exploitant, prioritaires sur toute estimation (`surfSrc = 'reel'`). La capacité est alors le
  nombre d'adhérents constaté, **pas** surface × 1,4. Seul cas : Hall b (Saint-Dionisy), 2 400 m²
  et 1 600 adhérents réels (0,67 adh/m², la règle en donnerait 3 360), club premium ; « non
  employeur » dans SIRENE et sans enseigne, elle était estimée à 240 m² / 336 places, « classic ».
- **Ordre des sources** : Data ES est trié par numéro d'équipement avant tout traitement. L'API
  exporte les mêmes lignes dans un ordre variable, et une installation prend la position, le
  propriétaire et le nom de sa première ligne : sans tri, deux téléchargements identiques ne
  donnaient pas le même `grid.bin`.
- Aucune règle ne met les non-employeurs à zéro ; 02 affiche Hall b à chaque exécution et signale
  si ses valeurs réelles ne sont plus appliquées (SIRET changé).

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
  l'autre), zone 15 min de Hall b en somme brute et pondérée ; si `data/vitesse-isochrones.json`
  existe (voir `calage-vitesse.mjs`), population des zones de 15 min du modèle contre celle des
  isochrones Valhalla (contrôle : médiane à ±15 %).
- **Backtest** sur des ouvertures **figées** au premier lancement (`audit/ouvertures-figees.json`) :
  toutes, avec salariés, chaînes ; métrique pondérée (celle de 04 et de la carte) et brute
  (somme sans pondération, celle de la carte jusqu'à 09/2026).
  Le percentile ne peut donc pas bouger simplement parce que l'offre a été nettoyée.
- **Stabilité** par rapport à la référence : corrélation de rang du déficit de zone, top 1 % des
  carreaux conservé, top 20 sites retrouvés à 10 km près.

La référence dépend de `data/` : après un nouveau téléchargement des sources, la refiger
**avant** de modifier le code, sinon les écarts mélangent effet des données et effet du code.
Le calcul des couches reprend les étapes de `03-e2sfca.mjs` et le signale s'il ne reproduit
plus `grid.bin` (quand celui-ci vient des mêmes données) : l'aligner si 03 change.

## Vitesse calée sur les temps routiers : `calage-vitesse.mjs`

Le modèle estime le temps de trajet par `accès (3 min) + distance à vol d'oiseau / vitesse`, la
vitesse dépendant de la densité de population lissée sur 5 × 5 km (moyenne des deux carreaux).
Les paliers de vitesse (`VITESSE` dans `lib-e2sfca.mjs`, exportés dans `meta.modele.vitesse`) sont
calés sur les temps en voiture de **Valhalla**, le moteur de l'isochrone exacte du front :

| Densité lissée (hab/km²) | 28 | 102 | 438 | 1 987 | 7 911 |
|---|---|---|---|---|---|
| Vitesse à vol d'oiseau (km/h) | 25,3 | 29,3 | 30,7 | 21,6 | 15,4 |

Interpolation en log(densité) entre deux paliers, constante au-delà. Critère : dans chaque classe
de densité (< 50, 50–200, 200–1 000, 1 000–4 000, > 4 000), rapport médian temps Valhalla / temps du
modèle égal à 1 sur les paires que le modèle place entre 10 et 20 min (autour de la limite des
15 min, qui décide des zones), chaque paire pesant la population de son carreau d'arrivée.

```bash
node calage-vitesse.mjs --osrm         # 160 000 paires de carreaux, OSRM local (quelques minutes)
node calage-vitesse.mjs --valhalla     # 6 400 de ces paires, Valhalla public : lots de 40, 3 s de pause (~15 min)
node calage-vitesse.mjs --isochrones   # 51 isochrones de 15 min (Hall b + 10 points par classe), 5 s de pause
node calage-vitesse.mjs                # rapports avec la vitesse actuelle
node calage-vitesse.mjs --caler        # + paliers recalés, à reporter dans VITESSE
```

Mesures dans `data/` (`vitesse-paires.json`, `vitesse-valhalla.json`, `vitesse-isochrones.json`) ;
les deux dernières passent par le serveur public FOSSGIS (`VALHALLA_URL` pour un autre). L'OSRM
local sert le graphe de `../pipeline/osrm-data/` (voir `../pipeline/README.md`).

Ce que disent les mesures du 13/10/2026 :

- OSRM est 1,2 à 1,6 fois plus rapide que Valhalla sur les mêmes itinéraires (même kilométrage :
  OSRM ne pénalise ni carrefours ni ville). Avec OSRM, la zone de 15 min de Hall b compte 64 221
  habitants, contre 33 331 dans l'isochrone Valhalla de l'appli : le choix du moteur pèse autant
  que la vitesse elle-même. Valhalla est la référence parce que c'est le tracé que l'appli affiche.
- Contrôle indépendant : sur 50 points répartis par densité, la population de la zone de 15 min du
  modèle vaut 0,96 fois celle de l'isochrone Valhalla (médiane ; 0,90 à 1,02 selon la classe),
  contre 1,82 avec l'ancienne rampe (21–62 km/h).
- Un lieu isolé peut s'écarter de ±30 % : la vitesse ne dépend que de la densité, pas du réseau.
  Hall b est dans ce cas (0,71 : 23 523 habitants contre 33 331), car ses villages voisins sont
  reliés par des axes rapides (N113, A9, D40).
- Le modèle garde 3 min d'accès fixes ; Valhalla compte de 4 à 8 min à courte distance selon la
  densité. Le rapport vaut donc 1 autour de la limite des 15 min, mais le modèle est un peu plus
  lent que Valhalla au-delà de 8 km (hors des zones de 15 min).

Raffinement possible : remplacer `speedKmh` par les temps d'un moteur de routage (API `table`
d'un OSRM ou d'un Valhalla local) ; le reste du pipeline et le front sont inchangés.
