"""Cell geometry shared by every pipeline step.

The team grid contract (data_templates/DATA_FORMAT.md): 2-degree cells, 90 rows x 180
columns, row 0 is the north edge, column 0 is 180 W, cell centres at odd degrees. The Earth
ranking grid is the same idea at 1 degree (180 x 360, centres at .5). The index maths mirrors
analog-atlas/analog-atlas/js/temperature.js exactly:

    row = floor((90 - lat) / res),  col = floor((lon + 180) / res),  index = row * cols + col

Everything here is plain numpy; no GIS library needed.
"""
from __future__ import annotations

import csv
import math
from pathlib import Path

import numpy as np

RADIUS_KM = {"earth": 6371.0, "moon": 1737.4, "mars": 3389.5}


class Grid:
    """A regular lat/lon grid at `res` degrees covering the whole body."""

    def __init__(self, res: float):
        self.res = res
        self.rows = int(round(180 / res))
        self.cols = int(round(360 / res))
        self.n = self.rows * self.cols
        # cell-centre coordinates, north to south and west to east
        self.lats = 90 - (np.arange(self.rows) + 0.5) * res
        self.lons = -180 + (np.arange(self.cols) + 0.5) * res

    def index(self, lat, lon):
        """Cell index for a point (scalar or array). Points on the edge clip into the grid."""
        row = np.clip(np.floor((90 - np.asarray(lat, float)) / self.res), 0, self.rows - 1)
        col = np.clip(np.floor((np.asarray(lon, float) + 180) / self.res), 0, self.cols - 1)
        return (row * self.cols + col).astype(int)

    def center(self, i):
        """lat, lon of a cell centre from its index."""
        i = np.asarray(i)
        return self.lats[i // self.cols], self.lons[i % self.cols]

    def lat_grid(self):
        return np.repeat(self.lats, self.cols)

    def lon_grid(self):
        return np.tile(self.lons, self.rows)

    def area_km2(self, body: str) -> np.ndarray:
        """True area of every cell, flattened. Shrinks toward the poles."""
        r = RADIUS_KM[body]
        lat_n = np.radians(self.lats + self.res / 2)
        lat_s = np.radians(self.lats - self.res / 2)
        band = r * r * np.radians(self.res) * (np.sin(lat_n) - np.sin(lat_s))
        return np.repeat(band, self.cols)


G2 = Grid(2)   # Moon, Mars, Earth aggregate (team layout)
G1 = Grid(1)   # Earth ranking grid


# ----------------------------------------------------------------------------- aggregation

def block_reduce(a: np.ndarray, factor: int, how: str = "mean") -> np.ndarray:
    """Coarsen a 2-D raster by an integer factor, ignoring NaN. how = mean | std | min | max | count.

    The raster must have shape (rows*factor, cols*factor) with row 0 at the north edge and
    column 0 at 180 W (shift 0..360 rasters first with `roll_to_180`).
    """
    r, c = a.shape
    if r % factor or c % factor:
        raise ValueError(f"shape {a.shape} not divisible by {factor}")
    blocks = a.reshape(r // factor, factor, c // factor, factor).swapaxes(1, 2)
    blocks = blocks.reshape(r // factor, c // factor, factor * factor)
    with np.errstate(all="ignore"):
        if how == "mean":
            return np.nanmean(blocks, axis=2)
        if how == "std":
            return np.nanstd(blocks, axis=2)
        if how == "min":
            return np.nanmin(blocks, axis=2)
        if how == "max":
            return np.nanmax(blocks, axis=2)
        if how == "count":
            return np.sum(~np.isnan(blocks), axis=2)
    raise ValueError(how)


def roll_to_180(a: np.ndarray) -> np.ndarray:
    """Convert a raster whose first column is longitude 0 into one whose first column is -180."""
    return np.roll(a, a.shape[1] // 2, axis=1)


def slope_deg(dem: np.ndarray, cell_km: float, lats_deg: np.ndarray) -> np.ndarray:
    """Slope in degrees from a DEM in metres on a lat/lon raster.

    `cell_km` is the north-south size of one pixel; the east-west size shrinks with cos(lat).
    Central differences; this is the slope at the raster's own baseline, not a boulder-scale one.
    """
    dy_m = cell_km * 1000.0
    dx_m = dy_m * np.cos(np.radians(lats_deg))[:, None]
    dx_m = np.maximum(dx_m, 1.0)                       # avoid division by zero at the poles
    gy = np.gradient(dem, axis=0) / dy_m
    gx = np.gradient(dem, axis=1) / dx_m
    return np.degrees(np.arctan(np.hypot(gx, gy)))


# ----------------------------------------------------------------------------- point sets

def haversine_km(lat1, lon1, lat2, lon2, body: str = "earth"):
    """Great-circle distance in km between two points or broadcastable arrays."""
    r = RADIUS_KM[body]
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dphi = p2 - p1
    dlmb = np.radians(np.asarray(lon2) - np.asarray(lon1))
    h = np.sin(dphi / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dlmb / 2) ** 2
    return 2 * r * np.arcsin(np.sqrt(np.clip(h, 0, 1)))


def _xyz(lat, lon):
    la, lo = np.radians(lat), np.radians(lon)
    return np.column_stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)])


def nearest_point(grid: Grid, pt_lat, pt_lon, body: str):
    """For every cell centre: (distance_km to the nearest point, index of that point).

    Uses a k-d tree on unit-sphere vectors, so it is exact for great-circle nearest neighbours.
    """
    from scipy.spatial import cKDTree
    pts = _xyz(np.asarray(pt_lat, float), np.asarray(pt_lon, float))
    tree = cKDTree(pts)
    chord, idx = tree.query(_xyz(grid.lat_grid(), grid.lon_grid()), k=1)
    ang = 2 * np.arcsin(np.clip(chord / 2, 0, 1))
    return ang * RADIUS_KM[body], idx


def count_points(grid: Grid, pt_lat, pt_lon) -> np.ndarray:
    """Number of points falling in each cell (flattened grid)."""
    idx = grid.index(np.asarray(pt_lat, float), np.asarray(pt_lon, float))
    return np.bincount(idx, minlength=grid.n).astype(float)


def density_per_100k_km2(grid: Grid, pt_lat, pt_lon, body: str) -> np.ndarray:
    """Points per 100,000 km2 using each cell's true area."""
    return count_points(grid, pt_lat, pt_lon) / grid.area_km2(body) * 1e5


def proximity_index(dist_km: np.ndarray, full_km: float, zero_km: float) -> np.ndarray:
    """1 within full_km, 0 beyond zero_km, linear between."""
    return np.clip((zero_km - dist_km) / (zero_km - full_km), 0, 1)


# ----------------------------------------------------------------------------- team CSV i/o

def fmt(v, decimals: int = 1) -> str:
    """Fixed decimals, blank for unknown (NaN/None). Never writes 0 for missing, never 'nan'."""
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    try:
        fv = float(v)
    except (TypeError, ValueError):
        return str(v)
    if math.isnan(fv) or math.isinf(fv):
        return ""
    s = f"{fv:.{decimals}f}"
    return s[1:] if s.startswith("-") and float(s) == 0 else s


def write_grid_csv(path, body: str, grid: Grid, columns: dict, source_ids,
                   decimals: dict | None = None, text_columns: set | None = None) -> None:
    """Write a flattened grid to CSV in the team layout.

    columns: ordered {name: array of length grid.n} (NaN = blank).
    source_ids: one string for all rows, or a sequence of strings per cell (';'-joined ids).
    decimals: {name: n} to override the default one decimal (e.g. 3 for 0..1 indices).
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    decimals = decimals or {}
    text_columns = text_columns or set()
    lat = grid.lat_grid()
    lon = grid.lon_grid()
    if isinstance(source_ids, str):
        source_ids = [source_ids] * grid.n
    names = list(columns)
    coord_dec = 0 if grid.res == 2 else 1
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["body", "lat", "lon"] + names + ["source_id"])
        for i in range(grid.n):
            row = [body, fmt(lat[i], coord_dec), fmt(lon[i], coord_dec)]
            for n in names:
                v = columns[n][i]
                if n in text_columns:
                    row.append("" if v is None or (isinstance(v, float) and math.isnan(v)) else str(v))
                else:
                    row.append(fmt(v, decimals.get(n, 1)))
            row.append(source_ids[i])
            w.writerow(row)


def read_grid_csv(path, grid: Grid | None = None) -> dict:
    """Read a team-layout CSV into {column: float array}; text columns become object arrays.

    Also returns 'body' and '_grid'. Unknown values become NaN.
    """
    import pandas as pd
    df = pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8-sig")
    lat = df["lat"].astype(float).to_numpy()
    lon = df["lon"].astype(float).to_numpy()
    if grid is None:
        grid = G2 if len(df) == G2.n else G1
    idx = grid.index(lat, lon)
    out = {"body": df["body"].iloc[0] if len(df) else None, "_grid": grid}
    for c in df.columns:
        if c in ("body", "lat", "lon"):
            continue
        col = df[c].to_numpy()
        try:
            vals = np.where(col == "", "nan", col).astype(float)
            arr = np.full(grid.n, np.nan)
            arr[idx] = vals
        except ValueError:
            arr = np.full(grid.n, "", dtype=object)
            arr[idx] = col
        out[c] = arr
    return out


if __name__ == "__main__":
    assert G2.index(89, -179) == 0 and G2.index(-89, 179) == G2.n - 1
    assert G2.index(53.42, -7.91) == G2.index(53, -7)
    la, lo = G2.center(G2.index(53.42, -7.91))
    assert (la, lo) == (53.0, -7.0), (la, lo)
    assert G1.index(53.42, -7.91) == G1.index(53.5, -7.5)
    a = G2.area_km2("earth")
    assert abs(a.sum() - 4 * math.pi * 6371.0 ** 2) < 1.0
    assert fmt(float("nan")) == "" and fmt(-0.04) == "0.0" and fmt(1.25, 2) == "1.25"
    print("grid.py ok: Athlone is 2-degree cell", int(G2.index(53.42, -7.91)),
          "and 1-degree cell", int(G1.index(53.42, -7.91)), "; area check passed")
