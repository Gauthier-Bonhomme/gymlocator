// 04 — Backtest « préférence révélée » : les ouvertures récentes (SIRENE ≥ 2023)
// tombent-elles là où le modèle, calculé avec l'offre ANTÉRIEURE, voyait du déficit ?
// Métrique : pour chaque ouverture, déficit atteignable depuis le site
//   Ucatch(site) = Σ carreaux U_pre × w(t)   (même noyau que le modèle)
// comparé à la distribution de Ucatch pour un adhérent potentiel moyen
// (échantillon de carreaux tiré pondéré par la demande). Si les pros ouvrent
// au hasard de la demande → percentile médian ≈ 50. Au-delà = le classement
// du modèle coïncide avec les choix des professionnels de l'implantation.
import { readFileSync, writeFileSync } from 'node:fs';
import { toLaea, computeAccess, speedKmh, T_ACCESS, T_MAX, SIGMA2 } from './lib-e2sfca.mjs';

const CUTOFF = '2023-01-01';
const cells = JSON.parse(readFileSync(new URL('../data/cells.json', import.meta.url), 'utf8'));
const gyms = JSON.parse(readFileSync(new URL('../data/gyms-fused.json', import.meta.url), 'utf8'));

const openings = gyms.filter(g => g.src.startsWith('sirene') && g.date && g.date >= CUTOFF);
const preGyms = gyms.filter(g => !(g.src.startsWith('sirene') && g.date && g.date >= CUTOFF));
console.log(`Ouvertures ${CUTOFF.slice(0, 4)}+ : ${openings.length} · offre antérieure : ${preGyms.length}`);

const { A } = computeAccess(cells, preGyms);
let sumDA = 0, sumD = 0;
for (let i = 0; i < cells.length; i++) { sumDA += cells[i].dem * A[i]; sumD += cells[i].dem; }
const Aref = sumDA / sumD;
const U = new Float64Array(cells.length);
for (let i = 0; i < cells.length; i++) U[i] = cells[i].dem * Math.max(0, 1 - A[i] / Aref);

// Index spatial des carreaux
const key = (cx, cy) => cx * 100000 + cy;
const cellIdx = new Map();
for (let i = 0; i < cells.length; i++) cellIdx.set(key(Math.floor(cells[i].E / 1000), Math.floor(cells[i].N / 1000)), i);

// Déficit atteignable depuis un point (même noyau temps/décroissance que le modèle)
function uCatch(E, N) {
  const cx = Math.floor(E / 1000), cy = Math.floor(N / 1000);
  const gi = cellIdx.get(key(cx, cy));
  const gDens = gi !== undefined ? cells[gi].ind : 0;
  let s = 0;
  for (let dx = -13; dx <= 13; dx++) for (let dy = -13; dy <= 13; dy++) {
    const i = cellIdx.get(key(cx + dx, cy + dy));
    if (i === undefined) continue;
    const c = cells[i];
    const d = Math.hypot(c.E + 500 - E, c.N + 500 - N) / 1000;
    const t = T_ACCESS + d / speedKmh((c.ind + gDens) / 2) * 60;
    if (t > T_MAX) continue;
    s += U[i] * Math.exp(-t * t / SIGMA2);
  }
  return s;
}

// Distribution de référence : Ucatch vu par un adhérent potentiel moyen
// (tirage systématique pondéré par la demande, ~20 000 points)
const targetN = 20000;
const step = sumD / targetN;
let acc = 0, next = step / 2;
const baseline = [];
for (const c of cells) {
  acc += c.dem;
  while (acc >= next) { baseline.push(uCatch(c.E + 500, c.N + 500)); next += step; }
}
baseline.sort((a, b) => a - b);
const pct = v => {
  let lo = 0, hi = baseline.length;
  while (lo < hi) { const m = (lo + hi) >> 1; baseline[m] <= v ? lo = m + 1 : hi = m; }
  return lo / baseline.length * 100;
};

function evalSet(set, label) {
  const pcts = set.map(o => { const [E, N] = toLaea(o.lat, o.lon); return pct(uCatch(E, N)); })
    .sort((a, b) => a - b);
  const median = pcts[Math.floor(pcts.length / 2)];
  const share = th => pcts.filter(p => p >= 100 - th).length / pcts.length * 100;
  const top20 = share(20), top10 = share(10);
  console.log(`${label} (n=${set.length}) : percentile médian ${median.toFixed(1)} (hasard 50) · top20% ${top20.toFixed(1)} % (hasard 20) · top10% ${top10.toFixed(1)} % (hasard 10)`);
  return { n: set.length, percentileMedian: +median.toFixed(1), partTop20: +top20.toFixed(1), partTop10: +top10.toFixed(1) };
}
console.time('Ucatch ouvertures');
const all = evalSet(openings, 'Toutes ouvertures');
const chains = evalSet(openings.filter(o => o.cat === 'lowcost' || o.cat === 'premium'), 'Chaînes (low-cost/premium)');
const bigOnly = evalSet(openings.filter(o => o.surfSrc === 'dataes' || o.cat === 'lowcost'), 'Vraies salles (surface connue ou low-cost)');
console.timeEnd('Ucatch ouvertures');
const { percentileMedian: median, partTop20: top20, partTop10: top10 } = all;

// Injecte dans meta.json pour la modale Méthode du front
const metaPath = new URL('../meta.json', import.meta.url);
const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
meta.backtest = { cutoff: CUTOFF, toutes: all, chaines: chains, sallesConnues: bigOnly };
writeFileSync(metaPath, JSON.stringify(meta, null, 1));
console.log('meta.json mis à jour avec le backtest.');
