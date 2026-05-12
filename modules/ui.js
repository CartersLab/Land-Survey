/**
 * modules/ui.js
 *
 * Toast notifications, modal dialogs, confirm prompts, loading overlay,
 * and other shared UI primitives.
 *
 * All functions are synchronous (or return Promises for confirm/modal).
 * No dependencies beyond the DOM and style.css.
 */
const UI = (() => {

  // ── Toast ────────────────────────────────────────────────────────────────

  let _toastContainer = null;

  function _getToastContainer() {
    if (!_toastContainer) {
      _toastContainer = document.getElementById('toast-container');
      if (!_toastContainer) {
        _toastContainer = document.createElement('div');
        _toastContainer.id = 'toast-container';
        _toastContainer.className = 'toast-container';
        document.body.appendChild(_toastContainer);
      }
    }
    return _toastContainer;
  }

  /**
   * Show a toast notification.
   * @param {string} message
   * @param {'info'|'success'|'error'|'warn'|'cluster'} type
   * @param {Array<{label:string, action:function, style?:string}>} actions
   * @param {number} duration  ms (0 = sticky until dismissed)
   * @returns {{ dismiss: function }} — call .dismiss() to remove early
   */
  function toast(message, type = 'info', actions = [], duration = 3500) {
    const container = _getToastContainer();

    const el = document.createElement('div');
    el.className = `toast toast-${type}`;

    const iconMap = { success: '✓', error: '✕', warn: '⚠', info: 'ℹ', cluster: '◈' };
    const icon = iconMap[type] || 'ℹ';

    let actionsHtml = '';
    if (actions.length) {
      actionsHtml = `<div class="toast-actions">` +
        actions.map((a, i) =>
          `<button class="btn btn-sm ${a.style || 'btn-secondary'}" data-idx="${i}">${escapeHtml(a.label)}</button>`
        ).join('') +
        `</div>`;
    }

    el.innerHTML = `
      <span style="font-size:1.1rem;flex-shrink:0">${icon}</span>
      <div class="toast-body">
        <div class="toast-text">${escapeHtml(message)}</div>
        ${actionsHtml}
      </div>
      <button class="toast-dismiss" aria-label="Dismiss">×</button>
    `;

    // Action button clicks
    el.querySelectorAll('[data-idx]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        actions[idx]?.action?.();
        dismiss();
      });
    });

    el.querySelector('.toast-dismiss').addEventListener('click', dismiss);

    container.appendChild(el);
    if (navigator.vibrate) navigator.vibrate(30);

    let timer;
    function dismiss() {
      clearTimeout(timer);
      el.classList.add('toast-out');
      el.addEventListener('animationend', () => el.remove(), { once: true });
      setTimeout(() => el.remove(), 400); // fallback
    }

    if (duration > 0) timer = setTimeout(dismiss, duration);

    return { dismiss };
  }

  // Convenience wrappers
  const toastSuccess = (msg, dur) => toast(msg, 'success', [], dur);
  const toastError   = (msg, dur) => toast(msg, 'error',   [], dur ?? 5000);
  const toastWarn    = (msg, dur) => toast(msg, 'warn',    [], dur ?? 4500);

  // ── Modal ────────────────────────────────────────────────────────────────

  /**
   * Show a modal dialog.
   * @param {string} title
   * @param {string|HTMLElement} body  — HTML string or DOM node
   * @param {object} options
   *   buttons: Array<{label, action, style, close?}>  — default close=true
   *   onClose: function
   *   size: 'sm'|'md' (default 'md')
   * @returns {{ close: function, el: HTMLElement }}
   */
  function modal(title, body, options = {}) {
    const { buttons = [], onClose, size = 'md' } = options;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const el = document.createElement('div');
    el.className = `modal${size === 'sm' ? ' modal-sm' : ''}`;

    const buttonsHtml = buttons.length
      ? `<div class="modal-footer">` +
          buttons.map((b, i) =>
            `<button class="btn ${b.style || 'btn-secondary'}" data-idx="${i}">${escapeHtml(b.label)}</button>`
          ).join('') +
          `</div>`
      : '';

    el.innerHTML = `
      <div class="modal-header">
        <div class="modal-title">${escapeHtml(title)}</div>
        <button class="btn-icon modal-close-btn" aria-label="Close">×</button>
      </div>
      <div class="modal-body"></div>
      ${buttonsHtml}
    `;

    const bodyEl = el.querySelector('.modal-body');
    if (typeof body === 'string') {
      bodyEl.innerHTML = body;
    } else if (body instanceof HTMLElement) {
      bodyEl.appendChild(body);
    }

    function close() {
      overlay.remove();
      onClose?.();
    }

    el.querySelector('.modal-close-btn').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    el.querySelectorAll('[data-idx]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        const cfg = buttons[idx];
        cfg?.action?.();
        if (cfg?.close !== false) close();
      });
    });

    overlay.appendChild(el);
    document.body.appendChild(overlay);

    return { close, el };
  }

  // ── Confirm ──────────────────────────────────────────────────────────────

  /**
   * Show a confirm dialog, resolves true/false.
   * @param {string} message
   * @param {string} title
   * @param {object} opts  { confirmLabel, cancelLabel, dangerous }
   * @returns {Promise<boolean>}
   */
  function confirm(message, title = 'Confirm', opts = {}) {
    const {
      confirmLabel = 'Confirm',
      cancelLabel  = 'Cancel',
      dangerous    = false,
    } = opts;

    return new Promise(resolve => {
      const { close } = modal(title, `<p>${escapeHtml(message)}</p>`, {
        onClose: () => resolve(false),
        buttons: [
          { label: cancelLabel,  action: () => resolve(false), style: 'btn-secondary' },
          { label: confirmLabel, action: () => resolve(true),  style: dangerous ? 'btn-danger' : 'btn-primary', close: true },
        ],
      });
      // Override onClose so pressing X resolves false
      const btn = document.querySelector('.modal-close-btn');
      if (btn) {
        const oldHandler = btn.onclick;
        btn.onclick = () => { resolve(false); close(); };
      }
    });
  }

  /**
   * Show a "type DELETE to confirm" modal for destructive actions.
   * @param {string} surveyName
   * @returns {Promise<boolean>}
   */
  function confirmDelete(surveyName) {
    return new Promise(resolve => {
      const bodyEl = document.createElement('div');
      bodyEl.innerHTML = `
        <p style="margin-bottom:12px">
          This will permanently delete <strong>${escapeHtml(surveyName)}</strong>
          and all its observations. This cannot be undone.
        </p>
        <p style="margin-bottom:8px;font-size:.85rem;color:var(--text-muted)">
          Type <strong>DELETE</strong> to confirm:
        </p>
        <input type="text" id="delete-confirm-input" placeholder="DELETE" autocomplete="off"
               style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:var(--radius-md);font-size:1rem">
      `;

      const { close } = modal('Delete Survey', bodyEl, {
        onClose: () => resolve(false),
        buttons: [
          { label: 'Cancel', action: () => resolve(false), style: 'btn-secondary' },
          { label: 'Delete', style: 'btn-danger', action: () => {
            const val = document.getElementById('delete-confirm-input')?.value?.trim();
            if (val === 'DELETE') { resolve(true); }
            else {
              const input = document.getElementById('delete-confirm-input');
              if (input) {
                input.style.borderColor = '#dc3545';
                input.focus();
              }
              return false; // prevent close
            }
          }, close: false },
        ],
      });

      // Check on keyup to enable delete button when "DELETE" typed
      setTimeout(() => {
        const input = document.getElementById('delete-confirm-input');
        if (!input) return;
        input.focus();
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter') {
            if (input.value.trim() === 'DELETE') { close(); resolve(true); }
          }
        });
      }, 50);
    });
  }

  // ── Loading overlay ──────────────────────────────────────────────────────

  let _loadingEl = null;

  function loading(show, message = 'Loading…') {
    if (show) {
      if (_loadingEl) return;
      _loadingEl = document.createElement('div');
      _loadingEl.className = 'modal-overlay';
      _loadingEl.style.cssText = 'pointer-events:all;z-index:9999';
      _loadingEl.innerHTML = `
        <div style="background:white;border-radius:16px;padding:28px 32px;display:flex;flex-direction:column;align-items:center;gap:14px;">
          <div class="loading-spinner" style="width:32px;height:32px;border-width:4px"></div>
          <div style="font-size:.9rem;color:var(--text-secondary)">${escapeHtml(message)}</div>
        </div>
      `;
      document.body.appendChild(_loadingEl);
    } else {
      if (_loadingEl) { _loadingEl.remove(); _loadingEl = null; }
    }
  }

  // ── Cluster suggestion toast ─────────────────────────────────────────────

  /**
   * Show the cluster suggestion toast with Yes / Not Now / Never actions.
   * @param {string} species   common name
   * @param {number} count     number of nearby observations
   * @param {number} distM     distance in meters
   * @param {object} callbacks  { onYes, onNotNow, onNever }
   * @returns {{ dismiss: function }}
   */
  function clusterToast(species, count, distM, callbacks = {}) {
    const msg = `${count} ${escapeHtml(species)} observations within ${Math.round(distM)}m — convert to a stand?`;
    return toast(msg, 'cluster', [
      { label: 'Yes, Create Stand', action: callbacks.onYes   || (() => {}), style: 'btn-primary' },
      { label: 'Not Now',           action: callbacks.onNotNow || (() => {}), style: 'btn-secondary' },
      { label: 'Never',             action: callbacks.onNever  || (() => {}), style: 'btn-ghost' },
    ], 0); // sticky
  }

  /**
   * Show "This [species] is near your [species] stand — add it?" toast.
   */
  function addToStandToast(species, callbacks = {}) {
    const msg = `This ${escapeHtml(species)} is near your existing stand — add it?`;
    return toast(msg, 'cluster', [
      { label: 'Yes',  action: callbacks.onYes || (() => {}), style: 'btn-primary' },
      { label: 'No',   action: callbacks.onNo  || (() => {}), style: 'btn-secondary' },
    ], 0);
  }

  // ── Offline banner ───────────────────────────────────────────────────────

  let _offlineBanner = null;

  function offlineBanner(show) {
    if (show) {
      if (_offlineBanner) return;
      _offlineBanner = document.createElement('div');
      _offlineBanner.className = 'offline-banner';
      _offlineBanner.textContent = '● Offline — using cached data';
      const app = document.getElementById('app');
      if (app) app.prepend(_offlineBanner);
    } else {
      if (_offlineBanner) { _offlineBanner.remove(); _offlineBanner = null; }
    }
  }

  // Subscribe to network state
  window.addEventListener('online',  () => offlineBanner(false));
  window.addEventListener('offline', () => offlineBanner(true));
  if (!navigator.onLine) offlineBanner(true);

  // ── SW update toast ──────────────────────────────────────────────────────

  function swUpdateToast() {
    toast('App update available', 'info', [
      { label: 'Reload', action: () => location.reload(), style: 'btn-primary' },
    ], 0);
  }

  // ── New Survey Modal ─────────────────────────────────────────────────────

  /**
   * Show the New Survey creation modal.
   * @param {object} defaults  { surveyorName, county, township }
   * @returns {Promise<object|null>}  resolved survey data, or null if cancelled
   */
  function newSurveyModal(defaults = {}) {
    return new Promise(resolve => {
      const today = new Date().toISOString().slice(0, 10);
      const bodyEl = document.createElement('div');
      bodyEl.innerHTML = `
        <div class="form-group">
          <label>Survey Name <span style="color:#dc3545">*</span></label>
          <input type="text" id="ns-name" placeholder="Spring 2026 Canopy Survey" autocomplete="off">
        </div>
        <div class="form-group">
          <label>Site Name</label>
          <input type="text" id="ns-site" placeholder="Tyrone Township Property" autocomplete="off">
        </div>
        <div class="form-group">
          <label>Surveyor Name</label>
          <input type="text" id="ns-surveyor" value="${escapeHtml(defaults.surveyorName || '')}" autocomplete="off">
        </div>
        <div class="form-group">
          <label>Start Date</label>
          <input type="date" id="ns-date" value="${today}">
        </div>
        <div class="form-group">
          <label>Notes</label>
          <textarea id="ns-notes" rows="3" placeholder="Optional survey notes…"></textarea>
        </div>
        <div id="ns-error" style="color:#dc3545;font-size:.85rem;display:none;margin-top:4px"></div>
      `;

      const { close } = modal('New Survey', bodyEl, {
        onClose: () => resolve(null),
        buttons: [
          { label: 'Cancel', action: () => resolve(null), style: 'btn-secondary' },
          {
            label: 'Create Survey',
            style: 'btn-primary',
            close: false,
            action: () => {
              const name = document.getElementById('ns-name')?.value?.trim();
              if (!name) {
                const err = document.getElementById('ns-error');
                if (err) { err.textContent = 'Survey name is required.'; err.style.display = 'block'; }
                document.getElementById('ns-name')?.focus();
                return;
              }
              close();
              resolve({
                name,
                siteName:     document.getElementById('ns-site')?.value?.trim() || '',
                surveyorName: document.getElementById('ns-surveyor')?.value?.trim() || '',
                startDate:    document.getElementById('ns-date')?.value || today,
                notes:        document.getElementById('ns-notes')?.value?.trim() || '',
              });
            },
          },
        ],
      });

      setTimeout(() => document.getElementById('ns-name')?.focus(), 80);
    });
  }

  return {
    toast,
    toastSuccess,
    toastError,
    toastWarn,
    modal,
    confirm,
    confirmDelete,
    loading,
    clusterToast,
    addToStandToast,
    offlineBanner,
    swUpdateToast,
    newSurveyModal,
  };
})();
