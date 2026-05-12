#!/usr/bin/env node
/**
 * fetch-michigan-species.js
 *
 * Pulls species observed in Michigan from the GBIF occurrence API,
 * deduplicates by gbifKey, infers category from taxonomic rank,
 * and writes data/michigan-species.js.
 *
 * Requirements: Node 18+ (built-in fetch)
 * Usage:        node scripts/fetch-michigan-species.js
 * Output:       data/michigan-species.js
 *
 * GBIF rate-limit is ~10 req/s for anonymous calls; we add a 150ms
 * delay between pages and a 500ms delay between taxon groups.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = resolve(__dirname, '../data/michigan-species.js');

// ---------------------------------------------------------------------------
// Category inference rules — checked in order, first match wins.
// Each rule: { test(hit) => bool, category }
// ---------------------------------------------------------------------------
const CATEGORY_RULES = [
  // ── Fungi / Lichens ──────────────────────────────────────────────────────
  { category: 'lichen',      test: h => /Lecanoromycetes|Lecideales|Graphidales|Lichenized|Licheni/i.test(h.class || '') },
  { category: 'fungus',      test: h => h.kingdom === 'Fungi' },

  // ── Plants ───────────────────────────────────────────────────────────────
  // Grasses / sedges / rushes
  { category: 'grass',       test: h => ['Poaceae','Cyperaceae','Juncaceae'].includes(h.family) },
  // Ferns & allies
  { category: 'fern',        test: h => ['Polypodiopsida','Equisetopsida','Lycopodiopsida','Marattiopsida'].includes(h.class) },
  // Mosses / liverworts / hornworts
  { category: 'moss',        test: h => ['Bryopsida','Sphagnopsida','Andreaeopsida','Hepaticopsida','Marchantiopsida','Anthocerotopsida'].includes(h.class) },
  // Aquatic / wetland indicators — families before tree/shrub/herb
  { category: 'herb',        test: h => ['Potamogetonaceae','Nymphaeaceae','Lemnaceae','Ceratophyllaceae','Sparganiaceae','Typhaceae','Hydrocharitaceae','Haloragaceae'].includes(h.family) },
  // Conifer trees
  { category: 'tree',        test: h => ['Pinaceae','Cupressaceae','Taxaceae'].includes(h.family) },
  // Hardwood tree families
  { category: 'tree',        test: h => ['Fagaceae','Betulaceae','Juglandaceae','Ulmaceae','Aceraceae','Sapindaceae','Oleaceae','Tiliaceae','Malvaceae','Platanaceae','Magnoliaceae'].includes(h.family) && /tree/i.test(h.vernacularName || '') },
  // If common name contains "tree" or "oak" etc, mark tree
  { category: 'tree',        test: h => h.kingdom === 'Plantae' && /\b(tree|oak|maple|elm|ash|birch|pine|spruce|fir|cedar|hemlock|hickory|walnut|basswood|tulip|cherry|apple|plum|cottonwood|aspen|beech|sycamore|locust|catalpa|larch|tamarack)\b/i.test(h.vernacularName || '') },
  // Shrubs
  { category: 'shrub',       test: h => h.kingdom === 'Plantae' && /\b(shrub|bush|thicket|blueberry|serviceberry|viburnum|dogwood|alder|buttonbush|elderberry|gooseberry|currant|raspberry|blackberry|rose|hawthorn|spirea|ninebark|leadplant|indigo bush|willow herb|leatherwood|leatherleaf|bog rosemary|Labrador tea|sheep laurel|bog laurel|swamp rose|meadowsweet|steeplebush)\b/i.test(h.vernacularName || '') },
  // Remaining vascular plants → herb
  { category: 'herb',        test: h => h.kingdom === 'Plantae' && ['Tracheophyta','Magnoliopsida','Liliopsida','Polypodiopsida'].includes(h.phylum || h.class) },
  { category: 'herb',        test: h => h.kingdom === 'Plantae' },

  // ── Animals ──────────────────────────────────────────────────────────────
  { category: 'bird',        test: h => h.class === 'Aves' },
  { category: 'herp',        test: h => ['Reptilia','Amphibia'].includes(h.class) },
  { category: 'mammal',      test: h => h.class === 'Mammalia' },
  { category: 'fish',        test: h => ['Actinopterygii','Petromyzontida','Chondrichthyes','Sarcopterygii'].includes(h.class) },
  { category: 'invertebrate',test: h => ['Insecta','Arachnida','Malacostraca','Gastropoda','Bivalvia','Clitellata','Diplopoda','Chilopoda'].includes(h.class) },

  // Fallback
  { category: 'herb',        test: () => true },
];

function inferCategory(hit) {
  for (const rule of CATEGORY_RULES) {
    if (rule.test(hit)) return rule.category;
  }
  return 'herb';
}

// ---------------------------------------------------------------------------
// Known invasive species GBIF keys / partial name matches.
// We tag these after category assignment.
// ---------------------------------------------------------------------------
const INVASIVE_NAMES = new Set([
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
  'Impatiens parviflora','Impatiens glandulifera',
  'Swallenia alexandrae', // placeholder
  'Acer platanoides','Acer pseudoplatanus',
  'Bromus inermis','Bromus tectorum',
  'Carduus acanthoides','Carduus nutans',
  'Lepidium draba','Cardaria draba',
  'Myriophyllum spicatum','Hydrocharis morsus-ranae','Najas minor',
  'Potamogeton crispus','Nymphoides peltata','Butomus umbellatus',
  'Carassius auratus','Cyprinus carpio','Hypophthalmichthys nobilis','Hypophthalmichthys molitrix',
  'Neogobius melanostomus','Dreissena polymorpha','Dreissena bugensis',
  'Hemimysis anomala',
]);

function isInvasive(hit) {
  return INVASIVE_NAMES.has(hit.species || '') || INVASIVE_NAMES.has(hit.canonicalName || '');
}

// ---------------------------------------------------------------------------
// GBIF taxon group queries — (taxonKey, label) pairs.
// taxonKey values are stable GBIF backbone keys.
// ---------------------------------------------------------------------------
const TAXON_GROUPS = [
  // Plants
  { key: 6,       label: 'Plants (Plantae)' },
  // Fungi
  { key: 5,       label: 'Fungi' },
  // Animalia groups
  { key: 212,     label: 'Birds (Aves)' },
  { key: 359,     label: 'Mammals' },
  { key: 131,     label: 'Reptiles' },
  { key: 131,     label: 'Amphibians' }, // will dedupe
  { key: 204,     label: 'Amphibians (Amphibia)' },
  { key: 204,     label: 'Reptilia' },   // dedupe handles it
  { key: 11418114,label: 'Ray-finned Fish (Actinopterygii)' },
  { key: 216,     label: 'Insects' },
  { key: 367,     label: 'Arachnids' },
  { key: 225,     label: 'Mollusks' },
  { key: 226,     label: 'Crustaceans' },
  { key: 50,      label: 'Mosses (Bryophyta)' },
  { key: 49,      label: 'Lichens (Ascomycota)' },
];

// Deduplicate group keys
const UNIQUE_GROUPS = [];
const _seenKeys = new Set();
for (const g of TAXON_GROUPS) {
  if (!_seenKeys.has(g.key)) { _seenKeys.add(g.key); UNIQUE_GROUPS.push(g); }
}

// ---------------------------------------------------------------------------
// GBIF fetch helpers
// ---------------------------------------------------------------------------
const BASE = 'https://api.gbif.org/v1';
const delay = ms => new Promise(r => setTimeout(r, ms));

async function fetchPage(taxonKey, offset, limit = 300) {
  const url = new URL(`${BASE}/occurrence/search`);
  url.searchParams.set('country', 'US');
  url.searchParams.set('stateProvince', 'Michigan');
  url.searchParams.set('taxonKey', taxonKey);
  url.searchParams.set('hasCoordinate', 'true');
  url.searchParams.set('occurrenceStatus', 'PRESENT');
  url.searchParams.set('fields', 'speciesKey,species,canonicalName,vernacularName,kingdom,phylum,class,order,family,genus,taxonRank');
  url.searchParams.set('limit', limit);
  url.searchParams.set('offset', offset);

  const res = await fetch(url.toString(), {
    headers: { 'Accept': 'application/json' }
  });
  if (!res.ok) throw new Error(`GBIF ${res.status}: ${url}`);
  return res.json();
}

async function fetchVernacular(speciesKey) {
  try {
    const res = await fetch(`${BASE}/species/${speciesKey}/vernacularNames?limit=5`);
    if (!res.ok) return null;
    const data = await res.json();
    const en = data.results?.find(v => v.language === 'eng' && v.vernacularName);
    return en?.vernacularName || null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('Fetching Michigan species from GBIF…\n');

  /** @type {Map<number, Object>} gbifKey → species record */
  const byKey = new Map();

  for (const group of UNIQUE_GROUPS) {
    console.log(`  → ${group.label}`);
    let offset = 0;
    let total = Infinity;
    let pageCount = 0;

    while (offset < total && offset < 6000) { // cap at 6000 per group to stay sane
      let data;
      try {
        data = await fetchPage(group.key, offset, 300);
      } catch (err) {
        console.warn(`    ✗ ${err.message} — skipping page`);
        break;
      }

      total = data.count || 0;
      const results = data.results || [];

      for (const hit of results) {
        if (!hit.speciesKey || !hit.species) continue;
        if (byKey.has(hit.speciesKey)) continue; // already seen

        byKey.set(hit.speciesKey, {
          gbifKey:        hit.speciesKey,
          scientificName: hit.species,
          canonicalName:  hit.canonicalName || hit.species,
          commonName:     hit.vernacularName || null, // may be null; enriched below
          kingdom:        hit.kingdom || '',
          phylum:         hit.phylum || '',
          class:          hit.class || '',
          order:          hit.order || '',
          family:         hit.family || '',
          genus:          hit.genus || '',
        });
      }

      offset += results.length || 300;
      pageCount++;
      process.stdout.write(`\r    offset ${offset}/${total} (${byKey.size} unique so far)   `);
      await delay(150);
    }
    console.log(`\n    done (${pageCount} pages)`);
    await delay(500);
  }

  console.log(`\nTotal unique species: ${byKey.size}`);

  // ── Enrich missing common names ─────────────────────────────────────────
  const needNames = [...byKey.values()].filter(s => !s.commonName);
  console.log(`Fetching vernacular names for ${needNames.length} species…`);
  let enriched = 0;
  for (const sp of needNames) {
    const name = await fetchVernacular(sp.gbifKey);
    if (name) { sp.commonName = name; enriched++; }
    await delay(80);
    if (enriched % 50 === 0) process.stdout.write(`\r  enriched ${enriched}/${needNames.length}   `);
  }
  console.log(`\nEnriched ${enriched} names.`);

  // ── Build final records ──────────────────────────────────────────────────
  const records = [];
  for (const sp of byKey.values()) {
    const category  = inferCategory(sp);
    const invasive  = isInvasive(sp);

    records.push({
      gbifKey:        sp.gbifKey,
      scientificName: sp.canonicalName || sp.scientificName,
      commonName:     sp.commonName || sp.canonicalName || sp.scientificName,
      category:       invasive ? 'invasive' : category,
      family:         sp.family || '',
      order:          sp.order  || '',
      class:          sp.class  || '',
      isRare:         false,   // manual curation needed; start false
    });
  }

  // Sort: category, then scientificName
  records.sort((a, b) =>
    a.category.localeCompare(b.category) || a.scientificName.localeCompare(b.scientificName)
  );

  // ── Summary ──────────────────────────────────────────────────────────────
  const catCounts = {};
  for (const r of records) catCounts[r.category] = (catCounts[r.category] || 0) + 1;
  console.log('\nCategory breakdown:');
  for (const [cat, n] of Object.entries(catCounts).sort()) {
    console.log(`  ${cat.padEnd(14)} ${n}`);
  }
  console.log(`  ${'TOTAL'.padEnd(14)} ${records.length}`);

  // ── Write output file ────────────────────────────────────────────────────
  mkdirSync(dirname(OUT_FILE), { recursive: true });

  const json = JSON.stringify(records, null, 2);
  const js = `// AUTO-GENERATED by scripts/fetch-michigan-species.js
// Source: GBIF Occurrence API — Michigan, US
// Generated: ${new Date().toISOString()}
// Total records: ${records.length}
// To regenerate: node scripts/fetch-michigan-species.js

const MICHIGAN_SPECIES = ${json};
`;

  writeFileSync(OUT_FILE, js, 'utf8');
  console.log(`\nWrote ${records.length} species to:\n  ${OUT_FILE}`);
}

main().catch(err => { console.error(err); process.exit(1); });
