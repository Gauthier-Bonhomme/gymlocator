# Pipeline « trafic modélisé » (méthode B) — affectation des flux INSEE sur les vraies routes

But : router les ~35 500 trajets domicile-travail INSEE (>100 actifs) sur le **vrai réseau routier** (OSRM),
cumuler les passages **hors autoroutes**, et produire `assign.json` (grille de trafic + routes) que GymLocator charge.

> ⚠️ **À lancer UNE SEULE FOIS**, hors-ligne. Ensuite l'appli charge juste `assign.json` → instantané.
> Nécessite **Docker** (voir installation ci-dessous) + ~6 Go de disque + Node 18+.

---

## 0. Installer Docker Desktop (Windows) — à faire une fois
1. Télécharger **Docker Desktop** : https://www.docker.com/products/docker-desktop/
2. Lancer l'installateur, garder l'option **WSL 2** (déjà présent sur ta machine), **redémarrer** si demandé.
3. Ouvrir **Docker Desktop** (laisser tourner en fond), attendre que l'icône passe au vert.
4. Vérifier dans PowerShell : `docker --version` doit répondre.

## 1. Récupérer OSRM + la carte de France
Dans PowerShell, depuis ce dossier `pipeline/` :
```powershell
docker pull osrm/osrm-backend
mkdir osrm-data
# Extrait France (~4 Go) :
curl.exe -L -o osrm-data/france-latest.osm.pbf https://download.geofabrik.de/europe/france-latest.osm.pbf
```

## 2. Préparer le graphe routier (profil voiture, algo MLD — léger)
```powershell
docker run --rm -t -v "${PWD}/osrm-data:/data" osrm/osrm-backend osrm-extract   -p /opt/car.lua /data/france-latest.osm.pbf
docker run --rm -t -v "${PWD}/osrm-data:/data" osrm/osrm-backend osrm-partition  /data/france-latest.osrm
docker run --rm -t -v "${PWD}/osrm-data:/data" osrm/osrm-backend osrm-customize  /data/france-latest.osrm
```
(`osrm-extract` sur la France ≈ 10-30 min selon la machine ; RAM ~ quelques Go — OK avec 16 Go.)

## 3. Lancer le serveur de routage local (le laisser tourner)
```powershell
docker run --rm -t -p 5000:5000 -v "${PWD}/osrm-data:/data" osrm/osrm-backend osrm-routed --algorithm mld /data/france-latest.osrm
```
Test rapide (autre terminal) : `curl.exe "http://localhost:5000/route/v1/driving/4.83,45.76;2.35,48.85?overview=false"` → doit renvoyer du JSON.

## 4. Router + agréger → `assign.json`
Dans un AUTRE terminal, depuis `pipeline/` :
```powershell
node route-and-aggregate.mjs
```
Le script télécharge les flux INSEE, route chacun via OSRM local, **ignore les portions d'autoroute**,
cumule le passage sur une grille nationale + des segments de routes, et écrit `assign.json`.

## 5. Intégration (je m'en occupe à la prochaine session)
- Copier/commiter `assign.json` dans le repo `gymlocator`.
- `loadFlowV3()` chargera `assign.json` (au lieu du TMJA actuel) → modèle v3 « trafic modélisé ».
- Vérif : aucune autoroute, départementales présentes, heatmap/score cohérents.

---
Paramètres ajustables dans `route-and-aggregate.mjs` : seuil flux, filtre autoroute, plafond de segments routes.
