// 05 — Modèle de capture pour le front → meta.json (bloc capture)
// Le front (« Meilleurs sites ») lit ce bloc au chargement : les paramètres du modèle de capture ont,
// comme ceux de meta.modele (03), une seule source, build/lib-capture.mjs. À lancer après 03 et 04,
// qui réécrivent meta.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { CAPTURE, FAMILLE, SURF_MAX, TAILLES, ESPACEMENT_KM, RECHERCHE } from './lib-capture.mjs';

const metaPath = new URL('../meta.json', import.meta.url);
const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
const central = FAMILLE.findIndex(p => p.nom === CAPTURE.nom);
if (central < 0) { console.log('!! ÉCHEC : le jeu central (CAPTURE) n\'est pas dans FAMILLE'); process.exit(1); }

meta.capture = {
  famille: FAMILLE, central,                       // jeux de paramètres (W_0, t50, β, P) ; central = CAPTURE
  tCoupure: CAPTURE.tCoupure,                      // min : noyau nul au-delà
  adhParM2: CAPTURE.adhParM2, surfMax: SURF_MAX,   // attractivité = min(surface, surfMax) × adhérents/m²
  tailles: TAILLES, m2Defaut: CAPTURE.m2Defaut, segmentDefaut: CAPTURE.segmentDefaut,
  espacementKm: ESPACEMENT_KM, recherche: RECHERCHE,
};
writeFileSync(metaPath, JSON.stringify(meta, null, 1));
console.log(`meta.json : bloc capture (jeu central ${FAMILLE[central].nom}, tailles ${TAILLES.join(' / ')} m², espacement ${ESPACEMENT_KM} km)`);
