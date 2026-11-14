"""Phase 4: score every named Earth site and every Earth land cell against every Moon and Mars target,
under all four presets -> out/matches.json and out/feature_ranges.json

Per target and preset:  top 25 Earth 1-degree cells, top 10 named Earth sites.
Per site and target:    overall for each preset, raw dimension scores and coverage.
Detailed explanation (losses, alternatives) for each site's five best targets per body plus every
primary demo target, so the files stay small. js/score.js computes the same numbers live for any pair.

    python -I pipeline/50_score.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from grid import G1, G2, haversine_km, nearest_point  # noqa: E402
from score_core import DIMS, PRESET_IDS, explain, load_config, score_against, show_values, side_values  # noqa: E402
from score_data import OUT, ROOT, cols_at, load_all, site_columns  # noqa: E402

TOP_CELLS, TOP_SITES, DETAIL_TARGETS = 25, 10, 5


def r1(x) -> float | None:
    return None if x is None or np.isnan(x) else round(float(x) * 100, 1)


def main() -> None:
    cfg, data = load_config(), load_all()
    earth, ranges, sites, targets = data["earth"], data["ranges"], data["sites"], data["targets"]
    (OUT / "feature_ranges.json").write_text(json.dumps(
        {"body_range_p99": ranges, "comparison_ranges": {c["id"]: c["range"] for c in cfg["comparisons"]}}, indent=1), encoding="utf-8")

    # ---- Earth land cells
    L = np.where(earth["land"])[0]
    latL, lonL = earth["lat"][L], earth["lon"][L]
    EL = cols_at(earth, L)
    E_cells = side_values(cfg, "earth", EL, latL, ranges)
    country = np.array(earth["country"], dtype=object)[L] if "country" in earth else np.full(len(L), "", dtype=object)

    # ---- named Earth sites (scored at the 1-degree cell that holds them; see score_data.site_columns)
    site_lat = np.array([float(x["lat"]) for x in sites]); site_lon = np.array([float(x["lon"]) for x in sites])
    cols_s, sidx, borrowed = site_columns(data)
    lat_sc = earth["lat"][sidx]
    E_sites = side_values(cfg, "earth", cols_s, lat_sc, ranges)
    show_s = show_values(cfg, cols_s)
    site_country = np.array(earth["country"], dtype=object)[sidx] if "country" in earth else np.full(len(sites), "")

    # ---- readable names for cells: country plus the nearest curated analog site when one is within 300 km
    is_analog = np.array([s["id"] in {x["id"] for x in sites} for s in sites])
    dist_site, near_site = nearest_point(G1, site_lat, site_lon, "earth")
    def cell_name(k: int) -> str:
        g = L[k]
        c = country[k] or "open coast"
        return f"{c}, near {sites[near_site[g]]['name']}" if dist_site[g] < 300 else c

    # ---- targets
    tl = []
    for t in targets:
        body = t["body"]
        tbl = data[body]
        ti = int(G2.index(float(t["lat"]), float(t["lon"])))
        cols_t = cols_at(tbl, np.array([ti]))
        T = side_values(cfg, body, cols_t, np.array([tbl["lat"][ti]]), ranges)
        tl.append({"id": t["id"], "body": body, "cell": ti, "T": T, "primary": t.get("primary_demo") == "1"})

    n_s, n_t, n_p = len(sites), len(tl), len(PRESET_IDS)
    S = np.full((n_s, n_t, n_p), np.nan)                    # overall for every site, target, preset
    DIMS_RAW = np.full((n_s, n_t, len(DIMS)), np.nan)
    COV_RAW = np.zeros((n_s, n_t, len(DIMS)))
    cell_scores: dict[tuple[int, int], np.ndarray] = {}
    result_targets: dict = {}
    for j, t in enumerate(tl):
        result_targets[t["id"]] = {}
        for p, preset in enumerate(PRESET_IDS):
            ov, _, _, _ = score_against(cfg, E_cells, t["T"], preset)
            cell_scores[(j, p)] = ov
            order = [k for k in np.argsort(-np.nan_to_num(ov, nan=-1))[:TOP_CELLS] if not np.isnan(ov[k])]
            cells = [{"lat": float(latL[k]), "lon": float(lonL[k]), "score": r1(ov[k]), "name": cell_name(k)} for k in order]
            ovs, dims_s, cov_s, _ = score_against(cfg, E_sites, t["T"], preset)
            S[:, j, p] = ovs
            if preset == "raw":
                for d, name in enumerate(DIMS):
                    DIMS_RAW[:, j, d], COV_RAW[:, j, d] = dims_s[name], cov_s[name]
            top = [i for i in np.argsort(-np.nan_to_num(ovs, nan=-1))[:TOP_SITES] if not np.isnan(ovs[i])]
            result_targets[t["id"]][preset] = {"cells": cells, "sites": [{"id": sites[i]["id"], "score": r1(ovs[i])} for i in top]}
        # surprise list: best raw cells that are at least 300 km from every curated analog site
        ov = cell_scores[(j, 0)]
        far = dist_site[L] >= 300
        order = [k for k in np.argsort(-np.nan_to_num(np.where(far, ov, np.nan), nan=-1))[:5] if far[k] and not np.isnan(ov[k])]
        result_targets[t["id"]]["surprise"] = [{"lat": float(latL[k]), "lon": float(lonL[k]), "score": r1(ov[k]),
                                                "name": cell_name(k)} for k in order]
        result_targets[t["id"]]["body"] = t["body"]

    # ---- per-site results
    def alt(i: int, j: int, p: int) -> dict:
        ov = cell_scores[(j, p)]
        d = haversine_km(site_lat[i], site_lon[i], latL, lonL)
        not_self = L != sidx[i]
        def best(mask):
            m = mask & not_self & ~np.isnan(ov)
            if not m.any():
                return None
            k = int(np.argmax(np.where(m, ov, -1)))
            return {"lat": float(latL[k]), "lon": float(lonL[k]), "name": cell_name(k), "score": r1(ov[k]),
                    "distance_km": int(round(float(d[k])))}
        same = (country == site_country[i]) if site_country[i] else np.zeros(len(L), bool)
        return {"same_country": best(same), "within_1000km": best(d <= 1000), "worldwide": best(np.ones(len(L), bool))}

    result_sites: dict = {}
    for i, s in enumerate(sites):
        per_target = {}
        by_body: dict[str, list[int]] = {"moon": [], "mars": []}
        for j, t in enumerate(tl):
            by_body[t["body"]].append(j)
        detail = set()
        best_target = {}
        for body, js in by_body.items():
            ranked = sorted(js, key=lambda j: -np.nan_to_num(S[i, j, 0], nan=-1))
            best_target[body] = tl[ranked[0]]["id"] if ranked and not np.isnan(S[i, ranked[0], 0]) else None
            detail.update(ranked[:DETAIL_TARGETS])
        detail.update(j for j, t in enumerate(tl) if t["primary"])
        for j, t in enumerate(tl):
            entry = {"overall": r1(S[i, j, 0]), "presets": {pid: r1(S[i, j, p]) for p, pid in enumerate(PRESET_IDS)},
                     "dims": {d: (None if np.isnan(DIMS_RAW[i, j, k]) else round(float(DIMS_RAW[i, j, k]), 3)) for k, d in enumerate(DIMS)},
                     "coverage": {d: round(float(COV_RAW[i, j, k]), 2) for k, d in enumerate(DIMS)}}
            if j in detail:
                _, _, _, M = score_against(cfg, E_sites, t["T"], "raw")
                Ms = {k: v for k, v in M.items()}
                ex = explain(cfg, i, E_sites, t["T"], Ms, show_s, "raw")
                entry["losses"] = ex["losses"]
                entry["skipped"] = ex["skipped"]
                entry["alternative"] = alt(i, j, 0)
                if best_target.get(t["body"]) == t["id"]:
                    entry["alternative_by_preset"] = {pid: alt(i, j, p) for p, pid in enumerate(PRESET_IDS)}
                    entry["losses_by_preset"] = {}
                    for p, pid in enumerate(PRESET_IDS):
                        _, _, _, Mp = score_against(cfg, E_sites, t["T"], pid)
                        entry["losses_by_preset"][pid] = explain(cfg, i, E_sites, t["T"], Mp, show_s, pid)["losses"]
            per_target[t["id"]] = entry
        result_sites[s["id"]] = {"best_target": best_target, "targets": per_target,
                                 "data_cell": {"lat": float(earth["lat"][sidx[i]]), "lon": float(earth["lon"][sidx[i]]),
                                               "borrowed_km": borrowed.get(i, (None, 0))[1] or None}}

    out = {"version": 1, "presets": PRESET_IDS, "dims": DIMS, "targets": result_targets, "sites": result_sites}
    (OUT / "matches.json").write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    size = (OUT / "matches.json").stat().st_size / 1e6
    print(f"wrote matches.json: {n_s} sites x {n_t} targets x {n_p} presets, {size:.1f} MB")
    have_temp = "temp_mean_c" in earth and not np.all(np.isnan(earth["temp_mean_c"]))
    print("Earth temperatures present:", have_temp)


if __name__ == "__main__":
    main()
