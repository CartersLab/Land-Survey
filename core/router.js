const Router = (() => {
  const routes = {};
  let _currentScreen = null;

  function register(name, renderFn, destroyFn) {
    routes[name] = { render: renderFn, destroy: destroyFn || (() => {}) };
  }

  function navigate(screen, params = {}) {
    const hash = params && Object.keys(params).length
      ? `#${screen}?${new URLSearchParams(params).toString()}`
      : `#${screen}`;
    history.pushState({ screen, params }, '', hash);
    _show(screen, params);
  }

  function replace(screen, params = {}) {
    const hash = params && Object.keys(params).length
      ? `#${screen}?${new URLSearchParams(params).toString()}`
      : `#${screen}`;
    history.replaceState({ screen, params }, '', hash);
    _show(screen, params);
  }

  function _show(screen, params) {
    if (_currentScreen && routes[_currentScreen]) {
      try { routes[_currentScreen].destroy(); } catch(e) {}
    }
    _currentScreen = screen;
    State.set('currentScreen', screen);
    const app = document.getElementById('app');
    app.innerHTML = '';
    if (routes[screen]) {
      routes[screen].render(app, params);
    } else {
      app.innerHTML = `<div class="error-screen">Screen not found: ${screen}</div>`;
    }
  }

  function getCurrentParams() {
    const hash = window.location.hash;
    const qIdx = hash.indexOf('?');
    if (qIdx === -1) return {};
    return Object.fromEntries(new URLSearchParams(hash.slice(qIdx + 1)));
  }

  function init() {
    window.addEventListener('popstate', (e) => {
      if (e.state && e.state.screen) {
        _show(e.state.screen, e.state.params || {});
      } else {
        _show('home', {});
      }
    });

    const hash = window.location.hash.slice(1);
    const qIdx = hash.indexOf('?');
    const screen = qIdx === -1 ? hash : hash.slice(0, qIdx);
    const params = qIdx === -1 ? {} : Object.fromEntries(new URLSearchParams(hash.slice(qIdx + 1)));

    if (screen && routes[screen]) {
      _show(screen, params);
    } else {
      navigate('home');
    }
  }

  return { register, navigate, replace, init, getCurrentParams };
})();
