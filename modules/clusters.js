const Clusters = (() => {
  const RADIUS_M  = CONFIG.MAP.CLUSTER_RADIUS_METERS;
  const MIN_COUNT = CONFIG.MAP.CLUSTER_MIN_COUNT;

  async function checkForClusters(surveyId, newObs) {
    if (!newObs.gbifKey) return;
    if (newObs.category === 'sign-evidence') return;
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

      const members = (await DB.getAllByIndex('observations', 'surveyId', surveyId))
        .filter(o => o.standId === stand.id && o.lat && o.lng);

      if (members.length >= 3) {
        const pts  = members.map(o => [o.lat, o.lng]);
        const hull = computeConvexHull(pts);
        stand.polygon  = hull.map(([lat, lng]) => ({ lat, lng }));
        stand.areaM2   = computeArea(hull);
        const [cLat, cLng] = computeCentroid(hull);
        stand.centroid = { lat: cLat, lng: cLng };
      }

      stand.obsCount             = members.length;
      stand.memberObservationIds = members.map(o => o.id);
      stand.updatedAt            = now();
      await DB.put('stands', stand);

      UI.toastSuccess('Added to stand');
      window._refreshMapMarkers?.();
    } catch (err) {
      UI.toastError('Failed to add to stand');
      console.error(err);
    }
  }

  async function _createStand(surveyId, newObs, nearbyObs) {
    try {
      const members = [newObs, ...nearbyObs];
      const standId = generateUUID();

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
        primaryGbifKey:           newObs.gbifKey,
        primarySpeciesName:       newObs.commonName || newObs.scientificName || '',
        primarySpeciesScientific: newObs.scientificName || '',
        category:                 newObs.category,
        obsCount:                 members.length,
        memberObservationIds:     members.map(o => o.id),
        polygon,
        areaM2,
        centroid,
        standType:                   null,
        dominantSpecies:             null,
        canopyCoverEstimatePct:      null,
        understoryNotes:             '',
        notes:     '',
        createdAt: now(),
        updatedAt: now(),
      };

      await DB.put('stands', stand);
      UI.toastSuccess(`Stand created — ${members.length} observations`);
      window._refreshMapMarkers?.();
    } catch (err) {
      UI.toastError('Failed to create stand');
      console.error(err);
    }
  }

  return { checkForClusters };
})();
