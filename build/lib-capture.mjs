// Modèle de capture d'un projet de salle (étape e de ROADMAP.md).
//
// Adhérents attendus d'une salle nouvelle, de taille et de segment donnés, sur un site donné, face
// aux salles existantes et à l'option « pas de salle » (modèle de Huff avec non-recours) :
//
//   adhérents = Σ_c  habitants_c × P × part_c                                     carreaux c à ≤ 30 min
//   part_c    = W_p f(t_pc) / (W_0 + W_p f(t_pc) + k Σ_g W_g f(t_gc))              salles g à ≤ 30 min de c
//
// - W_0 : non-recours, l'attrait de « ne s'inscrire nulle part », dans l'unité des W (adhérents). Sans
//   lui (Huff pur, première moitié de e), un village sans salle à 30 min revenait en entier au projet,
//   même à 25 min : la queue lointaine était surestimée et un site isolé sortait en tête. Avec lui, la
//   part captée baisse avec la distance même sans concurrent : W_p f / (W_0 + W_p f).
// - P : pratique maximale, la part des habitants inscrits quand l'offre est abondante et proche. Le
//   taux de pratique d'un carreau vaut P × S / (W_0 + S), S = Σ W f de toutes les salles accessibles.
// - f : décroissance log-logistique f(t) = 1 / (1 + (t / t50)^β), nulle au-delà de 30 min. Le même noyau
//   sert pour le projet et pour les salles existantes : c'est le même habitant qui arbitre.
// - W : attractivité = capacité en adhérents d'une salle de cette taille et de ce segment, soit
//   surface × adhérents/m². Premium : 0,67 adh/m² (Hall b, 1 600 adhérents pour 2 400 m², chiffres de
//   l'exploitant). Classique : 1,4 adh/m² (règle de l'offre, 02-supply.mjs), pour tous les autres
//   segments. Les adhérents réels, quand ils sont connus, priment.
// - k : poids des concurrents, 1 par défaut (variantes de sensibilité).
// - temps : ceux du modèle calé (lib-e2sfca.mjs) pour tous ; en mode « zone exacte », ceux du projet
//   sont lus dans des isochrones Valhalla (milieu de la bande de 5 min).
//
// Calage (calage-capture.mjs) : f, P et W_0 sont ajustés ensemble sur la répartition des adhérents de
// Hall b par bande de temps Valhalla (donnée privée, hors du dépôt). Un seul club ne les sépare pas :
// un non-recours plus fort, une pratique maximale plus haute et un noyau plus étroit redonnent la même
// pénétration autour de Hall b (FAMILLE, équivalente à la surdispersion près). Hall b fixe sa
// pénétration au pied du club et la distance où elle est divisée par deux, pas leur partage entre f,
// P et W_0. Le point central est celui qui redonne le taux de pratique national de la demande (10 %,
// 01-demand.mjs) avec toutes les salles existantes ; les deux autres encadrent ce choix.
// Le calage vient d'un seul club : retrouver ses adhérents ne valide pas le modèle (voir ROADMAP.md).
import { toLaea, speedKmh, V_MAX, T_ACCESS } from './lib-e2sfca.mjs';

// Jeux de paramètres équivalents pour Hall b (calage-capture.mjs, 14/10/2026), du non-recours le plus
// faible au plus fort ; t50 en minutes, W_0 en adhérents, P en part des habitants.
export const FAMILLE = [
  { nom: 'W0 200', nonRecours: 200, t50: 4.6, beta: 3.4, pratiqueMax: 0.152 },
  { nom: 'W0 400', nonRecours: 400, t50: 5.0, beta: 3.4, pratiqueMax: 0.178 },   // central : pratique nationale 10 %
  { nom: 'W0 800', nonRecours: 800, t50: 5.5, beta: 3.4, pratiqueMax: 0.215 },
];
export const CAPTURE = {
  ...FAMILLE[1],
  tCoupure: 30,                  // min : f = 0 au-delà
  adhParM2: { premium: 1600 / 2400, classique: 1.4 },
  m2Defaut: 2000, segmentDefaut: 'premium',
};
const SURF_MAX = 6000;           // m² : plafond de 02-supply.mjs

// p : jeu de paramètres (CAPTURE par défaut, ou un membre de FAMILLE)
export const noyau = (t, p = CAPTURE) => t > CAPTURE.tCoupure ? 0 : 1 / (1 + (t / p.t50) ** p.beta);
export const attractivite = (m2, segment) => Math.min(SURF_MAX, m2) * CAPTURE.adhParM2[segment];
export const segmentDe = g => g.cat === 'premium' ? 'premium' : 'classique';
// Salle existante : ses adhérents réels s'ils sont connus, sinon sa surface au taux de son segment
export const poidsSalle = g => g.surfSrc === 'reel' ? g.cap : attractivite(g.surf, segmentDe(g));
// Taux de pratique d'un carreau qui voit l'attractivité S = Σ W f (toutes salles, projet compris)
export const pratique = (S, p = CAPTURE) => S > 0 ? p.pratiqueMax * S / (p.nonRecours + S) : 0;

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
export function concurrence(G, field, gyms, { exclure = () => false, facteur = 1, p = CAPTURE } = {}) {
  const D = new Float64Array(G.cells.length);
  for (const g of gyms) {
    if (exclure(g)) continue;
    const w = poidsSalle(g); if (!(w > 0)) continue;
    const [E, N] = toLaea(g.lat, g.lon);
    voisins(G, field, E, N, CAPTURE.tCoupure, (i, t) => { D[i] += w * noyau(t, p); }, facteur);
  }
  return D;
}

// ── Zone exacte : isochrones Valhalla du projet (cache de capture.mjs) ────────────────────────────
export const CONTOURS = [5, 10, 15, 20, 25, 30];
// Centre du carreau dans le polygone (contours extérieurs), comme isoStats() du front
const pip = (x, y, ring) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) ins = !ins; } return ins; };
function dansContour(G, geom, fn) {
  const rings = (geom.type === 'Polygon' ? [geom.coordinates[0]] : geom.coordinates.map(p => p[0])).map(r => r.map(([lo, la]) => toLaea(la, lo)));
  let E0 = Infinity, E1 = -Infinity, N0 = Infinity, N1 = -Infinity;
  for (const r of rings) for (const [E, N] of r) { E0 = Math.min(E0, E); E1 = Math.max(E1, E); N0 = Math.min(N0, N); N1 = Math.max(N1, N); }
  for (let x = Math.floor(E0 / 1000); x <= Math.floor(E1 / 1000); x++) for (let y = Math.floor(N0 / 1000); y <= Math.floor(N1 / 1000); y++) {
    const gx = x - G.minCx, gy = y - G.minCy; if (gx < 0 || gy < 0 || gx >= G.cols || gy >= G.rows) continue;
    const i = G.KIDX[gx + gy * G.cols];
    if (i >= 0 && rings.some(r => pip(x * 1000 + 500, y * 1000 + 500, r))) fn(i);
  }
}
// Temps du projet par carreau : milieu de la première bande de 5 min qui le contient ; habitants par contour
export function tempsIsochrones(G, I) {
  const temps = new Map(), popContour = {};
  for (const min of CONTOURS) {   // du plus petit au plus grand : un carreau prend sa première bande
    let pop = 0;
    dansContour(G, I.contours[min], i => { pop += G.cells[i].ind; if (!temps.has(i)) temps.set(i, min - 2.5); });
    popContour[min] = pop;
  }
  return { temps, popContour };
}
// Rapport local temps Valhalla / temps du modèle depuis le projet (médiane pondérée par les habitants
// de la zone exacte) : variante où les concurrents roulent aussi vite que le projet autour du site.
export function rapportLocal(G, field, E, N, temps) {
  const r = []; voisins(G, field, E, N, 90, (i, t) => { if (temps.has(i)) r.push([temps.get(i) / t, G.cells[i].ind]); });
  r.sort((a, b) => a[0] - b[0]);
  let acc = 0; const tot = r.reduce((s, x) => s + x[1], 0);
  for (const [v, w] of r) { acc += w; if (acc >= tot / 2) return v; }
  return 1;
}

export const BANDES = [10, 15, 20, 30];   // min, bornes hautes : ≤ 10, 10–15, 15–20, 20–30

// Adhérents attendus d'un projet. D : concurrence() calculée avec le même jeu p. temps : Map indice de
// carreau → minutes (zone exacte), sinon temps du modèle depuis (lat, lon). marche(c, p) : habitants
// susceptibles de s'inscrire au maximum (habitants × P par défaut). k : poids des concurrents.
export function capture(G, field, D, { lat, lon, m2 = CAPTURE.m2Defaut, segment = CAPTURE.segmentDefaut, temps = null,
  marche = (c, p) => c.ind * p.pratiqueMax, k = 1, p = CAPTURE }) {
  const W = attractivite(m2, segment), W0 = p.nonRecours;
  const r = { W, adherents: 0, habitants: 0, inscrits: 0, sansConcurrent: 0, parBande: BANDES.map(() => 0) };
  const visite = (i, t) => {
    const f = noyau(t, p); if (!(f > 0)) return;
    const c = G.cells[i], m = marche(c, p), S = W * f + k * D[i], a = m * W * f / (W0 + S);
    r.adherents += a; r.habitants += c.ind;
    r.inscrits += m * S / (W0 + S);          // inscrits de toutes les salles, projet compris
    if (D[i] === 0) r.sansConcurrent += a;   // aucune salle à 30 min : seul le non-recours retient
    r.parBande[BANDES.findIndex(b => t <= b)] += a;
  };
  if (temps) for (const [i, t] of temps) visite(i, t);
  else { const [E, N] = toLaea(lat, lon); voisins(G, field, E, N, CAPTURE.tCoupure, visite); }
  return r;
}
