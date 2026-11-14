/**
 * Site catalogue for all three bodies.
 *
 * EARTH sites are analogs. MOON / MARS sites are exploration targets; each
 * target lists the Earth analogs that relate to it (`analogs`), which the UI
 * turns into two-way "jump" links between planets.
 *
 * These are a handful of WELL-KNOWN seed sites so the map has something to show.
 * The hackathon brief asks for less-studied analogs, so expect this list to be
 * replaced by what your similarity search (NASA Earth vs Moon/Mars data) finds.
 * The analog ↔ target links below are illustrative, not results.
 *
 * Schema:
 *   id, name, region, lat, lon (decimal °; planetocentric, east-positive, −180..180)
 *   body        'earth' | 'moon' | 'mars'
 *   environment short type label
 *   summary     1–3 sentences
 *   strengths / limits   arrays of short strings (Earth analogs)
 *   targets     ['moon'|'mars']        (Earth analogs: which body it is an analog for)
 *   analogs     [earthSiteId, …]       (Moon/Mars targets: linked Earth analogs)
 *   scores      { [dimensionKey]: 0..1 } — empty until the analysis fills it
 *   datasets    [{ name, url }]
 */
export const SITES = [
  /* ------------------------------ EARTH ------------------------------ */
  {
    id: 'haughton-crater', body: 'earth',
    name: 'Haughton Crater', region: 'Devon Island, Nunavut, Canada',
    lat: 75.38, lon: -89.67, targets: ['mars', 'moon'],
    environment: 'Polar-desert impact crater',
    summary: 'A ~20 km impact structure in a cold, dry, sparsely vegetated polar desert; long used for Mars field-operations rehearsals.',
    strengths: ['Impact geology and breccias', 'Cold, dry, remote operations', 'Permafrost and ground ice'],
    limits: ['Earth gravity and atmosphere', 'Liquid water in summer', 'Well studied already'],
    scores: {}, datasets: [],
  },
  {
    id: 'atacama-yungay', body: 'earth',
    name: 'Yungay, Atacama', region: 'Antofagasta Region, Chile',
    lat: -24.08, lon: -69.92, targets: ['mars'],
    environment: 'Hyperarid desert',
    summary: 'One of the driest places on Earth, with oxidising, nearly sterile soils that resemble aspects of Martian regolith.',
    strengths: ['Extreme aridity', 'Oxidant-rich soils', 'Life-detection instrument testing'],
    limits: ['Warm compared with Mars', 'Dense atmosphere, UV filtered'],
    scores: {}, datasets: [],
  },
  {
    id: 'rio-tinto', body: 'earth',
    name: 'Río Tinto', region: 'Huelva, Andalusia, Spain',
    lat: 37.72, lon: -6.56, targets: ['mars'],
    environment: 'Acidic, iron-rich river system',
    summary: 'Highly acidic waters rich in iron and sulfate minerals such as jarosite, a mineral also identified on Mars by the Opportunity rover.',
    strengths: ['Sulfate / iron mineralogy', 'Acidophile extremophiles'],
    limits: ['Abundant liquid water', 'Partly shaped by mining'],
    scores: {}, datasets: [],
  },
  {
    id: 'lonar-crater', body: 'earth',
    name: 'Lonar Crater', region: 'Maharashtra, India',
    lat: 19.98, lon: 76.51, targets: ['moon', 'mars'],
    environment: 'Impact crater in basalt',
    summary: 'A young impact crater formed in Deccan Traps basalt — basalt being a dominant rock type of the lunar maria and much of Mars.',
    strengths: ['Impact into basalt', 'Shock-metamorphosed rocks'],
    limits: ['Humid climate, saline lake', 'Vegetated'],
    scores: {}, datasets: [],
  },
  {
    id: 'cueva-de-los-verdes', body: 'earth',
    name: 'Cueva de los Verdes', region: 'Lanzarote, Canary Islands, Spain',
    lat: 29.16, lon: -13.44, targets: ['moon', 'mars'],
    environment: 'Lava tube',
    summary: 'Part of a long lava-tube system — the type of subsurface void proposed as shelter for future Moon and Mars bases.',
    strengths: ['Lava tube geometry', 'Cave navigation and mapping tests'],
    limits: ['Much smaller than candidate lunar tubes', 'Earth gravity'],
    scores: {}, datasets: [],
  },

  /* ------------------------------- MOON ------------------------------ */
  {
    id: 'shackleton', body: 'moon',
    name: 'Shackleton Crater', region: 'Lunar south pole',
    lat: -89.67, lon: 129.78,
    environment: 'Polar impact crater (permanently shadowed interior)',
    summary: '21 km crater at the lunar south pole. Parts of its rim get near-continuous sunlight while the interior stays in permanent shadow and may trap water ice — a leading candidate area for a sustained Moon base.',
    analogs: ['haughton-crater'],
    scores: {}, datasets: [{ name: 'IAU / USGS Gazetteer', url: 'https://planetarynames.wr.usgs.gov/Feature/5450' }],
  },
  {
    id: 'marius-hills-pit', body: 'moon',
    name: 'Marius Hills Pit', region: 'Oceanus Procellarum (nearside)',
    lat: 14.09, lon: -56.77,
    environment: 'Possible lava-tube skylight',
    summary: 'A pit tens of metres across inside a sinuous rille in the Marius Hills volcanic region, imaged by NASA LRO — a possible opening into a lava tube that could shelter a base.',
    analogs: ['cueva-de-los-verdes', 'lonar-crater'],
    scores: {}, datasets: [{ name: 'LROC Pits Atlas', url: 'https://lroc.im-ldi.com/pits/1' }],
  },

  /* ------------------------------- MARS ------------------------------ */
  {
    id: 'meridiani-planum', body: 'mars',
    name: 'Meridiani Planum', region: 'Opportunity landing site',
    lat: -1.95, lon: -5.53,
    environment: 'Sulfate-rich sedimentary plain',
    summary: 'Where NASA’s Opportunity rover found jarosite and other sulfate minerals that point to past acidic water.',
    analogs: ['rio-tinto', 'atacama-yungay'],
    scores: {}, datasets: [],
  },
  {
    id: 'jezero', body: 'mars',
    name: 'Jezero Crater', region: 'Perseverance landing site',
    lat: 18.38, lon: 77.58,
    environment: 'Impact crater with ancient lake delta',
    summary: 'A ~45 km crater that once held a lake, now explored by NASA’s Perseverance rover for signs of ancient life.',
    analogs: ['lonar-crater', 'haughton-crater'],
    scores: {}, datasets: [],
  },
];
