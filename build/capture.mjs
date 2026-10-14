// Adhérents attendus d'un projet de salle sur un site donné (modèle de capture : lib-capture.mjs).
//
//   node capture.mjs --lat 43.80749 --lon 4.22952 [--m2 2000] [--segment premium|classique] [--exacte]
//   node capture.mjs --hallb      test sur Hall b : 2 400 m², premium, sans elle dans la concurrence
//   node capture.mjs --sites      test sur 12 sites variés (Paris, banlieue, villes, bourgs isolés), mode national
//
// Mode national : temps du modèle calé pour le projet et pour les salles existantes. --exacte (et
// --hallb) : en plus, zone exacte du projet tracée par des isochrones Valhalla de 5 à 30 min (une
// requête par contour, 5 s de pause, gardées dans data/isochrones/). Les concurrents gardent les
// temps du modèle.
// Le résultat est une fourchette : jeux de paramètres équivalents pour Hall b (FAMILLE, non-recours
// de 200 à 800) × poids des concurrents (× 0,5, 1, 2), pour la taille demandée, 1 200 et 2 000 m².
// Lit data/cells.json et data/gyms-fused.json (pipeline 01-02) ; n'écrit que dans data/isochrones/.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { toLaea, densityField, speedKmh, T_ACCESS } from './lib-e2sfca.mjs';
import { CAPTURE, FAMILLE, BANDES, CONTOURS, grilleDe, concurrence, capture, poidsSalle, tempsIsochrones, rapportLocal } from './lib-capture.mjs';

const DATA = new URL('../data/', import.meta.url);
const readJson = u => JSON.parse(readFileSync(u, 'utf8'));
const arg = (nom, def) => { const k = process.argv.indexOf(`--${nom}`); return k < 0 ? def : process.argv[k + 1]; };
const HALLB = { lat: 43.80749, lon: 4.22952, siret: '94409256800012', m2: 2400, adherents: 1600 };   // chiffres de l'exploitant
const TEST = process.argv.includes('--hallb'), SITES = process.argv.includes('--sites');
const EXACTE = TEST || process.argv.includes('--exacte');
const site = TEST ? { lat: HALLB.lat, lon: HALLB.lon, m2: HALLB.m2, segment: 'premium' }
  : { lat: +arg('lat'), lon: +arg('lon'), m2: +arg('m2', CAPTURE.m2Defaut), segment: arg('segment', CAPTURE.segmentDefaut) };
if (!SITES && (!Number.isFinite(site.lat) || !Number.isFinite(site.lon) || !(site.m2 > 0) || !CAPTURE.adhParM2[site.segment])) {
  console.log('usage : node capture.mjs --lat <lat> --lon <lon> [--m2 2000] [--segment premium|classique] [--exacte]  |  --hallb  |  --sites');
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

// Concurrence par jeu de paramètres (le noyau change d'un jeu à l'autre), facteur de temps et présence
// de Hall b (écartée quand on teste son site : une salle ne se fait pas concurrence à elle-même)
const memo = new Map();
function concurrenceDe(p, facteur = 1, sansHallb = TEST) {
  const cle = `${p.t50}|${p.beta}|${facteur}|${sansHallb}`;
  if (!memo.has(cle)) memo.set(cle, concurrence(G, field, gyms, { p, facteur, exclure: g => sansHallb && g === hallb }));
  return memo.get(cle);
}
// Marché : habitants × P (central), ou demande du modèle (âge, revenu) ramenée au même total national
const PEN = cells.reduce((s, c) => s + c.dem, 0) / cells.reduce((s, c) => s + c.ind, 0);   // 10 % (01-demand.mjs)
const MARCHES = { habitants: (c, p) => c.ind * p.pratiqueMax, demande: (c, p) => c.dem / PEN * p.pratiqueMax };
const KS = [0.5, 1, 2];
const evaluer = ({ lat, lon, m2, segment, temps = null, facteur = 1, p = CAPTURE, k = 1, marche = MARCHES.habitants, sansHallb = TEST }) =>
  capture(G, field, concurrenceDe(p, facteur, sansHallb), { lat, lon, m2, segment, temps, marche, k, p });
// Variantes de la fourchette : FAMILLE × poids des concurrents
const variantes = FAMILLE.flatMap(p => KS.map(k => ({ p, k, nom: `${p.nom} ×${dec(k, 1).replace(',0', '')}` })));

const parametres = p => `noyau log-logistique t50 = ${dec(p.t50, 1)} min, β = ${dec(p.beta, 1)}, coupure ${CAPTURE.tCoupure} min · pratique maximale ${dec(p.pratiqueMax * 1000, 0)} ‰ · non-recours W_0 = ${fmt(p.nonRecours)}`;
console.log(`Modèle : ${parametres(CAPTURE)}`);
console.log(`Attractivité = surface × adhérents/m² : premium ${dec(CAPTURE.adhParM2.premium)}, classique ${dec(CAPTURE.adhParM2.classique, 1)}`);
console.log(`Fourchette : ${FAMILLE.map(p => `${p.nom} (t50 ${dec(p.t50, 1)}, ${dec(p.pratiqueMax * 1000, 0)} ‰)`).join(', ')}, équivalents pour Hall b · concurrents × ${KS.map(k => dec(k, 1)).join(' / ')}`);

if (SITES) {
  // ── Test multi-sites : un site isolé ne doit plus sortir en tête par la seule absence de concurrent ──
  // Projet premium de 2 000 m², mode national. « Avant » : Huff pur de la première moitié de e
  // (14/10/2026, sans non-recours), pour comparaison.
  const HUFF_PUR = { nom: 'Huff pur', nonRecours: 0, t50: 7.3, beta: 4, pratiqueMax: 0.114 };
  const LISTE = [
    ['Paris centre (Châtelet)', 48.8584, 2.3470, 'Paris'], ['Montreuil', 48.8610, 2.4430, 'banlieue'],
    ['Site n° 1 de la carte (Bagneux)', 48.79817, 2.28905, 'banlieue'], ['Montpellier', 43.6108, 3.8767, 'grande ville'],
    ['Grenoble', 45.1885, 5.7245, 'grande ville'], ['Dijon', 47.3220, 5.0415, 'grande ville'], ['Niort', 46.3237, -0.4588, 'ville moyenne'],
    ['Saint-Dionisy (sans Hall b)', 43.80749, 4.22952, 'périurbain'], ['Guéret', 46.1716, 1.8717, 'petite ville isolée'],
    ['Mende', 44.5181, 3.5006, 'petite ville isolée'], ['Langeac', 45.0997, 3.4936, 'bourg isolé'],
    ['Saintes-Maries-de-la-Mer', 43.4522, 4.4286, 'village isolé'],
  ].map(([nom, lat, lon, type]) => ({ nom, lat, lon, type, m2: CAPTURE.m2Defaut, segment: 'premium', sansHallb: nom.startsWith('Saint-Dionisy') }));
  const isole = s => s.type.includes('isolé');
  for (const s of LISTE) {
    s.avant = evaluer({ ...s, p: HUFF_PUR }); s.central = evaluer({ ...s });
    s.v = variantes.map(({ p, k }) => evaluer({ ...s, p, k }).adherents);
  }
  const rangIsole = val => { const tri = [...LISTE].sort((a, b) => val(b) - val(a)); return tri.findIndex(isole) + 1; };
  console.log(`\n══ Test sur ${LISTE.length} sites · projet premium ${fmt(CAPTURE.m2Defaut)} m², mode national (temps du modèle) ══`);
  console.log(`  ${'Site'.padEnd(33)}${'type'.padEnd(21)}${'hab. ≤ 30 min'.padStart(13)}${'avant'.padStart(8)}${'central'.padStart(9)}   fourchette      20–30 min avant → central   sans concurrent avant → central`);
  for (const s of LISTE) console.log(`  ${s.nom.padEnd(33)}${s.type.padEnd(21)}${fmt(s.central.habitants).padStart(13)}${fmt(s.avant.adherents).padStart(8)}${fmt(s.central.adherents).padStart(9)}   ${`${fmt(Math.min(...s.v))} – ${fmt(Math.max(...s.v))}`.padEnd(16)}`
    + `${`${pct(s.avant.parBande[3] / s.avant.adherents)} → ${pct(s.central.parBande[3] / s.central.adherents)}`.padStart(17)}${`${pct(s.avant.sansConcurrent / s.avant.adherents)} → ${pct(s.central.sansConcurrent / s.central.adherents)}`.padStart(30)}`);
  const pire = Math.min(...variantes.map((_, j) => rangIsole(s => s.v[j])));
  console.log(`  « avant » : Huff pur de la première moitié de e (${parametres(HUFF_PUR)})`);
  console.log(`\nRang du premier site isolé sur ${LISTE.length} : avant ${rangIsole(s => s.avant.adherents)}, central ${rangIsole(s => s.central.adherents)}, au mieux ${pire} sur les ${variantes.length} variantes de la fourchette`);
  console.log('Classement central : ' + [...LISTE].sort((a, b) => b.central.adherents - a.central.adherents).map((s, j) => `${j + 1}. ${s.nom.split(' (')[0]}`).join(' · '));
  process.exit(0);
}

const [sE, sN] = toLaea(site.lat, site.lon);
const exclure = g => TEST && g === hallb;

// ── Zone exacte : isochrones Valhalla, un contour par requête ─────────────────────────────────────
const VALHALLA = process.env.VALHALLA_URL || 'https://valhalla1.openstreetmap.de';
const UA = { 'Content-Type': 'application/json', 'User-Agent': 'GymLocator (+https://github.com/Gauthier-Bonhomme/gymlocator)' };
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

// ── Calculs ───────────────────────────────────────────────────────────────────────────────────────
const TAILLES = [...new Set([site.m2, 1200, 2000])].sort((a, b) => a - b);
const modes = [{ nom: 'national (temps du modèle)', temps: null, facteur: 1 }];
let zone = null;
if (EXACTE) {
  console.log(`Isochrones Valhalla (${VALHALLA}) :`);
  const I = await isochrones(site.lat, site.lon);
  const { temps, popContour } = tempsIsochrones(G, I);
  // Variante : les concurrents roulent aussi vite que le projet autour du site (rapport local des
  // temps Valhalla / modèle depuis le projet)
  const rho = rapportLocal(G, field, sE, sN, temps);
  zone = { date: I.date, popContour, rho, carreaux: temps.size };
  modes.push({ nom: 'zone exacte (isochrones Valhalla)', temps, facteur: 1 });
  modes.push({ nom: `zone exacte, concurrents × ${dec(rho)} en temps`, temps, facteur: rho, variante: true });
}
const ev = (mode, opts = {}) => evaluer({ ...site, temps: mode.temps, facteur: mode.facteur, ...opts });

// ── Rapport ───────────────────────────────────────────────────────────────────────────────────────
console.log(`\n══ Capture d'un projet · ${dec(site.lat, 5)} ; ${dec(site.lon, 5)} · ${site.segment} · ${fmt(site.m2)} m²${TEST ? ' · test Hall b' : ''} ══`);
console.log(`Attractivité du projet : ${fmt(ev(modes[0]).W)}`);
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

console.log('\nRésultat central (W_0 = ' + fmt(CAPTURE.nonRecours) + ', concurrents × 1)');
console.log('  Mode                                        adhérents   hab. ≤ 30 min   ‰ hab.   part des inscrits   ' + BANDES.map((b, k) => `${k ? BANDES[k - 1] : 0}–${b}`).join(' / ') + ' min   sans concurrent');
for (const mode of modes) {
  const r = ev(mode);
  console.log(`  ${mode.nom.padEnd(42)} ${fmt(r.adherents).padStart(9)}   ${fmt(r.habitants).padStart(13)}   ${dec(1000 * r.adherents / r.habitants, 1).padStart(6)}   ${pct(r.adherents / r.inscrits, 1).padStart(17)}   `
    + r.parBande.map(a => pct(a / r.adherents)).join(' / ').padEnd(30) + `   ${pct(r.sansConcurrent / r.adherents, 1)}`);
}
console.log('  « part des inscrits » : adhérents du projet / inscrits de toutes les salles dans ses carreaux à ≤ 30 min');
if (TEST) console.log(`  Hall b réelle : ${fmt(HALLB.adherents)} adhérents (exploitant). Test en partie circulaire : f, P, W_0 et la densité premium viennent de Hall b.`);
const autre = site.segment === 'premium' ? 'classique' : 'premium';
console.log(`  Même projet en ${autre} (mode national) : ${fmt(ev(modes[0], { segment: autre }).adherents)} adhérents`);
const dem = ev(modes[0], { marche: MARCHES.demande }).adherents / ev(modes[0]).adherents - 1;
console.log(`  Marché selon la demande du modèle (âge, revenu) au lieu des habitants : ${dem >= 0 ? '+' : '−'}${pct(Math.abs(dem), 1)} (mode national)`);

console.log('\nSensibilité : adhérents attendus selon le jeu de paramètres (FAMILLE) et le poids des concurrents');
console.log(`  ${'Mode · taille'.padEnd(52)}${variantes.map(v => v.nom.padStart(12)).join('')}   fourchette`);
for (const mode of modes) for (const m2 of TAILLES) {
  const v = variantes.map(({ p, k }) => ev(mode, { m2, p, k }).adherents);
  console.log(`  ${`${mode.nom} · ${fmt(m2)} m²`.padEnd(52)}${v.map(x => fmt(x).padStart(12)).join('')}   ${fmt(Math.min(...v))} – ${fmt(Math.max(...v))}`);
}
