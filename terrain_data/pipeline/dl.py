"""Download helper for the terrain_data pipeline.

Why this exists: the venue network drops hosts at random, so every download goes through
curl with retries and resume, tries an ordered list of mirrors, and caches the result in
terrain_data/raw/ (git-ignored). A finished file gets a ".ok" marker next to it so re-running
the pipeline never downloads twice.

Usage from another script:
    from dl import fetch
    path = fetch(["https://host-a/file.zip", "https://host-b/file.zip"], "file.zip")
    if path is None: ... use the documented fallback ...

Usage from the command line (handy for testing a URL):
    python pipeline/dl.py URL [dest_name]
"""
from __future__ import annotations

import datetime as _dt
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent                      # terrain_data/
RAW = ROOT / "raw"
WORK = ROOT / "work"
LOG = WORK / "log.md"

# A browser-like User-Agent: volcano.si.edu returns 403 to curl's default one, and
# Wikimedia asks for a descriptive agent. One string works for both.
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/130.0 Safari/537.36 AnalogAtlas/0.1 (HackAthlone 2026 student project)")


def _log(line: str) -> None:
    """Append one line to work/log.md so DATA_SOURCES.md can be generated from it later."""
    WORK.mkdir(parents=True, exist_ok=True)
    stamp = _dt.datetime.now().strftime("%Y-%m-%d %H:%M")
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(f"- {stamp} {line}\n")


def _human(n: int | None) -> str:
    if n is None:
        return "? MB"
    return f"{n / 1e6:.1f} MB"


def content_length(url: str, timeout: int = 20) -> int | None:
    """Ask the server how big the file is (HEAD request). None if it will not say."""
    try:
        out = subprocess.run(
            ["curl", "-sIL", "-A", UA, "--max-time", str(timeout), url],
            capture_output=True, text=True, timeout=timeout + 5,
        ).stdout
    except (subprocess.TimeoutExpired, OSError):
        return None
    size = None
    for line in out.splitlines():
        if line.lower().startswith("content-length:"):
            try:
                size = int(line.split(":", 1)[1].strip())   # keep the LAST one (after redirects)
            except ValueError:
                pass
    return size


def _curl(url: str, dest: Path, resume: bool, timeout: int) -> int:
    """Run curl once with the project's retry settings. Returns curl's exit code."""
    cmd = ["curl", "-L", "--fail", "-sS", "-A", UA,
           "--retry", "8", "--retry-all-errors", "--retry-delay", "3",
           "--connect-timeout", "25", "--max-time", str(timeout),
           "-o", str(dest), url]
    if resume:
        cmd[1:1] = ["-C", "-"]
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 30).returncode
    except subprocess.TimeoutExpired:
        return 28


def fetch(urls: list[str] | str, dest_name: str | None = None, *, rounds: int = 3,
          min_bytes: int = 1, timeout: int = 1800, quiet: bool = False) -> Path | None:
    """Download the first URL that works into raw/<dest_name>. Returns the path, or None.

    - Tries every mirror in order, `rounds` times over (a host that resets now may be back
      in a minute).
    - Resumes a partial file (`-C -`); if the server refuses ranges, starts over once.
    - Checks the final size against Content-Length when the server gives one.
    - Writes a ".ok" marker when done; the next call returns immediately.
    """
    if isinstance(urls, str):
        urls = [urls]
    RAW.mkdir(parents=True, exist_ok=True)
    name = dest_name or Path(urls[0].split("?")[0]).name
    dest = RAW / name
    marker = dest.with_name(dest.name + ".ok")
    if dest.exists() and marker.exists():
        return dest

    for rnd in range(1, rounds + 1):
        for i, url in enumerate(urls, start=1):
            expected = content_length(url)
            if expected is not None and dest.exists() and dest.stat().st_size == expected:
                marker.write_text(url, encoding="utf-8")
                _log(f"already had {name} ({_human(expected)}) from {url}")
                return dest
            if not quiet:
                print(f"  dl: {name} <- {url}  (mirror {i}/{len(urls)}, round {rnd}/{rounds}, "
                      f"{_human(expected)})", flush=True)
            rc = _curl(url, dest, resume=dest.exists(), timeout=timeout)
            if rc == 33 or (rc == 22 and dest.exists()):
                # 33 = server does not support resume; 22 with a partial file is often HTTP 416
                dest.unlink(missing_ok=True)
                rc = _curl(url, dest, resume=False, timeout=timeout)
            if rc == 0 and dest.exists():
                size = dest.stat().st_size
                if size < min_bytes:
                    dest.unlink(missing_ok=True)
                    continue
                if expected is not None and size != expected:
                    # short read: keep the partial file for the resume on the next try
                    continue
                marker.write_text(url, encoding="utf-8")
                _log(f"downloaded {name} ({_human(size)}) from {url}"
                     + (f" [mirror {i}]" if i > 1 else ""))
                return dest
    _log(f"FAILED to download {name} after {rounds} rounds over {len(urls)} mirror(s): "
         + "; ".join(urls))
    if not quiet:
        print(f"  dl: FAILED {name}; use the documented fallback", flush=True)
    return None


def fetch_text(url: str, dest_name: str, **kw) -> str | None:
    """fetch() then read the file as UTF-8 text (for CSV/JSON/HTML endpoints)."""
    p = fetch(url, dest_name, **kw)
    return p.read_text(encoding="utf-8", errors="replace") if p else None


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    p = fetch(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None, rounds=1)
    print(p if p else "FAILED")
