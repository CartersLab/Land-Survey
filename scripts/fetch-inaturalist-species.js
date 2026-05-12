#!/usr/bin/env node
/**
 * fetch-inaturalist-species.js
 *
 * Fetches all species observed in Michigan from iNaturalist, infers app
 * category from iconic taxon + family heuristics, and writes
 * data/michigan-species.js in compact array format.
 *
 * Requirements: Node 18+ (built-in fetch)
 * Usage:
 *   node scripts/fetch-inaturalist-species.js
 *   node scripts/fetch-inaturalist-species.js --with-gbif   (also resolve GBIF keys, ~3x slower)
 *   node scripts/fetch-inaturalist-species.js --place 23    (override Michigan place_id)
 *
 * Michigan place_id = 23 in iNaturalist.
 * Verify: https://www.inaturalist.org/places/michigan  (id shown in URL)
 *
 * Output format — each row:
 *   [inatId, gbifKey|null, scientificName, commonName, catIndex, family]
 * catIndex maps to SPECIES_CATS in modules/species.js
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = resolve(__dirname, '../data/michigan-species.js');

const args = process.argv.slice(2);
const WITH_GBIF = args.includes('--with-gbif');
const placeArg = args.find(a => a.startsWith('--place'));
const PLACE_ID = placeArg ? Number(args[args.indexOf(placeArg) + 1] ?? placeArg.split('=')[1]) : 23;

const INAT_BASE = 'https://api.inaturalist.org/v1';
const GBIF_BASE = 'https://api.gbif.org/v1';
const PER_PAGE = 500;

const delay = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Category indices — must match SPECIES_CATS in modules/species.js
// ---------------------------------------------------------------------------
const SPECIES_CATS = [
  'tree',         // 0
  'shrub',        // 1
  'herb',         // 2
  'grass',        // 3
  'fern',         // 4
  'moss',         // 5
  'fungus',       // 6
  'lichen',       // 7
  'bird',         // 8
  'mammal',       // 9
  'herp',         // 10  (reptiles + amphibians)
  'fish',         // 11
  'invertebrate', // 12
  'invasive',     // 13
];
const CAT = Object.fromEntries(SPECIES_CATS.map((c, i) => [c, i]));

// iNaturalist iconic_taxon_name → category index (non-plant groups)
const ICONIC_CAT = {
  'Aves':            CAT.bird,
  'Mammalia':        CAT.mammal,
  'Reptilia':        CAT.herp,
  'Amphibia':        CAT.herp,
  'Actinopterygii':  CAT.fish,
  'Insecta':         CAT.invertebrate,
  'Arachnida':       CAT.invertebrate,
  'Mollusca':        CAT.invertebrate,
  'Animalia':        CAT.invertebrate,  // catch-all for unlisted animals
  'Fungi':           CAT.fungus,
  'Chromista':       CAT.herb,
  'Protozoa':        CAT.herb,
  'Bacteria':        CAT.herb,
  // Plantae → null, needs further inference
};

// Family → category for plants (checked in order, first match wins)
const FAMILY_RULES = [
  // Grasses / sedges / rushes
  { cat: CAT.grass,   families: ['Poaceae','Cyperaceae','Juncaceae','Typhaceae','Sparganiaceae','Eriocaulaceae'] },
  // True ferns, horsetails, clubmosses
  { cat: CAT.fern,    families: ['Polypodiaceae','Dryopteridaceae','Athyriaceae','Aspleniaceae','Thelypteridaceae',
                                  'Equisetaceae','Lycopodiaceae','Selaginellaceae','Osmundaceae','Ophioglossaceae',
                                  'Marsileaceae','Azollaceae','Salviniaceae','Dennstaedtiaceae','Woodsiaceae',
                                  'Blechnaceae','Onocleaceae','Cystopteridaceae'] },
  // Mosses / liverworts / hornworts — matched by class below, but family fallback
  { cat: CAT.moss,    families: ['Sphagnaceae','Polytrichaceae','Bryaceae','Hypnaceae','Mniaceae'] },
  // Lichens
  { cat: CAT.lichen,  classes: ['Lecanoromycetes','Lichinomycetes','Arthoniomycetes','Dothideomycetes'] },
  // Aquatic / submerged herbs — before tree/shrub so floating-leaf plants aren't misclassed
  { cat: CAT.herb,    families: ['Potamogetonaceae','Nymphaeaceae','Lemnaceae','Ceratophyllaceae',
                                  'Hydrocharitaceae','Haloragaceae','Callitrichaceae','Ruppiaceae',
                                  'Zannichelliaceae','Najadaceae'] },
  // Conifers
  { cat: CAT.tree,    families: ['Pinaceae','Cupressaceae','Taxaceae'] },
];

// Common name keyword rules for plants after family rules fail
const TREE_RE  = /\b(tree|oak|maple|elm|ash|birch|pine|spruce|fir|cedar|hemlock|hickory|walnut|basswood|tulip|cherry|crabapple|plum|cottonwood|aspen|beech|sycamore|locust|catalpa|larch|tamarack|buckeye|chestnut|ironwood|hackberry|sassafras|magnolia|sweetgum|pawpaw|bitternut|butternut|coffeetree)\b/i;
const SHRUB_RE = /\b(shrub|bush|blueberry|huckleberry|serviceberry|viburnum|dogwood|alder|buttonbush|elderberry|gooseberry|currant|raspberry|blackberry|rose|hawthorn|spirea|ninebark|leadplant|leatherwood|leatherleaf|bog rosemary|labrador tea|sheep laurel|bog laurel|swamp rose|meadowsweet|steeplebush|snowberry|coralberry|bearberry|cranberry|chokeberry|chokecherry|buffaloberry|willow(?! herb)|cornel)\b/i;

// Known Michigan invasive species (scientific names)
const INVASIVES = new Set([
  'Phragmites australis','Lythrum salicaria','Typha angustifolia','Typha × glauca',
  'Lonicera japonica','Lonicera maackii','Lonicera morrowii','Lonicera tatarica',
  'Rhamnus cathartica','Frangula alnus','Berberis thunbergii','Rosa multiflora',
  'Celastrus orbiculatus','Alliaria petiolata','Hesperis matronalis',
  'Linaria vulgaris','Dipsacus fullonum','Dipsacus laciniatus',
  'Cirsium arvense','Cirsium vulgare','Centaurea stoebe','Centaurea jacea',
  'Fallopia japonica','Fallopia sachalinensis','Persicaria perfoliata',
  'Phalaris arundinacea','Miscanthus sinensis','Microstegium vimineum',
  'Paulownia tomentosa','Ailanthus altissima','Morus alba',
  'Pyrus calleryana','Ligustrum vulgare','Ligustrum obtusifolium',
  'Euonymus alatus','Euonymus fortunei',
  'Acer platanoides','Acer pseudoplatanus',
  'Bromus inermis','Bromus tectorum','Bromus sterilis',
  'Myriophyllum spicatum','Hydrocharis morsus-ranae','Najas minor',
  'Potamogeton crispus','Nymphoides peltata','Butomus umbellatus',
  'Carassius auratus','Cyprinus carpio',
  'Hypophthalmichthys nobilis','Hypophthalmichthys molitrix',
  'Neogobius melanostomus','Dreissena polymorpha','Dreissena bugensis',
  'Impatiens parviflora','Impatiens glandulifera',
  'Elodea nuttallii','Cabomba caroliniana',
]);

function inferCategory(taxon) {
  const sci    = taxon.name || '';
  const common = (taxon.preferred_common_name || '').toLowerCase();
  const iconic = taxon.iconic || taxon.iconic_taxon_name || ''; // stored as 'iconic' in byId map
  const family = taxon.family || '';
  const cls    = taxon.taxon_class || '';

  if (INVASIVES.has(sci)) return CAT.invasive;

  const iconicCat = ICONIC_CAT[iconic];
  if (iconicCat !== undefined && iconicCat !== null) return iconicCat;
  // Plants and unknown iconic taxa fall through

  // Class-based rules (mosses, lichens, ferns)
  for (const rule of FAMILY_RULES) {
    if (rule.classes && rule.classes.includes(cls)) return rule.cat;
  }
  // Family-based rules
  for (const rule of FAMILY_RULES) {
    if (rule.families && rule.families.includes(family)) return rule.cat;
  }

  // Plant common-name heuristics
  if (iconic === 'Plantae' || taxon.kingdom === 'Plantae') {
    if (TREE_RE.test(common)  || TREE_RE.test(sci))  return CAT.tree;
    if (SHRUB_RE.test(common) || SHRUB_RE.test(sci)) return CAT.shrub;
    return CAT.herb;
  }

  return CAT.herb; // absolute fallback
}

// ---------------------------------------------------------------------------
// iNaturalist API helpers
// ---------------------------------------------------------------------------
async function inatGet(path, params = {}) {
  const url = new URL(INAT_BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
      if (res.status === 429) { await delay(10000); continue; }
      if (!res.ok) throw new Error(`iNat HTTP ${res.status}: ${url}`);
      return res.json();
    } catch (err) {
      if (attempt === 3) throw err;
      await delay(2000 * attempt);
    }
  }
}

async function fetchSpeciesCountsPage(page) {
  return inatGet('/observations/species_counts', {
    place_id:      PLACE_ID,
    quality_grade: 'research,needs_id',
    lrank:         'species',
    per_page:      PER_PAGE,
    page,
  });
}

async function fetchTaxonDetail(taxonId) {
  try {
    const data = await inatGet(`/taxa/${taxonId}`);
    return data.results?.[0] || null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// GBIF helpers
// ---------------------------------------------------------------------------
async function fetchGbifKey(scientificName) {
  try {
    const url = `${GBIF_BASE}/species/match?name=${encodeURIComponent(scientificName)}&strict=false`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const d = await res.json();
    if (d.matchType === 'NONE') return null;
    return d.usageKey || d.speciesKey || null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`Fetching Michigan species from iNaturalist (place_id=${PLACE_ID})…\n`);

  // ── Phase 1: collect all species from species_counts ──────────────────────
  /** @type {Map<number, object>} inatId → taxon stub */
  const byId = new Map();
  let page = 1;
  let totalResults = Infinity;

  while ((page - 1) * PER_PAGE < totalResults) {
    let data;
    try { data = await fetchSpeciesCountsPage(page); }
    catch (err) {
      console.warn(`  ✗ ${err.message} — skipping`);
      break;
    }

    if (page === 1) {
      totalResults = data.total_results || 0;
      console.log(`  Total species to fetch: ${totalResults}`);
    }

    const results = data.results || [];
    if (!results.length) break;

    for (const entry of results) {
      const t = entry.taxon;
      if (!t || !t.id || t.rank !== 'species') continue;
      if (byId.has(t.id)) continue;
      byId.set(t.id, {
        inatId:    t.id,
        name:      t.name,
        commonName: t.preferred_common_name || null,
        iconic:    t.iconic_taxon_name || '',
        kingdom:   '',
        family:    '',
        taxon_class: '',
        gbifKey:   null,
      });
    }

    process.stdout.write(`\r  Page ${page} / ~${Math.ceil(totalResults / PER_PAGE)}  (${byId.size} species collected)  `);
    page++;
    await delay(250); // stay well under iNat rate limit
  }
  console.log(`\n\nCollected ${byId.size} unique species.`);

  // ── Phase 2: enrich plants & fungi with family/class ─────────────────────
  // We need family to distinguish tree/shrub/herb/grass/fern. Only fetch
  // taxon details for Plantae and Fungi iconic groups.
  const needEnrich = [...byId.values()].filter(s =>
    ['Plantae','Fungi',''].includes(s.iconic) || !s.iconic
  );

  console.log(`\nEnriching ${needEnrich.length} taxa with family/class details…`);
  let enriched = 0;

  // Batch into groups of 30 and use the /taxa endpoint with id= filter for speed
  const BATCH = 30;
  for (let i = 0; i < needEnrich.length; i += BATCH) {
    const batch = needEnrich.slice(i, i + BATCH);
    const ids = batch.map(s => s.inatId).join(',');
    try {
      const data = await inatGet('/taxa', { id: ids, per_page: BATCH });
      for (const t of (data.results || [])) {
        const sp = byId.get(t.id);
        if (!sp) continue;
        const ancestors = t.ancestors || [];
        const famAnc   = ancestors.find(a => a.rank === 'family');
        const clsAnc   = ancestors.find(a => a.rank === 'class');
        if (famAnc) sp.family      = famAnc.name;
        if (clsAnc) sp.taxon_class = clsAnc.name;
        if (!sp.commonName && t.preferred_common_name) sp.commonName = t.preferred_common_name;
        if (!sp.kingdom) {
          const kingAnc = ancestors.find(a => a.rank === 'kingdom');
          if (kingAnc) sp.kingdom = kingAnc.name;
        }
      }
      enriched += batch.length;
    } catch { /* skip batch on error */ }
    process.stdout.write(`\r  Enriched ${Math.min(enriched, needEnrich.length)} / ${needEnrich.length}  `);
    await delay(300);
  }
  console.log('\n  Done enriching.');

  // ── Phase 3 (optional): fetch GBIF keys ──────────────────────────────────
  if (WITH_GBIF) {
    const all = [...byId.values()];
    console.log(`\nResolving GBIF keys for ${all.length} species (this will take a while)…`);
    let resolved = 0;
    for (const sp of all) {
      const key = await fetchGbifKey(sp.name);
      if (key) { sp.gbifKey = key; resolved++; }
      await delay(120);
      if (resolved % 200 === 0 && resolved > 0)
        process.stdout.write(`\r  Resolved ${resolved} GBIF keys…  `);
    }
    console.log(`\n  Resolved ${resolved} / ${all.length} GBIF keys.`);
  }

  // ── Build final rows ──────────────────────────────────────────────────────
  const rows = [];
  for (const sp of byId.values()) {
    const catIdx = inferCategory(sp);
    rows.push([
      sp.inatId,
      sp.gbifKey,          // null if not resolved
      sp.name,
      sp.commonName || sp.name,
      catIdx,
      sp.family || '',
    ]);
  }

  rows.sort((a, b) => a[4] - b[4] || a[2].localeCompare(b[2]));

  // Category summary
  const counts = new Array(SPECIES_CATS.length).fill(0);
  for (const r of rows) counts[r[4]]++;
  console.log('\nCategory breakdown:');
  SPECIES_CATS.forEach((c, i) => {
    if (counts[i]) console.log(`  ${c.padEnd(14)} ${counts[i]}`);
  });
  console.log(`  ${'TOTAL'.padEnd(14)} ${rows.length}`);

  // ── Write output ──────────────────────────────────────────────────────────
  mkdirSync(dirname(OUT_FILE), { recursive: true });

  const out = `// AUTO-GENERATED — do not edit by hand.
// Source: iNaturalist Observations API — Michigan (place_id=${PLACE_ID})${WITH_GBIF ? ' + GBIF species/match' : ''}
// Generated: ${new Date().toISOString()}
// Species: ${rows.length}
// Regenerate: node scripts/fetch-inaturalist-species.js
// With GBIF keys: node scripts/fetch-inaturalist-species.js --with-gbif
//
// Row format: [inatId, gbifKey|null, scientificName, commonName, catIndex, family]
// catIndex maps to SPECIES_CATS in modules/species.js:
//   0=tree  1=shrub  2=herb  3=grass  4=fern  5=moss  6=fungus  7=lichen
//   8=bird  9=mammal  10=herp  11=fish  12=invertebrate  13=invasive
const MICHIGAN_SPECIES = ${JSON.stringify(rows)};
`;

  writeFileSync(OUT_FILE, out, 'utf8');
  const kb = (out.length / 1024).toFixed(0);
  console.log(`\nWrote ${rows.length} species → ${OUT_FILE} (${kb} KB)`);
  if (!WITH_GBIF) {
    console.log('Tip: run with --with-gbif to also resolve GBIF taxon keys (needed for DwC export).');
  }
}

main().catch(err => { console.error('\nFatal:', err); process.exit(1); });
