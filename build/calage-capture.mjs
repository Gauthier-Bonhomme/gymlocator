// Calage du modèle de capture (lib-capture.mjs) sur la répartition des adhérents de Hall b par bande
// de temps : noyau f (t50, β), pratique maximale P et non-recours W_0.
//
//   node calage-capture.mjs                    concurrents aux temps du modèle (convention nationale)
//   node calage-capture.mjs --vitesse-locale   concurrents au rapport local Valhalla / modèle
//
// Entrées : data-private/hallb-bandes.json (PRIVÉ, jamais versionné : adhérents de Hall b par bande de
// temps Valhalla, agrégats de docs-private/CALIBRATION.md), data/isochrones/ (zone exacte de Hall b :
// lancer d'abord capture.mjs --hallb), data/ban/adresses-30.csv.gz et adresses-34.csv.gz (Base Adresse
// Nationale, voir README.md), data/cells.json, data/gyms-fused.json.
// N'écrit rien : les paramètres proposés sont à reporter dans FAMILLE (lib-capture.mjs). Le rapport
// affiche des chiffres d'adhérents : ne pas le copier dans un fichier versionné.
//
// 1. Zone exacte de Hall b, comme capture.mjs --hallb : temps Valhalla du projet (milieu de la bande de
//    5 min), concurrents aux temps du modèle, Hall b exclue de la concurrence, attractivité 1 600.
// 2. Même résolution que le réel : les adhérents réels sont localisés par code postal puis répartis sur
//    les carreaux de leur code postal au prorata des habitants (parts d'adresses de la BAN). La
//    prédiction passe par le même lissage avant d'être comparée ; sans lui, le cœur prédit, plus
//    concentré que le cœur lissé, fait préférer à tort un noyau plus étalé.
// 3. Pour chaque non-recours W_0 : t50 et β sur une grille, P en forme close (même total à ≤ 30 min),
//    déviance de Poisson sur 6 bandes de 5 min (0–5, 20–25 et 25–30 min tirées des parts cumulées
//    arrondies). Le profil de déviance sur W_0, rapporté à la surdispersion φ, dit ce que Hall b
//    identifie.
// 4. Point central : le W_0 qui redonne le taux de pratique national de la demande (Σ dem / Σ habitants,
//    10 %) avec toutes les salles existantes : Σ habitants × P S / (W_0 + S), S = Σ W f. Encadrement :
//    W_0 divisé et multiplié par 2, chacun avec son propre ajustement.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { toLaea, laeaForward, densityField } from './lib-e2sfca.mjs';
import { CAPTURE, FAMILLE, grilleDe, voisins, concurrence, poidsSalle, noyau, pratique, tempsIsochrones, rapportLocal } from './lib-capture.mjs';

const DATA = new URL('../data/', import.meta.url), PRIVE = new URL('../data-private/', import.meta.url);
const readJson = u => JSON.parse(readFileSync(u, 'utf8'));
const HALLB = { lat: 43.80749, lon: 4.22952, siret: '94409256800012' };
const LOCALE = process.argv.includes('--vitesse-locale');
const fCible = new URL('hallb-bandes.json', PRIVE);
const fIso = new URL(`isochrones/${HALLB.lat.toFixed(5)}_${HALLB.lon.toFixed(5)}.json`, DATA);
const fBan = [30, 34].map(d => new URL(`ban/adresses-${d}.csv.gz`, DATA));
for (const [f, quoi] of [[fCible, 'agrégats privés, voir docs-private/CALIBRATION.md'], [fIso, 'lancer capture.mjs --hallb'], ...fBan.map(f => [f, 'voir build/README.md']) ])
  if (!existsSync(f)) { console.log(`Manque ${fileURLToPath(f)} (${quoi})`); process.exit(1); }

const fmt = v => Math.round(v).toLocaleString('fr-FR');
const dec = (v, d = 2) => v.toFixed(d).replace('.', ',');
const somme = a => a.reduce((s, v) => s + v, 0);

const cells = readJson(new URL('cells.json', DATA)), gyms = readJson(new URL('gyms-fused.json', DATA));
const field = densityField(cells), G = grilleDe(cells);
const hallb = gyms.find(g => g.siret === HALLB.siret);
if (!hallb || hallb.surfSrc !== 'reel') { console.log('Hall b absente ou sans ses valeurs réelles dans data/gyms-fused.json : relancer 02-supply.mjs'); process.exit(1); }
const Wp = poidsSalle(hallb);
const { temps } = tempsIsochrones(G, readJson(fIso));
const zone = [...temps.keys()], tz = zone.map(i => temps.get(i)), hab = zone.map(i => cells[i].ind);
const [sE, sN] = toLaea(HALLB.lat, HALLB.lon);
const rho = LOCALE ? rapportLocal(G, field, sE, sN, temps) : 1;

// Concurrents vus de chaque carreau de la zone, à plat : attractivité, temps du modèle × rho, …
const kz = new Map(zone.map((i, z) => [i, z])), paires = zone.map(() => []);
for (const g of gyms) {
  if (g === hallb) continue;
  const w = poidsSalle(g); if (!(w > 0)) continue;
  const [E, N] = toLaea(g.lat, g.lon);
  voisins(G, field, E, N, CAPTURE.tCoupure, (i, t) => { const z = kz.get(i); if (z !== undefined) paires[z].push(w, t); }, rho);
}

// ── Lissage « comme le réel » : parts des codes postaux par carreau (adresses BAN) ────────────────
const parts = new Map();   // carreau → Map(code postal → adresses)
for (const f of fBan) {
  const L = gunzipSync(readFileSync(f)).toString('utf8').split('\n'), h = L[0].split(';');
  const iCp = h.indexOf('code_postal'), iLon = h.indexOf('lon'), iLat = h.indexOf('lat');
  for (let k = 1; k < L.length; k++) {
    const c = L[k].split(';'), cp = c[iCp], lon = +c[iLon], lat = +c[iLat];
    if (!cp || !lon || !lat) continue;
    const [E, N] = laeaForward(lat, lon), x = Math.floor(E / 1000) - G.minCx, y = Math.floor(N / 1000) - G.minCy;
    const i = x >= 0 && y >= 0 && x < G.cols && y < G.rows ? G.KIDX[x + y * G.cols] : -1; if (i < 0) continue;
    if (!parts.has(i)) parts.set(i, new Map());
    parts.get(i).set(cp, (parts.get(i).get(cp) || 0) + 1);
  }
}
const cpDe = new Map(), cpCarreaux = new Map(), cpHab = new Map();
for (const [i, m] of parts) {
  const n = somme([...m.values()]), l = [...m].map(([cp, v]) => [cp, v / n]);
  cpDe.set(i, l);
  for (const [cp, a] of l) {
    cpHab.set(cp, (cpHab.get(cp) || 0) + a * cells[i].ind);
    if (!cpCarreaux.has(cp)) cpCarreaux.set(cp, []);
    cpCarreaux.get(cp).push([i, a]);
  }
}
const bande = i => temps.has(i) ? Math.min(5, Math.floor(temps.get(i) / 5)) : 6;   // 6 : au-delà de 30 min
// mu[z] : adhérents prédits par carreau de la zone → 6 bandes de 5 min + au-delà de 30 min
function parBande(mu, lisse = true) {
  const b = new Float64Array(7), M = new Map();
  zone.forEach((i, z) => {
    const l = lisse && cpDe.get(i);
    if (!l) { b[bande(i)] += mu[z]; return; }   // hors Gard et Hérault : non lissé
    for (const [cp, a] of l) M.set(cp, (M.get(cp) || 0) + a * mu[z]);
  });
  for (const [cp, m] of M) for (const [i, a] of cpCarreaux.get(cp)) b[bande(i)] += m * a * cells[i].ind / cpHab.get(cp);
  return b;
}

// ── Cibles (privées) ─────────────────────────────────────────────────────────────────────────────
const C = readJson(fCible), N0 = C.site.adherents, cum = C.parts_cumulees_arrondies, b4 = C.bandes.map(b => b.adherents);
if (C.bandes.map(b => `${b.de}-${b.a}`).join() !== '0-10,10-15,15-20,20-30') { console.log('hallb-bandes.json : bandes attendues 0–10, 10–15, 15–20, 20–30 min'); process.exit(1); }
const y6 = [cum[5] * N0, b4[0] - cum[5] * N0, b4[1], b4[2], cum[25] * N0 - b4[0] - b4[1] - b4[2], somme(b4) - cum[25] * N0];
const phi = C.surdispersion;
const deviance = (y, m) => 2 * y.reduce((s, v, j) => s + (v > 0 ? v * Math.log(v / m[j]) : 0) - (v - m[j]), 0);
const en4 = m => [m[0] + m[1], m[2], m[3], m[4] + m[5]];

// ── Ajustement ──────────────────────────────────────────────────────────────────────────────────
// p : { nonRecours, t50, beta [, pratiqueMax] } ; sans pratiqueMax, P en forme close (même total à ≤ 30 min)
function ajuste(p, lisse = true) {
  const mu = new Float64Array(zone.length);
  for (let z = 0; z < zone.length; z++) {
    let D = 0; const L = paires[z];
    for (let k = 0; k < L.length; k += 2) D += L[k] * noyau(L[k + 1], p);
    const x = Wp * noyau(tz[z], p);
    mu[z] = hab[z] * x / (p.nonRecours + x + D);
  }
  const b = parBande(mu, lisse), P = p.pratiqueMax ?? somme(y6) / somme(b.slice(0, 6));
  const m = Array.from(b, v => v * P);
  return { ...p, pratiqueMax: P, m, dev: deviance(y6, m.slice(0, 6)) };
}
function meilleur(nonRecours) {   // grille grossière puis fine sur (t50, β)
  let best = null;
  const essai = (t50, beta) => { const a = ajuste({ nonRecours, t50, beta }); if (!best || a.dev < best.dev) best = a; };
  for (let t50 = 2.5; t50 <= 9.001; t50 += 0.25) for (let beta = 2.4; beta <= 5.001; beta += 0.1) essai(t50, beta);
  const { t50: t0, beta: b0 } = best;
  for (let t50 = t0 - 0.25; t50 <= t0 + 0.2501; t50 += 0.025) for (let beta = b0 - 0.1; beta <= b0 + 0.1001; beta += 0.01) essai(t50, beta);
  return best;
}
const totHab = somme(cells.map(c => c.ind)), cible = somme(cells.map(c => c.dem)) / totHab;
function pratiqueNationale(p) {   // toutes les salles existantes, Hall b comprise, temps du modèle
  const S = concurrence(G, field, gyms, { p });
  let s = 0; for (let i = 0; i < cells.length; i++) s += cells[i].ind * pratique(S[i], p);
  return s / totHab;
}
// Sans concurrent : pénétration au pied du club et temps où elle est divisée par deux
const auPied = p => p.pratiqueMax * Wp / (p.nonRecours + Wp);
const demiTemps = p => p.nonRecours > 0 ? p.t50 * (1 + Wp / p.nonRecours) ** (1 / p.beta) : Infinity;

// ── Rapport ─────────────────────────────────────────────────────────────────────────────────────
console.log(`══ Calage du modèle de capture sur Hall b · RAPPORT PRIVÉ (adhérents) : ne pas versionner ══`);
console.log(`Zone exacte : ${zone.length} carreaux à ≤ 30 min (Valhalla) · concurrents ${LOCALE ? `× ${dec(rho)} en temps (vitesse locale)` : 'aux temps du modèle'} · attractivité de Hall b ${fmt(Wp)}`);
console.log(`Lissage par code postal : ${parts.size} carreaux, ${cpHab.size} codes postaux (BAN 30 + 34)`);
console.log(`Cibles (6 bandes de 5 min, ≤ 30 min) : ${y6.map(fmt).join(' / ')} · au-delà ${fmt(C.au_dela_30)} · surdispersion φ = ${dec(phi, 1)}`);

console.log('\nProfil sur le non-recours W_0 (t50, β et P ajustés à chaque W_0 ; Δ = écart de déviance au meilleur, rapporté à φ)');
console.log('     W_0    t50     β       P    déviance  Δ/φ   pratique nat.   au pied   t½ sans concurrent   bandes 0–5 / … / 25–30');
const GRILLE = [0, 25, 50, 100, 200, 300, 400, 500, 600, 800, 1600, 3200, 1e4, 1e5];
const prof = GRILLE.map(W0 => { const a = meilleur(W0); a.pratique = pratiqueNationale(a); return a; });
const devMin = Math.min(...prof.map(a => a.dev));
for (const a of prof) console.log(`  ${fmt(a.nonRecours).padStart(7)}  ${dec(a.t50).padStart(5)}  ${dec(a.beta).padStart(4)}  ${dec(a.pratiqueMax, 3).padStart(6)}  ${dec(a.dev, 1).padStart(8)}  ${dec((a.dev - devMin) / phi, 1).padStart(4)}  ${(dec(100 * a.pratique) + ' %').padStart(14)}  ${(dec(100 * auPied(a), 1) + ' %').padStart(8)}  ${(Number.isFinite(demiTemps(a)) ? dec(demiTemps(a), 1) + ' min' : '—').padStart(19)}   ${a.m.slice(0, 6).map(fmt).join(' / ')}`);

// W_0 central : la pratique nationale croise la cible (interpolation en log W_0 entre deux points du profil)
let W0c = null;
for (let k = 1; k < prof.length && W0c === null; k++) {
  const [a, b] = [prof[k - 1], prof[k]];
  if ((a.pratique - cible) * (b.pratique - cible) > 0) continue;
  const u = (cible - a.pratique) / (b.pratique - a.pratique);
  W0c = a.nonRecours > 0 ? a.nonRecours * (b.nonRecours / a.nonRecours) ** u : u * b.nonRecours;
}
if (W0c === null) {
  console.log(`\nLa pratique nationale ne croise pas ${dec(100 * cible)} % sur ce profil (${dec(100 * Math.min(...prof.map(a => a.pratique)))} à ${dec(100 * Math.max(...prof.map(a => a.pratique)))} %) : pas de point central.`);
  process.exit(0);
}
const arrondi = v => v >= 100 ? Math.round(v / 100) * 100 : Number(v.toPrecision(2));
const centre = arrondi(W0c);
console.log(`\nPratique nationale = ${dec(100 * cible)} % (Σ dem / Σ habitants) pour W_0 ≈ ${fmt(W0c)} → retenu ${fmt(centre)}, encadré par ${fmt(centre / 2)} et ${fmt(centre * 2)}`);
const fam = [centre / 2, centre, centre * 2].map(W0 => {
  const a = meilleur(W0);   // noyau arrondi, puis P recalculé pour lui et arrondi
  const r = ajuste({ nonRecours: W0, t50: Math.round(a.t50 * 10) / 10, beta: Math.round(a.beta * 10) / 10 });
  const q = ajuste({ nonRecours: W0, t50: r.t50, beta: r.beta, pratiqueMax: Math.round(r.pratiqueMax * 1000) / 1000 });
  q.pratique = pratiqueNationale(q);
  return q;
});
console.log('\nParamètres proposés (à reporter dans FAMILLE, lib-capture.mjs) :');
for (const q of fam) console.log(`  { nom: 'W0 ${q.nonRecours}', nonRecours: ${q.nonRecours}, t50: ${q.t50}, beta: ${q.beta}, pratiqueMax: ${q.pratiqueMax} },   // pratique nationale ${dec(100 * q.pratique)} %, Δ/φ ${dec((q.dev - devMin) / phi, 1)}, au pied ${dec(100 * auPied(q), 1)} %, t½ ${dec(demiTemps(q), 1)} min`);
const actuels = FAMILLE.map(p => `${p.nom} (${p.t50} ; ${p.beta} ; ${p.pratiqueMax})`).join(' · ');
console.log(`  FAMILLE actuelle : ${actuels}`);

console.log('\nAdhérents par bande de temps Valhalla, prédiction lissée par code postal comme le réel');
const ligne = (nom, m) => console.log(`  ${nom.padEnd(40)} ${m.slice(0, 6).map(v => fmt(v).padStart(5)).join(' ')}   │ ${en4(m).map(v => fmt(v).padStart(5)).join(' ')}   │ ${fmt(somme(m.slice(0, 6))).padStart(6)} ${fmt(m[6]).padStart(6)}`);
console.log(`  ${''.padEnd(40)}   0–5  5–10 10–15 15–20 20–25 25–30   │  0–10 10–15 15–20 20–30   │  ≤ 30  > 30`);
ligne('Réel', [...y6, C.au_dela_30]);
const huffPur = ajuste({ nonRecours: 0, t50: 7.3, beta: 4, pratiqueMax: 0.114 });
ligne('Huff pur (première moitié de e)', huffPur.m);
for (const q of fam) ligne(`${q.nonRecours === centre ? 'Central' : 'Encadrement'} W_0 ${q.nonRecours}`, q.m);
const nonLisse = ajuste(fam[1], false);
ligne(`Central W_0 ${centre}, sans lissage (au carreau)`, nonLisse.m);
console.log(`  Déviance (6 bandes) : Huff pur ${dec(huffPur.dev, 1)} · central ${dec(fam[1].dev, 1)} · meilleur du profil ${dec(devMin, 1)} (φ = ${dec(phi, 1)})`);
