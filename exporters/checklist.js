const ChecklistExporter = (() => {

  async function generate(surveyId) {
    const obs    = await DB.getAllByIndex('observations', 'surveyId', surveyId);
    const survey = await DB.get('surveys', surveyId).catch(() => null);

    // Group by scientific name (fall back to commonName, then 'Unknown')
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
      .sort((a, b) => a.scientificName.localeCompare(b.scientificName) ||
                      a.commonName.localeCompare(b.commonName));

    // ── species-checklist.csv ─────────────────────────────────────────────────
    const header = [
      'SCIENTIFIC_NAME','COMMON_NAME','CATEGORY','FAMILY',
      'OBSERVATION_COUNT','INDIVIDUAL_COUNT','RARE_FLAG','FIRST_SEEN',
      'SURVEY_NAME','SURVEYOR',
    ];

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

    const dataCsv = [csvRow(header), ...rows.map(r => csvRow(r))].join('\r\n');

    // ── species-checklist.txt ─────────────────────────────────────────────────
    const lines = [
      'FIELD SURVEY SPECIES CHECKLIST',
      '================================',
      '',
      `Survey:   ${survey?.name || surveyId}`,
      `Site:     ${survey?.siteName || '—'}`,
      `Surveyor: ${survey?.surveyorName || '—'}`,
      `Date:     ${survey?.startDate || '—'}`,
      `Generated:${new Date().toLocaleDateString()}`,
      '',
      `Total species:      ${entries.length}`,
      `Total observations: ${obs.length}`,
      `Rare / significant: ${entries.filter(e => e.isRare).length}`,
      '',
      '--------------------------------',
      '',
    ];

    // Group by category for text output
    const byCat = {};
    for (const e of entries) {
      const catLabel = Markers.CAT_LABELS[e.category] || e.category || 'Other';
      if (!byCat[catLabel]) byCat[catLabel] = [];
      byCat[catLabel].push(e);
    }

    for (const [catLabel, catEntries] of Object.entries(byCat)) {
      lines.push(`${catLabel.toUpperCase()} (${catEntries.length})`);
      lines.push('-'.repeat(catLabel.length + 6));
      for (const e of catEntries) {
        const name = e.commonName
          ? `${e.commonName} (${e.scientificName})`
          : e.scientificName;
        const rare = e.isRare ? ' *RARE*' : '';
        const cnt  = e.count > 1 ? ` — ${e.count} obs` : '';
        lines.push(`  ${name}${rare}${cnt}`);
      }
      lines.push('');
    }

    const dataTxt = lines.join('\r\n');

    const zip = new JSZip();
    zip.file('species-checklist.csv', dataCsv);
    zip.file('species-checklist.txt', dataTxt);
    return zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
  }

  return { generate };
})();
