"""The scoring maths, shared by 50_score.py, 60_export.py and 70_validate.py.

js/score.js mirrors this file line for line; 70_validate.py proves they agree on ten pairs.

Per comparison:  match = max(0, 1 - |earth - target| / range)         (BUILD_PROMPT section 6.1)
Per dimension:   dim_score = mean of the available matches; coverage = available / total
Overall:         sum(w_d * dim_score_d) / sum(w_d) over dimensions that have data
Loss points:     (w_d / W) * (1 - match) / n_available_d * 100, summed over a comparison's dimensions,
                 so overall% + all loss points = 100.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CONFIG = ROOT / "config"
DIMS = ["terrain", "geology", "thermal", "water", "dust", "subsurface", "habitability", "operations"]
PRESET_IDS = ["raw", "crewed", "base", "rover"]


def load_config() -> dict:
    f = json.loads((CONFIG / "features.json").read_text(encoding="utf-8"))
    p = json.loads((CONFIG / "presets.json").read_text(encoding="utf-8"))
    c = json.loads((CONFIG / "caveats.json").read_text(encoding="utf-8"))
    return {"min_available": f.get("min_available", 0), "comparisons": f["comparisons"], "dimensions": f["dimensions"], "presets": p["presets"], "caveats": c}


# ----------------------------------------------------------------------------- value specs

def eval_spec(spec: dict, cols: dict, lat: np.ndarray, body: str, ranges: dict) -> np.ndarray:
    """Evaluate one value spec over arrays. Missing columns give NaN, never an error."""
    n = len(lat)
    nan = np.full(n, np.nan)

    def col(name):
        v = cols.get(name)
        return nan if v is None else np.asarray(v, dtype=float)

    op = spec["op"]
    if op == "skip":
        return nan
    if op == "const":
        return np.full(n, float(spec["value"]))
    if op == "abslat":
        return np.abs(lat) / spec.get("div", 1)
    if op == "col":
        v = col(spec["col"])
        if "fallback" in spec:
            v = np.where(np.isnan(v), col(spec["fallback"]), v)
    elif op == "sum":
        v = sum(col(c) for c in spec["cols"])            # NaN if any part is NaN
    elif op == "diff":
        v = col(spec["cols"][0]) - col(spec["cols"][1])
    elif op == "oneminus":
        v = 1 - col(spec["col"]) / spec.get("div", 1)
    else:
        raise ValueError(f"unknown op {op}")
    if "div" in spec and op in ("col", "sum"):
        v = v / spec["div"]
    if "times_scaled" in spec:
        c2, lo, hi = spec["times_scaled"]
        v = v * np.clip((col(c2) - lo) / (hi - lo), 0, 1)
    if "cap" in spec:
        v = np.minimum(v, spec["cap"])
    if spec.get("log10"):
        with np.errstate(all="ignore"):
            v = np.where(v > 0, np.log10(np.where(v > 0, v, 1.0)), np.nan)
    if spec.get("scale") == "body_range":
        r = ranges.get(body, {}).get(spec["col"])
        v = np.minimum(1.0, v / r) if r else nan
    return v


def side_values(cfg: dict, side: str, cols: dict, lat: np.ndarray, ranges: dict) -> dict:
    """{comparison id: value array} for one side ('earth', 'moon' or 'mars')."""
    return {c["id"]: eval_spec(c[side], cols, lat, side, ranges) for c in cfg["comparisons"]}


def show_values(cfg: dict, cols: dict) -> dict:
    """The raw quantity quoted for Earth in loss sentences, where a comparison defines one."""
    out = {}
    for c in cfg["comparisons"]:
        s = c.get("earth_show")
        if s and s["col"] in cols:
            out[c["id"]] = np.asarray(cols[s["col"]], dtype=float)
    return out


# ----------------------------------------------------------------------------- scoring

def match_all(cfg: dict, E: dict, T: dict) -> dict:
    """{id: match array over the Earth side} for one target (T holds scalars or equal-length arrays)."""
    out = {}
    for c in cfg["comparisons"]:
        e, t = E[c["id"]], T[c["id"]]
        with np.errstate(invalid="ignore"):
            m = np.maximum(0.0, 1.0 - np.abs(e - t) / c["range"])
        out[c["id"]] = np.where(np.isnan(e) | np.isnan(t), np.nan, m)
    return out


def aggregate(cfg: dict, M: dict, weights: dict) -> tuple[np.ndarray, dict, dict]:
    """Dimension scores, coverage and overall from per-comparison matches. All arrays share one length."""
    n = len(next(iter(M.values())))
    dim_score, coverage = {}, {}
    for d in DIMS:
        ids = [c["id"] for c in cfg["comparisons"] if d in c["dimensions"]]
        if not ids:
            dim_score[d], coverage[d] = np.full(n, np.nan), np.zeros(n)
            continue
        stack = np.vstack([M[i] for i in ids])
        have = ~np.isnan(stack)
        cnt = have.sum(axis=0)
        with np.errstate(all="ignore"):
            dim_score[d] = np.where(cnt > 0, np.where(have, stack, 0).sum(axis=0) / cnt, np.nan)
        coverage[d] = cnt / len(ids)
    num = np.zeros(n)
    den = np.zeros(n)
    for d in DIMS:
        ok = ~np.isnan(dim_score[d])
        num += np.where(ok, weights[d] * np.nan_to_num(dim_score[d]), 0)
        den += np.where(ok, weights[d], 0)
    n_avail = sum((~np.isnan(M[c["id"]])).astype(int) for c in cfg["comparisons"])
    with np.errstate(all="ignore"):
        overall = np.where((den > 0) & (n_avail >= cfg.get("min_available", 0)), num / den, np.nan)
    return overall, dim_score, coverage


def score_against(cfg: dict, E: dict, T: dict, preset: str) -> tuple[np.ndarray, dict, dict, dict]:
    """Score every Earth entry against one target for one preset."""
    M = match_all(cfg, E, T)
    w = {d: cfg["presets"][preset]["weights"].get(d, 0) for d in DIMS}
    overall, dims, cov = aggregate(cfg, M, w)
    return overall, dims, cov, M


# ----------------------------------------------------------------------------- explanations

def fmt_num(v: float, digits: int) -> str:
    return f"{v:.{digits}f}"


def explain(cfg: dict, i: int, E: dict, T: dict, M: dict, show: dict, preset: str, top: int = 3) -> dict:
    """Loss list, skipped features and sentences for Earth entry i against one target."""
    w = {d: cfg["presets"][preset]["weights"].get(d, 0) for d in DIMS}
    avail = {}
    for d in DIMS:
        avail[d] = sum(1 for c in cfg["comparisons"] if d in c["dimensions"] and not math.isnan(M[c["id"]][i]))
    W = sum(w[d] for d in DIMS if avail[d] > 0)
    losses, skipped = [], []
    for c in cfg["comparisons"]:
        m = M[c["id"]][i]
        if math.isnan(m):
            skipped.append(c["id"])
            continue
        pts = sum((w[d] / W) * (1 - m) / avail[d] * 100 for d in c["dimensions"] if avail[d] > 0 and W > 0)
        e, t = float(E[c["id"]][i]), float(np.atleast_1d(T[c["id"]])[0])
        sh = c.get("earth_show")
        if sh and c["id"] in show and not math.isnan(show[c["id"]][i]):
            e_txt = fmt_num(float(show[c["id"]][i]), sh["digits"]) + sh["unit"]
        else:
            e_txt = fmt_num(e, c["digits"]) + c["unit"]
        t_txt = c.get("target_show") or (fmt_num(t, c["digits"]) + c["unit"])
        losses.append({"id": c["id"], "label": c["label"], "points": round(pts, 2), "match": round(float(m), 3),
                       "earth": e_txt, "target": t_txt,
                       "text": f"{c['label']} is {e_txt} here but {t_txt} on the target."})
    losses.sort(key=lambda x: -x["points"])
    return {"losses": losses[:top], "skipped": skipped}
