/**
 * screens/home.js
 *
 * Home screen: survey list, new survey modal, per-survey actions.
 * Registered as Router route 'home'.
 *
 * Depends on: config.js, core/db.js, core/utils.js, core/state.js,
 *             core/router.js, modules/ui.js
 */
const HomeScreen = (() => {
  let _container = null;
  let _autoSaveTimer = null;

  // ── Render ───────────────────────────────────────────────────────────────

  async function render(container) {
    _container = container;
    container.innerHTML = `
      <div class="home-screen">
        <div class="home-header">
          <div class="home-header-left">
            <h1>Field Survey</h1>
            <div class="version">v${CONFIG.APP.VERSION}</div>
          </div>
          <div id="home-status"></div>
          <button class="btn-icon" id="home-settings-btn" title="App settings" aria-label="App settings">
            ⚙
          </button>
        </div>

        <div class="survey-list" id="survey-list">
          <div class="empty-state" id="survey-loading">
            <div class="loading-spinner"></div>
          </div>
        </div>

        <div class="home-bottom-bar" id="home-bottom-bar">
          <span id="hbb-tiles">Loading…</span>
          <span id="hbb-species">Species DB</span>
        </div>
      </div>

      <button class="fab" id="home-fab" title="New survey" aria-label="New survey">+</button>
    `;

    container.querySelector('#home-settings-btn').addEventListener('click', () => {
      Router.navigate('app-settings');
    });

    container.querySelector('#home-fab').addEventListener('click', () => _openNewSurveyModal());

    _renderStatusPill();
    State.subscribe('isOnline', _renderStatusPill);

    await _loadSurveys();
    _loadBottomBar();

    // Auto-save every 30 seconds (updates "last saved" timestamps)
    _autoSaveTimer = setInterval(_refreshSurveyTimestamps, 30000);
  }

  function destroy() {
    clearInterval(_autoSaveTimer);
    _autoSaveTimer = null;
    _container = null;
  }

  // ── Status pill ──────────────────────────────────────────────────────────

  function _renderStatusPill() {
    const el = document.getElementById('home-status');
    if (!el) return;
    const online = State.get('isOnline');
    el.innerHTML = `
      <span class="status-pill ${online ? 'online' : 'offline'}">
        <span class="status-dot"></span>
        ${online ? 'Online' : 'Offline'}
      </span>
    `;
  }

  // ── Survey list ──────────────────────────────────────────────────────────

  async function _loadSurveys() {
    const listEl = document.getElementById('survey-list');
    if (!listEl) return;
    try {
      const surveys = await DB.getAll('surveys');
      surveys.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

      if (!surveys.length) {
        listEl.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">🌿</div>
            <h3>No surveys yet</h3>
            <p>Tap <strong>+</strong> to create your first survey.</p>
          </div>
        `;
        return;
      }

      // Load observation counts for all surveys in parallel
      const statMap = await _loadSurveyStats(surveys.map(s => s.id));

      listEl.innerHTML = '';
      for (const survey of surveys) {
        const stats = statMap[survey.id] || { obsCount: 0, speciesCount: 0 };
        listEl.appendChild(_buildSurveyCard(survey, stats));
      }
    } catch (err) {
      listEl.innerHTML = `<div style="padding:24px;color:#c0392b">Failed to load surveys: ${escapeHtml(err.message)}</div>`;
    }
  }

  async function _loadSurveyStats(surveyIds) {
    const result = {};
    await Promise.all(surveyIds.map(async id => {
      try {
        const obs = await DB.getAllByIndex('observations', 'surveyId', id);
        const gbifKeys = obs.filter(o => o.gbifKey && o.gbifKey > 0).map(o => o.gbifKey);
        result[id] = {
          obsCount:     obs.length,
          speciesCount: new Set(gbifKeys).size,
        };
      } catch { result[id] = { obsCount: 0, speciesCount: 0 }; }
    }));
    return result;
  }

  function _buildSurveyCard(survey, stats) {
    const card = document.createElement('div');
    card.className = 'survey-card';
    card.dataset.surveyId = survey.id;

    const statusClass = survey.status === 'active' ? 'active' : 'complete';
    const statusLabel = survey.status === 'active' ? 'Active' : 'Complete';

    card.innerHTML = `
      <div class="survey-card-body">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:4px">
          <div class="survey-card-title">${escapeHtml(survey.name)}</div>
          <span class="status-pill ${statusClass}" style="flex-shrink:0;font-size:0.7rem">${statusLabel}</span>
        </div>
        ${survey.siteName ? `<div class="survey-card-site">📍 ${escapeHtml(survey.siteName)}</div>` : ''}
        <div class="survey-card-meta">
          <span>Started ${formatDate(survey.startDate)}</span>
          ${survey.surveyorName ? `<span>· ${escapeHtml(survey.surveyorName)}</span>` : ''}
          <span class="survey-last-saved" data-id="${survey.id}">· Saved ${timeAgo(survey.updatedAt)}</span>
        </div>
        <div class="survey-card-stats">
          <div class="stat-item">
            <span class="stat-value">${stats.obsCount}</span>
            <span class="stat-label">Obs</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${stats.speciesCount}</span>
            <span class="stat-label">Species</span>
          </div>
        </div>
      </div>
      <div class="survey-card-footer">
        <button class="btn btn-primary btn-survey-continue" data-id="${survey.id}">Continue →</button>
        <button class="btn btn-secondary btn-survey-export" data-id="${survey.id}">Export</button>
        <button class="btn btn-secondary btn-survey-settings" data-id="${survey.id}">Settings</button>
        <button class="btn btn-secondary btn-survey-delete" data-id="${survey.id}" style="color:#c0392b;min-width:auto;padding:8px 10px">🗑</button>
      </div>
    `;

    card.querySelector('.btn-survey-continue').addEventListener('click', () => {
      State.set('currentSurveyId', survey.id);
      Router.navigate('map', { surveyId: survey.id });
    });

    card.querySelector('.btn-survey-export').addEventListener('click', () => {
      Router.navigate('export', { surveyId: survey.id });
    });

    card.querySelector('.btn-survey-settings').addEventListener('click', () => {
      Router.navigate('survey-settings', { surveyId: survey.id });
    });

    card.querySelector('.btn-survey-delete').addEventListener('click', () => {
      _deleteSurvey(survey, stats.obsCount);
    });

    return card;
  }

  async function _refreshSurveyTimestamps() {
    const spans = document.querySelectorAll('.survey-last-saved[data-id]');
    if (!spans.length) return;
    for (const span of spans) {
      try {
        const s = await DB.get('surveys', span.dataset.id);
        if (s) span.textContent = `· Saved ${timeAgo(s.updatedAt)}`;
      } catch {}
    }
  }

  // ── Delete survey ────────────────────────────────────────────────────────

  async function _deleteSurvey(survey, obsCount) {
    let confirmed;
    if (obsCount > 0) {
      confirmed = await UI.confirmDelete(survey.name);
    } else {
      confirmed = await UI.confirm(
        `Delete "${survey.name}"? This survey has no observations.`,
        'Delete Survey',
        { confirmLabel: 'Delete', dangerous: true }
      );
    }
    if (!confirmed) return;

    UI.loading(true, 'Deleting survey…');
    try {
      // Delete all observations and stands for this survey
      const obs    = await DB.getAllByIndex('observations', 'surveyId', survey.id);
      const stands = await DB.getAllByIndex('stands', 'surveyId', survey.id);
      for (const o of obs)    await DB.delete('observations', o.id);
      for (const s of stands) await DB.delete('stands', s.id);
      await DB.delete('surveys', survey.id);
      await DB.delete('exportSettings', survey.id);

      UI.loading(false);
      UI.toastSuccess('Survey deleted.');

      // Remove card from DOM without full reload
      const card = document.querySelector(`.survey-card[data-survey-id="${survey.id}"]`);
      if (card) card.remove();

      // Show empty state if no cards left
      const list = document.getElementById('survey-list');
      if (list && !list.querySelector('.survey-card')) {
        list.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">🌿</div>
            <h3>No surveys yet</h3>
            <p>Tap <strong>+</strong> to create your first survey.</p>
          </div>
        `;
      }
    } catch (err) {
      UI.loading(false);
      UI.toastError(`Delete failed: ${err.message}`);
    }
  }

  // ── New Survey modal ─────────────────────────────────────────────────────

  async function _openNewSurveyModal() {
    let defaults = {};
    try {
      const s = await DB.getRaw('appSettings', 'defaults');
      defaults = s || {};
    } catch {}

    const data = await UI.newSurveyModal({
      surveyorName: defaults.surveyorName || CONFIG.APP.DEFAULT_SURVEYOR,
    });
    if (!data) return;

    UI.loading(true, 'Creating survey…');
    try {
      const ts = now();
      const survey = {
        id:           generateUUID(),
        name:         data.name,
        siteName:     data.siteName,
        surveyorName: data.surveyorName,
        startDate:    data.startDate,
        endDate:      null,
        notes:        data.notes,
        status:       'active',
        createdAt:    ts,
        updatedAt:    ts,
      };
      await DB.put('surveys', survey);
      UI.loading(false);
      State.set('currentSurveyId', survey.id);
      Router.navigate('map', { surveyId: survey.id });
    } catch (err) {
      UI.loading(false);
      UI.toastError(`Could not create survey: ${err.message}`);
    }
  }

  // ── Bottom bar ───────────────────────────────────────────────────────────

  async function _loadBottomBar() {
    try {
      const [regions, speciesCache] = await Promise.all([
        DB.getAll('tileRegions'),
        DB.getAll('speciesCache'),
      ]);

      const totalBytes = regions.reduce((sum, r) => sum + (r.sizeBytes || 0), 0);
      const tilesEl = document.getElementById('hbb-tiles');
      if (tilesEl) {
        if (regions.length) {
          const mb = (totalBytes / 1048576).toFixed(1);
          tilesEl.textContent = `🗺 ${regions.length} cached region${regions.length === 1 ? '' : 's'} (${mb} MB)`;
        } else {
          tilesEl.textContent = '🗺 No offline tiles';
        }
      }

      const spEl = document.getElementById('hbb-species');
      if (spEl) {
        const localCount = typeof MICHIGAN_SPECIES !== 'undefined' ? MICHIGAN_SPECIES.length : 0;
        spEl.textContent = `🔍 ${localCount.toLocaleString()} local species`;
      }
    } catch {}
  }

  return { render, destroy };
})();
