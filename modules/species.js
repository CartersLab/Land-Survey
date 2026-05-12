/**
 * modules/species.js
 *
 * Provides species search (offline via Fuse.js + MICHIGAN_SPECIES,
 * online via GBIF suggest), cache management, and normalization.
 *
 * Depends on: config.js, core/db.js, core/utils.js, data/michigan-species.js
 * Depends on CDN: Fuse.js
 */
const Species = (() => {
  // Must match row indices in data/michigan-species.js and fetch scripts.
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
    'herp',         // 10
    'fish',         // 11
    'invertebrate', // 12
    'invasive',     // 13
  ];

  // Maps observation form category → species category indices to allow in search
  const OBS_CAT_FILTER = {
    'tree':             [0],
    'shrub':            [1],
    'herbaceous':       [2],
    'grass-sedge-rush': [3],
    'fern-moss-lichen': [4, 5, 7],
    'fungus':           [6],
    'invasive':         [13],
    'bird':             [8],
    'mammal':           [9],
    'reptile':          [10],
    'amphibian':        [10],
    'fish':             [11],
    'invertebrate':     [12],
    'sign-evidence':    null,   // null = no filter
  };

  // observation category → GBIF kingdom for online search filter
  const OBS_CAT_KINGDOM = {
    'tree':             'Plantae',
    'shrub':            'Plantae',
    'herbaceous':       'Plantae',
    'grass-sedge-rush': 'Plantae',
    'fern-moss-lichen': 'Plantae',
    'invasive':         'Plantae',
    'fungus':           'Fungi',
    'bird':             'Animalia',
    'mammal':           'Animalia',
    'reptile':          'Animalia',
    'amphibian':        'Animalia',
    'fish':             'Animalia',
    'invertebrate':     'Animalia',
  };

  // ── Lazy Fuse index ──────────────────────────────────────────────────────

  let _fuse = null;
  let _rows  = null;   // MICHIGAN_SPECIES rows as objects, built once

  function _getRows() {
    if (_rows) return _rows;
    if (typeof MICHIGAN_SPECIES === 'undefined' || !MICHIGAN_SPECIES.length) return [];
    _rows = MICHIGAN_SPECIES.map(r => ({
      inatId:         r[0] || 0,
      gbifKey:        r[1] || null,
      scientificName: r[2],
      commonName:     r[3] || r[2],
      category:       SPECIES_CATS[r[4]] || 'herb',
      catIdx:         r[4],
      family:         r[5] || '',
    }));
    return _rows;
  }

  function _getFuse() {
    if (_fuse) return _fuse;
    const rows = _getRows();
    _fuse = new Fuse(rows, {
      keys: [
        { name: 'commonName',     weight: 0.65 },
        { name: 'scientificName', weight: 0.35 },
      ],
      threshold:          0.35,
      minMatchCharLength: 2,
      includeScore:       true,
      shouldSort:         true,
    });
    return _fuse;
  }

  function _filterByCat(results, obsCategory) {
    if (!obsCategory) return results;
    const allowed = OBS_CAT_FILTER[obsCategory];
    if (allowed === null || allowed === undefined) return results;
    return results.filter(r => allowed.includes(r.catIdx));
  }

  // ── Public: offline search ───────────────────────────────────────────────

  /**
   * Search the local MICHIGAN_SPECIES list using Fuse.js.
   * @param {string} query
   * @param {string|null} obsCategory  — observation category from form
   * @returns {Array} up to MAX_SUGGEST_RESULTS normalized records
   */
  function searchOffline(query, obsCategory) {
    let results;
    if (query && query.trim().length >= 2) {
      results = _getFuse().search(query.trim()).map(r => r.item);
    } else {
      results = _getRows();
    }
    results = _filterByCat(results, obsCategory);
    return results.slice(0, CONFIG.GBIF.MAX_SUGGEST_RESULTS);
  }

  // ── Public: recent species (from IndexedDB cache) ─────────────────────────

  /**
   * Load top-N most recently / frequently used species from speciesCache.
   * @param {number} limit
   * @returns {Promise<Array>}
   */
  async function getRecent(limit = 10) {
    try {
      const all = await DB.getAll('speciesCache');
      all.sort((a, b) => (b.useCount || 0) - (a.useCount || 0));
      return all.slice(0, limit);
    } catch { return []; }
  }

  // ── Public: online GBIF suggest ──────────────────────────────────────────

  /**
   * Query GBIF suggest API.
   * @param {string} query
   * @param {string|null} obsCategory
   * @returns {Promise<Array>} normalized records
   */
  async function searchOnline(query, obsCategory) {
    if (!query || query.trim().length < 2) return [];
    const url = new URL(CONFIG.GBIF.SUGGEST_URL);
    url.searchParams.set('q', query.trim());
    url.searchParams.set('limit', String(CONFIG.GBIF.MAX_SUGGEST_RESULTS));
    const kingdom = OBS_CAT_KINGDOM[obsCategory];
    if (kingdom) url.searchParams.set('kingdom', kingdom);

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`GBIF suggest ${res.status}`);
    const data = await res.json();
    return data
      .filter(item => item.key && (item.scientificName || item.canonicalName))
      .map(item => normalizeGbifSuggest(item));
  }

  // ── Public: fetch full GBIF record and cache it ──────────────────────────

  /**
   * Fetch full GBIF species record and store in speciesCache.
   * Increments useCount on cache hit.
   * @param {number} gbifKey
   * @returns {Promise<object|null>}
   */
  async function fetchAndCache(gbifKey) {
    if (!gbifKey) return null;
    try {
      const existing = await DB.get('speciesCache', gbifKey);
      if (existing) {
        existing.lastUsed = now();
        existing.useCount = (existing.useCount || 0) + 1;
        await DB.put('speciesCache', existing);
        return existing;
      }
      const res = await fetch(
        `${CONFIG.GBIF.LOOKUP_URL}/${gbifKey}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) return null;
      const d = await res.json();
      const record = {
        gbifKey:        d.key || d.usageKey || gbifKey,
        scientificName: d.canonicalName || d.scientificName,
        canonicalName:  d.canonicalName || d.scientificName,
        commonName:     d.vernacularName || d.canonicalName || d.scientificName,
        rank:           d.rank || 'SPECIES',
        kingdom:        d.kingdom || null,
        phylum:         d.phylum  || null,
        class:          d.class   || null,
        order:          d.order   || null,
        family:         d.family  || null,
        genus:          d.genus   || null,
        lastUsed:       now(),
        useCount:       1,
      };
      await DB.put('speciesCache', record);
      return record;
    } catch { return null; }
  }

  /**
   * Bump useCount for a gbifKey already in the cache.
   */
  async function recordUse(gbifKey) {
    if (!gbifKey) return;
    try {
      const rec = await DB.get('speciesCache', gbifKey);
      if (rec) {
        rec.lastUsed = now();
        rec.useCount = (rec.useCount || 0) + 1;
        await DB.put('speciesCache', rec);
      }
    } catch {}
  }

  /**
   * Store a species chosen from the offline local list (may have no GBIF key).
   * Uses a negative inatId as a temporary key until GBIF resolves it.
   * @returns {Promise<object>} cached record
   */
  async function cacheOfflineSelection(inatId, scientificName, commonName, family) {
    const tempKey = inatId ? -(Math.abs(inatId)) : null;
    const existing = tempKey ? await DB.get('speciesCache', tempKey) : null;
    const record = {
      gbifKey:        existing?.gbifKey ?? tempKey,
      inatId:         inatId || null,
      scientificName,
      canonicalName:  scientificName,
      commonName:     commonName || scientificName,
      rank:           'SPECIES',
      kingdom:        null,
      phylum:         null,
      class:          null,
      order:          null,
      family:         family || null,
      genus:          scientificName.split(' ')[0] || null,
      lastUsed:       now(),
      useCount:       (existing?.useCount || 0) + 1,
      needsGbifLookup: true,
    };
    if (record.gbifKey) await DB.put('speciesCache', record);
    return record;
  }

  /**
   * When app comes online, attempt to resolve any speciesCache records
   * flagged needsGbifLookup. Fire-and-forget — safe to call on reconnect.
   */
  async function resolveOfflineKeys() {
    if (!navigator.onLine) return;
    try {
      const all = await DB.getAll('speciesCache');
      const pending = all.filter(r => r.needsGbifLookup && r.scientificName);
      for (const rec of pending) {
        try {
          const url = new URL(CONFIG.GBIF.MATCH_URL);
          url.searchParams.set('name', rec.scientificName);
          const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
          if (!res.ok) continue;
          const d = await res.json();
          if (d.matchType === 'NONE') continue;
          const newKey = d.usageKey || d.speciesKey;
          if (!newKey) continue;
          const updated = {
            gbifKey:        newKey,
            inatId:         rec.inatId,
            scientificName: d.canonicalName || d.scientificName || rec.scientificName,
            canonicalName:  d.canonicalName || rec.scientificName,
            commonName:     d.vernacularName || rec.commonName,
            rank:           d.rank || 'SPECIES',
            kingdom:        d.kingdom || null,
            phylum:         d.phylum  || null,
            class:          d.class   || null,
            order:          d.order   || null,
            family:         d.family  || null,
            genus:          d.genus   || null,
            lastUsed:       rec.lastUsed,
            useCount:       rec.useCount,
            needsGbifLookup: false,
          };
          await DB.put('speciesCache', updated);
          // Remove old temp record if key changed
          if (rec.gbifKey && rec.gbifKey !== newKey) {
            await DB.delete('speciesCache', rec.gbifKey);
          }
        } catch {}
        await new Promise(r => setTimeout(r, 200));
      }
    } catch {}
  }

  // ── Normalization helpers ────────────────────────────────────────────────

  function normalizeGbifSuggest(item) {
    return {
      gbifKey:        item.key || item.usageKey || item.speciesKey,
      scientificName: item.canonicalName || item.scientificName,
      commonName:     item.vernacularName || item.canonicalName || item.scientificName,
      rank:           item.rank || 'SPECIES',
      kingdom:        item.kingdom || null,
      phylum:         item.phylum  || null,
      class:          item.clazz || item.class || null,
      order:          item.order  || null,
      family:         item.family || null,
      genus:          item.genus  || null,
    };
  }

  /**
   * Build the observation taxonomy fields from a species cache record.
   * Call this when saving an observation.
   */
  function toObservationFields(rec) {
    if (!rec) return {};
    return {
      gbifKey:       rec.gbifKey,
      scientificName: rec.scientificName || rec.canonicalName,
      commonName:     rec.commonName || rec.scientificName,
      gbifRank:      rec.rank    || 'SPECIES',
      gbifKingdom:   rec.kingdom || null,
      gbifPhylum:    rec.phylum  || null,
      gbifClass:     rec.class   || null,
      gbifOrder:     rec.order   || null,
      gbifFamily:    rec.family  || null,
      gbifGenus:     rec.genus   || (rec.scientificName?.split(' ')[0] ?? null),
      inatId:        rec.inatId  || null,
    };
  }

  // Expose SPECIES_CATS so other modules can reference it
  return {
    SPECIES_CATS,
    searchOffline,
    searchOnline,
    getRecent,
    fetchAndCache,
    recordUse,
    cacheOfflineSelection,
    resolveOfflineKeys,
    toObservationFields,
  };
})();
