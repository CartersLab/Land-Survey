const ChecklistExporter = (() => {

  async function generate(surveyId) {
    const obs    = await DB.getAllByIndex('observations', 'surveyId', surveyId);
    const survey = await DB.get('surveys', surveyId).catch(() => null);

    // Group by scientific name
    const bySpecies = {};
    for (const o of obs) {
      const key = o.scientificName || o.commonName || 'Unknown';
      if (!bySpecies[key]) {
        bySpecies[key] = {
          scientificName: o.scientificName || '',
          commonName:     o.commonName     || '',
          category:       o.category       || '',
          family:         o.gbifFamily     || '',
          count:          0,
          individuals:    0,
          isRare:         false,
          firstSeen:      o.observedAt || '',
        };
      }
      const entry = bySpecies[key];
      entry.count++;
      entry.individuals += o.count || 1;
      if (o.isRare) entry.isRare = true;
      if (o.observedAt && (!entry.firstSeen || o.observedAt < entry.firstSeen)) {
        entry.firstSeen = o.observedAt;
      }
    }

    const entries = Object.values(bySpecies)
      .sort((a, b) => a.scientificName.localeCompare(b.scientificName));

    const header = [
      'SCIENTIFIC_NAME','COMMON_NAME','CATEGORY','FAMILY',
      'OBSERVATION_COUNT','INDIVIDUAL_COUNT','RARE_FLAG','FIRST_SEEN',
      'SURVEY_NAME','SURVEYOR',
    ];

    const meta = [
      `# Field Survey Checklist`,
      `# Survey: ${survey?.name || surveyId}`,
      `# Site: ${survey?.siteName || ''}`,
      `# Surveyor: ${survey?.surveyorName || ''}`,
      `# Date: ${survey?.startDate || ''}`,
      `# Generated: ${new Date().toLocaleDateString()}`,
      `# Total species: ${entries.length}`,
      `# Total observations: ${obs.length}`,
      '',
    ].join('\r\n');

    const rows = entries.map(e => [
      e.scientificName,
      e.commonName,
      Markers.CAT_LABELS[e.category] || e.category,
      e.family,
      e.count,
      e.individuals,
      e.isRare ? 'YES' : '',
      e.firstSeen ? new Date(e.firstSeen).toLocaleDateString() : '',
      survey?.name || '',
      survey?.surveyorName || '',
    ]);

    return meta + [csvRow(header), ...rows.map(r => csvRow(r))].join('\r\n');
  }

  return { generate };
})();
