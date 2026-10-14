// 05 — Modèle de capture pour le front → meta.json (bloc capture)
// Le front (« Meilleurs sites », estimation d'un point) lit ce bloc au chargement : les paramètres du
// modèle de capture ont, comme ceux de meta.modele (03), une seule source, build/lib-capture.mjs.
// Il y trouve aussi le rang national d'une estimation : la distribution de l'estimation centrale d'un
// même projet placé au centre de chaque carreau habité, avec toute l'offre (une par taille et segment).
// À lancer après 03 et 04, qui réécrivent meta.json. Lit data/cells.json et data/gyms-fused.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { densityField } from './lib-e2sfca.mjs';
import { CAPTURE, FAMILLE, SURF_MAX, TAILLES, ESPACEMENT_KM, RECHERCHE, KS, SEUIL, TOP_ROBUSTESSE, RANGS,
  grilleDe, tablesCapture, concurrences, attractivite, champCentral, quantiles } from './lib-capture.mjs';

const DATA = new URL('../data/', import.meta.url), metaPath = new URL('../meta.json', import.meta.url);
const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
const central = FAMILLE.findIndex(p => p.nom === CAPTURE.nom);
if (central < 0) { console.log('!! ÉCHEC : le jeu central (CAPTURE) n\'est pas dans FAMILLE'); process.exit(1); }

// Rang national : estimation centrale des 6 projets (3 tailles × 2 segments) sur chaque carreau habité
console.time('Distribution nationale');
const cells = JSON.parse(readFileSync(new URL('cells.json', DATA), 'utf8'));
const gyms = JSON.parse(readFileSync(new URL('gyms-fused.json', DATA), 'utf8'));
const field = densityField(cells), G = grilleDe(cells), T = tablesCapture(G, field);
const projets = ['premium', 'classique'].flatMap(segment => TAILLES.map(m2 => ({ segment, m2, cle: `${segment}-${m2}` })));
const champs = champCentral(T, concurrences(G, field, gyms), projets.map(p => attractivite(p.m2, p.segment)));
const distribution = Object.fromEntries(projets.map((p, k) => [p.cle, quantiles(champs[k])]));
console.timeEnd('Distribution nationale');
for (const p of projets) {
  const q = distribution[p.cle], at = r => q[RANGS.indexOf(r)];
  console.log(`  ${p.cle.padEnd(16)} médiane ${at(50)} · 90ᵉ ${at(90)} · 99ᵉ ${at(99)} · max ${at(100)} adhérents attendus`);
}
// Garde-fous : distribution croissante, ordre des projets cohérent (plus grand ⇒ plus d'adhérents)
const ok = projets.every(p => distribution[p.cle].every((v, i, a) => i === 0 || v >= a[i - 1]))
  && ['premium', 'classique'].every(s => TAILLES.every((m2, i) => i === 0 || distribution[`${s}-${m2}`][50] >= distribution[`${s}-${TAILLES[i - 1]}`][50]));
console.log(`${ok ? 'OK ' : '!! ÉCHEC'} distributions croissantes et ordonnées par taille`);
if (!ok) process.exit(1);

meta.capture = {
  famille: FAMILLE, central,                       // jeux de paramètres (W_0, t50, β, P) ; central = CAPTURE
  ks: KS,                                          // poids des concurrents : fourchette = famille × ks
  seuil: SEUIL, topRobustesse: TOP_ROBUSTESSE,     // filtre par défaut ; robustesse = variantes restant dans ce top
  tCoupure: CAPTURE.tCoupure,                      // min : noyau nul au-delà
  adhParM2: CAPTURE.adhParM2, surfMax: SURF_MAX,   // attractivité = min(surface, surfMax) × adhérents/m²
  tailles: TAILLES, m2Defaut: CAPTURE.m2Defaut, segmentDefaut: CAPTURE.segmentDefaut,
  espacementKm: ESPACEMENT_KM, recherche: RECHERCHE,
  // rang national : estimation centrale aux percentiles `rangs` des carreaux habités, par projet
  rangs: RANGS, distribution, carreaux: cells.length,
};
writeFileSync(metaPath, JSON.stringify(meta, null, 1));
console.log(`meta.json : bloc capture (jeu central ${FAMILLE[central].nom}, ${projets.length} distributions sur ${cells.length.toLocaleString('fr-FR')} carreaux)`);
