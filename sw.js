/**
 * sw.js — Field Survey Service Worker
 *
 * Two caches:
 *   field-survey-shell-v1   — app shell files (HTML, JS, CSS, data)
 *   field-survey-tiles-v1   — map tile responses (network fallback)
 *
 * Tile bitmaps (offline map regions) are stored in IndexedDB (tileBitmaps
 * store) by the app itself; this SW intercepts tile requests and checks
 * that store before hitting the network.
 *
 * Strategy:
 *   App shell  → cache-first, network fallback
 *   Tile URLs  → IndexedDB first, then network, then gray placeholder
 *   GBIF / iNat API → network-only (never cached)
 *   Everything else → network-first, cache fallback
 */

const SHELL_CACHE  = 'field-survey-shell-v26';
const TILE_CACHE   = 'field-survey-tiles-v1';
const DB_NAME      = 'FieldSurveyDB';
const TILE_STORE   = 'tileBitmaps';

// All app shell files — keep in sync with index.html script/link tags.
const SHELL_FILES = [
  './index.html',
  './manifest.json',
  './style.css',
  './config.js',
  './core/db.js',
  './core/utils.js',
  './core/state.js',
  './core/router.js',
  './modules/ui.js',
  './modules/species.js',
  './modules/tiles.js',
  './modules/markers.js',
  './modules/clusters.js',
  './screens/home.js',
  './screens/map.js',
  './screens/form.js',
  './screens/export.js',
  './screens/survey-settings.js',
  './screens/app-settings.js',
  './exporters/inat.js',
  './exporters/dwc.js',
  './exporters/mnfi.js',
  './exporters/geojson.js',
  './exporters/checklist.js',
  './exporters/html-export.js',
  './data/michigan-species.js',
  './icons/icon.svg',
];

// URL patterns that are tile requests
const TILE_URL_PATTERNS = [
  'tile.openstreetmap.org',
  'tiles.stadiamaps.com',
  'api.maptiler.com/maps',
];

// URL patterns to never cache (always network)
const NETWORK_ONLY_PATTERNS = [
  'api.gbif.org',
  'api.inaturalist.org',
];

// 1×1 gray PNG placeholder for missing tiles
const GRAY_TILE_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function grayTileResponse() {
  const bytes = Uint8Array.from(atob(GRAY_TILE_B64), c => c.charCodeAt(0));
  return new Response(bytes, {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
  });
}

// ── IndexedDB helper (minimal, SW-safe) ──────────────────────────────────

let _idb = null;

function openIDB() {
  if (_idb) return Promise.resolve(_idb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME);
    req.onsuccess = e => { _idb = e.target.result; resolve(_idb); };
    req.onerror   = ()  => reject(req.error);
    // Don't run upgrades from SW — the main page handles schema creation.
  });
}

async function getTileBitmap(tileKey) {
  try {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(TILE_STORE, 'readonly');
      const req = tx.objectStore(TILE_STORE).get(tileKey);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = () => resolve(null); // treat as miss
    });
  } catch { return null; }
}

// Derive tile key from URL: "{source}/{z}/{x}/{y}"
function tileKeyFromUrl(url) {
  const u = new URL(url);
  const parts = u.pathname.split('/').filter(Boolean);
  // OSM / Stadia: /{z}/{x}/{y}.png  → last 3 path segments
  const last3 = parts.slice(-3).join('/').replace(/\.[^.]+$/, '');
  // Identify source prefix
  if (u.hostname.includes('openstreetmap')) return `osm/${last3}`;
  if (u.hostname.includes('stadiamaps'))    return `stadia/${last3}`;
  if (u.hostname.includes('maptiler'))      return `maptiler/${last3}`;
  return `tile/${last3}`;
}

// ── Install ───────────────────────────────────────────────────────────────

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async cache => {
      // cache: 'reload' bypasses the HTTP cache so CDN propagation delays
      // don't cause the SW to install stale versions of app files.
      const results = await Promise.allSettled(
        SHELL_FILES.map(url =>
          fetch(url, { cache: 'reload' })
            .then(res => { if (res.ok) cache.put(url, res); })
        )
      );
      const failed = results.filter(r => r.status === 'rejected');
      if (failed.length) console.warn('[SW] Some shell files failed during install:', failed.length);
    }).then(() => self.skipWaiting())
  );
});

// ── Activate ──────────────────────────────────────────────────────────────

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== SHELL_CACHE && k !== TILE_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────

self.addEventListener('fetch', event => {
  const { url, method } = event.request;
  if (method !== 'GET') return;

  // Never cache GBIF / iNat API calls
  if (NETWORK_ONLY_PATTERNS.some(p => url.includes(p))) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Tile requests: check IndexedDB first
  if (TILE_URL_PATTERNS.some(p => url.includes(p))) {
    event.respondWith(handleTile(event.request));
    return;
  }

  // App shell: cache-first
  const urlPath = new URL(url).pathname;
  if (SHELL_FILES.some(f => urlPath.endsWith(f.replace('./', '/'))) || urlPath.endsWith('/') || urlPath.endsWith('/index.html')) {
    event.respondWith(
      caches.match(event.request).then(cached =>
        cached || fetch(event.request).then(res => {
          const clone = res.clone();
          caches.open(SHELL_CACHE).then(c => c.put(event.request, clone));
          return res;
        })
      ).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Everything else: network-first
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

async function handleTile(request) {
  // 1. Check IndexedDB (user-cached map region)
  const key = tileKeyFromUrl(request.url);
  const bitmap = await getTileBitmap(key);
  if (bitmap) {
    return new Response(bitmap, {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400' },
    });
  }

  // 2. Try network, also stash in tile cache
  try {
    const res = await fetch(request);
    if (res.ok) {
      const clone = res.clone();
      caches.open(TILE_CACHE).then(c => c.put(request, clone));
    }
    return res;
  } catch {
    // 3. Serve gray placeholder
    return grayTileResponse();
  }
}

// ── Message handler (e.g., skipWaiting from app) ──────────────────────────

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
