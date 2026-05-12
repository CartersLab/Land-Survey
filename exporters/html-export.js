const HtmlExporter = (() => {

  async function generate(surveyId) {
    const [obs, stands, survey] = await Promise.all([
      DB.getAllByIndex('observations', 'surveyId', surveyId),
      DB.getAllByIndex('stands',       'surveyId', surveyId),
      DB.get('surveys', surveyId).catch(() => null),
    ]);

    const surveyName = survey?.name || 'Field Survey';
    const exportDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    // Group by category
    const byCat = {};
    for (const o of obs) {
      const cat = o.category || 'unknown';
      (byCat[cat] = byCat[cat] || []).push(o);
    }

    const catSections = Object.entries(byCat)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([cat, catObs]) => {
        const color = Markers.colorForCat(cat);
        const label = Markers.CAT_LABELS[cat] || cat;
        const rows  = catObs.map(o => {
          const parts = [];
          if (o.count > 1)       parts.push(`Count: ${o.count}`);
          if (o.heightM)         parts.push(`Ht: ${metersToFeet(o.heightM)} ft`);
          if (o.dbhCm)           parts.push(`DBH: ${o.dbhCm} cm`);
          if (o.coveragePct != null) parts.push(`Cov: ${o.coveragePct}%`);
          if (o.behavior)        parts.push(o.behavior);
          if (o.signType)        parts.push(o.signType);
          const det = parts.join(' · ');
          const coord = o.lat ? `${o.lat.toFixed(5)}, ${o.lng.toFixed(5)}` : '';
          return `<tr${o.isRare ? ' style="background:#fff8e1"' : ''}>
            <td>${escapeHtml(o.commonName || o.scientificName || '—')}</td>
            <td><em>${escapeHtml(o.scientificName || '')}</em></td>
            <td>${escapeHtml(det)}</td>
            <td style="font-family:monospace;font-size:.8em">${coord}</td>
            <td>${o.observedAt ? new Date(o.observedAt).toLocaleDateString() : ''}</td>
            <td>${escapeHtml(o.notes || '')}</td>
            ${o.isRare ? '<td style="color:#856404;font-weight:700">⚑ Rare</td>' : '<td></td>'}
          </tr>`;
        }).join('');
        return `
          <h3 style="color:${color};margin:24px 0 8px;border-bottom:2px solid ${color};padding-bottom:4px">
            ${escapeHtml(label)} (${catObs.length})
          </h3>
          <table>
            <thead><tr><th>Common Name</th><th>Scientific Name</th><th>Details</th><th>Coordinates</th><th>Date</th><th>Notes</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>`;
      }).join('\n');

    const standRows = stands.length
      ? stands.map(s => {
          const acres = s.areaM2 ? m2ToAcres(s.areaM2) + ' ac' : '—';
          return `<tr>
            <td>${escapeHtml(s.primarySpeciesName || '—')}</td>
            <td>${escapeHtml(Markers.CAT_LABELS[s.category] || s.category || '')}</td>
            <td>${s.obsCount || 0}</td>
            <td>${acres}</td>
            <td>${escapeHtml(s.notes || '')}</td>
          </tr>`;
        }).join('')
      : '';

    const speciesSet = [...new Set(obs.filter(o => o.scientificName).map(o => o.scientificName))].sort();
    const rareCount  = obs.filter(o => o.isRare).length;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(surveyName)} — Field Survey Report</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; color: #1a1a1a; max-width: 1100px; margin: 0 auto; padding: 24px 16px; background: #f5f0e8; }
  h1 { color: #2d5a1b; margin-bottom: 4px; }
  h2 { color: #1a3a0f; border-bottom: 1px solid #c8c0b0; padding-bottom: 6px; margin-top: 32px; }
  h3 { margin-bottom: 8px; }
  .meta { color: #7a7a7a; font-size: .85em; margin-bottom: 24px; }
  .stats { display: flex; gap: 24px; flex-wrap: wrap; margin-bottom: 24px; }
  .stat { background: white; border-radius: 10px; padding: 14px 20px; border: 1px solid #ddd8cc; min-width: 100px; text-align: center; }
  .stat-val { font-size: 1.8em; font-weight: 700; color: #2d5a1b; }
  .stat-lbl { font-size: .75em; color: #7a7a7a; text-transform: uppercase; letter-spacing: .05em; }
  table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; margin-bottom: 16px; font-size: .85em; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
  th { background: #1a3a0f; color: white; padding: 8px 10px; text-align: left; font-size: .8em; }
  td { padding: 7px 10px; border-bottom: 1px solid #eee; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #f0f8e8; }
  .footer { margin-top: 48px; color: #aaa; font-size: .8em; text-align: center; }
</style>
</head>
<body>
  <h1>${escapeHtml(surveyName)}</h1>
  <div class="meta">
    ${survey?.siteName ? `<strong>Site:</strong> ${escapeHtml(survey.siteName)} &nbsp;·&nbsp; ` : ''}
    ${survey?.surveyorName ? `<strong>Surveyor:</strong> ${escapeHtml(survey.surveyorName)} &nbsp;·&nbsp; ` : ''}
    ${survey?.startDate ? `<strong>Date:</strong> ${survey.startDate} &nbsp;·&nbsp; ` : ''}
    <strong>Exported:</strong> ${exportDate}
  </div>

  <div class="stats">
    <div class="stat"><div class="stat-val">${obs.length}</div><div class="stat-lbl">Observations</div></div>
    <div class="stat"><div class="stat-val">${speciesSet.length}</div><div class="stat-lbl">Species</div></div>
    <div class="stat"><div class="stat-val">${stands.length}</div><div class="stat-lbl">Stands</div></div>
    ${rareCount ? `<div class="stat"><div class="stat-val" style="color:#856404">${rareCount}</div><div class="stat-lbl">Rare</div></div>` : ''}
  </div>

  <h2>Observations by Category</h2>
  ${catSections || '<p style="color:#aaa">No observations recorded.</p>'}

  ${stands.length ? `
  <h2>Stands (${stands.length})</h2>
  <table>
    <thead><tr><th>Primary Species</th><th>Category</th><th>Observations</th><th>Area</th><th>Notes</th></tr></thead>
    <tbody>${standRows}</tbody>
  </table>` : ''}

  <h2>Species Checklist (${speciesSet.length} species)</h2>
  <ul style="column-count:2;column-gap:24px;background:white;border-radius:8px;padding:16px 24px;list-style:disc;border:1px solid #ddd8cc">
    ${speciesSet.map(s => `<li><em>${escapeHtml(s)}</em></li>`).join('')}
  </ul>

  <div class="footer">Generated by Field Survey PWA &nbsp;·&nbsp; ${exportDate}</div>
</body>
</html>`;
  }

  return { generate };
})();
