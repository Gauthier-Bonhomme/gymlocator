// Calage de la vitesse du modèle sur des temps routiers, par classe de densité lissée.
// Le modèle estime t = accès (3 min) + distance à vol d'oiseau / vitesse(densité lissée moyenne des
// deux carreaux). On le compare aux durées en voiture entre centres de carreaux habités :
// - Valhalla, la RÉFÉRENCE : c'est le moteur de l'isochrone exacte du front et du témoin de Hall b ;
// - OSRM, en second avis : 1,2 à 1,5 fois plus rapide que Valhalla (pas de pénalités urbaines).
//
//   node calage-vitesse.mjs --osrm        160 000 paires, OSRM local → data/vitesse-paires.json
//   node calage-vitesse.mjs --valhalla    6 400 de ces paires, serveur public Valhalla (lots de 40, une
//                                         requête toutes les 3 s, reprise possible) → data/vitesse-valhalla.json
//   node calage-vitesse.mjs --isochrones  isochrones Valhalla de 15 min : Hall b + 50 points (une requête
//                                         toutes les 5 s) → data/vitesse-isochrones.json
//   node calage-vitesse.mjs               rapports avec la vitesse de lib-e2sfca.mjs
//   node calage-vitesse.mjs --caler       + paliers recalés, à reporter dans VITESSE (lib-e2sfca.mjs)
//
// Critère de calage : dans chaque classe, rapport médian Valhalla / modèle = 1 sur les paires que le
// modèle place entre 10 et 20 min (autour de la limite des 15 min, qui décide des zones), chaque paire
// pesant la population de son carreau d'arrivée (le modèle additionne des habitants). Contrôle : la
// population des zones de 15 min du modèle contre celle des isochrones Valhalla (le témoin de Hall b,
// généralisé à 50 points).
//
// OSRM local (graphe France de pipeline/osrm-data, voir pipeline/README.md) :
//   docker run -d --name osrm-fr -p 5000:5000 -v "<chemin>/pipeline/osrm-data:/data:ro" \
//     ghcr.io/project-osrm/osrm-backend:v26.6.5-debian osrm-routed --algorithm mld --mmap --max-table-size 2000 /data/france-latest.osrm
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { toLaea, densityField, speedKmh, vitesseDe, VITESSE, T_ACCESS, T_MAX } from './lib-e2sfca.mjs';

const OSRM = process.env.OSRM_URL || 'http://localhost:5000';
const VALHALLA = process.env.VALHALLA_URL || 'https://valhalla1.openstreetmap.de';
const UA = { 'Content-Type': 'application/json', 'User-Agent': 'GymLocator calibration (+https://github.com/Gauthier-Bonhomme/gymlocator)' };
const DATA = new URL('../data/', import.meta.url);
const PAIRS = new URL('vitesse-paires.json', DATA), VPAIRS = new URL('vitesse-valhalla.json', DATA), ISOS = new URL('vitesse-isochrones.json', DATA);
const HALLB = { lat: 43.80749, lon: 4.22952 };   // même point que audit.mjs
const CLASSES = [[0, 50, '< 50'], [50, 200, '50–200'], [200, 1000, '200–1 000'], [1000, 4000, '1 000–4 000'], [4000, Infinity, '> 4 000']];
const classOf = d => CLASSES.findIndex(([lo, hi]) => d >= lo && d < hi);
const ORIGINES = 160, DESTS = 200, RAYON = 16;   // par classe d'origine · par origine · km
const SNAP_MAX = 1000;                           // m : centre de carreau loin de toute route (lac, forêt)
const BANDE = [10, 20];                          // min, temps du modèle : autour de la limite des 15 min

const cells = JSON.parse(readFileSync(new URL('cells.json', DATA), 'utf8'));
const field = densityField(cells);
const n = cells.length;
const key = (cx, cy) => cx * 100000 + cy;
const idx = new Map(cells.map((c, i) => [key(c.E / 1000, c.N / 1000), i]));
const dist = (i, j) => Math.hypot(cells[i].E - cells[j].E, cells[i].N - cells[j].N) / 1000;   // km, centres
const rnd = (s => () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; })(20261013);
const pause = ms => new Promise(r => setTimeout(r, ms));
const fmt = v => Math.round(v).toLocaleString('fr-FR');
const dec = (v, d = 2) => Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '–';

// ── Mesures ───────────────────────────────────────────────────────────────────
async function table(src, dsts) {
  const coords = [src, ...dsts].map(p => `${p.lon},${p.lat}`).join(';');
  for (let k = 0; ; k++) {
    try {
      const j = await (await fetch(`${OSRM}/table/v1/driving/${coords}?sources=0&annotations=duration,distance`)).json();
      if (j.code !== 'Ok') throw new Error(j.code + ' ' + (j.message || ''));
      return j;
    } catch (e) { if (k >= 2) throw e; await pause(1000); }
  }
}

if (process.argv.includes('--osrm')) {
  // Origines : ORIGINES par classe de densité lissée, tirées au prorata de la population ;
  // destinations : DESTS carreaux habités tirés uniformément à ≤ RAYON km.
  const strata = CLASSES.map(() => []);
  for (let i = 0; i < n; i++) strata[classOf(field.dens[i])].push(i);
  const origins = [];
  for (const s of strata) {
    const tot = s.reduce((a, i) => a + cells[i].ind, 0);
    for (let k = 0; k < ORIGINES; k++) {
      let r = rnd() * tot, j = 0; while ((r -= cells[s[j]].ind) > 0) j++;
      origins.push(s[j]);
    }
  }
  const pairs = [];
  let done = 0;
  const work = origins.map(o => async () => {
    const c = cells[o], cx = c.E / 1000, cy = c.N / 1000, cand = [];
    for (let dx = -RAYON; dx <= RAYON; dx++) for (let dy = -RAYON; dy <= RAYON; dy++) {
      const j = idx.get(key(cx + dx, cy + dy));
      if (j !== undefined && j !== o && Math.hypot(dx, dy) <= RAYON) cand.push(j);
    }
    for (let k = cand.length - 1; k > 0; k--) { const m = Math.floor(rnd() * (k + 1)); [cand[k], cand[m]] = [cand[m], cand[k]]; }
    const dst = cand.slice(0, DESTS);
    if (!dst.length) return;
    const j = await table(c, dst.map(i => cells[i]));
    dst.forEach((i, k) => pairs.push({
      o, d: i, s: Math.round(j.durations[0][k + 1] ?? -1), m: Math.round(j.distances[0][k + 1] ?? -1),
      sn: Math.round(Math.max(j.sources[0].distance, j.destinations[k + 1].distance)),
    }));
    if (++done % 100 === 0) console.log(`  ${done}/${origins.length} origines`);
  });
  const queue = [...work];   // 4 requêtes en parallèle (serveur local à 8 fils)
  await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await queue.shift()(); }));
  // Zone de 15 min de Hall b selon OSRM : tous les carreaux habités à ≤ 25 km
  const [hE, hN] = toLaea(HALLB.lat, HALLB.lon), hb = [];
  for (let i = 0; i < n; i++) if (Math.hypot(cells[i].E + 500 - hE, cells[i].N + 500 - hN) <= 25000) hb.push(i);
  const jh = await table(HALLB, hb.map(i => cells[i]));
  const hallb = hb.map((i, k) => ({ d: i, s: Math.round(jh.durations[0][k + 1] ?? -1), sn: Math.round(jh.destinations[k + 1].distance) }));
  writeFileSync(PAIRS, JSON.stringify({ date: new Date().toISOString().slice(0, 10), osrm: OSRM, pairs, hallb }));
  console.log(`${pairs.length} paires → data/vitesse-paires.json`);
}

if (process.argv.includes('--valhalla')) {
  // Tirées parmi les paires OSRM : deux fois 16 origines par classe, paires jusqu'à R km (au-delà,
  // aucune zone de 15 min), puis paires à ≤ 8 km, là où passe la limite des 15 min.
  const M0 = JSON.parse(readFileSync(PAIRS, 'utf8'));
  const V = existsSync(VPAIRS) ? JSON.parse(readFileSync(VPAIRS, 'utf8')) : { date: new Date().toISOString().slice(0, 10), valhalla: VALHALLA, lots: [] };
  const done = new Set(V.lots.map(l => l.o));
  const byOrigin = new Map();
  for (const p of M0.pairs) (byOrigin.get(p.o) || byOrigin.set(p.o, []).get(p.o)).push(p);
  const R = [16, 16, 14, 12, 10];
  const pools = CLASSES.map((_, c) => [...byOrigin.keys()].filter(o => classOf(field.dens[o]) === c));
  const lots = [];
  for (const portee of [c => R[c], () => 8]) for (let c = 0; c < CLASSES.length; c++) {
    const os = pools[c];
    for (let k = 0; k < 16 && os.length; k++) {
      const o = os.splice(Math.floor(rnd() * os.length), 1)[0];
      const cand = byOrigin.get(o).filter(p => dist(p.o, p.d) <= portee(c));
      for (let k2 = cand.length - 1; k2 > 0; k2--) { const m = Math.floor(rnd() * (k2 + 1)); [cand[k2], cand[m]] = [cand[m], cand[k2]]; }
      lots.push({ o, dst: cand.slice(0, 40).map(p => p.d) });
    }
  }
  const save = () => writeFileSync(VPAIRS, JSON.stringify(V));
  for (const [k, l] of lots.entries()) {
    if (done.has(l.o)) {   // reprise : le tirage doit être celui de la mesure enregistrée
      if (V.lots.find(x => x.o === l.o).dst.join() !== l.dst.join()) throw new Error('tirage différent de data/vitesse-valhalla.json');
      continue;
    }
    const body = { sources: [{ lat: cells[l.o].lat, lon: cells[l.o].lon }], targets: l.dst.map(i => ({ lat: cells[i].lat, lon: cells[i].lon })), costing: 'auto', verbose: false };
    let j;
    for (let essai = 0; ; essai++) {
      const r = await fetch(`${VALHALLA}/sources_to_targets`, { method: 'POST', headers: UA, body: JSON.stringify(body) });
      if (r.ok) { j = await r.json(); break; }
      if (essai >= 3) { save(); throw new Error(`Valhalla HTTP ${r.status} — mesure interrompue, relancer pour reprendre`); }
      await pause(30000 * (essai + 1));   // 429/503 : on ralentit nettement
    }
    const s2t = j.sources_to_targets;
    V.lots.push({ o: l.o, dst: l.dst, s: s2t.durations[0].map(x => x == null ? -1 : Math.round(x)), m: s2t.distances[0].map(x => x == null ? -1 : Math.round(x * 1000)) });
    save();
    if ((k + 1) % 10 === 0) console.log(`  ${k + 1}/${lots.length} lots`);
    await pause(3000);
  }
  console.log(`${V.lots.reduce((a, l) => a + l.dst.length, 0)} paires Valhalla → data/vitesse-valhalla.json`);
}

// Population dans un polygone : carreaux dont le centre est dedans, comme isoStats() du front
const pip = (x, y, ring) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) ins = !ins; } return ins; };
if (process.argv.includes('--isochrones')) {
  const M0 = JSON.parse(readFileSync(PAIRS, 'utf8'));
  const I = existsSync(ISOS) ? JSON.parse(readFileSync(ISOS, 'utf8')) : { date: new Date().toISOString().slice(0, 10), valhalla: VALHALLA, points: [] };
  const origins = [...new Set(M0.pairs.map(p => p.o))];
  const pts = [{ nom: 'Hall b', lat: HALLB.lat, lon: HALLB.lon }];
  for (let c = 0; c < CLASSES.length; c++) {
    const os = origins.filter(o => classOf(field.dens[o]) === c);
    for (let k = 0; k < 10 && os.length; k++) { const o = os.splice(Math.floor(rnd() * os.length), 1)[0]; pts.push({ nom: `carreau ${o}`, lat: cells[o].lat, lon: cells[o].lon }); }
  }
  for (const p of pts) {
    if (I.points.some(x => x.nom === p.nom)) continue;
    // mêmes paramètres que l'analyse de zone du front
    const q = { locations: [{ lat: p.lat, lon: p.lon }], costing: 'auto', contours: [{ time: T_MAX }], polygons: true, denoise: 0.5, generalize: 60 };
    const r = await fetch(`${VALHALLA}/isochrone`, { method: 'POST', headers: UA, body: JSON.stringify(q) });
    if (!r.ok) { console.log(`Valhalla HTTP ${r.status} — arrêt, relancer pour reprendre`); break; }
    const g = (await r.json()).features[0].geometry;
    const rings = (g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map(x => x[0])).map(ring => ring.map(([lo, la]) => toLaea(la, lo)));
    let E0 = Infinity, E1 = -Infinity, N0 = Infinity, N1 = -Infinity;
    for (const ring of rings) for (const [E, N] of ring) { E0 = Math.min(E0, E); E1 = Math.max(E1, E); N0 = Math.min(N0, N); N1 = Math.max(N1, N); }
    let pop = 0;
    for (let x = Math.floor(E0 / 1000); x <= Math.floor(E1 / 1000); x++) for (let y = Math.floor(N0 / 1000); y <= Math.floor(N1 / 1000); y++) {
      const i = idx.get(key(x, y)); if (i === undefined) continue;
      if (rings.some(ring => pip(x * 1000 + 500, y * 1000 + 500, ring))) pop += cells[i].ind;
    }
    I.points.push({ ...p, pop: Math.round(pop) });
    writeFileSync(ISOS, JSON.stringify(I));
    console.log(`  ${I.points.length}/${pts.length} ${p.nom} : ${fmt(pop)} hab.`);
    await pause(5000);
  }
}

// ── Analyse ───────────────────────────────────────────────────────────────────
if (!existsSync(PAIRS) || !existsSync(VPAIRS)) { console.log('Mesures absentes : lancer --osrm (OSRM local) puis --valhalla.'); process.exit(1); }
const M = JSON.parse(readFileSync(PAIRS, 'utf8')), V = JSON.parse(readFileSync(VPAIRS, 'utf8'));
const I = existsSync(ISOS) ? JSON.parse(readFileSync(ISOS, 'utf8')) : null;
const pair = (o, d) => { const rho = (field.dens[o] + field.dens[d]) / 2; return { km: dist(o, d), rho, c: classOf(rho), w: cells[d].ind }; };
const osrmOf = new Map(M.pairs.map(p => [p.o * 1e6 + p.d, p]));
const PO = M.pairs.filter(p => p.s >= 0 && p.sn <= SNAP_MAX).map(p => ({ ...pair(p.o, p.d), t: p.s / 60 }));
const PV = V.lots.flatMap(l => l.dst.map((d, k) => {
  const o = osrmOf.get(l.o * 1e6 + d);   // filtre commun : centre près d'une route selon OSRM
  return o && o.s >= 0 && o.sn <= SNAP_MAX && l.s[k] >= 0 ? { ...pair(l.o, d), t: l.s[k] / 60, osrm: o.s / 60 } : null;
}).filter(Boolean));

const tModel = (p, v) => T_ACCESS + p.km / v(p.rho) * 60;
const dansBande = (p, v) => { const t = tModel(p, v); return t >= BANDE[0] && t <= BANDE[1]; };
function wmed(a) {   // médiane pondérée de [valeur, poids]
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x[0] - y[0]), tot = s.reduce((t, x) => t + x[1], 0);
  let acc = 0; for (const [x, w] of s) { acc += w; if (acc >= tot / 2) return x; }
}
const medBande = (set, c, v) => { const a = set.filter(p => p.c === c && dansBande(p, v)); return { n: a.length, r: wmed(a.map(p => [p.t / tModel(p, v), p.w])) }; };
const median = a => { const s = [...a].sort((x, y) => x - y), k = s.length; return k % 2 ? s[k >> 1] : (s[k / 2 - 1] + s[k / 2]) / 2; };

// Population de la zone de 15 min du modèle autour d'un point (même calcul qu'audit.mjs)
function zoneModele(lat, lon, v) {
  const [E, N] = toLaea(lat, lon), cx = Math.floor(E / 1000), cy = Math.floor(N / 1000), gD = field.at(cx, cy);
  let pop = 0;
  for (let dx = -13; dx <= 13; dx++) for (let dy = -13; dy <= 13; dy++) {
    const i = idx.get(key(cx + dx, cy + dy)); if (i === undefined) continue;
    const c = cells[i];
    if (T_ACCESS + Math.hypot(c.E + 500 - E, c.N + 500 - N) / 1000 / v((field.dens[i] + gD) / 2) * 60 <= T_MAX) pop += c.ind;
  }
  return pop;
}

function rapport(v, titre) {
  console.log(`\n${titre}`);
  console.log(`  Densité lissée    Valhalla/modèle (paires ${BANDE[0]}–${BANDE[1]} min)   ≤ 8 km   toutes   OSRM/modèle   Valhalla/OSRM`);
  for (let c = 0; c < CLASSES.length; c++) {
    const b = medBande(PV, c, v), o = medBande(PO, c, v);
    const r = f => wmed(PV.filter(p => p.c === c && f(p)).map(p => [p.t / tModel(p, v), p.w]));
    console.log(`  ${CLASSES[c][2].padEnd(16)} ${dec(b.r).padStart(10)} (${String(b.n).padStart(4)} paires)        ${dec(r(p => p.km <= 8)).padStart(5)}   ${dec(r(() => true)).padStart(6)}   ${dec(o.r).padStart(11)}   ${dec(median(PV.filter(p => p.c === c).map(p => p.t / p.osrm))).padStart(13)}`);
  }
  const bands = [[0, 2], [2, 4], [4, 6], [6, 8], [8, 12], [12, 17]];
  console.log('  Valhalla/modèle par distance : ' + bands.map(([lo, hi]) => `${lo}–${hi} km ${dec(wmed(PV.filter(p => p.km >= lo && p.km < hi).map(p => [p.t / tModel(p, v), p.w])))}`).join(' · '));
  if (I) {
    const pts = I.points.map(p => { const [E, N] = toLaea(p.lat, p.lon); return { ...p, c: classOf(field.at(Math.floor(E / 1000), Math.floor(N / 1000))), q: zoneModele(p.lat, p.lon, v) / p.pop }; });
    const autres = pts.filter(p => p.nom !== 'Hall b' && p.pop > 0), hb = pts.find(p => p.nom === 'Hall b');
    console.log(`  Zones de ${T_MAX} min, population modèle / isochrone Valhalla (médiane par classe, ${autres.length} points) : `
      + CLASSES.map((_, c) => dec(median(autres.filter(p => p.c === c).map(p => p.q)))).join(' · ') + ` ; toutes ${dec(median(autres.map(p => p.q)))}`);
    if (hb) console.log(`  Hall b : modèle ${fmt(hb.q * hb.pop)} hab. · isochrone Valhalla ${fmt(hb.pop)} (${hb.q >= 1 ? '+' : ''}${dec((hb.q - 1) * 100, 0)} %) · OSRM ≤ ${T_MAX} min ${fmt(M.hallb.filter(h => h.s >= 0 && h.s <= T_MAX * 60).reduce((s, h) => s + cells[h.d].ind, 0))}`);
  }
}
console.log(`Mesures : ${fmt(PO.length)} paires OSRM (${M.date}) · ${fmt(PV.length)} paires Valhalla (${V.date})${I ? ` · ${I.points.length} isochrones (${I.date})` : ''}`);
rapport(speedKmh, `Vitesse de lib-e2sfca.mjs : ${JSON.stringify(VITESSE.paliers ?? VITESSE)}`);

if (process.argv.includes('--caler')) {
  // Un palier par classe, à la densité médiane de ses paires ; vitesse ajustée par dichotomie jusqu'à
  // un rapport médian de 1 dans la bande, classe après classe (l'interpolation couple les voisines).
  const paliers = CLASSES.map((_, c) => [median(PV.filter(p => p.c === c).map(p => p.rho)), 30]);
  for (let tour = 0; tour < 30; tour++) {
    for (let c = 0; c < CLASSES.length; c++) {
      let lo = 5, hi = 120;
      for (let k = 0; k < 40; k++) { paliers[c][1] = (lo + hi) / 2; medBande(PV, c, vitesseDe(paliers)).r > 1 ? hi = paliers[c][1] : lo = paliers[c][1]; }
    }
    if (CLASSES.every((_, c) => Math.abs(medBande(PV, c, vitesseDe(paliers)).r - 1) < 0.005)) break;
  }
  const cales = paliers.map(([d, v]) => [Math.round(d), Math.round(v * 10) / 10]);
  rapport(vitesseDe(cales), `Paliers recalés (densité lissée hab/km², km/h) : ${JSON.stringify(cales)}`);
}
