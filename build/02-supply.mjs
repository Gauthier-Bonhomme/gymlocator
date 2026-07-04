// 02 — Offre fusionnée : SIRENE (NAF 93.13Z, exhaustif + dates) ∪ Data ES (surfaces réelles)
// Produit data/gyms-fused.json (complet) et gyms.json (léger, pour le front).
// Règles :
//   - SIRENE = colonne vertébrale (tout établissement actif de culture physique, géolocalisé)
//   - Data ES enrichit avec la surface réelle quand l'équipement correspond (SIREN ou proximité+nom)
//   - Data ES non appariés = salles municipales/associatives → offre à part entière (cat 'asso')
//   - studios yoga/pilates purs exclus ; capacité = surface × 1,4 adh/m² (fourchette métier 1,2–1,7)
import { readFileSync, writeFileSync } from 'node:fs';

const MET = { s: 41.2, n: 51.3, w: -5.5, e: 9.9 };
const MEMBERS_PER_M2 = 1.4;
const CAT_AREA = { lowcost: 1400, premium: 800, classic: 600, niche: 250, asso: 200 };
const SURF_MIN = 40, SURF_MAX = 6000;

// Multiplicateur de surface selon la tranche d'effectifs SIRENE — appliqué UNIQUEMENT
// aux indépendants (classic/niche) sans surface Data ES : un « non employeur » est
// un studio/coach, pas une salle de 600 m². Les chaînes gardent le format de l'enseigne.
const EFFECTIF_MUL = {
  'Etablissement non employeur': 0.4, '0 salarié': 0.4,
  '1 ou 2 salariés': 0.7, '3 à 5 salariés': 1.0, '6 à 9 salariés': 1.4,
  '10 à 19 salariés': 1.8, '20 à 49 salariés': 2.2,
};
const effectifMul = t => EFFECTIF_MUL[t] ?? (/salariés/.test(t || '') ? 2.2 : 1.0);

const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function classify(name) {
  const h = norm(name);
  if (/cross.?fit|pilates|danse|dance|martial|boxe|boxing|escalade|climb|aikido|judo|karate|taekwondo|capoeira|coaching|coach|ems\b|electrostimulation/.test(h)) return 'niche';
  if (/basic.?fit|fitness ?park|neoness|on ?air|keep.?cool|magic ?form|fitness ?factory|liberty ?gym|movida|vita ?libre|l ?appart|episod|neofit|wellness ?sport ?club|gigafit|salle ?de ?sport ?elancia|elancia|interval/.test(h)) return 'lowcost';
  if (/orange ?bleue|\bcmg\b|vita ?liberte|usine|club ?med ?gym|amazonia|aquagym|healthcity|holmes ?place/.test(h)) return 'premium';
  return 'classic';
}
const isYogaOnly = name => /\byoga\b|bikram|ashtanga|vinyasa|\bhatha\b|pilates ?studio|studio ?pilates/.test(norm(name));
const STOP = new Set(['salle', 'de', 'du', 'des', 'la', 'le', 'les', 'sport', 'sports', 'fitness', 'gym', 'club', 'musculation', 'forme', 'remise', 'en', 'centre', 'espace', 'association', 'commune', 'municipale', 'et', 'sarl', 'sas', 'eurl']);
const tokens = s => new Set(norm(s).split(/[^a-z0-9]+/).filter(t => t.length > 2 && !STOP.has(t)));
const shareToken = (a, b) => { for (const t of a) if (b.has(t)) return true; return false; };
const KM_LAT = 110.6, kmLon = lat => 111.32 * Math.cos(lat * Math.PI / 180);
const distKm = (a, b) => Math.hypot((a.lat - b.lat) * KM_LAT, (a.lon - b.lon) * kmLon(a.lat));

// ── SIRENE : colonne vertébrale ────────────────────────────────────────────────
const sirene = JSON.parse(readFileSync(new URL('../data/sirene.json', import.meta.url), 'utf8'));
const gyms = []; let yogaExcl = 0, noGeo = 0;
const bySiren = new Map(), hash = new Map();
const hkey = (lat, lon) => Math.floor(lat * 50) + ':' + Math.floor(lon * 50); // ~2 km
for (const r of sirene) {
  const g = r.geolocetablissement;
  if (!g || g.lat == null) { noGeo++; continue; }
  if (g.lat < MET.s || g.lat > MET.n || g.lon < MET.w || g.lon > MET.e) continue;
  const name = r.enseigne1etablissement || r.denominationusuelleetablissement || r.denominationunitelegale || 'Salle de sport';
  if (isYogaOnly(name)) { yogaExcl++; continue; }
  const cat = classify(name);
  // surface par défaut, redimensionnée par les effectifs pour les indépendants
  const mul = (cat === 'classic' || cat === 'niche') ? effectifMul(r.trancheeffectifsetablissement) : 1.0;
  const rec = {
    lat: +g.lat.toFixed(5), lon: +g.lon.toFixed(5), name, cat,
    surf: Math.max(80, Math.min(4000, Math.round(CAT_AREA[cat] * mul))), surfSrc: 'defaut', src: 'sirene',
    date: r.datecreationetablissement || null,
    siren: (r.siret || '').slice(0, 9),
    cp: r.codepostaletablissement, commune: r.libellecommuneetablissement,
    tok: tokens(name),
  };
  // dédoublonnage interne : même SIREN à <150 m = même club (multi-SIRET)
  const twins = bySiren.get(rec.siren);
  if (twins && twins.some(t => distKm(t, rec) < 0.15)) continue;
  gyms.push(rec);
  (twins || bySiren.set(rec.siren, []).get(rec.siren)).push(rec);
  const k = hkey(rec.lat, rec.lon);
  (hash.get(k) || hash.set(k, []).get(k)).push(rec);
}
console.log(`SIRENE métropole retenus : ${gyms.length} (yoga exclus : ${yogaExcl}, sans géoloc : ${noGeo})`);

// ── Data ES : enrichissement surfaces + salles municipales/asso ────────────────
const dataes = JSON.parse(readFileSync(new URL('../data/dataes.json', import.meta.url), 'utf8'));
let matched = 0, addedAsso = 0, surfApplied = 0;
const near = rec => {
  const out = [], la = Math.floor(rec.lat * 50), lo = Math.floor(rec.lon * 50);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const arr = hash.get((la + dy) + ':' + (lo + dx)); if (arr) out.push(...arr);
  }
  return out;
};
for (const e of dataes) {
  const c = e.equip_coordonnees;
  if (!c || c.lat == null || c.lat < MET.s || c.lat > MET.n || c.lon < MET.w || c.lon > MET.e) continue;
  const name = e.equip_nom && e.equip_nom.length > 3 && !/salle de musculation|musculation|cardio/i.test(e.equip_nom) ? e.equip_nom : (e.inst_nom || 'Salle de musculation');
  const rec = { lat: +c.lat.toFixed(5), lon: +c.lon.toFixed(5), name };
  const surf = e.equip_surf > SURF_MIN ? Math.min(SURF_MAX, e.equip_surf) : 0;
  const siren9 = (e.inst_siret || '').slice(0, 9);
  const tok = tokens(e.inst_nom + ' ' + (e.equip_nom || ''));
  // appariement : SIREN identique, sinon <60 m, sinon <250 m + nom en commun
  let best = null, bd = 1e9;
  for (const s of near(rec)) {
    const d = distKm(rec, s);
    const ok = (siren9 && s.siren === siren9 && d < 2) || d < 0.06 || (d < 0.25 && shareToken(tok, s.tok));
    if (ok && d < bd) { bd = d; best = s; }
  }
  if (best) {
    matched++;
    if (surf > 0) { best.surf = best.surfSrc === 'dataes' ? Math.min(SURF_MAX, best.surf + surf) : surf; best.surfSrc = 'dataes'; best.src = 'sirene+dataes'; surfApplied++; }
    continue;
  }
  // non apparié → salle municipale / associative / privée non-93.13Z
  const publicOwner = /commune|etat|departement|region|public|association/i.test((e.equip_prop_type || '') + ' ' + (e.equip_gest_type || ''));
  gyms.push({
    lat: rec.lat, lon: rec.lon, name, cat: publicOwner ? 'asso' : classify(name),
    surf: surf || CAT_AREA.asso, surfSrc: surf ? 'dataes' : 'defaut', src: 'dataes',
    date: e.equip_service_date ? String(e.equip_service_date).slice(0, 4) + '-01-01' : null,
    siren: siren9 || null, cp: e.inst_cp, commune: e.new_name, tok,
  });
  addedAsso++;
}
for (const g of gyms) { g.cap = Math.round(Math.min(SURF_MAX, g.surf) * MEMBERS_PER_M2); delete g.tok; }

console.log(`Data ES appariés à SIRENE : ${matched} (surfaces réelles appliquées : ${surfApplied})`);
console.log(`Data ES ajoutés (municipal/asso/non-93.13Z) : ${addedAsso}`);
console.log(`OFFRE TOTALE : ${gyms.length} salles, capacité ${Math.round(gyms.reduce((s, g) => s + g.cap, 0)).toLocaleString('fr')} adhérents`);
for (const cat of ['lowcost', 'premium', 'classic', 'niche', 'asso'])
  console.log(`  ${cat}: ${gyms.filter(g => g.cat === cat).length}`);
console.log(`  Basic Fit détectés : ${gyms.filter(g => /basic/i.test(g.name)).length}, Fitness Park : ${gyms.filter(g => /fitness ?park/i.test(g.name)).length}`);

writeFileSync(new URL('../data/gyms-fused.json', import.meta.url), JSON.stringify(gyms));
// fichier léger pour le front (racine du repo)
const lean = gyms.map(g => [g.lat, g.lon, g.name, g.cat, Math.round(g.surf), g.cap, g.src, g.date ? g.date.slice(0, 4) : null]);
writeFileSync(new URL('../gyms.json', import.meta.url), JSON.stringify({ fields: ['lat', 'lon', 'name', 'cat', 'surf', 'cap', 'src', 'annee'], gyms: lean }));
