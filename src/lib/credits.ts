/**
 * In-app Credits / attribution panel for NEON LOFT.
 *
 * Satisfies the CC-BY-SA attribution requirement for the bundled Wikimedia
 * Commons photos (see THIRD_PARTY_ASSETS.md §Wikimedia Commons) and surfaces
 * the real titles/artists of the Met open-access artworks (whose bundled
 * filenames are internal codenames, not the artists).
 *
 * Data below is transcribed verbatim from THIRD_PARTY_ASSETS.md (Commons
 * source filenames + licences) and public/assets/textures/mosaic_art/
 * manifest.json (Met labels). Do not edit here without updating those sources.
 */
import { t } from './i18n';

// ── Wikimedia Commons photos — verbatim from THIRD_PARTY_ASSETS.md:34-40 ──
const WIKIMEDIA_PHOTOS: { repo: string; commons: string; licence: string }[] = [
  { repo: 'cyberpunk_facade_a.jpg', commons: 'Mode Gakuen Cocoon Tower in the evening with blue sky Tokyo Japan.jpg', licence: 'CC-BY-SA 4.0' },
  { repo: 'cyberpunk_facade_b.jpg', commons: 'Taipei Taiwan Shin-Kong-Tower-03.jpg', licence: 'CC-BY-SA 3.0' },
  { repo: 'cyberpunk_facade_c.jpg', commons: 'Petronas Towers at Night - from the base upwards.jpg', licence: 'CC-BY-SA 4.0' },
  { repo: 'train_livery_a.jpg', commons: 'Seoul-metro-510-Banghwa-station-platform-20180914-173620.jpg', licence: 'CC-BY-SA 4.0' },
  { repo: 'train_livery_b.jpg', commons: 'Tokyo Monorail 10000 2015-04.jpg', licence: 'CC-BY-SA 4.0' },
  { repo: 'city_aerial_night.jpg', commons: 'Shibuya_Crossing_at_night.jpg', licence: 'CC-BY-SA 4.0' },
  { repo: 'street_overlay_night.jpg', commons: 'Drone shot with Tokyo Skytree in the distance at night.jpg', licence: 'CC-BY-SA 4.0' },
];

// ── Wikimedia Commons video clips — verbatim from THIRD_PARTY_ASSETS.md:56-58 ──
const WIKIMEDIA_VIDEOS: { commons: string; licence: string }[] = [
  { commons: 'First nights in Tokyo.webm', licence: 'CC-BY 3.0' },
  { commons: 'Cars driving at night.webm', licence: 'CC-BY 3.0' },
  { commons: 'Igniting the Booster Space Launch System - NASA.webm', licence: 'NASA — public domain (U.S. Government work)' },
];

// ── CC0 model/texture sources — from THIRD_PARTY_ASSETS.md §Polyhaven / §ambientCG ──
const CC0_SOURCES: { name: string; url: string }[] = [
  { name: 'Polyhaven — leather_white, sofa_02, Ottoman_01, ArmChair_01', url: 'https://polyhaven.com/license' },
  { name: 'ambientCG — Asphalt026A, Concrete034', url: 'https://ambientcg.com/' },
];

// ── Met open-access artworks — real title + artist, from manifest.json ──
// The bundled filename (met-*.png) is an internal codename, NOT the artist.
const MET_WORKS: { filename: string; work: string }[] = [
  { filename: 'met-hokusai.webp', work: 'Ten Verses on Oxherding' },
  { filename: 'met-hiroshige.webp', work: 'Dwarf (one of a pair) — Villeroy' },
  { filename: 'met-vangogh.webp', work: 'The Outer Harbor of Brest — Henri Joseph van Blarenberghe' },
  { filename: 'met-monet.webp', work: 'The Forest in Winter at Sunset — Théodore Rousseau' },
  { filename: 'met-klimt.webp', work: 'The Jabach Family — Charles Le Brun' },
  { filename: 'met-cezanne.webp', work: 'The Nativity with Donors and Saints Jerome and Leonard — Gerard David' },
];

const COMMONS_FILE = 'https://commons.wikimedia.org/wiki/File:';
function commonsUrl(file: string): string {
  // Commons file pages use underscores for spaces.
  return COMMONS_FILE + encodeURIComponent(file.replace(/ /g, '_'));
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let overlay: HTMLElement | null = null;

function buildOverlay(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'credits-overlay';
  el.style.cssText =
    'position:fixed;inset:0;z-index:40;display:none;'
    + 'background:rgba(2,4,12,0.9);pointer-events:auto;'
    + 'overflow-y:auto;padding:5vh 4vw;box-sizing:border-box;'
    + 'font-family:"Rajdhani","Share Tech Mono",system-ui,sans-serif;'
    + 'color:#c8f2ff;';

  const wikiRows = WIKIMEDIA_PHOTOS.map(p =>
    `<li><a href="${commonsUrl(p.commons)}" target="_blank" rel="noopener noreferrer"`
    + ` style="color:#5af2ff;text-decoration:none;border-bottom:1px dotted #5af2ff66;">`
    + `${esc(p.commons)}</a> <span style="color:#ff2bdb;">${esc(p.licence)}</span></li>`
  ).join('');

  const videoRows = WIKIMEDIA_VIDEOS.map(v =>
    `<li><a href="${commonsUrl(v.commons)}" target="_blank" rel="noopener noreferrer"`
    + ` style="color:#5af2ff;text-decoration:none;border-bottom:1px dotted #5af2ff66;">`
    + `${esc(v.commons)}</a> <span style="color:#ff2bdb;">${esc(v.licence)}</span></li>`
  ).join('');

  const cc0Rows = CC0_SOURCES.map(s =>
    `<li><a href="${s.url}" target="_blank" rel="noopener noreferrer"`
    + ` style="color:#5af2ff;text-decoration:none;border-bottom:1px dotted #5af2ff66;">`
    + `${esc(s.name)}</a></li>`
  ).join('');

  const metRows = MET_WORKS.map(m =>
    `<tr><td style="padding:2px 12px 2px 0;color:#5af2ff99;white-space:nowrap;">${esc(m.filename)}</td>`
    + `<td style="padding:2px 0;">${esc(m.work)}</td></tr>`
  ).join('');

  el.innerHTML =
    `<div style="max-width:820px;margin:0 auto;">`
    + `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:16px;margin-bottom:6px;">`
    + `<h1 style="font-family:'Orbitron',monospace;font-size:22px;letter-spacing:.12em;`
    + `color:#ff2bdb;text-shadow:0 0 12px #ff2bdb88;margin:0;">${esc(t('credits.title'))}</h1>`
    + `<button id="credits-close" style="font-family:'Share Tech Mono',monospace;font-size:12px;`
    + `color:#5af2ff;background:rgba(0,0,0,0.55);border:1px solid #5af2ff66;padding:5px 11px;`
    + `cursor:pointer;letter-spacing:.08em;white-space:nowrap;">${esc(t('credits.close'))}</button>`
    + `</div>`
    + `<p style="opacity:.85;font-size:14px;line-height:1.5;">${esc(t('credits.intro'))}</p>`

    // Wikimedia photos (CC-BY-SA) — the load-bearing section for P1-1
    + `<h2 style="font-family:'Share Tech Mono',monospace;font-size:15px;color:#5af2ff;`
    + `border-bottom:1px solid #5af2ff33;padding-bottom:4px;margin-top:22px;letter-spacing:.06em;">`
    + `${esc(t('credits.sec.wikimedia'))}</h2>`
    + `<p style="opacity:.7;font-size:12.5px;line-height:1.5;margin:6px 0;">${esc(t('credits.sec.wikimedia.note'))}</p>`
    + `<ul style="list-style:none;padding:0;font-size:13px;line-height:1.9;">${wikiRows}</ul>`

    // Wikimedia videos
    + `<h2 style="font-family:'Share Tech Mono',monospace;font-size:15px;color:#5af2ff;`
    + `border-bottom:1px solid #5af2ff33;padding-bottom:4px;margin-top:22px;letter-spacing:.06em;">`
    + `${esc(t('credits.sec.video'))}</h2>`
    + `<ul style="list-style:none;padding:0;font-size:13px;line-height:1.9;">${videoRows}</ul>`

    // Met open-access (real titles/artists) — the load-bearing section for P1-2
    + `<h2 style="font-family:'Share Tech Mono',monospace;font-size:15px;color:#5af2ff;`
    + `border-bottom:1px solid #5af2ff33;padding-bottom:4px;margin-top:22px;letter-spacing:.06em;">`
    + `${esc(t('credits.sec.met'))}</h2>`
    + `<p style="opacity:.7;font-size:12.5px;line-height:1.5;margin:6px 0;">${esc(t('credits.sec.met.note'))}</p>`
    + `<table style="font-size:13px;border-collapse:collapse;line-height:1.6;">`
    + `<thead><tr style="color:#5af2ff99;text-align:left;">`
    + `<th style="padding:2px 12px 2px 0;font-weight:600;">${esc(t('credits.met.filename'))}</th>`
    + `<th style="padding:2px 0;font-weight:600;">${esc(t('credits.met.work'))}</th></tr></thead>`
    + `<tbody>${metRows}</tbody></table>`

    // CC0 sources
    + `<h2 style="font-family:'Share Tech Mono',monospace;font-size:15px;color:#5af2ff;`
    + `border-bottom:1px solid #5af2ff33;padding-bottom:4px;margin-top:22px;letter-spacing:.06em;">`
    + `${esc(t('credits.sec.cc0'))}</h2>`
    + `<p style="opacity:.7;font-size:12.5px;line-height:1.5;margin:6px 0;">${esc(t('credits.sec.cc0.note'))}</p>`
    + `<ul style="list-style:none;padding:0;font-size:13px;line-height:1.9;">${cc0Rows}</ul>`

    // full manifest pointer
    + `<p style="opacity:.7;font-size:12.5px;line-height:1.5;margin-top:22px;">${esc(t('credits.full'))}</p>`
    + `</div>`;

  return el;
}

function openPanel(): void {
  // Release pointer lock so the mouse can click links / close button.
  if (document.pointerLockElement) document.exitPointerLock();
  if (!overlay) {
    overlay = buildOverlay();
    document.body.appendChild(overlay);
    overlay.querySelector('#credits-close')?.addEventListener('click', closePanel);
  }
  overlay.style.display = 'block';
  overlay.scrollTop = 0;
}

function closePanel(): void {
  if (overlay) overlay.style.display = 'none';
}

/** Mount the Credits button in the HUD, next to the language toggle. */
export function mountCredits(): void {
  const btn = document.createElement('button');
  btn.id = 'credits-toggle';
  btn.textContent = t('credits.btn');
  // Placed to the left of the lang toggle (which sits at right:12px).
  btn.style.cssText =
    'position:fixed;top:12px;right:56px;z-index:30;'
    + 'font-family:"Share Tech Mono",monospace;font-size:12px;'
    + 'color:#5af2ff;background:rgba(0,0,0,0.55);'
    + 'border:1px solid #5af2ff66;padding:4px 9px;cursor:pointer;'
    + 'letter-spacing:.08em;pointer-events:auto;'
    + 'transition:background .2s;';
  btn.onmouseenter = () => { btn.style.background = 'rgba(90,242,255,0.18)'; };
  btn.onmouseleave = () => { btn.style.background = 'rgba(0,0,0,0.55)'; };
  btn.onclick = openPanel;
  document.body.appendChild(btn);

  // ESC closes the panel when it is open (capture so it beats other handlers).
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay && overlay.style.display === 'block') {
      e.stopPropagation();
      closePanel();
    }
  }, true);
}
