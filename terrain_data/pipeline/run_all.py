"""Run the whole data layer, or one phase of it. Every step is safe to re-run: finished downloads are
skipped, and the feature builders skip an existing output unless --force is given.

    terrain_data/.venv/Scripts/python.exe terrain_data/pipeline/run_all.py --phase all
    ... --phase moon | earth | mars | curated | score | validate
    ... --phase all --force        rebuild every output (downloads stay cached in raw/)

Order matters: curated tables need Earth features only for scoring, and scoring needs everything else.
Total time on a fresh machine is dominated by downloads (about 1.6 GB) and the NASA POWER temperature
pull (about 45 minutes for 1,320 requests).
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PY = sys.executable

PHASES = {
    "setup":    ["00_setup_check.py"],
    "moon":     ["10_moon_features.py"],
    "earth":    ["20a_download_earth.py", "21_earth_temperature.py --ocean", "20_earth_features.py"],
    "mars":     ["30_mars_features.py"],
    "curated":  ["41_verify_coords.py", "40_curated_tables.py"],
    "score":    ["50_score.py", "60_export.py"],
    "validate": ["70_validate.py"],
}
ORDER = ["setup", "moon", "earth", "mars", "curated", "score", "validate"]
FORCEABLE = {"10_moon_features.py", "20_earth_features.py", "30_mars_features.py"}


def main() -> int:
    args = sys.argv[1:]
    phase = args[args.index("--phase") + 1] if "--phase" in args else "all"
    force = "--force" in args
    names = ORDER if phase == "all" else [phase]
    for name in names:
        if name not in PHASES:
            sys.exit(f"unknown phase {name}; choose from {', '.join(ORDER)} or all")
        for script in PHASES[name]:
            parts = script.split()                          # a phase entry may carry flags, e.g. "21_earth_temperature.py --ocean"
            script = parts[0]
            cmd = [PY, "-I", str(HERE / script)] + parts[1:]
            if script == "20a_download_earth.py":
                cmd += ["--minutes", "120"]
            if force and script in FORCEABLE:
                cmd.append("--force")
            print(f"\n=== {name}: {script}", flush=True)
            r = subprocess.run(cmd)
            if r.returncode != 0:
                print(f"!!! {script} exited with {r.returncode}", flush=True)
                if script == "70_validate.py":
                    return r.returncode
    return 0


if __name__ == "__main__":
    sys.exit(main())
