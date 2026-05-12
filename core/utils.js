function generateUUID() {
  return crypto.randomUUID();
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDateForExport(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function timeAgo(isoStr) {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function metersToFeet(m) {
  return (m * 3.28084).toFixed(1);
}

function m2ToAcres(m2) {
  return (m2 / 4046.856).toFixed(3);
}

function computeConvexHull(pointArray) {
  // pointArray: [[lat, lng], ...]
  if (pointArray.length < 3) return pointArray;
  const fc = turf.featureCollection(
    pointArray.map(([lat, lng]) => turf.point([lng, lat]))
  );
  const hull = turf.convex(fc);
  if (!hull) return pointArray;
  return hull.geometry.coordinates[0].map(([lng, lat]) => [lat, lng]);
}

function computeArea(hullCoords) {
  // hullCoords: [[lat,lng],...]
  if (!hullCoords || hullCoords.length < 3) return 0;
  const ring = hullCoords.map(([lat, lng]) => [lng, lat]);
  if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
    ring.push(ring[0]);
  }
  const poly = turf.polygon([ring]);
  return turf.area(poly);
}

function computeCentroid(hullCoords) {
  // returns [lat, lng]
  if (!hullCoords || hullCoords.length === 0) return [0, 0];
  const ring = hullCoords.map(([lat, lng]) => [lng, lat]);
  if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
    ring.push(ring[0]);
  }
  const poly = turf.polygon([ring]);
  const c = turf.centroid(poly);
  return [c.geometry.coordinates[1], c.geometry.coordinates[0]];
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const from = turf.point([lng1, lat1]);
  const to = turf.point([lng2, lat2]);
  return turf.distance(from, to, { units: 'meters' });
}

function jitterCoordinate(lat, lng, maxMeters, seed) {
  // Deterministic jitter based on seed
  const s1 = hashString(String(seed) + 'lat');
  const s2 = hashString(String(seed) + 'lng');
  const angle = (s1 % 360) * (Math.PI / 180);
  const dist = (s2 % maxMeters);
  const dLat = (dist * Math.cos(angle)) / 111320;
  const dLng = (dist * Math.sin(angle)) / (111320 * Math.cos(lat * Math.PI / 180));
  return [lat + dLat, lng + dLng];
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeCsv(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function csvRow(fields) {
  return fields.map(escapeCsv).join(',');
}

function slugify(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = typeof key === 'function' ? key(item) : item[key];
    (acc[k] = acc[k] || []).push(item);
    return acc;
  }, {});
}

function unique(arr) {
  return [...new Set(arr)];
}

function formatCoord(val, pos, neg) {
  const dir = val >= 0 ? pos : neg;
  return `${Math.abs(val).toFixed(6)}°${dir}`;
}

function formatLatLng(lat, lng) {
  return `${formatCoord(lat, 'N', 'S')} ${formatCoord(lng, 'E', 'W')}`;
}

function formatAccuracy(meters) {
  if (meters === null || meters === undefined) return '±?m';
  return `±${Math.round(meters)}m`;
}

function now() {
  return new Date().toISOString();
}
