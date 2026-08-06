// Bibliothèque partagée : projection LAEA (EPSG:3035) + calcul E2SFCA
// Utilisée par 03-e2sfca.mjs (couches finales) et 04-backtest.mjs (validation).
import proj4 from 'proj4';
proj4.defs('EPSG:3035', '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs');
export const toLaea = (lat, lon) => proj4('WGS84', 'EPSG:3035', [lon, lat]); // → [E,N]

// ── Projection LAEA forward autonome (même formule embarquée dans le front) ────
// EPSG guidance note 7-2, ellipsoïde GRS80. Validée contre proj4 dans 03.
export function laeaForward(lat, lon) {
  const a = 6378137, e2 = 0.00669438002290, e = Math.sqrt(e2);
  const rad = Math.PI / 180, phi = lat * rad, lam = lon * rad;
  const phi0 = 52 * rad, lam0 = 10 * rad, FE = 4321000, FN = 3210000;
  const q = p => (1 - e2) * (Math.sin(p) / (1 - e2 * Math.sin(p) ** 2)
    - (1 / (2 * e)) * Math.log((1 - e * Math.sin(p)) / (1 + e * Math.sin(p))));
  const qP = q(Math.PI / 2), q0 = q(phi0), qq = q(phi);
  const beta = Math.asin(qq / qP), beta0 = Math.asin(q0 / qP);
  const Rq = a * Math.sqrt(qP / 2);
  const D = a * Math.cos(phi0) / Math.sqrt(1 - e2 * Math.sin(phi0) ** 2) / (Rq * Math.cos(beta0));
  const B = Rq * Math.sqrt(2 / (1 + Math.sin(beta0) * Math.sin(beta) + Math.cos(beta0) * Math.cos(beta) * Math.cos(lam - lam0)));
  const E = FE + B * D * Math.cos(beta) * Math.sin(lam - lam0);
  const N = FN + (B / D) * (Math.cos(beta0) * Math.sin(beta) - Math.sin(beta0) * Math.cos(beta) * Math.cos(lam - lam0));
  return [E, N];
}

// ── Modèle de temps d'accès : t = accès/parking + distance / vitesse(densité) ──
// Vitesse porte-à-porte décroissante avec la densité (congestion + stationnement) :
// ~62 km/h en rural, ~21 km/h en hyper-urbain. Approximation analytique ; le
// pipeline accepte un raffinement OSRM ultérieur sans changer le reste.
export const T_ACCESS = 3;          // min (stationnement, marche terminale)
export const T_MAX = 15;            // min — zone de chalandise standard
export const SIGMA2 = 2 * 6 * 6;    // décroissance gaussienne, sigma = 6 min
export const speedKmh = dens =>
  62 - 41 * Math.min(1, Math.max(0, (Math.log10(dens + 1) - 1.5) / 2.2));

// ── E2SFCA ──────────────────────────────────────────────────────────────────────
// cells : [{E,N,ind,dem}] (coins SW 3035, mètres) · gyms : [{lat,lon,cap}]
// Retourne { A } : A[i] = places accessibles par adhérent potentiel au carreau i.
// Étape 1 : chaque salle répartit sa capacité entre les demandeurs de sa chalandise
// (une seule fois — pas de double comptage). Étape 2 : chaque carreau cumule ce
// qui lui revient des salles atteignables.
export function computeAccess(cells, gyms) {
  const key = (cx, cy) => cx * 100000 + cy;
  const cellIdx = new Map();
  for (let i = 0; i < cells.length; i++) {
    cellIdx.set(key(Math.floor(cells[i].E / 1000), Math.floor(cells[i].N / 1000)), i);
  }
  const A = new Float64Array(cells.length);
  const RMAX = 13;                  // km — rayon max (15 min à 62 km/h)
  const neigh = [];                 // buffer réutilisé [idx, w]
  let skippedGyms = 0;
  for (const g of gyms) {
    const [gE, gN] = toLaea(g.lat, g.lon);
    const gcx = Math.floor(gE / 1000), gcy = Math.floor(gN / 1000);
    const gi = cellIdx.get(key(gcx, gcy));
    const gDens = gi !== undefined ? cells[gi].ind : 0;   // carreau 1 km → ind = hab/km²
    neigh.length = 0;
    let sumDW = 0;
    for (let dx = -RMAX; dx <= RMAX; dx++) for (let dy = -RMAX; dy <= RMAX; dy++) {
      const i = cellIdx.get(key(gcx + dx, gcy + dy));
      if (i === undefined) continue;
      const c = cells[i];
      const d = Math.hypot(c.E + 500 - gE, c.N + 500 - gN) / 1000;   // km
      const v = speedKmh((c.ind + gDens) / 2);
      const t = T_ACCESS + d / v * 60;
      if (t > T_MAX) continue;
      const w = Math.exp(-t * t / SIGMA2);
      neigh.push(i, w);
      sumDW += c.dem * w;
    }
    if (sumDW < 1) { skippedGyms++; continue; }           // salle sans demande atteignable
    const R = g.cap / sumDW;                              // places par demandeur pondéré
    for (let k = 0; k < neigh.length; k += 2) A[neigh[k]] += R * neigh[k + 1];
  }
  return { A, skippedGyms };
}

// Déficit de ZONE : pour chaque carreau, somme du déficit U de tous les carreaux
// atteignables en ≤ 15 min (même noyau temps/vitesse que le modèle, somme brute).
// C'est la « surface d'opportunité » : ce qu'une salle implantée là aurait en face.
// Le noyau est symétrique (vitesse = f(moyenne des densités des deux carreaux)).
export function computeZoneDeficit(cells, U) {
  const key = (cx, cy) => cx * 100000 + cy;
  const cellIdx = new Map();
  for (let i = 0; i < cells.length; i++) {
    cellIdx.set(key(Math.floor(cells[i].E / 1000), Math.floor(cells[i].N / 1000)), i);
  }
  const UZ = new Float64Array(cells.length);
  const R = 13;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const cx = Math.floor(c.E / 1000), cy = Math.floor(c.N / 1000);
    let s = 0;
    for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) {
      const j = cellIdx.get(key(cx + dx, cy + dy));
      if (j === undefined) continue;
      const d = Math.hypot(dx, dy);
      const t = T_ACCESS + d / speedKmh((c.ind + cells[j].ind) / 2) * 60;
      if (t <= T_MAX) s += U[j];
    }
    UZ[i] = s;
  }
  return UZ;
}

// Percentile pondéré (pour les échelles de couleur et le backtest)
export function weightedQuantiles(values, weights, qs) {
  const idx = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const tot = weights.reduce((s, w) => s + w, 0);
  const out = [];
  let acc = 0, qi = 0;
  for (const i of idx) {
    acc += weights[i];
    while (qi < qs.length && acc >= qs[qi] * tot) out.push(values[i]), qi++;
    if (qi >= qs.length) break;
  }
  while (out.length < qs.length) out.push(values[idx[idx.length - 1]]);
  return out;
}
