# References

Every dataset, imagery service, library and content source used in this repository, checked against the code on
2026-11-15. Style: author (year), title, publisher or journal, link. All data were accessed on 14–15 November 2026.
Per-dataset processing details are in `sources.csv` (climate grids) and `terrain_data/DATA_SOURCES.md` +
`terrain_data/out/sources.csv` (terrain layer).

## 1. Climate grids: temperature, pressure, water vapour, sunlight, wind, dust
Files: `earth_data/earth_grid.csv`, `moon_data/moon_grid.csv`, `mars_data/mars_grid.csv`

**Earth**
- NASA Langley Research Center (2025). *Prediction Of Worldwide Energy Resources (POWER), Climatology API v2.10.1*
  (2001–2025 climatology). https://power.larc.nasa.gov/
  Parameters: TS, TS_MAX, TS_MIN (surface temperature), PS (pressure), TQV (water vapour), WS2M (wind), AOD_55
  (aerosol), from MERRA-2; ALLSKY_SFC_SW_DWN (sunlight), from CERES SYN1deg.
- Gelaro, R., et al. (2017). The Modern-Era Retrospective Analysis for Research and Applications, Version 2
  (MERRA-2). *Journal of Climate*, 30(14), 5419–5454.
- Doelling, D. R., et al. (2013). Geostationary enhanced temporal interpolation for CERES flux products.
  *Journal of Atmospheric and Oceanic Technology*, 30(6), 1072–1090.

**Moon**
- Williams, J.-P., Paige, D. A., Greenhagen, B. T., & Sefton-Nash, E. (2017). The global surface temperatures of
  the Moon as measured by the Diviner Lunar Radiometer Experiment. *Icarus*, 283, 300–325.
  Data: LRO Diviner Global Cumulative Product, NASA PDS Geosciences Node,
  https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_gcp/
- Sunlight: computed in this project (daily-mean insolation formula, solar constant 1361 W/m², lunar axial tilt
  1.54°). Pressure, water vapour, wind and dust set to 0 (no atmosphere).

**Mars**
- Millour, E., Forget, F., Spiga, A., et al. (2022). The Mars Climate Database, version 6.1. *7th Mars Atmosphere
  Modelling and Observations Workshop*, Paris. Data: MCD v6.2 web interface (LMD/CNRS with ESA and CNES),
  https://www-mars.lmd.jussieu.fr/mcd_python/
- Forget, F., et al. (1999). Improved general circulation models of the Martian atmosphere from the surface to
  above 80 km. *Journal of Geophysical Research: Planets*, 104(E10), 24155–24175.
  Variables: tsurf, ps, col_h2ovapor, fluxsurf_dn_sw, u, v, dod (climatology scenario, average solar).

**Point data for five analog sites** (`data/`): NASA POWER Daily API (2023), T2M, T2M_MAX, T2M_MIN, TS (MERRA-2).

## 2. Terrain, geology and resources layer (`terrain_data/`)
Full entries with licences in `terrain_data/DATA_SOURCES.md`.
- Smith, D. E., et al. (2010). Initial observations from the Lunar Orbiter Laser Altimeter (LOLA).
  *Geophysical Research Letters*, 37, L18204. (LRO LOLA LDEM_16, NASA PDS)
- Robbins, S. J. (2019). A new global database of lunar impact craters >1–2 km: 1. *Journal of Geophysical
  Research: Planets*, 124, 871–892. (USGS Astrogeology)
- Prettyman, T. H., et al. (2006). Elemental composition of the lunar surface: Analysis of gamma ray spectroscopy
  data from Lunar Prospector. *Journal of Geophysical Research*, 111, E12007. (NASA PDS)
- Wagner, R. V., & Robinson, M. S. (2014). Distribution, formation mechanisms, and significance of lunar pits.
  *Icarus*, 237, 52–60. (LROC Lunar Pit Atlas, Arizona State University / NASA)
- Smith, D. E., et al. (2001). Mars Orbiter Laser Altimeter: Experiment summary after the first year of global
  mapping of Mars. *Journal of Geophysical Research*, 106(E10), 23689–23722. (MGS MOLA MEGDR, NASA PDS)
- Robbins, S. J., & Hynek, B. M. (2012). A new global database of Mars impact craters ≥1 km: 1. *Journal of
  Geophysical Research*, 117, E05004. (USGS Astrogeology)
- Putzig, N. E., & Mellon, M. T. (2007). Apparent thermal inertia and the surface heterogeneity of Mars.
  *Icarus*, 191, 68–94. (MGS TES thermal inertia, NASA PDS)
- Feldman, W. C., et al. (2004). Global distribution of near-surface hydrogen on Mars. *Journal of Geophysical
  Research*, 109, E09006. (Mars Odyssey GRS, NASA PDS)
- Tanaka, K. L., et al. (2014). *Geologic map of Mars* (Scientific Investigations Map 3292). U.S. Geological Survey.
- NOAA National Centers for Environmental Information (2022). *ETOPO 2022 Global Relief Model*.
  doi:10.25921/fd45-gt74
- Hartmann, J., & Moosdorf, N. (2012). The new global lithological map database GLiM. *Geochemistry, Geophysics,
  Geosystems*, 13, Q12004. (PANGAEA)
- Global Volcanism Program (2026). *Volcanoes of the World* database. Smithsonian Institution. https://volcano.si.edu/
- Fick, S. E., & Hijmans, R. J. (2017). WorldClim 2: new 1-km spatial resolution climate surfaces for global land
  areas. *International Journal of Climatology*, 37(12), 4302–4315.
- Natural Earth (n.d.). 1:50m and 1:10m cultural and physical vectors. https://www.naturalearthdata.com/
- Earth Impact Database, Planetary and Space Science Centre, University of New Brunswick (index of names only).

## 3. Map imagery in the apps (`analog-atlas/`, `prototype/`)
- NASA Global Imagery Browse Services (GIBS), NASA ESDIS: Blue Marble Next Generation, Blue Marble shaded relief
  and bathymetry, Landsat WELD, ASTER GDEM colour relief. https://gibs.earthdata.nasa.gov/
  - Stöckli, R., et al. (2005). *The Blue Marble Next Generation: A true color Earth dataset including seasonal
    dynamics from MODIS*. NASA Earth Observatory. (also bundled offline in `lib/images/`)
  - Roy, D. P., et al. (2010). Web-enabled Landsat Data (WELD). *Remote Sensing of Environment*, 114, 35–49.
  - NASA/METI/AIST/Japan Spacesystems & U.S./Japan ASTER Science Team (2019). *ASTER Global Digital Elevation
    Model V003*. NASA EOSDIS LP DAAC. doi:10.5067/ASTER/ASTGTM.003
- NASA Solar System Treks (Moon Trek, Mars Trek), NASA JPL / SSERVI. https://trek.nasa.gov/
  Layers: LRO WAC global mosaic (LROC, Arizona State University); LRO LOLA colour relief and hillshade; Viking
  MDIM 2.1 colour mosaic (USGS Astrogeology); MGS MOLA colour relief; MGS MOC atlas (Malin Space Science Systems).
- NASA Earth Observatory / NOAA NGDC (2012). *Black Marble: Earth at night*, Suomi NPP VIIRS Day/Night Band
  (`dnb_land_ocean_ice_2012.png`, bundled with WebWorldWind).
- Gazetteer of Planetary Nomenclature, IAU / USGS Astrogeology. https://planetarynames.wr.usgs.gov/

## 4. Software
- NASA WorldWind (2019). *Web WorldWind* v0.11.0. NASA Ames Research Center. Apache License 2.0.
  https://github.com/NASAWorldWind/WebWorldWind
- Google Fonts: Rajdhani (Indian Type Foundry) and JetBrains Mono (JetBrains), SIL Open Font License.

## 5. Curated content, pictures and AI use
- Analog sites, caves, impact structures, Moon/Mars targets and Irish sites (`terrain_data/curated/`, `out/`):
  drafted by Claude (Anthropic), coordinates checked against Wikipedia. See `terrain_data/AI_USAGE.md`.
- Pictures (`terrain_data/out/images/`): from English Wikipedia / Wikimedia Commons; author and licence for each
  picture are in the `image_credit` column of the curated tables and must stay next to the picture.
- The climate-grid download scripts (`earth_data/`, `moon_data/`, `mars_data/`) were written with Claude
  (Anthropic); dataset choices and checks were made by the team.

## Required credit lines
- NASA POWER: "These data were obtained from the NASA Langley Research Center (LaRC) POWER Project funded through
  the NASA Earth Science/Applied Science Program."
- NASA GIBS: "We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services
  (GIBS), part of NASA's Earth Science Data and Information System (ESDIS)."
- Natural Earth: "Made with Natural Earth."

## Not used
Listed in the app's config as planned sources but not wired in: SoilGrids, MODIS MCD43 albedo, SMAP soil moisture,
LRO LEND/LAMP, SHARAD, HRSC DEM, ASTER emissivity. Also not used (hosts unreachable or skipped):
NASA NEO products, USGS Mars cave catalog, LROC shadowed-region shapefiles, Lunar Prospector neutron hydrogen,
Mars Dust Activity Database.
