# pipeline/ — OBSOLÈTE (ancien modèle « trafic v3 »)

L'affectation des flux domicile-travail sur le réseau routier (v3) a été **abandonnée**
lors de la refonte de juillet 2026 : le terme « passage » confondait taille de marché
et qualité de site (voir la modale Méthode de l'application et `build/README.md`).

Le pipeline actuel vit dans **`../build/`** (E2SFCA sur carroyage INSEE).

## Pourquoi ce dossier existe encore

`osrm-data/` contient le **graphe routier France pré-calculé pour OSRM** (~15 Go,
non versionné, OpenStreetMap du 01/07/2026, construit par OSRM v26.6.5). Il sert à
`../build/calage-vitesse.mjs` (mesure de la vitesse du modèle contre des temps routiers)
et servirait au raffinement possible du modèle : remplacer la vitesse fonction de la
densité de `../build/lib-e2sfca.mjs` par de vrais temps de trajet via l'API `table`.

Serveur local (même version que le graphe ; `--mmap` évite de charger ~8 Go en mémoire) :

```bash
docker run -d --name osrm-fr -p 5000:5000 -v "${PWD}/osrm-data:/data:ro" \
  ghcr.io/project-osrm/osrm-backend:v26.6.5-debian osrm-routed --algorithm mld --mmap --max-table-size 2000 /data/france-latest.osrm
```

Si ces usages ne vous intéressent plus, ce dossier peut être supprimé sans risque.
