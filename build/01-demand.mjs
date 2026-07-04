// 01 — Demande par carreau 1 km (INSEE Filosofi 2021, métropole)
// Produit data/cells.json : [{E,N,lat,lon,ind,dem,nv}] où
//   dem = adhérents potentiels = Σ pop_âge × pénétration(âge) × facteur(revenu)
// Ancrages :
//   - niveau national : Σ dem = PEN_NATIONALE × Σ ind (10 % de la population)
//   - profil d'âge : gradient de pratique en salle (fort 18-39, faible 65+),
//     seule la FORME est une hypothèse, le NIVEAU est ancré sur le national
//   - revenu : facteur doux ±15 %, neutre à la médiane nationale (recentré pour
//     ne pas changer le total national)
import { readFileSync, writeFileSync } from 'node:fs';
import proj4 from 'proj4';

proj4.defs('EPSG:3035', '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs');

const PEN_NATIONALE = 0.10;          // ~10 % des Français adhérents d'une salle (Union Sport & Cycle)
// Propension relative par tranche d'âge (forme du gradient ; niveau recalé ensuite)
const AGE_W = {
  ind_0_3: 0, ind_4_5: 0, ind_6_10: 0, ind_11_17: 0.5,
  ind_18_24: 2.0, ind_25_39: 1.9, ind_40_54: 1.2,
  ind_55_64: 0.7, ind_65_79: 0.35, ind_80p: 0.1, ind_inc: 1.0, // âge inconnu → moyenne
};
const INCOME_AMP = 0.30;             // ±15 % à ±50 % de la médiane (pente 0.3, bornes 0.85–1.15)

const csv = readFileSync(new URL('../data/filosofi2021/carreaux_1km_met.csv', import.meta.url), 'utf8');
const lines = csv.split('\n');
const header = lines[0].trim().split(',');

// Depuis le millésime 2021, lcog_geo peut lister plusieurs communes entre
// guillemets ("2A114,2A041") : un split(',') naïf décale alors les colonnes.
function splitCsv(line) {
  const out = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}
const col = Object.fromEntries(header.map((h, i) => [h, i]));
const ageCols = Object.keys(AGE_W).map(k => [col[k], AGE_W[k]]);

// Passe 1 : parse + agrégats nationaux
const cells = [];
let totInd = 0, totIndAge = 0; // totIndAge = Σ pop_âge × w_âge (pour le recalage k)
for (let i = 1; i < lines.length; i++) {
  const L = lines[i]; if (!L || L.length < 30) continue;
  const f = L.includes('"') ? splitCsv(L) : L.split(',');
  const id = f[col.idcar_1km];
  const m = /N(\d+)E(\d+)/.exec(id); if (!m) continue;
  const N = +m[1], E = +m[2];                     // coin SW du carreau (EPSG:3035)
  const ind = +f[col.ind] || 0; if (ind <= 0) continue;
  const snv = +f[col.ind_snv] || 0;
  const nv = snv > 0 ? snv / ind : 0;             // niveau de vie moyen €/personne
  let wAge = 0;
  for (const [ci, w] of ageCols) wAge += (+f[ci] || 0) * w;
  totInd += ind; totIndAge += wAge;
  cells.push({ E, N, ind, wAge, nv });
}

// Recalage k : Σ ind × pen(âge) = PEN_NATIONALE × Σ ind
const k = PEN_NATIONALE * totInd / totIndAge;

// Médiane nationale du niveau de vie (pondérée population)
const byNv = cells.filter(c => c.nv > 0).sort((a, b) => a.nv - b.nv);
let acc = 0; const half = byNv.reduce((s, c) => s + c.ind, 0) / 2;
let nvMed = 22000;
for (const c of byNv) { acc += c.ind; if (acc >= half) { nvMed = c.nv; break; } }

// Passe 2 : demande par carreau (facteur revenu recentré ensuite)
let totDemRaw = 0;
for (const c of cells) {
  const fInc = c.nv > 0 ? Math.max(0.85, Math.min(1.15, 1 + INCOME_AMP * (c.nv / nvMed - 1))) : 1;
  c.demRaw = c.wAge * k * fInc;
  totDemRaw += c.demRaw;
}
const renorm = PEN_NATIONALE * totInd / totDemRaw;   // neutralité nationale du facteur revenu

const out = cells.map(c => {
  const [lon, lat] = proj4('EPSG:3035', 'WGS84', [c.E + 500, c.N + 500]); // centre du carreau
  return {
    E: c.E, N: c.N,
    lat: +lat.toFixed(5), lon: +lon.toFixed(5),
    ind: Math.round(c.ind * 10) / 10,
    dem: Math.round(c.demRaw * renorm * 10) / 10,
    nv: Math.round(c.nv),
  };
});

writeFileSync(new URL('../data/cells.json', import.meta.url), JSON.stringify(out));
console.log(`Carreaux peuplés (métropole) : ${out.length}`);
console.log(`Population totale : ${Math.round(totInd).toLocaleString('fr')}`);
console.log(`Demande totale (adhérents potentiels) : ${Math.round(totDemRaw * renorm).toLocaleString('fr')}`);
console.log(`Niveau de vie médian (pondéré pop) : ${Math.round(nvMed).toLocaleString('fr')} €`);
console.log(`k (pénétration de base) : ${k.toFixed(4)} — ex. 18-24 ans : ${(k * 2).toFixed(3)}, 65-79 ans : ${(k * 0.35).toFixed(3)}`);
const paris = out.filter(c => Math.abs(c.lat - 48.8566) < 0.09 && Math.abs(c.lon - 2.3522) < 0.13);
console.log(`Contrôle Paris (±10 km) : ${paris.length} carreaux, pop ${Math.round(paris.reduce((s, c) => s + c.ind, 0)).toLocaleString('fr')}`);
