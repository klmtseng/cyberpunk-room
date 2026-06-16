#!/usr/bin/env python3
"""
Fetch short CC-licensed video clips for the outdoor holographic projection
slots in city.ts (AD_FILES playlist).

Source: Wikimedia Commons (.webm files, mostly CC-BY 3.0). The raw files
are large (100+ MB) so we download once, ffmpeg-clip to a short window
(25 s) scaled to 480p height, encode h264 mp4 at ~600 kbps so each output
is ~2-3 MB and Vercel-friendly. The full webm is deleted after transcode.

Output:
  public/assets/video/cc/*.mp4

Idempotent: skip clips that already exist. Fail-soft: a missing fetch
prints a warning + exit 0 so build doesn't choke. Same pattern as
fetch_textures.py.
"""
from __future__ import annotations
import json
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "public" / "assets" / "video" / "cc"
OUT_DIR.mkdir(parents=True, exist_ok=True)
TMP_DIR = Path("/tmp/neonloft-video-fetch")
TMP_DIR.mkdir(parents=True, exist_ok=True)

UA = "NeonLoft-AssetFetcher/1.0 (cyberpunk-room ad slot fetcher)"

# Prefer the bundled static ffmpeg over any system one — the project notes
# at $HOME/CLAUDE.md point to this binary. Falls through to system ffmpeg
# if the bundled one is missing.
FFMPEG_PATH = Path.home() / "Desktop/AI_MAC/tools/ffmpeg/ffmpeg"
if not FFMPEG_PATH.exists():
    sys_ffmpeg = shutil.which("ffmpeg")
    FFMPEG_PATH = Path(sys_ffmpeg) if sys_ffmpeg else FFMPEG_PATH

# Each entry: (out_filename, commons_file_title, clip_start_sec, clip_dur_sec, label)
CLIPS = [
    # Tokyo neon walk (CC-BY 3.0) — perfect cyberpunk billboard fodder
    ("cc_tokyo_night.mp4",
     "First nights in Tokyo.webm",
     30, 25, "TOKYO NIGHT"),
    # Highway headlights at night (CC-BY 3.0) — long shot of traffic streams
    ("cc_highway_night.mp4",
     "Cars driving at night.webm",
     5, 25, "HIGHWAY"),
    # NASA SLS booster ignition (US Gov work, public domain) — futurism kick
    ("cc_nasa_launch.mp4",
     "Igniting the Booster Space Launch System - NASA.webm",
     2, 20, "IGNITE"),
]


def resolve_commons_url(filename: str) -> str | None:
    api = "https://commons.wikimedia.org/w/api.php"
    qs = urllib.parse.urlencode({
        "action": "query",
        "titles": "File:" + filename,
        "prop": "imageinfo",
        "iiprop": "url|size",
        "format": "json",
    })
    req = urllib.request.Request(api + "?" + qs, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read().decode())
    except Exception as e:
        print(f"  api error: {e}", file=sys.stderr)
        return None
    pages = data.get("query", {}).get("pages", {}) or {}
    for _pid, page in pages.items():
        infos = page.get("imageinfo") or []
        if infos:
            return infos[0].get("url")
    return None


def download(url: str, dst: Path) -> bool:
    if dst.exists() and dst.stat().st_size > 1_000_000:
        return True
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            total = int(r.headers.get("Content-Length") or 0)
            mb = total / 1024 / 1024 if total else 0
            print(f"    downloading {mb:.1f} MB …", flush=True)
            with open(dst, "wb") as f:
                shutil.copyfileobj(r, f, length=64 * 1024)
        return True
    except Exception as e:
        print(f"    download error: {e}", file=sys.stderr)
        if dst.exists():
            dst.unlink()
        return False


def transcode(src: Path, dst: Path, start_sec: int, dur_sec: int) -> bool:
    # -ss before -i seeks fast but inaccurate; we accept ~1s drift to keep
    # encode time short. Scale to 854x480 (or proportional). H.264 baseline
    # + AAC silent so Safari/iOS plays it without complaint.
    cmd = [
        str(FFMPEG_PATH), "-y", "-loglevel", "warning",
        "-ss", str(start_sec), "-i", str(src),
        "-t", str(dur_sec),
        "-vf", "scale=854:-2,fps=24",
        "-c:v", "libx264", "-preset", "fast", "-crf", "26",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        "-an",  # mute — projection is silent, audio is room ambience only
        str(dst),
    ]
    try:
        subprocess.run(cmd, check=True)
        return True
    except subprocess.CalledProcessError as e:
        print(f"    ffmpeg error: {e}", file=sys.stderr)
        if dst.exists():
            dst.unlink()
        return False


def fetch_one(out_name: str, commons_title: str, start: int, dur: int) -> bool:
    out_path = OUT_DIR / out_name
    if out_path.exists() and out_path.stat().st_size > 100_000:
        print(f"  ✓ {out_name} already cached")
        return True
    print(f"  trying {commons_title} …")
    url = resolve_commons_url(commons_title)
    if not url:
        print(f"  ✗ {out_name}: could not resolve URL", file=sys.stderr)
        return False
    tmp = TMP_DIR / Path(url).name
    if not download(url, tmp):
        return False
    if not transcode(tmp, out_path, start, dur):
        return False
    size_kb = out_path.stat().st_size / 1024
    print(f"  ✓ {out_name} clipped {dur}s @ 480p ({size_kb:.0f} KB)")
    # Keep tmp around between runs so future clips can reuse the same
    # source webm without re-downloading 100 MB. /tmp gets nuked on reboot.
    return True


def main() -> int:
    print(f"[fetch_videos] output dir: {OUT_DIR}")
    if not FFMPEG_PATH.exists():
        print("ERROR: ffmpeg not found at", FFMPEG_PATH, file=sys.stderr)
        return 0  # fail-soft
    results = []
    for out_name, title, start, dur, _label in CLIPS:
        ok = fetch_one(out_name, title, start, dur)
        results.append((out_name, ok))
    print("[fetch_videos] done:",
          " ".join(f"{n}={'✓' if ok else '✗'}" for n, ok in results))
    return 0


if __name__ == "__main__":
    sys.exit(main())
