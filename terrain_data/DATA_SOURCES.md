# Data sources

One entry per dataset used in `terrain_data/`. All were downloaded on **2026-11-14** unless noted. The machine-readable version is `out/sources.csv`; the download log is `work/log.md`. Licences are summarised from the providers' pages and should be rechecked before any redistribution beyond the hackathon. Raw downloads are never committed.

The temperature grids for the Moon and Mars (`moon_data/moon_grid.csv`, `mars_data/mars_grid.csv`) were built by teammates from LRO Diviner and the Mars Climate Database and are used unchanged.

## Moon

**LRO LOLA gridded elevation (LDEM_16).** NASA Lunar Reconnaissance Orbiter, Lunar Orbiter Laser Altimeter, via the PDS Geosciences Node. 16 pixels per degree, 0.5 m height steps, relative to a 1,737.4 km sphere. NASA data, free to use with credit. https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/ . Cite: Smith, D. E., et al. (2010), Initial observations from the Lunar Orbiter Laser Altimeter (LOLA), Geophysical Research Letters, 37, L18204.

**Robbins lunar crater database.** USGS Astrogeology. Craters 1 to 2 km and larger with circular fits; used for craters 5 km and larger. USGS data, public domain. https://astrogeology.usgs.gov/search/map/moon_crater_database_v1_robbins . Cite: Robbins, S. J. (2019), A new global database of lunar impact craters >1-2 km: 1. Crater locations and sizes, comparisons with published databases, and global analysis, Journal of Geophysical Research: Planets, 124, 871-892.

**Lunar Prospector gamma-ray spectrometer element abundances.** NASA Lunar Prospector, PDS Geosciences Node, dataset LP-L-GRS-5-ELEM-ABUNDANCE-V1.0, the 2-degree "high1" product. NASA data. https://pds-geosciences.wustl.edu/lunar/lp-l-grs-5-elem-abundance-v1/ . Cite: Prettyman, T. H., et al. (2006), Elemental composition of the lunar surface: Analysis of gamma ray spectroscopy data from Lunar Prospector, Journal of Geophysical Research, 111, E12007.

**LROC Lunar Pit Atlas.** Arizona State University / NASA LRO Camera team, via the LROC archive. Mare and highland collapse pits only. https://data.lroc.im-ldi.com/lroc/view_rdr/SHAPEFILE_LUNAR_PIT_LOCATIONS . Cite: Wagner, R. V., and Robinson, M. S. (2014), Distribution, formation mechanisms, and significance of lunar pits, Icarus, 237, 52-60.

**LRO Diviner global surface temperatures** (teammates, unchanged). Cite: Williams, J.-P., et al. (2017), The global surface temperatures of the Moon as measured by the Diviner Lunar Radiometer Experiment, Icarus, 283, 300-325.

## Mars

**MGS MOLA topography (MEGDR, 16 pixels per degree).** NASA Mars Global Surveyor, Mars Orbiter Laser Altimeter, PDS Geosciences Node. NASA data. https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/ . Cite: Smith, D. E., et al. (2001), Mars Orbiter Laser Altimeter: Experiment summary after the first year of global mapping of Mars, Journal of Geophysical Research, 106(E10), 23689-23722.

**Robbins and Hynek Mars crater database.** USGS Astrogeology, fetched through the USGS pygeoapi service, craters 5 km and larger. Public domain. https://astrogeology.usgs.gov/search/map/mars_crater_database_v1_robbins . Cite: Robbins, S. J., and Hynek, B. M. (2012), A new global database of Mars impact craters >=1 km: 1. Database creation, properties, and parameters, Journal of Geophysical Research, 117, E05004.

**TES nighttime thermal inertia.** NASA Mars Global Surveyor, Thermal Emission Spectrometer, PDS dataset MGS-M-TES-5-TIMAP-V1.0. NASA data. https://pds-geosciences.wustl.edu/mgs/mgs-m-tes-5-timap-v1/ . Cite: Putzig, N. E., and Mellon, M. T. (2007), Apparent thermal inertia and the surface heterogeneity of Mars, Icarus, 191, 68-94.

**Odyssey GRS water-equivalent hydrogen.** NASA Mars Odyssey Gamma Ray Spectrometer, PDS dataset ODY-M-GRS-5-ELEMENTS-V1.0, 5-degree smoothed H2O map. NASA data. https://pds-geosciences.wustl.edu/ody/ody-m-grs-5-elements-v1/ . Cite: Feldman, W. C., et al. (2004), Global distribution of near-surface hydrogen on Mars, Journal of Geophysical Research, 109, E09006.

**Odyssey GRS element concentrations (iron, silicon, potassium, thorium, chlorine).** Same PDS dataset as the hydrogen map, the 5-degree smoothed maps `fe_sr_5x5`, `si_sr_5x5`, `k_sr_5x5`, `th_sr_5x5`, `cl_sr_5x5`. Used for `out/mars_soil.csv`. NASA data. https://pds-geosciences.wustl.edu/ody/ody-m-grs-5-elements-v1/ . Cite: Boynton, W. V., et al. (2007), Concentration of H, Si, Cl, K, Fe, and Th in the low- and mid-latitude regions of Mars, Journal of Geophysical Research, 112, E12S99.

**Mars Climate Database v6.2, gases** (for `out/mars_gases.csv`). The same LMD web interface the team uses for temperature and pressure (no account; "moderate use", one request at a time). Variables `vmr_co2`, `vmr_n2`, `vmr_ar`, `vmr_o2`, `vmr_co`, `vmr_h2`, `vmr_he`, `vmr_o3` 2 m above the surface, `col_o3`, `dod`, `co2ice`, `surf_h2o_ice`, climatology dust scenario. Cite: Millour, E., et al. (2022), The Mars Climate Database (version 6.1), Europlanet Science Congress, EPSC2022-786, and the MCD team per https://www-mars.lmd.jussieu.fr/ .

**Mars radiation dose.** Curiosity's Radiation Assessment Detector at Gale crater: 0.67 mSv/day dose equivalent at the surface, 0.21 mGy/day absorbed, under about 20 g/cm2 of air. Cite: Hassler, D. M., et al. (2014), Mars' surface radiation environment measured with the Mars Science Laboratory's Curiosity rover, Science, 343, 1244797.

**Mars UV split.** Curiosity's REMS UV sensor over five Mars years at Gale: on average 80 percent UV-A, 15 percent UV-B, 5 percent UV-C. Cite: Viúdez-Moreiras, D., et al. (2025), PNAS (UV and biologically effective dose at Gale crater); summary at https://www.csic.es/ . Used only for the split; the amount comes from the MCD surface sunlight in the team grid (`solar_w_m2`, `mars_data/build_mars_solar.py` on `main`).

**Mars methane.** Curiosity's Tunable Laser Spectrometer, background 0.41 ppb at Gale crater, used as a constant. Cite: Webster, C. R., et al. (2018), Background levels of methane in Mars' atmosphere show strong seasonal variations, Science, 360, 1093-1096.

**Global geologic map of Mars (SIM 3292).** USGS, 1:20,000,000. Public domain. https://pubs.usgs.gov/sim/3292/ . Cite: Tanaka, K. L., Skinner, J. A., Jr., Dohm, J. M., Irwin, R. P., III, Kolb, E. J., Fortezzo, C. M., Platz, T., Michael, G. G., and Hare, T. M. (2014), Geologic map of Mars: U.S. Geological Survey Scientific Investigations Map 3292, scale 1:20,000,000.

**Mars Climate Database v6.2 surface temperature** (teammates, unchanged). Cite the Mars Climate Database team (LMD, Open University, ESA, CNES) per http://www-mars.lmd.jussieu.fr/ .

## Earth

**ETOPO 2022, 60 arc-second surface elevation.** NOAA National Centers for Environmental Information. Public domain. https://www.ncei.noaa.gov/products/etopo-global-relief-model . Cite: NOAA National Centers for Environmental Information (2022), ETOPO 2022 Global Relief Model, doi:10.25921/fd45-gt74.

**GLiM, Global Lithological Map, 0.5-degree grid.** Hartmann and Moosdorf, University of Hamburg, via PANGAEA. Check the PANGAEA page for the exact licence (the data portal usually applies CC BY). https://doi.pangaea.de/10.1594/PANGAEA.788537 . Cite: Hartmann, J., and Moosdorf, N. (2012), The new global lithological map database GLiM: A representation of rock properties at the Earth surface, Geochemistry, Geophysics, Geosystems, 13, Q12004.

**SoilGrids 2.0 topsoil (0-5 cm).** ISRIC World Soil Information. Clay, silt and sand content, soil organic carbon, pH in water, bulk density and coarse fragments, mean predictions at 250 m, fetched through the WCS service resampled to 0.1 degree. CC BY 4.0. https://maps.isric.org/ . Cite: Poggio, L., et al. (2021), SoilGrids 2.0: producing soil information for the globe with quantified spatial uncertainty, SOIL, 7, 217-240.

**NASA POWER ozone and aerosol.** Total column ozone (`TO3`, Dobson units) and aerosol optical depth at 550 nm (`AOD_55`), climatology 2001-2025, regional endpoint, 10-degree boxes holding land only. Same credit line as the POWER temperature data above.

**Earth air composition.** Dry air: N2 78.08, O2 20.95, Ar 0.934 percent (standard atmosphere); CO2 about 425 ppm and CH4 about 1,935 ppb, NOAA Global Monitoring Laboratory global means for 2025 (https://gml.noaa.gov/ccgg/trends/). Treated as the same everywhere, which is true to within about 1 percent for the main gases.

**NASA POWER UV.** All-sky surface UV-A (`ALLSKY_SFC_UVA`, 315-400 nm) and UV-B (`ALLSKY_SFC_UVB`, 280-315 nm), climatology 2001-2025, kWh/m2/day, land boxes only. Same credit line as the other POWER data.

**Earth cosmic-ray dose.** Altitude relations of Bouville, A., and Lowder, W. M. (1988), Human population exposure to cosmic radiation, Radiation Protection Dosimetry, 24, 293-299, as summarised in UNSCEAR (2000), Sources and Effects of Ionizing Radiation, Annex B. Checked against Cinelli, G., et al. (2017), European annual cosmic-ray dose: estimation of population exposure, Journal of Maps, 13, 812-821 (301 to 3,955 uSv/yr).

**Lunar radiation dose.** Chang'e-4 Lunar Lander Neutrons and Dosimetry: 1,369 uSv/day dose equivalent. Cite: Zhang, S., et al. (2020), First measurements of the radiation dose on the lunar surface, Science Advances, 6, eaaz1334.

**NASA career dose limit.** 600 mSv effective dose, NASA-STD-3001 Volume 1 (2022). Used only to turn doses into "days to the limit".

**Lunar exosphere** (for the Moon's zero gas columns). Cite: Benna, M., et al. (2015), Variability of helium, neon, and argon in the lunar exosphere as observed by the LADEE NMS instrument, Geophysical Research Letters, 42, 3723-3729.

**Typical rock compositions** (for the ESTIMATED Earth iron, silicon, potassium and thorium in `out/earth_soil_*.csv`). Basalt, granite, shale, sandstone and carbonate from Turekian, K. K., and Wedepohl, K. H. (1961), Distribution of the elements in some major units of the Earth's crust, Geological Society of America Bulletin, 72, 175-192. Metamorphic and unconsolidated cells use the upper continental crust of Rudnick, R. L., and Gao, S. (2003), Composition of the continental crust, Treatise on Geochemistry, 3, 1-64. The class-to-composition table is in `pipeline/35_soil_features.py` (`ROCK_CHEM`).

**Holocene volcanoes.** Smithsonian Institution, Global Volcanism Program, Volcanoes of the World. Free to use with citation. https://volcano.si.edu/ . Cite: Global Volcanism Program, Volcanoes of the World database, Smithsonian Institution, accessed 2026-11-14 (use the version and DOI shown on the Smithsonian page for that date).

**WorldClim 2.1 climate normals 1970-2000, 10 arc-minute.** WorldClim project. Free for academic and non-commercial use; check the terms before commercial reuse. https://www.worldclim.org/data/worldclim21.html . Cite: Fick, S. E., and Hijmans, R. J. (2017), WorldClim 2: new 1-km spatial resolution climate surfaces for global land areas, International Journal of Climatology, 37(12), 4302-4315.

**Natural Earth.** 1:50m land and country polygons, 1:10m states and provinces. Public domain. https://www.naturalearthdata.com/ . Credit: Made with Natural Earth.

**NASA POWER climatology.** NASA Langley Research Center, Prediction Of Worldwide Energy Resources. Surface skin temperature (TS, TS_MAX, TS_MIN), 2001 to 2025 climatology, regional endpoint, 10-degree boxes. NASA open data. https://power.larc.nasa.gov/ . Credit: "These data were obtained from the NASA Langley Research Center (LaRC) POWER Project funded through the NASA Earth Science/Applied Science Program."

**Impact structures list.** The structures table is based on the Earth Impact Database of the Planetary and Space Science Centre, University of New Brunswick (https://impact.uwo.ca/impactdb/ at the time of writing) as an index of names only. Coordinates, diameters and ages were written from the AI's memory, with coordinates checked against Wikipedia. Treat diameters and ages as unverified.

## Curated tables and pictures

**Analog sites, caves, impact structures, Moon and Mars targets, Irish sites** (`out/*.csv`). Drafted by Claude (an AI) from general knowledge, then enriched and checked as described in `AI_USAGE.md`. Wikipedia is the only external check, and it was used for coordinates.

**Pictures.** Page images from English Wikipedia, with the author and licence line stored in `image_credit` for every row and shown with the picture. Demo pictures are saved in `out/images/` (800 pixels wide) so the presentation does not depend on the venue network. Wikimedia Commons licences differ by picture; keep the credit text with each image.

**Not used.** NASA Earth Observations (NEO) vegetation, aerosol, snow and surface-temperature products (no longer served), the USGS Mars cave catalog and LROC shadowed-region shapefiles (hosts unreachable), Lunar Prospector neutron hydrogen and the Mars Dust Activity Database (skipped for time).
