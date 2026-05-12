#!/usr/bin/env node
/**
 * recategorize-species.js
 *
 * Fixes data/michigan-species.js where all species landed in 'herb'
 * because the original fetch didn't store iconic_taxon_name correctly.
 *
 * Fetches iconic_taxon_name for all species from iNat in batches of 200,
 * re-runs category inference, and rewrites the file in-place.
 *
 * Usage: node scripts/recategorize-species.js
 * Time:  ~2 minutes (batched API calls, 300ms between batches)
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = resolve(__dirname, '../data/michigan-species.js');
const INAT_BASE = 'https://api.inaturalist.org/v1';
const BATCH = 200;
const delay = ms => new Promise(r => setTimeout(r, ms));

// ── Category tables (must match modules/species.js) ──────────────────────

const SPECIES_CATS = [
  'tree','shrub','herb','grass','fern','moss','fungus','lichen',
  'bird','mammal','herp','fish','invertebrate','invasive',
];
const CAT = Object.fromEntries(SPECIES_CATS.map((c, i) => [c, i]));

const ICONIC_CAT = {
  'Aves':           CAT.bird,
  'Mammalia':       CAT.mammal,
  'Reptilia':       CAT.herp,
  'Amphibia':       CAT.herp,
  'Actinopterygii': CAT.fish,
  'Insecta':        CAT.invertebrate,
  'Arachnida':      CAT.invertebrate,
  'Mollusca':       CAT.invertebrate,
  'Animalia':       CAT.invertebrate,
  'Fungi':          CAT.fungus,
  'Chromista':      CAT.herb,
  'Protozoa':       CAT.herb,
  'Bacteria':       CAT.herb,
  // 'Plantae' → null, falls through to family/name heuristics below
};

const GRASS_FAM   = new Set(['Poaceae','Cyperaceae','Juncaceae','Typhaceae','Sparganiaceae','Eriocaulaceae']);
const FERN_FAM    = new Set(['Polypodiaceae','Dryopteridaceae','Athyriaceae','Aspleniaceae','Thelypteridaceae',
                              'Equisetaceae','Lycopodiaceae','Selaginellaceae','Osmundaceae','Ophioglossaceae',
                              'Marsileaceae','Azollaceae','Salviniaceae','Dennstaedtiaceae','Woodsiaceae',
                              'Blechnaceae','Onocleaceae','Cystopteridaceae']);
const MOSS_CLS    = new Set(['Bryopsida','Sphagnopsida','Andreaeopsida','Hepaticopsida','Marchantiopsida',
                              'Anthocerotopsida','Polytrichopsida','Tetraphidopsida']);
const LICHEN_CLS  = new Set(['Lecanoromycetes','Lichinomycetes','Arthoniomycetes','Dothideomycetes']);
const CONIFER_FAM = new Set(['Pinaceae','Cupressaceae','Taxaceae']);
const AQUATIC_FAM = new Set(['Potamogetonaceae','Nymphaeaceae','Lemnaceae','Ceratophyllaceae',
                              'Hydrocharitaceae','Haloragaceae','Najadaceae']);

const TREE_RE  = /\b(tree|oak|maple|elm|ash|birch|pine|spruce|fir|cedar|hemlock|hickory|walnut|basswood|tulip|cherry|crabapple|plum|cottonwood|aspen|beech|sycamore|locust|catalpa|larch|tamarack|buckeye|chestnut|ironwood|hackberry|sassafras|magnolia|sweetgum|pawpaw|butternut|coffeetree)\b/i;
const SHRUB_RE = /\b(shrub|bush|blueberry|huckleberry|serviceberry|viburnum|dogwood|alder|buttonbush|elderberry|gooseberry|currant|raspberry|blackberry|rose|hawthorn|spirea|ninebark|leatherwood|leatherleaf|bog rosemary|labrador tea|sheep laurel|bog laurel|swamp rose|meadowsweet|steeplebush|snowberry|coralberry|bearberry|cranberry|chokeberry|chokecherry|buffaloberry|willow(?! herb))\b/i;

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
  'Euonymus alatus','Euonymus fortunei','Acer platanoides','Acer pseudoplatanus',
  'Bromus inermis','Bromus tectorum','Bromus sterilis',
  'Myriophyllum spicatum','Hydrocharis morsus-ranae','Najas minor',
  'Potamogeton crispus','Nymphoides peltata','Butomus umbellatus',
  'Carassius auratus','Cyprinus carpio',
  'Neogobius melanostomus','Dreissena polymorpha','Dreissena bugensis',
  'Impatiens parviflora','Impatiens glandulifera',
]);

function inferCategory(sci, common, iconic, family, cls) {
  if (INVASIVES.has(sci)) return CAT.invasive;

  const iconicCat = ICONIC_CAT[iconic];
  if (iconicCat !== undefined && iconicCat !== null) return iconicCat;

  // Plantae / unknown iconic — use family, class, then name heuristics
  if (MOSS_CLS.has(cls))    return CAT.moss;
  if (LICHEN_CLS.has(cls))  return CAT.lichen;
  if (GRASS_FAM.has(family))  return CAT.grass;
  if (FERN_FAM.has(family))   return CAT.fern;
  if (CONIFER_FAM.has(family)) return CAT.tree;
  if (AQUATIC_FAM.has(family)) return CAT.herb;

  const c = (common || '').toLowerCase();
  if (TREE_RE.test(c)  || TREE_RE.test(sci))  return CAT.tree;
  if (SHRUB_RE.test(c) || SHRUB_RE.test(sci)) return CAT.shrub;

  return CAT.herb;
}

// ── Parse existing file ───────────────────────────────────────────────────

async function main() {
  console.log(`Reading ${DATA_FILE}…`);
  const content = readFileSync(DATA_FILE, 'utf8');

  // Extract the JSON array after the const declaration
  const declIdx   = content.indexOf('const MICHIGAN_SPECIES = ');
  if (declIdx === -1) throw new Error('Could not find MICHIGAN_SPECIES declaration');
  const jsonStart = content.indexOf('[', declIdx);
  const jsonEnd   = content.lastIndexOf(']') + 1;
  if (jsonStart === -1) throw new Error('Could not find JSON array in file');
  const rows = JSON.parse(content.slice(jsonStart, jsonEnd));
  console.log(`Loaded ${rows.length} species.`);

  // Build inatId → row index map (skip rows with inatId 0)
  const idToIdx = new Map();
  for (let i = 0; i < rows.length; i++) {
    const inatId = rows[i][0];
    if (inatId && inatId > 0) idToIdx.set(inatId, i);
  }

  const validIds = [...idToIdx.keys()];
  const totalBatches = Math.ceil(validIds.length / BATCH);
  console.log(`\nFetching iconic_taxon_name for ${validIds.length} taxa`);
  console.log(`(${totalBatches} batches × ${BATCH}, ~${Math.round(totalBatches * 0.3)}s)…\n`);

  let done = 0;
  let iconicMap = new Map(); // inatId → iconic_taxon_name

  for (let i = 0; i < validIds.length; i += BATCH) {
    const batch = validIds.slice(i, i + BATCH);
    try {
      const url = `${INAT_BASE}/taxa?id=${batch.join(',')}&per_page=${BATCH}&fields=id,iconic_taxon_name`;
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const data = await res.json();
        for (const t of (data.results || [])) {
          iconicMap.set(t.id, t.iconic_taxon_name || '');
        }
      }
    } catch (err) {
      // Skip batch on error, iconic will remain '' → plant heuristics
    }
    done += batch.length;
    process.stdout.write(`\r  Fetched ${done} / ${validIds.length}  (${iconicMap.size} resolved)  `);
    await delay(300);
  }
  console.log('\n  Done fetching.\n');

  // Re-categorize all rows
  for (const row of rows) {
    const inatId = row[0];
    const sci    = row[2];
    const common = row[3];
    const family = row[5] || '';
    const iconic = inatId ? (iconicMap.get(inatId) || '') : '';
    row[4] = inferCategory(sci, common, iconic, family, '');
  }

  // Re-sort: category then scientific name
  rows.sort((a, b) => a[4] - b[4] || a[2].localeCompare(b[2]));

  // Category summary
  const counts = new Array(SPECIES_CATS.length).fill(0);
  for (const r of rows) counts[r[4]]++;
  console.log('Category breakdown:');
  SPECIES_CATS.forEach((c, i) => { if (counts[i]) console.log(`  ${c.padEnd(14)} ${counts[i]}`); });
  console.log(`  ${'TOTAL'.padEnd(14)} ${rows.length}`);

  // Rebuild file — preserve the header comment, replace array
  const headerEnd = content.indexOf('const MICHIGAN_SPECIES');
  const header = content.slice(0, headerEnd);
  const out = header + `const MICHIGAN_SPECIES = ${JSON.stringify(rows)};\n`;
  writeFileSync(DATA_FILE, out, 'utf8');
  console.log(`\nWrote ${rows.length} species → ${DATA_FILE} (${(out.length / 1024).toFixed(0)} KB)`);
}

main().catch(err => { console.error('\nFatal:', err); process.exit(1); });
