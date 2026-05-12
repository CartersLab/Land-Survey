const Tiles = (() => {

  function createLayer(providerKey) {
    const p = CONFIG.TILE_PROVIDERS[providerKey];
    if (!p) throw new Error(`Unknown tile provider: ${providerKey}`);
    let url = p.url;
    if (p.key && p.key !== 'YOUR_MAPTILER_KEY_HERE') url = url.replace('{key}', p.key);
    return L.tileLayer(url, {
      attribution: p.attribution,
      maxZoom:     p.maxZoom || 19,
      crossOrigin: true,
    });
  }

  // Estimate tile count before caching
  function estimateTileCount(bounds, minZoom, maxZoom) {
    let total = 0;
    for (let z = minZoom; z <= maxZoom; z++) {
      const min = _latLngToTile(bounds.getSouth(), bounds.getWest(), z);
      const max = _latLngToTile(bounds.getNorth(), bounds.getEast(), z);
      const dx = Math.abs(max.x - min.x) + 1;
      const dy = Math.abs(max.y - min.y) + 1;
      total += dx * dy;
    }
    return total;
  }

  async function cacheRegion(map, providerKey, regionName, onProgress) {
    const bounds  = map.getBounds();
    const minZoom = CONFIG.MAP.CACHE_MIN_ZOOM;
    const maxZoom = CONFIG.MAP.CACHE_MAX_ZOOM;
    const tiles   = _getTilesInBounds(bounds, minZoom, maxZoom);
    const p       = CONFIG.TILE_PROVIDERS[providerKey];
    if (!p) throw new Error(`Unknown tile provider: ${providerKey}`);

    const regionId = generateUUID();
    let done = 0, failed = 0;

    for (const tile of tiles) {
      const url = _tileUrl(p, tile);
      const key = `${providerKey}/${tile.z}/${tile.x}/${tile.y}`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
        if (res.ok) {
          const buf = await res.arrayBuffer();
          await DB.putRaw('tileBitmaps', key, buf);
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
      done++;
      onProgress?.({ done, total: tiles.length, failed });
    }

    const region = {
      id:         regionId,
      name:       regionName,
      tileSource: providerKey,
      bounds: {
        south: bounds.getSouth(),
        north: bounds.getNorth(),
        west:  bounds.getWest(),
        east:  bounds.getEast(),
      },
      minZoom,
      maxZoom,
      tileCount: done - failed,
      cachedAt:  now(),
    };
    await DB.put('tileRegions', region);
    return region;
  }

  function _tileUrl(provider, tile) {
    const subdomains = ['a', 'b', 'c'];
    let url = provider.url
      .replace('{z}', tile.z)
      .replace('{x}', tile.x)
      .replace('{y}', tile.y)
      .replace('{s}', subdomains[Math.floor(Math.random() * 3)]);
    if (provider.key && provider.key !== 'YOUR_MAPTILER_KEY_HERE') {
      url = url.replace('{key}', provider.key);
    }
    return url;
  }

  function _getTilesInBounds(bounds, minZoom, maxZoom) {
    const tiles = [];
    for (let z = minZoom; z <= maxZoom; z++) {
      const sw = _latLngToTile(bounds.getSouth(), bounds.getWest(), z);
      const ne = _latLngToTile(bounds.getNorth(), bounds.getEast(), z);
      const x0 = Math.min(sw.x, ne.x);
      const x1 = Math.max(sw.x, ne.x);
      const y0 = Math.min(sw.y, ne.y);
      const y1 = Math.max(sw.y, ne.y);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          tiles.push({ z, x, y });
        }
      }
    }
    return tiles;
  }

  function _latLngToTile(lat, lng, zoom) {
    const n = Math.pow(2, zoom);
    const x = Math.floor((lng + 180) / 360 * n);
    const latRad = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    return { x: clamp(x, 0, n - 1), y: clamp(y, 0, n - 1) };
  }

  async function getRegions()          { return DB.getAll('tileRegions'); }
  async function deleteRegion(id)      { await DB.delete('tileRegions', id); }
  async function countTiles()          { return DB.count('tileBitmaps'); }

  return { createLayer, estimateTileCount, cacheRegion, getRegions, deleteRegion, countTiles };
})();
