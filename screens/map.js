const MapScreen = (() => {
  let _map             = null;
  let _markerLayer     = null;
  let _standLayer      = null;
  let _tileLayer       = null;
  let _surveyId        = null;
  let _tileSource      = 'osm';
  let _layerPanelOpen  = false;

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
      _initMap();
      _buildLayerPanel();
      _bindEvents();
      _loadMarkers();

      window._refreshMapMarkers = () => _loadMarkers();
      window._editObs    = _handleEditObs;
      window._deleteObs  = _handleDeleteObs;
      window._editStand  = _handleEditStand;
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
      zoomControl:       true,
      attributionControl: true,
    });

    _tileLayer = Tiles.createLayer(_tileSource);
    _tileLayer.addTo(_map);

    _standLayer = L.layerGroup().addTo(_map);

    if (typeof L.markerClusterGroup === 'function') {
      _markerLayer = L.markerClusterGroup({
        maxClusterRadius:       40,
        disableClusteringAtZoom: 17,
        showCoverageOnHover:    false,
        iconCreateFunction: cluster => L.divIcon({
          html: `<div style="background:var(--green-primary);color:#fff;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.82rem;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)">${cluster.getChildCount()}</div>`,
          className: '', iconSize: [34, 34], iconAnchor: [17, 17],
        }),
      });
    } else {
      _markerLayer = L.layerGroup();
    }
    _map.addLayer(_markerLayer);

    // Locate control (GPS button) — plugin may not be loaded
    if (typeof L.control.locate === 'function') {
      L.control.locate({
        position:  'bottomright',
        flyTo:      true,
        strings:  { title: 'My location' },
        locateOptions: { enableHighAccuracy: true, maxAge: 5000, timeout: 12000 },
      }).addTo(_map);
    }

    // Ensure Leaflet reads the correct map container dimensions
    setTimeout(() => { if (_map) _map.invalidateSize(); }, 150);

    // Persist map state
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

    // Mouse support for laptop testing
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

    const providerBtns = Object.entries(CONFIG.TILE_PROVIDERS)
      .map(([k, p]) => `<button class="tile-source-btn${k === _tileSource ? ' active' : ''}" data-provider="${k}">${p.name}</button>`)
      .join('');

    panel.innerHTML = `
      <h4>Observation Types</h4>
      ${cats.map(c => {
        const color  = Markers.colorForCat(c.key);
        const hidden = toggles[c.key] === false;
        return `<button class="layer-toggle-chip${hidden ? ' hidden' : ''}" data-cat="${c.key}">
          <span class="cat-dot" style="background:${color}"></span>${c.label}
        </button>`;
      }).join('')}
      <div class="tile-source-toggles">
        <h4>Map Style</h4>
        ${providerBtns}
      </div>`;

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

    panel.querySelectorAll('[data-provider]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.provider;
        if (_tileLayer) _tileLayer.remove();
        try { _tileLayer = Tiles.createLayer(key); _tileLayer.addTo(_map); _tileLayer.bringToBack(); _tileSource = key; }
        catch { UI.toastError('Cannot switch layer — no API key?'); }
        panel.querySelectorAll('[data-provider]').forEach(b => b.classList.toggle('active', b.dataset.provider === key));
      });
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
    await DB.delete('observations', obsId);
    _map.closePopup();
    _loadMarkers();
    UI.toastSuccess('Observation deleted');
  }

  function _handleEditStand() {
    UI.toast('Stand editing coming soon', 'info');
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
    window._refreshMapMarkers = null;
    window._editObs   = null;
    window._deleteObs = null;
    window._editStand = null;
    if (_map) { _map.remove(); _map = null; }
    _markerLayer = null;
    _standLayer  = null;
    _tileLayer   = null;
    _surveyId    = null;
  }

  return { render, destroy };
})();
