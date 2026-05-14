const Clusters = (() => {
  const RADIUS_M  = CONFIG.MAP.CLUSTER_RADIUS_METERS;
  const MIN_COUNT = CONFIG.MAP.CLUSTER_MIN_COUNT;

  const PLANT_CATS = new Set([
    'tree', 'shrub', 'herbaceous', 'grass-sedge-rush',
    'fern-moss-lichen', 'fungus', 'invasive',
  ]);

  // ── Real-time check after a single obs is saved ───────────────────────────

  async function checkForClusters(surveyId, newObs) {
    if (!newObs.gbifKey) return;
    if (!PLANT_CATS.has(newObs.category)) return;
    if (newObs.standId) return;
    if (!newObs.lat || !newObs.lng) return;

    try {
      // Use the same range/count the user configured in scan settings so
      // real-time detection and manual scan behave identically.
      let rangeM   = RADIUS_M;
      let minCount = MIN_COUNT;
      try {
        const saved = await DB.getRaw('appSettings', 'clusterScanSettings');
        if (saved) {
          const rule = saved.perSpecies?.find(r => r.gbifKey === newObs.gbifKey);
          rangeM   = rule?.rangeM   ?? saved.rangeM   ?? rangeM;
          minCount = rule?.minCount ?? saved.minCount ?? minCount;
        }
      } catch {}

      const [allObs, stands] = await Promise.all([
        DB.getAllByIndex('observations', 'surveyId', surveyId),
        DB.getAllByIndex('stands',       'surveyId', surveyId),
      ]);

      // Check if the new obs is within range of an existing same-species cluster
      const nearbyStand = stands.find(s => {
        if (s.primaryGbifKey !== newObs.gbifKey) return false;
        const members = allObs.filter(o => o.standId === s.id && o.lat && o.lng);
        return members.some(m => distanceMeters(newObs.lat, newObs.lng, m.lat, m.lng) <= rangeM);
      });

      if (nearbyStand) {
        _promptAddToStand(surveyId, newObs, nearbyStand);
        return;
      }

      // Check if enough ungrouped same-species obs are nearby to form a new cluster
      const sameSpeciesUngrouped = allObs.filter(o =>
        o.id !== newObs.id &&
        o.gbifKey === newObs.gbifKey &&
        o.lat && o.lng &&
        !o.standId
      );

      if (sameSpeciesUngrouped.length < minCount - 1) return;

      const nearby = sameSpeciesUngrouped.filter(o =>
        distanceMeters(newObs.lat, newObs.lng, o.lat, o.lng) <= rangeM
      );

      if (nearby.length + 1 < minCount) return;

      const clusterKey = _clusterKey(newObs.gbifKey, newObs.lat, newObs.lng);
      if (State.get('dismissedClusterKeys').has(clusterKey)) return;

      const maxDist  = Math.max(...nearby.map(o => distanceMeters(newObs.lat, newObs.lng, o.lat, o.lng)));
      const specName = newObs.commonName || newObs.scientificName || 'this species';

      UI.clusterToast(specName, nearby.length + 1, maxDist, {
        onYes:    () => _createStand(surveyId, newObs, nearby),
        onNotNow: () => {},
        onNever:  () => State.addDismissedClusterKey(clusterKey),
      });
    } catch (err) {
      console.warn('[Clusters] checkForClusters error:', err);
    }
  }

  // ── Auto-scan: find all potential clusters across the whole survey ─────────
  //
  //  Returns three result types:
  //    { type:'new',    observations:[...] }   — form a brand-new cluster
  //    { type:'expand', observation, stand }   — add one ungrouped obs to an existing cluster
  //    { type:'merge',  stands:[s1,s2] }       — two same-species clusters within range of each other

  async function autoScan(surveyId, settings = {}) {
    const { rangeM = RADIUS_M, minCount = MIN_COUNT, perSpecies = [] } = settings;

    const [allObs, stands] = await Promise.all([
      DB.getAllByIndex('observations', 'surveyId', surveyId),
      DB.getAllByIndex('stands',       'surveyId', surveyId),
    ]);

    const ungrouped = allObs.filter(o =>
      PLANT_CATS.has(o.category) && !o.standId && o.gbifKey && o.lat && o.lng
    );

    // Pre-build a map of existing cluster members per species so Pass 1 can
    // exclude ungrouped obs that are already within range of an existing cluster
    // (those belong exclusively to Pass 2 as expansion candidates).
    const clusterMembersBySpecies = new Map();
    for (const stand of stands) {
      if (!clusterMembersBySpecies.has(stand.primaryGbifKey))
        clusterMembersBySpecies.set(stand.primaryGbifKey, []);
      for (const o of allObs) {
        if (o.standId === stand.id && o.lat && o.lng)
          clusterMembersBySpecies.get(stand.primaryGbifKey).push(o);
      }
    }

    const results = [];

    // ── Pass 1: groups of ungrouped obs that should form a NEW cluster ──────
    // Exclude obs already within range of an existing cluster — those are
    // handled by Pass 2 so they don't generate spurious duplicate suggestions.
    const bySpecies = new Map();
    for (const o of ungrouped) {
      if (!bySpecies.has(o.gbifKey)) bySpecies.set(o.gbifKey, []);
      bySpecies.get(o.gbifKey).push(o);
    }

    for (const [gbifKey, obs] of bySpecies) {
      const rule  = perSpecies.find(r => r.gbifKey === gbifKey);
      const range = rule?.rangeM   ?? rangeM;
      const min   = rule?.minCount ?? minCount;

      const existing = clusterMembersBySpecies.get(gbifKey) || [];
      const forNew   = existing.length
        ? obs.filter(o => !existing.some(m => distanceMeters(o.lat, o.lng, m.lat, m.lng) <= range))
        : obs;

      for (const comp of _connectedComponents(forNew, range)) {
        if (comp.length >= min) results.push({ type: 'new', observations: comp });
      }
    }

    // ── Pass 2: ungrouped obs that should JOIN an existing cluster ───────────
    for (const stand of stands) {
      const rule  = perSpecies.find(r => r.gbifKey === stand.primaryGbifKey);
      const range = rule?.rangeM ?? rangeM;

      const members = allObs.filter(o => o.standId === stand.id && o.lat && o.lng);
      if (!members.length) continue;

      const candidates = ungrouped.filter(o =>
        o.gbifKey === stand.primaryGbifKey &&
        members.some(m => distanceMeters(o.lat, o.lng, m.lat, m.lng) <= range)
      );

      for (const obs of candidates) {
        results.push({ type: 'expand', observation: obs, stand });
      }
    }

    // ── Pass 3: same-species clusters that overlap and should be merged ──────
    const standsBySpecies = new Map();
    for (const stand of stands) {
      if (!standsBySpecies.has(stand.primaryGbifKey))
        standsBySpecies.set(stand.primaryGbifKey, []);
      standsBySpecies.get(stand.primaryGbifKey).push(stand);
    }

    for (const [gbifKey, specStands] of standsBySpecies) {
      if (specStands.length < 2) continue;
      const rule  = perSpecies.find(r => r.gbifKey === gbifKey);
      const range = rule?.rangeM ?? rangeM;

      for (let i = 0; i < specStands.length; i++) {
        for (let j = i + 1; j < specStands.length; j++) {
          const s1 = specStands[i];
          const s2 = specStands[j];
          const m1 = allObs.filter(o => o.standId === s1.id && o.lat && o.lng);
          const m2 = allObs.filter(o => o.standId === s2.id && o.lat && o.lng);
          if (!m1.length || !m2.length) continue;
          const overlap = m1.some(a => m2.some(b =>
            distanceMeters(a.lat, a.lng, b.lat, b.lng) <= range
          ));
          if (overlap) results.push({ type: 'merge', stands: [s1, s2] });
        }
      }
    }

    return results;
  }

  function _connectedComponents(obs, rangeM) {
    const n = obs.length;
    const parent = obs.map((_, i) => i);
    function find(i) { return parent[i] === i ? i : (parent[i] = find(parent[i])); }
    function union(i, j) { parent[find(i)] = find(j); }

    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        if (distanceMeters(obs[i].lat, obs[i].lng, obs[j].lat, obs[j].lng) <= rangeM)
          union(i, j);

    const comps = new Map();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      if (!comps.has(r)) comps.set(r, []);
      comps.get(r).push(obs[i]);
    }
    return [...comps.values()];
  }

  // ── Create cluster from an auto-scan result ───────────────────────────────

  async function createFromScan(surveyId, scanItem) {
    const { observations } = scanItem;
    await _createStand(surveyId, observations[0], observations.slice(1));
  }

  // ── Assign a single observation to an existing stand ──────────────────────

  async function refreshStand(surveyId, standId) {
    try {
      const [stand, allObs] = await Promise.all([
        DB.get('stands', standId),
        DB.getAllByIndex('observations', 'surveyId', surveyId),
      ]);
      if (!stand) return;
      const members = allObs.filter(o => o.standId === standId && o.lat && o.lng);

      if (members.length === 0) {
        await DB.delete('stands', standId);
        window._refreshMapMarkers?.();
        return;
      }

      if (members.length >= 3) {
        const pts  = members.map(o => [o.lat, o.lng]);
        const hull = computeConvexHull(pts);
        stand.polygon  = hull.map(([lat, lng]) => ({ lat, lng }));
        stand.areaM2   = computeArea(hull);
        const [cLat, cLng] = computeCentroid(hull);
        stand.centroid = { lat: cLat, lng: cLng };
      } else if (members.length >= 2) {
        stand.polygon  = members.map(o => ({ lat: o.lat, lng: o.lng }));
        stand.areaM2   = 0;
        stand.centroid = null;
      } else {
        stand.polygon  = null;
        stand.areaM2   = 0;
        stand.centroid = null;
      }

      stand.obsCount             = members.length;
      stand.memberObservationIds = members.map(o => o.id);
      stand.updatedAt            = now();
      await DB.put('stands', stand);
      window._refreshMapMarkers?.();
    } catch (err) {
      console.error('[Clusters] refreshStand:', err);
    }
  }

  // ── Generate a unique cluster name ────────────────────────────────────────

  async function generateName(surveyId, gbifKey, specName) {
    const stands = await DB.getAllByIndex('stands', 'surveyId', surveyId);
    const n = stands.filter(s => s.primaryGbifKey === gbifKey).length + 1;
    return `${specName} Cluster ${n}`;
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  function _clusterKey(gbifKey, lat, lng) {
    const gLat = Math.round(lat * 500) / 500;
    const gLng = Math.round(lng * 500) / 500;
    return `cluster:${gbifKey}:${gLat}:${gLng}`;
  }

  function _promptAddToStand(surveyId, obs, stand) {
    const specName = obs.commonName || obs.scientificName || 'this species';
    UI.addToStandToast(specName, {
      onYes: () => _addObsToStand(surveyId, obs, stand),
      onNo:  () => {},
    });
  }

  async function _addObsToStand(surveyId, obs, stand) {
    try {
      obs.standId = stand.id;
      await DB.put('observations', obs);
      await refreshStand(surveyId, stand.id);
      UI.toastSuccess('Added to cluster');
    } catch (err) {
      UI.toastError('Failed to add to cluster');
      console.error(err);
    }
  }

  async function _createStand(surveyId, newObs, nearbyObs, providedName) {
    try {
      const members  = [newObs, ...nearbyObs];
      const standId  = generateUUID();
      const specName = newObs.commonName || newObs.scientificName || 'Species';
      const name     = providedName || await generateName(surveyId, newObs.gbifKey, specName);

      for (const o of members) {
        o.standId = standId;
        await DB.put('observations', o);
      }

      const pts = members.filter(o => o.lat && o.lng).map(o => [o.lat, o.lng]);
      let polygon = null, areaM2 = 0, centroid = null;

      if (pts.length >= 3) {
        const hull = computeConvexHull(pts);
        polygon  = hull.map(([lat, lng]) => ({ lat, lng }));
        areaM2   = computeArea(hull);
        const [cLat, cLng] = computeCentroid(hull);
        centroid = { lat: cLat, lng: cLng };
      } else {
        polygon = pts.map(([lat, lng]) => ({ lat, lng }));
      }

      const stand = {
        id:                       standId,
        surveyId,
        name,
        primaryGbifKey:           newObs.gbifKey,
        primarySpeciesName:       newObs.commonName || newObs.scientificName || '',
        primarySpeciesScientific: newObs.scientificName || '',
        category:                 newObs.category,
        obsCount:                 members.length,
        memberObservationIds:     members.map(o => o.id),
        polygon,
        areaM2,
        centroid,
        notes:     '',
        createdAt: now(),
        updatedAt: now(),
      };

      await DB.put('stands', stand);
      UI.toastSuccess(`"${name}" created — ${members.length} observations`);
      window._refreshMapMarkers?.();
    } catch (err) {
      UI.toastError('Failed to create cluster');
      console.error(err);
    }
  }

  // ── Merge two clusters into one ───────────────────────────────────────────

  async function mergeStands(surveyId, keepStandId, removeStandId) {
    const allObs = await DB.getAllByIndex('observations', 'surveyId', surveyId);
    const toMove = allObs.filter(o => o.standId === removeStandId);
    await Promise.all(toMove.map(o => { o.standId = keepStandId; return DB.put('observations', o); }));
    await DB.delete('stands', removeStandId);
    await refreshStand(surveyId, keepStandId);
  }

  return {
    PLANT_CATS,
    checkForClusters,
    autoScan,
    createFromScan,
    refreshStand,
    mergeStands,
    generateName,
  };
})();
