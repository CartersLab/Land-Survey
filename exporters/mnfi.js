const MnfiExporter = (() => {

  async function generate(surveyId) {
    const obs    = await DB.getAllByIndex('observations', 'surveyId', surveyId);
    const survey = await DB.get('surveys', surveyId).catch(() => null);

    const rareObs = obs.filter(o => o.lat && o.lng);

    // ── mnfi-data.csv ─────────────────────────────────────────────────────────
    const header = [
      'EO_ID','SCIENTIFIC_NAME','COMMON_NAME','STATE_RANK','FEDERAL_STATUS',
      'SURVEY_DATE','OBSERVER','COUNTY','TOWNSHIP','SECTION',
      'LATITUDE_DD','LONGITUDE_DD','COORDINATE_ACCURACY_M',
      'POPULATION_SIZE','CONDITION','LIFE_STAGE','HABITAT_DESCRIPTION',
      'THREAT','NOTES','RARE_FLAG','ELEMENT_TYPE',
    ];

    const rows = rareObs.map(o => {
      const d    = new Date(o.observedAt || o.createdAt || Date.now());
      const date = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const elementType = _elementType(o.category);
      const popSize = o.count > 1 ? String(o.count) : (o.coveragePct ? o.coveragePct + ' cover' : '');
      return [
        '',
        o.scientificName || '',
        o.commonName     || '',
        '', '',
        date,
        survey?.surveyorName || '',
        survey?.county   || '',
        survey?.township || '',
        '',
        o.lat.toFixed(7),
        o.lng.toFixed(7),
        o.accuracy ? Math.round(o.accuracy) : '',
        popSize,
        o.condition  || '',
        o.lifeStage  || '',
        '', '',
        [o.notes, o.behavior, o.rareNotes].filter(Boolean).join('. '),
        o.isRare ? 'YES' : 'NO',
        elementType,
      ];
    });

    const dataCsv = [csvRow(header), ...rows.map(r => csvRow(r))].join('\r\n');

    // ── mnfi-report.html ──────────────────────────────────────────────────────
    const generatedDate = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
    const rareObs2 = rareObs.filter(o => o.isRare);
    const allObs   = rareObs;

    const tableRows = allObs.map(o => {
      const d = new Date(o.observedAt || o.createdAt || Date.now());
      const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      return `<tr${o.isRare ? ' class="rare-row"' : ''}>
        <td>${_h(o.scientificName || '')}</td>
        <td>${_h(o.commonName || '')}</td>
        <td>${dateStr}</td>
        <td>${o.lat.toFixed(5)}, ${o.lng.toFixed(5)}</td>
        <td>${_h(o.condition || '')}</td>
        <td>${_h(o.lifeStage || '')}</td>
        <td>${o.count || 1}</td>
        <td>${o.isRare ? '<strong>YES</strong>' : ''}</td>
        <td>${_h([o.notes, o.rareNotes].filter(Boolean).join(' — '))}</td>
      </tr>`;
    }).join('\n');

    const reportHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>MNFI Element Occurrence Report — ${_h(survey?.name || surveyId)}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 13px; color: #222; margin: 24px 32px; }
  h1   { font-size: 1.4rem; color: #1a4a0d; }
  h2   { font-size: 1.1rem; color: #2d5a1b; margin-top: 24px; }
  .meta-grid { display: grid; grid-template-columns: 140px 1fr; gap: 4px 12px; margin-bottom: 20px; }
  .meta-label { font-weight: 600; color: #555; }
  table  { border-collapse: collapse; width: 100%; margin-top: 12px; }
  th, td { border: 1px solid #ccc; padding: 5px 8px; text-align: left; vertical-align: top; }
  th     { background: #2d5a1b; color: white; font-size: 12px; }
  tr:nth-child(even) { background: #f5f5f5; }
  .rare-row td { background: #fff3cd; }
  .stat-boxes { display: flex; gap: 16px; flex-wrap: wrap; margin: 12px 0; }
  .stat-box { background: #f0f7ec; border: 1px solid #b8d9a0; border-radius: 6px; padding: 10px 16px; min-width: 120px; }
  .stat-box .num { font-size: 1.8rem; font-weight: 700; color: #2d5a1b; }
  .stat-box .lbl { font-size: .78rem; color: #555; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
<h1>MNFI Element Occurrence Report</h1>
<div class="meta-grid">
  <span class="meta-label">Survey Name:</span><span>${_h(survey?.name || '')}</span>
  <span class="meta-label">Site Name:</span><span>${_h(survey?.siteName || '—')}</span>
  <span class="meta-label">Observer:</span><span>${_h(survey?.surveyorName || '—')}</span>
  <span class="meta-label">Survey Date:</span><span>${survey?.startDate || '—'}</span>
  <span class="meta-label">County:</span><span>${_h(survey?.county || '—')}</span>
  <span class="meta-label">Township:</span><span>${_h(survey?.township || '—')}</span>
  <span class="meta-label">Generated:</span><span>${generatedDate}</span>
</div>

<div class="stat-boxes">
  <div class="stat-box"><div class="num">${allObs.length}</div><div class="lbl">Total Observations</div></div>
  <div class="stat-box"><div class="num">${rareObs2.length}</div><div class="lbl">Rare / Significant</div></div>
  <div class="stat-box"><div class="num">${new Set(allObs.filter(o=>o.scientificName).map(o=>o.scientificName)).size}</div><div class="lbl">Species Recorded</div></div>
</div>

<h2>Observation Data</h2>
<table>
<thead>
  <tr>
    <th>Scientific Name</th><th>Common Name</th><th>Date</th>
    <th>Coordinates</th><th>Condition</th><th>Life Stage</th>
    <th>Count</th><th>Rare</th><th>Notes</th>
  </tr>
</thead>
<tbody>
${tableRows}
</tbody>
</table>
${survey?.notes ? `<h2>Survey Notes</h2><p>${_h(survey.notes)}</p>` : ''}
</body>
</html>`;

    const zip = new JSZip();
    zip.file('mnfi-data.csv',    dataCsv);
    zip.file('mnfi-report.html', reportHtml);
    return zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
  }

  function _elementType(cat) {
    const map = {
      tree: 'Vascular Plant', shrub: 'Vascular Plant', herbaceous: 'Vascular Plant',
      'grass-sedge-rush': 'Vascular Plant', 'fern-moss-lichen': 'Vascular Plant',
      invasive: 'Vascular Plant', fungus: 'Fungus/Lichen',
      bird: 'Animal', mammal: 'Animal', reptile: 'Animal', amphibian: 'Animal',
      fish: 'Animal', invertebrate: 'Animal', 'sign-evidence': 'Animal',
    };
    return map[cat] || 'Unknown';
  }

  function _h(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  return { generate };
})();
