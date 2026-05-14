const FormScreen = (() => {
  let _surveyId        = null;
  let _obsId           = null;
  let _editingObs      = null;
  let _selectedCat     = null;
  let _selectedSpecies = null;
  let _photos          = [];
  let _tags            = [];
  let _lat             = null;
  let _lng             = null;
  let _accuracy        = null;
  let _locSource       = 'gps';
  let _searchTimer     = null;
  let _searchAbort     = null;
  let _selectedStandId = null;

  const CAT_DEFS = [
    { key: 'tree',             icon: '🌳', label: 'Tree' },
    { key: 'shrub',            icon: '🌿', label: 'Shrub' },
    { key: 'herbaceous',       icon: '🌱', label: 'Herb' },
    { key: 'grass-sedge-rush', icon: '🌾', label: 'Grass/\nSedge' },
    { key: 'fern-moss-lichen', icon: '🍀', label: 'Fern/\nMoss' },
    { key: 'fungus',           icon: '🍄', label: 'Fungus' },
    { key: 'invasive',         icon: '⚠',  label: 'Invasive' },
    { key: 'bird',             icon: '🐦', label: 'Bird' },
    { key: 'mammal',           icon: '🦌', label: 'Mammal' },
    { key: 'reptile',          icon: '🦎', label: 'Reptile' },
    { key: 'amphibian',        icon: '🐸', label: 'Amph.' },
    { key: 'fish',             icon: '🐟', label: 'Fish' },
    { key: 'invertebrate',     icon: '🦋', label: 'Invert.' },
    { key: 'sign-evidence',    icon: '👁',  label: 'Sign' },
  ];

  // ── Render ────────────────────────────────────────────────────────────────

  async function render(container, params) {
    _surveyId = params?.surveyId || State.get('currentSurveyId');
    _obsId    = params?.obsId    || null;

    // Reset state
    _editingObs = null; _selectedCat = null; _selectedSpecies = null; _photos = []; _tags = [];
    _lat = null; _lng = null; _accuracy = null; _locSource = 'gps'; _selectedStandId = null;

    if (_obsId) {
      _editingObs = await DB.get('observations', _obsId).catch(() => null);
    }

    const draft = State.get('pendingObservationDraft');

    if (_editingObs) {
      _lat = _editingObs.lat; _lng = _editingObs.lng;
      _accuracy  = _editingObs.accuracy  || null;
      _locSource = _editingObs.locationSource || 'saved';
      _selectedCat     = _editingObs.category || null;
      _selectedStandId = _editingObs.standId  || null;
      _selectedSpecies = _editingObs.gbifKey
        ? { gbifKey: _editingObs.gbifKey, scientificName: _editingObs.scientificName, commonName: _editingObs.commonName }
        : null;
      _photos = _editingObs.photos || [];
    } else if (draft) {
      _lat = draft.lat; _lng = draft.lng;
      _accuracy = draft.accuracy; _locSource = draft.source || 'gps';
      State.set('pendingObservationDraft', null);
    } else {
      const gps = State.get('gpsPosition');
      if (gps) { _lat = gps.lat; _lng = gps.lng; _accuracy = gps.accuracy; _locSource = 'gps'; }
    }

    container.innerHTML = `
      <div class="sheet-overlay" id="form-overlay"></div>
      <div class="bottom-sheet" id="obs-sheet">
        <div class="sheet-handle"><div class="sheet-handle-bar"></div></div>
        <div class="sheet-header">
          <span class="sheet-title">${_editingObs ? 'Edit Observation' : 'New Observation'}</span>
          <button class="btn-icon" id="form-close" style="color:var(--text-muted);font-size:1.4rem">×</button>
        </div>
        <div class="sheet-body" id="form-body"></div>
        <div class="sheet-footer">
          <button class="btn btn-primary btn-full" id="form-save">
            ${_editingObs ? 'Save Changes' : 'Save Observation'}
          </button>
        </div>
      </div>`;

    _renderBody();
    _bindSheetEvents();
  }

  // ── Body rendering ────────────────────────────────────────────────────────

  function _renderBody() {
    const body = document.getElementById('form-body');
    if (!body) return;
    body.innerHTML =
      _sectionLocation() +
      _sectionCategory() +
      _sectionSpecies() +
      `<div id="cluster-section"></div>` +
      _sectionCore() +
      `<div id="cat-extra"></div>` +
      _sectionTags() +
      _sectionRare() +
      _sectionPhotos();
    _bindBodyEvents();
    if (_selectedCat) { _highlightCat(_selectedCat); _renderCatExtra(_selectedCat); }
    if (_editingObs)  _populateEditing();
    _loadAndRenderClusterSelector(); // async, fire-and-forget
  }

  function _sectionLocation() {
    const latStr = _lat != null ? formatCoord(_lat, 'N', 'S') : '—';
    const lngStr = _lng != null ? formatCoord(_lng, 'E', 'W') : '—';
    const accStr = formatAccuracy(_accuracy);
    const srcStr = { gps: 'GPS', 'map-tap': 'Map tap', 'map-center': 'Map center', saved: 'Saved' }[_locSource] || _locSource;
    return `
      <div class="sheet-section">
        <div class="sheet-section-title">Location</div>
        <div class="location-display">
          <div class="location-coords" id="loc-coords">${latStr}, ${lngStr}</div>
          <div>
            <div class="location-accuracy" id="loc-acc">${accStr}</div>
            <div class="location-source" id="loc-src">${srcStr}</div>
          </div>
          <button class="btn btn-sm btn-secondary" id="loc-gps-btn">Use GPS</button>
        </div>
      </div>`;
  }

  function _sectionCategory() {
    return `
      <div class="sheet-section">
        <div class="sheet-section-title">Category <span style="color:#dc3545">*</span></div>
        <div class="category-grid">
          ${CAT_DEFS.map(c =>
            `<button class="cat-btn${_selectedCat === c.key ? ' selected' : ''}" data-cat="${c.key}">
               <span class="cat-icon">${c.icon}</span>
               <span class="cat-label">${c.label}</span>
             </button>`
          ).join('')}
        </div>
      </div>`;
  }

  function _sectionSpecies() {
    if (_selectedSpecies) {
      const common = _selectedSpecies.commonName || _selectedSpecies.scientificName;
      const sci    = _selectedSpecies.scientificName !== common ? _selectedSpecies.scientificName : '';
      return `
        <div class="sheet-section" id="species-section">
          <div class="sheet-section-title">Species</div>
          <div class="species-selected-display">
            <div class="sp-info">
              <div class="sp-common">${escapeHtml(common)}</div>
              ${sci ? `<div class="sp-scientific">${escapeHtml(sci)}</div>` : ''}
            </div>
            <button class="sp-clear" id="sp-clear">×</button>
          </div>
        </div>`;
    }
    return `
      <div class="sheet-section" id="species-section">
        <div class="sheet-section-title">Species</div>
        <div class="species-search-wrapper">
          <input type="text" id="sp-search"
                 placeholder="${_selectedCat ? 'Search species…' : 'Select a category first…'}"
                 autocomplete="off" autocorrect="off" spellcheck="false"
                 ${!_selectedCat ? 'disabled' : ''}>
          <div class="species-results" id="sp-results" style="display:none"></div>
        </div>
      </div>`;
  }

  function _sectionCore() {
    const count = _editingObs?.count || 1;
    const notes = _editingObs?.notes || '';
    return `
      <div class="sheet-section">
        <div class="sheet-section-title">Details</div>
        <div class="form-group">
          <label>Count</label>
          <div class="input-stepper">
            <button class="stepper-btn" id="cnt-dec">−</button>
            <input type="number" id="obs-count" value="${count}" min="1" max="9999">
            <button class="stepper-btn" id="cnt-inc">＋</button>
          </div>
        </div>
        <div class="form-group">
          <label>Notes</label>
          <textarea id="obs-notes" rows="3" placeholder="Condition, habitat context, behavior…">${escapeHtml(notes)}</textarea>
        </div>
      </div>`;
  }

  const COVER_OPTS = ['<1%','1-5%','6-25%','26-50%','51-75%','76-100%'];
  const LIFE_STAGE_OPTS = ['Seedling','Sapling','Mature','Overmature','Snag','Stump','Unknown'];
  const CONDITION_OPTS  = ['Excellent','Good','Fair','Poor','Dead','Unknown'];
  const SEX_OPTS        = ['Unknown','Male','Female','Juvenile','Mixed group'];
  const PLANT_CATS      = ['tree','shrub','herbaceous','grass-sedge-rush','fern-moss-lichen','fungus','invasive'];
  const ANIMAL_CATS     = ['bird','mammal','reptile','amphibian','fish','invertebrate'];

  function _covSelect(val) {
    return `<select id="obs-cov"><option value="">— select —</option>` +
      COVER_OPTS.map(o => `<option value="${o}"${val===o?' selected':''}>${o === '<1%' ? '&lt;1%' : o}</option>`).join('') +
      `</select>`;
  }
  function _lifeStageSelect(val) {
    return `<select id="obs-life-stage">${_opts(LIFE_STAGE_OPTS, val)}</select>`;
  }
  function _conditionSelect(val) {
    return `<select id="obs-condition">${_opts(CONDITION_OPTS, val)}</select>`;
  }
  function _sexSelect(val) {
    return `<select id="obs-sex">${_opts(SEX_OPTS, val)}</select>`;
  }

  function _renderCatExtra(cat) {
    const el = document.getElementById('cat-extra');
    if (!el) return;
    const obs = _editingObs || {};
    const heightFt  = obs.heightM ? (obs.heightM * 3.28084).toFixed(1) : '';
    const dbh       = obs.dbhCm       || '';
    const cov       = obs.coveragePct != null ? String(obs.coveragePct) : '';
    const beh       = obs.behavior    || '';
    const dist      = obs.distanceM   || '';
    const sign      = obs.signType    || '';
    const lifeStage = obs.lifeStage   || '';
    const condition = obs.condition   || '';
    const sex       = obs.sex         || '';

    const plantExtra = `
      <div class="form-group"><label>Life Stage</label>${_lifeStageSelect(lifeStage)}</div>
      <div class="form-group"><label>Condition</label>${_conditionSelect(condition)}</div>`;
    const sexRow = `<div class="form-group"><label>Sex</label>${_sexSelect(sex)}</div>`;

    let html = '';

    if (cat === 'tree' || cat === 'shrub') {
      html = `
        <div class="sheet-section">
          <div class="sheet-section-title">${cat === 'tree' ? 'Tree' : 'Shrub'} Measurements</div>
          <div class="form-group"><label>Height (ft)</label>
            <input type="number" id="obs-height" value="${heightFt}" min="0" step="0.5" placeholder="optional"></div>
          ${cat === 'tree' ? `<div class="form-group"><label>DBH (cm)</label>
            <input type="number" id="obs-dbh" value="${dbh}" min="0" step="1" placeholder="optional"></div>` : ''}
          <div class="form-group"><label>Cover Estimate</label>${_covSelect(cov)}</div>
          ${plantExtra}
        </div>`;
    } else if (PLANT_CATS.includes(cat)) {
      html = `
        <div class="sheet-section">
          <div class="sheet-section-title">Plant Details</div>
          <div class="form-group"><label>Cover Estimate</label>${_covSelect(cov)}</div>
          ${plantExtra}
        </div>`;
    } else if (cat === 'bird') {
      const opts = ['Singing','Calling','Seen','Flying','Nest/Eggs','Carrying food','Distress call'];
      html = `
        <div class="sheet-section">
          <div class="sheet-section-title">Bird Details</div>
          <div class="form-group"><label>Behavior / Detection</label>
            <select id="obs-beh">${_opts(opts, beh)}</select></div>
          <div class="form-group"><label>Distance (m)</label>
            <input type="number" id="obs-dist" value="${dist}" min="0" step="5" placeholder="e.g. 30"></div>
          ${sexRow}
        </div>`;
    } else if (cat === 'mammal') {
      const opts = ['Seen','Heard','Tracks','Scat','Den','Burrow','Hair/Fur'];
      html = `
        <div class="sheet-section">
          <div class="sheet-section-title">Mammal Details</div>
          <div class="form-group"><label>Detection Type</label>
            <select id="obs-beh">${_opts(opts, beh)}</select></div>
          ${sexRow}
        </div>`;
    } else if (cat === 'reptile' || cat === 'amphibian') {
      const opts = ['Seen','Heard (call)','Basking','Breeding/Egg mass','Tadpoles/Larvae','Road mortality'];
      html = `
        <div class="sheet-section">
          <div class="sheet-section-title">${cat === 'reptile' ? 'Reptile' : 'Amphibian'} Details</div>
          <div class="form-group"><label>Behavior</label>
            <select id="obs-beh">${_opts(opts, beh)}</select></div>
          ${sexRow}
        </div>`;
    } else if (cat === 'fish') {
      const opts = ['Seen','Electrofishing','Angling','Net capture','Spawning activity'];
      html = `
        <div class="sheet-section">
          <div class="sheet-section-title">Fish Details</div>
          <div class="form-group"><label>Detection</label>
            <select id="obs-beh">${_opts(opts, beh)}</select></div>
          ${sexRow}
        </div>`;
    } else if (cat === 'invertebrate') {
      const opts = ['Adult seen','Larva/Caterpillar','Egg mass','Cocoon/Pupa','Feeding damage','Colony'];
      html = `
        <div class="sheet-section">
          <div class="sheet-section-title">Invertebrate Details</div>
          <div class="form-group"><label>Behavior / Stage</label>
            <select id="obs-beh">${_opts(opts, beh)}</select></div>
          ${sexRow}
        </div>`;
    } else if (cat === 'sign-evidence') {
      const opts = ['Tracks','Scat','Den/Burrow','Nest','Rub/Scrape','Browse damage','Trail/Run','Camera trap','Carcass','Other'];
      html = `
        <div class="sheet-section">
          <div class="sheet-section-title">Sign / Evidence</div>
          <div class="form-group"><label>Sign Type</label>
            <select id="obs-sign">${_opts(opts, sign)}</select></div>
        </div>`;
    }

    el.innerHTML = html;
  }

  function _opts(arr, selected) {
    return `<option value="">— select —</option>` +
      arr.map(o => `<option value="${o}"${selected===o?' selected':''}>${o}</option>`).join('');
  }

  function _sectionTags() {
    return `
      <div class="sheet-section">
        <div class="sheet-section-title">Tags</div>
        <div class="tags-input-wrap">
          <div class="tags-chips" id="tags-chips">${_tagsHtml()}</div>
          <input type="text" id="tags-input" placeholder="Type tag, press Enter or comma…" autocomplete="off" autocorrect="off">
        </div>
      </div>`;
  }

  function _tagsHtml() {
    return _tags.map((t, i) =>
      `<span class="tag-chip">${escapeHtml(t)}<button class="tag-chip-remove" data-tidx="${i}">×</button></span>`
    ).join('');
  }

  function _renderTagChips() {
    const el = document.getElementById('tags-chips');
    if (el) { el.innerHTML = _tagsHtml(); _bindTagRemove(); }
  }

  function _bindTagRemove() {
    document.querySelectorAll('.tag-chip-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        _tags.splice(Number(btn.dataset.tidx), 1);
        _renderTagChips();
      });
    });
  }

  function _addTag(raw) {
    const tag = raw.trim().replace(/,+$/, '').trim();
    if (tag && !_tags.includes(tag)) {
      _tags.push(tag);
      _renderTagChips();
    }
  }

  function _sectionRare() {
    const isRare   = _editingObs?.isRare    || false;
    const rareNote = _editingObs?.rareNotes || '';
    return `
      <div class="sheet-section">
        <div class="rare-flag-section">
          <div class="toggle-row">
            <div class="toggle-label">
              ⚑ Flag as Rare / Significant
              <div class="toggle-sublabel">MNFI element occurrence, state T/E, watch list</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="obs-rare" ${isRare ? 'checked' : ''}>
              <span class="toggle-track"></span>
            </label>
          </div>
          <div id="rare-notes-row" style="${isRare ? '' : 'display:none'};margin-top:10px">
            <label>Rare Species Notes</label>
            <textarea id="obs-rare-notes" rows="2" placeholder="State rank, federal status, why significant…">${escapeHtml(rareNote)}</textarea>
          </div>
        </div>
      </div>`;
  }

  function _sectionPhotos() {
    return `
      <div class="sheet-section">
        <div class="sheet-section-title">Photos</div>
        <div style="display:flex;gap:8px;margin-bottom:8px">
          <button class="btn btn-secondary btn-sm" id="photo-cam">📷 Camera</button>
          <button class="btn btn-secondary btn-sm" id="photo-gal">🖼 Gallery</button>
        </div>
        <div class="photo-grid" id="photo-grid">${_thumbsHtml()}</div>
        <input type="file" id="photo-file-cam" accept="image/*" capture="environment" style="display:none">
        <input type="file" id="photo-file-gal" accept="image/*" style="display:none" multiple>
      </div>`;
  }

  function _thumbsHtml() {
    return _photos.map((p, i) => `
      <div class="photo-thumb">
        <img src="${p.dataUrl || p}" alt="">
        <button class="photo-thumb-remove" data-idx="${i}">×</button>
      </div>`).join('');
  }

  // ── Event bindings ────────────────────────────────────────────────────────

  function _bindSheetEvents() {
    document.getElementById('form-close')?.addEventListener('click', _close);
    document.getElementById('form-overlay')?.addEventListener('click', _close);
    document.getElementById('form-save')?.addEventListener('click', _save);
  }

  function _bindBodyEvents() {
    // Category
    document.querySelectorAll('.cat-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _selectedCat = btn.dataset.cat;
        _highlightCat(_selectedCat);
        _renderCatExtra(_selectedCat);
        const inp = document.getElementById('sp-search');
        if (inp) { inp.disabled = false; inp.placeholder = 'Search species…'; }
      });
    });

    // Count stepper
    document.getElementById('cnt-dec')?.addEventListener('click', () => {
      const el = document.getElementById('obs-count');
      if (el) el.value = Math.max(1, (parseInt(el.value) || 1) - 1);
    });
    document.getElementById('cnt-inc')?.addEventListener('click', () => {
      const el = document.getElementById('obs-count');
      if (el) el.value = (parseInt(el.value) || 1) + 1;
    });

    // Rare flag
    document.getElementById('obs-rare')?.addEventListener('change', e => {
      const row = document.getElementById('rare-notes-row');
      if (row) row.style.display = e.target.checked ? 'block' : 'none';
    });

    // GPS location
    document.getElementById('loc-gps-btn')?.addEventListener('click', () => {
      const gps = State.get('gpsPosition');
      if (gps) {
        _lat = gps.lat; _lng = gps.lng; _accuracy = gps.accuracy; _locSource = 'gps';
        document.getElementById('loc-coords').textContent = `${formatCoord(_lat,'N','S')}, ${formatCoord(_lng,'E','W')}`;
        document.getElementById('loc-acc').textContent    = formatAccuracy(_accuracy);
        document.getElementById('loc-src').textContent    = 'GPS';
        UI.toastSuccess('Location updated from GPS');
      } else {
        UI.toastWarn('GPS unavailable — wait for location fix');
      }
    });

    // Species search
    document.getElementById('sp-search')?.addEventListener('input', e => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => _runSearch(e.target.value), 300);
    });
    document.getElementById('sp-search')?.addEventListener('focus', e => {
      if (!e.target.value) _runSearch('');
    });

    // Species clear
    document.getElementById('sp-clear')?.addEventListener('click', () => {
      _selectedSpecies = null;
      _rebuildSpeciesSection();
    });

    // Tags
    document.getElementById('tags-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const val = e.target.value;
        _addTag(val);
        e.target.value = '';
      }
    });
    document.getElementById('tags-input')?.addEventListener('blur', e => {
      if (e.target.value.trim()) { _addTag(e.target.value); e.target.value = ''; }
    });
    _bindTagRemove();

    // Photos
    document.getElementById('photo-cam')?.addEventListener('click', () => document.getElementById('photo-file-cam')?.click());
    document.getElementById('photo-gal')?.addEventListener('click', () => document.getElementById('photo-file-gal')?.click());
    document.getElementById('photo-file-cam')?.addEventListener('change', e => _handleFiles(e.target.files));
    document.getElementById('photo-file-gal')?.addEventListener('change', e => _handleFiles(e.target.files));
    _bindPhotoRemove();
  }

  function _bindPhotoRemove() {
    document.querySelectorAll('.photo-thumb-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        _photos.splice(Number(btn.dataset.idx), 1);
        const grid = document.getElementById('photo-grid');
        if (grid) { grid.innerHTML = _thumbsHtml(); _bindPhotoRemove(); }
      });
    });
  }

  function _highlightCat(cat) {
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('selected', b.dataset.cat === cat));
  }

  function _rebuildSpeciesSection() {
    const sec = document.getElementById('species-section');
    if (!sec) return;
    const div = document.createElement('div');
    div.innerHTML = _sectionSpecies();
    const newSec = div.firstElementChild;
    sec.replaceWith(newSec);
    document.getElementById('sp-search')?.addEventListener('input', e => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => _runSearch(e.target.value), 300);
    });
    document.getElementById('sp-search')?.addEventListener('focus', e => {
      if (!e.target.value) _runSearch('');
    });
  }

  // ── Cluster selector ──────────────────────────────────────────────────────

  async function _loadAndRenderClusterSelector() {
    const sec = document.getElementById('cluster-section');
    if (!sec || !_surveyId) return;

    if (!_selectedSpecies?.gbifKey || !Clusters.PLANT_CATS.has(_selectedCat)) {
      sec.innerHTML = '';
      return;
    }

    let stands = [];
    try { stands = await DB.getAllByIndex('stands', 'surveyId', _surveyId); } catch {}

    if (!stands.length) { sec.innerHTML = ''; return; }

    const gbifKey     = _selectedSpecies.gbifKey;
    const sameSpecies = stands.filter(s => s.primaryGbifKey === gbifKey);
    const others      = stands.filter(s => s.primaryGbifKey !== gbifKey);

    let optHtml = `<option value="">— No Cluster —</option>`;
    for (const s of sameSpecies) {
      const n = s.name || s.primarySpeciesName || 'Cluster';
      optHtml += `<option value="${s.id}"${_selectedStandId === s.id ? ' selected' : ''}>${escapeHtml(n)}</option>`;
    }
    if (others.length) {
      if (sameSpecies.length) optHtml += `<option disabled>──────────</option>`;
      for (const s of others) {
        const n = s.name || s.primarySpeciesName || 'Cluster';
        optHtml += `<option value="${s.id}"${_selectedStandId === s.id ? ' selected' : ''}>${escapeHtml(n)}</option>`;
      }
    }

    sec.innerHTML = `
      <div class="sheet-section">
        <div class="sheet-section-title">Cluster (optional)</div>
        <div class="form-group">
          <select id="obs-cluster">${optHtml}</select>
        </div>
      </div>`;

    sec.querySelector('#obs-cluster')?.addEventListener('change', e => {
      _selectedStandId = e.target.value || null;
    });
  }

  // ── Species search ────────────────────────────────────────────────────────

  async function _runSearch(query) {
    const el = document.getElementById('sp-results');
    if (!el) return;

    if (!query || query.trim().length < 2) {
      const recent = await Species.getRecent(8);
      if (recent.length) _showResults(recent.map(r => ({ ...r, _recent: true })));
      else el.style.display = 'none';
      return;
    }

    const offline = Species.searchOffline(query.trim(), _selectedCat);
    _showResults(offline);

    if (navigator.onLine) {
      if (_searchAbort) _searchAbort.abort();
      _searchAbort = new AbortController();
      try {
        const online = await Species.searchOnline(query.trim(), _selectedCat);
        const seen   = new Set(offline.map(r => r.scientificName?.toLowerCase()));
        const merged = [...offline, ...online.filter(r => !seen.has(r.scientificName?.toLowerCase()))];
        _showResults(merged.slice(0, 12));
      } catch { /* network error — offline results already shown */ }
    }
  }

  function _showResults(results) {
    const el = document.getElementById('sp-results');
    if (!el) return;

    const catDef    = CAT_DEFS.find(c => c.key === _selectedCat);
    const unknownLabel = `Unknown / Unidentified ${catDef?.label || 'Species'}`;

    el.style.display = 'block';
    el.innerHTML = results.map((r, i) => {
      const common = r.commonName || r.scientificName || '';
      const sci    = (r.scientificName && r.scientificName !== common) ? r.scientificName : '';
      const tag    = r._recent
        ? `<span class="sp-recent">Recent</span>`
        : (r.kingdom ? `<span class="sp-kingdom">${escapeHtml(r.kingdom)}</span>` : '');
      return `<div class="species-result-item" data-idx="${i}">
        <div style="flex:1">
          <div class="sp-common">${escapeHtml(common)}</div>
          ${sci ? `<div class="sp-scientific">${escapeHtml(sci)}</div>` : ''}
        </div>${tag}
      </div>`;
    }).join('') +
    `<div class="species-result-item species-unknown-item" data-unknown="true">
      <div style="flex:1">
        <div class="sp-common" style="color:var(--text-muted)">${escapeHtml(unknownLabel)}</div>
        <div class="sp-scientific" style="font-style:italic;color:var(--text-muted)">No identification</div>
      </div>
    </div>`;

    el.querySelectorAll('[data-idx]').forEach(item => {
      item.addEventListener('click', () => _pickSpecies(results[Number(item.dataset.idx)]));
    });
    el.querySelector('[data-unknown]')?.addEventListener('click', () => _pickUnknown());
  }

  function _pickUnknown() {
    const catDef = CAT_DEFS.find(c => c.key === _selectedCat);
    const label  = catDef?.label || 'Species';
    _selectedSpecies = {
      gbifKey:        null,
      scientificName: `Unknown ${label}`,
      commonName:     `Unknown / Unidentified ${label}`,
      inatId:         null,
      family:         null,
    };
    _selectedStandId = null;
    const clusterSec = document.getElementById('cluster-section');
    if (clusterSec) clusterSec.innerHTML = '';
    const sec = document.getElementById('species-section');
    if (sec) {
      sec.innerHTML = `
        <div class="sheet-section-title">Species</div>
        <div class="species-selected-display">
          <div class="sp-info">
            <div class="sp-common">${escapeHtml(_selectedSpecies.commonName)}</div>
          </div>
          <button class="sp-clear" id="sp-clear">×</button>
        </div>`;
      document.getElementById('sp-clear')?.addEventListener('click', () => {
        _selectedSpecies = null;
        _rebuildSpeciesSection();
      });
    }
  }

  async function _pickSpecies(r) {
    let rec;
    if (r.gbifKey && Number(r.gbifKey) > 0) {
      rec = r;
      Species.recordUse(r.gbifKey).catch(() => {});
    } else if (r.inatId) {
      rec = await Species.cacheOfflineSelection(r.inatId, r.scientificName, r.commonName, r.family);
    } else {
      rec = r;
    }

    _selectedSpecies = {
      gbifKey:        rec.gbifKey,
      scientificName: rec.scientificName || rec.canonicalName,
      commonName:     rec.commonName || rec.scientificName,
      inatId:         rec.inatId,
      family:         rec.family,
    };

    const sec = document.getElementById('species-section');
    if (sec) {
      const common = _selectedSpecies.commonName || _selectedSpecies.scientificName;
      const sci    = _selectedSpecies.scientificName !== common ? _selectedSpecies.scientificName : '';
      sec.innerHTML = `
        <div class="sheet-section-title">Species</div>
        <div class="species-selected-display">
          <div class="sp-info">
            <div class="sp-common">${escapeHtml(common)}</div>
            ${sci ? `<div class="sp-scientific">${escapeHtml(sci)}</div>` : ''}
          </div>
          <button class="sp-clear" id="sp-clear">×</button>
        </div>`;
      document.getElementById('sp-clear')?.addEventListener('click', () => {
        _selectedSpecies = null;
        _selectedStandId = null;
        _rebuildSpeciesSection();
        const clusterSec = document.getElementById('cluster-section');
        if (clusterSec) clusterSec.innerHTML = '';
      });
    }
    _loadAndRenderClusterSelector();
  }

  // ── Photos ────────────────────────────────────────────────────────────────

  async function _handleFiles(files) {
    if (!files?.length) return;
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      const dataUrl = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = e => res(e.target.result);
        r.onerror = rej;
        r.readAsDataURL(f);
      });
      _photos.push({ dataUrl, fileName: f.name, takenAt: now() });
    }
    const grid = document.getElementById('photo-grid');
    if (grid) { grid.innerHTML = _thumbsHtml(); _bindPhotoRemove(); }
  }

  // ── Populate editing values ───────────────────────────────────────────────

  function _populateEditing() {
    const obs = _editingObs;
    const set = (id, val) => { const el = document.getElementById(id); if (el && val != null) el.value = val; };
    set('obs-count', obs.count);
    set('obs-notes', obs.notes);
    if (obs.isRare) {
      const cb = document.getElementById('obs-rare');
      if (cb) cb.checked = true;
      const row = document.getElementById('rare-notes-row');
      if (row) row.style.display = 'block';
      set('obs-rare-notes', obs.rareNotes);
    }
    if (obs.heightM) set('obs-height', (obs.heightM * 3.28084).toFixed(1));
    if (obs.dbhCm)   set('obs-dbh', obs.dbhCm);
    if (obs.coveragePct != null) set('obs-cov', String(obs.coveragePct));
    if (obs.behavior)  set('obs-beh', obs.behavior);
    if (obs.distanceM) set('obs-dist', obs.distanceM);
    if (obs.signType)  set('obs-sign', obs.signType);
    if (obs.lifeStage) set('obs-life-stage', obs.lifeStage);
    if (obs.condition) set('obs-condition', obs.condition);
    if (obs.sex)       set('obs-sex', obs.sex);
    if (obs.tags?.length) { _tags = [...obs.tags]; _renderTagChips(); }
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async function _save() {
    if (!_selectedCat) {
      UI.toastWarn('Select a category first');
      document.querySelector('.category-grid')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    if (_lat == null || _lng == null) {
      UI.toastWarn('No location — use GPS or tap map first');
      return;
    }

    const getVal  = id => document.getElementById(id)?.value ?? null;
    const getNum  = id => { const v = getVal(id); return v !== '' && v != null ? parseFloat(v) : null; };
    const getBool = id => document.getElementById(id)?.checked ?? false;

    const heightFt = getNum('obs-height');

    const taxFields    = _selectedSpecies ? Species.toObservationFields(_selectedSpecies) : {};
    const clusterSelId = document.getElementById('obs-cluster')?.value || _selectedStandId || null;

    const obs = {
      ...(_editingObs || {}),
      id:             _editingObs?.id || generateUUID(),
      surveyId:       _surveyId,
      category:       _selectedCat,
      lat:            _lat,
      lng:            _lng,
      accuracy:       _accuracy ?? null,
      locationSource: _locSource,
      count:          parseInt(getVal('obs-count')) || 1,
      notes:          (getVal('obs-notes') || '').trim(),
      isRare:         getBool('obs-rare'),
      rareNotes:      (getVal('obs-rare-notes') || '').trim(),
      heightM:        heightFt != null ? heightFt / 3.28084 : null,
      dbhCm:          getNum('obs-dbh'),
      coveragePct:    getVal('obs-cov') || null,
      behavior:       getVal('obs-beh') || null,
      distanceM:      getNum('obs-dist'),
      signType:       getVal('obs-sign') || null,
      lifeStage:      getVal('obs-life-stage') || null,
      condition:      getVal('obs-condition')  || null,
      sex:            getVal('obs-sex')         || null,
      tags:           [..._tags],
      photos:         _photos,
      standId:        clusterSelId,
      observedAt:     _editingObs?.observedAt || now(),
      updatedAt:      now(),
      ...taxFields,
    };

    const saveBtn = document.getElementById('form-save');
    if (saveBtn) saveBtn.disabled = true;

    try {
      await DB.put('observations', obs);

      const survey = await DB.get('surveys', _surveyId).catch(() => null);
      if (survey) { survey.updatedAt = now(); await DB.put('surveys', survey); }

      const surveyIdSnap = _surveyId;
      const wasEditing   = !!_editingObs;
      UI.toastSuccess(wasEditing ? 'Observation updated' : 'Observation saved');
      Router.navigate('map', { surveyId: surveyIdSnap });

      if (clusterSelId) {
        // Update the cluster's member list and polygon geometry
        Clusters.refreshStand(surveyIdSnap, clusterSelId).catch(() => {});
      } else if (!wasEditing) {
        Clusters.checkForClusters(surveyIdSnap, obs).catch(() => {});
      }
    } catch (err) {
      console.error('[FormScreen] save error:', err);
      UI.toastError('Failed to save observation');
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  function _close() {
    Router.navigate('map', { surveyId: _surveyId });
  }

  // ── Destroy ───────────────────────────────────────────────────────────────

  function destroy() {
    clearTimeout(_searchTimer);
    if (_searchAbort) _searchAbort.abort();
    _surveyId = null; _obsId = null; _editingObs = null;
    _selectedCat = null; _selectedSpecies = null; _selectedStandId = null; _photos = []; _tags = [];
  }

  return { render, destroy };
})();
