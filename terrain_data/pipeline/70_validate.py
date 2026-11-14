"""Phase 5: prove the data layer works -> out/validation.md. Exit code 0 means every hard check passed.

Hard checks (fail the run): row counts and unique cells, no NaN text, every source_id listed in sources.csv,
team checker on the temperature files, JavaScript scorer equal to the Python scorer on ten pairs, Athlone
present with real numbers. Soft checks (reported, never fail): value ranges, classic-analog rankings.

    python -I pipeline/70_validate.py
"""
from __future__ import annotations

import csv
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from grid import G1, G2  # noqa: E402
from score_core import DIMS, PRESET_IDS, load_config, score_against, side_values  # noqa: E402
from score_data import OUT, REPO, ROOT, cols_at, load_all, read_rows  # noqa: E402

PY = sys.executable
lines: list[str] = []
hard_fail: list[str] = []


def h(t: str, lvl: int = 2) -> None:
    lines.extend(["", "#" * lvl + " " + t, ""])


def table(head: list[str], rows: list[list]) -> None:
    lines.append("| " + " | ".join(head) + " |")
    lines.append("|" + "---|" * len(head))
    for r in rows:
        lines.append("| " + " | ".join(str(x) for x in r) + " |")
    lines.append("")


def check(ok: bool, msg: str) -> str:
    if not ok:
        hard_fail.append(msg)
    return "PASS" if ok else "FAIL"


# ------------------------------------------------------------------ 1. structure
def structure() -> None:
    h("1. Structure")
    sources = {r["source_id"] for r in read_rows(OUT / "sources.csv")}
    rows = []
    for name in ("moon_features.csv", "mars_features.csv", "earth_features_2deg.csv", "earth_grid_filled.csv",
                 "earth_grid_power_full.csv"):
        p = OUT / name
        if not p.exists():
            rows.append([name, "missing", "-", "-", check(name not in ("moon_features.csv", "mars_features.csv", "earth_features_2deg.csv"), f"{name} missing")])
            continue
        text = p.read_text(encoding="utf-8")
        data = list(csv.DictReader(text.splitlines()))
        cells = {(r["lat"], r["lon"]) for r in data}
        vals = [v.strip().lower() for r in data for v in r.values()]
        # NaN and infinity text are never allowed; -999 only counts as a sentinel if it repeats (one cell can truly be -999.0 m)
        bad_tokens = any(v in ("nan", "inf", "-inf") for v in vals) or sum(v in ("-999", "-999.0") for v in vals) >= 20
        ids = {s for r in data for s in r["source_id"].split(";") if s}
        missing = sorted(ids - sources)
        ok = len(data) == 16200 and len(cells) == 16200 and not bad_tokens and not missing
        rows.append([name, len(data), len(cells), "none" if not missing else ", ".join(missing),
                     check(ok, f"{name}: rows={len(data)} cells={len(cells)} nan/inf={bad_tokens} unlisted sources={missing}")])
    p1 = OUT / "earth_features_1deg.csv"
    d1 = list(csv.DictReader(p1.read_text(encoding="utf-8").splitlines()))
    ids1 = {s for r in d1 for s in r["source_id"].split(";") if s}
    rows.append(["earth_features_1deg.csv", len(d1), len({(r['lat'], r['lon']) for r in d1}), "none" if not (ids1 - sources) else ", ".join(sorted(ids1 - sources)),
                 check(len(d1) == 64800 and not (ids1 - sources), "earth 1deg structure")])
    table(["file", "rows", "unique cells", "source ids not in sources.csv", "result"], rows)
    h("Team checker (prototype/tools/csv_to_grid.py --check)", 3)
    rows = []
    for rel in ("moon_data/moon_grid.csv", "mars_data/mars_grid.csv", "terrain_data/out/earth_grid_filled.csv", "terrain_data/out/earth_grid_power_full.csv"):
        if not (REPO / rel).exists():
            rows.append([rel, "missing", "-"]); continue
        r = subprocess.run([PY, "-I", str(REPO / "prototype/tools/csv_to_grid.py"), str(REPO / rel), "--check"], capture_output=True, text=True, cwd=REPO)
        ok = r.returncode == 0
        rows.append([rel, (r.stdout.strip().splitlines() or [r.stderr.strip()[:80]])[-1][:90], check(ok, f"team checker failed on {rel}: {(r.stdout + r.stderr)[:200]}")])
    table(["file", "checker output (last line)", "result"], rows)


# ------------------------------------------------------------------ 2. ranges
LIMITS = {"_pct": (0, 100), "_idx": (0, 1), "slope_mean_deg": (0, 90), "_n": (0, 1e7), "_km": (0, 25000)}


def ranges(data: dict) -> None:
    h("2. Value ranges (soft check)")
    rows = []
    for body in ("earth", "moon", "mars"):
        t = data[body]
        for k, v in sorted(t.items()):
            if not (isinstance(v, np.ndarray) and v.shape == (t["n"],) and v.dtype.kind == "f") or k in ("lat", "lon"):
                continue
            ok_vals = v[~np.isnan(v)]
            if not len(ok_vals):
                rows.append([body, k, "all blank", "", "", "", "-"]); continue
            lim = next((lv for suf, lv in LIMITS.items() if k.endswith(suf) or k == suf), None)
            inside = "ok" if lim is None or (ok_vals.min() >= lim[0] - 1e-6 and ok_vals.max() <= lim[1] + 1e-6) else "OUT OF RANGE"
            rows.append([body, k, f"{ok_vals.min():.2f}", f"{np.median(ok_vals):.2f}", f"{ok_vals.max():.2f}", int(np.isnan(v).sum()), inside])
    table(["body", "column", "min", "median", "max", "blank cells", "physical limits"], rows)


# ------------------------------------------------------------------ 3. classic rankings
CASES = [
    ("Polar Mars", "haughton-crater", ["phoenix-green-valley", "deuteronilus-mensae"], "overall", "raw"),
    ("Polar Mars", "flashline-mars-arctic", ["phoenix-green-valley", "deuteronilus-mensae"], "overall", "raw"),
    ("Lunar mare", "mauna-kea", ["apollo-17", "marius-hills-pit"], "geology", None),
    ("Lunar mare", "kilauea-kau-desert", ["apollo-17", "marius-hills-pit"], "geology", None),
    ("Arid dusty Mars", "atacama-yungay", ["jezero", "meridiani-planum"], "dust", None),
    ("Subsurface", "cueva-de-los-verdes", ["marius-hills-pit"], "subsurface", None),
    ("Subsurface", "lava-beds", ["marius-hills-pit"], "subsurface", None),
    ("Habitability", "rio-tinto", ["meridiani-planum"], "habitability", None),
    ("Crewed training", "kilbourne-hole", ["apollo-16", "apollo-17"], "overall", "crewed"),
    ("Crewed training", "sp-crater", ["apollo-16", "apollo-17"], "overall", "crewed"),
    ("Highland geology", "stillwater-complex", ["apollo-16"], "geology", None),
    ("Highland geology", "lofoten-anorthosite", ["apollo-16"], "geology", None),
]


def rankings(m: dict, sites: dict) -> None:
    h("3. Sanity rankings: do the classics rank near the top? (soft check)")
    lines.append("Rank is among all %d named Earth sites for that target. A classic should sit in roughly the top 10 percent." % len(sites))
    lines.append("")
    rows = []
    for case, sid, tids, measure, preset in CASES:
        if sid not in m["sites"]:
            continue
        for tid in tids:
            def val(s):
                e = m["sites"][s]["targets"][tid]
                v = e["presets"][preset] if measure == "overall" and preset else (e["overall"] if measure == "overall" else (e["dims"][measure] * 100 if e["dims"][measure] is not None else None))
                return -1 if v is None else v
            scores = sorted(((val(s), s) for s in m["sites"]), reverse=True)
            rank = [s for _, s in scores].index(sid) + 1
            v = val(sid)
            rows.append([case, sites[sid]["name"], tid, f"{measure} ({preset})" if preset else measure, "n/a" if v < 0 else f"{v:.1f}", f"{rank} / {len(scores)}",
                         f"{rank / len(scores) * 100:.0f}%", "top 10%" if rank / len(scores) <= 0.10 else "outside"])
    table(["case", "classic analog", "target", "measure", "score", "rank", "percentile from top", "verdict"], rows)


# ------------------------------------------------------------------ 4. surprise list
def surprises(m: dict, targets: dict) -> None:
    h("4. Beyond the usual suspects: best 1-degree cells at least 300 km from any curated analog site")
    for tid, t in targets.items():
        if t.get("primary_demo") != "1":
            continue
        s = m["targets"][tid].get("surprise", [])
        if not s:
            continue
        lines.append(f"**{t['name']}** ({t['body']}): " + "; ".join(f"{x['name']} ({x['lat']:.1f}, {x['lon']:.1f}) {x['score']}" for x in s))
        lines.append("")


# ------------------------------------------------------------------ 5. Athlone card
def athlone(m: dict, sites: dict, targets: dict, sites_json: dict) -> None:
    h("5. The Athlone card")
    for sid in ("athlone", "clonmacnoise-esker-riada", "burren-poulnabrone"):
        e = sites_json.get(sid)
        if not e:
            check(False, f"{sid} missing from sites.json")
            continue
        h(f"{e['name']} ({e['lat']}, {e['lon']}) in {e['country']}", 3)
        rows = []
        for tid, t in targets.items():
            if t.get("primary_demo") != "1":
                continue
            r = e["matches"][tid]
            rows.append([t["name"], t["body"]] + [r["presets"][p] for p in PRESET_IDS])
        rows.sort(key=lambda x: -(x[2] or 0))
        table(["primary target", "body", "raw", "crewed", "base", "rover"], rows[:8])
        best = max(e["best_target"].items(), key=lambda kv: e["matches"][kv[1]]["overall"] or 0)
        bt = e["matches"][best[1]]
        lines.append(f"Best target: **{targets[best[1]]['name']}** ({best[0]}), raw {bt['overall']}. Top losses:")
        lines.append("")
        for l in bt.get("losses", []):
            lines.append(f"- {l['text']} ({l['points']} points lost)")
        a = bt.get("alternative", {})
        lines.append("")
        for k, lab in (("same_country", "Best place in the same country"), ("within_1000km", "Best place within 1,000 km"), ("worldwide", "Best place worldwide")):
            if a.get(k):
                lines.append(f"- {lab}: {a[k]['name']} ({a[k]['lat']}, {a[k]['lon']}), score {a[k]['score']}, {a[k]['distance_km']} km away")
        lines.append("")
    a = sites_json.get("athlone")
    check(a is not None and a["metrics"] and any(v is not None for v in a["scores"].values()) and a["image_local"] != "", "Athlone card has no real numbers")


# ------------------------------------------------------------------ 6. JavaScript against Python
PAIRS = [
    ("athlone", "jezero", "raw"), ("athlone", "shackleton", "crewed"), ("atacama-yungay", "meridiani-planum", "rover"),
    ("haughton-crater", "phoenix-green-valley", "base"), ("mauna-kea", "apollo-17", "raw"), ("kilbourne-hole", "apollo-16", "crewed"),
    ("askja", "marius-hills-pit", "raw"), ("lonar-crater", "gale", "base"), ("burren-poulnabrone", "mare-tranquillitatis-pit", "raw"),
    ("rio-tinto", "oxia-planum", "raw"),
]


def js_vs_python(data: dict, cfg: dict, sites: dict, targets: dict) -> None:
    h("6. JavaScript scorer against the Python scorer")
    earth, rng = data["earth"], data["ranges"]
    jobs, py = [], []
    for sid, tid, preset in PAIRS:
        s, t = sites[sid], targets[tid]
        ext = 1.0 if s.get("flags") else None
        jobs.append({"earth": {"lat": float(s["lat"]), "lon": float(s["lon"]), **({"extremophile": ext} if ext is not None else {})},
                     "target": {"lat": float(t["lat"]), "lon": float(t["lon"])}, "body": t["body"], "preset": preset})
        gi = int(G1.index(float(s["lat"]), float(s["lon"])))
        cols = cols_at(earth, np.array([gi])); cols["extremophile_idx"] = np.array([ext if ext is not None else np.nan])
        E = side_values(cfg, "earth", cols, np.array([earth["lat"][gi]]), rng)
        tb = data[t["body"]]; ti = int(G2.index(float(t["lat"]), float(t["lon"])))
        T = side_values(cfg, t["body"], cols_at(tb, np.array([ti])), np.array([tb["lat"][ti]]), rng)
        ov, dims, cov, _ = score_against(cfg, E, T, preset)
        py.append((float(ov[0]), {d: float(dims[d][0]) for d in DIMS}))
    pj = ROOT / "work" / "pairs.json"
    pj.write_text(json.dumps(jobs), encoding="utf-8")
    r = subprocess.run(["node", str(ROOT / "js" / "test_score.mjs"), str(pj)], capture_output=True, text=True, timeout=300)
    if r.returncode != 0:
        check(False, "node scorer failed: " + r.stderr[:300]); lines.append("Node failed: " + r.stderr[:300]); return
    js = json.loads(r.stdout)
    rows, worst = [], 0.0
    for (sid, tid, preset), (po, pd_), jp in zip(PAIRS, py, js["pairs"]):
        jo = jp["overall"]
        both_nan = po != po and jo is None
        diff = 0.0 if both_nan else abs(po - jo)
        dd = max([abs(pd_[d] - jp["dims"][d]) for d in DIMS if pd_[d] == pd_[d] and jp["dims"][d] is not None] or [0])
        worst = max(worst, diff, dd)
        rows.append([f"{sid} vs {tid}", preset, "n/a" if po != po else f"{po * 100:.3f}", "n/a" if jo is None else f"{jo * 100:.3f}", f"{diff:.2e}", f"{dd:.2e}"])
    table(["pair", "preset", "Python score", "JavaScript score", "overall difference", "largest dimension difference"], rows)
    g = js["grid"]
    lines.append(f"Worst difference {worst:.2e} (tolerance 2e-3). Full-grid timing in Node: one Earth place against all Mars cells {g['forwardMs']} ms "
                 f"({g['forwardCells']} cells scored); one Mars target against all Earth cells {g['reverseMs']} ms ({g['reverseCells']} cells scored).")
    lines.append("")
    check(worst < 2e-3, f"JS and Python differ by {worst}")


def coords_summary() -> None:
    h("7. Coordinates checked against Wikipedia")
    p = ROOT / "work" / "coord_check.csv"
    if not p.exists():
        lines.append("Not run."); return
    rows = list(csv.DictReader(p.open(encoding="utf-8")))
    n = {}
    for r in rows:
        n[r["status"].split(":")[0]] = n.get(r["status"].split(":")[0], 0) + 1
    lines.append(f"Last run covered {len(rows)} rows: {n}. CHECK means the curated point is more than 25 km (scaled by body size) from the Wikipedia page point; "
                 "most are regions or mission areas whose Wikipedia point is a centre, not the site itself. Details in terrain_data/work/coord_check.csv.")
    lines.append("")


def main() -> int:
    cfg, data = load_config(), load_all()
    m = json.loads((OUT / "matches.json").read_text(encoding="utf-8"))
    sites = {s["id"]: s for s in data["sites"]}
    targets = {t["id"]: t for t in data["targets"]}
    sj = {e["id"]: e for e in json.loads((OUT / "sites.json").read_text(encoding="utf-8"))}
    lines.append("# Validation report")
    lines.append("")
    lines.append("Generated by `pipeline/70_validate.py`. Hard checks fail the run; soft checks are reported for people to judge.")
    structure(); ranges(data); rankings(m, sites); surprises(m, targets); athlone(m, sites, targets, sj)
    js_vs_python(data, cfg, sites, targets); coords_summary()
    h("Result")
    lines.append("All hard checks passed." if not hard_fail else "HARD CHECKS FAILED:\n\n" + "\n".join(f"- {f}" for f in hard_fail))
    (OUT / "validation.md").write_text("\n".join(lines), encoding="utf-8")
    print("validation.md written;", "PASS" if not hard_fail else f"FAIL ({len(hard_fail)}): " + "; ".join(hard_fail)[:400])
    return 0 if not hard_fail else 1


if __name__ == "__main__":
    sys.exit(main())
