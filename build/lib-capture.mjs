// Modèle de capture d'un projet de salle (étape e de ROADMAP.md, première moitié).
//
// Adhérents attendus d'une salle nouvelle, de taille et de segment donnés, sur un site donné, face
// aux salles existantes (modèle de Huff) :
//
//   adhérents = Σ_c  habitants_c × pénétration × part_c                     carreaux c à ≤ 30 min
//   part_c    = W_p f(t_pc) / (W_p f(t_pc) + k Σ_g W_g f(t_gc))             salles g à ≤ 30 min de c
//
// - f : décroissance log-logistique « premium » de l'étape d, f(t) = 1 / (1 + (t / 7,3)^4), nulle
//   au-delà de 30 min. Le même noyau sert pour le projet et pour les salles existantes : c'est le même
//   habitant qui arbitre entre la distance et l'attrait d'une salle.
// - W : attractivité = capacité en adhérents d'une salle de cette taille et de ce segment, soit
//   surface × adhérents/m². Premium : 0,67 adh/m² (Hall b, 1 600 adhérents pour 2 400 m², chiffres de
//   l'exploitant). Classique : 1,4 adh/m² (règle de l'offre, 02-supply.mjs), pour tous les autres
//   segments. Les adhérents réels, quand ils sont connus, priment.
// - pénétration : 114 ‰ des habitants (p0 de l'étape d, pénétration au pied de Hall b).
// - k : poids des concurrents, 1 par défaut (variantes de sensibilité).
// - temps : ceux du modèle calé (lib-e2sfca.mjs) pour tous ; en mode « zone exacte », ceux du projet
//   sont lus dans des isochrones Valhalla (milieu de la bande de 5 min, comme pour caler f).
//
// f, la pénétration et la densité premium viennent toutes de Hall b : retrouver ses adhérents ne
// valide pas le modèle (voir ROADMAP.md).
import { toLaea, speedKmh, V_MAX, T_ACCESS } from './lib-e2sfca.mjs';

export const CAPTURE = {
  t50: 7.3, beta: 4,             // min : f(t50) = 1/2 (log-logistique de l'étape d)
  tCoupure: 30,                  // min : f = 0 au-delà
  penetration: 0.114,            // adhérents par habitant au pied du club (p0 de l'étape d)
  adhParM2: { premium: 1600 / 2400, classique: 1.4 },
  m2Defaut: 2000, segmentDefaut: 'premium',
};
const SURF_MAX = 6000;           // m² : plafond de 02-supply.mjs

export const noyau = t => t > CAPTURE.tCoupure ? 0 : 1 / (1 + (t / CAPTURE.t50) ** CAPTURE.beta);
export const attractivite = (m2, segment) => Math.min(SURF_MAX, m2) * CAPTURE.adhParM2[segment];
export const segmentDe = g => g.cat === 'premium' ? 'premium' : 'classique';
// Salle existante : ses adhérents réels s'ils sont connus, sinon sa surface au taux de son segment
export const poidsSalle = g => g.surfSrc === 'reel' ? g.cap : attractivite(g.surf, segmentDe(g));

// Index plat des carreaux, en km EPSG:3035 (même origine que grid.bin et audit.mjs)
export function grilleDe(cells) {
  let minCx = Infinity, minCy = Infinity, maxCx = -Infinity, maxCy = -Infinity;
  for (const c of cells) {
    const cx = c.E / 1000, cy = c.N / 1000;
    minCx = Math.min(minCx, cx); minCy = Math.min(minCy, cy); maxCx = Math.max(maxCx, cx); maxCy = Math.max(maxCy, cy);
  }
  const cols = maxCx - minCx + 1, rows = maxCy - minCy + 1, KIDX = new Int32Array(cols * rows).fill(-1);
  cells.forEach((c, i) => { KIDX[(c.E / 1000 - minCx) + (c.N / 1000 - minCy) * cols] = i; });
  return { cells, minCx, minCy, cols, rows, KIDX };
}

// Carreaux à ≤ tMax min d'un point (E, N en m) selon le temps du modèle : fn(i, t). Même formule que
// computeAccess() ; facteur multiplie les temps (variante « vitesse locale » des concurrents).
export function voisins(G, field, E, N, tMax, fn, facteur = 1) {
  const R = Math.ceil((tMax / facteur - T_ACCESS) / 60 * V_MAX) + 1;
  const cx = Math.floor(E / 1000), cy = Math.floor(N / 1000), gD = field.at(cx, cy);
  for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) {
    const x = cx + dx - G.minCx, y = cy + dy - G.minCy;
    if (x < 0 || y < 0 || x >= G.cols || y >= G.rows) continue;
    const i = G.KIDX[x + y * G.cols]; if (i < 0) continue;
    const c = G.cells[i];
    const t = (T_ACCESS + Math.hypot(c.E + 500 - E, c.N + 500 - N) / 1000 / speedKmh((field.dens[i] + gD) / 2) * 60) * facteur;
    if (t <= tMax) fn(i, t);
  }
}

// Concurrence vue de chaque carreau : D_c = Σ_g W_g f(t_gc) sur les salles existantes (temps du modèle).
// exclure(g) : salles écartées (le projet lui-même quand on teste une salle existante).
export function concurrence(G, field, gyms, { exclure = () => false, facteur = 1 } = {}) {
  const D = new Float64Array(G.cells.length);
  for (const g of gyms) {
    if (exclure(g)) continue;
    const w = poidsSalle(g); if (!(w > 0)) continue;
    const [E, N] = toLaea(g.lat, g.lon);
    voisins(G, field, E, N, CAPTURE.tCoupure, (i, t) => { D[i] += w * noyau(t); }, facteur);
  }
  return D;
}

export const BANDES = [10, 15, 20, 30];   // min, bornes hautes : ≤ 10, 10–15, 15–20, 20–30

// Adhérents attendus d'un projet. temps : Map indice de carreau → minutes (zone exacte), sinon temps
// du modèle depuis (lat, lon). marche(c) : adhérents potentiels d'un carreau (habitants × p0 par
// défaut). k : poids des concurrents.
export function capture(G, field, D, { lat, lon, m2 = CAPTURE.m2Defaut, segment = CAPTURE.segmentDefaut, temps = null,
  marche = c => c.ind * CAPTURE.penetration, k = 1 }) {
  const W = attractivite(m2, segment);
  const r = { W, adherents: 0, habitants: 0, marche: 0, sansConcurrent: 0, parBande: BANDES.map(() => 0) };
  const visite = (i, t) => {
    const f = noyau(t); if (!(f > 0)) return;
    const c = G.cells[i], m = marche(c), a = m * W * f / (W * f + k * D[i]);
    r.adherents += a; r.habitants += c.ind; r.marche += m;
    if (D[i] === 0) r.sansConcurrent += a;   // aucune salle à 30 min : Huff y donne tout au projet
    r.parBande[BANDES.findIndex(b => t <= b)] += a;
  };
  if (temps) for (const [i, t] of temps) visite(i, t);
  else { const [E, N] = toLaea(lat, lon); voisins(G, field, E, N, CAPTURE.tCoupure, visite); }
  return r;
}
