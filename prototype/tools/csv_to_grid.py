"""Validate a grid CSV (see data_templates/DATA_FORMAT.md) and convert it for the app.

Usage (from the repo root):
  python prototype/tools/csv_to_grid.py data_templates/moon_grid.csv           # check + write
  python prototype/tools/csv_to_grid.py data_templates/moon_grid.csv --check   # check only

Writes prototype/grids/<body>.json with keys mean/high/low (what the app reads) plus one
list per optional column (null where empty). Standard library only.
"""
import argparse
import csv
import json
import sys
from pathlib import Path

RES = 2
ROWS, COLS = 180 // RES, 360 // RES
BODIES = {"moon", "mars", "earth"}
REQUIRED = ["body", "lat", "lon", "temp_mean_c", "temp_high_c", "temp_low_c", "source_id"]
TEMPS = {"temp_mean_c": "mean", "temp_high_c": "high", "temp_low_c": "low"}
GRIDS = Path(__file__).resolve().parent.parent / "grids"


def cell_of(lat, lon):
    """Return (row, col) if lat/lon is a valid 2° cell centre, else None."""
    row, col = (90 - RES / 2 - lat) / RES, (lon + 180 - RES / 2) / RES
    if row != int(row) or col != int(col) or not (0 <= row < ROWS and 0 <= col < COLS):
        return None
    return int(row), int(col)


def num(text):
    return None if text is None or text.strip() == "" else float(text)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv_path")
    ap.add_argument("--check", action="store_true", help="validate only, don't write JSON")
    args = ap.parse_args()

    errors, warnings = [], []
    with open(args.csv_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        cols = reader.fieldnames or []
        missing_cols = [c for c in REQUIRED if c not in cols]
        if missing_cols:
            sys.exit(f"Missing required columns: {', '.join(missing_cols)}")
        extras = [c for c in cols if c not in REQUIRED]
        rows = list(reader)

    bodies = {r["body"].strip().lower() for r in rows}
    if len(bodies) != 1 or not bodies <= BODIES:
        sys.exit(f"File must contain exactly one body out of {sorted(BODIES)}; found {sorted(bodies)}")
    body = bodies.pop()

    n = ROWS * COLS
    out = {k: [None] * n for k in list(TEMPS.values()) + extras}
    seen = [False] * n
    for line, r in enumerate(rows, start=2):  # line 1 is the header
        try:
            lat, lon = float(r["lat"]), float(r["lon"])
        except ValueError:
            errors.append(f"line {line}: lat/lon not a number")
            continue
        cell = cell_of(lat, lon)
        if cell is None:
            hint = " (lon must be -180..180, not 0..360)" if lon > 180 else ""
            errors.append(f"line {line}: ({lat}, {lon}) is not a 2° cell centre{hint}")
            continue
        i = cell[0] * COLS + cell[1]
        if seen[i]:
            errors.append(f"line {line}: duplicate cell ({lat}, {lon})")
            continue
        seen[i] = True
        for col, key in TEMPS.items():
            try:
                v = num(r[col])
            except ValueError:
                errors.append(f"line {line}: {col} is not a number")
                continue
            if v is None:
                errors.append(f"line {line}: {col} is empty (required)")
            elif not -273.15 <= v <= 200:
                errors.append(f"line {line}: {col}={v} outside -273..200 °C (Kelvin not converted?)")
            out[key][i] = v
        m, h, lo = (out[k][i] for k in ("mean", "high", "low"))
        if None not in (m, h, lo) and not (lo <= m <= h):
            warnings.append(f"line {line}: expected low <= mean <= high, got {lo}, {m}, {h}")
        for col in extras:
            if col == "source_id":
                continue
            try:
                out[col][i] = num(r[col])
            except ValueError:
                out[col][i] = r[col].strip() or None  # keep text columns as text

    missing = n - sum(seen)
    if missing:
        errors.append(f"{missing} of {n} grid cells are missing (need every 2° cell exactly once)")

    for w in warnings[:10]:
        print("warning:", w)
    if len(warnings) > 10:
        print(f"warning: ...and {len(warnings) - 10} more")
    if errors:
        for e in errors[:20]:
            print("error:", e)
        if len(errors) > 20:
            print(f"error: ...and {len(errors) - 20} more")
        sys.exit(f"\n{len(errors)} error(s): file not converted.")

    sources = sorted({r["source_id"] for r in rows})
    print(f"OK: {body}, {n} cells, mean {min(out['mean'])}..{max(out['mean'])} °C, sources: {', '.join(sources)}")
    if args.check:
        return
    out.pop("source_id", None)
    doc = {"res_deg": RES, "rows": ROWS, "cols": COLS, "units": "C",
           "source": ", ".join(sources), **out}
    dest = GRIDS / f"{body}.json"
    dest.write_text(json.dumps(doc, separators=(",", ":")))
    print(f"Wrote {dest}")


if __name__ == "__main__":
    main()
