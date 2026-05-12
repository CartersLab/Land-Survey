const ExportScreen = (() => {
  let _surveyId = null;
  let _survey   = null;
  let _activeTab = 'summary';

  const TABS = [
    { key: 'summary',   label: 'Summary' },
    { key: 'inat',      label: 'iNaturalist' },
    { key: 'dwc',       label: 'Darwin Core' },
    { key: 'mnfi',      label: 'MNFI' },
    { key: 'geojson',   label: 'GeoJSON' },
    { key: 'checklist', label: 'Checklist' },
    { key: 'report',    label: 'HTML Report' },
    { key: 'tiles',     label: 'Offline Maps' },
  ];

  // ── Render ────────────────────────────────────────────────────────────────

  async function render(container, params) {
    _surveyId  = params?.surveyId || State.get('currentSurveyId');
    _activeTab = 'summary';

    if (!_surveyId) { Router.navigate('home'); return; }

    _survey = await DB.get('surveys', _surveyId).catch(() => null);
    const surveyName = _survey?.name || 'Survey';

    container.innerHTML = `
      <div class="export-screen">
        <div class="app-header">
          <button class="btn-icon" id="ex-back" style="color:white">←</button>
          <div>
            <h1 style="font-size:1rem">${escapeHtml(surveyName)}</h1>
            <div class="subtitle">Export &amp; Settings</div>
          </div>
          <button class="btn-icon" id="ex-map" style="color:white" title="Back to map">🗺</button>
        </div>
        <div class="tabs" id="ex-tabs">
          ${TABS.map(t => `<button class="tab${t.key==='summary'?' active':''}" data-tab="${t.key}">${t.label}</button>`).join('')}
        </div>
        <div class="tab-content" id="ex-content">
          <div class="loading-spinner" style="margin:40px auto;display:block"></div>
        </div>
      </div>`;

    document.getElementById('ex-back')?.addEventListener('click', () => Router.navigate('home'));
    document.getElementById('ex-map')?.addEventListener('click',  () => Router.navigate('map', { surveyId: _surveyId }));

    document.querySelectorAll('.tab').forEach(btn => {
      btn.addEventListener('click', () => {
        _activeTab = btn.dataset.tab;
        document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === _activeTab));
        _renderTab(_activeTab);
      });
    });

    _renderTab('summary');
  }

  // ── Tab rendering ─────────────────────────────────────────────────────────

  async function _renderTab(tab) {
    const el = document.getElementById('ex-content');
    if (!el) return;
    el.innerHTML = `<div style="padding:24px;text-align:center"><div class="loading-spinner"></div></div>`;

    try {
      switch (tab) {
        case 'summary':   el.innerHTML = await _tabSummary();   break;
        case 'inat':      el.innerHTML = _tabExport('iNaturalist CSV', 'Upload your observations directly to iNaturalist.', 'inat-csv', () => InatExporter.generate(_surveyId));    break;
        case 'dwc':       el.innerHTML = _tabExport('Darwin Core CSV', 'Standard biodiversity data format for GBIF and data aggregators.', 'dwc-csv', () => DwcExporter.generate(_surveyId));     break;
        case 'mnfi':      el.innerHTML = _tabExport('MNFI Element Occurrence', 'Michigan Natural Features Inventory element occurrence data.', 'mnfi-csv', () => MnfiExporter.generate(_surveyId));    break;
        case 'geojson':   el.innerHTML = _tabExport('GeoJSON', 'All observations and stands as a GeoJSON FeatureCollection. Open in QGIS, ArcGIS, or any GIS tool.', 'geo-json', () => GeojsonExporter.generate(_surveyId)); break;
        case 'checklist': el.innerHTML = _tabExport('Species Checklist CSV', 'Alphabetical species list with occurrence counts.', 'checklist-csv', () => ChecklistExporter.generate(_surveyId)); break;
        case 'report':    el.innerHTML = _tabReport(); break;
        case 'tiles':     el.innerHTML = await _tabTiles(); break;
        default:          el.innerHTML = `<p style="padding:16px">Unknown tab</p>`;
      }
      _bindTabEvents(tab);
    } catch (err) {
      el.innerHTML = `<div style="padding:16px;color:#c0392b">Error: ${escapeHtml(err.message)}</div>`;
    }
  }

  async function _tabSummary() {
    const [obs, stands] = await Promise.all([
      DB.getAllByIndex('observations', 'surveyId', _surveyId),
      DB.getAllByIndex('stands',       'surveyId', _surveyId),
    ]);

    const catCounts = {};
    for (const o of obs) { catCounts[o.category] = (catCounts[o.category] || 0) + 1; }
    const rareCount = obs.filter(o => o.isRare).length;

    const speciesSet = new Set(obs.filter(o => o.scientificName).map(o => o.scientificName));

    const totalAreaM2 = stands.reduce((s, st) => s + (st.areaM2 || 0), 0);

    const catRows = Object.entries(catCounts).sort((a,b) => b[1]-a[1])
      .map(([c,n]) => `<div class="info-row"><span class="info-label">${Markers.CAT_LABELS[c]||c}</span><span class="info-value">${n}</span></div>`)
      .join('');

    return `
      <div class="export-section">
        <div class="export-section-header">Survey Info</div>
        <div class="export-section-body">
          <div class="info-row"><span class="info-label">Survey Name</span><span class="info-value">${escapeHtml(_survey?.name||'')}</span></div>
          <div class="info-row"><span class="info-label">Site</span><span class="info-value">${escapeHtml(_survey?.siteName||'—')}</span></div>
          <div class="info-row"><span class="info-label">Surveyor</span><span class="info-value">${escapeHtml(_survey?.surveyorName||'—')}</span></div>
          <div class="info-row"><span class="info-label">Date</span><span class="info-value">${_survey?.startDate||'—'}</span></div>
          <div class="info-row"><span class="info-label">Status</span><span class="info-value">${_survey?.status||'active'}</span></div>
        </div>
      </div>
      <div class="export-section">
        <div class="export-section-header">Statistics</div>
        <div class="export-section-body">
          <div class="info-row"><span class="info-label">Total Observations</span><span class="info-value">${obs.length}</span></div>
          <div class="info-row"><span class="info-label">Species Recorded</span><span class="info-value">${speciesSet.size}</span></div>
          <div class="info-row"><span class="info-label">Rare / Significant</span><span class="info-value">${rareCount}</span></div>
          <div class="info-row"><span class="info-label">Stands</span><span class="info-value">${stands.length}</span></div>
          ${totalAreaM2 > 0 ? `<div class="info-row"><span class="info-label">Stand Area</span><span class="info-value">${m2ToAcres(totalAreaM2)} ac</span></div>` : ''}
        </div>
      </div>
      ${catRows ? `
      <div class="export-section">
        <div class="export-section-header">By Category</div>
        <div class="export-section-body">${catRows}</div>
      </div>` : ''}`;
  }

  function _tabExport(title, desc, btnId, genFn) {
    return `
      <div class="export-section">
        <div class="export-section-header">${title}</div>
        <div class="export-section-body">
          <p class="text-small text-muted" style="margin-bottom:12px">${desc}</p>
          <button class="btn btn-primary" id="${btnId}-btn">⬇ Download ${title}</button>
        </div>
      </div>`;
  }

  function _tabReport() {
    return `
      <div class="export-section">
        <div class="export-section-header">HTML Field Report</div>
        <div class="export-section-body">
          <p class="text-small text-muted" style="margin-bottom:12px">
            A self-contained HTML file with all observations, photos, and a map snapshot. Opens offline in any browser.
          </p>
          <button class="btn btn-primary" id="report-btn">⬇ Generate HTML Report</button>
        </div>
      </div>`;
  }

  async function _tabTiles() {
    const regions = await Tiles.getRegions();
    const tileCount = await Tiles.countTiles();

    const regionRows = regions.length
      ? regions.map(r => `
          <div class="tile-region-item">
            <div class="tile-region-info">
              <h4>${escapeHtml(r.name)}</h4>
              <p>${r.tileCount} tiles — ${r.tileSource} — z${r.minZoom}–${r.maxZoom}</p>
              <p>${formatDate(r.cachedAt)}</p>
            </div>
            <button class="btn btn-sm btn-danger" data-del-region="${r.id}">Delete</button>
          </div>`).join('')
      : `<p class="text-muted text-small" style="padding:8px 0">No cached regions yet.</p>`;

    return `
      <div class="export-section">
        <div class="export-section-header">Cache Map Region</div>
        <div class="export-section-body">
          <p class="text-small text-muted" style="margin-bottom:12px">
            Cache the current map view (z${CONFIG.MAP.CACHE_MIN_ZOOM}–${CONFIG.MAP.CACHE_MAX_ZOOM}) for offline use.
            Navigate to your survey site on the map first.
          </p>
          <div class="form-group">
            <label>Region Name</label>
            <input type="text" id="tile-region-name" placeholder="e.g. Tyrone Twp Property" autocomplete="off">
          </div>
          <div id="tile-progress" style="display:none;margin-bottom:10px">
            <div class="progress-bar-wrap"><div class="progress-bar-fill" id="tile-progress-bar" style="width:0%"></div></div>
            <p class="text-small text-muted" id="tile-progress-text" style="margin-top:4px">Starting…</p>
          </div>
          <button class="btn btn-primary" id="tile-cache-btn">⬇ Cache Current Map View</button>
        </div>
      </div>
      <div class="export-section">
        <div class="export-section-header">Cached Regions (${tileCount} tiles total)</div>
        <div>${regionRows}</div>
      </div>`;
  }

  // ── Tab event binding ─────────────────────────────────────────────────────

  function _bindTabEvents(tab) {
    const bind = (id, fn) => document.getElementById(id)?.addEventListener('click', fn);

    if (tab === 'inat')      bind('inat-csv-btn',      () => _doExport(() => InatExporter.generate(_surveyId),    'inat-observations.csv',  'text/csv'));
    if (tab === 'dwc')       bind('dwc-csv-btn',       () => _doExport(() => DwcExporter.generate(_surveyId),     'darwin-core.csv',         'text/csv'));
    if (tab === 'mnfi')      bind('mnfi-csv-btn',      () => _doExport(() => MnfiExporter.generate(_surveyId),    'mnfi-occurrences.csv',    'text/csv'));
    if (tab === 'geojson')   bind('geo-json-btn',      () => _doExport(() => GeojsonExporter.generate(_surveyId), 'survey.geojson',          'application/geo+json'));
    if (tab === 'checklist') bind('checklist-csv-btn', () => _doExport(() => ChecklistExporter.generate(_surveyId), 'species-checklist.csv', 'text/csv'));
    if (tab === 'report')    bind('report-btn',        () => _doExport(() => HtmlExporter.generate(_surveyId),    'field-report.html',       'text/html'));

    if (tab === 'tiles') {
      bind('tile-cache-btn', _startTileCache);
      document.querySelectorAll('[data-del-region]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.delRegion;
          const ok = await UI.confirm('Delete this cached region?', 'Delete Region', { confirmLabel: 'Delete', dangerous: true });
          if (!ok) return;
          await Tiles.deleteRegion(id);
          UI.toastSuccess('Region deleted');
          _renderTab('tiles');
        });
      });
    }
  }

  async function _doExport(genFn, filename, mime) {
    UI.loading(true, 'Generating…');
    try {
      const content = await genFn();
      const blob = new Blob([content], { type: mime + ';charset=utf-8' });
      const name  = _survey ? `${slugify(_survey.name)}_${filename}` : filename;
      downloadFile(blob, name);
      UI.toastSuccess('File downloaded');
    } catch (err) {
      UI.toastError('Export failed: ' + err.message);
      console.error(err);
    } finally {
      UI.loading(false);
    }
  }

  async function _startTileCache() {
    const name = document.getElementById('tile-region-name')?.value?.trim() || 'Survey Area';
    const mapCenter = State.get('mapCenter');
    if (!mapCenter) { UI.toastWarn('Open the map first to set the area to cache'); return; }

    // Build a temporary map bounds from state — user should cache from the map screen
    UI.toastWarn('For best results, cache tiles from the map screen with your survey area visible.');
    // We'll still proceed using the stored bounds if available
    const bounds = State.get('mapBounds');
    if (!bounds) { UI.toastError('No map bounds available — open the map first'); return; }

    const minZ = CONFIG.MAP.CACHE_MIN_ZOOM;
    const maxZ = CONFIG.MAP.CACHE_MAX_ZOOM;

    // Wrap bounds as a Leaflet-like object
    const fakeBounds = {
      getSouth: () => bounds._southWest?.lat ?? bounds.south,
      getNorth: () => bounds._northEast?.lat ?? bounds.north,
      getWest:  () => bounds._southWest?.lng ?? bounds.west,
      getEast:  () => bounds._northEast?.lng ?? bounds.east,
    };

    const est = Tiles.estimateTileCount(fakeBounds, minZ, maxZ);
    const ok  = await UI.confirm(
      `Cache ~${est} tiles for "${name}"? This uses ~${Math.round(est * 15 / 1024)} MB.`,
      'Cache Offline Map',
      { confirmLabel: 'Start Download', dangerous: false }
    );
    if (!ok) return;

    const progWrap = document.getElementById('tile-progress');
    const progBar  = document.getElementById('tile-progress-bar');
    const progText = document.getElementById('tile-progress-text');
    const cacheBtn = document.getElementById('tile-cache-btn');
    if (progWrap) progWrap.style.display = 'block';
    if (cacheBtn) cacheBtn.disabled = true;

    try {
      await Tiles.cacheRegion({ getBounds: () => fakeBounds }, 'osm', name, ({ done, total, failed }) => {
        const pct = Math.round(done / total * 100);
        if (progBar)  progBar.style.width  = pct + '%';
        if (progText) progText.textContent  = `${done} / ${total} tiles (${failed} failed)`;
      });
      UI.toastSuccess(`Cached "${name}" — ${est} tiles`);
      _renderTab('tiles');
    } catch (err) {
      UI.toastError('Tile caching failed: ' + err.message);
      if (cacheBtn) cacheBtn.disabled = false;
      if (progWrap) progWrap.style.display = 'none';
    }
  }

  // ── Destroy ───────────────────────────────────────────────────────────────

  function destroy() {
    _surveyId = null; _survey = null;
  }

  return { render, destroy };
})();
