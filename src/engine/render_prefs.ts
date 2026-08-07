// Persistent user preferences for optional rendering features.
// Both are default-off so performance-sensitive users (the reason these exist)
// pay zero cost at first load. See main.ts for the API surface that saves/applies.

export type TonemapMode = 'aces' | 'agx';

export interface RenderPrefs {
  heightFog: boolean;
  tonemap: TonemapMode;
}

export const DEFAULT_PREFS: RenderPrefs = { heightFog: false, tonemap: 'aces' };

const STORAGE_KEY = 'neonloft.render';

function isTonemapMode(v: unknown): v is TonemapMode {
  return v === 'aces' || v === 'agx';
}

/**
 * Load persisted prefs from localStorage, then let URL params override them.
 * URL override is intentionally NOT written back to storage (mirrors the
 * ?preset= / #preset URL convention in quality.ts / main.ts).
 *
 * @param search - Injectable for testing in Node where `location` is absent.
 *                 Defaults to `location.search` in a real browser.
 */
export function loadPrefs(search?: string): RenderPrefs {
  // Start from defaults; merge in stored values field-by-field so partial or
  // corrupt JSON still yields a fully-valid prefs object.
  let heightFog = DEFAULT_PREFS.heightFog;
  let tonemap: TonemapMode = DEFAULT_PREFS.tonemap;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === 'object') {
        const p = parsed as Record<string, unknown>;
        if (typeof p.heightFog === 'boolean') heightFog = p.heightFog;
        if (isTonemapMode(p.tonemap)) tonemap = p.tonemap;
      }
    }
  } catch {
    // localStorage unavailable (private mode) or JSON corrupt — stay at defaults.
  }

  // URL params override storage; not written back.
  const params = new URLSearchParams(search ?? (typeof location !== 'undefined' ? location.search : ''));
  const fogParam = params.get('fog');
  if (fogParam === '1') heightFog = true;
  else if (fogParam === '0') heightFog = false;
  const tmParam = params.get('tonemap');
  if (isTonemapMode(tmParam)) tonemap = tmParam as TonemapMode;

  return { heightFog, tonemap };
}

export function savePrefs(p: RenderPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // Private-mode or storage quota — silently ignore.
  }
}
