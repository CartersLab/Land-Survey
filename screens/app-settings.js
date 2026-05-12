const AppSettingsScreen = (() => {

  async function render(container) {
    let settings = {};
    try { settings = (await DB.getRaw('appSettings', 'defaults')) || {}; } catch {}

    container.innerHTML = `
      <div class="settings-screen">
        <div class="app-header">
          <button class="btn-icon" id="as-back" style="color:white">←</button>
          <h1 style="font-size:1.05rem">App Settings</h1>
          <button class="btn btn-sm" id="as-save" style="background:rgba(255,255,255,0.2);color:white;border:1px solid rgba(255,255,255,0.3)">Save</button>
        </div>
        <div class="settings-list">

          <div class="settings-section">
            <div class="settings-section-title">Survey Defaults</div>
            <div class="settings-card">
              <div class="settings-row">
                <div class="settings-row-label"><h4>Default Surveyor Name</h4></div>
                <input type="text" id="as-surveyor" value="${escapeHtml(settings.surveyorName||'')}" placeholder="Your name" autocomplete="name">
              </div>
              <div class="settings-row">
                <div class="settings-row-label"><h4>Default County</h4></div>
                <input type="text" id="as-county" value="${escapeHtml(settings.county||CONFIG.APP.DEFAULT_COUNTY||'')}" placeholder="e.g. Livingston">
              </div>
              <div class="settings-row">
                <div class="settings-row-label"><h4>Default Township</h4></div>
                <input type="text" id="as-township" value="${escapeHtml(settings.township||CONFIG.APP.DEFAULT_TOWNSHIP||'')}" placeholder="e.g. Tyrone">
              </div>
            </div>
          </div>

          <div class="settings-section">
            <div class="settings-section-title">Map</div>
            <div class="settings-card">
              <div class="settings-row">
                <div class="settings-row-label">
                  <h4>Default Tile Source</h4>
                </div>
                <select id="as-tiles">
                  ${Object.entries(CONFIG.TILE_PROVIDERS).map(([k,p]) =>
                    `<option value="${k}"${(settings.defaultTileSource||'osm')===k?' selected':''}>${p.name}</option>`
                  ).join('')}
                </select>
              </div>
            </div>
          </div>

          <div class="settings-section">
            <div class="settings-section-title">About</div>
            <div class="settings-card">
              <div class="settings-row">
                <div class="settings-row-label"><h4>Version</h4></div>
                <span class="text-muted">${CONFIG.APP.VERSION}</span>
              </div>
              <div class="settings-row">
                <div class="settings-row-label">
                  <h4>Species Database</h4>
                  <p>${typeof MICHIGAN_SPECIES !== 'undefined' ? MICHIGAN_SPECIES.length.toLocaleString() + ' Michigan species' : 'Not loaded'}</p>
                </div>
              </div>
            </div>
          </div>

          <div class="settings-section">
            <div class="settings-section-title">Data Management</div>
            <div class="settings-card">
              <div class="settings-row">
                <div class="settings-row-label">
                  <h4>Clear Species Cache</h4>
                  <p>Removes recently-used species lookup cache</p>
                </div>
                <button class="btn btn-sm btn-secondary" id="as-clear-cache">Clear</button>
              </div>
              <div class="settings-row">
                <div class="settings-row-label">
                  <h4>Clear Tile Cache</h4>
                  <p>Removes all cached offline map tiles</p>
                </div>
                <button class="btn btn-sm btn-danger" id="as-clear-tiles">Clear</button>
              </div>
            </div>
          </div>

        </div>
      </div>`;

    document.getElementById('as-back')?.addEventListener('click', () => Router.navigate('home'));
    document.getElementById('as-save')?.addEventListener('click', _save);

    document.getElementById('as-clear-cache')?.addEventListener('click', async () => {
      const ok = await UI.confirm('Clear the species lookup cache?', 'Clear Cache', { confirmLabel: 'Clear', dangerous: false });
      if (!ok) return;
      await DB.clear('speciesCache');
      UI.toastSuccess('Species cache cleared');
    });

    document.getElementById('as-clear-tiles')?.addEventListener('click', async () => {
      const ok = await UI.confirm(
        'Delete all cached offline map tiles? This cannot be undone.',
        'Clear Tile Cache',
        { confirmLabel: 'Delete All', dangerous: true }
      );
      if (!ok) return;
      UI.loading(true, 'Clearing tiles…');
      try {
        await DB.clear('tileBitmaps');
        const regions = await Tiles.getRegions();
        for (const r of regions) await Tiles.deleteRegion(r.id);
        UI.loading(false);
        UI.toastSuccess('Tile cache cleared');
      } catch (err) {
        UI.loading(false);
        UI.toastError('Failed: ' + err.message);
      }
    });
  }

  async function _save() {
    const settings = {
      surveyorName:      document.getElementById('as-surveyor')?.value?.trim()  || '',
      county:            document.getElementById('as-county')?.value?.trim()    || '',
      township:          document.getElementById('as-township')?.value?.trim()  || '',
      defaultTileSource: document.getElementById('as-tiles')?.value             || 'osm',
    };
    await DB.putRaw('appSettings', 'defaults', settings);
    UI.toastSuccess('Settings saved');
    Router.navigate('home');
  }

  function destroy() {}

  return { render, destroy };
})();
