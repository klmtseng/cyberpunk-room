# Third-Party Assets

A complete record of every external asset bundled in this project, the
source it came from, the date it was fetched, and the license under which
it was distributed at that time.

CC0 / public-domain assets do not *legally* require attribution. We still
record them here as a paper-trail in case the licensing of an upstream
source is ever questioned. Screenshots of license pages are kept under
`docs/asset-licenses/` when relevant.

## Polyhaven (CC0 1.0 Universal)

Polyhaven's policy: <https://polyhaven.com/license>
> "Everything on this site is licensed as CC0, which is effectively public
> domain.  You can use it for any purpose, including commercial use."

| Asset | Files | Fetched | URL |
|---|---|---|---|
| `leather_white` | `public/assets/textures/sofa/leather_white_diff_1k.jpg` (+ `nor_gl`, `rough`) | 2026-06-15 | <https://polyhaven.com/a/leather_white> |
| `sofa_02` (Victorian tufted leather) | `public/assets/models/polyhaven/sofa_02/sofa_02_1k.gltf` + .bin + 5 textures | 2026-06-15 | <https://polyhaven.com/a/sofa_02> |
| `Ottoman_01` (black leather pouf) | `public/assets/models/polyhaven/Ottoman_01/Ottoman_01_1k.gltf` + .bin + 3 textures | 2026-06-15 | <https://polyhaven.com/a/Ottoman_01> |
| `ArmChair_01` (Victorian armchair) | `public/assets/models/polyhaven/ArmChair_01/ArmChair_01_1k.gltf` + .bin + 3 textures | 2026-06-15 | <https://polyhaven.com/a/ArmChair_01> |

## Wikimedia Commons (CC-BY / CC-BY-SA / public domain)

Photos fetched by `tools/streetlive/fetch_textures.py`. Each file is
post-processed (cropped + night-shifted) before bundling. The script
queries Wikimedia's `imageinfo` API to follow the canonical file URL on
`upload.wikimedia.org`.

| Asset (in repo) | Source file on Commons | Fetched | Licence at time of fetch |
|---|---|---|---|
| `public/assets/textures/street_live/cyberpunk_facade_a.jpg` | `Mode Gakuen Cocoon Tower in the evening with blue sky Tokyo Japan.jpg` | 2026-06-15 | CC-BY-SA 4.0 |
| `public/assets/textures/street_live/cyberpunk_facade_b.jpg` | `Taipei Taiwan Shin-Kong-Tower-03.jpg` | 2026-06-15 | CC-BY-SA 3.0 |
| `public/assets/textures/street_live/cyberpunk_facade_c.jpg` | `Petronas Towers at Night - from the base upwards.jpg` | 2026-06-15 | CC-BY-SA 4.0 |
| `public/assets/textures/street_live/train_livery_a.jpg` | `Seoul-metro-510-Banghwa-station-platform-20180914-173620.jpg` | 2026-06-15 | CC-BY-SA 4.0 |
| `public/assets/textures/street_live/train_livery_b.jpg` | `Tokyo Monorail 10000 2015-04.jpg` | 2026-06-15 | CC-BY-SA 4.0 |
| `public/assets/textures/street_live/city_aerial_night.jpg` (LED billboards) | `Shibuya_Crossing_at_night.jpg` | 2026-06-15 | CC-BY-SA 4.0 |
| `public/assets/textures/street_live/street_overlay_night.jpg` (street ground overlay) | `Drone shot with Tokyo Skytree in the distance at night.jpg` | 2026-06-15 | CC-BY-SA 4.0 |

Photographer credits and exact licence stamps are preserved on each
Commons file's description page (linked via `File:<name>` on
<https://commons.wikimedia.org>). When deploying publicly the project
must remain CC-BY-SA compatible or replace these assets.

## ambientCG (CC0 1.0 Universal)

ambientCG's policy: <https://ambientcg.com/list?category=&type=PhotoTexturePBR>
> "Everything on this site is licensed under CC0 1.0 Universal."

| Asset | Files | Fetched | Source pack |
|---|---|---|---|
| Wet asphalt diffuse | `public/assets/textures/street_live/asphalt_wet_diff.jpg` | 2026-06-15 | `Asphalt026A_1K-JPG.zip` |
| Concrete diffuse (rail beam + pylons) | `public/assets/textures/street_live/concrete_diff.jpg` | 2026-06-15 | `Concrete034_1K-JPG.zip` |

## The Metropolitan Museum of Art (Open Access — CC0)

The Met's Open Access program releases >470,000 images under CC0:
<https://www.metmuseum.org/about-the-met/policies-and-documents/open-access>

| Asset | Files | Fetched | URL |
|---|---|---|---|
| Various artworks (Hokusai, Hiroshige, Klimt, Van Gogh, Monet, Cezanne search results) | `public/assets/textures/mosaic_art/met-*.png` | 2026-06-12 | <https://collectionapi.metmuseum.org> (live search API; images are CC0 only when the `isPublicDomain` flag is true on the object record) |
| Rotating gallery frames (paintings cycling on wall art) | runtime fetch in `props.ts` | continuous | same API as above |

## Project Gutenberg (Public Domain)

Project Gutenberg releases pre-1928 US public-domain books. The in-game
library reader (`/__book` proxy) streams chapters from these IDs:

| IDs | Where |
|---|---|
| 24264 / 23950 / 23962 / 23863 / 132 / 84 / 35 / 164 / 345 / 174 / 1661 / 2554 / 1184 / 2701 / 1342 / 996 / 1727 / 2680 | hardcoded in `src/lib/books.ts` |

## Google News RSS (third-party content, fair-use snippets)

The smart mirror's news ticker fetches Google News RSS via `/__news`
proxy. Headlines are short snippets and are used for atmospheric flavour
only, not stored. No commercial republication of the underlying news
articles is performed.

## Open-Meteo (CC-BY 4.0)

Smart mirror weather pulled from <https://open-meteo.com/>. Free for
commercial use; attribution required if data is redistributed in
processed form. We display the data live and do not redistribute.

## GeoJS (free IP geolocation)

Smart mirror uses <https://get.geojs.io/> for IP-based location lookup.
No API key required; service is free for personal and commercial use.

## YouTube via yt-dlp (DEV-ONLY)

`/__resolve` and `/__stream` in `vite.config.ts` use yt-dlp to fetch
YouTube progressive streams. **Dev-only**: these endpoints are not
deployed to Vercel (see project memory). Any production deploy must
direct users to a YouTube-compliant embed if YouTube content is needed.

## Internal assets (created in this project — copyright belongs to project owner)

These are listed for completeness but are not third-party.

- `public/assets/textures/lantern_mosaic*.png` — procedurally generated by `tools/lantern/build_mosaic.py`
- `public/assets/textures/desk_lantern_mosaic*.png` — extracted from project owner's own photos
- `public/assets/textures/mosaic_art/cat-*.png`, `abs-*.png` — procedurally generated by `tools/mosaic/build_art_cache.py`
- `public/assets/models/bar_lantern.glb`, `desk_lantern.glb` — Blender CLI builds (`tools/lantern/`)
- `public/assets/textures/backdrop/*` — AI panoramas generated to project owner's prompt per `docs/ASSET_REQUESTS.md`
- All in-code procedural textures in `src/world/room.ts` (`makeConcreteTexture`, `makeWallPanelTexture`, `makeBrushedMetalTexture`, etc.) — original code, no external source

## Excluded from this repository (gitignored, not redistributed)

- `public/assets/video/hoload_*.mp4` — CD Projekt Red Cyberpunk 2077 in-universe holo-ads. Used **locally only** during development to test the holo-TV cast pipeline; never committed, never deployed.
- `public/assets/music/viola/*` — project owner's family recordings.
