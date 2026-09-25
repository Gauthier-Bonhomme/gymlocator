// Outil de mesure — photographie chiffrée du modèle, comparée à une référence figée.
// Sert à juger chaque branche avec le même étalon (voir build/README.md).
//
//   node audit.mjs                 mesure + écarts à la référence
//   node audit.mjs --figer         enregistre l'état actuel comme nouvelle référence
//   node audit.mjs --sensibilite   ajoute les variantes de paramètres (~3 min de plus)
//
// Lit uniquement data/ (cells.json, gyms-fused.json, sirene.json, dataes.json) et écrit
// dans build/audit/ (non versionné, comme data/). La référence dépend de data/ : la refiger
// après tout nouveau téléchargement des sources, AVANT de modifier le code.
// Les ouvertures du backtest sont figées au premier lancement (audit/ouvertures-figees.json) :
// le percentile ne doit pas bouger simplement parce que l'offre a été nettoyée.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { toLaea, computeAccess, computeZoneDeficit, speedKmh, T_ACCESS, T_MAX, SIGMA2 } from './lib-e2sfca.mjs';

const args = new Set(process.argv.slice(2));
const FIGER = args.has('--figer'), SENSI = args.has('--sensibilite');
const DATA = new URL('../data/', import.meta.url), AUD = new URL('./audit/', import.meta.url);
mkdirSync(AUD, { recursive: true });
const readJson = u => JSON.parse(readFileSync(u, 'utf8'));
const t0 = Date.now();

const cells = readJson(new URL('cells.json', DATA));
const gyms = readJson(new URL('gyms-fused.json', DATA));
const meta = readJson(new URL('../meta.json', import.meta.url));
const n = cells.length;
const CUTOFF = '2023-01-01';                 // même date que 04-backtest.mjs
const HALLB = { lat: 43.80749, lon: 4.22952 }; // Hall b (Saint-Dionisy, 30) — seul point de calibration réel
const NEW_M2 = meta.modele?.newGymM2 ?? 1200, PER_M2 = meta.modele?.membresParM2 ?? 1.4;
const NE = /non employeur|0 salarié/i;       // tranches « sans salarié » de SIRENE

const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const fmt = v => Math.round(v).toLocaleString('fr-FR');
const pct = (v, d = 1) => (v * 100).toFixed(d).replace('.', ',') + ' %';
const dec = (v, d = 2) => v.toFixed(d).replace('.', ',');
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

// ── Grille : index plat (même origine que grid.bin) ────────────────────────────
let minCx = Infinity, minCy = Infinity, maxCx = -Infinity, maxCy = -Infinity;
for (const c of cells) {
  const cx = c.E / 1000, cy = c.N / 1000;
  minCx = Math.min(minCx, cx); minCy = Math.min(minCy, cy); maxCx = Math.max(maxCx, cx); maxCy = Math.max(maxCy, cy);
}
const cols = maxCx - minCx + 1, rows = maxCy - minCy + 1;
const KIDX = new Int32Array(cols * rows).fill(-1);
const CX = new Int32Array(n), CY = new Int32Array(n);
cells.forEach((c, i) => { CX[i] = c.E / 1000 - minCx; CY[i] = c.N / 1000 - minCy; KIDX[CX[i] + CY[i] * cols] = i; });
const cellKey = i => (CX[i] + minCx) * 10000 + (CY[i] + minCy);   // clé stable : km EPSG:3035

// Carreaux atteignables en ≤ 15 min depuis un point (même noyau que 04-backtest et le front)
function around(E, N, fn) {
  const cx = Math.floor(E / 1000) - minCx, cy = Math.floor(N / 1000) - minCy;
  const gi = (cx >= 0 && cy >= 0 && cx < cols && cy < rows) ? KIDX[cx + cy * cols] : -1;
  const gD = gi >= 0 ? cells[gi].ind : 0;
  for (let dx = -13; dx <= 13; dx++) for (let dy = -13; dy <= 13; dy++) {
    const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
    const i = KIDX[x + y * cols]; if (i < 0) continue;
    const c = cells[i];
    const d = Math.hypot(c.E + 500 - E, c.N + 500 - N) / 1000;
    const t = T_ACCESS + d / speedKmh((c.ind + gD) / 2) * 60; if (t > T_MAX) continue;
    fn(i, Math.exp(-t * t / SIGMA2));
  }
}
// Couches du modèle — mêmes étapes que 03-e2sfca.mjs (à tenir alignées si 03 change)
function layers(gymSet) {
  const { A } = computeAccess(cells, gymSet);
  let sDA = 0, sD = 0;
  for (let i = 0; i < n; i++) { sDA += cells[i].dem * A[i]; sD += cells[i].dem; }
  const Aref = sDA / sD, rel = new Float64Array(n), U = new Float64Array(n);
  for (let i = 0; i < n; i++) { rel[i] = A[i] / Aref; U[i] = cells[i].dem * Math.max(0, 1 - rel[i]); }
  return { A, Aref, rel, U };
}
// Maxima du déficit de zone séparés d'au moins `sep` km (proxy des « zones sous-équipées »)
function topSites(UZ, k = 20, sep = 20) {
  const idx = Array.from(UZ.keys()).sort((a, b) => UZ[b] - UZ[a]), out = [];
  for (const i of idx) {
    if (out.every(j => Math.hypot(CX[i] - CX[j], CY[i] - CY[j]) >= sep)) out.push(i);
    if (out.length >= k) break;
  }
  return out;
}
const inIDF = c => c.lat > 48.1 && c.lat < 49.25 && c.lon > 1.45 && c.lon < 3.56;   // boîte approximative
function ranks(v) {
  const idx = Array.from(v.keys()).sort((a, b) => v[a] - v[b]), r = new Float64Array(v.length);
  idx.forEach((i, k) => { r[i] = k; }); return r;
}
function spearman(a, b) {
  const ra = ranks(a), rb = ranks(b), mu = (a.length - 1) / 2;
  let s = 0, va = 0, vb = 0;
  for (let i = 0; i < a.length; i++) { s += (ra[i] - mu) * (rb[i] - mu); va += (ra[i] - mu) ** 2; vb += (rb[i] - mu) ** 2; }
  return s / Math.sqrt(va * vb);
}
const topShare = (v, frac) => new Set(Array.from(v.keys()).sort((a, b) => v[b] - v[a]).slice(0, Math.round(v.length * frac)));

// ── 1. Qualité de l'offre ───────────────────────────────────────────────────────
// Les attributs absents de gyms-fused (tranche d'effectifs, ouverture au public, installation)
// sont retrouvés dans les sources ; si 02 les ajoute un jour, ils sont utilisés directement.
const sirene = readJson(new URL('sirene.json', DATA));
const trancheOf = new Map();
for (const r of sirene) {
  const g = r.geolocetablissement; if (!g || g.lat == null) continue;
  trancheOf.set(`${(r.siret || '').slice(0, 9)}|${+g.lat.toFixed(5)}|${+g.lon.toFixed(5)}`, r.trancheeffectifsetablissement || null);
}
const trancheOfGym = g => g.tranche !== undefined ? g.tranche : trancheOf.get(`${g.siren}|${g.lat}|${g.lon}`);
const dataes = readJson(new URL('dataes.json', DATA));
const esName = e => e.equip_nom && e.equip_nom.length > 3 && !/salle de musculation|musculation|cardio/i.test(e.equip_nom)
  ? e.equip_nom : (e.inst_nom || 'Salle de musculation');                 // même règle que 02-supply
const esRows = new Map();
for (const e of dataes) {
  const c = e.equip_coordonnees; if (!c || c.lat == null) continue;
  const k = `${+c.lat.toFixed(5)}|${+c.lon.toFixed(5)}|${esName(e)}`;
  (esRows.get(k) || esRows.set(k, []).get(k)).push(e);
}
const des = gyms.filter(g => g.src === 'dataes');
const desInfo = des.map(g => {
  if (g.ouvPublic !== undefined) return { pub: g.ouvPublic, inst: g.inst ?? g.name };
  const e = esRows.get(`${g.lat}|${g.lon}|${g.name}`)?.shift();
  return e ? { pub: e.equip_ouv_public_bool, inst: e.inst_nom } : null;
});
const sir = gyms.filter(g => g.src.startsWith('sirene'));
const sirTranche = sir.map(trancheOfGym);
const capTot = sum(gyms, g => g.cap);

const nonPub = des.filter((g, i) => desInfo[i] && String(desInfo[i].pub) === 'false');
const groups = new Map();
des.forEach((g, i) => { const k = `${g.lat}|${g.lon}|${desInfo[i]?.inst ?? g.name}`; (groups.get(k) || groups.set(k, []).get(k)).push(g); });
let extraRows = 0, extraCap = 0;
for (const a of groups.values()) if (a.length > 1) { extraRows += a.length - 1; extraCap += sum(a, g => g.cap) - Math.max(...a.map(g => g.cap)); }
const nonEmp = sir.filter((g, i) => NE.test(sirTranche[i] || ''));
const byCoord = new Map();
for (const g of gyms) { const k = `${g.lat}|${g.lon}`; (byCoord.get(k) || byCoord.set(k, []).get(k)).push(g); }
const stacked = [...byCoord.values()].filter(a => a.length >= 3).flat();
const CHAINS = [['Basic-Fit', /basic.?fit/i], ['Fitness Park', /fitness ?park/i], ['Keep Cool', /keep.?cool/i], ["L'Orange Bleue", /orange ?bleue/i], ['On Air', /on ?air/i]];
const chains = CHAINS.map(([nom, re]) => {
  // surface mesurée = Data ES (surfDataes quand 02 retient le format de l'enseigne à la place)
  const a = gyms.filter(g => re.test(g.name)), mes = g => g.surfDataes ?? (g.surfSrc === 'dataes' ? g.surf : null);
  const m = a.filter(g => mes(g) > 0);
  return { nom, n: a.length, mesurees: m.length, surfMesuree: median(m.map(mes)), surfRetenue: median(a.map(g => g.surf)) };
});
const hallbGym = gyms.find(g => /hall ?b\b/i.test(g.name) && Math.hypot(g.lat - HALLB.lat, g.lon - HALLB.lon) < 0.02);
const supply = {
  salles: gyms.length, capacite: capTot,
  partCapaciteDefaut: sum(gyms.filter(g => g.surfSrc === 'defaut'), g => g.cap) / capTot,
  partCapaciteEnseigne: sum(gyms.filter(g => g.surfSrc === 'enseigne'), g => g.cap) / capTot,
  dataesNonPublics: nonPub.length, partCapaciteNonPublique: sum(nonPub, g => g.cap) / capTot,
  lignesDataesEnTrop: extraRows, capaciteLignesEnTrop: extraCap,
  sireneSansSalarie: nonEmp.length, partCapaciteSansSalarie: sum(nonEmp, g => g.cap) / capTot,
  sallesEmpileesMemePoint: stacked.length, capaciteEmpilee: sum(stacked, g => g.cap),
  jointure: { sirene: sirTranche.filter(t => t !== undefined).length / (sir.length || 1), dataes: desInfo.filter(Boolean).length / (des.length || 1) },
  chaines: chains,
  hallb: hallbGym ? { surface: hallbGym.surf, capacite: hallbGym.cap, type: hallbGym.cat, source: hallbGym.surfSrc } : null,
};

// ── 2. Modèle actuel ────────────────────────────────────────────────────────────
console.log('Calcul du modèle actuel (≈ 40 s)…');
const M = layers(gyms);
const UZ = computeZoneDeficit(cells, M.U);
const totD = sum(cells, c => c.dem), totU = M.U.reduce((s, u) => s + u, 0);
const CLASSES = [[0, 50, '< 50'], [50, 200, '50–200'], [200, 1000, '200–1 000'], [1000, 4000, '1 000–4 000'], [4000, Infinity, '> 4 000']];
const densite = CLASSES.map(([lo, hi, lbl]) => {
  let d = 0, dr = 0, u = 0;
  for (let i = 0; i < n; i++) if (cells[i].ind >= lo && cells[i].ind < hi) { d += cells[i].dem; dr += cells[i].dem * M.rel[i]; u += M.U[i]; }
  return { classe: lbl, partDemande: d / totD, couverture: dr / d, partDeficit: u / totU, partNonDesservie: u / d };
});
let sansSalle = 0; for (let i = 0; i < n; i++) if (M.A[i] === 0) sansSalle += cells[i].dem;
const sites = topSites(UZ);
const hbE = toLaea(HALLB.lat, HALLB.lon);
const hb = { pop: 0, dem: 0, brut: 0, pondere: 0 };
let hbDW = 0, hbDW2 = 0;
around(hbE[0], hbE[1], (i, w) => {
  hb.pop += cells[i].ind; hb.dem += cells[i].dem; hb.brut += M.U[i]; hb.pondere += M.U[i] * w;
  hbDW += cells[i].dem * w; hbDW2 += cells[i].dem * w * w;
});
// Écart en salles de référence : une salle placée là réduit le déficit pondéré de
// (capacité / Aref) × w̄, w̄ = Σ dem·w² / Σ dem·w (même règle que verdict() dans le front)
hb.ecartSalles = Math.floor(hb.pondere / (NEW_M2 * PER_M2 / M.Aref * (hbDW > 0 ? hbDW2 / hbDW : 1)));
const model = {
  Aref: M.Aref, deficitNational: totU, uzMax: Math.max(...sites.map(i => UZ[i])),
  partDemandeSansSalle: sansSalle / totD,
  partDeficitMoinsDe1000: densite.slice(0, 3).reduce((s, c) => s + c.partDeficit, 0),
  densite,
  top20: sites.map(i => ({ lat: cells[i].lat, lon: cells[i].lon, E: cells[i].E, N: cells[i].N, uz: Math.round(UZ[i]) })),
  top20IDF: sites.filter(i => inIDF(cells[i])).length,
  hallb: hb,
};
// Reproduction : grid.bin publié == calcul local ? (seulement s'il vient des mêmes données)
let reproduction;
if (meta.n === n && meta.national.salles === gyms.length) {
  const buf = readFileSync(new URL('../grid.bin', import.meta.url));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const idx = new Uint32Array(ab, 0, n), gUZ = new Uint16Array(ab, n * 4 + n * 8, n);
  const pos = new Map(); for (let k = 0; k < n; k++) pos.set(idx[k], k);
  let maxDiff = 0;
  for (let i = 0; i < n; i++) {
    const k = pos.get(CX[i] + CY[i] * cols);
    maxDiff = Math.max(maxDiff, k === undefined ? Infinity : Math.abs(gUZ[k] - Math.min(65535, Math.round(UZ[i]))));
  }
  reproduction = maxDiff === 0 ? 'identique à grid.bin' : `ÉCART avec grid.bin (max ${maxDiff}) — 03 et cet outil ne calculent plus la même chose`;
} else {
  reproduction = `non vérifiée : grid.bin (${meta.generated}, ${fmt(meta.national.salles)} salles) ne vient pas de data/ (${fmt(gyms.length)} salles)`;
}

// ── 3. Backtest sur ouvertures figées ───────────────────────────────────────────
const OPEN_FILE = new URL('ouvertures-figees.json', AUD);
let openings, openingsNew = false;
if (existsSync(OPEN_FILE)) openings = readJson(OPEN_FILE);
else {
  openings = sir.map((g, i) => ({ g, t: sirTranche[i] })).filter(({ g }) => g.date && g.date >= CUTOFF)
    .map(({ g, t }) => ({ siren: g.siren, lat: g.lat, lon: g.lon, name: g.name, cat: g.cat, date: g.date, tranche: t ?? null }));
  writeFileSync(OPEN_FILE, JSON.stringify(openings));
  openingsNew = true;
}
console.log('Backtest sur les ouvertures figées…');
const openKey = new Set(openings.map(o => `${o.siren}|${o.lat}|${o.lon}`));
const pre = gyms.filter(g => !(g.src.startsWith('sirene') && ((g.date && g.date >= CUTOFF) || openKey.has(`${g.siren}|${g.lat}|${g.lon}`))));
const P = layers(pre);
const catchAt = (E, N) => { let w = 0, r = 0; around(E, N, (i, wt) => { w += P.U[i] * wt; r += P.U[i]; }); return [w, r]; };
const baseW = [], baseR = [];
{ // tirage systématique pondéré par la demande (comme 04)
  const step = totD / 20000; let acc = 0, next = step / 2;
  for (let i = 0; i < n; i++) {
    acc += cells[i].dem;
    while (acc >= next) { const [w, r] = catchAt(cells[i].E + 500, cells[i].N + 500); baseW.push(w); baseR.push(r); next += step; }
  }
  baseW.sort((a, b) => a - b); baseR.sort((a, b) => a - b);
}
const pctOf = (arr, v) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; arr[m] <= v ? lo = m + 1 : hi = m; } return lo / arr.length * 100; };
function backtest(set) {
  const pw = [], pr = [];
  for (const o of set) { const [E, N] = toLaea(o.lat, o.lon); const [w, r] = catchAt(E, N); pw.push(pctOf(baseW, w)); pr.push(pctOf(baseR, r)); }
  const top20 = a => a.filter(p => p >= 80).length / (a.length || 1);
  return { n: set.length, pondere: { median: median(pw), top20: top20(pw) }, brut: { median: median(pr), top20: top20(pr) } };
}
const bt = {
  toutes: backtest(openings),
  avecSalaries: backtest(openings.filter(o => o.tranche && !NE.test(o.tranche))),
  chaines: backtest(openings.filter(o => o.cat === 'lowcost' || o.cat === 'premium')),
};

// ── 4. Stabilité par rapport à la référence ─────────────────────────────────────
const REF_JSON = new URL('reference.json', AUD), REF_UZ = new URL('reference-uz.bin.gz', AUD);
const ref = existsSync(REF_JSON) ? readJson(REF_JSON) : null;
let stabilite = null;
if (ref && existsSync(REF_UZ)) {
  const raw = gunzipSync(readFileSync(REF_UZ));
  const m = raw.byteLength / 8, keys = new Int32Array(raw.buffer, raw.byteOffset, m), vals = new Float32Array(raw.buffer, raw.byteOffset + m * 4, m);
  const refMap = new Map(); for (let k = 0; k < m; k++) refMap.set(keys[k], vals[k]);
  const a = [], b = [];
  for (let i = 0; i < n; i++) { const v = refMap.get(cellKey(i)); if (v !== undefined) { a.push(v); b.push(UZ[i]); } }
  const A1 = Float64Array.from(a), B1 = Float64Array.from(b);
  const ta = topShare(A1, 0.01), tb = topShare(B1, 0.01);
  let common = 0; for (const x of ta) if (tb.has(x)) common++;
  const kept = ref.model.top20.filter(s => sites.some(i => Math.hypot(cells[i].E - s.E, cells[i].N - s.N) <= 10000)).length;
  stabilite = { carreauxCommuns: a.length, spearman: spearman(A1, B1), top1Conserve: common / ta.size, top20Retrouves: kept };
}

// ── 5. Sensibilité (option) ─────────────────────────────────────────────────────
// Réimplémentation paramétrée du modèle ; elle doit d'abord reproduire la version actuelle,
// sinon la section est ignorée (le cœur du modèle a changé : l'adapter ici).
let sensibilite = null;
if (SENSI) {
  console.log('Variantes de paramètres (≈ 3 min)…');
  const G = gyms.map(g => { const [E, N] = toLaea(g.lat, g.lon); return { g, E, N }; });
  const DEM0 = Float64Array.from(cells, c => c.dem), IND = Float64Array.from(cells, c => c.ind);
  const S0 = Math.sqrt(SIGMA2 / 2);
  function run({ keep = () => true, dem = DEM0, detour = 1, sigma = S0, tmax = T_MAX, cap = g => g.cap, weighted = true } = {}) {
    const S2 = 2 * sigma * sigma, R = Math.ceil((tmax - T_ACCESS) / 60 * speedKmh(0) / detour) + 1;
    const A = new Float64Array(n);
    for (const { g, E, N } of G) {
      if (!keep(g)) continue; const c = cap(g); if (!(c > 0)) continue;
      const gx = Math.floor(E / 1000) - minCx, gy = Math.floor(N / 1000) - minCy;
      const gi = (gx >= 0 && gy >= 0 && gx < cols && gy < rows) ? KIDX[gx + gy * cols] : -1, gD = gi >= 0 ? IND[gi] : 0;
      const ks = [], ws = []; let sdw = 0;
      for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) {
        const x = gx + dx, y = gy + dy; if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
        const i = KIDX[x + y * cols]; if (i < 0) continue;
        const d = Math.hypot((x + minCx) * 1000 + 500 - E, (y + minCy) * 1000 + 500 - N) / 1000 * detour;
        const t = T_ACCESS + d / speedKmh((IND[i] + gD) / 2) * 60; if (t > tmax) continue;
        const w = Math.exp(-t * t / S2); ks.push(i); ws.push(w); sdw += dem[i] * w;
      }
      if (sdw < 1) continue;
      const r = c / sdw; for (let k = 0; k < ks.length; k++) A[ks[k]] += r * ws[k];
    }
    let sDA = 0, sD = 0; for (let i = 0; i < n; i++) { sDA += dem[i] * A[i]; sD += dem[i]; }
    const U = new Float64Array(n); for (let i = 0; i < n; i++) U[i] = dem[i] * Math.max(0, 1 - A[i] / (sDA / sD));
    const OFFS = []; for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) { const d = Math.hypot(dx, dy) * detour; if (T_ACCESS + d / speedKmh(0) * 60 <= tmax) OFFS.push([dx, dy, d]); }
    const Z = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (const [dx, dy, d] of OFFS) {
        const x = CX[i] + dx, y = CY[i] + dy; if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
        const j = KIDX[x + y * cols]; if (j < 0 || U[j] === 0) continue;
        const t = T_ACCESS + d / speedKmh((IND[i] + IND[j]) / 2) * 60; if (t > tmax) continue;
        s += weighted ? U[j] * Math.exp(-t * t / S2) : U[j];
      }
      Z[i] = s;
    }
    return Z;
  }
  let maxDiff = 0; { const Z = run(); for (let i = 0; i < n; i++) maxDiff = Math.max(maxDiff, Math.abs(Z[i] - UZ[i])); }
  if (maxDiff > 0.5) {
    sensibilite = { ignoree: `la version paramétrée ne reproduit plus le modèle (écart max ${dec(maxDiff, 1)})` };
  } else {
    const densMul = d => d < 50 ? 0.6 : d < 200 ? 0.8 : d < 1000 ? 1.0 : d < 4000 ? 1.2 : 1.35;
    const demUR = Float64Array.from(cells, c => c.dem * densMul(c.ind)); { const k = totD / demUR.reduce((s, x) => s + x, 0); for (let i = 0; i < n; i++) demUR[i] *= k; }
    const PER_CAT = { lowcost: 2.5, premium: 0.9, classic: 1.2, niche: 1.0, asso: 0.8 };
    const nonEmpSet = new Set(nonEmp);
    const VARIANTES = [
      ['Détour routier × 1,3', { detour: 1.3 }],
      ['σ = 4 min', { sigma: 4 }], ['σ = 10 min', { sigma: 10 }],
      ['Zone de 10 min', { tmax: 10 }], ['Zone de 20 min', { tmax: 20 }],
      ['Pratique ×0,6 en rural → ×1,35 en dense', { dem: demUR }],
      ['Adhérents/m² par type de salle', { cap: g => Math.min(6000, g.surf) * PER_CAT[g.cat] }],
      ['Sans les SIRENE sans salarié', { cap: g => nonEmpSet.has(g) ? 0 : g.cap }],
      ['Déficit de zone non pondéré (somme brute)', { weighted: false }],
    ];
    const t1 = topShare(UZ, 0.01);
    sensibilite = VARIANTES.map(([nom, o]) => {
      const Z = run(o), st = topSites(Z); let c = 0; for (const x of topShare(Z, 0.01)) if (t1.has(x)) c++;
      return { variante: nom, spearman: spearman(UZ, Z), top1Conserve: c / t1.size, top20Retrouves: sites.filter(i => st.some(j => Math.hypot(CX[i] - CX[j], CY[i] - CY[j]) <= 10)).length };
    });
  }
}

// ── Rapport ─────────────────────────────────────────────────────────────────────
const report = { date: new Date().toISOString().slice(0, 10), donnees: { carreaux: n, salles: gyms.length }, reproduction, supply, model, backtest: bt, stabilite, sensibilite };
writeFileSync(new URL('dernier.json', AUD), JSON.stringify(report, null, 1));

const line = (l, v) => console.log(`  ${l.padEnd(46)} ${v}`);
console.log(`\n══ Audit GymLocator · ${report.date} · ${fmt(n)} carreaux · ${fmt(gyms.length)} salles ══`);
console.log(`Reproduction : ${reproduction}`);
if (openingsNew) console.log(`Ouvertures du backtest figées maintenant : ${fmt(openings.length)} (build/audit/ouvertures-figees.json)`);
console.log('\nOffre');
line('Capacité nationale', `${fmt(capTot)} places`);
line('Part de capacité à surface par défaut', pct(supply.partCapaciteDefaut));
line('Part de capacité au format de l\'enseigne', pct(supply.partCapaciteEnseigne));
line('Data ES « non ouverts au public » retenus', `${fmt(nonPub.length)} · ${pct(supply.partCapaciteNonPublique)} de la capacité`);
line('Lignes Data ES en trop (même installation)', `${fmt(extraRows)} · ${fmt(extraCap)} places`);
line('SIRENE sans salarié', `${fmt(nonEmp.length)} · ${pct(supply.partCapaciteSansSalarie)} de la capacité`);
line('Salles empilées sur un même point (≥ 3)', `${fmt(stacked.length)} · ${fmt(supply.capaciteEmpilee)} places`);
line('Jointure avec les sources', `SIRENE ${pct(supply.jointure.sirene, 0)} · Data ES ${pct(supply.jointure.dataes, 0)}`);
for (const c of chains) line(`  ${c.nom}`, `${c.n} salles · surface médiane ${c.surfMesuree == null ? '–' : fmt(c.surfMesuree)} m² mesurée (${c.mesurees}) / ${fmt(c.surfRetenue ?? c.surfDefaut)} m² retenue`);
line('Hall b dans l\'offre', supply.hallb ? `${supply.hallb.surface} m² · ${supply.hallb.capacite} places (${supply.hallb.source})` : 'absente');
console.log('\nModèle');
line('Aref (couverture moyenne nationale)', dec(M.Aref, 4));
line('Déficit relatif national', fmt(totU));
line('Demande sans aucune salle à ≤ 15 min', pct(model.partDemandeSansSalle));
console.log('  Densité (hab/km²)  demande  couverture  déficit  demande « non desservie »');
for (const d of densite) console.log(`  ${d.classe.padEnd(18)} ${pct(d.partDemande).padStart(7)}  ${dec(d.couverture).padStart(10)}  ${pct(d.partDeficit).padStart(7)}  ${pct(d.partNonDesservie, 0).padStart(6)}`);
line('Déficit dans les carreaux < 1 000 hab/km²', pct(model.partDeficitMoinsDe1000));
line('Top 20 sites en Île-de-France', `${model.top20IDF}/20`);
console.log('  Top 5 sites : ' + model.top20.slice(0, 5).map(s => `${s.lat.toFixed(3)},${s.lon.toFixed(3)} (${fmt(s.uz)})`).join(' · '));
line('Hall b : zone 15 min', `${fmt(hb.pop)} hab. · ${fmt(hb.dem)} adhérents potentiels`);
line('Hall b : déficit relatif brut / pondéré', `${fmt(hb.brut)} / ${fmt(hb.pondere)} · écart ≈ ${hb.ecartSalles} salle(s)`);
console.log('\nBacktest (percentile médian · part dans le top 20 % ; hasard = 50 · 20 %)');
for (const [k, lbl] of [['toutes', 'Toutes les ouvertures'], ['avecSalaries', 'Ouvertures avec salariés'], ['chaines', 'Ouvertures de chaînes']]) {
  const b = bt[k]; line(`${lbl} (n = ${fmt(b.n)})`, `pondéré ${dec(b.pondere.median, 1)} · ${pct(b.pondere.top20, 0)}  |  brut ${dec(b.brut.median, 1)} · ${pct(b.brut.top20, 0)}`);
}
if (stabilite) {
  console.log(`\nStabilité de la carte par rapport à la référence du ${ref.date}`);
  line('Corrélation de rang du déficit de zone', dec(stabilite.spearman, 3));
  line('Top 1 % des carreaux conservé', pct(stabilite.top1Conserve, 0));
  line('Top 20 sites retrouvés (à 10 km près)', `${stabilite.top20Retrouves}/20`);
}
if (ref) {
  console.log(`\nÉcarts à la référence du ${ref.date}`);
  const TRACK = [
    ['Salles', r => r.supply.salles, fmt], ['Capacité nationale', r => r.supply.capacite, fmt],
    ['Part de capacité à surface par défaut', r => r.supply.partCapaciteDefaut, pct],
    ['Capacité Data ES non publique', r => r.supply.partCapaciteNonPublique, pct],
    ['Lignes Data ES en trop', r => r.supply.lignesDataesEnTrop, fmt],
    ['Capacité SIRENE sans salarié', r => r.supply.partCapaciteSansSalarie, pct],
    ['Aref', r => r.model.Aref, v => dec(v, 4)], ['Déficit relatif national', r => r.model.deficitNational, fmt],
    ['Déficit < 1 000 hab/km²', r => r.model.partDeficitMoinsDe1000, pct],
    ['Top 20 sites en Île-de-France', r => r.model.top20IDF, fmt],
    ['Hall b : déficit relatif brut', r => r.model.hallb.brut, fmt],
    ['Hall b : déficit relatif pondéré', r => r.model.hallb.pondere, fmt],
    ['Hall b : écart en salles', r => r.model.hallb.ecartSalles, fmt],
    ['Backtest toutes · pondéré', r => r.backtest.toutes.pondere.median, v => dec(v, 1)],
    ['Backtest avec salariés · pondéré', r => r.backtest.avecSalaries.pondere.median, v => dec(v, 1)],
    ['Backtest chaînes · pondéré', r => r.backtest.chaines.pondere.median, v => dec(v, 1)],
    ['Backtest toutes · brut', r => r.backtest.toutes.brut.median, v => dec(v, 1)],
  ];
  console.log(`  ${'Indicateur'.padEnd(40)} ${'Actuel'.padStart(12)} ${'Référence'.padStart(12)}`);
  for (const [l, get, f] of TRACK) {
    const a = get(report), b = get(ref), changed = Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(b));
    console.log(`  ${l.padEnd(40)} ${f(a).padStart(12)} ${f(b).padStart(12)}${changed ? '  ←' : ''}`);
  }
}
if (sensibilite) {
  console.log('\nSensibilité aux paramètres (par rapport au modèle actuel)');
  if (sensibilite.ignoree) console.log(`  Ignorée : ${sensibilite.ignoree}`);
  else for (const s of sensibilite) line(s.variante, `rang ${dec(s.spearman, 2)} · top 1 % ${pct(s.top1Conserve, 0)} · top 20 ${s.top20Retrouves}/20`);
}
if (FIGER) {
  const keys = new Int32Array(n), vals = new Float32Array(n);
  for (let i = 0; i < n; i++) { keys[i] = cellKey(i); vals[i] = UZ[i]; }
  const buf = Buffer.concat([Buffer.from(keys.buffer), Buffer.from(vals.buffer)]);
  writeFileSync(REF_UZ, gzipSync(buf, { level: 9 }));
  writeFileSync(REF_JSON, JSON.stringify(report, null, 1));
  console.log('\nRéférence figée : build/audit/reference.json + reference-uz.bin.gz');
} else if (!ref) {
  console.log('\nAucune référence : lancez « node audit.mjs --figer » avant de modifier le code.');
}
console.log(`\nRapport complet : build/audit/dernier.json · ${Math.round((Date.now() - t0) / 1000)} s`);
