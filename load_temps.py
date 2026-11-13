"""Load NASA POWER daily temperature files (JSON and CSV) and compare them.

Both loaders return the same pandas DataFrame: a date index and one column
per parameter (T2M, T2M_MAX, T2M_MIN, TS), with -999 turned into NaN.
"""
import io
import json
import sys
from pathlib import Path

import pandas as pd

DATA = Path(__file__).parent / "data"
MISSING = -999


def load_json(path):
    doc = json.loads(Path(path).read_text())
    df = pd.DataFrame(doc["properties"]["parameter"])  # dates become the index
    df.index = pd.to_datetime(df.index, format="%Y%m%d")
    lon, lat, elev = doc["geometry"]["coordinates"]
    df.attrs = {"lat": lat, "lon": lon, "elevation_m": elev,
                "units": {k: v["units"] for k, v in doc["parameters"].items()}}
    return df.replace(MISSING, float("nan"))


def load_csv(path):
    text = Path(path).read_text()
    body = text.split("-END HEADER-", 1)[1]  # skip the free-text header block
    df = pd.read_csv(io.StringIO(body.strip()))
    df.index = pd.to_datetime(dict(year=df.YEAR, month=df.MO, day=df.DY))
    return df.drop(columns=["YEAR", "MO", "DY"]).replace(MISSING, float("nan"))


def summary(df):
    return pd.Series({
        "mean_C": df.T2M.mean(),
        "record_low_C": df.T2M_MIN.min(),
        "record_high_C": df.T2M_MAX.max(),
        "avg_daily_swing_C": (df.T2M_MAX - df.T2M_MIN).mean(),
        "max_ground_temp_C": df.TS.max(),
        "missing_days": int(df.isna().any(axis=1).sum()),
    }).round(1)


if __name__ == "__main__":
    rows = {}
    for jf in sorted(DATA.glob("*.json")):
        j, c = load_json(jf), load_csv(jf.with_suffix(".csv"))
        same = j.equals(c[j.columns])
        print(f"{jf.stem:24s} JSON==CSV: {same}  ({len(j)} days)")
        rows[jf.stem.replace("_2023", "")] = summary(j)
    print()
    pd.set_option("display.width", 120)
    print(pd.DataFrame(rows).T.sort_values("mean_C").to_string())
    sys.exit(0)
