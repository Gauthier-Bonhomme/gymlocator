# Feuille de route

**Aucun résultat comparant le modèle aux adhérents réels de Hall b dans le dépôt : tout va dans docs-private/.**

Référence : **audit n° 2** du 25/09/2026, mené sur le commit `ba51947` (constats N1 à N9,
actions 1 à 8). Chaque étape se mesure avec `npm run audit` contre la référence figée, puis la
référence est refigée (`npm run audit:figer`, voir `build/README.md`).

## En cours

- [ ] **Publier les couches de la seconde moitié de e** (voir « Fait ») : la branche
  `interface/classement-capture` est fusionnée dans main et poussée (14/10/2026, `fead042`), mais la
  publication des couches attend un Data ES complet. La CI (`05-capture.mjs`) doit publier le bloc
  `capture` de `meta.json` (paramètres et rang national) ; d'ici là, le front en ligne tourne sur ses
  valeurs de repli, sans rang national (vérifié le 14/10 : classement, clic, zone exacte, console).
  - Data ES tronqué côté ministère le 14/10/2026 : l'API ne renvoyait que 183 enregistrements sur les
    334 380 annoncés, dont 15 salles de musculation (≈ 7 991 en temps normal). La CI relancée ce
    jour-là a échoué (une première fois sur Overpass) sans rien publier.
  - `02-supply.mjs` échoue désormais explicitement, avant tout calcul et toute écriture, sous 5 000
    équipements Data ES ; jusqu'ici, seul le seuil d'un réseau (L'Appart Fitness, 89 < 90) l'avait
    arrêté.
  - Relancer la CI seulement quand Data ES annonce de nouveau au moins 300 000 enregistrements
    (`https://equipements.sports.gouv.fr/api/explore/v2.1/catalog/datasets/data-es/records?limit=0`),
    puis vérifier : audit vert 7/7 contre les couches publiées, démo (rang national compris, mobile).

## Prochaines (dans cet ordre)

- [ ] **e. Reste : revenu pondéré** dans le modèle de capture (élasticité au revenu mesurée en d, forte
  et peu précise).
  - Rappel : avec un seul club, la validation est circulaire. Les paramètres de d et de e viennent
    de Hall b ; les retrouver sur Hall b ne prouve rien. Il faut d'autres salles (« Calibrer aussi
    sur une ou deux autres salles », dans « Plus tard »).

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
- Temps routés à la place de la vitesse fonction de la densité (API `table` d'un OSRM ou d'un
  Valhalla local) : supprimerait les écarts locaux de ±30 % (Hall b : −29 %). Choisir alors le
  moteur sur des trajets observés : OSRM est 1,2 à 1,6 fois plus rapide que Valhalla (Hall b :
  64 221 habitants à 15 min selon OSRM).
- Accès fixe de 3 min contre 4 à 8 min d'ordonnée chez Valhalla selon la densité : le modèle est
  juste autour de la limite des 15 min mais 10 à 25 % plus lent que Valhalla au-delà de 8 km ;
  recaler l'accès (`accesMin`) et la vitesse ensemble.
- Facteurs de site absents : visibilité, stationnement, loyer, zone commerciale.

### Modèle de capture (étape e)

- Pratique implicite très contrastée selon la densité : avec les paramètres centraux, P S / (W_0 + S)
  vaut 0,9 % des habitants sous 50 hab/km² (6,2 M d'habitants), 3,4 % de 50 à 200, 10 % de 200 à 1 000,
  15 % de 1 000 à 4 000 et 16 % au-delà. Les salles existantes ne recevraient que 17 % de leur capacité
  sous 50 hab/km² (210 salles), 46 % de 50 à 200, contre 116 % au-delà de 4 000. Le noyau, calé sur un
  club périurbain, est sans doute trop court pour la campagne, ou le non-recours devrait dépendre du
  territoire. À confronter à la pratique par taille de commune (enquêtes INJEP, fédérations) : ce
  second ancrage fixerait aussi W_0, que seul le taux national (10 %) fixe aujourd'hui. Un projet
  isolé garde une capture élevée par habitant (29 à 42 ‰ des habitants à 30 min à Guéret, Mende et
  Langeac) : il est limité par sa population, pas écrasé.
- Non-recours W_0 : un point de pratique nationale en plus ou en moins le déplacerait d'environ 100
  à 900. Un deuxième club, d'une autre taille ou dans une autre concurrence, le départagerait.
- Zone exacte : le projet a ses temps Valhalla, les concurrents ceux du modèle. Autour de Hall b,
  les temps Valhalla valent 0,82 fois ceux du modèle ; appliquer ce rapport aux concurrents réduit
  nettement la capture prédite. Des temps routés pour les concurrents (matrice
  d'un OSRM ou d'un Valhalla local) lèveraient cette asymétrie. Calé avec ce rapport, le modèle
  donnerait plus de 12 % de pratique nationale : le calage garde les temps du modèle.
- Attractivité : deux densités seulement (premium 0,67 adh/m², venue de Hall b ; 1,4 pour tous les
  autres). Les low-cost tiennent sans doute plus d'adhérents au m² ; à caler sur d'autres clubs.
- Suivre dans l'audit les adhérents attendus de Hall b (`capture.mjs --hallb`) et le test sur 12 sites
  (`capture.mjs --sites`).
- Classement national dominé par l'Île-de-France (18 des 20 premiers sites au 14/10/2026, projet
  premium de 2 000 m²) : un marché de 400 000 à 1,5 million d'habitants à 30 min l'emporte malgré la
  concurrence. En ville, la pratique maximale et le poids des concurrents ne sont pas identifiés
  (fourchettes de 1 300 à 4 800 dans ce top 20) : à confronter à un club urbain.
- Rang national quand la légende retire des salles : la distribution publiée suppose toute l'offre,
  le front n'affiche alors pas de rang. La recalculer dans le navigateur (~10 s) le permettrait.

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

- Robustesse des meilleurs sites aux tirages de capacité de l'offre (`run()` d'`audit.mjs`) : elle
  ne couvre aujourd'hui que les paramètres du modèle de capture (action 7).
- Carte des adhérents attendus : la carte montre toujours le déficit relatif, le classement et le clic
  les adhérents attendus du projet. Une vue « Adhérents attendus » rendrait les trois cohérents.
- Permalien du projet (taille, segment, seuil), comme celui de la vue.
- Zone exacte et analyse de zone demandent chacune leurs isochrones Valhalla : partager le contour de
  15 min (une requête de moins).
- `meta.json` et `gyms.json` sont chargés sans paramètre de version (`grid.bin.gz?v=3` en a un) :
  après un rafraîchissement, un navigateur peut garder l'ancien `meta.json` quelques minutes (constaté
  en local le 14/10/2026), et le front tourne alors sur ses valeurs de repli. Ajouter la date de
  génération à l'URL.
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
- `02-supply.mjs` dépend encore de l'ordre de l'export SIRENE (premier de deux doublons gardé…).
  Cet export n'a pas bougé (fichiers identiques au 25/09, au 13/10 et au 14/10), mais le trier par
  SIRET déplacerait aujourd'hui 57 clubs : fixer d'abord des règles de départage explicites.
- Audit : avec le même nombre de salles, une offre locale différente de l'offre publiée s'affiche
  « 03 et cet outil ne calculent plus la même chose ». Comparer d'abord à `gyms.json` pour dire
  « sources différentes » plutôt que « code divergent ».

## Fait

- [x] **e, seconde moitié : le modèle de capture dans l'interface** : fait le 14/10/2026 sur la branche
  `interface/classement-capture`, un commit par point, fusionnée dans main et poussée le même jour
  (couches pas encore publiées, voir « En cours »). Vérifié dans le navigateur (ordinateur et
  mobile), console sans erreur.
  1. **Meilleurs sites pour un club de X m²** à la place de « Zones sous-équipées » : sites de la vue
     classés sur les adhérents attendus du modèle de capture (mode national), à au moins 2 km l'un de
     l'autre, jamais sur un carreau sans habitant ; taille 1 200 / 2 000 / 2 400 m² (défaut 2 000) et
     segment premium / classique réglables ; la concurrence suit les filtres de la légende. Recherche
     grossière puis fine (`classerSites`), validée contre le calcul exhaustif : même top 20 dans le
     même ordre sur la France et cinq régions ; France entière en 1 à 3 s dans le navigateur. Le front
     redonne le classement de `capture.mjs --classement` (valeurs à 0,02 % près, arrondis de `grid.bin`).
  2. **Fourchette et robustesse** pour chaque site : 9 variantes (3 jeux de `FAMILLE` × concurrents
     × 0,5 / 1 / 2) ; robustesse = variantes où le site reste dans le top 20 de la vue. Filtre
     « adhérents attendus ≥ seuil », 1 600 par défaut.
  3. **Clic** : même estimation avec fourchette pour le projet réglé. Bouton **Zone exacte** : six
     isochrones Valhalla de 5 à 30 min, une requête par contour, en file espacée de 1,5 s (partagée avec
     l'analyse de zone), gardées 180 jours dans le navigateur ; mêmes 430 carreaux et même estimation
     que `capture.mjs --exacte` sur les isochrones de Hall b en cache.
  4. **Score /100 et libellés « élevé / très élevé » supprimés** : le clic s'ouvre sur l'estimation en
     adhérents, sa fourchette et son **rang national** (« mieux que N % des carreaux habités »), tiré
     de la distribution que `05-capture.mjs` publie dans `meta.json` (6 projets, tous les carreaux
     habités, ~15 s en CI) ; pas de rang quand la légende retire des salles.
  5. **Mentions** à côté de chaque estimation et dans la modale : modèle ajusté sur un seul club, pas
     de second club de validation, loyer, visibilité, parking et population de jour non modélisés,
     outil de présélection.
  6. **Audit adapté au nouveau classement** : ses « meilleurs sites » sont désormais ceux du front
     (projet premium de 2 000 m², France, à 2 km), avec fourchette et robustesse ; les maxima du déficit
     de zone (l'ancien proxy de « Zones sous-équipées ») ne servent plus qu'à la sensibilité de la
     carte. Le contrôle « au plus 2 des 30 maxima sur un carreau < 50 hab/km² » est remplacé par trois
     contrôles du classement : aucun site sur un carreau sans habitant, espacement de 2 km, recherche
     grossière-fine identique au calcul exhaustif. Stabilité du classement mesurée contre la référence
     (champ figé dans `reference-capture.bin.gz`). Audit vert 7/7 ; référence refigée (l'ancienne dans
     `build/audit/_ref-1410-avant-classement`).
  - Mesures (14/10/2026, projet premium de 2 000 m², France) : n° 1 près d'Aulnay-sous-Bois, 3 122
    adhérents attendus (fourchette 1 809 – 4 789, robustesse 9/9) ; 18 des 20 premiers en
    Île-de-France ; robustesse médiane 7/9 ; 2 292 carreaux habités (0,6 %) atteignent 1 600 ; aucun
    des 30 premiers sur un carreau de moins de 50 habitants.
- [x] **e, suite : option « pas de salle » dans le modèle de capture** : fait le 14/10/2026 sur la
  branche `modele/capture-non-recours`, fusionnée dans main et poussée le même jour, sans CI : ni les
  couches ni le front ne changent. Audit vert 5/5 sur les couches publiées (CI `ad5db51`) après la
  fusion. `build/lib-capture.mjs`, `build/capture.mjs` (nouveau test `--sites`) et nouvel outil
  `build/calage-capture.mjs` (voir `build/README.md`) ; le classement des zones ne change pas.
  - **Option « pas de salle »** : part captée = W_p f / (W_0 + W_p f + k Σ W_g f). Le non-recours W_0
    (« ne s'inscrire nulle part ») fait baisser la part captée avec la distance, même sans concurrent :
    un village sans salle à 30 min ne revient plus en entier au projet. Le marché devient la pratique
    maximale P des habitants ; le taux de pratique d'un carreau vaut P S / (W_0 + S), S = Σ W f.
  - **Calage** : noyau, P et W_0 ajustés ensemble sur la répartition des adhérents de Hall b par bande
    de temps Valhalla (mesure privée, hors du dépôt). La prédiction est lissée par code postal comme le
    réel (Base Adresse Nationale) : sans ce lissage, la comparaison favorisait à tort un noyau plus
    étalé. Le cœur et la queue de 20–30 min, nettement surestimée par le Huff pur, collent désormais
    dans la marge de la surdispersion.
  - **Identifiable avec un seul club** : la pénétration de Hall b au pied du club et la distance où elle
    est divisée par deux, pas leur partage entre noyau, P et W_0, qui se compensent. Même un Huff pur au
    noyau recalé passe sur Hall b. W_0 est donc fixé hors de Hall b, par le taux de pratique national de
    la demande (10 %) avec toutes les salles existantes.
  - **Paramètres retenus** (`FAMILLE`, `lib-capture.mjs`) : central **W_0 = 400, t50 = 5,0 min, β = 3,4,
    P = 17,8 %** (pratique nationale 10,0 %). Encadrement, équivalent pour Hall b : W_0 = 200 (t50 4,6
    min, P 15,2 %, pratique nationale 9,4 %) et W_0 = 800 (5,5 min, 21,5 %, 10,8 %). Coupure 30 min et
    attractivité inchangées (premium 0,67, classique 1,4 adh/m²). La fourchette de `capture.mjs` croise
    ces trois jeux avec le poids des concurrents (× 0,5, 1 et 2).
  - **Tests** (chiffres hors du dépôt, dans `docs-private/`) : sur Hall b, le test reste circulaire
    (noyau, P, W_0 et densité premium en viennent, et en zone exacte son total est fixé par le calage) ;
    les trois jeux y donnent le même résultat et le poids des concurrents pèse le plus. Sur 12 sites
    (`npm run capture:sites`, projet premium de 2 000 m²), le premier site isolé passe du 3ᵉ au 9ᵉ rang,
    et reste au mieux 8ᵉ sur les 9 variantes de la fourchette : Langeac passe du 3ᵉ au 11ᵉ rang, Guéret du
    5ᵉ au 9ᵉ. Le Huff pur au noyau recalé remet Langeac 4ᵉ : c'est bien le non-recours qui corrige.
  - **Réserves** :
    - pratique implicite très contrastée selon la densité (0,9 % des habitants sous 50 hab/km², 16 %
      au-delà de 4 000) et salles rurales existantes prédites très en dessous de leur capacité : le noyau
      est sans doute trop court pour la campagne (voir « Plus tard ») ;
    - fourchette très large en ville : la pratique maximale et le poids des concurrents ne sont pas
      identifiés par un club périurbain peu concurrencé ;
    - W_0 ne tient qu'au taux de pratique national : un point de plus ou de moins le déplacerait
      d'environ 100 à 900 ;
    - calage fait avec les concurrents aux temps du modèle : à la vitesse locale relevée autour de
      Hall b, la pratique nationale ne descendrait jamais sous 12 % ;
    - un seul club : la validation reste circulaire.
- [x] **e, première moitié. Modèle de capture d'un projet** : fait le 14/10/2026 sur la branche
  `modele/capture-projet`, fusionnée et publiée le même jour (CI `ad5db51`).
  `build/lib-capture.mjs` et `build/capture.mjs` (voir
  `build/README.md`) ; ni l'interface, ni les couches, ni le classement ne changent.
  - Adhérents attendus = Σ habitants × pénétration × part captée (Huff) sur les carreaux à ≤ 30 min ;
    part captée = W_p f(t) / (W_p f(t) + Σ concurrents W_g f(t_g)), noyau premium de d
    (log-logistique, t50 = 7,3 min, β = 4, coupure 30 min) pour tous ; pénétration 114 ‰ des
    habitants ; attractivité W = surface × adhérents/m² du segment (premium 0,67, classique 1,4).
  - Temps : modèle calé en mode national ; isochrones Valhalla de 5 à 30 min pour le projet en mode
    « zone exacte » (populations du 14/10 : 33 321 habitants à 15 min, 222 658 à 30 min).
  - Hall b classée premium dans l'offre (segment de l'exploitant, table `REELLES`) : premium
    136 → 137 clubs, capacité et couches inchangées ; 04 exige une enseigne pour ses « chaînes »
    (n = 506, inchangé).
  - **Test sur Hall b et sensibilité à son site** : comparés aux adhérents réels, résultats détaillés
    dans `docs-private/`. Ce test est **en partie circulaire** : le noyau, la pénétration et la
    densité premium viennent tous de Hall b ; il ne valide pas le modèle.
  - Ailleurs (premium 2 000 m², mode national, central) : centre de Paris 740, Dijon 898,
    Montpellier 1 002, Grenoble 1 028, Mende 820, Guéret 1 076, site n° 1 de la carte (Bagneux)
    1 678. Guéret, comme Hall b, tire 30 % de ses adhérents de 20–30 min (voir la suite de e :
    option « pas de salle »).
- [x] **grid.bin reproductible** : fait le 14/10/2026 (même branche). L'audit était rouge sur sa
  reproduction (écart max 3) alors que les sources ne changeaient pas : l'API Data ES exporte les
  mêmes lignes dans un ordre variable (1 100 sur 7 991 déplacées entre le 13 et le 14/10), et 02
  prenait la position, le propriétaire et le nom d'une installation à sa première ligne. Deux
  téléchargements identiques donnaient 5 à 8 installations différentes.
  - Vérifié : 03 recalcule à l'octet près le `grid.bin` de la CI (`9b20d32`) à partir de l'offre
    qu'elle a publiée (Node 24 sous Windows contre Node 20 sous Linux) ; Filosofi et SIRENE
    retéléchargés sont identiques à l'octet, OSM ne diffère que d'un nœud déplacé de 0,5 m.
  - Correctif : Data ES trié par numéro d'équipement. L'export du 13/10, celui du 14/10 et trois
    mélanges aléatoires donnent la même offre. Effet : 15 installations déplacées de quelques mètres
    ou reclassées asso / classique, capacité inchangée, déficit national −5, backtest inchangé,
    carte stable (rang 1,000, 20/20). Audit vert 5/5 sur les couches régénérées ; référence refigée
    sur les sources du 14/10 (l'ancienne dans `build/audit/_ref-1310-apres-c`).
  - Publié (CI `ad5db51`) : l'offre et le `grid.bin` de la CI sont identiques à l'octet à ceux
    régénérés en local, et l'audit est vert 5/5 contre les couches publiées, sans régénération.
- [x] **d. Décroissance et pénétration calées sur les adhérents de Hall b** : fait le 13/10/2026.
  La mesure détaillée reste hors du dépôt public (`docs-private/`, non versionné). Paramètres
  **premium** proposés, propres à un club haut de gamme et **non appliqués** : le modèle garde la
  gaussienne σ = 6 min coupée à 15 min pour tous les clubs.
  - Décroissance log-logistique f(t) = 1 / (1 + (t / t50)^β), t50 = 7,3 min, β = 4 (temps en
    voiture Valhalla).
  - Coupure : 30 min.
  - Pénétration : 114 ‰ des habitants au pied du club (adhérents attendus = 0,114 × Σ habitants
    × f(t), hors concurrence).
- [x] **c. Vitesse recalée par classe de densité lissée (N1, action 3)** : fait et publié le
  13/10/2026 (commit `d30b24f` ; CI `9b20d32` : 10 556 salles, 6 réseaux au-dessus de leur seuil,
  backtest 43,6). Démo en ligne vérifiée : modale Méthode « calée sur les temps en voiture de
  Valhalla […] de 15 à 31 km/h à vol d'oiseau », backtest 44 ; analyse de zone sur Hall b :
  ~23 533 habitants en estimation, ~33 331 en tracé Valhalla. Outil de mesure :
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
    cible de ±15 %. Écart local (axes rapides). Calage national gardé (décision de Gauthier) :
    rattraper Hall b demanderait environ +7 % de vitesse partout, soit des zones de 15 min environ
    7 % trop peuplées ailleurs (mesuré sur 50 isochrones) ; sa zone se mesurera avec Valhalla en d.
    σ variable : non justifié par ces mesures (voir « Plus tard »).
  - Effets (audit, sources du 13/10) : top 20 13/20 sites retrouvés, rang 0,846, Île-de-France
    6 → 8/20 ; sortent Sathonay-Camp, Chevreuse, Le Pont-de-Claix, Denain, Onnaing, Carpentras et
    Beautiran, entrent Eaubonne, Trappes, Yerres, Strasbourg, Gex, Wattrelos et Dagneux. Backtest
    pondéré 39,0 → 43,1, toujours sous le hasard (50). Demande sans salle à 15 min 6,2 → 16,1 % ;
    déficit relatif national +17,6 %. Audit vert 5/5 ; référence refigée (celle d'avant c gardée
    dans `build/audit/_ref-1310-avant-c`).
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
  couverture nationale (« au niveau de la moyenne nationale ou au-dessus »). Comparaison avec les
  adhérents réels : résultats détaillés dans `docs-private/`.
