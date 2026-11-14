"""Phase 4b: export the files the globe and the submission use.

  out/sites.json         every named Earth site and Moon/Mars target in the globe's schema, scores filled
  out/sites.csv          the same places in the team's sites_template layout
  out/targets.json       Moon and Mars targets with their best Earth matches
  out/presets.json, caveats.json   copies of the config
  out/sources.csv        one row per dataset, team template
  out/feature_columns.csv  every feature column with unit, body, dimension, source

    python -I pipeline/60_export.py
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from grid import G1, G2  # noqa: E402
from score_core import DIMS, PRESET_IDS, load_config  # noqa: E402
from score_data import OUT, ROOT, cols_at, load_all, site_columns  # noqa: E402

TODAY = "2026-11-14"
DIM_LABEL = {"geology": "Geology", "terrain": "Terrain", "thermal": "Thermal", "water": "Water and ice", "dust": "Dust and wind",
             "subsurface": "Subsurface", "habitability": "Habitability", "operations": "Operations"}
TYPE_LABEL = {"artemis_region": "Artemis III candidate region", "human_landing_site": "Crewed landing site",
              "rover_site": "Rover site", "lander_site": "Lander site", "pit_or_cave": "Pit or cave candidate",
              "resource_region": "Resource region", "science_region": "Science target"}
UNIT_SUFFIX = [("_mm_yr", "mm/yr"), ("_kj_m2_day", "kJ/m2/day"), ("_ms", "m/s"), ("_kpa", "kPa"), ("_hpa", "hPa"),
               ("_tiu", "TIU"), ("_ppm", "ppm"), ("_deg", "deg"), ("_pct", "%"), ("_idx", "0-1"), ("_km", "km"),
               ("_pa", "Pa"), ("_c", "C"), ("_m", "m"), ("_n", "count")]

# (source_id, body, dataset, variables, original_units, resolution, url, processing_notes)
SOURCES = [
    ("diviner_gcp_2017", "moon", "LRO Diviner Global Cumulative Product (Williams et al. 2017)", "temp_mean_c;temp_high_c;temp_low_c", "K", "0.5 deg", "https://pds-geosciences.wustl.edu/", "Team grid moon_data/moon_grid.csv, used unchanged"),
    ("mcd_v6_2", "mars", "Mars Climate Database v6.2 surface temperature", "temp_mean_c;temp_high_c;temp_low_c", "K", "5.6 x 3.75 deg", "http://www-mars.lmd.jussieu.fr/", "Team grid mars_data/mars_grid.csv, used unchanged"),
    ("lola_gdr_ldem16", "moon", "LRO LOLA gridded DEM LDEM_16 (PDS)", "elevation_m;relief_m;roughness_m;slope_mean_deg", "m (0.5 m steps)", "16 px/deg, 1.9 km", "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_16.img", "Block statistics over 32 x 32 pixels; slope by central differences with a longitude stride that widens toward the poles; baseline 1.9 km"),
    ("robbins_moon_2018", "moon", "Robbins 2018 Lunar Crater Database", "crater_density_5km_n;crater_density_20km_n", "km", "catalogue", "https://astrogeology.usgs.gov/search/map/moon_crater_database_v1_robbins", "Craters counted per 2-degree cell by centre, per 100,000 km2"),
    ("lpgrs_high1_2deg", "moon", "Lunar Prospector GRS element abundance, high-resolution 2-degree product (Prettyman et al. 2006)", "feo_pct;tio2_pct;th_ppm;mare_idx;fe_pct;si_pct;k_pct;mgo_pct;al2o3_pct;sio2_pct;cao_pct", "weight fraction; ppm", "1-2 x 1.5-6 deg pixels", "https://pds-geosciences.wustl.edu/lunar/lp-l-grs-5-elem-abundance-v1/", "Each 2-degree cell takes the pixel containing its centre; coarser than the grid; mare_idx scaled 0 at 8 wt% FeO to 1 at 15. out/moon_soil.csv converts oxides to elements (Fe = 0.777 FeO, Si = 0.467 SiO2, K ppm / 10,000)"),
    ("lroc_pit_atlas", "moon", "LROC Lunar Pit Atlas (Wagner and Robinson)", "pit_n;pit_nearest_km;mare_pit_n;lavatube_idx", "deg", "catalogue", "https://data.lroc.im-ldi.com/lroc/view_rdr/SHAPEFILE_LUNAR_PIT_LOCATIONS", "Mare and highland collapse pits only; 257 impact-melt pits dropped; lavatube_idx = 0.5 mare_idx + 0.5 clip(mare pits / 2)"),
    ("moon_geometry_proxy", "moon", "Geometric proxies (this project)", "illum_idx;water_idx", "deg", "analytic", "https://github.com/MCCHRISmaster/ReHackedAthloneLLCCS", "PROXIES, not measurements: illum_idx from latitude (Sun elevation); water_idx from latitude (0 below 70 deg, 1 at the pole). PSR maps and neutron hydrogen were not used"),
    ("mola_megdr16", "mars", "MGS MOLA MEGDR topography 16 px/deg (PDS)", "elevation_m;relief_m;roughness_m;slope_mean_deg;pressure_pa", "m", "16 px/deg, 3.7 km", "https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/", "As for the Moon DEM; pressure_pa = 610 exp(-z/11100), an estimate"),
    ("robbins_mars_2012", "mars", "Robbins and Hynek 2012 Mars crater database (USGS pygeoapi)", "crater_density_5km_n;crater_density_20km_n", "km", "catalogue", "https://astrogeology.usgs.gov/pygeoapi/collections/mars/robbinsv1/items", "Craters 5 km and larger, counted per 2-degree cell by centre, per 100,000 km2"),
    ("tes_ti_2007", "mars", "MGS TES nighttime thermal inertia map (Putzig and Mellon 2007)", "thermal_inertia_tiu;dust_cover_idx", "J m-2 K-1 s-1/2", "20 px/deg", "https://pds-geosciences.wustl.edu/mgs/mgs-m-tes-5-timap-v1/", "Cell mean; dust_cover_idx PROXY from thermal inertia (1 at 100 or less, 0 at 350 or more)"),
    ("ody_grs_h2o", "mars", "Mars Odyssey GRS water-equivalent hydrogen, 5-degree smoothed", "weh_pct;water_idx", "wt %", "5 deg", "https://pds-geosciences.wustl.edu/ody/ody-m-grs-5-elements-v1/", "Bilinear interpolation; poleward rows with no value stay blank; water_idx = max(weh/30, latitude proxy)"),
    ("usgs_sim3292", "mars", "USGS SIM 3292 global geologic map of Mars (Tanaka et al. 2014)", "geo_volcanic_pct;geo_highland_pct;geo_lowland_pct;geo_impact_pct;geo_transition_pct;geo_polar_pct;geo_basin_pct;geo_apron_pct", "polygons", "1:20M", "https://pubs.usgs.gov/sim/3292/", "44 unit codes grouped by the word in their description; rasterised at 0.1 deg and averaged to 2 deg"),
    ("mars_lavatube_proxy", "mars", "Lava-tube potential proxy (this project)", "lavatube_idx", "idx", "analytic", "https://github.com/MCCHRISmaster/ReHackedAthloneLLCCS", "PROXY: 0.6 volcanic share + 0.4 closeness to Tharsis and Olympus skylight volcanoes. The Mars cave catalog could not be downloaded"),
    ("mars_geometry_proxy", "mars", "Geometric sunlight proxy (this project)", "illum_idx", "deg", "analytic", "https://github.com/MCCHRISmaster/ReHackedAthloneLLCCS", "PROXY: (90 - |lat|) / 90"),
    ("etopo2022", "earth", "NOAA NCEI ETOPO 2022 surface elevation, 60 arc-second", "elev_mean_m;elev_min_m;elev_max_m;relief_m;roughness_m;slope_mean_deg;pressure_hpa", "m", "1 arc-minute, 1.85 km", "https://www.ncei.noaa.gov/products/etopo-global-relief-model", "Land pixels only (Natural Earth mask); slope baseline 1.85 km; pressure from the standard atmosphere"),
    ("glim_v1", "earth", "GLiM Global Lithological Map 0.5-degree grid (Hartmann and Moosdorf 2012)", "lith_*_pct;karst_idx;lavatube_idx", "class code", "0.5 deg", "https://doi.pangaea.de/10.1594/PANGAEA.788537", "One dominant first-level class per 0.5-degree cell; each 1-degree value is the share of its four cells (steps of 25 percent)"),
    ("gvp_votw", "earth", "Smithsonian Global Volcanism Program, Volcanoes of the World, Holocene volcanoes", "volcano_n;volcano_nearest_km;volcano_nearest_type;volcano_prox_idx", "deg", "catalogue", "https://volcano.si.edu/", "Nearest-volcano distance per cell; proximity 1 within 50 km, 0 beyond 500 km"),
    ("worldclim_2_1", "earth", "WorldClim 2.1 climate normals 1970-2000, 10 arc-minute (Fick and Hijmans 2017)", "precip_mm_yr;vapr_kpa;wind_ms;srad_kj_m2_day;tavg_c;tmin_c;tmax_c;diurnal_range_c;solar_idx", "mm; kPa; m/s; kJ/m2/day; C", "10 arc-min", "https://www.worldclim.org/data/worldclim21.html", "Annual sum (precipitation) or mean of 12 months, block-averaged to 1 degree"),
    ("natural_earth", "earth", "Natural Earth 1:50m land and admin-0, 1:10m admin-1", "land_pct;country;admin_region", "polygons", "1:50m", "https://www.naturalearthdata.com/", "Land fraction per 1-degree cell; country by cell centre"),
    ("nasa_power_clim", "earth", "NASA POWER climatology TS, TS_MAX, TS_MIN (surface skin temperature, 2001-2025)", "temp_mean_c;temp_high_c;temp_low_c", "C", "0.5 x 0.625 deg", "https://power.larc.nasa.gov/", "Same method as the team's earth_grid.csv; every POWER point averaged into its cell; high and low are means of the 12 monthly values"),
    ("earth_climate_proxy", "earth", "Climate-based proxies (this project)", "aridity_idx;barren_pct;dust_idx;permafrost_idx;ice_idx", "idx", "analytic", "https://github.com/MCCHRISmaster/ReHackedAthloneLLCCS", "PROXIES, because NASA NEO no longer serves vegetation, aerosol or snow data: aridity = 1 - precip/1000; barren = share below 250 mm; dust = barren x wind; permafrost from air temperature thresholds"),
    ("ody_grs_elem_2007", "mars", "Mars Odyssey GRS element concentrations, 5-degree smoothed (Boynton et al. 2007)", "fe_pct;si_pct;k_pct;th_ppm;cl_pct", "wt %; ppm", "5 deg", "https://pds-geosciences.wustl.edu/ody/ody-m-grs-5-elements-v1/", "out/mars_soil.csv. Bilinear interpolation to 2-degree centres; cells with no value (mostly poleward of about 60 deg) stay blank"),
    ("soilgrids_v2", "earth", "ISRIC SoilGrids 2.0 topsoil 0-5 cm mean (Poggio et al. 2021)", "clay_pct;silt_pct;sand_pct;soc_g_kg;ph_h2o;bdod_g_cm3;cfvo_pct", "g/kg; dg/kg; pH x 10; cg/cm3; cm3/dm3", "250 m, fetched at 0.1 deg", "https://maps.isric.org/", "out/earth_soil_*.csv. WCS GetCoverage resampled by the server to 0.1 deg in EPSG:4326, then averaged into 1 and 2-degree cells"),
    ("glim_chem_est", "earth", "Element estimate from rock type (this project)", "fe_pct;si_pct;k_pct;th_ppm;chem_cover_pct", "wt %; ppm", "1 and 2 deg", "https://github.com/MCCHRISmaster/ReHackedAthloneLLCCS", "ESTIMATE, not a measurement: GLiM lithology shares x typical rock compositions (Turekian and Wedepohl 1961; Rudnick and Gao 2003); blank when less than 20 percent of the cell has a rock class"),
    ("curated_caves", "earth", "Hand-curated caves table (about 50 caves)", "cave_n_100km;cave_nearest_km;cave_nearest_type;cave_nearest_length_m", "deg", "points", "https://github.com/MCCHRISmaster/ReHackedAthloneLLCCS", "A sample, not a census; nearness means nearness to a listed cave"),
    ("curated_impacts", "earth", "Hand-curated impact structures table (about 75 structures, after the Earth Impact Database)", "crater_nearest_km;crater_nearest_diam_km;crater_nearest_name;crater_prox_idx", "deg", "points", "https://impact.uwo.ca/impactdb/", "Nearest listed structure; proximity 1 within 25 km, 0 beyond 250 km"),
    ("curated_analog_sites", "earth", "Hand-curated analog sites table (about 70 sites)", "site rows", "deg", "points", "https://github.com/MCCHRISmaster/ReHackedAthloneLLCCS", "Written by Claude and checked against Wikipedia coordinates; see validation.md"),
    ("curated_irish_sites", "earth", "Irish sites: Athlone, Clonmacnoise, the Burren", "site rows", "deg", "points", "https://github.com/MCCHRISmaster/ReHackedAthloneLLCCS", "Scored at their 1-degree cell"),
    ("curated_targets", "moon", "Hand-curated Moon and Mars targets", "target rows", "deg", "points", "https://github.com/MCCHRISmaster/ReHackedAthloneLLCCS", "Artemis III region centres are approximate; see METHODS.md"),
]


UNIT_SPECIAL = {"crater_density_5km_n": "per 100,000 km2", "crater_density_20km_n": "per 100,000 km2", "volcano_n": "volcanoes in cell",
                "cave_n_100km": "listed caves within 100 km", "pit_n": "pits in cell", "mare_pit_n": "mare pits in cell"}


def unit_of(col: str) -> str:
    if col in UNIT_SPECIAL:
        return UNIT_SPECIAL[col]
    for suf, u in UNIT_SUFFIX:
        if col.endswith(suf):
            return u
    return ""


def label(col: str) -> str:
    return col.replace("_", " ")


def main() -> None:
    cfg, data = load_config(), load_all()
    earth = data["earth"]
    matches = json.loads((OUT / "matches.json").read_text(encoding="utf-8"))
    sites = {s["id"]: s for s in data["sites"]}
    targets = {t["id"]: t for t in data["targets"]}
    cols_s, sidx_s, _ = site_columns(data)
    site_pos = {s["id"]: i for i, s in enumerate(data["sites"])}

    def site_metrics(i: int) -> dict:
        return {k: {"value": round(float(v[i]), 3), "unit": unit_of(k)} for k, v in cols_s.items() if not np.isnan(v[i])}

    def metrics_for(tbl: dict, idx: int) -> dict:
        m = {}
        for k, v in tbl.items():
            if isinstance(v, np.ndarray) and v.shape == (tbl["n"],) and v.dtype.kind == "f" and k not in ("lat", "lon", "land_pct") and not np.isnan(v[idx]):
                m[k] = {"value": round(float(v[idx]), 3), "unit": unit_of(k)}
        return m

    out_sites = []
    for sid, s in sites.items():
        res = matches["sites"][sid]
        gi = int(sidx_s[site_pos[sid]])
        allowed = {"moon": ["moon"], "mars": ["mars"], "both": ["moon", "mars"]}.get(s.get("analog_for", "both"), ["moon", "mars"])
        best = {b: res["best_target"].get(b) for b in allowed if res["best_target"].get(b)}
        primary_body = max(best, key=lambda b: res["targets"][best[b]]["overall"] or 0) if best else allowed[0]
        bt = res["targets"].get(best.get(primary_body, ""), {})
        scores = {d: bt["dims"][d] for d in DIMS if bt.get("dims", {}).get(d) is not None} if bt else {}
        losses = bt.get("losses", []) if bt else []
        ranked = sorted(((v, d) for d, v in scores.items()), reverse=True)
        strengths = ([f"Used for: {s['what_was_tested']}"] if s.get("what_was_tested") else []) + \
                    [f"{DIM_LABEL[d]}: {round(v * 100)}% match" for v, d in ranked[:3]]
        limits = [l["text"] for l in losses[:3]] or [f"{DIM_LABEL[d]}: {round(v * 100)}% match" for v, d in ranked[-2:]]
        limits.append(cfg["caveats"][primary_body][0])
        links = [u for u in s.get("further_reading", "").split(";") if u]
        e = {"id": sid, "name": s["name"], "region": s["country_or_region"], "lat": float(s["lat"]), "lon": float(s["lon"]),
             "body": "earth", "environment": s.get("environment", ""), "summary": s.get("summary", ""),
             "strengths": strengths, "limits": limits, "targets": allowed, "scores": scores,
             "datasets": [{"name": "Wikipedia" if "wikipedia" in u else u.split("/")[2], "url": u} for u in links],
             "site_type": s.get("site_type") or "known_analog", "country": (earth["country"][gi] if "country" in earth else ""),
             "image_url": s.get("image_url", ""), "image_credit": s.get("image_credit", ""),
             "image_local": f"terrain_data/out/images/{sid}.jpg" if (OUT / "images" / f"{sid}.jpg").exists() else "",
             "wikipedia_url": s.get("wikipedia_url", ""), "links": links,
             "programs": [p for p in (s.get("programs", "") + "|" + s.get("agency_or_program", "")).split("|") if p],
             "metrics": site_metrics(site_pos[sid]), "primary_body": primary_body, "best_target": best,
             "matches": res["targets"], "data_cell": res["data_cell"], "caveats": cfg["caveats"][primary_body],
             "source_ids": sorted({x for x in str(earth["source_id"][gi] if isinstance(earth.get("source_id"), np.ndarray) else "").split(";") if x}) or []}
        out_sites.append(e)

    # ---- Moon / Mars targets
    site_name = {k: v["name"] for k, v in sites.items()}
    tgt_json = []
    for tid, t in targets.items():
        body = t["body"]
        tbl = data[body]
        ti = int(G2.index(float(t["lat"]), float(t["lon"])))
        pr = matches["targets"][tid]
        top = pr["raw"]["sites"][:3]
        analogs = [x["id"] for x in top]
        # scores for the card: raw dimension scores of the best Earth site against this target
        scores = {}
        if top:
            scores = {d: v for d, v in matches["sites"][top[0]["id"]]["targets"][tid]["dims"].items() if v is not None}
        m_all = {k: round(float(v[ti]), 3) for k, v in tbl.items() if isinstance(v, np.ndarray) and v.shape == (tbl["n"],) and v.dtype.kind == "f" and not np.isnan(v[ti])}
        e = {"id": tid, "name": t["name"], "region": t.get("mission_or_program", ""), "lat": float(t["lat"]), "lon": float(t["lon"]),
             "body": body, "environment": TYPE_LABEL.get(t.get("target_type", ""), t.get("target_type", "")),
             "summary": t.get("why_it_matters", ""), "strengths": [], "limits": [], "analogs": analogs, "scores": scores,
             "datasets": [{"name": "Wikipedia" if "wikipedia" in u else u.split("/")[2], "url": u} for u in t.get("further_reading", "").split(";") if u],
             "site_type": "mission_site", "country": "", "image_url": t.get("image_url", ""), "image_credit": t.get("image_credit", ""),
             "image_local": f"terrain_data/out/images/{tid}.jpg" if (OUT / "images" / f"{tid}.jpg").exists() else "",
             "wikipedia_url": t.get("wikipedia_url", ""), "links": [u for u in t.get("further_reading", "").split(";") if u],
             "programs": [t.get("mission_or_program", "")] if t.get("mission_or_program") else [],
             "metrics": {k: {"value": v, "unit": unit_of(k)} for k, v in m_all.items() if k not in ("lat", "lon")},
             "top_cells": pr["raw"]["cells"][:10], "top_by_preset": {p: pr[p]["cells"][:5] for p in PRESET_IDS},
             "top_sites_by_preset": {p: pr[p]["sites"][:5] for p in PRESET_IDS}, "surprise_cells": pr.get("surprise", []),
             "group": t.get("group", ""), "target_type": t.get("target_type", ""), "primary_demo": t.get("primary_demo") == "1",
             "matches": {}, "coord_status": t.get("coord_status", ""), "caveats": cfg["caveats"][body],
             "source_ids": sorted({x for x in str(t.get("source_id", "")).split(";") if x})}
        out_sites.append(e)
        tgt_json.append({k: e[k] for k in ("id", "name", "body", "lat", "lon", "target_type", "group", "primary_demo", "coord_status",
                                           "summary", "analogs", "top_cells", "surprise_cells", "metrics")})

    # ---- write everything
    (OUT / "sites.json").write_text(json.dumps(out_sites, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    (OUT / "targets.json").write_text(json.dumps(tgt_json, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    (OUT / "presets.json").write_text(json.dumps({"presets": cfg["presets"], "dimensions": cfg["dimensions"]}, indent=1), encoding="utf-8")
    (OUT / "caveats.json").write_text(json.dumps(cfg["caveats"], indent=1, ensure_ascii=False), encoding="utf-8")
    with open(OUT / "sites.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["site_id", "name", "body", "lat", "lon", "site_type", "temp_mean_c", "temp_high_c", "temp_low_c", "elevation_m", "notes", "source_id"])
        for e in out_sites:
            mm = e["metrics"]
            g = lambda k: ("" if k not in mm else f"{mm[k]['value'] if isinstance(mm[k], dict) else mm[k]:.1f}")
            w.writerow([e["id"].replace("-", "_"), e["name"], e["body"], f"{e['lat']:.2f}", f"{e['lon']:.2f}", e["site_type"],
                        g("temp_mean_c"), g("temp_high_c"), g("temp_low_c"), g("elevation_m") or g("elev_mean_m"),
                        (e["environment"] or "").replace(",", ";"), ";".join(e["source_ids"]) or "curated_analog_sites"])
    with open(OUT / "sources.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["source_id", "body", "dataset", "variables", "original_units", "resolution", "url", "downloaded_on", "processing_notes"])
        for r in SOURCES:
            w.writerow(list(r[:7]) + [TODAY, r[7]])
    print(f"wrote sites.json ({len(out_sites)} entries, {(OUT / 'sites.json').stat().st_size / 1e6:.1f} MB), targets.json, sites.csv, sources.csv, presets.json, caveats.json")


if __name__ == "__main__":
    main()
