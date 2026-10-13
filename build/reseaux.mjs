// Taille des grands réseaux de franchise : nombre de clubs publié par l'enseigne (classement
// Fitness Challenges, 04/2026, chiffres déclarés, outre-mer compris) et seuil minimal attendu dans
// l'offre métropolitaine : 85 % du réseau publié, arrondi à la dizaine (audit n° 2).
// 02-supply.mjs échoue sous un seuil (garde-fou de la CI mensuelle : un format source qui change ou
// une enseigne qui n'est plus reconnue ne doit pas passer en silence) ; audit.mjs les contrôle aussi.
export const RESEAUX = [
  { nom: 'Basic-Fit', publie: 894, min: 760 },
  { nom: "L'Orange Bleue", publie: 400, min: 340 },
  { nom: 'Fitness Park', publie: 325, min: 280 },
  // Exception : 244 clubs attestés le 13/10/2026 (83 %), le seuil de 250 n'est pas atteignable avec
  // SIRENE, Data ES et OpenStreetMap. Il manque des clubs absents des trois sources, 5 sociétés « KC »
  // récentes ou anciennes sans salarié ni équipement Data ES (Angers, La Chapelle-sur-Erdre, Houssen,
  // Lambersart, Nancy Saint-Nicolas) et les clubs de la Réunion. Seuil ≈ 5 % sous le compte.
  { nom: 'Keep Cool', publie: 294, min: 230 },
  { nom: "L'Appart Fitness", publie: 110, min: 90 },
  { nom: 'On Air', publie: 96, min: 80 },
];
