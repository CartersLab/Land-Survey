const MapScreen = (() => {
  let _map             = null;
  let _markerLayer     = null;
  let _standLayer      = null;
  let _tileLayer       = null;
  let _surveyId        = null;
  let _tileSource      = 'osm';
  let _layerPanelOpen  = false;

  // Cluster scan state
  let _scanQueue         = [];
  let _scanIdx           = 0;
  let _scanHighlight     = null;
  let _activeScanToast   = null;
  let _scanSettings      = { rangeM: 20, minCount: 3, perSpecies: [] };
  let _scanDebounceTimer = null;

  // ── Render ────────────────────────────────────────────────────────────────

  async function render(container, params) {
    _surveyId = params?.surveyId || State.get('currentSurveyId');
    if (!_surveyId) { Router.navigate('home'); return; }
    State.set('currentSurveyId', _surveyId);

    const survey = await DB.get('surveys', _surveyId).catch(() => null);
    const surveyName = survey?.name || 'Survey';

    container.innerHTML = `
      <div class="map-screen">
        <div id="map"></div>

        <div class="map-controls-tl">
          <button class="map-back-btn" id="map-back">← Back</button>
          <span class="map-survey-label" title="${escapeHtml(surveyName)}">${escapeHtml(surveyName)}</span>
        </div>

        <div class="map-controls-tr">
          <button class="map-offline-btn" id="map-offline-btn" title="Save map for offline use">⬇ Offline</button>
          <button class="map-layer-btn" id="map-layers-btn">⊞ Layers</button>
          <div class="map-layer-panel" id="map-layer-panel" style="display:none"></div>
        </div>

        <button class="map-add-btn" id="map-add-btn">＋ Add Observation</button>

        <div class="gps-accuracy-bar" id="gps-bar" style="display:none"></div>
      </div>`;

    try {
      await _loadScanSettings();
      _initMap();
      _buildLayerPanel();
      _bindEvents();
      _loadMarkers();

      window._refreshMapMarkers = () => _loadMarkers();
      window._editObs    = _handleEditObs;
      window._deleteObs  = _handleDeleteObs;
      window._renameCluster = _handleRenameCluster;
    } catch (err) {
      console.error('[MapScreen] init failed:', err);
      container.innerHTML = `
        <div style="padding:2rem;text-align:center;max-width:420px;margin:auto">
          <h3 style="color:#c0392b;margin-bottom:12px">Map failed to load</h3>
          <p style="color:#555;margin-bottom:8px;font-size:.9rem">${escapeHtml(err.message)}</p>
          <p style="color:#888;margin-bottom:20px;font-size:.8rem">Check browser console for details.</p>
          <button class="btn btn-primary" onclick="Router.navigate('home')">← Back to Home</button>
        </div>`;
    }
  }

  // ── Map init ──────────────────────────────────────────────────────────────

  function _initMap() {
    const center = State.get('mapCenter') || CONFIG.MAP.DEFAULT_CENTER;
    const zoom   = State.get('mapZoom')   || CONFIG.MAP.DEFAULT_ZOOM;

    _map = L.map('map', {
      center, zoom,
      zoomControl:        true,
      attributionControl: true,
    });

    _tileLayer = Tiles.createLayer(_tileSource);
    _tileLayer.addTo(_map);

    _standLayer = L.layerGroup().addTo(_map);

    if (typeof L.markerClusterGroup === 'function') {
      _markerLayer = L.markerClusterGroup({
        maxClusterRadius:        40,
        disableClusteringAtZoom: 17,
        showCoverageOnHover:     false,
        iconCreateFunction: cluster => L.divIcon({
          html: `<div style="background:var(--green-primary);color:#fff;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.82rem;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)">${cluster.getChildCount()}</div>`,
          className: '', iconSize: [34, 34], iconAnchor: [17, 17],
        }),
      });
    } else {
      _markerLayer = L.layerGroup();
    }
    _map.addLayer(_markerLayer);

    if (typeof L.control.locate === 'function') {
      L.control.locate({
        position:  'bottomright',
        flyTo:      true,
        strings:  { title: 'My location' },
        locateOptions: { enableHighAccuracy: true, maxAge: 5000, timeout: 12000 },
      }).addTo(_map);
    }

    setTimeout(() => { if (_map) _map.invalidateSize(); }, 150);

    _map.on('moveend', () => {
      State.set('mapCenter', [_map.getCenter().lat, _map.getCenter().lng]);
      State.set('mapZoom',   _map.getZoom());
      State.set('mapBounds', _map.getBounds());
    });

    _map.on('locationfound', e => {
      State.set('gpsPosition', { lat: e.latlng.lat, lng: e.latlng.lng, accuracy: e.accuracy });
      const bar = document.getElementById('gps-bar');
      if (bar) { bar.style.display = 'block'; bar.textContent = `GPS ${formatAccuracy(e.accuracy)}`; }
    });

    _map.on('locationerror', () => {
      const bar = document.getElementById('gps-bar');
      if (bar) bar.style.display = 'none';
    });

    _setupLongPress();
  }

  // ── Long press ────────────────────────────────────────────────────────────

  function _setupLongPress() {
    const mapEl = document.getElementById('map');
    if (!mapEl) return;

    let timer = null, startX = 0, startY = 0, hasMoved = false;
    const THRESHOLD = 10, DELAY = 500;

    function start(clientX, clientY) {
      hasMoved = false;
      startX = clientX; startY = clientY;
      const rect   = mapEl.getBoundingClientRect();
      const point  = L.point(clientX - rect.left, clientY - rect.top);
      const latlng = _map.containerPointToLatLng(point);
      _showRipple(clientX - rect.left, clientY - rect.top);
      timer = setTimeout(() => { if (!hasMoved) _openFormAt(latlng); _removeRipple(); }, DELAY);
    }

    function move(clientX, clientY) {
      if (Math.hypot(clientX - startX, clientY - startY) > THRESHOLD) {
        hasMoved = true;
        clearTimeout(timer);
        _removeRipple();
      }
    }

    function end() { clearTimeout(timer); _removeRipple(); }

    mapEl.addEventListener('touchstart', e => {
      if (e.touches.length > 1) return;
      start(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    mapEl.addEventListener('touchmove',  e => move(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
    mapEl.addEventListener('touchend',   end, { passive: true });

    mapEl.addEventListener('mousedown',  e => { if (e.button === 0) start(e.clientX, e.clientY); });
    mapEl.addEventListener('mousemove',  e => move(e.clientX, e.clientY));
    mapEl.addEventListener('mouseup',    end);
    mapEl.addEventListener('mouseleave', end);
  }

  let _rippleEl = null;
  function _showRipple(x, y) {
    _removeRipple();
    const el = document.getElementById('map');
    if (!el) return;
    _rippleEl = document.createElement('div');
    _rippleEl.className = 'map-ripple';
    _rippleEl.style.left = x + 'px';
    _rippleEl.style.top  = y + 'px';
    el.appendChild(_rippleEl);
  }
  function _removeRipple() {
    if (_rippleEl) { _rippleEl.remove(); _rippleEl = null; }
  }

  function _openFormAt(latlng) {
    State.set('pendingObservationDraft', {
      lat: latlng.lat, lng: latlng.lng, accuracy: null, source: 'map-tap',
    });
    Router.navigate('form', { surveyId: _surveyId });
  }

  // ── Scan settings persistence ─────────────────────────────────────────────

  async function _loadScanSettings() {
    try {
      const saved = await DB.getRaw('appSettings', 'clusterScanSettings');
      if (saved) _scanSettings = saved;
    } catch {}
  }

  function _saveScanSettings() {
    DB.putRaw('appSettings', 'clusterScanSettings', _scanSettings).catch(() => {});
  }

  // ── Layer panel ───────────────────────────────────────────────────────────

  function _buildLayerPanel() {
    const panel = document.getElementById('map-layer-panel');
    if (!panel) return;

    const cats = [
      { key: 'tree',             label: 'Trees' },
      { key: 'shrub',            label: 'Shrubs' },
      { key: 'herbaceous',       label: 'Herbaceous' },
      { key: 'grass-sedge-rush', label: 'Grass/Sedge/Rush' },
      { key: 'fern-moss-lichen', label: 'Fern/Moss/Lichen' },
      { key: 'fungus',           label: 'Fungi' },
      { key: 'invasive',         label: 'Invasives' },
      { key: 'bird',             label: 'Birds' },
      { key: 'mammal',           label: 'Mammals' },
      { key: 'reptile',          label: 'Reptiles' },
      { key: 'amphibian',        label: 'Amphibians' },
      { key: 'fish',             label: 'Fish' },
      { key: 'invertebrate',     label: 'Invertebrates' },
      { key: 'sign-evidence',    label: 'Sign/Evidence' },
    ];

    const toggles = State.get('activeLayerToggles');

    const typesContent = cats.map(c => {
      const color  = Markers.colorForCat(c.key);
      const hidden = toggles[c.key] === false;
      return `<button class="layer-toggle-chip${hidden ? ' hidden' : ''}" data-cat="${c.key}">
        <span class="cat-dot" style="background:${color}"></span>${c.label}
      </button>`;
    }).join('');

    const providerBtns = Object.entries(CONFIG.TILE_PROVIDERS)
      .map(([k, p]) => `<button class="tile-source-btn${k === _tileSource ? ' active' : ''}" data-provider="${k}">${p.name}</button>`)
      .join('');

    const rulesHtml = _scanSettings.perSpecies.map((rule, i) => `
      <div class="scan-rule-row" data-rule-idx="${i}">
        <span class="rule-species-label">${escapeHtml(rule.specName || 'Unknown')}</span>
        <span class="rule-detail">${rule.rangeM}m / ${rule.minCount}+</span>
        <button class="rule-del" data-idx="${i}">×</button>
      </div>`).join('');

    panel.innerHTML = `
      <div class="layer-tabs">
        <button class="layer-tab active" data-tab="types">Obs Types</button>
        <button class="layer-tab" data-tab="style">Map Style</button>
        <button class="layer-tab" data-tab="clusters">Clusters</button>
      </div>
      <div class="layer-tab-pane active" id="ltab-types">
        ${typesContent}
      </div>
      <div class="layer-tab-pane" id="ltab-style">
        <div class="tile-source-toggles" style="border-top:none;margin-top:0;padding-top:0">
          ${providerBtns}
        </div>
      </div>
      <div class="layer-tab-pane" id="ltab-clusters">
        <div class="scan-settings">
          <div class="form-group scan-range-group">
            <div class="scan-range-label">
              <span>Cluster Range</span>
              <span class="scan-range-val">${_scanSettings.rangeM}m</span>
            </div>
            <input type="range" id="scan-range" min="5" max="100" step="5" value="${_scanSettings.rangeM}">
          </div>
          <div class="scan-count-row">
            <label for="scan-min">Min. observations</label>
            <input type="number" id="scan-min" min="2" max="20" value="${_scanSettings.minCount}">
          </div>
          <div class="scan-rules-section">
            <div class="scan-rules-header">
              <span>Per-Species Rules</span>
              <button class="btn btn-sm btn-secondary" id="scan-add-rule">+ Add</button>
            </div>
            <div id="scan-rules">${rulesHtml || '<span class="scan-no-rules">No custom rules</span>'}</div>
          </div>
          <button class="btn btn-primary" id="scan-btn" style="width:100%;margin-top:12px">
            Scan for Clusters
          </button>
        </div>
      </div>`;

    // Tab switching
    panel.querySelectorAll('.layer-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.tab;
        panel.querySelectorAll('.layer-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
        panel.querySelectorAll('.layer-tab-pane').forEach(p => p.classList.toggle('active', p.id === `ltab-${t}`));
      });
    });

    // Observation type toggles
    panel.querySelectorAll('[data-cat]').forEach(btn => {
      btn.addEventListener('click', () => {
        const cat = btn.dataset.cat;
        const t   = State.get('activeLayerToggles');
        t[cat]    = (t[cat] === false) ? true : false;
        State.set('activeLayerToggles', t);
        btn.classList.toggle('hidden', t[cat] === false);
        _loadMarkers();
      });
    });

    // Tile provider buttons
    panel.querySelectorAll('[data-provider]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.provider;
        if (_tileLayer) _tileLayer.remove();
        try { _tileLayer = Tiles.createLayer(key); _tileLayer.addTo(_map); _tileLayer.bringToBack(); _tileSource = key; }
        catch { UI.toastError('Cannot switch layer'); }
        panel.querySelectorAll('[data-provider]').forEach(b => b.classList.toggle('active', b.dataset.provider === key));
      });
    });

    // Cluster tab events
    panel.querySelector('#scan-range')?.addEventListener('input', e => {
      const val = Number(e.target.value);
      const lbl = panel.querySelector('.scan-range-val');
      if (lbl) lbl.textContent = val + 'm';
      _scanSettings.rangeM = val;
      _saveScanSettings();
      clearTimeout(_scanDebounceTimer);
      _scanDebounceTimer = setTimeout(() => {
        _layerPanelOpen = false;
        const p = document.getElementById('map-layer-panel');
        if (p) p.style.display = 'none';
        _startAutoScan();
      }, 800);
    });

    panel.querySelector('#scan-min')?.addEventListener('change', e => {
      _scanSettings.minCount = Math.max(2, Number(e.target.value) || 3);
      _saveScanSettings();
    });

    panel.querySelectorAll('.rule-del').forEach(btn => {
      btn.addEventListener('click', () => {
        _scanSettings.perSpecies.splice(Number(btn.dataset.idx), 1);
        _saveScanSettings();
        _buildLayerPanel();
        // Reopen clusters tab after rebuild
        const panel2 = document.getElementById('map-layer-panel');
        panel2?.querySelectorAll('.layer-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === 'clusters'));
        panel2?.querySelectorAll('.layer-tab-pane').forEach(p => p.classList.toggle('active', p.id === 'ltab-clusters'));
      });
    });

    panel.querySelector('#scan-add-rule')?.addEventListener('click', _addScanRule);

    panel.querySelector('#scan-btn')?.addEventListener('click', () => {
      _layerPanelOpen = false;
      document.getElementById('map-layer-panel').style.display = 'none';
      _startAutoScan();
    });
  }

  // ── Per-species rule addition ─────────────────────────────────────────────

  async function _addScanRule() {
    let allObs;
    try { allObs = await DB.getAllByIndex('observations', 'surveyId', _surveyId); }
    catch { allObs = []; }

    const seen = new Map();
    for (const o of allObs) {
      if (Clusters.PLANT_CATS.has(o.category) && o.gbifKey && !seen.has(o.gbifKey)) {
        seen.set(o.gbifKey, o.commonName || o.scientificName || String(o.gbifKey));
      }
    }

    if (!seen.size) {
      UI.toast('No plant species recorded in this survey yet', 'info', [], 3500);
      return;
    }

    const existingKeys = new Set(_scanSettings.perSpecies.map(r => r.gbifKey));
    const available = [...seen.entries()].filter(([k]) => !existingKeys.has(k));

    if (!available.length) {
      UI.toast('All observed plant species already have custom rules', 'info', [], 3500);
      return;
    }

    const bodyEl = document.createElement('div');
    bodyEl.innerHTML = `
      <div class="form-group">
        <label>Species</label>
        <select id="rule-sp-pick">
          ${available.map(([k, n]) => `<option value="${k}">${escapeHtml(n)}</option>`).join('')}
        </select>
      </div>
      <div style="display:flex;gap:12px">
        <div class="form-group" style="flex:1">
          <label>Range (m)</label>
          <input type="number" id="rule-range-pick" min="5" max="200" step="5" value="${_scanSettings.rangeM}">
        </div>
        <div class="form-group" style="width:90px">
          <label>Min. Count</label>
          <input type="number" id="rule-min-pick" min="2" max="20" value="${_scanSettings.minCount}">
        </div>
      </div>`;

    await new Promise(resolve => {
      UI.modal('Per-Species Rule', bodyEl, {
        buttons: [
          { label: 'Cancel',   style: 'btn-secondary', action: () => resolve() },
          { label: 'Add Rule', style: 'btn-primary',   action: () => {
            const gbifKey  = Number(document.getElementById('rule-sp-pick')?.value);
            const specName = available.find(([k]) => k === gbifKey)?.[1] || 'Unknown';
            _scanSettings.perSpecies.push({
              gbifKey,
              specName,
              rangeM:   Number(document.getElementById('rule-range-pick')?.value  || _scanSettings.rangeM),
              minCount: Number(document.getElementById('rule-min-pick')?.value || _scanSettings.minCount),
            });
            _saveScanSettings();
            _buildLayerPanel();
            const panel = document.getElementById('map-layer-panel');
            panel?.querySelectorAll('.layer-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === 'clusters'));
            panel?.querySelectorAll('.layer-tab-pane').forEach(p => p.classList.toggle('active', p.id === 'ltab-clusters'));
            resolve();
          }},
        ],
      });
    });
  }

  // ── Auto-scan flow ────────────────────────────────────────────────────────

  async function _startAutoScan() {
    if (!_map || !_surveyId) return;
    UI.loading(true, 'Scanning for clusters…');
    try {
      _scanQueue = await Clusters.autoScan(_surveyId, _scanSettings);
    } finally {
      UI.loading(false);
    }

    if (!_scanQueue.length) {
      UI.toast('No new clusters found with current settings', 'info', [], 4000);
      return;
    }

    _scanIdx = 0;
    _processNextScan();
  }

  function _processNextScan() {
    if (_activeScanToast) { _activeScanToast.dismiss(); _activeScanToast = null; }

    if (_scanIdx >= _scanQueue.length) {
      _clearScanHighlight();
      const total = _scanQueue.length;
      UI.toastSuccess(`Scan complete — ${total} potential cluster${total !== 1 ? 's' : ''} reviewed`);
      _scanQueue = [];
      return;
    }

    const item = _scanQueue[_scanIdx];

    if (!_scanHighlight) _scanHighlight = L.layerGroup().addTo(_map);
    _scanHighlight.clearLayers();

    if (item.type === 'expand') {
      // ── Expand: add one ungrouped obs to an existing cluster ──────────────
      const { observation: obs, stand } = item;
      const specName = obs.commonName || obs.scientificName || 'Species';
      const clusterName = stand.name || stand.primarySpeciesName || 'Cluster';

      // Highlight the candidate obs
      L.circleMarker([obs.lat, obs.lng], {
        radius: 13, fillColor: '#f39c12', color: '#e67e22',
        weight: 3, fillOpacity: 0.7, opacity: 1,
      }).addTo(_scanHighlight);

      // Also pulse the cluster centroid / members so it's clear which cluster
      if (stand.centroid) {
        L.circleMarker([stand.centroid.lat, stand.centroid.lng], {
          radius: 16, fillColor: '#8e44ad', color: '#6c3483',
          weight: 3, fillOpacity: 0.4, opacity: 1,
        }).addTo(_scanHighlight);
      }

      // Zoom to include both the obs and the cluster centroid
      const pts = [[obs.lat, obs.lng]];
      if (stand.centroid) pts.push([stand.centroid.lat, stand.centroid.lng]);
      _map.fitBounds(L.latLngBounds(pts).pad(0.5), { animate: true, maxZoom: 18 });

      _activeScanToast = UI.expandClusterToast(specName, clusterName, {
        onYes: async () => {
          _activeScanToast = null;
          _clearScanHighlight();
          obs.standId = stand.id;
          await DB.put('observations', obs);
          await Clusters.refreshStand(_surveyId, stand.id);
          window._refreshMapMarkers?.();
          _scanIdx++;
          setTimeout(_processNextScan, 400);
        },
        onSkip: () => {
          _activeScanToast = null;
          _clearScanHighlight();
          _scanIdx++;
          _processNextScan();
        },
      });

    } else {
      // ── New: form a brand-new cluster from ungrouped obs ──────────────────
      const obs     = item.observations;
      const gbifKey = obs[0].gbifKey;

      for (const o of obs) {
        L.circleMarker([o.lat, o.lng], {
          radius: 13, fillColor: '#f39c12', color: '#e67e22',
          weight: 3, fillOpacity: 0.7, opacity: 1,
        }).addTo(_scanHighlight);
      }

      const bounds = L.latLngBounds(obs.map(o => [o.lat, o.lng]));
      _map.fitBounds(bounds.pad(0.5), { animate: true, maxZoom: 18 });

      let maxDist = 0;
      for (let i = 0; i < obs.length; i++)
        for (let j = i + 1; j < obs.length; j++) {
          const d = distanceMeters(obs[i].lat, obs[i].lng, obs[j].lat, obs[j].lng);
          if (d > maxDist) maxDist = d;
        }

      const specName = obs[0].commonName || obs[0].scientificName || 'Species';

      _activeScanToast = UI.scanClusterToast(specName, obs.length, maxDist, {
        onYes: async () => {
          _activeScanToast = null;
          _clearScanHighlight();
          await Clusters.createFromScan(_surveyId, item);
          window._refreshMapMarkers?.();
          _scanIdx++;
          setTimeout(_processNextScan, 400);
        },
        onSkip: () => {
          _activeScanToast = null;
          _clearScanHighlight();
          _scanIdx++;
          _processNextScan();
        },
        onSkipAll: () => {
          _activeScanToast = null;
          _clearScanHighlight();
          _scanQueue = _scanQueue.filter((c, i) =>
            i < _scanIdx || (c.type !== 'new' || c.observations[0].gbifKey !== gbifKey)
          );
          _processNextScan();
        },
      });
    }
  }

  function _clearScanHighlight() {
    if (_scanHighlight) _scanHighlight.clearLayers();
  }

  // ── Cluster rename ────────────────────────────────────────────────────────

  async function _handleRenameCluster(standId) {
    const stand = await DB.get('stands', standId).catch(() => null);
    if (!stand) return;

    const currentName = stand.name || stand.primarySpeciesName || 'Cluster';
    const bodyEl = document.createElement('div');
    bodyEl.innerHTML = `
      <div class="form-group">
        <label>Cluster Name</label>
        <input type="text" id="rename-cluster-input" value="${escapeHtml(currentName)}" autocomplete="off">
      </div>`;

    await new Promise(resolve => {
      UI.modal('Rename Cluster', bodyEl, {
        buttons: [
          { label: 'Cancel', style: 'btn-secondary', action: () => resolve() },
          { label: 'Save',   style: 'btn-primary',   action: async () => {
            const name = document.getElementById('rename-cluster-input')?.value?.trim();
            if (!name) return;
            stand.name = name;
            stand.updatedAt = now();
            await DB.put('stands', stand);
            _loadMarkers();
            resolve();
          }},
        ],
      });
      setTimeout(() => {
        const inp = document.getElementById('rename-cluster-input');
        if (inp) { inp.focus(); inp.select(); }
      }, 80);
    });
  }

  // ── Load markers ──────────────────────────────────────────────────────────

  async function _loadMarkers() {
    if (!_map || !_surveyId) return;
    _markerLayer.clearLayers();
    _standLayer.clearLayers();

    try {
      const [obs, stands] = await Promise.all([
        DB.getAllByIndex('observations', 'surveyId', _surveyId),
        DB.getAllByIndex('stands',       'surveyId', _surveyId),
      ]);

      const toggles = State.get('activeLayerToggles');

      for (const o of obs) {
        if (!o.lat || !o.lng) continue;
        if (toggles[o.category] === false) continue;
        _markerLayer.addLayer(Markers.createObsMarker(o));
      }

      for (const s of stands) {
        if (!s.polygon || s.polygon.length < 3) continue;
        if (toggles[s.category] === false) continue;
        const poly = Markers.createStandMarker(s);
        if (poly) _standLayer.addLayer(poly);
      }
    } catch (err) {
      console.error('[MapScreen] _loadMarkers:', err);
    }
  }

  // ── Event bindings ────────────────────────────────────────────────────────

  function _bindEvents() {
    document.getElementById('map-back')?.addEventListener('click', () => Router.navigate('home'));

    document.getElementById('map-offline-btn')?.addEventListener('click', _startOfflineCache);

    document.getElementById('map-layers-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      _layerPanelOpen = !_layerPanelOpen;
      document.getElementById('map-layer-panel').style.display = _layerPanelOpen ? 'block' : 'none';
    });

    document.getElementById('map-add-btn')?.addEventListener('click', () => {
      const gps = State.get('gpsPosition');
      State.set('pendingObservationDraft', gps
        ? { lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy, source: 'gps' }
        : { lat: _map.getCenter().lat, lng: _map.getCenter().lng, accuracy: null, source: 'map-center' }
      );
      Router.navigate('form', { surveyId: _surveyId });
    });

    document.addEventListener('click', _outsideClick);
  }

  function _outsideClick(e) {
    if (!_layerPanelOpen) return;
    const panel = document.getElementById('map-layer-panel');
    const btn   = document.getElementById('map-layers-btn');
    if (panel && !panel.contains(e.target) && e.target !== btn) {
      _layerPanelOpen = false;
      panel.style.display = 'none';
    }
  }

  // ── Popup action handlers ─────────────────────────────────────────────────

  async function _handleEditObs(obsId) {
    const obs = await DB.get('observations', obsId).catch(() => null);
    if (!obs) return;
    State.set('pendingObservationDraft', { ...obs, _editing: true });
    Router.navigate('form', { surveyId: _surveyId, obsId });
  }

  async function _handleDeleteObs(obsId) {
    const obs = await DB.get('observations', obsId).catch(() => null);
    if (!obs) return;
    const name = obs.commonName || obs.scientificName || 'this observation';
    const ok = await UI.confirm(`Delete "${name}"?`, 'Delete Observation', {
      confirmLabel: 'Delete', dangerous: true,
    });
    if (!ok) return;
    const standId = obs.standId;
    await DB.delete('observations', obsId);
    _map.closePopup();
    if (standId) Clusters.refreshStand(_surveyId, standId).catch(() => {});
    _loadMarkers();
    UI.toastSuccess('Observation deleted');
  }

  // ── Offline tile cache ────────────────────────────────────────────────────

  async function _startOfflineCache() {
    if (!_map) return;
    const bounds = _map.getBounds();
    const minZ   = CONFIG.MAP.CACHE_MIN_ZOOM;
    const maxZ   = CONFIG.MAP.CACHE_MAX_ZOOM;

    const fakeBounds = {
      getSouth: () => bounds.getSouth(),
      getNorth: () => bounds.getNorth(),
      getWest:  () => bounds.getWest(),
      getEast:  () => bounds.getEast(),
    };

    const est = Tiles.estimateTileCount(fakeBounds, minZ, maxZ);
    const survey = await DB.get('surveys', _surveyId).catch(() => null);
    const defaultName = survey?.siteName || survey?.name || 'Survey Area';

    const nameInput = document.createElement('div');
    nameInput.innerHTML = `
      <p style="margin-bottom:10px;font-size:.9rem;color:var(--text-secondary)">
        Cache ~${est} tiles (z${minZ}–${maxZ}) for offline use.<br>
        Estimated download: ~${Math.round(est * 15 / 1024)} MB
      </p>
      <div class="form-group">
        <label>Region Name</label>
        <input type="text" id="offline-region-name" value="${escapeHtml(defaultName)}" autocomplete="off">
      </div>
      <div id="offline-progress" style="display:none;margin-top:10px">
        <div class="progress-bar-wrap"><div class="progress-bar-fill" id="offline-prog-bar" style="width:0%"></div></div>
        <p class="text-small text-muted" id="offline-prog-text" style="margin-top:4px">Starting…</p>
      </div>`;

    const { close } = UI.modal('Save Map for Offline Use', nameInput, {
      buttons: [
        { label: 'Cancel', style: 'btn-secondary', action: () => {} },
        { label: 'Download', style: 'btn-primary', close: false, action: async () => {
          const name = document.getElementById('offline-region-name')?.value?.trim() || defaultName;
          const prog = document.getElementById('offline-progress');
          const bar  = document.getElementById('offline-prog-bar');
          const txt  = document.getElementById('offline-prog-text');
          const dlBtn = document.querySelector('.modal-footer .btn-primary');
          if (dlBtn) dlBtn.disabled = true;
          if (prog) prog.style.display = 'block';

          try {
            await Tiles.cacheRegion({ getBounds: () => fakeBounds }, _tileSource, name, ({ done, total, failed }) => {
              const pct = Math.round(done / total * 100);
              if (bar) bar.style.width = pct + '%';
              if (txt) txt.textContent = `${done} / ${total} tiles (${failed} failed)`;
            });
            close();
            UI.toastSuccess(`"${name}" cached — ${est} tiles saved`);
          } catch (err) {
            if (dlBtn) dlBtn.disabled = false;
            UI.toastError('Cache failed: ' + err.message);
          }
        }},
      ],
    });

    setTimeout(() => document.getElementById('offline-region-name')?.focus(), 80);
  }

  // ── Destroy ───────────────────────────────────────────────────────────────

  function destroy() {
    document.removeEventListener('click', _outsideClick);
    clearTimeout(_scanDebounceTimer);
    _scanDebounceTimer = null;
    if (_activeScanToast) { _activeScanToast.dismiss(); _activeScanToast = null; }
    _clearScanHighlight();
    _scanQueue = [];
    _scanIdx   = 0;
    window._refreshMapMarkers = null;
    window._editObs           = null;
    window._deleteObs         = null;
    window._renameCluster     = null;
    if (_map) { _map.remove(); _map = null; }
    _markerLayer  = null;
    _standLayer   = null;
    _tileLayer    = null;
    _scanHighlight = null;
    _surveyId     = null;
  }

  return { render, destroy };
})();
