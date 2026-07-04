# pipeline/ — OBSOLÈTE (ancien modèle « trafic v3 »)

L'affectation des flux domicile-travail sur le réseau routier (v3) a été **abandonnée**
lors de la refonte de juillet 2026 : le terme « passage » confondait taille de marché
et qualité de site (voir la modale Méthode de l'application et `build/README.md`).

Le pipeline actuel vit dans **`../build/`** (E2SFCA sur carroyage INSEE).

## Pourquoi ce dossier existe encore

`osrm-data/` contient le **graphe routier France pré-calculé pour OSRM** (~15 Go,
non versionné). Il est conservé car c'est exactement l'outil nécessaire au
raffinement prévu du modèle : remplacer la vitesse analytique de
`../build/lib-e2sfca.mjs` par de vrais temps de trajet via l'API `table` d'OSRM
(serveur local : `docker run --rm -t -p 5000:5000 -v "${PWD}/osrm-data:/data"
osrm/osrm-backend osrm-routed --algorithm mld /data/france-latest.osrm`).

Si ce raffinement ne vous intéresse plus, ce dossier peut être supprimé sans risque.
