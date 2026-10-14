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
import { toLaea, speedKmh, V_MAX, T_ACCESS, VITESSE } from './lib-e2sfca.mjs';

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
export const SURF_MAX = 6000;    // m² : plafond de 02-supply.mjs

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

// ── Classement des sites (« Meilleurs sites » du front, capture.mjs --classement) ─────────────────
export const TAILLES = [1200, 2000, 2400];   // m² proposés dans le front ; défaut CAPTURE.m2Defaut
export const ESPACEMENT_KM = 2;              // deux sites classés sont à au moins 2 km l'un de l'autre
export const SEUIL = 1600;                   // adhérents attendus : filtre par défaut du front (point mort visé)
// Fourchette : les jeux de FAMILLE (équivalents pour Hall b) × le poids des concurrents
export const KS = [0.5, 1, 2];
export const VARIANTES = FAMILLE.flatMap((p, ip) => KS.map(k => ({ ip, p, k })));
export const CENTRALE = VARIANTES.findIndex(v => v.p.nom === CAPTURE.nom && v.k === 1);
export const TOP_ROBUSTESSE = 20;            // robustesse : part des variantes où le site reste dans ce top

// Le classement évalue des dizaines de milliers de sites, chacun sur ~350 carreaux : la vitesse
// (Math.log10) et le noyau (Math.pow) y sont lus dans des tables interpolées linéairement, à moins de
// 2e-5 près du calcul exact de capture(). Le front (gymlocator.html) reprend les mêmes tables.
const PAS_NOYAU = 100;   // pas de la table du noyau : 0,01 min
export function tablesCapture(G, field) {
  const dMin = VITESSE.paliers[0][0], dMax = VITESSE.paliers[VITESSE.paliers.length - 1][0];
  const minParKm = new Float64Array(dMax + 2);   // minutes par km à vol d'oiseau, densité lissée entière
  for (let d = 0; d <= dMax + 1; d++) minParKm[d] = 60 / speedKmh(d);
  const noyaux = FAMILLE.map(p => Float64Array.from({ length: CAPTURE.tCoupure * PAS_NOYAU + 2 }, (_, k) => noyau(Math.min(CAPTURE.tCoupure, k / PAS_NOYAU), p)));
  // Voisins d'un centre de carreau jusqu'à la portée maximale en 30 min (distances en km)
  const R = Math.ceil((CAPTURE.tCoupure - T_ACCESS) / 60 * V_MAX), dxy = [], km = [];
  for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) {
    const d = Math.hypot(dx, dy);
    if (T_ACCESS + d / V_MAX * 60 <= CAPTURE.tCoupure) { dxy.push(dx, dy); km.push(d); }
  }
  const n = G.cells.length, CX = new Int32Array(n), CY = new Int32Array(n);
  G.cells.forEach((c, i) => { CX[i] = c.E / 1000 - G.minCx; CY[i] = c.N / 1000 - G.minCy; });
  return { G, dens: field.dens, ind: Float64Array.from(G.cells, c => c.ind), CX, CY,
    dxy: Int32Array.from(dxy), km: Float64Array.from(km), dMin, dMax, minParKm, noyaux };
}
// Concurrence D de chaque jeu de FAMILLE (le noyau change d'un jeu à l'autre)
export const concurrences = (G, field, gyms, opts = {}) => FAMILLE.map(p => concurrence(G, field, gyms, { ...opts, p }));

// Adhérents captés par un projet d'attractivité W placé au centre du carreau s (mode national, temps
// du modèle), Ds = concurrences(). Retourne un tableau : les VARIANTES puis les habitants à ≤ 30 min.
// toutes = false : la seule variante centrale (étape grossière du classement).
export function captureCarreau(T, Ds, W, s, toutes = true) {
  const { G: { KIDX, cols, rows }, dens, ind, CX, CY, dxy, km, dMin, dMax, minParKm, noyaux } = T;
  const tCut = CAPTURE.tCoupure, nk = KS.length, out = new Float64Array(VARIANTES.length + 1);
  const ip0 = toutes ? 0 : VARIANTES[CENTRALE].ip, ip1 = toutes ? FAMILLE.length : ip0 + 1;
  const x0 = CX[s], y0 = CY[s], dS = dens[s];
  for (let o = 0; o < km.length; o++) {
    const x = x0 + dxy[2 * o], y = y0 + dxy[2 * o + 1];
    if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
    const j = KIDX[x + y * cols]; if (j < 0) continue;
    const dm = (dens[j] + dS) / 2;
    let mpk;
    if (dm >= dMax) mpk = minParKm[dMax]; else if (dm <= dMin) mpk = minParKm[0];
    else { const i = dm | 0; mpk = minParKm[i] + (minParKm[i + 1] - minParKm[i]) * (dm - i); }
    const t = T_ACCESS + km[o] * mpk; if (t > tCut) continue;
    const u = t * PAS_NOYAU, k = u | 0, fr = u - k, h = ind[j];
    for (let ip = ip0; ip < ip1; ip++) {
      const p = FAMILLE[ip], F = noyaux[ip], Wf = W * (F[k] + (F[k + 1] - F[k]) * fr), num = h * p.pratiqueMax * Wf, d0 = p.nonRecours + Wf, D = Ds[ip][j];
      if (toutes) for (let kk = 0; kk < nk; kk++) out[ip * nk + kk] += num / (d0 + KS[kk] * D);
      else out[CENTRALE] += num / (d0 + D);
    }
    out[VARIANTES.length] += h;
  }
  return out;
}

// Estimation centrale de projets d'attractivités Ws au centre de CHAQUE carreau habité (calcul
// exhaustif ; temps et noyau partagés entre les projets) : un Float32Array par projet. Sert au rang
// national du front (05-capture.mjs) et à la stabilité du classement dans l'audit.
export function champCentral(T, Ds, Ws) {
  const { G: { KIDX, cols, rows }, dens, ind, CX, CY, dxy, km, dMin, dMax, minParKm, noyaux } = T;
  const { ip, p } = VARIANTES[CENTRALE], F = noyaux[ip], D = Ds[ip], P = p.pratiqueMax, W0 = p.nonRecours, tCut = CAPTURE.tCoupure;
  const n = ind.length, nw = Ws.length, out = Ws.map(() => new Float32Array(n)), a = new Float64Array(nw);
  for (let s = 0; s < n; s++) {
    a.fill(0);
    const x0 = CX[s], y0 = CY[s], dS = dens[s];
    for (let o = 0; o < km.length; o++) {
      const x = x0 + dxy[2 * o], y = y0 + dxy[2 * o + 1];
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      const j = KIDX[x + y * cols]; if (j < 0) continue;
      const dm = (dens[j] + dS) / 2;
      let mpk;
      if (dm >= dMax) mpk = minParKm[dMax]; else if (dm <= dMin) mpk = minParKm[0];
      else { const i = dm | 0; mpk = minParKm[i] + (minParKm[i + 1] - minParKm[i]) * (dm - i); }
      const t = T_ACCESS + km[o] * mpk; if (t > tCut) continue;
      const u = t * PAS_NOYAU, k = u | 0, f = F[k] + (F[k + 1] - F[k]) * (u - k), hP = ind[j] * P, Dj = D[j];
      for (let w = 0; w < nw; w++) { const Wf = Ws[w] * f; a[w] += hP * Wf / (W0 + Wf + Dj); }
    }
    for (let w = 0; w < nw; w++) out[w][s] = a[w];
  }
  return out;
}
// Points de la distribution publiés pour le rang national : percentiles 0 à 99, puis plus fins en tête
// (99,1 … 99,9 ; 99,91 … 99,99), puis 100. Valeur au percentile q : q % des carreaux font au plus autant.
export const RANGS = [...Array.from({ length: 100 }, (_, i) => i), ...Array.from({ length: 9 }, (_, i) => 99.1 + i / 10),
  ...Array.from({ length: 9 }, (_, i) => 99.91 + i / 100), 100].map(q => Math.round(q * 100) / 100);
export function quantiles(valeurs) {
  const v = Float32Array.from(valeurs).sort(), n = v.length;
  return RANGS.map(q => Math.round(v[Math.min(n - 1, Math.max(0, Math.ceil(q / 100 * n) - 1))]));
}

// Classement des sites d'un ensemble de carreaux habités (le front : ceux de la vue affichée ; ici,
// toute la France ou un cadre) sur les adhérents captés au centre du carreau, deux sites à au moins
// ESPACEMENT_KM l'un de l'autre. Recherche grossière puis fine, validée contre le calcul exhaustif le
// 14/10/2026 (même top 20 dans le même ordre et mêmes seuils de robustesse des 9 variantes, sur la
// France et cinq régions) :
//  1. un représentant par bloc de 4 × 4 km de la grille absolue (le résultat ne dépend donc pas du
//     cadrage) : son carreau éligible le plus peuplé ; variante centrale ;
//  2. tous les carreaux éligibles à ±3 km des 300 meilleurs représentants (un bloc entier est à ±3 km
//     de son représentant : sous 300 représentants, le calcul est exhaustif) ; toutes les variantes ;
//  3. sélection gloutonne par valeur décroissante, en écartant les carreaux trop proches d'un site retenu.
// Pour chaque site : estimation centrale, fourchette (min et max des VARIANTES) et robustesse, le
// nombre de variantes où sa valeur atteint celle du TOP_ROBUSTESSE-ième site du classement de cette
// variante (null sous TOP_ROBUSTESSE sites dans la zone : non mesurée).
// seuil : ne garde que les sites dont l'estimation centrale l'atteint ; meilleur : le premier site, filtre ou non.
export const RECHERCHE = { bloc: 4, meilleurs: 300, rayon: 3 };
export function classerSites(T, Ds, W, eligibles, { n = 20, seuil = 0, espacement = ESPACEMENT_KM } = {}) {
  const { G: { KIDX, cols, rows }, ind, CX, CY } = T, { bloc, meilleurs, rayon } = RECHERCHE;
  const rep = new Map();
  for (const s of eligibles) {
    const cle = Math.floor(CX[s] / bloc) * 100000 + Math.floor(CY[s] / bloc), r = rep.get(cle);
    if (r === undefined || ind[s] > ind[r] || (ind[s] === ind[r] && (CX[s] < CX[r] || (CX[s] === CX[r] && CY[s] < CY[r])))) rep.set(cle, s);
  }
  const grossier = new Map();
  for (const s of rep.values()) grossier.set(s, captureCarreau(T, Ds, W, s, false)[CENTRALE]);
  const eligible = new Uint8Array(T.ind.length); for (const s of eligibles) eligible[s] = 1;
  const fin = new Map();   // carreau → variantes et habitants
  const tri = (ids, v) => ids.sort((a, b) => v(b) - v(a) || CX[a] - CX[b] || CY[a] - CY[b]);
  for (const s of tri([...grossier.keys()], i => grossier.get(i)).slice(0, meilleurs))
    for (let dx = -rayon; dx <= rayon; dx++) for (let dy = -rayon; dy <= rayon; dy++) {
      const x = CX[s] + dx, y = CY[s] + dy; if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      const j = KIDX[x + y * cols];
      if (j >= 0 && eligible[j] && !fin.has(j)) fin.set(j, captureCarreau(T, Ds, W, j));
    }
  const e2 = espacement * espacement;
  const selection = (v, nMax) => {
    const sites = [];
    for (const i of tri([...fin.keys()], v)) {
      if (sites.every(j => (CX[i] - CX[j]) ** 2 + (CY[i] - CY[j]) ** 2 >= e2)) sites.push(i);
      if (sites.length >= nMax) break;
    }
    return sites;
  };
  const seuils = VARIANTES.map((_, v) => { const t = selection(i => fin.get(i)[v], TOP_ROBUSTESSE); return t.length < TOP_ROBUSTESSE ? null : fin.get(t[t.length - 1])[v]; });
  const decrit = i => {
    const r = fin.get(i), vals = Array.from(r.subarray(0, VARIANTES.length));
    return { i, adherents: r[CENTRALE], min: Math.min(...vals), max: Math.max(...vals), variantes: vals, habitants: r[VARIANTES.length],
      robustesse: seuils.includes(null) ? null : vals.filter((x, v) => x >= seuils[v]).length };
  };
  const classes = selection(i => fin.get(i)[CENTRALE], Math.max(n, TOP_ROBUSTESSE)).map(decrit);
  return { sites: classes.filter(s => s.adherents >= seuil).slice(0, n), meilleur: classes[0] ?? null, seuils, evaluations: grossier.size + fin.size };
}
