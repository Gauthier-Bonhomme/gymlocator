// Affectation des flux domicile-travail INSEE sur le réseau routier (OSRM local) → assign.json
// Prérequis : OSRM tourne sur http://localhost:5000 en MLD (voir README.md). Node 18+ (fetch natif).
// À lancer UNE fois, hors-ligne. Sortie : assign.json (grille de trafic modélisé + segments de routes).
//
// Qualité :
//  - Autoroutes exclues DÈS le routage via OSRM `exclude=motorway` (profil car.lua standard, classe
//    excluable "motorway"+"motorway_link"). Les trajets suivent donc les départementales de bout en
//    bout → aucun "trou" dans les corridors (contrairement à router-avec-autoroute-puis-jeter).
//  - Segments de routes agrégés à précision fine (5 décimales ≈ 1 m) : les vraies lignes sont
//    conservées (plus de points de longueur nulle) et deux trajets qui partagent une route
//    s'additionnent EXACTEMENT sur les mêmes arêtes (mêmes coordonnées, même graphe) → trafic cohérent.
import { writeFileSync } from 'node:fs';

const OSRM = 'http://localhost:5000';
const FLOW_URL = 'https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/mobilites-professionnelles-en-2015-deplacements-domicile-lieu-de-travail/exports/json?where=nbflux_c15_actocc15p%3E100&select=coordonnees_residence,coordonnees_travail,nbflux_c15_actocc15p';

// Grille IDENTIQUE à gymlocator.html (sinon le résultat ne s'alignera pas)
const FR = { s: 41.3, n: 51.1, w: -5.2, e: 9.6 }, GX = 80, GY = 50;
const cellIdx = (lat, lon) =>
  Math.max(0, Math.min(GX - 1, Math.floor((lon - FR.w) / (FR.e - FR.w) * GX))) +
  Math.max(0, Math.min(GY - 1, Math.floor((lat - FR.s) / (FR.n - FR.s) * GY))) * GX;

const CONCURRENCY = 64;          // requêtes OSRM parallèles (serveur local MLD = très rapide)
const ROADS_CAP   = 70000;       // nb max de segments de routes exportés (compromis taille/couverture)
const KEY_DEC     = 5;           // précision des extrémités de segment (5 déc. ≈ 1 m) → lignes réelles

const grid = new Float64Array(GX * GY);
const roadAcc = new Map();       // "lat1,lon1,lat2,lon2" (5 déc.) -> trafic cumulé

// Cumule m sur chaque cellule de la grille traversée par la polyligne (une fois par cellule)
function rasterCoords(coords, m) {
  let last = -1;
  for (const [lon, lat] of coords) {
    const idx = cellIdx(lat, lon);
    if (idx !== last) { grid[idx] += m; last = idx; }
  }
}
// Cumule m sur chaque arête réelle de la polyligne (extrémités à précision fine → vraies lignes)
function accRoad(coords, m) {
  for (let i = 0; i + 1 < coords.length; i++) {
    const a = coords[i], b = coords[i + 1];               // [lon, lat]
    const alat = a[1].toFixed(KEY_DEC), alon = a[0].toFixed(KEY_DEC);
    const blat = b[1].toFixed(KEY_DEC), blon = b[0].toFixed(KEY_DEC);
    if (alat === blat && alon === blon) continue;         // arête de longueur nulle → ignorée
    const k = `${alat},${alon},${blat},${blon}`;
    roadAcc.set(k, (roadAcc.get(k) || 0) + m);
  }
}

async function routeOne(o) {
  const [rLat, rLon, wLat, wLon, n] = o;
  // intra-commune (résidence = travail) : pas d'itinéraire → on dépose le passage sur la cellule
  if (Math.abs(rLat - wLat) < 1e-6 && Math.abs(rLon - wLon) < 1e-6) { grid[cellIdx(rLat, rLon)] += n; return; }
  // exclude=motorway : OSRM évite autoroutes ET bretelles (classe excluable du profil car standard)
  const url = `${OSRM}/route/v1/driving/${rLon},${rLat};${wLon},${wLat}?overview=full&geometries=geojson&exclude=motorway`;
  try {
    const r = await fetch(url); if (!r.ok) return;
    const d = await r.json();
    const route = d.routes && d.routes[0];
    if (!route || !route.geometry) return;
    const g = route.geometry.coordinates;                 // [[lon,lat],...] géométrie complète, hors autoroute
    if (!g || g.length < 2) return;
    rasterCoords(g, n); accRoad(g, n);
  } catch (_) { /* échec ponctuel ignoré */ }
}

async function main() {
  console.log('Téléchargement des flux INSEE…');
  const rows = await (await fetch(FLOW_URL)).json();
  const od = rows.map(x => [
    x.coordonnees_residence?.lat, x.coordonnees_residence?.lon,
    x.coordonnees_travail?.lat,   x.coordonnees_travail?.lon,
    x.nbflux_c15_actocc15p
  ]).filter(a => a[0] != null && a[2] != null);
  console.log(`${od.length} flux à router hors autoroute (concurrence ${CONCURRENCY})…`);

  const t0 = Date.now();
  let done = 0;
  for (let i = 0; i < od.length; i += CONCURRENCY) {
    await Promise.all(od.slice(i, i + CONCURRENCY).map(routeOne));
    done += Math.min(CONCURRENCY, od.length - i);
    if (done % 4000 < CONCURRENCY) console.log(`  ${done}/${od.length}  (${((Date.now()-t0)/1000).toFixed(0)}s, ${roadAcc.size.toLocaleString('fr')} arêtes)`);
  }

  // Segments de routes : on garde les plus chargés (corridors continus émergent naturellement)
  const segs = [...roadAcc.entries()]
    .map(([k, v]) => { const p = k.split(',').map(Number); return [p[0], p[1], p[2], p[3], Math.round(v)]; })
    .sort((a, b) => b[4] - a[4])
    .slice(0, ROADS_CAP);

  const out = { GX, GY, FR, grid: Array.from(grid, x => Math.round(x)), roads: segs };
  const json = JSON.stringify(out);
  writeFileSync('assign.json', json);
  console.log(`assign.json écrit — ${(json.length / 1e6).toFixed(1)} Mo, ${segs.length.toLocaleString('fr')} segments (sur ${roadAcc.size.toLocaleString('fr')} arêtes distinctes).`);
}
main();
