const Markers = (() => {

  const CAT_COLORS = {
    'tree':             '#2d7a1b',
    'shrub':            '#5a9e3a',
    'herbaceous':       '#7ec850',
    'grass-sedge-rush': '#b8d464',
    'fern-moss-lichen': '#4a8c6e',
    'fungus':           '#a05a28',
    'invasive':         '#c0392b',
    'bird':             '#2980b9',
    'mammal':           '#7a5c3a',
    'reptile':          '#27ae60',
    'amphibian':        '#16a085',
    'fish':             '#2471a3',
    'invertebrate':     '#8e44ad',
    'sign-evidence':    '#95a5a6',
  };

  const CAT_ICONS = {
    'tree':             '🌳',
    'shrub':            '🌿',
    'herbaceous':       '🌱',
    'grass-sedge-rush': '🌾',
    'fern-moss-lichen': '🍀',
    'fungus':           '🍄',
    'invasive':         '⚠',
    'bird':             '🐦',
    'mammal':           '🦌',
    'reptile':          '🦎',
    'amphibian':        '🐸',
    'fish':             '🐟',
    'invertebrate':     '🦋',
    'sign-evidence':    '👁',
  };

  const CAT_LABELS = {
    'tree':             'Tree',
    'shrub':            'Shrub',
    'herbaceous':       'Herbaceous',
    'grass-sedge-rush': 'Grass/Sedge',
    'fern-moss-lichen': 'Fern/Moss',
    'fungus':           'Fungus',
    'invasive':         'Invasive',
    'bird':             'Bird',
    'mammal':           'Mammal',
    'reptile':          'Reptile',
    'amphibian':        'Amphibian',
    'fish':             'Fish',
    'invertebrate':     'Invertebrate',
    'sign-evidence':    'Sign/Evidence',
  };

  function colorForCat(cat) {
    return CAT_COLORS[cat] || '#7a7a7a';
  }

  function createObsMarker(obs) {
    const color = colorForCat(obs.category);
    const marker = L.circleMarker([obs.lat, obs.lng], {
      radius:      obs.isRare ? 9 : 7,
      fillColor:   color,
      color:       obs.isRare ? '#856404' : 'white',
      weight:      obs.isRare ? 2.5 : 1.5,
      fillOpacity: 0.85,
      opacity:     1,
    });
    marker.obsId = obs.id;
    marker.bindPopup(() => buildObsPopup(obs), { maxWidth: 280 });
    return marker;
  }

  function createStandMarker(stand) {
    if (!stand.polygon || stand.polygon.length < 3) return null;
    const coords = stand.polygon.map(p => [p.lat, p.lng]);
    const color = colorForCat(stand.category);
    const poly = L.polygon(coords, {
      color,
      fillColor:   color,
      fillOpacity: 0.22,
      weight:      2,
      opacity:     0.8,
      pane:        'clustersPane',
    });
    poly.standId = stand.id;
    poly.bindPopup(() => buildStandPopup(stand), { maxWidth: 280 });
    return poly;
  }

  function buildObsPopup(obs) {
    const color    = colorForCat(obs.category);
    const catLabel = CAT_LABELS[obs.category] || obs.category;
    const rareHtml = obs.isRare ? `<span class="badge badge-rare">⚑ Rare</span>` : '';
    const countHtml  = (obs.count && obs.count > 1) ? `<div class="popup-detail">Count: <strong>${obs.count}</strong></div>` : '';
    const heightHtml = obs.heightM  ? `<div class="popup-detail">Height: <strong>${metersToFeet(obs.heightM)} ft</strong></div>` : '';
    const dbhHtml    = obs.dbhCm    ? `<div class="popup-detail">DBH: <strong>${obs.dbhCm} cm</strong></div>` : '';
    const covHtml    = obs.coveragePct != null ? `<div class="popup-detail">Coverage: <strong>${obs.coveragePct}%</strong></div>` : '';
    const behHtml    = obs.behavior  ? `<div class="popup-detail">${escapeHtml(obs.behavior)}</div>` : '';
    const notesHtml  = obs.notes    ? `<div class="popup-notes">"${escapeHtml(obs.notes)}"</div>` : '';
    const dateStr    = obs.observedAt ? formatDate(obs.observedAt) : '';
    const coordStr   = (obs.lat && obs.lng) ? `${obs.lat.toFixed(5)}, ${obs.lng.toFixed(5)}` : '';

    return `
      <div class="popup-header">
        <div class="popup-common">${escapeHtml(obs.commonName || obs.scientificName || 'Unknown')}</div>
        ${obs.scientificName && obs.scientificName !== obs.commonName
          ? `<div class="popup-scientific">${escapeHtml(obs.scientificName)}</div>` : ''}
      </div>
      <div class="popup-badges">
        <span class="badge badge-cat" style="background:${color}">${catLabel}</span>
        ${rareHtml}
        ${obs.standId ? `<span class="badge badge-neutral">Stand</span>` : ''}
      </div>
      ${countHtml}${heightHtml}${dbhHtml}${covHtml}${behHtml}${notesHtml}
      ${dateStr ? `<div class="popup-detail" style="font-size:.75rem;color:var(--text-muted)">${dateStr}</div>` : ''}
      ${coordStr ? `<div class="popup-detail" style="font-size:.72rem;color:var(--text-muted);font-family:var(--font-mono)">${coordStr}</div>` : ''}
      <div class="popup-actions">
        <button class="btn btn-sm btn-secondary" onclick="window._editObs('${obs.id}')">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="window._deleteObs('${obs.id}')">Delete</button>
      </div>`;
  }

  function buildStandPopup(stand) {
    const color       = colorForCat(stand.category);
    const catLabel    = CAT_LABELS[stand.category] || stand.category;
    const displayName = stand.name || stand.primarySpeciesName || 'Cluster';
    const acres       = stand.areaM2 ? m2ToAcres(stand.areaM2) + ' ac' : null;

    return `
      <div class="popup-header">
        <div class="popup-common">${escapeHtml(displayName)}</div>
        ${stand.primarySpeciesScientific
          ? `<div class="popup-scientific">${escapeHtml(stand.primarySpeciesScientific)}</div>` : ''}
      </div>
      <div class="popup-badges">
        <span class="badge badge-cat" style="background:${color}">${catLabel} Cluster</span>
      </div>
      ${acres ? `<div class="popup-detail stand-popup"><span class="popup-area">${acres}</span></div>` : ''}
      ${stand.obsCount ? `<div class="popup-detail">${stand.obsCount} observations</div>` : ''}
      ${stand.notes ? `<div class="popup-notes">"${escapeHtml(stand.notes)}"</div>` : ''}
      <div class="popup-actions">
        <button class="btn btn-sm btn-secondary" onclick="window._editCluster('${stand.id}')">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="window._deleteCluster('${stand.id}')">Delete</button>
      </div>`;
  }

  return { CAT_COLORS, CAT_ICONS, CAT_LABELS, colorForCat, createObsMarker, createStandMarker, buildObsPopup, buildStandPopup };
})();
