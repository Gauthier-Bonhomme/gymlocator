// 02 — Offre fusionnée : SIRENE ∪ Data ES (surfaces réelles) ∪ clubs de chaîne d'OpenStreetMap
// Produit data/gyms-fused.json (complet), data/offre-journal.json (chaque exclusion et sa raison)
// et gyms.json (léger, pour le front).
// Règles :
//   - SIRENE = colonne vertébrale : NAF 93.13Z (tout établissement actif de culture physique,
//     géolocalisé) et, filtrés par nom, 93.11Z, 93.12Z et 85.51Z, où sont déclarés une partie des
//     clubs de chaîne (Fitness Park : 74 établissements en 93.11Z)
//   - Data ES regroupé par installation : une ligne = un équipement (« Salle Vélo 1 … 21 ») ;
//     les installations à accès réservé (lycées, prisons, casernes, hôtels…) sont écartées
//   - Data ES enrichit avec la surface réelle quand l'installation correspond (SIREN ou proximité+nom)
//   - Data ES non appariés = salles municipales/associatives → offre à part entière (cat 'asso')
//   - chaînes : format publié de l'enseigne pour tous ses clubs (Data ES ne mesure que la salle
//     muscu/cardio, pas les studios de cours : Keep Cool 330 m² mesurés pour des clubs de 300–800 m²)
//   - enseigne reconnue par le nom (enseigne, nom usuel ou raison sociale), par le SIREN d'un
//     franchisé connu, ou par un club de la chaîne dans OpenStreetMap ; les clubs de chaîne
//     d'OpenStreetMap absents de SIRENE et de Data ES sont ajoutés (garde-fou : reseaux.mjs)
//   - écartés : studios yoga/pilates purs, activités hors salle (épilation, UV, spa…), coachs sans
//     salle, sièges de franchisés, doublons au même point ou de la même enseigne
//   - capacité = surface × 1,4 adh/m² (fourchette métier 1,2–1,7), sauf valeurs réelles connues
//     (table REELLES : surface et adhérents de l'exploitant, jamais recalculés)
import { readFileSync, writeFileSync } from 'node:fs';
import { RESEAUX } from './reseaux.mjs';

const MET = { s: 41.2, n: 51.3, w: -5.5, e: 9.9 };
const MEMBERS_PER_M2 = 1.4;
const CAT_AREA = { lowcost: 1400, premium: 800, classic: 600, niche: 250, asso: 200 };
const SURF_MIN = 40, SURF_MAX = 6000;

// Valeurs RÉELLES communiquées par l'exploitant (clé = SIRET de l'établissement) : elles priment
// sur Data ES, le format de l'enseigne et la surface par défaut. La capacité y est le nombre
// d'adhérents constaté, PAS surface × MEMBERS_PER_M2 : Hall b compte 1 600 adhérents pour 2 400 m²
// (0,67 adh/m² ; la règle en donnerait 3 360). Sans cette table, Hall b (« non employeur » dans
// SIRENE) était estimée à 240 m² / 336 places (600 m² × 0,4 × 1,4).
// cat : segment déclaré par l'exploitant ; sans enseigne reconnue, un indépendant serait « classic ».
const REELLES = {
  '94409256800012': { nom: 'Hall b', m2: 2400, adherents: 1600, cat: 'premium' },   // exploitant, 10/2026
};

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
// Enseigne lue dans l'enseigne, puis le nom usuel, puis la raison sociale : « BASIT FIT » ou
// « C FIT » de BASIC-FIT FRANCE restent des Basic-Fit (13 établissements 93.13Z en 10/2026)
function enseigneDe(...noms) {
  for (const n of noms) if (n) { const { enseigne } = classify(n); if (enseigne) return enseigne; }
  return null;
}
// Raison sociale de franchisé : « KC <ville> » est une société franchisée Keep Cool (≈ 70 en 93.13Z,
// presque toutes au point d'un Keep Cool d'OpenStreetMap, ou employeuses) — son SIREN est connu
const RAISON_FRANCHISE = [{ re: /^kc /, enseigne: ENSEIGNES.find(e => e.nom === 'Keep Cool') }];

// Autres codes NAF (93.11Z gestion d'installations, 93.12Z clubs, 85.51Z enseignement sportif) :
// des clubs de chaîne y sont déclarés, mais surtout des associations (gym volontaire, gymnastique,
// club de musculation de la commune) et des coachs. Retenus : une enseigne connue, ou un nom de salle
// (fitness, fit, gym, muscu — pas la gymnastique) porté par une société ou un employeur ; sans
// enseigne, un salarié ou un équipement Data ES doit encore l'attester (règle autre-naf-non-atteste).
// Associations et personnes publiques : leur salle, quand elle existe, est déjà dans Data ES, et leur
// adresse SIRENE est souvent celle du siège (mairie, domicile du président).
const NOM_SALLE_NAF = /fitness|\bfit\b|\bgyms?\b|muscu/;
const GYMNASTIQUE = /gymnasti|gymniq|volontaire|\bgv\b|baby ?gym|gym (douce|seniors?|enfants?|pour tous|loisirs?|d.entretien|tonique)|trampoline|acrobat/;
const employeur = r => !sansSalarie(r.trancheeffectifsetablissement) || r.caractereemployeuretablissement === 'Oui';
function salleAutreNaf(r, name) {
  const h = norm(name), cj = String(r.categoriejuridiqueunitelegale || '');
  if (!NOM_SALLE_NAF.test(h) || GYMNASTIQUE.test(h)) return false;
  if (cj.startsWith('92') || cj.startsWith('7')) return false;   // association, personne publique
  return cj !== '1000' || employeur(r);                           // entrepreneur individuel : coach, sauf s'il emploie
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
const exclure = (regle, g, cap) => journal.push({ regle, name: g.name, lat: g.lat, lon: g.lon, id: g.siren || g.inst || g.osm || null, tranche: g.tranche ?? null, cap: Math.round(cap ?? 0) });

// ── SIRENE : colonne vertébrale ────────────────────────────────────────────────
const readData = f => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const sirene = readData('sirene.json'), sireneAutres = readData('sirene-autres.json');
let gyms = []; let noGeo = 0;
const bySiren = new Map(), hash = new Map();
const hkey = (lat, lon) => Math.floor(lat * 50) + ':' + Math.floor(lon * 50); // ~2 km
// SIREN connus : unité légale dont un établissement porte l'enseigne (même hors métropole), dont la
// raison sociale suit la convention du réseau, ou que Data ES et OpenStreetMap rattachent à l'enseigne
const ensDuSiren = new Map();
const connaitre = (siren, e) => { if (siren && e) (ensDuSiren.get(siren) || ensDuSiren.set(siren, new Set()).get(siren)).add(e); };
const autres = { retenus: 0, enseigne: 0 };
for (const r of [...sirene, ...sireneAutres.map(r => ({ ...r, autreNaf: true }))]) {
  const siren = (r.siret || '').slice(0, 9);
  const enseigne = enseigneDe(r.enseigne1etablissement, r.denominationusuelleetablissement, r.denominationunitelegale);
  connaitre(siren, enseigne);
  for (const f of RAISON_FRANCHISE) if (f.re.test(norm(r.denominationunitelegale))) connaitre(siren, f.enseigne);
  const brut = r.enseigne1etablissement || r.denominationusuelleetablissement || r.denominationunitelegale;
  const nom = brut && brut.trim() !== '[ND]' ? brut : null;       // [ND] = nom non diffusible
  const name = nom || 'Salle de sport';
  if (r.autreNaf && !enseigne && !salleAutreNaf(r, name)) continue;   // association, coach, gymnastique…
  const g = r.geolocetablissement;
  if (!g || g.lat == null) { if (!r.autreNaf) noGeo++; continue; }
  if (!inMet(g)) continue;
  const rec = {
    lat: +g.lat.toFixed(5), lon: +g.lon.toFixed(5), name,
    cat: REELLES[r.siret]?.cat ?? (enseigne ? enseigne.cat : classify(name).cat), enseigne,
    enseigneSrc: enseigne ? 'nom' : null,
    src: 'sirene', naf: r.autreNaf ? r.activiteprincipaleetablissement : '93.13Z', sansNom: !nom,
    date: r.datecreationetablissement || null,
    siren, siret: r.siret, tranche: r.trancheeffectifsetablissement || null, emp: employeur(r),
    cp: r.codepostaletablissement, commune: r.libellecommuneetablissement,
    tok: tokens(name), es: [], reel: REELLES[r.siret],
  };
  if (isYogaOnly(name)) { exclure('yoga-pilates', rec, surfSansMesure(rec) * MEMBERS_PER_M2); continue; }
  if (isHorsSalle(name)) { exclure('hors-salle', rec, surfSansMesure(rec) * MEMBERS_PER_M2); continue; }
  // dédoublonnage interne : même SIREN à <150 m = même club (multi-SIRET) ; l'enseigne d'un double
  // déclaré sous un autre code NAF profite au club retenu
  const twin = bySiren.get(rec.siren)?.find(t => distKm(t, rec) < 0.15);
  if (twin) { if (!twin.enseigne && rec.enseigne) Object.assign(twin, { enseigne: rec.enseigne, cat: rec.cat, enseigneSrc: 'nom' }); continue; }
  gyms.push(rec);
  if (r.autreNaf) { autres.retenus++; if (enseigne) autres.enseigne++; }
  const twins = bySiren.get(rec.siren);
  (twins || bySiren.set(rec.siren, []).get(rec.siren)).push(rec);
  const k = hkey(rec.lat, rec.lon);
  (hash.get(k) || hash.set(k, []).get(k)).push(rec);
}
console.log(`SIRENE métropole retenus : ${gyms.length} (sans géoloc : ${noGeo}), dont autres NAF : ${autres.retenus} sur ${sireneAutres.length} lignes filtrées par nom (${autres.enseigne} d'enseigne)`);

// ── Data ES : une installation = un regroupement d'équipements ──────────────────
// Trié par numéro d'équipement : l'API exporte les mêmes lignes dans un ordre qui change d'un
// téléchargement à l'autre (1 100 lignes déplacées sur 7 991 entre le 13 et le 14/10/2026), et la
// position, le propriétaire et le nom d'une installation sont pris à sa première ligne retenue.
// Sans tri, deux téléchargements identiques donnaient 5 à 8 installations différentes (grid.bin
// non reproductible).
const dataes = JSON.parse(readFileSync(new URL('../data/dataes.json', import.meta.url), 'utf8'))
  .sort((a, b) => a.equip_numero < b.equip_numero ? -1 : a.equip_numero > b.equip_numero ? 1 : 0);
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
  const name = instNom && instNom.length > 3 ? instNom : (equipName || 'Salle de musculation');
  installations.push({
    inst: id, lat: +ref.equip_coordonnees.lat.toFixed(5), lon: +ref.equip_coordonnees.lon.toFixed(5),
    name, enseigne: classify(name).enseigne,
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
for (const i of installations) connaitre(i.siren, i.enseigne);

// ── OpenStreetMap : clubs de chaîne (leisure=fitness_centre, enseigne par brand ou name) ──────
const osm = readData('osm-fitness.json');
const osmSiret = new Map(), osmClubs = [];
let osmMet = 0;
for (const e of osm.elements || []) {
  const p = e.type === 'node' ? e : e.center;
  if (!p || !inMet(p)) continue;
  osmMet++;
  const t = e.tags || {}, enseigne = enseigneDe(t.brand, t.name);
  if (!enseigne) continue;
  const siret = (t['ref:FR:SIRET'] || '').replace(/\s/g, ''), siren = (t['ref:FR:SIREN'] || '').replace(/\s/g, '');
  if (/^\d{14}$/.test(siret)) { osmSiret.set(siret, enseigne); connaitre(siret.slice(0, 9), enseigne); }
  if (/^\d{9}$/.test(siren)) connaitre(siren, enseigne);
  osmClubs.push({ lat: +p.lat.toFixed(5), lon: +p.lon.toFixed(5), name: t.name || enseigne.nom, enseigne,
    cp: t['addr:postcode'] || null, commune: t['addr:city'] || null, osm: `${e.type}/${e.id}` });
}
console.log(`OpenStreetMap métropole : ${osmMet} salles, dont ${osmClubs.length} clubs d'une enseigne connue`);

// ── Franchisés déclarés sous leur raison sociale : SIRET dans OpenStreetMap, SIREN connu ───────
// Un établissement sans enseigne prend celle de son SIRET dans OpenStreetMap, ou celle de son SIREN
// si l'unité légale n'en a qu'une et que l'établissement est attesté : un salarié, puis (après
// l'appariement) un équipement Data ES. Un siège non attesté reste soumis aux règles des coachs et du
// même point.
function franchises() {
  for (const g of gyms) {
    if (g.enseigne) continue;
    const s = ensDuSiren.get(g.siren);
    const e = osmSiret.get(g.siret) || (s && s.size === 1 && (g.emp || g.es.length) ? [...s][0] : null);
    if (e) Object.assign(g, { enseigne: e, cat: e.cat, enseigneSrc: osmSiret.has(g.siret) ? 'osm' : 'siren' });
  }
}
franchises();

let matched = 0;
const unmatched = [];
const near = rec => {
  const out = [], la = Math.floor(rec.lat * 50), lo = Math.floor(rec.lon * 50);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const arr = hash.get((la + dy) + ':' + (lo + dx)); if (arr) out.push(...arr);
  }
  return out;
};
// Seul club d'une enseigne dans sa commune, côté SIRENE comme côté Data ES : c'est le même club, même
// à 1–3 km (SIRENE géolocalise parfois l'adresse d'une zone commerciale loin du bâtiment : Basic-Fit
// Béthune, Bayeux, Feurs ; Keep Cool Narbonne, Cahors…). Dans une ville à plusieurs clubs, rien n'est forcé.
const communeDe = c => norm(c).replace(/ \d+(er|e) arrondissement$/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const parCommune = list => {
  const m = new Map();
  for (const x of list) if (x.enseigne) { const k = `${x.enseigne.nom}|${communeDe(x.commune)}`; (m.get(k) || m.set(k, []).get(k)).push(x); }
  return m;
};
const sirParCommune = parCommune(gyms), instParCommune = parCommune(installations);
for (const inst of installations) {
  if (accesReserve(inst)) { exclure('acces-reserve', inst, (inst.surf || CAT_AREA.asso) * MEMBERS_PER_M2); continue; }
  // appariement : SIREN identique, sinon <60 m, sinon <250 m + nom en commun, sinon <500 m et même
  // enseigne (« KEEPCOOL » SIRENE et « KEEP COOL Chutes Lavie » Data ES à 107 m n'ont aucun mot commun),
  // sinon < 3 km quand c'est le seul club de l'enseigne dans la commune
  let best = null, bd = 1e9;
  for (const s of near(inst)) {
    const d = distKm(inst, s);
    const ok = (inst.siren && s.siren === inst.siren && d < 2) || d < 0.06 || (d < 0.25 && shareToken(inst.tok, s.tok))
      || (inst.enseigne && s.enseigne === inst.enseigne && d < 0.5);
    if (ok && d < bd) { bd = d; best = s; }
  }
  const k = inst.enseigne && `${inst.enseigne.nom}|${communeDe(inst.commune)}`;
  const seul = k && instParCommune.get(k).length === 1 && sirParCommune.get(k)?.length === 1 ? sirParCommune.get(k)[0] : null;
  if (!best && seul && distKm(inst, seul) < 3) best = seul;
  if (best) { matched++; best.es.push(inst); } else unmatched.push(inst);
}
franchises();

// ── Installations Data ES non appariées → salles à part entière ─────────────────
const esGyms = unmatched.map(inst => {
  const { cat } = classify(inst.name), enseigne = inst.enseigne;
  const publicOwner = /commune|etat|departement|region|public|association/i.test(`${inst.prop} ${inst.gest}`);
  return {
    lat: inst.lat, lon: inst.lon, name: inst.name, cat: enseigne ? enseigne.cat : publicOwner ? 'asso' : cat, enseigne,
    enseigneSrc: enseigne ? 'nom' : null, surfDataes: inst.surf || null, src: 'dataes',
    date: inst.date, siren: inst.siren, tranche: null, inst: inst.inst, ouvPublic: inst.pub,
    cp: inst.cp, commune: inst.commune,
  };
});

// ── Clubs de chaîne d'OpenStreetMap ─────────────────────────────────────────────
// a) Même lieu : la salle sans enseigne la plus proche à ≤ 150 m (≤ 1 km si son SIREN est un franchisé
//    connu de l'enseigne) est ce club, déclaré sous sa raison sociale (« FITNESS MONTROUGE » au point
//    du Fitness Park de Montrouge) — sauf si un club de l'enseigne est déjà à ≤ 150 m. Une salle d'une
//    autre enseigne à ≤ 150 m l'est aussi si son SIREN est connu de l'enseigne OSM : club repris,
//    SIRENE garde l'ancienne étiquette (les Amazonia de KC NANCY CENTRE, KC METZ GARE… sont des Keep Cool).
// b) Un pour un : chaque autre club OSM est apparié au club de même enseigne le plus proche à ≤ 3 km
//    (SIRENE place parfois au centre-ville un club de zone commerciale), les plus proches d'abord.
// c) Sinon, une salle d'une autre enseigne à ≤ 50 m est le même local (rebaptisé, mal étiqueté) : on
//    garde la donnée officielle. Au-delà, ce sont deux enseignes voisines d'une zone commerciale (Keep
//    Cool et Basic-Fit à Montélimar, 60 m) : le club manque à SIRENE et à Data ES, il est ajouté.
const osmStat = { lieu: 0, apparies: 0, conflits: 0 };
const osmGyms = [];
{
  const grille = new Map(), gk = (lat, lon) => Math.floor(lat * 20) + ':' + Math.floor(lon * 20);   // ≥ 3,5 km
  for (const g of [...gyms, ...esGyms]) { const k = gk(g.lat, g.lon); (grille.get(k) || grille.set(k, []).get(k)).push(g); }
  const autour = p => {
    const out = [], la = Math.floor(p.lat * 20), lo = Math.floor(p.lon * 20);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const a = grille.get((la + dy) + ':' + (lo + dx)); if (a) out.push(...a); }
    return out;
  };
  const pris = new Set(), restants = [];
  for (const o of osmClubs) {
    const proches = autour(o);
    if (proches.some(g => g.enseigne === o.enseigne && distKm(o, g) <= 0.15)) { restants.push(o); continue; }
    let best = null, bd = Infinity;
    for (const g of proches) {
      if (g.reel || g.cat === 'asso' || RESERVE.test(norm(g.name))) continue;   // lycée, hôtel… voisins du club
      const connu = ensDuSiren.get(g.siren)?.has(o.enseigne);
      if (g.enseigne && !connu) continue;
      const d = distKm(o, g), lim = connu && !g.enseigne ? 1 : 0.15;
      if (d <= lim && d < bd) { bd = d; best = g; }
    }
    if (best) { Object.assign(best, { enseigne: o.enseigne, cat: o.enseigne.cat, enseigneSrc: 'osm' }); pris.add(best); osmStat.lieu++; }
    else restants.push(o);
  }
  const paires = [];
  restants.forEach((o, io) => {
    for (const g of autour(o)) if (g.enseigne === o.enseigne) { const d = distKm(o, g); if (d <= 3) paires.push([d, io, g]); }
  });
  paires.sort((a, b) => a[0] - b[0]);
  const osmPris = new Set();
  for (const [, io, g] of paires) if (!osmPris.has(io) && !pris.has(g)) { osmPris.add(io); pris.add(g); osmStat.apparies++; }
  restants.forEach((o, io) => {
    if (osmPris.has(io)) return;
    if (autour(o).some(g => g.enseigne && g.enseigne !== o.enseigne && distKm(o, g) <= 0.05)) { osmStat.conflits++; return; }
    osmGyms.push({ lat: o.lat, lon: o.lon, name: o.name, cat: o.enseigne.cat, enseigne: o.enseigne, enseigneSrc: 'osm',
      src: 'osm', osm: o.osm, date: null, siren: null, tranche: null, cp: o.cp, commune: o.commune });
  });
}

// ── Surfaces des établissements SIRENE ──────────────────────────────────────────
for (const g of gyms) {
  g.surfDataes = g.es.length ? Math.min(SURF_MAX, g.es.reduce((s, i) => s + i.surf, 0)) : null;
  if (g.reel) { g.surf = g.reel.m2; g.surfSrc = 'reel'; }
  else if (g.enseigne) { g.surf = surfSansMesure(g); g.surfSrc = 'enseigne'; }
  else if (g.surfDataes > 0) { g.surf = g.surfDataes; g.surfSrc = 'dataes'; }
  else { g.surf = surfSansMesure(g); g.surfSrc = 'defaut'; }
  if (g.es.length) g.src = 'sirene+dataes';
}
for (const g of esGyms) Object.assign(g, g.enseigne ? { surf: g.enseigne.m2 ?? CAT_AREA[g.cat], surfSrc: 'enseigne' }
  : { surf: g.surfDataes || CAT_AREA.asso, surfSrc: g.surfDataes ? 'dataes' : 'defaut' });
for (const g of osmGyms) Object.assign(g, { surf: g.enseigne.m2 ?? CAT_AREA[g.cat], surfSrc: 'enseigne' });
const capOf = g => g.reel ? g.reel.adherents : Math.round(Math.min(SURF_MAX, g.surf) * MEMBERS_PER_M2);

// ── Autres codes NAF : sans enseigne, un salarié ou un équipement Data ES doit attester la salle ──
gyms = gyms.filter(g => {
  const ko = g.naf !== '93.13Z' && !g.enseigne && !g.emp && !g.es.length;
  if (ko) exclure('autre-naf-non-atteste', g, capOf(g));
  return !ko;
});

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

gyms.push(...esGyms, ...osmGyms);

// ── Même enseigne à moins de 150 m : un seul club ───────────────────────────────
// Deux franchisés successifs encore actifs (L'Orange Bleue Ploërmel, 53 m), un club déclaré deux fois…
// On garde le mieux attesté : valeurs réelles, mesure Data ES, SIRENE plutôt qu'OSM, employeur, ancienneté.
{
  const rang = g => (g.reel ? 8 : 0) + (g.es?.length || g.src === 'dataes' ? 4 : 0) + (g.src !== 'osm' ? 2 : 0) + (g.emp ? 1 : 0);
  const gardes = new Map(), doublons = new Set();
  for (const g of gyms.filter(g => g.enseigne).sort((a, b) => rang(b) - rang(a) || (a.date || '9').localeCompare(b.date || '9'))) {
    const k = gardes.get(g.enseigne) || gardes.set(g.enseigne, []).get(g.enseigne);
    if (k.some(x => distKm(x, g) < 0.15)) { doublons.add(g); exclure('doublon-meme-enseigne', g, capOf(g)); } else k.push(g);
  }
  gyms = gyms.filter(g => !doublons.has(g));
}
for (const g of gyms) {
  g.cap = capOf(g);
  if (g.es) { if (g.es.length) { g.inst = g.es[0].inst; g.ouvPublic = g.es.some(i => i.pub); } delete g.es; }
  g.enseigne = g.enseigne ? g.enseigne.nom : null;
  delete g.tok; delete g.sansNom; delete g.reel; delete g.emp;
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
  'autre-naf-non-atteste': 'autres NAF sans enseigne, salarié ni Data ES', 'doublon-meme-enseigne': 'même enseigne à moins de 150 m',
};
for (const [r, lbl] of Object.entries(REGLES)) {
  const a = journal.filter(j => j.regle === r);
  console.log(`  ${lbl.padEnd(42)} ${String(a.length).padStart(5)}${r === 'yoga-pilates' ? '' : ` · ${fmt(a.reduce((s, j) => s + j.cap, 0))} places`}`);
}
console.log(`OFFRE TOTALE : ${gyms.length} salles, capacité ${fmt(gyms.reduce((s, g) => s + g.cap, 0))} adhérents`);
for (const cat of ['lowcost', 'premium', 'classic', 'niche', 'asso'])
  console.log(`  ${cat}: ${gyms.filter(g => g.cat === cat).length}`);
const parSrc = s => gyms.filter(g => g.enseigneSrc === s).length;
console.log(`  Enseigne reconnue par le nom ${parSrc('nom')}, par le SIREN ${parSrc('siren')}, par OpenStreetMap ${parSrc('osm')} `
  + `(${gyms.filter(g => g.src === 'osm').length} clubs ajoutés ; ${osmStat.lieu} au même lieu, ${osmStat.apparies} appariés à ≤ 3 km, ${osmStat.conflits} au local d'une autre enseigne)`);
// Garde-fous de la CI : sources complètes et réseaux de franchise au-dessus des seuils (reseaux.mjs)
const echecs = [];
if (sireneAutres.length < 5000) echecs.push(`sirene-autres.json : ${sireneAutres.length} lignes (< 5 000), téléchargement incomplet ?`);
if (osmMet < 3000) echecs.push(`osm-fitness.json : ${osmMet} salles en métropole (< 3 000), Overpass a-t-il répondu ?`);
console.log('  Réseaux (clubs retenus / publiés, seuil) :');
for (const r of RESEAUX) {
  const n = gyms.filter(g => g.enseigne === r.nom).length;
  console.log(`    ${n >= r.min ? 'OK' : '!!'} ${r.nom.padEnd(18)} ${String(n).padStart(4)} / ${r.publie} (seuil ${r.min})`);
  if (n < r.min) echecs.push(`${r.nom} : ${n} clubs (< ${r.min})`);
}
// Hall b (Saint-Dionisy) : seul point de calibration réel — elle ne doit jamais tomber dans une règle
const hallb = gyms.find(g => /^hall ?b$/i.test(g.name) && g.cp === '30980');
const hbReel = hallb?.surfSrc === 'reel' ? '' : ' !! valeurs réelles non appliquées — SIRET changé ?';
console.log(`  Hall b : ${hallb ? `${hallb.surf} m² · ${hallb.cap} places (${hallb.surfSrc}) · ${hallb.cat}${hbReel}` : '!! ABSENTE — vérifier le journal'}`);

writeFileSync(new URL('../data/gyms-fused.json', import.meta.url), JSON.stringify(gyms));
writeFileSync(new URL('../data/offre-journal.json', import.meta.url), '[\n' + journal.map(j => JSON.stringify(j)).join(',\n') + '\n]\n');
// fichier léger pour le front (racine du repo)
const lean = gyms.map(g => [g.lat, g.lon, g.name, g.cat, Math.round(g.surf), g.cap, g.src, g.date ? g.date.slice(0, 4) : null, g.surfSrc]);
writeFileSync(new URL('../gyms.json', import.meta.url), JSON.stringify({ fields: ['lat', 'lon', 'name', 'cat', 'surf', 'cap', 'src', 'annee', 'surfSrc'], gyms: lean }));
if (echecs.length) { console.log(`!! ÉCHEC : ${echecs.join(' ; ')}`); process.exit(1); }
