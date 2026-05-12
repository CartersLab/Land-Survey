const State = (() => {
  const _state = {
    currentSurveyId: null,
    currentScreen: 'home',
    isOnline: navigator.onLine,
    gpsPosition: null,       // { lat, lng, accuracy }
    mapBounds: null,
    mapCenter: null,
    mapZoom: CONFIG.MAP.DEFAULT_ZOOM,
    pendingObservationDraft: null,
    clusterSuggestionQueue: [],
    activeLayerToggles: {},  // category -> boolean
    dismissedClusterKeys: new Set(),
  };

  const _listeners = {};

  function get(key) {
    return _state[key];
  }

  function set(key, value) {
    _state[key] = value;
    if (_listeners[key]) {
      _listeners[key].forEach(fn => fn(value));
    }
    if (_listeners['*']) {
      _listeners['*'].forEach(fn => fn(key, value));
    }
  }

  function subscribe(key, fn) {
    if (!_listeners[key]) _listeners[key] = [];
    _listeners[key].push(fn);
    return () => {
      _listeners[key] = _listeners[key].filter(f => f !== fn);
    };
  }

  function getAll() {
    return { ..._state };
  }

  // Persist dismissed cluster keys to appSettings
  async function loadDismissedClusterKeys() {
    try {
      const val = await DB.getRaw('appSettings', 'dismissedClusterKeys');
      if (val && Array.isArray(val)) {
        _state.dismissedClusterKeys = new Set(val);
      }
    } catch (e) { /* ignore */ }
  }

  async function saveDismissedClusterKeys() {
    try {
      await DB.putRaw('appSettings', 'dismissedClusterKeys', [..._state.dismissedClusterKeys]);
    } catch (e) { /* ignore */ }
  }

  async function addDismissedClusterKey(key) {
    _state.dismissedClusterKeys.add(key);
    await saveDismissedClusterKeys();
  }

  // Network status
  window.addEventListener('online', () => set('isOnline', true));
  window.addEventListener('offline', () => set('isOnline', false));

  return { get, set, subscribe, getAll, loadDismissedClusterKeys, addDismissedClusterKey };
})();
