const SurveySettingsScreen = (() => {
  let _surveyId = null;
  let _survey   = null;

  async function render(container, params) {
    _surveyId = params?.surveyId || State.get('currentSurveyId');
    if (!_surveyId) { Router.navigate('home'); return; }

    _survey = await DB.get('surveys', _surveyId).catch(() => null);
    if (!_survey) { Router.navigate('home'); return; }

    container.innerHTML = `
      <div class="settings-screen">
        <div class="app-header">
          <button class="btn-icon" id="ss-back" style="color:white">←</button>
          <h1 style="font-size:1.05rem">Survey Settings</h1>
          <button class="btn btn-sm" id="ss-save" style="background:rgba(255,255,255,0.2);color:white;border:1px solid rgba(255,255,255,0.3)">Save</button>
        </div>
        <div class="settings-list" id="ss-body">
          ${_buildBody()}
        </div>
      </div>`;

    document.getElementById('ss-back')?.addEventListener('click', () => {
      Router.navigate('map', { surveyId: _surveyId });
    });
    document.getElementById('ss-save')?.addEventListener('click', _saveSettings);
    document.getElementById('ss-delete')?.addEventListener('click', _deleteSurvey);
  }

  function _buildBody() {
    const s = _survey;
    return `
      <div class="settings-section">
        <div class="settings-section-title">Survey Info</div>
        <div class="settings-card">
          <div class="settings-row">
            <div class="settings-row-label"><h4>Survey Name</h4></div>
            <input type="text" id="ss-name" value="${escapeHtml(s.name||'')}" autocomplete="off">
          </div>
          <div class="settings-row">
            <div class="settings-row-label"><h4>Site Name</h4></div>
            <input type="text" id="ss-site" value="${escapeHtml(s.siteName||'')}" autocomplete="off" placeholder="optional">
          </div>
          <div class="settings-row">
            <div class="settings-row-label"><h4>Surveyor</h4></div>
            <input type="text" id="ss-surveyor" value="${escapeHtml(s.surveyorName||'')}" autocomplete="off" placeholder="optional">
          </div>
          <div class="settings-row">
            <div class="settings-row-label"><h4>Start Date</h4></div>
            <input type="date" id="ss-date" value="${s.startDate||''}">
          </div>
          <div class="settings-row">
            <div class="settings-row-label"><h4>County</h4></div>
            <input type="text" id="ss-county" value="${escapeHtml(s.county||'')}" placeholder="optional">
          </div>
          <div class="settings-row">
            <div class="settings-row-label"><h4>Township</h4></div>
            <input type="text" id="ss-township" value="${escapeHtml(s.township||'')}" placeholder="optional">
          </div>
          <div class="settings-row">
            <div class="settings-row-label"><h4>Status</h4></div>
            <select id="ss-status">
              <option value="active"${s.status==='active'?' selected':''}>Active</option>
              <option value="complete"${s.status==='complete'?' selected':''}>Complete</option>
              <option value="draft"${s.status==='draft'?' selected':''}>Draft</option>
            </select>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Notes</div>
        <div class="settings-card">
          <div class="settings-row" style="align-items:flex-start">
            <textarea id="ss-notes" rows="4" style="width:100%;border:none;outline:none;font-size:.9rem;resize:vertical" placeholder="Survey notes, access information, habitat description…">${escapeHtml(s.notes||'')}</textarea>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Danger Zone</div>
        <div class="settings-card">
          <div class="settings-row">
            <div class="settings-row-label">
              <h4>Delete Survey</h4>
              <p>Permanently removes survey and all observations</p>
            </div>
            <button class="btn btn-sm btn-danger" id="ss-delete">Delete</button>
          </div>
        </div>
      </div>`;
  }

  async function _saveSettings() {
    const name = document.getElementById('ss-name')?.value?.trim();
    if (!name) { UI.toastWarn('Survey name is required'); return; }

    _survey.name         = name;
    _survey.siteName     = document.getElementById('ss-site')?.value?.trim() || '';
    _survey.surveyorName = document.getElementById('ss-surveyor')?.value?.trim() || '';
    _survey.startDate    = document.getElementById('ss-date')?.value || _survey.startDate;
    _survey.county       = document.getElementById('ss-county')?.value?.trim() || '';
    _survey.township     = document.getElementById('ss-township')?.value?.trim() || '';
    _survey.status       = document.getElementById('ss-status')?.value || 'active';
    _survey.notes        = document.getElementById('ss-notes')?.value?.trim() || '';
    _survey.updatedAt    = now();

    await DB.put('surveys', _survey);
    UI.toastSuccess('Survey settings saved');
    Router.navigate('map', { surveyId: _surveyId });
  }

  async function _deleteSurvey() {
    const obsArr = await DB.getAllByIndex('observations', 'surveyId', _surveyId).catch(() => []);
    const ok = obsArr.length > 0
      ? await UI.confirmDelete(_survey.name)
      : await UI.confirm(`Delete "${_survey.name}"?`, 'Delete Survey', { confirmLabel: 'Delete', dangerous: true });
    if (!ok) return;

    UI.loading(true, 'Deleting…');
    try {
      for (const o of obsArr) await DB.delete('observations', o.id);
      const stands = await DB.getAllByIndex('stands', 'surveyId', _surveyId).catch(() => []);
      for (const s of stands) await DB.delete('stands', s.id);
      await DB.delete('surveys', _surveyId);
      UI.loading(false);
      UI.toastSuccess('Survey deleted');
      Router.navigate('home');
    } catch (err) {
      UI.loading(false);
      UI.toastError('Delete failed: ' + err.message);
    }
  }

  function destroy() { _surveyId = null; _survey = null; }

  return { render, destroy };
})();
