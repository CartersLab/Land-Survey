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
    if (newObs.standId) return; // already assigned to a cluster
    if (!newObs.lat || !newObs.lng) return;

    try {
      const allObs = await DB.getAllByIndex('observations', 'surveyId', surveyId);

      const sameSpeciesUngrouped = allObs.filter(o =>
        o.id !== newObs.id &&
        o.gbifKey === newObs.gbifKey &&
        o.lat && o.lng &&
        !o.standId
      );

      if (sameSpeciesUngrouped.length < MIN_COUNT - 1) return;

      const nearby = sameSpeciesUngrouped.filter(o =>
        distanceMeters(newObs.lat, newObs.lng, o.lat, o.lng) <= RADIUS_M * CONFIG.MAP.CLUSTER_NEARBY_MULTIPLIER
      );

      if (nearby.length + 1 < MIN_COUNT) return;

      const clusterKey = _clusterKey(newObs.gbifKey, newObs.lat, newObs.lng);
      if (State.get('dismissedClusterKeys').has(clusterKey)) return;

      const stands = await DB.getAllByIndex('stands', 'surveyId', surveyId);
      const existingStand = stands.find(s => s.primaryGbifKey === newObs.gbifKey);

      if (existingStand) {
        _promptAddToStand(surveyId, newObs, existingStand);
        return;
      }

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

  async function autoScan(surveyId, settings = {}) {
    const { rangeM = RADIUS_M, minCount = MIN_COUNT, perSpecies = [] } = settings;

    const allObs = await DB.getAllByIndex('observations', 'surveyId', surveyId);
    const ungrouped = allObs.filter(o =>
      PLANT_CATS.has(o.category) && !o.standId && o.gbifKey && o.lat && o.lng
    );

    const bySpecies = new Map();
    for (const o of ungrouped) {
      if (!bySpecies.has(o.gbifKey)) bySpecies.set(o.gbifKey, []);
      bySpecies.get(o.gbifKey).push(o);
    }

    const results = [];
    for (const [gbifKey, obs] of bySpecies) {
      const rule  = perSpecies.find(r => r.gbifKey === gbifKey);
      const range = rule?.rangeM   ?? rangeM;
      const min   = rule?.minCount ?? minCount;

      for (const comp of _connectedComponents(obs, range)) {
        if (comp.length >= min) results.push({ observations: comp });
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
      if (members.length >= 3) {
        const pts  = members.map(o => [o.lat, o.lng]);
        const hull = computeConvexHull(pts);
        stand.polygon  = hull.map(([lat, lng]) => ({ lat, lng }));
        stand.areaM2   = computeArea(hull);
        const [cLat, cLng] = computeCentroid(hull);
        stand.centroid = { lat: cLat, lng: cLng };
      } else if (members.length >= 2) {
        stand.polygon = members.map(o => ({ lat: o.lat, lng: o.lng }));
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

  return {
    PLANT_CATS,
    checkForClusters,
    autoScan,
    createFromScan,
    refreshStand,
    generateName,
  };
})();
