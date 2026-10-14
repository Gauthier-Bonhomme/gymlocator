// Adhérents attendus d'un projet de salle sur un site donné (modèle de capture : lib-capture.mjs).
//
//   node capture.mjs --lat 43.80749 --lon 4.22952 [--m2 2000] [--segment premium|classique] [--exacte]
//   node capture.mjs --hallb      test sur Hall b : 2 400 m², premium, sans elle dans la concurrence
//
// Mode national : temps du modèle calé pour le projet et pour les salles existantes. --exacte (et
// --hallb) : en plus, zone exacte du projet tracée par des isochrones Valhalla de 5 à 30 min (une
// requête par contour, 5 s de pause, gardées dans data/isochrones/). Les concurrents gardent les
// temps du modèle.
// Le résultat est une fourchette : pénétration (p0 de l'étape d ou demande du modèle) × poids des
// concurrents (× 0,5, 1, 2), pour la taille demandée, 1 200 et 2 000 m².
// Lit data/cells.json et data/gyms-fused.json (pipeline 01-02) ; n'écrit que dans data/isochrones/.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { toLaea, densityField, speedKmh, T_ACCESS } from './lib-e2sfca.mjs';
import { CAPTURE, BANDES, grilleDe, voisins, concurrence, capture, poidsSalle } from './lib-capture.mjs';

const DATA = new URL('../data/', import.meta.url);
const readJson = u => JSON.parse(readFileSync(u, 'utf8'));
const arg = (nom, def) => { const k = process.argv.indexOf(`--${nom}`); return k < 0 ? def : process.argv[k + 1]; };
const HALLB = { lat: 43.80749, lon: 4.22952, siret: '94409256800012', m2: 2400, adherents: 1600 };   // chiffres de l'exploitant
const TEST = process.argv.includes('--hallb');
const EXACTE = TEST || process.argv.includes('--exacte');
const site = TEST ? { lat: HALLB.lat, lon: HALLB.lon, m2: HALLB.m2, segment: 'premium' }
  : { lat: +arg('lat'), lon: +arg('lon'), m2: +arg('m2', CAPTURE.m2Defaut), segment: arg('segment', CAPTURE.segmentDefaut) };
if (!Number.isFinite(site.lat) || !Number.isFinite(site.lon) || !(site.m2 > 0) || !CAPTURE.adhParM2[site.segment]) {
  console.log('usage : node capture.mjs --lat <lat> --lon <lon> [--m2 2000] [--segment premium|classique] [--exacte]  |  --hallb');
  process.exit(1);
}

const fmt = v => Math.round(v).toLocaleString('fr-FR');
const pct = (v, d = 0) => (v * 100).toFixed(d).replace('.', ',') + ' %';
const dec = (v, d = 2) => v.toFixed(d).replace('.', ',');

const cells = readJson(new URL('cells.json', DATA)), gyms = readJson(new URL('gyms-fused.json', DATA));
const field = densityField(cells), G = grilleDe(cells);
const hallb = gyms.find(g => g.siret === HALLB.siret);
if (TEST && !hallb) { console.log('Hall b absente de data/gyms-fused.json (SIRET changé ?)'); process.exit(1); }
if (TEST && (hallb.cat !== 'premium' || hallb.surfSrc !== 'reel')) console.log(`!! Hall b : ${hallb.cat}, ${hallb.surfSrc} (attendu : premium, reel) — relancer 02-supply.mjs`);
const exclure = g => TEST && g === hallb;   // test : la salle ne se fait pas concurrence à elle-même
const D = concurrence(G, field, gyms, { exclure });
const [sE, sN] = toLaea(site.lat, site.lon);

// ── Zone exacte : isochrones Valhalla, un contour par requête ─────────────────────────────────────
const VALHALLA = process.env.VALHALLA_URL || 'https://valhalla1.openstreetmap.de';
const UA = { 'Content-Type': 'application/json', 'User-Agent': 'GymLocator (+https://github.com/Gauthier-Bonhomme/gymlocator)' };
const CONTOURS = [5, 10, 15, 20, 25, 30];
const pause = ms => new Promise(r => setTimeout(r, ms));
async function isochrones(lat, lon) {
  const dir = new URL('isochrones/', DATA); mkdirSync(dir, { recursive: true });
  const f = new URL(`${lat.toFixed(5)}_${lon.toFixed(5)}.json`, dir);
  const I = existsSync(f) ? readJson(f) : { date: new Date().toISOString().slice(0, 10), valhalla: VALHALLA, lat, lon, contours: {} };
  for (const min of CONTOURS) {
    if (I.contours[min]) continue;
    // Un contour par requête : demandés ensemble, les contours intermédiaires sortent 5 à 7 % plus
    // peuplés (mesuré le 13/10/2026). Mêmes paramètres que l'analyse de zone du front.
    const q = { locations: [{ lat, lon }], costing: 'auto', contours: [{ time: min }], polygons: true, denoise: 0.5, generalize: 60 };
    const r = await fetch(`${VALHALLA}/isochrone`, { method: 'POST', headers: UA, body: JSON.stringify(q) });
    if (!r.ok) throw new Error(`Valhalla HTTP ${r.status} : relancer pour reprendre (contours déjà reçus gardés)`);
    I.contours[min] = (await r.json()).features[0].geometry;
    writeFileSync(f, JSON.stringify(I));
    console.log(`  isochrone ${min} min reçue`);
    await pause(5000);
  }
  return I;
}
// Centre du carreau dans le polygone (contours extérieurs), comme isoStats() du front
const pip = (x, y, ring) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) ins = !ins; } return ins; };
function dansContour(geom, fn) {
  const rings = (geom.type === 'Polygon' ? [geom.coordinates[0]] : geom.coordinates.map(p => p[0])).map(r => r.map(([lo, la]) => toLaea(la, lo)));
  let E0 = Infinity, E1 = -Infinity, N0 = Infinity, N1 = -Infinity;
  for (const r of rings) for (const [E, N] of r) { E0 = Math.min(E0, E); E1 = Math.max(E1, E); N0 = Math.min(N0, N); N1 = Math.max(N1, N); }
  for (let x = Math.floor(E0 / 1000); x <= Math.floor(E1 / 1000); x++) for (let y = Math.floor(N0 / 1000); y <= Math.floor(N1 / 1000); y++) {
    const gx = x - G.minCx, gy = y - G.minCy; if (gx < 0 || gy < 0 || gx >= G.cols || gy >= G.rows) continue;
    const i = G.KIDX[gx + gy * G.cols];
    if (i >= 0 && rings.some(r => pip(x * 1000 + 500, y * 1000 + 500, r))) fn(i);
  }
}

// ── Calculs ───────────────────────────────────────────────────────────────────────────────────────
const MARCHES = [['p0 11,4 %', c => c.ind * CAPTURE.penetration], ['demande 10 %', c => c.dem]];   // le 1er = central
const KS = [0.5, 1, 2];
const TAILLES = [...new Set([site.m2, 1200, 2000])].sort((a, b) => a - b);
const modes = [{ nom: 'national (temps du modèle)', D, temps: null }];
let zone = null;
if (EXACTE) {
  console.log(`Isochrones Valhalla (${VALHALLA}) :`);
  const I = await isochrones(site.lat, site.lon);
  const temps = new Map(), popContour = {};
  for (const min of CONTOURS) {   // du plus petit au plus grand : un carreau prend sa première bande
    let pop = 0;
    dansContour(I.contours[min], i => { pop += cells[i].ind; if (!temps.has(i)) temps.set(i, min - 2.5); });
    popContour[min] = pop;
  }
  // Variante : les concurrents roulent aussi vite que le projet autour du site. Rapport local des
  // temps Valhalla / modèle depuis le projet (médiane pondérée par la population de la zone exacte).
  const r = []; voisins(G, field, sE, sN, 90, (i, t) => { if (temps.has(i)) r.push([temps.get(i) / t, cells[i].ind]); });
  r.sort((a, b) => a[0] - b[0]);
  let acc = 0, rho = 1; const tot = r.reduce((s, x) => s + x[1], 0);
  for (const [v, w] of r) { acc += w; if (acc >= tot / 2) { rho = v; break; } }
  zone = { date: I.date, popContour, rho, carreaux: temps.size };
  modes.push({ nom: 'zone exacte (isochrones Valhalla)', D, temps });
  modes.push({ nom: `zone exacte, concurrents × ${dec(rho)} en temps`, D: concurrence(G, field, gyms, { exclure, facteur: rho }), temps, variante: true });
}
const evaluer = (mode, m2, marche, k, segment = site.segment) => capture(G, field, mode.D, { lat: site.lat, lon: site.lon, m2, segment, temps: mode.temps, marche, k });

// ── Rapport ───────────────────────────────────────────────────────────────────────────────────────
console.log(`\n══ Capture d'un projet · ${dec(site.lat, 5)} ; ${dec(site.lon, 5)} · ${site.segment} · ${fmt(site.m2)} m²${TEST ? ' · test Hall b' : ''} ══`);
console.log(`Noyau log-logistique t50 = ${dec(CAPTURE.t50, 1)} min, β = ${CAPTURE.beta}, coupure ${CAPTURE.tCoupure} min · pénétration ${dec(CAPTURE.penetration * 1000, 0)} ‰ des habitants`);
console.log(`Attractivité = surface × adhérents/m² : premium ${dec(CAPTURE.adhParM2.premium)}, classique ${dec(CAPTURE.adhParM2.classique, 1)} → projet ${fmt(evaluer(modes[0], site.m2, MARCHES[0][1], 1).W)}`);
{ // concurrence autour du site : temps du modèle entre le site et chaque salle (densités lissées des deux points)
  const dS = field.at(Math.floor(sE / 1000), Math.floor(sN / 1000)), n = { 15: 0, 30: 0 }, w = { 15: 0, 30: 0 };
  for (const g of gyms) {
    if (exclure(g)) continue;
    const [E, N] = toLaea(g.lat, g.lon), d = Math.hypot(E - sE, N - sN) / 1000; if (d > 20) continue;
    const t = T_ACCESS + d / speedKmh((dS + field.at(Math.floor(E / 1000), Math.floor(N / 1000))) / 2) * 60;
    for (const tm of [15, 30]) if (t <= tm) { n[tm]++; w[tm] += poidsSalle(g); }
  }
  console.log(`Salles existantes (temps du modèle) : ${n[15]} à ≤ 15 min, attractivité ${fmt(w[15])} · ${n[30]} à ≤ 30 min, attractivité ${fmt(w[30])}`);
}
if (zone) {
  console.log(`Zone exacte (Valhalla, ${zone.date}) : habitants par contour ` + CONTOURS.map(m => `${m} min ${fmt(zone.popContour[m])}`).join(' · '));
  console.log(`  rapport local temps Valhalla / temps du modèle : ${dec(zone.rho)} (médiane pondérée, ${zone.carreaux} carreaux)`);
}

console.log('\nRésultat central (pénétration p0, concurrents × 1)');
console.log('  Mode                                        adhérents   hab. ≤ 30 min   part captée   ' + BANDES.map((b, k) => `${k ? BANDES[k - 1] : 0}–${b}`).join(' / ') + ' min   sans concurrent');
for (const mode of modes) {
  const r = evaluer(mode, site.m2, MARCHES[0][1], 1);
  console.log(`  ${mode.nom.padEnd(42)} ${fmt(r.adherents).padStart(9)}   ${fmt(r.habitants).padStart(13)}   ${pct(r.adherents / r.marche, 1).padStart(11)}   `
    + r.parBande.map(a => pct(a / r.adherents)).join(' / ').padEnd(30) + `   ${pct(r.sansConcurrent / r.adherents, 1)}`);
}
if (TEST) console.log(`  Hall b réelle : ${fmt(HALLB.adherents)} adhérents (exploitant). Test en partie circulaire : f, p0 et la densité premium viennent de Hall b.`);
const autre = site.segment === 'premium' ? 'classique' : 'premium';
console.log(`  Même projet en ${autre} (mode national) : ${fmt(evaluer(modes[0], site.m2, MARCHES[0][1], 1, autre).adherents)} adhérents`);

console.log('\nSensibilité : adhérents attendus selon la pénétration et le poids des concurrents');
const entetes = MARCHES.flatMap(([nm]) => KS.map(k => `${nm} ×${dec(k, 1).replace(',0', '')}`));
console.log(`  ${'Mode · taille'.padEnd(52)}${entetes.map(h => h.padStart(19)).join('')}   fourchette`);
for (const mode of modes) for (const m2 of TAILLES) {
  const v = MARCHES.flatMap(([, marche]) => KS.map(k => evaluer(mode, m2, marche, k).adherents));
  console.log(`  ${`${mode.nom} · ${fmt(m2)} m²`.padEnd(52)}${v.map(x => fmt(x).padStart(19)).join('')}   ${fmt(Math.min(...v))} – ${fmt(Math.max(...v))}`);
}
