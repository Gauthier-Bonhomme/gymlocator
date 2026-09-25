// 02 — Offre fusionnée : SIRENE (NAF 93.13Z, exhaustif + dates) ∪ Data ES (surfaces réelles)
// Produit data/gyms-fused.json (complet), data/offre-journal.json (chaque exclusion et sa raison)
// et gyms.json (léger, pour le front).
// Règles :
//   - SIRENE = colonne vertébrale (tout établissement actif de culture physique, géolocalisé)
//   - Data ES regroupé par installation : une ligne = un équipement (« Salle Vélo 1 … 21 ») ;
//     les installations à accès réservé (lycées, prisons, casernes, hôtels…) sont écartées
//   - Data ES enrichit avec la surface réelle quand l'installation correspond (SIREN ou proximité+nom)
//   - Data ES non appariés = salles municipales/associatives → offre à part entière (cat 'asso')
//   - chaînes : format publié de l'enseigne pour tous ses clubs (Data ES ne mesure que la salle
//     muscu/cardio, pas les studios de cours : Keep Cool 330 m² mesurés pour des clubs de 300–800 m²)
//   - écartés : studios yoga/pilates purs, activités hors salle (épilation, UV, spa…), coachs sans
//     salle, sièges de franchisés et doublons au même point
//   - capacité = surface × 1,4 adh/m² (fourchette métier 1,2–1,7)
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
const sansSalarie = t => !t || /non employeur|0 salarié/.test(t);
const trancheRang = t => sansSalarie(t) ? 0 : +(/\d+/.exec(t) || [1])[0];   // « 3 à 5 salariés » → 3

const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Enseignes : catégorie et surface totale d'un club (m²). Fourchettes publiées par les annuaires
// de franchise (consultés en 09/2026) ; valeur = moyenne publiée, sinon moyenne géométrique de la
// fourchette (tailles asymétriques : quelques vaisseaux amiraux), arrondie à 50 m².
// Sans format publié trouvé : surface de la catégorie. Testées AVANT les motifs « niche »
// (« L'Orange Bleue, Mon Coach Wellness » n'est pas un coach).
const ENSEIGNES = [
  { nom: 'Basic-Fit', re: /basic.?fit/, cat: 'lowcost', m2: 1600 },                 // 1 000–2 500
  { nom: 'Fitness Park', re: /fitness ?park/, cat: 'lowcost', m2: 1300 },           // 1 000–3 000, moyenne 1 300
  { nom: 'On Air', re: /\bon ?air\b/, cat: 'lowcost', m2: 2100 },                   // 900–5 000
  { nom: 'Keep Cool', re: /keep.?cool/, cat: 'lowcost', m2: 500 },                  // 300–800
  { nom: 'Magic Form', re: /magic ?form/, cat: 'lowcost', m2: 800 },                // 500–1 500, moyenne 800
  { nom: 'Liberty Gym', re: /liberty ?gym/, cat: 'lowcost', m2: 600 },              // 250–1 500
  { nom: 'Vita Liberté', re: /vita ?libert/, cat: 'lowcost', m2: 350 },             // 300–400
  { nom: "L'Appart Fitness", re: /\bl.?appart\b|appart fitness/, cat: 'lowcost', m2: 850 }, // 500–2 000, moyenne 850
  { nom: 'Elancia', re: /elancia/, cat: 'premium', m2: 500 },                       // 400–600
  { nom: 'Wellness Sport Club', re: /wellness ?sport ?club/, cat: 'premium', m2: 2000 }, // ≈ 2 000
  { nom: "L'Orange Bleue", re: /orange ?bleue/, cat: 'classic', m2: 550 },          // 350–900 (milieu de gamme)
  { nom: 'Gigafit', re: /gigafit/, cat: 'classic' },                                // formats de 80 à 1 000 m² et plus
  { nom: 'Neoness', re: /neoness/, cat: 'lowcost' },
  { nom: 'Fitness Factory', re: /fitness ?factory/, cat: 'lowcost' },
  { nom: 'Movida', re: /movida/, cat: 'lowcost' },
  { nom: 'Vita Libre', re: /vita ?libre/, cat: 'lowcost' },
  { nom: 'Episod', re: /episod/, cat: 'lowcost' },
  { nom: 'Neofit', re: /neofit/, cat: 'lowcost' },
  { nom: 'Interval', re: /\binterval\b/, cat: 'lowcost' },
  { nom: 'CMG Sports Club', re: /\bcmg\b|club ?med ?gym/, cat: 'premium' },
  { nom: "L'Usine", re: /\bl.?usine\b/, cat: 'premium' },                         // pas « usine PSA »
  { nom: 'Amazonia', re: /amazonia/, cat: 'premium' },
  { nom: 'Healthcity', re: /health ?city/, cat: 'premium' },
  { nom: 'Holmes Place', re: /holmes ?place/, cat: 'premium' },
];
const NICHE = /cross.?fit|pilates|danse|dance|martial|boxe|boxing|escalade|climb|aikido|judo|karate|taekwondo|capoeira|coaching|coach|ems\b|electrostimulation|aquagym|aquabike/;
function classify(name) {
  const h = norm(name);
  for (const e of ENSEIGNES) if (e.re.test(h)) return { cat: e.cat, enseigne: e };
  return { cat: NICHE.test(h) ? 'niche' : 'classic', enseigne: null };
}
const isYogaOnly = name => /\byoga\b|bikram|ashtanga|vinyasa|\bhatha\b|pilates ?studio|studio ?pilates/.test(norm(name));
// Activité principale hors salle (NAF 93.13Z sert aussi aux instituts, UV, cryothérapie…),
// sauf si le nom évoque aussi une salle (« Fit & Spa », « Gymspa », « Cap Forme - Cap Beauté »)
const HORS_SALLE = /epil|bronz|solarium|\buv\b|cryo|sauna|hammam|massage|beaute|esthetique|minceur|amincissement|onglerie|\bspa\b|thalasso|lipo|cellulite|flottaison/;
const MOT_SALLE = /gym|fit|form|sport|muscu|training|cross|club|athlet|body|coach|cardio|mouv|boxe|pilates|danse/;
const isHorsSalle = name => { const h = norm(name); return HORS_SALLE.test(h) && !MOT_SALLE.test(h); };
// Coach sans salle : nom de coach (ou entrepreneur sans nom diffusé), sans salarié, sans Data ES,
// et sans mot désignant un local (« Studio Coaching », « La Salle Coaching Sportif » restent)
const COACH = /coach|personal ?train|prepa(rateur|ration)? physique|a domicile/;
const LIEU = /studio|salle|cent(er|re)|atelier|club|\bbox\b|\bgym\b|espace|space|\blab\b|loft|garage|hangar|farm|factory|acad/;
// Data ES « non ouvert au public » : pour une salle commerciale ou associative, le drapeau veut
// dire « sur abonnement » (Basic-Fit Laon, L'Orange Bleue Laon…) → gardée ; pour un lycée, une
// prison, une caserne, un hôtel, la salle d'un club d'un autre sport (aviron, athlétisme…) ou le
// gymnase municipal des clubs → accès réservé, écartée.
const RESERVE = /hotel|camping|village (de )?vacances|club ?med|residence|golf|tennis|comite d.entreprise|\bcse?\b|du personnel|\busine\b|nautique|aviron|regate|canoe|kayak|\bvoile\b|compagnie d.arc|athleti|rugby|football|aerodrome|chute libre|centre d.entrainement|centre de formation|thermal|medico|penitentiaire|maison d.arret|detention|educatif|caserne|regiment|militaire|gendarmerie|\bcrs\b|police|pompiers|centre de secours|incendie|lycee|college|scolaire|ecole nationale|universit|campus|staps|\bufr\b|insa\b|hopital|\bchu\b|clinique|readaptation|post.?cure|ehpad/;
const NOM_SALLE = /fitness|\bfit|gym(?!nas)|form(?!ation)|cross.?fit|training|body|club de (musculation|culturisme)|culturisme|halterophil|\bmjc\b/;
function accesReserve(inst) {
  if (inst.pub) return false;
  if (classify(inst.name).enseigne) return false;
  const h = norm(inst.name);
  if (RESERVE.test(h)) return true;
  if (/commercial|association/i.test(`${inst.prop} ${inst.gest}`)) return false;
  return !NOM_SALLE.test(h);
}

const STOP = new Set(['salle', 'de', 'du', 'des', 'la', 'le', 'les', 'sport', 'sports', 'fitness', 'gym', 'club', 'musculation', 'forme', 'remise', 'en', 'centre', 'espace', 'association', 'commune', 'municipale', 'et', 'sarl', 'sas', 'eurl']);
const tokens = s => new Set(norm(s).split(/[^a-z0-9]+/).filter(t => t.length > 2 && !STOP.has(t)));
const shareToken = (a, b) => { for (const t of a) if (b.has(t)) return true; return false; };
const KM_LAT = 110.6, kmLon = lat => 111.32 * Math.cos(lat * Math.PI / 180);
const distKm = (a, b) => Math.hypot((a.lat - b.lat) * KM_LAT, (a.lon - b.lon) * kmLon(a.lat));
const inMet = c => c && c.lat != null && c.lat >= MET.s && c.lat <= MET.n && c.lon >= MET.w && c.lon <= MET.e;

// Surface d'un établissement sans mesure Data ES (sert aussi à chiffrer les exclusions)
function surfSansMesure(g) {
  if (g.enseigne) return g.enseigne.m2 ?? CAT_AREA[g.cat];
  const mul = (g.cat === 'classic' || g.cat === 'niche') ? effectifMul(g.tranche) : 1.0;
  return Math.max(80, Math.min(4000, Math.round(CAT_AREA[g.cat] * mul)));
}

const journal = [];   // exclusions : { regle, name, lat, lon, id, tranche, cap }
const exclure = (regle, g, cap) => journal.push({ regle, name: g.name, lat: g.lat, lon: g.lon, id: g.siren || g.inst || null, tranche: g.tranche ?? null, cap: Math.round(cap ?? 0) });

// ── SIRENE : colonne vertébrale ────────────────────────────────────────────────
const sirene = JSON.parse(readFileSync(new URL('../data/sirene.json', import.meta.url), 'utf8'));
let gyms = []; let noGeo = 0;
const bySiren = new Map(), hash = new Map();
const hkey = (lat, lon) => Math.floor(lat * 50) + ':' + Math.floor(lon * 50); // ~2 km
for (const r of sirene) {
  const g = r.geolocetablissement;
  if (!g || g.lat == null) { noGeo++; continue; }
  if (!inMet(g)) continue;
  const brut = r.enseigne1etablissement || r.denominationusuelleetablissement || r.denominationunitelegale;
  const nom = brut && brut.trim() !== '[ND]' ? brut : null;       // [ND] = nom non diffusible
  const name = nom || 'Salle de sport';
  const { cat, enseigne } = classify(name);
  const rec = {
    lat: +g.lat.toFixed(5), lon: +g.lon.toFixed(5), name, cat, enseigne,
    src: 'sirene', sansNom: !nom,
    date: r.datecreationetablissement || null,
    siren: (r.siret || '').slice(0, 9), tranche: r.trancheeffectifsetablissement || null,
    cp: r.codepostaletablissement, commune: r.libellecommuneetablissement,
    tok: tokens(name), es: [],
  };
  if (isYogaOnly(name)) { exclure('yoga-pilates', rec, surfSansMesure(rec) * MEMBERS_PER_M2); continue; }
  if (isHorsSalle(name)) { exclure('hors-salle', rec, surfSansMesure(rec) * MEMBERS_PER_M2); continue; }
  // dédoublonnage interne : même SIREN à <150 m = même club (multi-SIRET)
  const twins = bySiren.get(rec.siren);
  if (twins && twins.some(t => distKm(t, rec) < 0.15)) continue;
  gyms.push(rec);
  (twins || bySiren.set(rec.siren, []).get(rec.siren)).push(rec);
  const k = hkey(rec.lat, rec.lon);
  (hash.get(k) || hash.set(k, []).get(k)).push(rec);
}
console.log(`SIRENE métropole retenus : ${gyms.length} (sans géoloc : ${noGeo})`);

// ── Data ES : une installation = un regroupement d'équipements ──────────────────
const dataes = JSON.parse(readFileSync(new URL('../data/dataes.json', import.meta.url), 'utf8'));
const instRows = new Map();
for (const e of dataes) {
  // inst_numero = equip_numero sans son préfixe « E001 » (vérifié sur l'API) — repli pour les exports anciens
  const id = e.inst_numero || (e.equip_numero || '').slice(4) || `${e.inst_nom}|${e.equip_coordonnees?.lat}|${e.equip_coordonnees?.lon}`;
  (instRows.get(id) || instRows.set(id, []).get(id)).push(e);
}
const installations = [];
for (const [id, rows] of instRows) {
  const located = rows.filter(e => inMet(e.equip_coordonnees));
  if (!located.length) continue;
  const ref = located.reduce((a, b) => (+b.equip_surf || 0) > (+a.equip_surf || 0) ? b : a);
  // surface : somme des surfaces DISTINCTES — certains déclarants répètent la surface du club sur
  // chaque ligne (L'Appart Oullins : 10 × 600 m²), d'autres détaillent salle par salle (CMG)
  const surfSum = [...new Set(rows.map(e => +e.equip_surf).filter(v => v > 0))].reduce((s, v) => s + v, 0);
  const equipName = rows.map(e => e.equip_nom).find(n => n && n.length > 3 && !/salle de musculation|musculation|cardio/i.test(n));
  const instNom = rows.find(e => e.inst_nom)?.inst_nom;
  const years = rows.map(e => parseInt(e.equip_service_date, 10)).filter(y => y > 1900);
  installations.push({
    inst: id, lat: +ref.equip_coordonnees.lat.toFixed(5), lon: +ref.equip_coordonnees.lon.toFixed(5),
    name: instNom && instNom.length > 3 ? instNom : (equipName || 'Salle de musculation'),
    surf: surfSum > SURF_MIN ? Math.min(SURF_MAX, surfSum) : 0, lignes: rows.length,
    pub: rows.some(e => String(e.equip_ouv_public_bool) === 'true'),
    prop: rows.find(e => e.equip_prop_type)?.equip_prop_type || '', gest: rows.find(e => e.equip_gest_type)?.equip_gest_type || '',
    siren: (rows.find(e => e.inst_siret)?.inst_siret || '').slice(0, 9) || null,
    date: years.length ? `${Math.min(...years)}-01-01` : null,
    cp: ref.inst_cp, commune: ref.new_name,
    tok: tokens(rows.map(e => `${e.inst_nom} ${e.equip_nom || ''}`).join(' ')),
  });
}
console.log(`Data ES métropole : ${installations.reduce((s, i) => s + i.lignes, 0)} lignes → ${installations.length} installations`);

let matched = 0;
const unmatched = [];
const near = rec => {
  const out = [], la = Math.floor(rec.lat * 50), lo = Math.floor(rec.lon * 50);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const arr = hash.get((la + dy) + ':' + (lo + dx)); if (arr) out.push(...arr);
  }
  return out;
};
for (const inst of installations) {
  if (accesReserve(inst)) { exclure('acces-reserve', inst, (inst.surf || CAT_AREA.asso) * MEMBERS_PER_M2); continue; }
  // appariement : SIREN identique, sinon <60 m, sinon <250 m + nom en commun
  let best = null, bd = 1e9;
  for (const s of near(inst)) {
    const d = distKm(inst, s);
    const ok = (inst.siren && s.siren === inst.siren && d < 2) || d < 0.06 || (d < 0.25 && shareToken(inst.tok, s.tok));
    if (ok && d < bd) { bd = d; best = s; }
  }
  if (best) { matched++; best.es.push(inst); } else unmatched.push(inst);
}

// ── Surfaces des établissements SIRENE ──────────────────────────────────────────
for (const g of gyms) {
  g.surfDataes = g.es.length ? Math.min(SURF_MAX, g.es.reduce((s, i) => s + i.surf, 0)) : null;
  if (g.enseigne) { g.surf = surfSansMesure(g); g.surfSrc = 'enseigne'; }
  else if (g.surfDataes > 0) { g.surf = g.surfDataes; g.surfSrc = 'dataes'; }
  else { g.surf = surfSansMesure(g); g.surfSrc = 'defaut'; }
  if (g.es.length) g.src = 'sirene+dataes';
}
const capOf = g => Math.round(Math.min(SURF_MAX, g.surf) * MEMBERS_PER_M2);

// ── Coachs sans salle ───────────────────────────────────────────────────────────
gyms = gyms.filter(g => {
  const h = norm(g.name);
  const coach = !g.enseigne && !g.es.length && sansSalarie(g.tranche) && (g.sansNom || (COACH.test(h) && !LIEU.test(h)));
  if (coach) exclure('coach-sans-salle', g, capOf(g));
  return !coach;
});

// ── Plusieurs établissements au même point exact ────────────────────────────────
// Sièges de franchisés domiciliés chez le gérant (« KC AVIGNON », « KC LES ANGLES »… à Ventabren ;
// « EMS 79000 », « EMS 26750 »… à Manosque) et SIRET en double d'un même club. Mais une zone
// commerciale n'a souvent qu'une adresse (Keep Cool et Basic-Fit au même point à Perpignan) : une
// enseigne connue, un salarié ou un équipement Data ES attestent un club. On garde le mieux attesté
// (Data ES, tranche, enseigne, ancienneté) ; parmi les autres, on écarte les doublons du même club
// et ceux sans aucune attestation. Si le point en porte ≥ 3 et qu'aucun n'est attesté, c'est une
// adresse de domiciliation : tous écartés.
const atPoint = new Map();
for (const g of gyms) { const k = `${g.lat}|${g.lon}`; (atPoint.get(k) || atPoint.set(k, []).get(k)).push(g); }
const drop = new Set();
const attested = g => g.es.length > 0 || !sansSalarie(g.tranche) || !!g.enseigne;
for (const a of atPoint.values()) {
  if (a.length < 2) continue;
  if (a.length >= 3 && !a.some(attested)) { for (const g of a) { drop.add(g); exclure('domiciliation', g, capOf(g)); } continue; }
  a.sort((x, y) => (y.es.length > 0) - (x.es.length > 0) || trancheRang(y.tranche) - trancheRang(x.tranche)
    || !!y.enseigne - !!x.enseigne || (x.date || '9').localeCompare(y.date || '9'));
  const kept = [a[0]];
  for (const g of a.slice(1)) {
    const sameClub = kept.some(k => (k.enseigne && k.enseigne === g.enseigne) || norm(k.name) === norm(g.name));
    if (sameClub || !attested(g)) { drop.add(g); exclure(sameClub ? 'doublon-meme-point' : 'siege-meme-point', g, capOf(g)); }
    else kept.push(g);
  }
}
gyms = gyms.filter(g => !drop.has(g));

// ── Installations Data ES non appariées → salles à part entière ─────────────────
for (const inst of unmatched) {
  const { cat, enseigne } = classify(inst.name);
  const publicOwner = /commune|etat|departement|region|public|association/i.test(`${inst.prop} ${inst.gest}`);
  gyms.push({
    lat: inst.lat, lon: inst.lon, name: inst.name, cat: enseigne ? cat : publicOwner ? 'asso' : cat, enseigne,
    surf: enseigne ? (enseigne.m2 ?? CAT_AREA[cat]) : (inst.surf || CAT_AREA.asso),
    surfSrc: enseigne ? 'enseigne' : inst.surf ? 'dataes' : 'defaut', surfDataes: inst.surf || null, src: 'dataes',
    date: inst.date, siren: inst.siren, tranche: null, inst: inst.inst, ouvPublic: inst.pub,
    cp: inst.cp, commune: inst.commune,
  });
}
for (const g of gyms) {
  g.cap = capOf(g);
  if (g.es) { if (g.es.length) { g.inst = g.es[0].inst; g.ouvPublic = g.es.some(i => i.pub); } delete g.es; }
  g.enseigne = g.enseigne ? g.enseigne.nom : null;
  delete g.tok; delete g.sansNom;
}

// ── Contrôles ───────────────────────────────────────────────────────────────────
const fmt = v => Math.round(v).toLocaleString('fr');
console.log(`Data ES appariées à SIRENE : ${matched} installations ; ajoutées (municipal/asso/non-93.13Z) : ${unmatched.length}`);
console.log('Exclusions (data/offre-journal.json) :');
const REGLES = {
  'yoga-pilates': 'studios yoga/pilates', 'hors-salle': 'activité hors salle (épilation, UV, spa…)',
  'acces-reserve': 'Data ES à accès réservé', 'coach-sans-salle': 'coachs sans salle',
  'domiciliation': 'adresses de domiciliation', 'siege-meme-point': 'non attestés au même point qu\'un club',
  'doublon-meme-point': 'doublons du même club au même point',
};
for (const [r, lbl] of Object.entries(REGLES)) {
  const a = journal.filter(j => j.regle === r);
  console.log(`  ${lbl.padEnd(42)} ${String(a.length).padStart(5)}${r === 'yoga-pilates' ? '' : ` · ${fmt(a.reduce((s, j) => s + j.cap, 0))} places`}`);
}
console.log(`OFFRE TOTALE : ${gyms.length} salles, capacité ${fmt(gyms.reduce((s, g) => s + g.cap, 0))} adhérents`);
for (const cat of ['lowcost', 'premium', 'classic', 'niche', 'asso'])
  console.log(`  ${cat}: ${gyms.filter(g => g.cat === cat).length}`);
console.log(`  Basic Fit détectés : ${gyms.filter(g => g.enseigne === 'Basic-Fit').length}, Fitness Park : ${gyms.filter(g => g.enseigne === 'Fitness Park').length}`);
// Hall b (Saint-Dionisy) : seul point de calibration réel — elle ne doit jamais tomber dans une règle
const hallb = gyms.find(g => /^hall ?b$/i.test(g.name) && g.cp === '30980');
console.log(`  Hall b : ${hallb ? `${hallb.surf} m² · ${hallb.cap} places (${hallb.surfSrc})` : '!! ABSENTE — vérifier le journal'}`);

writeFileSync(new URL('../data/gyms-fused.json', import.meta.url), JSON.stringify(gyms));
writeFileSync(new URL('../data/offre-journal.json', import.meta.url), '[\n' + journal.map(j => JSON.stringify(j)).join(',\n') + '\n]\n');
// fichier léger pour le front (racine du repo)
const lean = gyms.map(g => [g.lat, g.lon, g.name, g.cat, Math.round(g.surf), g.cap, g.src, g.date ? g.date.slice(0, 4) : null, g.surfSrc]);
writeFileSync(new URL('../gyms.json', import.meta.url), JSON.stringify({ fields: ['lat', 'lon', 'name', 'cat', 'surf', 'cap', 'src', 'annee', 'surfSrc'], gyms: lean }));
