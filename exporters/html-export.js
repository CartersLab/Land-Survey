const HtmlExporter = (() => {

  async function generate(surveyId) {
    const [obs, stands, survey, exportSettingsRaw] = await Promise.all([
      DB.getAllByIndex('observations', 'surveyId', surveyId),
      DB.getAllByIndex('stands',       'surveyId', surveyId),
      DB.get('surveys', surveyId).catch(() => null),
      DB.get('exportSettings', surveyId).catch(() => null),
    ]);

    const S = exportSettingsRaw?.htmlExport || {};
    const obscure         = S.obscureLocation    ?? false;
    const obscureLevel    = S.obscureLevel        || 'medium';
    const baseLayer       = obscure ? (S.obscureBaseLayer || 'stadia') : (S.baseLayer || 'osm');
    const stripCoords     = obscure && (S.stripCoordinatesFromPopups ?? true);
    const hideScale       = obscure && (S.hideScaleBar ?? false);
    const stripPhotos     = obscure && obscureLevel === 'high' && (S.stripPhotos ?? false);
    const showDl          = S.showDownloadButtons ?? true;

    const obscureMaxM = obscure
      ? (obscureLevel === 'low' ? CONFIG.EXPORT.JITTER_LOW_METERS
       : obscureLevel === 'high' ? CONFIG.EXPORT.JITTER_HIGH_METERS
       : CONFIG.EXPORT.JITTER_MEDIUM_METERS)
      : 0;

    const exportSeed = Date.now();
    const tp = CONFIG.TILE_PROVIDERS[baseLayer] || CONFIG.TILE_PROVIDERS.osm;

    // Prepare observation data (jitter if needed, normalise field names)
    const obsData = obs.map(o => {
      let lat = o.lat ?? o.latitude;
      let lng = o.lng ?? o.longitude;
      if (obscure && lat && lng) [lat, lng] = jitterCoordinate(lat, lng, obscureMaxM, o.id + exportSeed);
      return {
        id:             o.id,
        lat, lng,
        category:       o.category || '',
        commonName:     o.commonName || '',
        scientificName: o.scientificName || '',
        gbifKey:        o.gbifKey || null,
        lifeStage:      o.lifeStage || '',
        condition:      o.condition || '',
        count:          o.count || o.individualCount || o.abundance || 1,
        dbhCm:          o.dbhCm || null,
        heightM:        o.heightM || o.heightEstimateM || null,
        coveragePct:    o.coveragePct ?? o.coverEstimate ?? null,
        behavior:       o.behavior || '',
        signType:       o.signType || '',
        notes:          o.notes || '',
        isRare:         o.isRare || false,
        observedAt:     o.observedAt || o.timestamp || o.createdAt || '',
        photoFilenames: (!stripPhotos && o.photoFilenames) ? o.photoFilenames : [],
        clusterId:      o.clusterId || null,
      };
    });

    // Prepare stand data
    const standData = stands.map(s => {
      let polygon = (s.polygon || s.hullCoordinates || []).slice();
      if (obscure && polygon.length) {
        polygon = polygon.map(([lat, lng]) => jitterCoordinate(lat, lng, obscureMaxM, s.id + exportSeed));
      }
      return {
        id:                  s.id,
        polygon,
        category:            s.category || '',
        primarySpeciesName:  s.primarySpeciesName || s.primaryCommonName || '',
        primaryScientificName: s.primaryScientificName || '',
        areaM2:              s.areaM2 || 0,
        obsCount:            (s.memberObservationIds || []).length || s.obsCount || 0,
        standType:           s.standType || '',
        notes:               s.notes || '',
      };
    });

    // Map center
    const pts = obsData.filter(o => o.lat && o.lng);
    let center = CONFIG.MAP.DEFAULT_CENTER;
    if (pts.length) {
      const lats = pts.map(p => p.lat), lngs = pts.map(p => p.lng);
      center = [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lngs) + Math.max(...lngs)) / 2];
    }

    const surveyName = survey?.name || 'Field Survey';
    const exportDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    const dataJson = JSON.stringify({
      survey: {
        name:         surveyName,
        siteName:     survey?.siteName     || '',
        surveyorName: survey?.surveyorName || '',
        startDate:    survey?.startDate    || '',
        endDate:      survey?.endDate      || '',
      },
      observations: obsData,
      stands:       standData,
      meta: { stripCoords, hideScale, showDl, exportDate },
      tileUrl:  tp.url,
      tileAttr: tp.attribution,
      center,
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(surveyName)}</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css">
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:14px;color:#1a1a1a;height:100vh;overflow:hidden;display:flex;flex-direction:column;background:#f5f0e8}
#app{display:flex;flex:1;overflow:hidden;height:100%}
#map-wrap{flex:0 0 60%;height:100%;position:relative;z-index:1}
#map{width:100%;height:100%;background:#e8e4dd}
#sidebar{flex:0 0 40%;height:100%;display:flex;flex-direction:column;background:#f5f0e8;border-left:1px solid #d0c8b8;overflow:hidden}
#sidebar-header{background:#2d5a1b;color:#fff;padding:14px 16px;flex-shrink:0}
#sidebar-header h1{font-size:1.05rem;font-weight:700;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#sidebar-header .meta{font-size:.76rem;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#stats-bar{display:flex;gap:6px;padding:8px 12px;background:#fff;border-bottom:1px solid #e0d8cc;flex-shrink:0;flex-wrap:wrap}
.stat-chip{background:#edf3e8;border-radius:20px;padding:3px 10px;font-size:.78rem;font-weight:700;color:#2d5a1b}
#filters{padding:8px 12px;border-bottom:1px solid #e0d8cc;background:#fff;flex-shrink:0}
#filters .flabel{font-size:.72rem;color:#999;font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-bottom:5px}
#cat-chips{display:flex;flex-wrap:wrap;gap:3px;margin-bottom:7px}
.cat-chip{border:1.5px solid;border-radius:12px;padding:2px 8px;font-size:.73rem;cursor:pointer;font-weight:700;user-select:none;transition:opacity .15s}
.cat-chip.off{opacity:.25}
#life-sel{width:100%;padding:5px 7px;border:1px solid #ccc;border-radius:6px;font-size:.82rem;margin-bottom:6px;background:#fff}
#search{width:100%;padding:7px 10px;border:1.5px solid #ccc;border-radius:8px;font-size:.84rem;background:#fff}
#search:focus{outline:none;border-color:#2d5a1b}
#obs-list{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch}
.obs-row{display:flex;align-items:flex-start;gap:8px;padding:9px 12px;border-bottom:1px solid #ece8de;cursor:pointer}
.obs-row:hover,.obs-row.hi{background:#eaf4e4}
.obs-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;margin-top:3px}
.obs-body{flex:1;min-width:0}
.obs-common{font-weight:600;font-size:.87rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.obs-sci{font-style:italic;font-size:.76rem;color:#888;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.obs-date{font-size:.72rem;color:#aaa}
.rare-tag{color:#856404;font-size:.7rem;font-weight:700}
#inv-section{border-top:2px solid #d0c8b8;flex-shrink:0;max-height:34%;display:flex;flex-direction:column}
#inv-toggle{padding:7px 12px;font-weight:700;font-size:.8rem;color:#2d5a1b;cursor:pointer;background:#e8f0e4;border:none;text-align:left;flex-shrink:0;width:100%}
#inv-body{overflow-y:auto;display:none;padding:4px 0}
#inv-body.open{display:block}
.inv-cat{padding:5px 12px 2px;font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#888}
.inv-sp{display:flex;justify-content:space-between;align-items:baseline;padding:3px 12px 3px 20px;cursor:pointer;font-size:.79rem}
.inv-sp:hover{background:#eaf4e4}
.inv-sp em{font-size:.74rem;color:#999}
#dl-bar{padding:8px 12px;background:#e8f0e4;border-top:1px solid #c8d8b8;display:flex;gap:8px;flex-shrink:0}
.dl-btn{flex:1;padding:7px;background:#2d5a1b;color:#fff;border:none;border-radius:6px;font-size:.79rem;font-weight:700;cursor:pointer}
.dl-btn:hover{background:#1a3a0f}
/* Popup styles */
.pp{min-width:180px;max-width:260px}
.pp-name{font-size:.98rem;font-weight:700;margin-bottom:2px}
.pp-sci{font-style:italic;font-size:.8rem;color:#555;margin-bottom:6px}
.badge{display:inline-block;border-radius:10px;padding:2px 7px;font-size:.7rem;font-weight:700;color:#fff;margin:0 3px 3px 0}
.pp-row{font-size:.82rem;color:#333;margin-top:3px}
.pp-notes{font-size:.81rem;color:#555;margin-top:6px;border-top:1px solid #eee;padding-top:5px}
.pp-coords{font-family:monospace;font-size:.75rem;color:#999;margin-top:3px}
.pp-rare{color:#856404;font-weight:700;font-size:.8rem;margin-top:4px}
.pp-date{font-size:.72rem;color:#bbb;margin-top:4px}
/* Responsive: tablet/mobile stacks vertically */
@media(max-width:780px){
  #app{flex-direction:column}
  #map-wrap{flex:1;width:100%;min-height:55vh}
  #sidebar{flex:0 0 auto;max-height:45vh;width:100%;border-left:none;border-top:2px solid #c8d8b8}
}
</style>
</head>
<body>
<div id="app">
  <div id="map-wrap"><div id="map"></div></div>
  <div id="sidebar">
    <div id="sidebar-header">
      <h1 id="hdr-name"></h1>
      <div class="meta" id="hdr-meta"></div>
    </div>
    <div id="stats-bar"></div>
    <div id="filters">
      <div class="flabel">Categories</div>
      <div id="cat-chips"></div>
      <select id="life-sel">
        <option value="">All life stages</option>
        <option value="egg-spawn">Egg / Spawn</option>
        <option value="larva-tadpole-caterpillar">Larva / Tadpole / Caterpillar</option>
        <option value="juvenile-seedling-sapling">Juvenile / Seedling / Sapling</option>
        <option value="subadult">Subadult</option>
        <option value="adult-mature">Adult / Mature</option>
        <option value="senescent-dying">Senescent / Dying</option>
        <option value="unknown">Unknown</option>
      </select>
      <input id="search" type="search" placeholder="Search species…">
    </div>
    <div id="obs-list"></div>
    <div id="inv-section">
      <button id="inv-toggle">▶ Species Inventory</button>
      <div id="inv-body"></div>
    </div>
    <div id="dl-bar" style="display:none">
      <button class="dl-btn" id="dl-geojson">⬇ GeoJSON</button>
      <button class="dl-btn" id="dl-csv">⬇ CSV Checklist</button>
    </div>
  </div>
</div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"></script>
<script>
const DATA = ${dataJson};
</script>
<script>
(function(){
  var D = DATA;
  var obs = D.observations, stands = D.stands, survey = D.survey, meta = D.meta;
  var CAT_COLORS = {
    'tree':'#2d7a2d','shrub':'#5a9e3a','herbaceous':'#8bc34a','grass-sedge-rush':'#c5e06a',
    'fern-moss-lichen':'#7bc17b','fungus':'#d4a843','invasive':'#e53935','bird':'#1565c0',
    'mammal':'#6d4c41','reptile':'#558b2f','amphibian':'#00838f','fish':'#0277bd',
    'invertebrate':'#7b1fa2','sign-evidence':'#546e7a'
  };
  var CAT_LABELS = {
    'tree':'Trees','shrub':'Shrubs','herbaceous':'Herbaceous','grass-sedge-rush':'Grass/Sedge/Rush',
    'fern-moss-lichen':'Fern/Moss/Lichen','fungus':'Fungi','invasive':'Invasives','bird':'Birds',
    'mammal':'Mammals','reptile':'Reptiles','amphibian':'Amphibians','fish':'Fish',
    'invertebrate':'Invertebrates','sign-evidence':'Sign/Evidence'
  };

  function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function fmtDate(iso){ try{ return new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }catch(e){ return ''; } }

  // ── Map
  var map = L.map('map',{ center: D.center, zoom: 15, zoomControl: true, attributionControl: true });
  if(!meta.hideScale) L.control.scale({imperial:true,metric:true}).addTo(map);
  L.tileLayer(D.tileUrl,{ attribution: D.tileAttr, maxZoom: 19 }).addTo(map);

  var markerLayer = (typeof L.markerClusterGroup === 'function')
    ? L.markerClusterGroup({ maxClusterRadius:40, disableClusteringAtZoom:17, showCoverageOnHover:false,
        iconCreateFunction: function(cl){
          return L.divIcon({ html:'<div style="background:#2d5a1b;color:#fff;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.82rem;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)">'+cl.getChildCount()+'</div>', className:'', iconSize:[34,34], iconAnchor:[17,17] });
        }})
    : L.layerGroup();
  map.addLayer(markerLayer);
  var standLayer = L.layerGroup().addTo(map);

  // ── Filter state
  var usedCats = [];
  (function(){ var s={}; obs.forEach(function(o){ if(o.category && !s[o.category]){ s[o.category]=1; usedCats.push(o.category); }}); })();
  var activeCats = {}; usedCats.forEach(function(c){ activeCats[c]=true; });
  var activeLife = '', searchTerm = '', activeId = null;
  var markerMap = {};

  function visible(o){
    if(!activeCats[o.category]) return false;
    if(activeLife && o.lifeStage !== activeLife) return false;
    if(searchTerm){ var q=searchTerm.toLowerCase(); if(!(o.commonName||'').toLowerCase().includes(q) && !(o.scientificName||'').toLowerCase().includes(q)) return false; }
    return true;
  }

  // ── Popup builders
  function makePopup(o){
    var color = CAT_COLORS[o.category]||'#666';
    var catLabel = CAT_LABELS[o.category]||o.category;
    var h = '<div class="pp">';
    h += '<div class="pp-name">'+esc(o.commonName||o.scientificName||'Unknown')+'</div>';
    if(o.scientificName && o.scientificName!==o.commonName) h += '<div class="pp-sci">'+esc(o.scientificName)+'</div>';
    h += '<span class="badge" style="background:'+color+'">'+esc(catLabel)+'</span>';
    if(o.lifeStage) h += '<span class="badge" style="background:#607d8b">'+esc(o.lifeStage.replace(/-/g,' '))+'</span>';
    if(o.condition) h += '<span class="badge" style="background:#78909c">'+esc(o.condition)+'</span>';
    if(o.dbhCm) h += '<div class="pp-row">DBH: '+o.dbhCm+' cm</div>';
    if(o.heightM) h += '<div class="pp-row">Height: '+(o.heightM*3.28084).toFixed(1)+' ft</div>';
    if(o.count > 1) h += '<div class="pp-row">Count: '+o.count+'</div>';
    if(o.coveragePct!=null) h += '<div class="pp-row">Cover: '+esc(String(o.coveragePct))+'</div>';
    if(o.behavior) h += '<div class="pp-row">Behavior: '+esc(o.behavior)+'</div>';
    if(o.signType) h += '<div class="pp-row">Sign: '+esc(o.signType)+'</div>';
    if(!meta.stripCoords && o.lat) h += '<div class="pp-coords">'+o.lat.toFixed(6)+', '+o.lng.toFixed(6)+'</div>';
    if(o.photoFilenames && o.photoFilenames.length) h += '<div class="pp-row">📷 '+o.photoFilenames.map(esc).join(', ')+'</div>';
    if(o.notes) h += '<div class="pp-notes">'+esc(o.notes)+'</div>';
    if(o.isRare) h += '<div class="pp-rare">⚑ Rare / Notable</div>';
    if(o.observedAt) h += '<div class="pp-date">'+fmtDate(o.observedAt)+'</div>';
    h += '</div>';
    return h;
  }

  function makeStandPopup(s){
    var color = CAT_COLORS[s.category]||'#666';
    var acres = s.areaM2 ? (s.areaM2/4046.856).toFixed(3)+' ac' : '—';
    var h = '<div class="pp">';
    h += '<div class="pp-name">Stand: '+esc(s.primarySpeciesName||s.primaryScientificName||'Unknown')+'</div>';
    if(s.primaryScientificName && s.primaryScientificName!==s.primarySpeciesName) h += '<div class="pp-sci">'+esc(s.primaryScientificName)+'</div>';
    if(s.standType) h += '<div class="pp-row">'+esc(s.standType)+'</div>';
    h += '<div class="pp-row">Area: '+(s.areaM2 ? Math.round(s.areaM2)+' m² / ' : '')+acres+'</div>';
    h += '<div class="pp-row">Members: '+s.obsCount+'</div>';
    if(s.notes) h += '<div class="pp-notes">'+esc(s.notes)+'</div>';
    h += '</div>';
    return h;
  }

  // ── Render markers
  function renderMarkers(){
    markerLayer.clearLayers();
    markerMap = {};
    obs.forEach(function(o){
      if(!o.lat||!o.lng) return;
      if(!visible(o)) return;
      var color = CAT_COLORS[o.category]||'#666';
      var m = L.circleMarker([o.lat,o.lng],{ radius:7, color:'#fff', weight:2, fillColor:color, fillOpacity:.9 })
        .bindPopup(makePopup(o),{ maxWidth:280 });
      (function(id){ m.on('click', function(){ highlightRow(id); }); })(o.id);
      markerMap[o.id] = m;
      markerLayer.addLayer(m);
    });
  }

  // ── Render stands
  function renderStands(){
    standLayer.clearLayers();
    stands.forEach(function(s){
      if(!s.polygon||s.polygon.length<3) return;
      var color = CAT_COLORS[s.category]||'#666';
      var latlngs = s.polygon.map(function(p){ return [p[0],p[1]]; });
      L.polygon(latlngs,{ color:color, weight:2, fillColor:color, fillOpacity:.15, dashArray:'6,4' })
        .bindPopup(makeStandPopup(s),{ maxWidth:260 })
        .addTo(standLayer);
    });
  }

  // ── Sidebar helpers
  function renderHeader(){
    document.getElementById('hdr-name').textContent = survey.name;
    var parts = [];
    if(survey.siteName) parts.push(survey.siteName);
    if(survey.surveyorName) parts.push(survey.surveyorName);
    if(survey.startDate) parts.push(survey.startDate);
    document.getElementById('hdr-meta').textContent = parts.join(' · ');
  }

  function renderStats(){
    var vis = obs.filter(visible);
    var species = {}, cats = {};
    vis.forEach(function(o){ if(o.scientificName) species[o.scientificName]=1; if(o.category) cats[o.category]=1; });
    var dates = vis.map(function(o){ return o.observedAt; }).filter(Boolean).sort();
    var dateStr = '';
    if(dates.length){ var a=fmtDate(dates[0]),b=fmtDate(dates[dates.length-1]); dateStr=a===b?a:a+' – '+b; }
    document.getElementById('stats-bar').innerHTML =
      '<span class="stat-chip">'+vis.length+' obs</span>'+
      '<span class="stat-chip">'+Object.keys(species).length+' species</span>'+
      '<span class="stat-chip">'+Object.keys(cats).length+' categories</span>'+
      (dateStr?'<span class="stat-chip">'+esc(dateStr)+'</span>':'');
  }

  function renderCatChips(){
    var el = document.getElementById('cat-chips');
    el.innerHTML = usedCats.map(function(cat){
      var color = CAT_COLORS[cat]||'#666';
      var label = (CAT_LABELS[cat]||cat).split('/')[0];
      return '<span class="cat-chip'+(activeCats[cat]?'':' off')+'" data-cat="'+esc(cat)+'" style="border-color:'+color+';color:'+color+'">'+esc(label)+'</span>';
    }).join('');
    el.querySelectorAll('.cat-chip').forEach(function(chip){
      chip.addEventListener('click', function(){
        var cat = chip.dataset.cat;
        activeCats[cat] = !activeCats[cat];
        chip.classList.toggle('off', !activeCats[cat]);
        refreshAll();
      });
    });
  }

  function renderObsList(){
    var el = document.getElementById('obs-list');
    var vis = obs.filter(visible).slice().sort(function(a,b){
      return (a.commonName||a.scientificName||'').localeCompare(b.commonName||b.scientificName||'');
    });
    if(!vis.length){ el.innerHTML='<div style="padding:20px;text-align:center;color:#bbb;font-size:.84rem">No observations match filters</div>'; return; }
    el.innerHTML = vis.map(function(o){
      var color = CAT_COLORS[o.category]||'#666';
      var active = o.id===activeId?' hi':'';
      return '<div class="obs-row'+active+'" data-id="'+esc(o.id)+'">'+
        '<div class="obs-dot" style="background:'+color+'"></div>'+
        '<div class="obs-body">'+
          '<div class="obs-common">'+esc(o.commonName||o.scientificName||'Unknown')+(o.isRare?' <span class="rare-tag">⚑</span>':'')+'</div>'+
          (o.scientificName&&o.scientificName!==o.commonName?'<div class="obs-sci">'+esc(o.scientificName)+'</div>':'')+
          (o.observedAt?'<div class="obs-date">'+fmtDate(o.observedAt)+'</div>':'')+
        '</div></div>';
    }).join('');
    el.querySelectorAll('.obs-row').forEach(function(row){
      row.addEventListener('click', function(){ flyTo(row.dataset.id); });
    });
  }

  function renderInventory(){
    var el = document.getElementById('inv-body');
    var toggle = document.getElementById('inv-toggle');
    var byCat = {};
    obs.forEach(function(o){
      if(!o.scientificName) return;
      var cat = o.category||'unknown';
      if(!byCat[cat]) byCat[cat]={};
      if(!byCat[cat][o.scientificName]) byCat[cat][o.scientificName]={common:o.commonName,n:0};
      byCat[cat][o.scientificName].n++;
    });
    var totalSp = Object.values(byCat).reduce(function(n,sp){ return n+Object.keys(sp).length; },0);
    toggle.textContent = (el.classList.contains('open')?'▼':'▶')+' Species Inventory ('+totalSp+')';
    el.innerHTML = Object.keys(byCat).sort().map(function(cat){
      var label = CAT_LABELS[cat]||cat;
      return '<div class="inv-cat">'+esc(label)+'</div>'+
        Object.keys(byCat[cat]).sort().map(function(sci){
          var d=byCat[cat][sci];
          return '<div class="inv-sp" data-sci="'+esc(sci)+'"><span>'+esc(d.common||sci)+' <em>'+esc(sci)+'</em></span><em>'+d.n+'</em></div>';
        }).join('');
    }).join('');
    el.querySelectorAll('.inv-sp').forEach(function(row){
      row.addEventListener('click', function(){
        searchTerm = row.dataset.sci;
        document.getElementById('search').value = searchTerm;
        refreshAll();
      });
    });
  }

  function highlightRow(id){
    activeId = id;
    document.querySelectorAll('.obs-row').forEach(function(r){ r.classList.toggle('hi', r.dataset.id===id); });
    var el = document.querySelector('.obs-row[data-id="'+id+'"]');
    if(el) el.scrollIntoView({behavior:'smooth',block:'nearest'});
  }

  function flyTo(id){
    highlightRow(id);
    var o = obs.find(function(o){ return o.id===id; });
    if(!o||!o.lat) return;
    map.flyTo([o.lat,o.lng], Math.max(map.getZoom(),17), {duration:0.8});
    if(markerMap[id]) setTimeout(function(){ markerMap[id].openPopup(); }, 900);
  }

  function refreshAll(){
    renderMarkers();
    renderStats();
    renderObsList();
    renderInventory();
  }

  // ── Event bindings
  document.getElementById('life-sel').addEventListener('change', function(e){ activeLife=e.target.value; refreshAll(); });
  document.getElementById('search').addEventListener('input', function(e){ searchTerm=e.target.value.trim(); refreshAll(); });
  document.getElementById('inv-toggle').addEventListener('click', function(){
    document.getElementById('inv-body').classList.toggle('open');
    renderInventory();
  });

  // ── Download buttons
  if(meta.showDl){
    document.getElementById('dl-bar').style.display='flex';
    document.getElementById('dl-geojson').addEventListener('click', function(){
      var features = [];
      obs.forEach(function(o){ if(!o.lat) return; features.push({type:'Feature',geometry:{type:'Point',coordinates:[o.lng,o.lat]},properties:{id:o.id,commonName:o.commonName,scientificName:o.scientificName,category:o.category,lifeStage:o.lifeStage,condition:o.condition,notes:o.notes,isRare:o.isRare,observedAt:o.observedAt}}); });
      stands.forEach(function(s){ if(!s.polygon||s.polygon.length<3) return; var coords=s.polygon.map(function(p){return[p[1],p[0]];}); if(coords[0][0]!==coords[coords.length-1][0]||coords[0][1]!==coords[coords.length-1][1]) coords.push(coords[0]); features.push({type:'Feature',geometry:{type:'Polygon',coordinates:[coords]},properties:{id:s.id,primarySpeciesName:s.primarySpeciesName,category:s.category,areaM2:s.areaM2,obsCount:s.obsCount}}); });
      dl(JSON.stringify({type:'FeatureCollection',features:features},null,2),'application/json','survey-data.geojson');
    });
    document.getElementById('dl-csv').addEventListener('click', function(){
      var rows=[['category','scientific_name','common_name','gbif_key','observation_count','first_observed','last_observed','rare_flagged']];
      var sp={};
      obs.forEach(function(o){ if(!o.scientificName) return; var k=(o.category||'')+'|'+o.scientificName; if(!sp[k]) sp[k]={category:o.category,sci:o.scientificName,common:o.commonName,gbif:o.gbifKey,n:0,dates:[],rare:false}; sp[k].n++; if(o.observedAt) sp[k].dates.push(o.observedAt); if(o.isRare) sp[k].rare=true; });
      Object.values(sp).sort(function(a,b){return (a.category+a.sci).localeCompare(b.category+b.sci);}).forEach(function(r){ var d=r.dates.sort(); rows.push([r.category,r.sci,r.common||'',r.gbif||'',r.n,d[0]||'',d[d.length-1]||'',r.rare]); });
      dl(rows.map(function(r){return r.map(function(v){var s=String(v);return(s.includes(',')||s.includes('"'))?'"'+s.replace(/"/g,'""')+'"':s;}).join(',');}).join('\n'),'text/csv','species-checklist.csv');
    });
  }

  function dl(content,mime,filename){
    var blob=new Blob([content],{type:mime});
    var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename;
    document.body.appendChild(a); a.click(); setTimeout(function(){document.body.removeChild(a);URL.revokeObjectURL(a.href);},500);
  }

  // ── Fit map to data
  var pts = obs.filter(function(o){return o.lat&&o.lng;}).map(function(o){return[o.lat,o.lng];});
  if(pts.length) try{ map.fitBounds(L.latLngBounds(pts),{padding:[40,40],maxZoom:17}); }catch(e){}

  // ── Boot
  renderHeader();
  renderCatChips();
  renderStands();
  refreshAll();
  setTimeout(function(){ map.invalidateSize(); }, 150);
})();
</script>
</body>
</html>`;
  }

  return { generate };
})();
