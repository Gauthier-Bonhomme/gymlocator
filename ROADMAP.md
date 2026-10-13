# Feuille de route

Référence : **audit n° 2** du 25/09/2026, mené sur le commit `ba51947` (constats N1 à N9,
actions 1 à 8). Chaque étape se mesure avec `npm run audit` contre la référence figée, puis la
référence est refigée (`npm run audit:figer`, voir `build/README.md`).

## En cours

- [ ] **b. Audit n° 2, actions 1 et 2**
  - Densité lissée pour la vitesse (fenêtre 5 × 5 km : `lib-e2sfca.mjs`, `audit.mjs`, front) et
    candidats sans habitant interdits dans « Zones sous-équipées » (N2).
  - Offre complétée : NAF 93.11Z, 93.12Z et 85.51Z filtrés par nom, franchisés reconnus par nom
    ou par OpenStreetMap (`brand`, `leisure=fitness_centre`), assertions de CI sur la taille des
    réseaux (Keep Cool ≥ 250, Fitness Park ≥ 280…) (N3).

## Prochaines (dans cet ordre)

- [ ] **c. Recaler la vitesse rurale (N1), avant le calibrage et l'étape 5** : hors agglomération,
  le modèle roule 1,4 à 1,8 fois trop vite par rapport à OSRM ; recaler `meta.modele.vitesse` par
  classe de densité (action 3). Sans ce recalage, d et e partiraient d'une zone rurale environ
  70 % trop peuplée (zone 15 min de Hall b : 38 321 habitants, environ 22 000 à 38 km/h).
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

- [x] **a. Corriger Hall b dans l'offre** : 2 400 m², 1 600 adhérents réels (table `REELLES` de
  `build/02-supply.mjs`, référence d'audit refigée). Fait et publié le 13/10/2026 (CI `9bf37a6`),
  vérifié sur la démo en ligne : « 2 400 m² · réelle (exploitant) », « 1 600 · réels ».
  Effet mesuré par l'audit (sources du 25/09) : la zone de Hall b passe de 83 % à 115 % de la
  couverture nationale (« au niveau de la moyenne nationale ou au-dessus ») ; ses 1 600 adhérents
  valent 42 % des 3 815 adhérents potentiels que le modèle place à 15 min, ce que c et d doivent
  éclairer.
