# Feuille de route

Référence : **audit n° 2** du 25/09/2026, mené sur le commit `ba51947` (constats N1 à N9,
actions 1 à 8). Chaque étape se mesure avec `npm run audit` contre la référence figée, puis la
référence est refigée (`npm run audit:figer`, voir `build/README.md`).

## En cours

_Rien pour l'instant._

## Prochaines (dans cet ordre)

- [ ] **c. Recaler la vitesse rurale (N1), avant le calibrage et l'étape 5** : hors agglomération,
  le modèle roule 1,4 à 1,8 fois trop vite par rapport à OSRM, et le lissage de la densité (b)
  accélère encore les cœurs de village : la zone 15 min de Hall b compte 54 773 habitants modélisés
  (38 321 avant b), contre 33 331 dans l'isochrone routière Valhalla. Recaler `meta.modele.vitesse`
  par classe de densité lissée (action 3) ; sans cela, d et e partiraient d'une zone rurale bien
  trop peuplée.
- [ ] **d. Calibrer la décroissance et la pénétration** sur les codes postaux des adhérents de
  Hall b (prérequis : c, et l'export depuis le logiciel de gestion).
- [ ] **e. Étape 5** (Huff, verdict absolu) : taille de projet réglable (défaut 2 000 m², objectif
  1 600 adhérents ou plus), segment haut de gamme, revenu pondéré.

## Plus tard

Le reste de l'audit n° 2, sans ordre.

### Demande et zones de chalandise

- Population de jour (flux MOBPRO) : en proche banlieue, on s'entraîne aussi près du travail (N5).
- Structure par âge recalée sur le recensement communal : Filosofi compte les étudiants chez
  leurs parents (N4).
- Frontières : ni les salles ni les emplois étrangers ne sont comptés ; signaler à l'écran les
  zones à moins de 15 min d'une frontière (N9).
- σ et zone de chalandise variables selon le territoire (2SFCA à zone variable).
- Facteurs de site absents : visibilité, stationnement, loyer, zone commerciale.

### Offre

- Doublons candidats : 468 salles Data ES privées non appariées à moins de 300 m d'un
  établissement SIRENE, 4,2 % de la capacité (N3).
- Micro-structures sur-comptées : 8 037 salles hors municipales contre 5 800 à 6 000 clubs
  estimés par la profession ; 2 843 indépendants sans salarié pèsent 14,7 % de la capacité (N3).
- 1,4 adhérent/m² pour tous les formats : Hall b réelle est à 0,67 adh/m² (1 600 adhérents pour
  2 400 m²) ; distinguer capacité et adhérents.
- Concurrence à 15 min de Hall b à vérifier (vers Sommières, Caveirac, l'ouest de Nîmes).
- Keep Cool : 244 clubs attestés pour 294 publiés, seuil de CI abaissé à 230 (`reseaux.mjs`). Il
  manque des clubs absents de SIRENE, de Data ES et d'OpenStreetMap, 5 sociétés « KC » sans salarié
  ni équipement Data ES (Angers, La Chapelle-sur-Erdre, Houssen, Lambersart, Nancy Saint-Nicolas)
  et les clubs de la Réunion. Une source de plus (localisateur de l'enseigne, All The Places)
  permettrait de remonter le seuil à 250.
- Réseaux au-dessus du chiffre publié : L'Orange Bleue 444 pour 400, Basic-Fit 928 pour 894
  (sièges et clubs fermés encore actifs dans SIRENE ; 24 salles Data ES de chaîne à 0,5–2 km d'un
  club SIRENE de même enseigne, surtout dans des villes qui en comptent plusieurs).
- Anciens clubs Amazonia repris par Elancia ou L'Appart Fitness (sociétés AMAZ, AZA) : encore
  étiquetés Amazonia, faute de SIREN connu de la nouvelle enseigne.
- Clubs ajoutés depuis OpenStreetMap (138) : sans date d'ouverture, ils comptent dans l'offre
  « antérieure » du backtest, comme les 86 installations Data ES de N6.

### Classement et affichage

- Classer sur les adhérents captés plutôt que sur la somme du déficit : effet de taille, double
  lissage de A puis de UZ sur environ 30 min (N5).
- Score /100 : percentile national ou suppression, libellés indexés sur le verdict ; il dit
  « élevé » pour 55 % de la demande (N7).
- Robustesse de chaque zone repérée : part des variantes et des tirages de capacité où elle
  reste en tête (`run()` d'`audit.mjs`) (action 7).
- Interpolation de la carte renormalisée : −11 % d'intensité en bordure de zone habitée,
  792 salles concernées (N9).
- « Petit bassin » calculé sur la demande pondérée ; dire à l'écran qu'Aref est recalculé quand
  on filtre (N9).
- Sites sur un carreau quasi vide : 2 des 30 meilleurs sites après l'action 2 (au plus 1 visé).
  Ce ne sont plus des artefacts de vitesse mais des maxima plats : n° 10 près de Bonneville, le
  carreau habité voisin a 97 % du même déficit ; n° 16 près de Condé-sur-l'Escaut, son voisin plus
  fort est écarté par la règle des 20 km. Deux corrections chiffrées : ne compter comme site qu'un
  maximum local à 2 km dans `audit.mjs` (1/30), ou départager à 3 % près par la population dans
  « Zones sous-équipées » et dans l'audit (0/30, 29 zones sur 30 inchangées).

### Validation

- Survie sur le stock historique SIRENE de l'Insee, hors reprises et transferts, stratifiée par
  densité (N6).
- Fuite du backtest : 86 installations Data ES mises en service en 2023 ou après restent dans
  l'offre « antérieure » (N6).
- Calibrer aussi sur une ou deux autres salles (méthode des analogues).

### Documentation et outillage

- README : « validée par backtest » alors que le backtest dit l'inverse ; `grid.bin` décrit en
  Float32 (c'est de l'Uint16) ; tailles 2,4 / 4,5 Mo (2,8 / 5,2 aujourd'hui) (N9).
- Valeurs réelles ignorées par deux filtres : la variante « adhérents/m² par type de salle »
  d'`audit:sensibilite` recalcule Hall b depuis sa surface, et « surface connue » de
  `04-backtest.mjs` ne retient que `dataes`.

## Fait

- [x] **b. Audit n° 2, actions 1 et 2** (13/10/2026, commits `dc5aa22` et `f6509a8`, branche
  `audit2/actions-1-2`). Mesuré sur les sources du 13/10, chaque action contre la référence figée
  juste avant.
  - Action 1 : vitesse sur la densité lissée 5 × 5 km (pipeline, audit, front) et « Zones
    sous-équipées » limitées aux carreaux habités. 16 → 1 des 30 meilleurs sites sur un carreau
    < 50 hab/km², 17/20 sites retrouvés. Backtest 44,2 → 39,0 : une part de l'ancien chiffre venait
    des carreaux vides de zone commerciale, qui roulaient à 62 km/h. Zone de Hall b plus grande (c).
  - Action 2 : SIRENE 93.11Z, 93.12Z et 85.51Z filtrés par nom, franchisés reconnus par SIREN connu
    ou OpenStreetMap, clubs OSM manquants ajoutés, doublons de chaîne réduits, garde-fou de CI
    `reseaux.mjs`. 10 045 → 10 556 salles, capacité +10,5 % ; Fitness Park 199 → 323, Keep Cool
    150 → 244, On Air 39 → 89, L'Appart Fitness 44 → 94, L'Orange Bleue 317 → 444, Basic-Fit
    935 → 928 ; 12/20 sites retrouvés ; Hall b inchangée (2 400 m², 1 600 adhérents).
  - Réserves (voir « Plus tard ») : Keep Cool sous le seuil demandé (244 < 250, seuil fixé à 230) ;
    2 sites sur 30 sur un carreau quasi vide après l'action 2.
- [x] **a. Corriger Hall b dans l'offre** : 2 400 m², 1 600 adhérents réels (table `REELLES` de
  `build/02-supply.mjs`, référence d'audit refigée). Fait et publié le 13/10/2026 (CI `9bf37a6`),
  vérifié sur la démo en ligne : « 2 400 m² · réelle (exploitant) », « 1 600 · réels ».
  Effet mesuré par l'audit (sources du 25/09) : la zone de Hall b passe de 83 % à 115 % de la
  couverture nationale (« au niveau de la moyenne nationale ou au-dessus ») ; ses 1 600 adhérents
  valent 42 % des 3 815 adhérents potentiels que le modèle place à 15 min, ce que c et d doivent
  éclairer.
