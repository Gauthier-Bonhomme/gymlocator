// 03 — Calcul E2SFCA national → grid.bin + meta.json (consommés par le front)
// grid.bin (little-endian) : Uint32[n] idx (col + row*cols, origine meta)
//                            puis Uint16[n] ind, Uint16[n] dem, Uint16[n] rel×2000, Uint16[n] u, Uint16[n] uz
// rel = A / Aref (couverture relative au niveau de service national)
// u   = dem × max(0, 1 − rel)  (adhérents non desservis)
// uz  = Σ u × exp(−t²/SIGMA2) sur la zone 15 min (déficit de zone, même noyau que A)
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { toLaea, laeaForward, computeAccess, computeZoneDeficit, weightedQuantiles } from './lib-e2sfca.mjs';

const cells = JSON.parse(readFileSync(new URL('../data/cells.json', import.meta.url), 'utf8'));
const gyms = JSON.parse(readFileSync(new URL('../data/gyms-fused.json', import.meta.url), 'utf8'));

// Contrôle : la projection embarquée front == proj4 (< 2 m d'écart)
let maxErr = 0;
for (let t = 0; t < 200; t++) {
  const lat = 41.5 + Math.random() * 9.5, lon = -4.5 + Math.random() * 13;
  const [E1, N1] = toLaea(lat, lon), [E2, N2] = laeaForward(lat, lon);
  maxErr = Math.max(maxErr, Math.hypot(E1 - E2, N1 - N2));
}
console.log(`Projection embarquée vs proj4 : écart max ${maxErr.toFixed(3)} m ${maxErr < 2 ? 'OK' : '!! ECHEC'}`);
if (maxErr >= 2) process.exit(1);

console.time('E2SFCA');
const { A, skippedGyms } = computeAccess(cells, gyms);
console.timeEnd('E2SFCA');
console.log(`Salles sans demande atteignable (ignorées) : ${skippedGyms}`);

// Référence nationale : couverture moyenne pondérée par la demande
let sumDA = 0, sumD = 0;
for (let i = 0; i < cells.length; i++) { sumDA += cells[i].dem * A[i]; sumD += cells[i].dem; }
const Aref = sumDA / sumD;
console.log(`Aref (places/adhérent potentiel, moyenne nationale) : ${Aref.toFixed(3)}`);

// Valeurs finales par carreau
const rel = new Float64Array(cells.length), U = new Float64Array(cells.length);
for (let i = 0; i < cells.length; i++) {
  rel[i] = A[i] / Aref;
  U[i] = cells[i].dem * Math.max(0, 1 - rel[i]);
}

// Déficit de zone (surface d'opportunité) — la vue par défaut du front
console.time('Déficit de zone');
const UZ = computeZoneDeficit(cells, U);
console.timeEnd('Déficit de zone');
const topZ = cells.map((c, i) => ({ lat: c.lat, lon: c.lon, uz: UZ[i] }))
  .sort((a, b) => b.uz - a.uz).slice(0, 5);
console.log('Top déficits de zone (lat, lon, UZ) :');
for (const t of topZ) console.log(`  ${t.lat.toFixed(3)}, ${t.lon.toFixed(3)}  UZ=${Math.round(t.uz)}`);

// Échelles de couleur : percentiles pondérés par la demande, sur log1p
const logU = Array.from(U, u => Math.log1p(u));
const dW = cells.map(c => c.dem);
const [q12, q97] = weightedQuantiles(logU, dW, [0.12, 0.97]);
const [z12, z97] = weightedQuantiles(Array.from(UZ, v => Math.log1p(v)), dW, [0.12, 0.97]);
// Statistiques de contrôle
const relArr = Array.from(rel);
const [r25, r50, r75] = weightedQuantiles(relArr, dW, [0.25, 0.5, 0.75]);
console.log(`Couverture rel (pondérée demande) : Q25 ${r25.toFixed(2)} · médiane ${r50.toFixed(2)} · Q75 ${r75.toFixed(2)}`);
const totU = U.reduce((s, u) => s + u, 0);
console.log(`Déficit national total : ${Math.round(totU).toLocaleString('fr')} adhérents non desservis`);
const top = cells.map((c, i) => ({ lat: c.lat, lon: c.lon, u: U[i], rel: rel[i] }))
  .sort((a, b) => b.u - a.u).slice(0, 8);
console.log('Top déficits (lat, lon, U, rel) :');
for (const t of top) console.log(`  ${t.lat.toFixed(3)}, ${t.lon.toFixed(3)}  U=${Math.round(t.u)}  rel=${t.rel.toFixed(2)}`);

// ── Export binaire ──────────────────────────────────────────────────────────────
let minCx = 1e9, minCy = 1e9, maxCx = -1e9, maxCy = -1e9;
for (const c of cells) {
  const cx = c.E / 1000, cy = c.N / 1000;
  if (cx < minCx) minCx = cx; if (cx > maxCx) maxCx = cx;
  if (cy < minCy) minCy = cy; if (cy > maxCy) maxCy = cy;
}
const cols = maxCx - minCx + 1, rows = maxCy - minCy + 1, n = cells.length;
const buf = new ArrayBuffer(n * 4 + n * 2 * 5);
const idxArr = new Uint32Array(buf, 0, n);
const indArr = new Uint16Array(buf, n * 4, n);
const demArr = new Uint16Array(buf, n * 4 + n * 2, n);
const relArr16 = new Uint16Array(buf, n * 4 + n * 4, n);
const uArr = new Uint16Array(buf, n * 4 + n * 6, n);
const uzArr = new Uint16Array(buf, n * 4 + n * 8, n);
// tri par idx pour la reproductibilité
const order = cells.map((c, i) => i)
  .sort((a, b) => ((cells[a].E / 1000 - minCx) + (cells[a].N / 1000 - minCy) * cols)
    - ((cells[b].E / 1000 - minCx) + (cells[b].N / 1000 - minCy) * cols));
order.forEach((ci, k) => {
  const c = cells[ci];
  idxArr[k] = (c.E / 1000 - minCx) + (c.N / 1000 - minCy) * cols;
  indArr[k] = Math.min(65535, Math.round(c.ind));
  demArr[k] = Math.min(65535, Math.round(c.dem));
  relArr16[k] = Math.min(65535, Math.round(rel[ci] * 2000));
  uArr[k] = Math.min(65535, Math.round(U[ci]));
  uzArr[k] = Math.min(65535, Math.round(UZ[ci]));
});
writeFileSync(new URL('../grid.bin', import.meta.url), Buffer.from(buf));

const popTotal = Math.round(cells.reduce((s, c) => s + c.ind, 0));
const meta = {
  generated: new Date().toISOString().slice(0, 10),
  n, cols, rows, E0: minCx * 1000, N0: minCy * 1000, cell: 1000,
  Aref: +Aref.toFixed(4),
  colorLogU: { min: +q12.toFixed(4), max: +q97.toFixed(4) },
  colorLogUZ: { min: +z12.toFixed(4), max: +z97.toFixed(4) },
  national: {
    pop: popTotal,
    demande: Math.round(sumD),
    capacite: Math.round(gyms.reduce((s, g) => s + g.cap, 0)),
    deficit: Math.round(totU),
    salles: gyms.length,
  },
  // Source unique des paramètres du modèle : le front lit CE bloc (aucune
  // constante du noyau ne doit être dupliquée en dur dans gymlocator.html).
  modele: {
    millesimePop: 2021,
    penetration: 0.10, membresParM2: 1.4,
    tMaxMin: 15, sigmaMin: 6, accesMin: 3,
    vitesse: { vMax: 62, vAmp: 41, logMin: 1.5, logSpan: 2.2 },
    newGymM2: 1200,
  },
};

// ── Garde-fous : toute dérive silencieuse du pipeline doit faire échouer le build ──
const checks = [
  ['population métropole plausible', popTotal > 58e6 && popTotal < 70e6, popTotal],
  ['ancrage pénétration 10 %', Math.abs(sumD / popTotal - 0.10) < 0.002, (sumD / popTotal).toFixed(4)],
  ['Aref plausible', Aref > 0.4 && Aref < 4, Aref.toFixed(3)],
  ['nombre de carreaux plausible', n > 300000 && n < 460000, n],
];
for (const [lbl, ok, val] of checks) {
  console.log(`${ok ? 'OK ' : '!! ÉCHEC'} ${lbl} (${val})`);
  if (!ok) process.exit(1);
}

writeFileSync(new URL('../meta.json', import.meta.url), JSON.stringify(meta, null, 1));
const gz = gzipSync(Buffer.from(buf), { level: 9 });
writeFileSync(new URL('../grid.bin.gz', import.meta.url), gz);
console.log(`grid.bin : ${(buf.byteLength / 1e6).toFixed(1)} Mo (gz : ${(gz.byteLength / 1e6).toFixed(1)} Mo) · ${n} carreaux · grille ${cols}×${rows}`);
