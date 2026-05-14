Field Survey PWA — Complete Master Build Plan
For Claude Code Implementation

Project Overview
A Progressive Web App (PWA) for systematic ecological field surveying, designed for use on a Lenovo IdeaTab Plus Android tablet. Runs fully offline in the field. Caches map tiles when WiFi is available. Exports to multiple scientifically standard formats. No server, no account, no internet required to use in the field.

Technology Stack

Runtime: Vanilla JS (ES6+), no framework, no build step required
Map: Leaflet.js 1.9.4
GPS: leaflet-locatecontrol 0.79.0
Tile caching: Leaflet.offline 2.2.0
Geospatial: Turf.js 6.5.0 (convex hull, area, centroid, point-in-polygon)
Fuzzy search: Fuse.js 7.0.0
ZIP generation: JSZip 3.10.1
Cluster markers: Leaflet.markercluster 1.5.3
Storage: IndexedDB (via custom wrapper, no third-party lib)
Tile providers: OpenStreetMap (standard), Stadia Terrain Background (label-free), MapTiler Satellite (label-free aerial) — Stadia requires no key, MapTiler requires one free API key hardcoded in config
All dependencies loaded via CDN in index.html


Complete File Structure
/field-survey/
├── index.html
├── manifest.json
├── sw.js
├── config.js
├── style.css
│
├── core/
│   ├── db.js
│   ├── router.js
│   ├── state.js
│   └── utils.js
│
├── screens/
│   ├── home.js
│   ├── map.js
│   ├── form.js
│   ├── export.js
│   ├── survey-settings.js
│   └── app-settings.js
│
├── modules/
│   ├── species.js
│   ├── clusters.js
│   ├── tiles.js
│   ├── markers.js
│   └── ui.js
│
├── exporters/
│   ├── inat.js
│   ├── dwc.js
│   ├── mnfi.js
│   ├── geojson.js
│   ├── checklist.js
│   └── html-export.js
│
└── data/
    └── michigan-species.js

config.js
Single source of truth for all configurable values. Claude Code should never hardcode these values elsewhere — always reference CONFIG.*.
javascriptconst CONFIG = {
  MAP: {
    DEFAULT_CENTER: [42.82, -83.78],
    DEFAULT_ZOOM: 15,
    MIN_ZOOM: 10,
    MAX_ZOOM: 19,
    CACHE_MIN_ZOOM: 14,
    CACHE_MAX_ZOOM: 18,
    CLUSTER_RADIUS_METERS: 20,
    CLUSTER_MIN_COUNT: 3,
    CLUSTER_NEARBY_MULTIPLIER: 1.5,
  },
  TILE_PROVIDERS: {
    osm: {
      name: 'OpenStreetMap',
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    },
    stadia: {
      name: 'Terrain (No Labels)',
      url: 'https://tiles.stadiamaps.com/tiles/stamen_terrain_background/{z}/{x}/{y}.png',
      attribution: '© Stadia Maps © Stamen Design © OpenStreetMap contributors',
      maxZoom: 18,
    },
    maptiler: {
      name: 'Satellite (No Labels)',
      url: 'https://api.maptiler.com/maps/hybrid/{z}/{x}/{y}.jpg?key={key}',
      key: 'YOUR_MAPTILER_KEY_HERE',
      attribution: '© MapTiler © OpenStreetMap contributors',
      maxZoom: 19,
    },
  },
  GBIF: {
    SUGGEST_URL: 'https://api.gbif.org/v1/species/suggest',
    MATCH_URL: 'https://api.gbif.org/v1/species/match',
    LOOKUP_URL: 'https://api.gbif.org/v1/species',
    MAX_SUGGEST_RESULTS: 8,
    CACHE_MAX_AGE_DAYS: 90,
  },
  EXPORT: {
    INAT_COMBINE_THRESHOLD_DEFAULT: 5,
    JITTER_LOW_METERS: 50,
    JITTER_MEDIUM_METERS: 150,
    JITTER_HIGH_METERS: 400,
    HTML_TILE_BUFFER_TILES: 2,
  },
  DB: {
    NAME: 'FieldSurveyDB',
    VERSION: 1,
    STORES: ['surveys', 'observations', 'stands', 'speciesCache', 'tileRegions', 'exportSettings'],
  },
  APP: {
    VERSION: '1.0.0',
    DEFAULT_SURVEYOR: '',
    DEFAULT_COUNTY: 'Livingston',
    DEFAULT_TOWNSHIP: 'Tyrone',
  },
};

Complete Data Models
Survey
javascript{
  id: 'uuid-v4',
  name: 'Spring 2026 Canopy Survey',
  siteName: 'Tyrone Township Property',
  surveyorName: 'Carter',
  startDate: '2026-05-11',
  endDate: null,
  notes: '',
  status: 'active', // 'active' | 'complete'
  createdAt: 'ISO8601',
  updatedAt: 'ISO8601',
}
Observation
javascript{
  id: 'uuid-v4',
  surveyId: 'uuid-v4',
  geometryType: 'point', // always 'point' — stands are separate records
  latitude: 42.8234,
  longitude: -83.7821,
  coordinateAccuracyMeters: 4.2,
  clusterId: null, // uuid of parent Stand if member, else null
  category: 'tree',
  // category options: 'tree' | 'shrub' | 'herbaceous' | 'grass-sedge-rush' |
  //   'fern-moss-lichen' | 'fungus' | 'invasive' | 'mammal' | 'bird' |
  //   'reptile' | 'amphibian' | 'fish' | 'invertebrate' | 'sign-evidence'
  gbifKey: 5231190,
  scientificName: 'Quercus rubra',
  commonName: 'Northern Red Oak',
  gbifRank: 'SPECIES',
  gbifKingdom: 'Plantae',
  gbifPhylum: 'Tracheophyta',
  gbifClass: 'Magnoliopsida',
  gbifOrder: 'Fagales',
  gbifFamily: 'Fagaceae',
  gbifGenus: 'Quercus',
  lifeStage: 'mature',
  // lifeStage options: 'egg-spawn' | 'larva-tadpole-caterpillar' |
  //   'juvenile-seedling-sapling' | 'subadult' | 'adult-mature' |
  //   'senescent-dying' | 'unknown'
  condition: 'healthy',
  // condition options: 'healthy' | 'stressed' | 'damaged' | 'dead' | 'unknown'
  abundance: 1,
  // Tree-specific
  dbhCm: 42,
  heightEstimateM: null,
  canopyPosition: 'dominant',
  // canopyPosition: 'emergent' | 'dominant' | 'co-dominant' | 'intermediate' | 'suppressed'
  crownCondition: 'full',
  // crownCondition: 'full' | 'partial' | 'sparse' | 'dead-top'
  // Plant-specific
  coverEstimate: null,
  // coverEstimate: '<1' | '1-5' | '5-25' | '25-50' | '50-75' | '>75'
  // Animal-specific
  sex: null, // 'male' | 'female' | 'unknown' | null
  behavior: null,
  individualCount: null,
  // Sign/evidence-specific
  signType: null,
  // signType: 'track' | 'scat' | 'burrow' | 'nest' | 'browse' | 'trail' | 'other'
  notes: '',
  tags: [],
  isRare: false,
  obscureForExport: false,
  photoFilenames: [],
  timestamp: 'ISO8601',
  createdAt: 'ISO8601',
  updatedAt: 'ISO8601',
}
Stand (Polygon Cluster)
javascript{
  id: 'uuid-v4',
  surveyId: 'uuid-v4',
  geometryType: 'polygon',
  hullCoordinates: [[lat, lng], [lat, lng], ...], // convex hull, auto-computed
  memberObservationIds: ['uuid', 'uuid', ...],
  primaryGbifKey: 5231190,
  primaryScientificName: 'Quercus rubra',
  primaryCommonName: 'Northern Red Oak',
  standType: 'Mesic upland forest',
  // standType options pulled from NVC community types dropdown
  dominantSpecies: ['Quercus rubra', 'Acer rubrum'],
  canopyCoverEstimatePct: 85,
  understoryNotes: '',
  areaM2: 340, // auto-computed from hull
  notes: '',
  photoFilenames: [],
  isRare: false,
  obscureForExport: false,
  dismissedClusterKeys: [], // hash keys of clusters user said 'Never' to
  createdAt: 'ISO8601',
  updatedAt: 'ISO8601',
}
SpeciesCache
javascript{
  gbifKey: 5231190, // IndexedDB keyPath
  scientificName: 'Quercus rubra',
  canonicalName: 'Quercus rubra',
  commonName: 'Northern Red Oak',
  rank: 'SPECIES',
  kingdom: 'Plantae',
  phylum: 'Tracheophyta',
  class: 'Magnoliopsida',
  order: 'Fagales',
  family: 'Fagaceae',
  genus: 'Quercus',
  lastUsed: 'ISO8601',
  useCount: 7,
}
TileRegion
javascript{
  id: 'uuid-v4',
  name: 'Home Property',
  bounds: { sw: [lat, lng], ne: [lat, lng] },
  minZoom: 14,
  maxZoom: 18,
  tileSource: 'osm', // 'osm' | 'stadia' | 'maptiler'
  tileCount: 842,
  sizeBytes: 4200000,
  cachedAt: 'ISO8601',
}
ExportSettings
javascript{
  id: 'uuid-v4', // one record per survey + one global default record (id: 'global')
  surveyId: 'uuid-v4', // null for global defaults
  inat: {
    combineCommonSpecies: true,
    combinationThreshold: 5,
    autoObscureRare: true,
    autoObscureTaggedSensitive: true,
    defaultGeoprivacy: 'open', // 'open' | 'obscured' | 'private'
    includeDbhInDescription: true,
    includeConditionInDescription: true,
    addSurveyTag: true,
    surveyTag: 'field-survey-2026',
    excludeSignEvidence: true,
    excludeInvasiveLocations: false,
  },
  dwc: {
    recordedBy: 'Carter',
    datasetName: 'Tyrone Township Biodiversity Survey 2026',
    basisOfRecord: 'HumanObservation',
    samplingProtocol: 'Visual encounter survey',
    includeMeasurements: true,
    splitByCategory: false,
    onlyHighAccuracy: false,
    highAccuracyThresholdM: 10,
    excludeSignEvidence: false,
  },
  mnfi: {
    reporterName: 'Carter',
    reporterEmail: '',
    county: 'Livingston',
    township: 'Tyrone',
    onlyFlaggedRare: true,
    includePhotoFilenames: true,
    includeVerbatimNotes: true,
  },
  htmlExport: {
    obscureLocation: false,
    obscureLevel: 'medium', // 'low' | 'medium' | 'high'
    baseLayer: 'osm', // 'osm' | 'stadia' | 'maptiler'
    obscureBaseLayer: 'stadia', // layer used when obscureLocation is true
    jitterCoordinates: true,
    stripCoordinatesFromPopups: true,
    hideScaleBar: false,
    stripPhotos: false, // only active at high obscure level
    showDownloadButtons: true,
    showSpeciesSidebar: true,
    showSummaryHeader: true,
    showInventoryTable: true,
  },
  geojson: {
    includeAllFields: true,
  },
  checklist: {
    groupByCategory: true,
    includeCount: true,
    includeDateRange: true,
  },
}

core/db.js — IndexedDB Schema
All stores defined here. This file exports a DB object with async methods: get, getAll, getAllByIndex, put, delete, clear. Every other module imports from DB — no other file touches IndexedDB directly.
Store definitions:
StorekeyPathIndexessurveysidstatus, updatedAtobservationsidsurveyId, clusterId, gbifKey, category, isRarestandsidsurveyId, primaryGbifKeyspeciesCachegbifKeylastUsed, useCounttileRegionsidtileSourceexportSettingsidsurveyIdtileBitmapstileKey— (tileKey = {source}/{z}/{x}/{y})
The tileBitmaps store holds raw tile image data (ArrayBuffer) keyed by tile URL components. This is separate from the other stores because it may grow very large and benefits from independent management.

core/state.js
A simple reactive state object. Holds:

currentSurveyId — which survey is active
currentScreen — which screen is rendered
isOnline — live network status
gpsPosition — current lat/lng/accuracy
mapBounds — current map viewport
pendingObservationDraft — partially filled form data (survives crashes)
clusterSuggestionQueue — array of pending cluster suggestions to show

State changes trigger re-renders only for components subscribed to specific keys. No full-page re-renders.

core/router.js
Hash-based router (#home, #map, #export, #settings). Handles back button correctly on Android. Preserves map state (position, zoom) when navigating away and returning.

Screens Detail
screens/home.js
Renders:

App header with name and version
Online/offline status pill (green dot "Online" / gray dot "Offline")
List of all surveys ordered by updatedAt descending
Each survey card shows: name, site name, start date, observation count, species count, status badge, "Last saved X minutes ago"
Per-card action buttons: Continue (→ map screen), Export (→ export screen), Settings (→ survey settings screen), Delete (confirmation modal)
+ New Survey FAB (floating action button, bottom right)
New Survey modal fields: Survey Name (required), Site Name, Surveyor Name (pre-filled from app settings), Start Date (today default), Notes
Bottom bar: tile cache status, species DB last updated

Behaviors:

Surveys auto-save every 30 seconds while active and on every observation save
Delete requires typing "DELETE" to confirm (surveys with observations only — empty surveys delete immediately)


screens/map.js
Renders:

Full-screen Leaflet map (no chrome)
GPS dot via leaflet-locatecontrol, enableHighAccuracy: true, continuous watch
All observations and stands for the current survey rendered as markers/polygons
Floating controls:

Top-left: back arrow + survey name label
Top-right: layer toggle panel (collapsible) + legend
Bottom-left: + Add at GPS button (large, green, thumb-reachable)
Bottom-right: Locate Me button



Map interactions:

Short tap on empty map: nothing (prevents accidental form opens)
Long press (500ms) on empty map: opens observation form pre-filled with tapped coordinates. Visual ripple effect at press point during 500ms hold to give feedback.
Short tap on observation marker: opens popup
Short tap on stand polygon: opens stand popup
Long press on existing marker: opens edit form directly

Marker popup contents:

Species common name (large) + scientific name (italic, small)
Category icon + life stage + condition
Photo thumbnail (first photo, if any)
DBH if tree
Notes excerpt (truncated to 80 chars, tap to expand)
Rare flag indicator if set
Edit button | Delete button (with confirmation)
If observation is member of a stand: "Part of [Stand name]" link

Stand polygon popup contents:

"Stand: [primary species common name]"
Area in m² and acres
Member count
Stand type
Dominant species list
Edit Stand button | Dissolve button

Layer toggle panel:
Each category has a colored toggle chip. Toggling hides/shows all markers of that category. State persists for the session. Legend shows category → color/shape mapping.

screens/form.js
Bottom sheet, slides up from bottom, map visible behind (dimmed). Two modes: New Observation and Edit Observation.
Section 1 — Location

Coordinates display: 42.8234°N 83.7821°W ±4m
Source label: "From GPS" or "From map tap"
Re-snap to GPS button (updates coords to current GPS position)
Expandable: manual lat/lng text fields

Section 2 — Category
Icon grid, 4 columns, single select. Icons are SVG. Categories:
Tree, Shrub, Herbaceous, Grass/Sedge/Rush, Fern/Moss/Lichen, Fungus, Invasive, Mammal, Bird, Reptile, Amphibian, Fish, Invertebrate, Sign/Evidence
Section 3 — Species Search

Text input, placeholder: "Search by common or scientific name..."
As user types (debounced 300ms):

If online: queries CONFIG.GBIF.SUGGEST_URL?q={term}&limit=8 filtered by kingdom matching selected category
If offline: queries michigan-species.js via Fuse.js
Previously used species (from speciesCache, sorted by useCount desc) always shown at top before search results


Result row: common name bold + scientific name italic + kingdom badge
Selecting a result: stores full GBIF record, adds/updates speciesCache entry
"Unknown / Unidentified [Category]" always available as last option → notes field becomes required

Section 4 — Core Fields

Life Stage: dropdown (7 options)
Condition: dropdown (5 options)
Abundance: number input (default 1)
Notes: textarea (4 rows)
Tags: chip input (type and press enter/comma to add, tap chip to remove)

Section 5 — Category-specific Fields
Shown/hidden dynamically based on Section 2 selection:
Tree:

DBH (cm): number input with +/- stepper
Height estimate (m): number input
Canopy position: dropdown (5 options)
Crown condition: dropdown (4 options)

Shrub / Herbaceous / Grass-Sedge-Rush / Fern-Moss-Lichen / Fungus / Invasive:

Cover estimate: dropdown (<1% / 1–5% / 5–25% / 25–50% / 50–75% / >75%)

Mammal / Bird / Reptile / Amphibian / Fish / Invertebrate:

Individual count: number input
Sex: dropdown (Male / Female / Unknown)
Behavior at observation: text input

Sign/Evidence:

Sign type: dropdown (Track / Scat / Burrow / Nest / Browse / Trail / Other)
Associated species (if known): species search (same component)

Section 6 — Rare Species Flag

Toggle switch: "Flag as potentially rare / notable"
When on: isRare = true, obscureForExport = true auto-set
Info text shown: "Flagged observations export as obscured by default. Consider reporting to MNFI."
Link: mnfi.anr.msu.edu/mnfi/rare-species-reporting (opens in browser)

Section 7 — Photo

Attach Photo button → <input type="file" accept="image/*" capture="environment" multiple>
Android will show camera / gallery chooser
After selection: thumbnail grid (max 5 photos)
Stores filenames only, photos go to device gallery
Each thumbnail has × remove button
"Note: Photos save to your device gallery. Filenames recorded here for reference."

Section 8 — Save

Save Observation button (full width, prominent)
On save: writes to IndexedDB, closes form, marker appears on map, cluster detection runs
Form draft auto-saved to state every 10 seconds while open


Cluster Detection Logic (modules/clusters.js)
Runs after every observation save. Full algorithm:
FUNCTION checkForClusters(savedObservation, surveyId):
  1. Load all observations for surveyId with same gbifKey as savedObservation
  2. Filter to only point observations (geometryType === 'point')
  3. Build proximity groups:
     - For each observation, find all others within CONFIG.MAP.CLUSTER_RADIUS_METERS
     - Using Turf.js distance calculation
     - Group connected components (if A is near B and B is near C, all three are one group)
  4. For each group with count >= CONFIG.MAP.CLUSTER_MIN_COUNT:
     a. Check if group already has a Stand (all member IDs match an existing stand)
     b. If yes: check if savedObservation is within CLUSTER_RADIUS * CLUSTER_NEARBY_MULTIPLIER
        of the stand centroid
        - If yes: show toast "This [species] is near your existing [species] stand — add it? [Yes] [No]"
        - If no: do nothing
     c. If no existing stand:
        - Compute a clusterKey: hash of sorted member observation IDs
        - Check if clusterKey is in any stand's dismissedClusterKeys
        - If dismissed: do nothing
        - If not dismissed: show toast notification:
          "[N] [Species] observations within [Xm] — convert to a stand?
           [Yes, Create Stand] [Not Now] [Never]"
  5. If user selects "Yes, Create Stand":
     - Create Stand record
     - Set all member observations' clusterId to stand.id
     - Compute convex hull via Turf.convex()
     - Compute area via Turf.area()
     - Render polygon on map, remove individual markers (they become part of polygon)
     - Open minimal stand detail form (stand type dropdown, canopy cover, notes)
  6. If "Not Now": dismiss toast, will re-evaluate next time an observation is added
  7. If "Never": store clusterKey in a global dismissedClusterKeys set in state
     (persisted to a small 'settings' record in IndexedDB)
Adding to existing stand:
When user selects "Yes" to the "add to stand" toast:

Add observation ID to stand's memberObservationIds
Set observation's clusterId to stand.id
Recompute convex hull and area
Update stand record
Update map polygon geometry

Edit Stand panel:

Member observation list (species, timestamp, condition, remove button per row)
"Add nearby observation" — shows list of same-species point observations within 50m not yet in a stand
Stand type dropdown
Canopy cover slider
Understory notes
Dissolve button → sets all member clusterId to null, deletes stand, restores individual markers


modules/species.js
GBIF suggest (online):
GET https://api.gbif.org/v1/species/suggest?q={term}&limit=8
Results filtered by kingdom matching category:

Plants (tree/shrub/herb/grass/fern/fungus/invasive) → kingdom=Plantae or Fungi
Animals → kingdom=Animalia
No filter for unknown/sign categories

Full record fetch (on selection):
GET https://api.gbif.org/v1/species/{key}
Stores result in speciesCache IndexedDB store.
Offline fallback:
Fuse.js search over michigan-species.js with keys: ['commonName', 'scientificName'], threshold 0.4.
Previously used species:
On form open, load top 10 from speciesCache ordered by useCount desc. Show as "Recent" section above search results even before user types anything.

modules/tiles.js
Caching:

User presses "Save Map for Offline Use" button on map screen
Modal shows: name input, current view bounding box, zoom range slider (14–18 default), estimated tile count and size
On confirm: iterates all tile x/y/z combos within bounds and zoom range, fetches each tile URL, stores ArrayBuffer in tileBitmaps IndexedDB store keyed as {source}/{z}/{x}/{y}
Progress bar shown during download
TileRegion record created on completion
Duplicate tiles (same key) are skipped silently

Service worker tile intercept:
SW intercepts all tile URL requests. Checks tileBitmaps store. If hit: serves from cache. If miss: fetches from network. If network fails and no cache: serves a 1×1 gray PNG placeholder.
Cache management (App Settings screen):

Lists all TileRegions with name, source, tile count, size, date cached
Per-region delete button
Total cache size display
"Clear all tile cache" button


Export Formats — Complete Specification
exporters/inat.js — iNaturalist CSV
Output: Single .csv file, directly uploadable to inaturalist.org/observations/import
Column order (exact iNaturalist spec):
taxon_name, observed_on, description, place_name, latitude, longitude, tags, geoprivacy
Field mapping:

taxon_name → observation.scientificName
observed_on → observation.timestamp formatted as YYYY-MM-DD HH:MM
description → assembled string:

If not combined: "[Common Name] — Life stage: [X]. Condition: [X]. DBH: [X]cm. [notes]"
If combined (see below): see combined format


place_name → survey.siteName
latitude / longitude → coordinates (jittered if obscure settings active)
tags → observation.tags joined by comma + survey tag if enabled
geoprivacy → 'obscured' if obscureForExport=true or isRare=true and autoObscureRare setting on, else defaultGeoprivacy

Combined species logic:
When combineCommonSpecies=true and a species has >= combinationThreshold observations:

One row emitted per species
Coordinates: centroid of all member observations
description: "[Common Name] ([Scientific Name]) — [N] individuals combined. DBH range: [min]–[max]cm (if trees). Conditions: [healthy (N), stressed (N)]. Life stages: [X, Y]. Notes from individuals: [note1]; [note2]; [note3]. Survey: [surveyName]."
tags: union of all member tags + "combined-observation"

Stand export:
Stands export as centroid point with description noting it's a stand: "Stand of [N] [species] — Area: [X]m². Canopy cover: [X]%. Stand type: [X]. [understory notes]. [notes]."
Excluded records:

Sign/evidence observations if excludeSignEvidence=true
Invasive observations if excludeInvasiveLocations=true


exporters/dwc.js — Darwin Core Archive
Output: .zip file containing:

occurrences.csv — core occurrence records
measurements.csv — extended measurements (DBH, height, cover, etc.) linked by occurrenceID
meta.xml — DwC-A descriptor (hardcoded template, Claude Code fills field names)
eml.xml — dataset metadata (filled from survey and export settings)

occurrences.csv columns:
occurrenceID, basisOfRecord, scientificName, taxonRank, kingdom, phylum,
class, order, family, genus, specificEpithet, taxonKey,
decimalLatitude, decimalLongitude, coordinateUncertaintyInMeters,
eventDate, year, month, day, recordedBy, lifeStage,
occurrenceRemarks, individualCount, samplingProtocol,
locationID, footprintWKT, occurrenceStatus
Field mapping:

occurrenceID → observation.id
basisOfRecord → from export settings (default 'HumanObservation')
taxonKey → observation.gbifKey
footprintWKT → null for points; 'POLYGON((lng lat, lng lat, ...))' for stands
decimalLatitude/Longitude → observation coords for points; stand centroid for stands
occurrenceStatus → 'present'
lifeStage → mapped to Darwin Core vocabulary: 'Egg'|'Larva'|'Juvenile'|'Subadult'|'Adult'|'Unknown'
locationID → survey.siteName

measurements.csv columns (MeasurementOrFact extension):
occurrenceID, measurementType, measurementValue, measurementUnit
Rows emitted for: DBH (cm), heightEstimate (m), coverEstimate (%), canopyCoverPct (%), areaM2 (m²)
meta.xml template:
Standard DwC-A descriptor linking occurrences.csv as core and measurements.csv as extension. Claude Code should use the GBIF-standard meta.xml template exactly.
eml.xml template:
Filled fields: title (dataset name), creator (recorded by), pubDate (export date), abstract (auto-generated from survey name + dates + obs count), geographicCoverage (bounding box of all observations), taxonomicCoverage (list of all scientific names).

exporters/mnfi.js — MNFI Report
Output: Two files bundled as a ZIP:

mnfi-report.html — formatted printable report
mnfi-data.csv — structured data matching MNFI element occurrence fields

mnfi-report.html contents:

Header: Reporter name, email, county, township, survey name, export date
Summary: total rare observations, species list
Per-observation section (one per rare/flagged obs):

Species (scientific + common), GBIF key
Date observed
County, Township
GPS coordinates (full precision — MNFI needs exact locations)
GPS accuracy (meters)
Life stage, condition
Abundance
Observer notes (verbatim if setting enabled)
Photo filenames listed
Quality flag: A (GPS <5m, species confirmed) / B (GPS 5–15m or unconfirmed ID) / C (GPS >15m or unknown species)


Footer: iNaturalist submission reminder text

mnfi-data.csv columns:
species_scientific, species_common, gbif_key, obs_date, county, township,
latitude, longitude, gps_accuracy_m, observer, life_stage, condition,
abundance, notes, photo_filenames, eo_quality_flag, survey_name
Filter: Only observations with isRare=true if onlyFlaggedRare=true in settings. Otherwise all observations included.

exporters/geojson.js — GeoJSON
Output: Single .geojson file
Structure: FeatureCollection with:

Point Features for all non-clustered observations (all observation fields as properties)
Polygon Features for all stands (convex hull as geometry, stand fields + member count as properties)

All fields included verbatim. No filtering, no obscuring. This is the full-fidelity science-grade export.

exporters/checklist.js — Species Checklist
Output: Two files:

species-checklist.csv
species-checklist.txt (human-readable plain text)

CSV columns: category, scientific_name, common_name, gbif_key, observation_count, first_observed, last_observed, life_stages_observed, rare_flagged
Text format:
SPECIES INVENTORY — [Survey Name]
[Site Name] | [Date Range] | [Observer]
Generated: [date]
Total species: N | Total observations: N

TREES (N species)
  Northern Red Oak (Quercus rubra) — 12 obs, May 2026
  Sugar Maple (Acer saccharum) — 8 obs, May 2026
  ...

SHRUBS (N species)
  ...

exporters/html-export.js — Interactive HTML Survey Page
Output: Single self-contained .html file
Architecture:
All survey data baked as a JSON literal in a <script> tag. Leaflet loaded from CDN. Leaflet.markercluster loaded from CDN. No other dependencies. File works when opened directly or embedded in a website.
Map behavior:

Leaflet map, full-width left panel (60% on desktop, full width on mobile)
Tile provider based on htmlExport.baseLayer setting:

osm: standard OpenStreetMap tiles (live, requires internet)
stadia: Stadia Terrain Background — topographic, roads as lines, zero labels (requires internet)
maptiler: MapTiler Satellite hybrid — aerial imagery, roads as semi-transparent lines, zero labels (requires internet, uses API key from config.js)


When obscureLocation=true: force tile layer to obscureBaseLayer (default stadia) regardless of baseLayer setting
Zoom: z10–z19, starts at z15 centered on observation centroid
All observations rendered as styled markers matching the main app's color/shape system
Stands rendered as semi-transparent filled polygons with border
Leaflet.markercluster active: overlapping markers at current zoom cluster into a number badge, click to expand or zoom in
Long-press / click any marker: rich popup (see below)
Long-press / click stand polygon: stand popup

Obscure location mode:
When obscureLocation=true:

Tile layer forced to label-free provider (stadia or maptiler label-free)
All observation coordinates in the embedded JSON are jittered by amount based on obscureLevel:

low: random offset 0–50m applied consistently per observation
medium: random offset 0–150m
high: random offset 0–400m


Jitter is seeded per-export (same export always shows same jitter, different exports show different jitter)
Coordinates stripped from all popups
Scale bar hidden
If stripPhotos=true (high level): photo filenames not shown in popups

Right sidebar (species & filter panel):

Survey name + site name header
Summary stats: N observations, N species, N categories, date range
Category filter chips (toggle show/hide per category)
Life stage filter dropdown
Search box: filters observation list by species name
Observation list below filters: each row shows category icon, common name, date, tap to fly-map to that observation and open its popup
Collapsible "Species Inventory" section: grouped by category, species name + count per species, clicking a species filters map to show only that species

Marker popup contents:

Common name (H3) + scientific name (italic)
Category + life stage + condition badges
DBH if tree
Notes (full text)
Photo filenames listed (or thumbnails if photos were embedded — not default)
Rare flag warning if set
Coords (stripped if obscure mode)

Download buttons (if showDownloadButtons=true):

Download GeoJSON (triggers download of embedded data as .geojson)
Download CSV Checklist (generates and downloads from embedded data)

Responsive:

Desktop: map left 60%, sidebar right 40%
Mobile/tablet: sidebar collapses to bottom drawer, map full screen, drawer handle at bottom

Styling:
Clean, nature-themed. Dark green primary color. Cream/off-white backgrounds. Monospace for coordinates. Sans-serif body. Legible at arm's length on a tablet. No external CSS dependencies — all styles inline in the <style> tag.

screens/export.js — Export Panel UI
Tabbed interface, 5 tabs: iNaturalist | Darwin Core | MNFI | GeoJSON | Checklist | HTML
Each tab shows:

Settings section (all toggles and inputs for that format per ExportSettings model)
Preview line: "This export will produce N observation records" (computed live as settings change)
Special notes or warnings (e.g., "Photos cannot be attached via CSV — filenames included in description")
Download button

Settings are saved to ExportSettings IndexedDB record for the survey automatically as changed. First time opening export for a survey, settings are cloned from the global defaults record.

screens/app-settings.js
Sections:
Default Values:

Default surveyor name
Default county
Default township
Default observation geoprivacy

Map & Tiles:

Tile cache list (TileRegions): name, source, size, date, delete button
Total cache size
Clear all cache button
Default tile source for caching (osm / stadia / maptiler)

Species Database:

Last updated timestamp
Total cached species count
"Update species list" button (fetches recent searches from GBIF when online)
Clear species cache button

Export Defaults:

All ExportSettings fields for the global defaults record
"These defaults apply to all new surveys"

About:

App version
"Built for field ecological survey — Carter, 2026"


manifest.json
json{
  "name": "Field Survey",
  "short_name": "Survey",
  "description": "Offline ecological field survey tool",
  "start_url": "/index.html",
  "display": "standalone",
  "orientation": "any",
  "background_color": "#1a2e1a",
  "theme_color": "#2d5a1b",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
Icons should be a simple leaf or pin icon on a dark green background. Claude Code can generate these as SVG and convert to PNG, or create them as inline SVG data URIs in the manifest.

sw.js — Service Worker
Two caches:

field-survey-shell-v1 — all app files cached on install
field-survey-tiles-v1 — tile requests served from IndexedDB tileBitmaps store

Install event: Caches all app shell files listed in a SHELL_FILES array (all JS, CSS, HTML, data files).
Fetch event strategy:

App shell files: cache-first, network fallback
Tile requests (URLs matching tile provider patterns): check IndexedDB tileBitmaps first, network fallback, gray placeholder if both fail
GBIF API requests: network-only (never cache — always fresh or fail gracefully)
Everything else: network-first, cache fallback

Activate event: Deletes old cache versions.
Update strategy: When new SW version detected, shows a toast in the app: "App update available — reload to update." User taps to reload.

data/michigan-species.js
Array of ~300 species objects, weighted toward:

All native Michigan tree species (~60 entries)
Common shrubs and understory woody plants (~50 entries)
Wetland and fen specialists (tamarack, bog laurel, pitcher plant, sundew, swamp birch, tussock sedge, etc.) (~30 entries)
Common invasives (glossy/common buckthorn, autumn olive, multiflora rose, garlic mustard, Japanese knotweed, Phragmites, etc.) (~20 entries)
Common Michigan herps (~30 entries, includes all Ambystoma, Eurycea, Necturus, turtles, snakes)
Common mammals (~20 entries)
Common wetland birds (~20 entries)
Common invertebrates (odonates, lepidoptera relevant to your monitoring) (~20 entries)
Fungi (~10 entries)

Each entry:
javascript{
  gbifKey: 2878688,
  scientificName: 'Larix laricina',
  commonName: 'Tamarack',
  rank: 'SPECIES',
  kingdom: 'Plantae',
  family: 'Pinaceae',
  genus: 'Larix',
  category: 'tree',
  michiganNative: true,
}

Build Phases for Claude Code
Phase 1 — Foundation
Files: index.html, manifest.json, sw.js, style.css, config.js, core/db.js, core/utils.js
index.html loads all CDN dependencies and all local JS files. Contains a single <div id="app"> mount point. Service worker registered in an inline script. All screens rendered into #app by JS — no page navigations.
db.js creates all IndexedDB stores on first load, exports DB object with get(store, key), getAll(store), getAllByIndex(store, index, value), put(store, record), delete(store, key), clear(store) — all return Promises.
utils.js exports: generateUUID(), formatDate(ISO), metersToFeet(m), computeConvexHull(pointArray) (wraps Turf), computeArea(hullCoords) (wraps Turf), computeCentroid(hullCoords) (wraps Turf), distanceMeters(lat1,lng1,lat2,lng2) (wraps Turf), jitterCoordinate(lat,lng,maxMeters,seed), downloadFile(blob,filename), hashString(str).
Phase 2 — Home Screen
Files: core/router.js, core/state.js, screens/home.js
Phase 3 — Map + GPS + Tile Caching
Files: screens/map.js, modules/tiles.js
Phase 4 — Species System
Files: modules/species.js, data/michigan-species.js
Phase 5 — Observation Form
Files: screens/form.js
Phase 6 — Markers + Map Interaction
Files: modules/markers.js
Phase 7 — Cluster / Stand System
Files: modules/clusters.js
Phase 8 — Export Engine (no settings UI)
Files: exporters/inat.js, exporters/dwc.js, exporters/mnfi.js, exporters/geojson.js, exporters/checklist.js, exporters/html-export.js
Phase 9 — Export Settings UI
Files: screens/export.js
Phase 10 — App Settings Screen
Files: screens/app-settings.js, screens/survey-settings.js
Phase 11 — UI Polish
Files: modules/ui.js (toast system, modals, confirmation dialogs, loading states, error messages, offline banner, GPS accuracy indicator, haptic feedback via navigator.vibrate)

Notes for Claude Code

Never use localStorage — all persistence goes through db.js and IndexedDB
Never use a framework — vanilla JS only, ES6 modules via <script type="module">
All async operations use async/await, never raw .then() chains
Every DB write is wrapped in try/catch with a toast error on failure
GPS coordinates stored at full float64 precision in DB, rounded only at display time
All UUIDs generated via crypto.randomUUID() (available on Android Chrome)
The config.js MAPTILER_KEY field is intentionally left as 'YOUR_MAPTILER_KEY_HERE' — user fills this in once after download
File is structured so Claude Code can implement one phase at a time and test it before moving to the next
The service worker SHELL_FILES array must be manually kept in sync with the actual file list — Claude Code should generate this array at the end of Phase 1 based on the complete file list