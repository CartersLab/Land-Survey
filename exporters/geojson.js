const GeojsonExporter = (() => {

  async function generate(surveyId) {
    const [obs, stands, survey] = await Promise.all([
      DB.getAllByIndex('observations', 'surveyId', surveyId),
      DB.getAllByIndex('stands',       'surveyId', surveyId),
      DB.get('surveys', surveyId).catch(() => null),
    ]);

    const features = [];

    for (const o of obs) {
      if (!o.lat || !o.lng) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [o.lng, o.lat] },
        properties: {
          id:             o.id,
          type:           'observation',
          category:       o.category,
          scientificName: o.scientificName || null,
          commonName:     o.commonName     || null,
          count:          o.count || 1,
          isRare:         o.isRare || false,
          observedAt:     o.observedAt || null,
          notes:          o.notes || null,
          behavior:       o.behavior || null,
          signType:       o.signType || null,
          heightM:        o.heightM  || null,
          dbhCm:          o.dbhCm   || null,
          coveragePct:    o.coveragePct != null ? o.coveragePct : null,
          accuracy:       o.accuracy || null,
          standId:        o.standId  || null,
          gbifKey:        o.gbifKey  || null,
          family:         o.gbifFamily || null,
        },
      });
    }

    for (const s of stands) {
      if (!s.polygon || s.polygon.length < 3) continue;
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [s.polygon.map(p => [p.lng, p.lat]).concat([[s.polygon[0].lng, s.polygon[0].lat]])],
        },
        properties: {
          id:                      s.id,
          type:                    'stand',
          category:                s.category,
          primarySpeciesName:      s.primarySpeciesName || null,
          primarySpeciesScientific: s.primarySpeciesScientific || null,
          obsCount:                s.obsCount || 0,
          areaM2:                  s.areaM2 || null,
          areaAcres:               s.areaM2 ? parseFloat(m2ToAcres(s.areaM2)) : null,
          notes:                   s.notes || null,
          createdAt:               s.createdAt || null,
        },
      });
    }

    const fc = {
      type: 'FeatureCollection',
      name: survey?.name || 'Field Survey',
      features,
      properties: {
        surveyId,
        surveyName:    survey?.name || null,
        siteName:      survey?.siteName || null,
        surveyorName:  survey?.surveyorName || null,
        startDate:     survey?.startDate || null,
        exportedAt:    new Date().toISOString(),
        totalFeatures: features.length,
      },
    };

    return JSON.stringify(fc, null, 2);
  }

  return { generate };
})();
