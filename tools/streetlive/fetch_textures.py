#!/usr/bin/env python3
"""
Fetch real-world textures for the W5b living-street additions in city.ts.

Two sources:
  - Wikimedia Commons (already-CC-licensed, no API key, /tmp probe passed)
  - ambientCG (CC0 PBR materials, direct .zip from struffelproductions CDN)

Output:
  public/assets/textures/street_live/train_livery_a.jpg     (1024x128 tileable strip — train side)
  public/assets/textures/street_live/city_aerial_night.jpg  (1024x1024 — used as LED billboard panels)
  public/assets/textures/street_live/street_overlay_night.jpg (1024x1024 — true aerial for street overlay; W5b fix)
  public/assets/textures/street_live/asphalt_wet_diff.jpg   (1024x1024 — ambientCG wet asphalt base; W5b fix)

Idempotent: skip files that already exist. Fail-soft: if a candidate URL
errors out, fall through to the next one; if ALL candidates fail, print a
warning + exit 0 so the build still proceeds (city.ts has a procedural
fallback for each texture).
"""
from __future__ import annotations
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "public" / "assets" / "textures" / "street_live"
OUT_DIR.mkdir(parents=True, exist_ok=True)

UA = (
    "NeonLoft-AssetFetcher/1.0 "
    "(https://github.com/klmtseng/cyberpunk-room; tooling for art assets)"
)

# Candidate file names on Wikimedia Commons (no "File:" prefix). The fetcher
# tries them in order and stops at the first one that downloads + post-
# processes cleanly. Picked for: landscape orientation, clear subject, good
# lighting, distinct neon/window features.
TRAIN_CANDIDATES = [
    # Non-mainland-China options first (user preference 2026-06-15). Verified
    # present on Commons via search 2026-06-15.
    "Seoul-metro-510-Banghwa-station-platform-20180914-173620.jpg",
    "S-Bahn at Hauptbahnhof Berlin.JPG",
    "KHI CSR C151B ext port angled.jpg",
    "Berlin S-Bahn Botanischer Garten 04-2015 img2.jpg",
    "Tokyo Monorail 10000 2015-02.jpg",
    "Seoul-metro-P555-Macheon-station-platform-20180915-110842.jpg",
]

# Second train livery for Rail B — pick something visually distinct from the
# Shanghai Transrapid (which is white-teal). Tokyo Monorail / HK MTR types
# usually give us bright window strips against a darker body. Output:
# train_livery_b.jpg
TRAIN_B_CANDIDATES = [
    # Verified-present file names from Commons category listings 2026-06-15
    "Tokyo Monorail 10000 2015-04.jpg",
    "Tokyo Monorail 10000 2015-02.jpg",
    "Tokyo Monorail 10000 2015-01.jpg",
    "Monorail2000n-wiki.jpg",
    "2020-03-16 Tokyo Monorail 2000 series at Tamachi, Tokyo, Japan.jpg",
    "Tokyo Monorail 2011 at Showajima depot 2015.jpg",
]

# Single hero tower façade — applied to ONE dedicated tower in city.ts to
# show off a real cyberpunk skyscraper photo against the procedural towers
# next to it. Tall portrait crops work best (these are skyscraper photos
# taken from below). All candidates verified present on Commons 2026-06-15.
CYBERPUNK_FACADE_CANDIDATES = [
    # Head-on tower photos with little sky/ground — better full-body crops.
    # Avoid mainland-China per user preference (per feedback_avoid_china_architecture).
    "Mode Gakuen Cocoon Tower in the evening with blue sky Tokyo Japan.jpg",
    "Mode Gakuen Cocoon Tower, June 2025.jpg",
    "Cocoon Tower, Shinjuku (53416678941).jpg",
]

# Second hero tower — user referenced Shin Kong Life Tower (Taipei) photo
# 2026-06-15 as the next building to mock. Iconic Taipei landmark with
# golden body + repeating window grid + decorative crown.
CYBERPUNK_FACADE_B_CANDIDATES = [
    "Taipei Taiwan Shin-Kong-Tower-03.jpg",
    "Taipei Taiwan Shin-Kong-Tower-01.jpg",
    "Taipei Taiwan Shin-Kong-Tower-02.jpg",
    "Shin Kong Life Tower view from Ketagalan Blvd 20060221.jpg",
    "Asia Plaza Building, Shin Kong Life Tower and a streetlight 20240720.jpg",
    "新光摩天大樓.jpg",
]

# Third hero tower / 3rd channel in the holographic playlist (W5b-holo-B
# channel cycling). Looking for tall portrait-orientation night photos of
# iconic non-China skyscrapers. Verified-existing Commons titles 2026-06-15.
CYBERPUNK_FACADE_C_CANDIDATES = [
    "Petronas Towers at Night - from the base upwards.jpg",
    "Kuala Lumpur, Malaysia, Petronas Towers at night, glitter.jpg",
    "Burj Khalifa Night View 01.jpg",
    "Burj Khalifa Night View 03.jpg",
    "The Shard at night - geograph.org.uk - 2732298.jpg",
    "The Shard at night - geograph.org.uk - 5682058.jpg",
]

# ambientCG concrete pack — applied to the elevated rail beam + pylon shafts
# so they read as real cast-concrete structures, not flat-colour boxes.
# Output: concrete_diff.jpg (1024x1024)
CONCRETE_CANDIDATES = [
    "Concrete034_1K-JPG.zip",
    "Concrete044A_1K-JPG.zip",
    "Concrete019_1K-JPG.zip",
    "Concrete015_1K-JPG.zip",
]

# LED-billboard candidates — keep the existing first pick (Shibuya) because
# it's already deployed as the LED billboard texture on selected tower faces.
# Used by `fetch_billboard` below; output stays at city_aerial_night.jpg.
BILLBOARD_CANDIDATES = [
    "Shibuya_Crossing_at_night.jpg",
    "Times_Square,_New_York_City_(HDR).jpg",
    "Akihabara_at_night.jpg",
]

# Street-overlay candidates — STRICTLY top-down / high-angle aerials of a
# real megacity at night. These get blended onto the 900x900 street plane,
# so non-aerial street-level photos look wrong (perspective fights the
# horizontal plane). Aerials chosen for visible avenue grid + headlight
# streaks. Output: street_overlay_night.jpg.
AERIAL_CANDIDATES = [
    # Non-mainland-China night aerials first (user preference 2026-06-15).
    # All verified present on Commons via search 2026-06-15.
    "Drone shot with Tokyo Skytree in the distance at night.jpg",
    "Drone panorama of Chiyoda Ward at night.jpg",
    "1 singapore skyline night panorama 2011.jpg",
    "Kabukicho red gate and colorful neon street signs at night, Shinjuku, Tokyo, Japan.jpg",
    "Twilight over the modern city skyline in Ratchadamri district, Bangkok, Thailand, July 2019 - Flickr - sergei.gussev.jpg",
    # Daytime aerials as last-resort fallback — process_aerial night-shifts
    "Tokyo_from_the_top_of_the_SkyTree.JPG",
    "Manhattan_at_dusk_by_slonecznik.jpg",
]

# ambientCG CC0 asphalt PBR pack — used as the diffuse base for the street
# plane material so the ground reads as real wet tarmac, not a painted map.
# The struffelproductions CDN serves a 302 redirect from /get?file=… to a
# direct .zip; we follow the redirect and extract the *_Color.jpg slice.
ASPHALT_CANDIDATES = [
    "Asphalt026A_1K-JPG.zip",   # confirmed reachable as of W5b fix probe
    "Asphalt026_1K-JPG.zip",
    "Asphalt025_1K-JPG.zip",
    "Asphalt020_1K-JPG.zip",
]


def resolve_commons_url(filename: str) -> str | None:
    """Ask the Commons API for the direct file URL."""
    api = "https://commons.wikimedia.org/w/api.php"
    qs = urllib.parse.urlencode({
        "action": "query",
        "titles": "File:" + filename,
        "prop": "imageinfo",
        "iiprop": "url",
        "format": "json",
    })
    req = urllib.request.Request(api + "?" + qs, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read().decode())
    except Exception as e:
        print(f"  [{filename}] API error: {e}", file=sys.stderr)
        return None
    pages = data.get("query", {}).get("pages", {}) or {}
    for _pid, page in pages.items():
        infos = page.get("imageinfo") or []
        if infos:
            return infos[0].get("url")
    return None


def download_image(url: str) -> Image.Image | None:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            buf = r.read()
    except Exception as e:
        print(f"  download error ({url}): {e}", file=sys.stderr)
        return None
    try:
        img = Image.open(BytesIO(buf)).convert("RGB")
        # Wikimedia originals can be 4000-12000 px wide — that's wasteful
        # to keep in memory. Shrink early.
        if max(img.size) > 3000:
            ratio = 3000 / max(img.size)
            img = img.resize(
                (int(img.size[0] * ratio), int(img.size[1] * ratio)),
                Image.LANCZOS,
            )
        return img
    except Exception as e:
        print(f"  decode error: {e}", file=sys.stderr)
        return None


def process_train(img: Image.Image) -> Image.Image:
    """Crop to a wide horizontal strip showing the train side, resize to
    1024x128 with a soft horizontal tile fade so the rail loop doesn't show
    a hard seam."""
    w, h = img.size
    # Crop to the middle horizontal band where the train body should sit.
    # Real photos have varying composition; centre band of height 0.55 gives
    # us the most consistent slice across all candidate files.
    band_h = int(h * 0.55)
    top = int(h * 0.25)
    img = img.crop((0, top, w, top + band_h))
    # Now resize to 1024x128 (aspect 8:1)
    img = img.resize((1024, 128), Image.LANCZOS)
    # Soft tileable mirror at the seam: blend left 32px with reverse-right 32px
    mirror = img.transpose(Image.FLIP_LEFT_RIGHT)
    edge = 32
    for i in range(edge):
        # Linear blend from 0 (rightmost) to 1 (32px in)
        a = i / edge
        for y in range(128):
            r = img.getpixel((1023 - i, y))
            m = mirror.getpixel((1023 - i, y))
            img.putpixel((1023 - i, y), (
                int(r[0] * a + m[0] * (1 - a)),
                int(r[1] * a + m[1] * (1 - a)),
                int(r[2] * a + m[2] * (1 - a)),
            ))
    # Slight brightness lift + saturation boost for cyberpunk feel
    img = ImageEnhance.Brightness(img).enhance(1.10)
    img = ImageEnhance.Color(img).enhance(1.25)
    return img


def process_aerial(img: Image.Image) -> Image.Image:
    """Centre-crop to square, resize to 1024x1024, night-shift in case the
    source was daytime (Tokyo SkyTree day-shot lands as the first reachable
    aerial more often than the night versions). Used as a 0.35-alpha overlay
    on the street plane, so we actively want the highlights to dominate."""
    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    img = img.crop((left, top, left + side, top + side))
    img = img.resize((1024, 1024), Image.LANCZOS)

    # Aggressive night-shift — works on any aerial (daytime or night). The
    # idea is to push the photo toward "city seen from above at night":
    #   1. Lower brightness so the bright sky/clouds don't dominate
    #   2. Cool tint shift toward blue
    #   3. Bump contrast so headlights/lit windows pop above the dark base
    img = ImageEnhance.Brightness(img).enhance(0.32)
    r, g, b = img.split()
    r = r.point(lambda v: int(v * 0.85))
    g = g.point(lambda v: int(v * 0.90))
    b = b.point(lambda v: int(min(v * 1.05 + 8, 255)))
    img = Image.merge("RGB", (r, g, b))
    img = ImageEnhance.Contrast(img).enhance(1.55)
    img = ImageEnhance.Color(img).enhance(1.30)

    # Gentle blur so per-building detail doesn't fight the procedural neon
    # grid sitting on top of it
    img = img.filter(ImageFilter.GaussianBlur(radius=1.2))
    return img


def process_asphalt(img: Image.Image) -> Image.Image:
    """ambientCG _Color.jpg is square + tileable. Just resize to 1024² and
    cool the tint slightly so it reads as wet-cold-tarmac instead of dry
    daylight asphalt."""
    img = img.convert("RGB").resize((1024, 1024), Image.LANCZOS)
    # cool/blue tint + darken — pixel-wise channel arithmetic via numpy would
    # be cleaner but Pillow's per-channel split keeps deps minimal
    r, g, b = img.split()
    r = r.point(lambda v: int(v * 0.75))
    g = g.point(lambda v: int(v * 0.82))
    b = b.point(lambda v: int(min(v * 0.95 + 12, 255)))
    img = Image.merge("RGB", (r, g, b))
    # bump contrast so faint headlight scatter from the overlay photo punches
    img = ImageEnhance.Contrast(img).enhance(1.15)
    return img


def process_facade(img: Image.Image) -> Image.Image:
    """Single skyscraper façade photo for the hero tower.

    Most photogenic skyscraper photos on Commons are DAYTIME shots. Pasting
    them into a night cyberpunk scene produces an obvious "white frame" —
    bright sky, light concrete grout, white exoskeleton — that glows against
    the surrounding dark city. To fix this we run a saturation+luminance
    aware night-shift after cropping:

      1. Trim sky + ground bands (the building usually lives in the middle
         vertical band of the source photo).
      2. Centre-crop to 1:4 portrait (256×1024).
      3. HSV-aware tone map: pixels with LOW saturation AND HIGH lightness
         (sky, white concrete, exoskeleton) get crushed toward black; SATURATED
         pixels (lit glass, signs) stay roughly intact so they still read as
         "lit windows at night".
      4. Cool blue tint + contrast bump on what survives.
    """
    w, h = img.size
    # Trim sky + ground bands. Calibrated against Cocoon Tower / Shin Kong
    # sample photos — common tower-in-landscape shots sit in the 12%..82%
    # vertical range. Trimmed even tighter (10%/85%) for daytime photos so
    # less sky survives the night-shift.
    top = int(h * 0.10)
    bot = int(h * 0.85)
    img = img.crop((0, top, w, bot))
    w, h = img.size
    target_w = max(1, h // 4)
    if w > target_w:
        left = (w - target_w) // 2
        img = img.crop((left, 0, left + target_w, h))
    img = img.resize((256, 1024), Image.LANCZOS)
    img = img.convert("RGB")

    # ---- HSV-aware night-shift v3 ----
    # Daytime photos pasted into a night scene get an obvious "white frame"
    # everywhere the source had bright desaturated pixels (sky, white
    # concrete, exoskeleton, glass reflections). v2's soft curve still let
    # mid-bright pixels through; v3 hardens it:
    #
    #   1. Hard-crush near-white pixels (V > 0.80 AND S < 0.32) to ~3%.
    #      This kills SKY + WHITE CONCRETE + WHITE GLASS REFLECTION outright.
    #   2. For the rest, tighter survival curve: v_new = v × (0.04 + 0.46×keep).
    #      Max survival ~50% (down from 80%) so even saturated pixels read
    #      darker than the source.
    #   3. Absolute lightness ceiling: clamp final v to 0.45. No pixel in
    #      the texture is allowed brighter than 45% of pure white.
    #
    # Net result: a daytime photo becomes a properly dark night-tower face
    # where ONLY the small lit-window spots punch through, and even those
    # cap at 45% so emissive boost doesn't blow them out.
    hsv = img.convert("HSV")
    h_ch, s_ch, v_ch = hsv.split()
    import numpy as np  # Pillow already pulls numpy via its deps
    s = np.asarray(s_ch, dtype=np.float32) / 255.0
    v = np.asarray(v_ch, dtype=np.float32) / 255.0
    # 1) Near-white hard-crush mask
    white_mask = (v > 0.80) & (s < 0.32)
    # 2) Soft survival curve for the rest
    sky_mask = (1.0 - s) * v
    keep = 1.0 - np.clip(sky_mask * 1.8 - 0.05, 0.0, 1.0)
    v_new = v * (0.04 + 0.46 * keep)
    # 3) Hard-crush wins where it applies
    v_new = np.where(white_mask, 0.03, v_new)
    # 4) Absolute ceiling
    v_new = np.clip(v_new, 0.0, 0.45)
    v_new = np.clip(v_new * 255.0, 0, 255).astype(np.uint8)
    hsv = Image.merge("HSV", (h_ch, s_ch, Image.fromarray(v_new, mode="L")))
    img = hsv.convert("RGB")

    # Cool tint + contrast on the surviving pixels
    r, g, b = img.split()
    r = r.point(lambda v: int(v * 0.78))
    g = g.point(lambda v: int(v * 0.88))
    b = b.point(lambda v: int(min(v * 1.10 + 6, 255)))
    img = Image.merge("RGB", (r, g, b))
    img = ImageEnhance.Contrast(img).enhance(1.35)
    img = ImageEnhance.Color(img).enhance(1.25)
    return img


def process_concrete(img: Image.Image) -> Image.Image:
    """Concrete for the elevated rail beam + pylons. Slightly darker + cool
    tint so it doesn't pop against the dark city. Keep some structure
    contrast so the beam reads as a real cast-concrete surface, not flat."""
    img = img.convert("RGB").resize((1024, 1024), Image.LANCZOS)
    r, g, b = img.split()
    r = r.point(lambda v: int(v * 0.52))
    g = g.point(lambda v: int(v * 0.58))
    b = b.point(lambda v: int(min(v * 0.70 + 6, 255)))
    img = Image.merge("RGB", (r, g, b))
    img = ImageEnhance.Contrast(img).enhance(1.25)
    return img


def fetch_ambientcg(candidates: list[str], out_path: Path,
                    process: callable) -> bool:
    """Generic ambientCG fetcher: try each candidate .zip, extract the
    *_Color.jpg (or largest .jpg), post-process, save."""
    if out_path.exists():
        print(f"  ✓ {out_path.name} already cached")
        return True
    for asset_zip in candidates:
        print(f"  trying ambientCG {asset_zip} …")
        url = f"https://ambientcg.com/get?file={urllib.parse.quote(asset_zip)}"
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                buf = r.read()
        except Exception as e:
            print(f"    download error: {e}", file=sys.stderr)
            continue
        if len(buf) < 50_000:
            # ambientCG occasionally returns an HTML error page (small body)
            print(f"    too small ({len(buf)}B) — probably an error page; trying next",
                  file=sys.stderr)
            continue
        try:
            with zipfile.ZipFile(BytesIO(buf)) as z:
                color_name = None
                for n in z.namelist():
                    nl = n.lower()
                    if nl.endswith(".jpg") and "color" in nl:
                        color_name = n
                        break
                if color_name is None:
                    # fall back to any large jpg in the archive
                    candidates = [n for n in z.namelist()
                                  if n.lower().endswith(".jpg")]
                    if not candidates:
                        print("    no .jpg in archive", file=sys.stderr)
                        continue
                    color_name = max(candidates,
                                     key=lambda n: z.getinfo(n).file_size)
                with z.open(color_name) as f:
                    img = Image.open(BytesIO(f.read()))
        except Exception as e:
            print(f"    zip/decode error: {e}", file=sys.stderr)
            continue
        try:
            out = process(img)
        except Exception as e:
            print(f"    process failed: {e}", file=sys.stderr)
            continue
        out.save(out_path, quality=82, optimize=True)
        size_kb = out_path.stat().st_size / 1024
        print(f"  ✓ {out_path.name} {out.size[0]}x{out.size[1]} ({size_kb:.0f} KB)")
        time.sleep(0.3)
        return True
    print(f"  ✗ {out_path.name}: ambientCG candidates exhausted (procedural fallback in city.ts)")
    return False


def fetch_one(candidates: list[str], out_path: Path,
              process: callable) -> bool:
    if out_path.exists():
        print(f"  ✓ {out_path.name} already cached")
        return True
    for name in candidates:
        print(f"  trying {name} …")
        url = resolve_commons_url(name)
        if not url:
            continue
        img = download_image(url)
        if img is None:
            continue
        try:
            out = process(img)
        except Exception as e:
            print(f"    process failed: {e}", file=sys.stderr)
            continue
        out.save(out_path, quality=86, optimize=True)
        size_kb = out_path.stat().st_size / 1024
        print(f"  ✓ {out_path.name} {out.size[0]}x{out.size[1]} ({size_kb:.0f} KB)")
        # Tiny politeness delay between fetches
        time.sleep(0.3)
        return True
    print(f"  ✗ {out_path.name}: all candidates failed (procedural fallback in city.ts will kick in)")
    return False


def main() -> int:
    print(f"[streetlive] output dir: {OUT_DIR}")
    ok_train = fetch_one(
        TRAIN_CANDIDATES,
        OUT_DIR / "train_livery_a.jpg",
        process_train,
    )
    # LED billboard photo — kept under the OLD filename so the existing
    # city.ts loader at the LED façade block doesn't have to change.
    ok_billboard = fetch_one(
        BILLBOARD_CANDIDATES,
        OUT_DIR / "city_aerial_night.jpg",
        process_aerial,
    )
    # W5b fix: dedicated street-overlay aerial — top-down candidate list,
    # separate filename so it can coexist with the billboard photo.
    ok_overlay = fetch_one(
        AERIAL_CANDIDATES,
        OUT_DIR / "street_overlay_night.jpg",
        process_aerial,
    )
    # W5b fix: ambientCG wet asphalt as the street plane base layer
    ok_asphalt = fetch_ambientcg(
        ASPHALT_CANDIDATES,
        OUT_DIR / "asphalt_wet_diff.jpg",
        process_asphalt,
    )
    # W5b-rails: second train livery for Rail B (variety vs the Maglev on Rail A)
    ok_train_b = fetch_one(
        TRAIN_B_CANDIDATES,
        OUT_DIR / "train_livery_b.jpg",
        process_train,
    )
    # W5b-rails: ambientCG concrete for the rail beam + pylon shafts
    ok_concrete = fetch_ambientcg(
        CONCRETE_CANDIDATES,
        OUT_DIR / "concrete_diff.jpg",
        process_concrete,
    )
    # W5b-hero-tower: one real cyberpunk skyscraper façade photo
    ok_facade = fetch_one(
        CYBERPUNK_FACADE_CANDIDATES,
        OUT_DIR / "cyberpunk_facade_a.jpg",
        process_facade,
    )
    # Second hero tower — Shin Kong Life Tower (Taipei) per user reference 2026-06-15
    ok_facade_b = fetch_one(
        CYBERPUNK_FACADE_B_CANDIDATES,
        OUT_DIR / "cyberpunk_facade_b.jpg",
        process_facade,
    )
    # Third hero tower / channel — Petronas / Burj Khalifa / Shard for the
    # holographic billboard channel-cycle playlist (W5b-holo direction B).
    ok_facade_c = fetch_one(
        CYBERPUNK_FACADE_C_CANDIDATES,
        OUT_DIR / "cyberpunk_facade_c.jpg",
        process_facade,
    )
    print(
        f"[streetlive] done: train={ok_train} billboard={ok_billboard} "
        f"overlay={ok_overlay} asphalt={ok_asphalt} "
        f"train_b={ok_train_b} concrete={ok_concrete} "
        f"facade_a={ok_facade} facade_b={ok_facade_b} facade_c={ok_facade_c}"
    )
    # Always exit 0 — fail-soft so CI/build doesn't choke
    return 0


if __name__ == "__main__":
    sys.exit(main())
