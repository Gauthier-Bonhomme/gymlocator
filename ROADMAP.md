# Feuille de route

Référence : **audit n° 2** du 25/09/2026, mené sur le commit `ba51947` (constats N1 à N9,
actions 1 à 8). Chaque étape se mesure avec `npm run audit` contre la référence figée, puis la
référence est refigée (`npm run audit:figer`, voir `build/README.md`).

## En cours

_Rien pour l'instant._

## Prochaines (dans cet ordre)

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
  zones à moins de 15 min d'une frontière (N9). Gex (Genève) et Wattrelos (frontière belge) entrent
  dans le top 20 après c.
- σ et zone de chalandise variables selon le territoire (2SFCA à zone variable). Les temps routiers
  de c ne le justifient pas seuls (ils mesurent la vitesse, pas la distance que les adhérents
  acceptent), mais la question presse : depuis c, 16,1 % de la demande n'a aucune salle à 15 min
  (6,2 % avant) et la zone d'un village tient dans 5 à 6 km. À trancher sur des trajets observés
  (codes postaux de Hall b en d, puis d'autres salles).
- Zone de Hall b sous-estimée : 23 523 habitants à 15 min contre 33 331 dans l'isochrone Valhalla
  (−29 %). La vitesse ne dépend que de la densité, et Hall b est reliée à Vergèze, Uchaud et Bernis
  par des axes rapides (N113, A9, D40). En d, mesurer sa zone et ses temps avec Valhalla plutôt
  qu'avec le modèle. Rattraper l'écart par la vitesse demanderait environ +7 % partout, soit des
  zones de 15 min environ 7 % trop peuplées dans le reste de la France (mesuré sur 50 isochrones).
- Temps routés à la place de la vitesse fonction de la densité (API `table` d'un OSRM ou d'un
  Valhalla local) : supprimerait ces écarts locaux de ±30 %. Choisir alors le moteur sur des
  trajets observés : OSRM est 1,2 à 1,6 fois plus rapide que Valhalla (Hall b : 64 221 habitants
  à 15 min selon OSRM).
- Accès fixe de 3 min contre 4 à 8 min d'ordonnée chez Valhalla selon la densité : le modèle est
  juste autour de la limite des 15 min mais 10 à 25 % plus lent que Valhalla au-delà de 8 km ;
  recaler l'accès (`accesMin`) et la vitesse ensemble.
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
- Rayons de recherche fixés à 13 km (15 min à 62 km/h, l'ancienne vitesse maximale) dans
  `lib-e2sfca.mjs`, `audit.mjs` et le front : avec 31 km/h au plus, 7 km suffisent, et le recalcul
  filtré du front irait environ 4 fois plus vite.

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

- [x] **c. Vitesse recalée par classe de densité lissée (N1, action 3)** : fait le 13/10/2026
  (commit `d30b24f`, pas encore publié : la CI régénère les couches après fusion). Outil de mesure :
  `build/calage-vitesse.mjs` (voir `build/README.md`).
  - Mesures : 159 461 paires de carreaux sur un OSRM local (graphe de `pipeline/osrm-data`), 6 380
    sur le serveur public Valhalla (lots de 40, 3 s de pause), 51 isochrones Valhalla de 15 min.
    Référence : Valhalla, le tracé exact que l'appli affiche et le témoin de Hall b. OSRM, 1,2 à
    1,6 fois plus rapide sur les mêmes itinéraires, aurait dit l'inverse en ville (modèle trop lent).
  - Avant : rapport médian temps Valhalla / temps du modèle de 1,85 (< 50 hab/km²), 1,56 (50–200),
    1,25 (200–1 000), 1,19 (1 000–4 000) et 1,20 (> 4 000). Le profil mesuré est en cloche : les
    campagnes de 100 à 500 hab/km² roulent plus vite que le rural très peu dense (relief, détours).
  - Après : paliers de 25,3 / 29,3 / 30,7 / 21,6 / 15,4 km/h à vol d'oiseau aux densités lissées
    médianes des classes (28, 102, 438, 1 987, 7 911 hab/km²), interpolés en log(densité) ; rapport
    médian 1,00 / 0,99 / 1,00 / 1,00 / 1,00 (paires que le modèle place à 10–20 min, pondérées par
    la population d'arrivée).
  - Contrôle indépendant, devenu contrôle d'audit : population de la zone de 15 min du modèle /
    isochrone Valhalla, médiane sur 50 points 1,82 → 0,96 (0,90 à 1,02 selon la classe).
  - Hall b : 54 773 → 23 523 habitants à 15 min, contre 33 331 dans l'isochrone : −29 %, hors de la
    cible de ±15 %. Écart local (axes rapides), non rattrapé pour ne pas fausser le reste de la France
    (voir « Plus tard »). σ variable : non justifié par ces mesures (voir « Plus tard »).
  - Effets (audit, sources du 13/10) : top 20 13/20 sites retrouvés, rang 0,846, Île-de-France
    6 → 8/20 ; sortent Sathonay-Camp, Chevreuse, Le Pont-de-Claix, Denain, Onnaing, Carpentras et
    Beautiran, entrent Eaubonne, Trappes, Yerres, Strasbourg, Gex, Wattrelos et Dagneux. Backtest
    pondéré 39,0 → 43,1, toujours sous le hasard (50). Demande sans salle à 15 min 6,2 → 16,1 % ; déficit relatif national +17,6 %. Audit vert
    5/5 ; référence refigée (celle d'avant c gardée dans `build/audit/_ref-1310-avant-c`).
- [x] **b. Audit n° 2, actions 1 et 2** : fait et publié le 13/10/2026 (commits `dc5aa22`,
  `f6509a8`, `cb25578` ; CI `c7ffa4e`). Log de la CI : les 6 réseaux au-dessus de leur seuil ;
  démo en ligne vérifiée : Hall b « 2 400 m² · réelle (exploitant) », « 1 600 · réels », 10 556
  salles. Mesuré sur les sources du 13/10, chaque action contre la référence figée juste avant.
  - Action 1 : vitesse sur la densité lissée 5 × 5 km (pipeline, audit, front) et « Zones
    sous-équipées » limitées aux carreaux habités. 16 → 1 des 30 meilleurs sites sur un carreau
    < 50 hab/km², 17/20 sites retrouvés. Backtest 44,2 → 39,0 : une part de l'ancien chiffre venait
    des carreaux vides de zone commerciale, qui roulaient à 62 km/h. Zone de Hall b plus grande (c).
  - Action 2 : SIRENE 93.11Z, 93.12Z et 85.51Z filtrés par nom, franchisés reconnus par SIREN connu
    ou OpenStreetMap, clubs OSM manquants ajoutés, doublons de chaîne réduits, garde-fou de CI
    `reseaux.mjs`. 10 045 → 10 556 salles, capacité +10,5 % ; Fitness Park 199 → 323, Keep Cool
    150 → 244, On Air 39 → 89, L'Appart Fitness 44 → 94, L'Orange Bleue 317 → 444, Basic-Fit
    935 → 928 ; 12/20 sites retrouvés ; Hall b inchangée (2 400 m², 1 600 adhérents).
  - Réserves acceptées : Keep Cool sous les 250 visés (244, seuil de CI gardé à 230, exception
    commentée dans `reseaux.mjs` ; voir « Plus tard ») ; 2 sites sur 30 sur un carreau quasi vide
    après l'action 2, des maxima plats connus (n° 10 près de Bonneville, n° 16 près de
    Condé-sur-l'Escaut) : seuil du contrôle d'audit passé à 2/30, corrections non appliquées car
    caduques avec l'étape 5.
- [x] **a. Corriger Hall b dans l'offre** : 2 400 m², 1 600 adhérents réels (table `REELLES` de
  `build/02-supply.mjs`, référence d'audit refigée). Fait et publié le 13/10/2026 (CI `9bf37a6`),
  vérifié sur la démo en ligne : « 2 400 m² · réelle (exploitant) », « 1 600 · réels ».
  Effet mesuré par l'audit (sources du 25/09) : la zone de Hall b passe de 83 % à 115 % de la
  couverture nationale (« au niveau de la moyenne nationale ou au-dessus ») ; ses 1 600 adhérents
  valent 42 % des 3 815 adhérents potentiels que le modèle place à 15 min, ce que c et d doivent
  éclairer.
