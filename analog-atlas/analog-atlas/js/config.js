/**
 * Central configuration. Most future changes (new bodies, new imagery layers,
 * camera defaults, marker colours) should only need edits here.
 */

/**
 * 'auto'  – probe NASA's tile servers at start-up; use live imagery if reachable,
 *           otherwise fall back to the bundled images (e.g. inside a sandboxed
 *           claude.ai artifact, or with no internet).
 * true    – always request live imagery.
 * false   – never touch the network (bundled imagery only).
 */
export const ONLINE_MODE = 'auto';

/** Camera behaviour. Ranges are multiples of the active body's radius. */
export const CAMERA = {
  homeRangeRadii: 4.1,       // start distance from the surface, in body radii
  minRangeRadii: 0.002,
  maxRangeRadii: 9.5,
  zoomStep: 0.75,            // multiply range by this on "zoom in"
  autoRotateDegPerSec: 3,
  idleResumeMs: 6000,
};

/* ------------------------------------------------------------------------ *
 *  Imagery sources (all NASA)
 *
 *  trek  – NASA Moon Trek / Mars Trek WMTS (JPL + SSERVI). 256 px tiles,
 *          equirectangular, level 0 = 2×1 tiles. `levels` = number of zoom
 *          levels actually served (tested Nov 2026 — the capabilities XML lists
 *          1–3 deeper levels that return errors). Beyond the last level
 *          WorldWind magnifies the sharpest tiles.
 *          https://trek.nasa.gov/tiles/{Body}/EQ/{id}/1.0.0/WMTSCapabilities.xml
 *  gibs  – NASA GIBS (Global Imagery Browse Services) WMS, EPSG:4326.
 *          https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi
 *  bundled – image shipped in /lib (works offline).
 * ------------------------------------------------------------------------ */
export const TREK_BASE = 'https://trek.nasa.gov/tiles';
export const GIBS_WMS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?';

export const BODIES = {
  earth: {
    id: 'earth', label: 'EARTH', enabled: true,
    radiusM: 6378137, // WGS84 equatorial
    atmosphere: true,
    home: { latitude: 20, longitude: -30 },
    fallbackColor: '#1d3b5c',
    defaultLayer: 'gibs-bmng-relief',
    layers: [
      { id: 'gibs-bmng-relief', label: 'Blue Marble + Relief', source: 'gibs',
        layer: 'BlueMarble_ShadedRelief_Bathymetry', format: 'image/jpeg', levels: 6,
        note: 'NASA GIBS · 500 m · shaded relief & bathymetry' },
      { id: 'gibs-bmng', label: 'Blue Marble NG', source: 'gibs',
        layer: 'BlueMarble_NextGeneration', format: 'image/jpeg', levels: 6,
        note: 'NASA GIBS · 500 m · true colour' },
      { id: 'gibs-landsat', label: 'Landsat (WELD)', source: 'gibs',
        layer: 'Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual', format: 'image/jpeg', levels: 10,
        note: 'NASA GIBS · 30 m · land only (oceans black) — best when zoomed in' },
      { id: 'gibs-aster-relief', label: 'ASTER Relief', source: 'gibs',
        layer: 'ASTER_GDEM_Color_Shaded_Relief', format: 'image/jpeg', levels: 10,
        note: 'NASA/METI ASTER GDEM via GIBS · ~30 m colour shaded relief' },
    ],
    offlineLayer: { label: 'Blue Marble (bundled)', note: 'NASA BMNG 2048×1024 — offline fallback' },
    tactical: {
      accent: '#ffd600',
      imagery: { bands: 4, ceil: 0.32, edgeFloor: 999 },
      contours: { source: 'gibs', layer: 'ASTER_GDEM_Color_Index', format: 'image/png', levels: 9,
        mode: 'hue', classes: 8, note: 'Contours: NASA/METI ASTER GDEM elevation index (GIBS)' },
    },
  },

  moon: {
    id: 'moon', label: 'MOON', enabled: true,
    radiusM: 1737400, // IAU sphere used by Moon Trek
    atmosphere: false,
    home: { latitude: 0, longitude: 0 },
    fallbackColor: '#8d8f91',
    defaultLayer: 'trek-lro-wac',
    layers: [
      { id: 'trek-lro-wac', label: 'LRO WAC Mosaic', source: 'trek', body: 'Moon',
        layer: 'LRO_WAC_Mosaic_Global_303ppd_v02', ext: 'jpg', levels: 9,
        note: 'LRO Wide Angle Camera · 303 px/° (~100 m)' },
      { id: 'trek-lola-clr', label: 'LOLA Colour Relief', source: 'trek', body: 'Moon',
        layer: 'LRO_LOLA_ClrShade_Global_128ppd_v04', ext: 'png', levels: 6,
        note: 'LRO Laser Altimeter · colour-coded elevation · 128 px/°' },
      { id: 'trek-lola-shade', label: 'LOLA Hillshade', source: 'trek', body: 'Moon',
        layer: 'LRO_LOLA_Shade_Global_256ppd_v06', ext: 'png', levels: 7,
        note: 'LRO Laser Altimeter · shaded relief · 256 px/°' },
    ],
    offlineLayer: { label: 'Placeholder sphere', note: 'Live NASA imagery needs an internet connection' },
    tactical: {
      accent: '#e3e8ea',
      imagery: { bands: 5, ceil: 0.45, edgeFloor: 45, edgeGain: 1.0 },
      contours: { source: 'trek', body: 'Moon', layer: 'LRO_LOLA_DEM_Global_128ppd_v04', ext: 'png', levels: 6,
        mode: 'gray', classes: 16, note: 'Contours: LRO LOLA DEM 128 px/° (Moon Trek)' },
    },
  },

  mars: {
    id: 'mars', label: 'MARS', enabled: true,
    radiusM: 3396190, // IAU sphere used by Mars Trek
    atmosphere: false,
    home: { latitude: 10, longitude: -60 },
    fallbackColor: '#9a4a2a',
    defaultLayer: 'trek-viking',
    layers: [
      { id: 'trek-viking', label: 'Viking Colour Mosaic', source: 'trek', body: 'Mars',
        layer: 'Mars_Viking_MDIM21_ClrMosaic_global_232m', ext: 'jpg', levels: 8,
        note: 'Viking Orbiter MDIM 2.1 colour · 232 m' },
      { id: 'trek-mola-clr', label: 'MOLA Colour Relief', source: 'trek', body: 'Mars',
        layer: 'Mars_MGS_MOLA_ClrShade_merge_global_463m', ext: 'jpg', levels: 8,
        note: 'Mars Global Surveyor laser altimeter · colour elevation · 463 m' },
      { id: 'trek-moc-atlas', label: 'MGS MOC Atlas', source: 'trek', body: 'Mars',
        layer: 'msss_atlas_simp_clon', ext: 'png', levels: 7,
        note: 'Mars Global Surveyor Mars Orbiter Camera atlas' },
    ],
    offlineLayer: { label: 'Placeholder sphere', note: 'Live NASA imagery needs an internet connection' },
    tactical: {
      accent: '#ff7043',
      imagery: { bands: 4, ceil: 0.35, edgeFloor: 999 },
      // Trek has no greyscale MOLA DEM tile service reachable from browsers, so
      // contours follow the colour bands of MOLA colour-coded elevation instead.
      contours: { source: 'trek', body: 'Mars', layer: 'Mars_MGS_MOLA_ClrShade_merge_global_463m', ext: 'jpg', levels: 8,
        mode: 'hue', classes: 20, minorAlpha: 90, note: 'Contours: MGS MOLA colour elevation (Mars Trek)' },
    },
  },
};

/** Tactical-view overlay settings (shared by all bodies). */
export const TACTICAL = {
  gridStepDeg: 15,          // sector grid spacing
  zoneRadiusRadii: 0.045,   // hatched target-zone radius, as a fraction of body radius
};

/** Colours per analog target body — used by markers and UI tags. */
export const TARGET_COLORS = {
  moon: '#cfd8dc',
  mars: '#ff7043',
  both: '#ffd600',
  target: '#4fc3f7', // marker colour for sites ON the Moon/Mars
};

/**
 * Dimensions along which analog similarity will eventually be scored. Values
 * come from each site's `scores` object once an analysis pipeline fills them.
 */
export const ANALOG_DIMENSIONS = [
  { key: 'geology',     label: 'Geology' },
  { key: 'terrain',     label: 'Terrain' },
  { key: 'thermal',     label: 'Thermal' },
  { key: 'water',       label: 'Water / Ice' },
  { key: 'dust',        label: 'Dust / Aeolian' },
  { key: 'subsurface',  label: 'Subsurface' },
  { key: 'habitability', label: 'Habitability' },
];

/* ------------------------------------------------------------------------ *
 *  Point probe: click anywhere on a globe to measure it and score how well
 *  it matches the OTHER two bodies (Earth → Moon & Mars, Moon → Earth & Mars,
 *  Mars → Earth & Moon).
 *
 *  Every metric below is a PLACEHOLDER until a real dataset is registered for
 *  it (see js/analysis.js → registerGrid). While SIMULATE_MISSING_DATA is on,
 *  unmeasured values come from a deterministic noise model so the UI, scoring
 *  and best-match search can be exercised; the UI labels them "SIM".
 * ------------------------------------------------------------------------ */
export const SIMULATE_MISSING_DATA = true;

/** Operating scales. radiusM = area averaged around the probe point. */
export const SCALES = {
  human: { id: 'human', label: 'HUMAN', radiusM: 500, mission: 'crewed EVA',
    note: 'Astronaut on foot · ~500 m EVA radius' },
  rover: { id: 'rover', label: 'ROVER', radiusM: 10000, mission: 'rover',
    note: 'Rover traverse · ~10 km radius' },
};

/**
 * Metrics measured at a probe point.
 *   label / plain  technical name / everyday name (Simple view)
 *   range   difference at which a metric's match falls to 0 (match = 1 − |Δ| / range,
 *           the same rule as the team's temperature prototype). Per-scale where it differs.
 *   weight  importance per scale in the overall score.
 *   uses    what a good match on this metric lets you test, per scale (used in explanations).
 *   sources planned dataset per body (shown in the UI until it is wired in).
 */
export const METRICS = [
  { key: 'tempHigh', label: 'Daily high', plain: 'Daytime heat', unit: '°C', digits: 0, range: 40,
    weight: { human: 1, rover: 1 },
    uses: { human: 'suit cooling and heat stress on the crew', rover: 'keeping electronics and batteries cool' },
    sources: { earth: 'NASA POWER TS_MAX', moon: 'LRO Diviner', mars: 'Mars Climate Database' } },
  { key: 'tempLow', label: 'Daily low', plain: 'Night-time cold', unit: '°C', digits: 0, range: 40,
    weight: { human: 1, rover: 1 },
    uses: { human: 'suit heating and cold-soaked equipment', rover: 'surviving the night: heaters, battery drain, frozen joints' },
    sources: { earth: 'NASA POWER TS_MIN', moon: 'LRO Diviner', mars: 'Mars Climate Database' } },
  { key: 'slope', label: 'Slope', plain: 'Steepness', unit: '°', digits: 1, range: 10,
    weight: { human: 1.5, rover: 1.2 },
    uses: { human: 'walking, climbing and carrying loads on similar grades', rover: 'traction and climbing on similar grades' },
    sources: { earth: 'SRTM / ASTER GDEM', moon: 'LRO LOLA DEM', mars: 'MGS MOLA / HRSC DEM' } },
  { key: 'relief', label: 'Local relief', plain: 'Hills & dips', unit: 'm', digits: 0, range: { human: 40, rover: 400 },
    weight: { human: 0.5, rover: 1.5 },
    uses: { human: 'line-of-sight radio and navigating between landmarks', rover: 'route planning and driving over comparable terrain' },
    sources: { earth: 'SRTM / ASTER GDEM', moon: 'LRO LOLA DEM', mars: 'MGS MOLA / HRSC DEM' } },
  { key: 'rocks', label: 'Rock abundance', plain: 'Rockiness', unit: '%', digits: 0, range: 15,
    weight: { human: 1.5, rover: 1 },
    uses: { human: 'footing among boulders and picking rock samples', rover: 'obstacle detection and hazard avoidance' },
    sources: { earth: 'ASTER surface emissivity', moon: 'LRO Diviner rock abundance', mars: 'THEMIS thermal inertia' } },
  { key: 'fines', label: 'Fine regolith / dust', plain: 'Dust & loose soil', unit: '%', digits: 0, range: 30,
    weight: { human: 1.2, rover: 1 },
    uses: { human: 'dust getting into suits, seals and airlocks', rover: 'wheels sinking or slipping in loose soil' },
    sources: { earth: 'SoilGrids sand/silt', moon: 'Diviner regolith temp.', mars: 'TES dust cover index' } },
  { key: 'albedo', label: 'Albedo', plain: 'Brightness', unit: '', digits: 2, range: 0.12,
    weight: { human: 0.5, rover: 0.5 },
    uses: { human: 'glare and lighting for the crew', rover: 'cameras and visual navigation under similar lighting' },
    sources: { earth: 'MODIS MCD43 albedo', moon: 'LRO WAC normal albedo', mars: 'MGS TES albedo' } },
  { key: 'water', label: 'Water / ice', plain: 'Water / ice', unit: 'wt%', digits: 1, range: 8,
    weight: { human: 1, rover: 1 },
    uses: { human: 'finding and sampling ice by hand', rover: 'ice prospecting with drills and instruments' },
    sources: { earth: 'SMAP soil moisture', moon: 'LRO LEND / LAMP', mars: 'Mars Odyssey GRS / SHARAD' } },
];

/** Whole-body conditions no site can be scored on: shown side by side with every probe. */
export const BODY_FACTS = [
  { key: 'gravity', label: 'Gravity', earth: '1 g', moon: '0.17 g', mars: '0.38 g',
    why: 'Changes how people walk and lift, and how rovers grip.' },
  { key: 'air', label: 'Atmosphere', earth: 'Thick, breathable', moon: 'None (vacuum)', mars: 'Thin CO₂ (1% of Earth)',
    why: 'Decides suit design, how dust moves and how heat escapes.' },
  { key: 'radiation', label: 'Radiation', earth: 'Low (shielded)', moon: 'High (unshielded)', mars: 'High (thin air, no magnetic field)',
    why: 'Limits how long crews can stay outside.' },
  { key: 'day', label: 'Day length', earth: '24 h', moon: '29.5 Earth days', mars: '24.6 h',
    why: 'Sets power, heating and work schedules.' },
];

/** Best-match search grid (degrees). Real data grids may be finer. */
export const MATCH_SEARCH_STEP_DEG = 3;
