// Headless unit tests for render_prefs.ts.
// Run: node --experimental-strip-types src/engine/render_prefs.test.ts

import { loadPrefs, savePrefs, DEFAULT_PREFS } from './render_prefs.ts';

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { pass++; } else { fail++; console.error('  ✗ FAIL:', msg); }
}

// --- inject a fake localStorage so tests run in Node without the DOM ---
const store: Record<string, string> = {};
let throwOnAccess = false;
const fakeStorage = {
  getItem(k: string): string | null {
    if (throwOnAccess) throw new Error('Private mode — storage denied');
    return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
  },
  setItem(k: string, v: string): void {
    if (throwOnAccess) throw new Error('Private mode — storage denied');
    store[k] = v;
  },
  removeItem(k: string): void {
    delete store[k];
  },
};
(globalThis as any).localStorage = fakeStorage;

const STORAGE_KEY = 'neonloft.render';

function clearStore() {
  delete store[STORAGE_KEY];
  throwOnAccess = false;
}

// 1. No stored value → DEFAULT_PREFS; heightFog must be false, tonemap must be 'aces'.
{
  clearStore();
  const p = loadPrefs('');
  ok(p.heightFog === DEFAULT_PREFS.heightFog, 'default: heightFog === false');
  ok(p.heightFog === false, 'default: heightFog is explicitly false');
  ok(p.tonemap === DEFAULT_PREFS.tonemap, 'default: tonemap === "aces"');
  ok(p.tonemap === 'aces', 'default: tonemap is explicitly "aces"');
}

// 2. localStorage round-trip.
{
  clearStore();
  const saved = { heightFog: true, tonemap: 'agx' as const };
  savePrefs(saved);
  const loaded = loadPrefs('');
  ok(loaded.heightFog === true, 'round-trip: heightFog persists true');
  ok(loaded.tonemap === 'agx', 'round-trip: tonemap persists "agx"');
}

// 3. Corrupt JSON → fall back to defaults, must not throw.
{
  clearStore();
  store[STORAGE_KEY] = '{this is not json}';
  let threw = false;
  let p: ReturnType<typeof loadPrefs> | null = null;
  try { p = loadPrefs(''); } catch { threw = true; }
  ok(!threw, 'corrupt JSON: loadPrefs does not throw');
  ok(p?.heightFog === false, 'corrupt JSON: heightFog defaults to false');
  ok(p?.tonemap === 'aces', 'corrupt JSON: tonemap defaults to "aces"');
}

// 4. Partial JSON {"heightFog":true} — tonemap should be filled from DEFAULT_PREFS.
{
  clearStore();
  store[STORAGE_KEY] = JSON.stringify({ heightFog: true });
  const p = loadPrefs('');
  ok(p.heightFog === true, 'partial JSON: heightFog kept');
  ok(p.tonemap === 'aces', 'partial JSON: tonemap filled from default');
}

// 5. Unknown tonemap string → fall back to 'aces'.
{
  clearStore();
  store[STORAGE_KEY] = JSON.stringify({ heightFog: false, tonemap: 'reinhard' });
  const p = loadPrefs('');
  ok(p.tonemap === 'aces', 'unknown tonemap "reinhard" → "aces"');
}

// 6a. URL ?fog=1 overrides a stored false.
{
  clearStore();
  store[STORAGE_KEY] = JSON.stringify({ heightFog: false, tonemap: 'aces' });
  const p = loadPrefs('?fog=1');
  ok(p.heightFog === true, 'URL ?fog=1 overrides stored false');
  // Must NOT write back to storage
  const raw = store[STORAGE_KEY] ?? '{}';
  const stored = JSON.parse(raw) as Record<string, unknown>;
  ok(stored.heightFog !== true, 'URL ?fog=1 does not write back to localStorage');
}

// 6b. URL ?tonemap=agx overrides stored 'aces'.
{
  clearStore();
  store[STORAGE_KEY] = JSON.stringify({ heightFog: false, tonemap: 'aces' });
  const p = loadPrefs('?tonemap=agx');
  ok(p.tonemap === 'agx', 'URL ?tonemap=agx overrides stored "aces"');
  const raw = store[STORAGE_KEY] ?? '{}';
  const stored = JSON.parse(raw) as Record<string, unknown>;
  ok(stored.tonemap !== 'agx', 'URL ?tonemap=agx does not write back to localStorage');
}

// 7. localStorage throws (simulated private mode) → return DEFAULT_PREFS, no throw.
{
  clearStore();
  throwOnAccess = true;
  let threw = false;
  let p: ReturnType<typeof loadPrefs> | null = null;
  try { p = loadPrefs(''); } catch { threw = true; }
  ok(!threw, 'private mode: loadPrefs does not throw');
  ok(p?.heightFog === false, 'private mode: heightFog defaults to false');
  ok(p?.tonemap === 'aces', 'private mode: tonemap defaults to "aces"');
  throwOnAccess = false;
}

console.log(`render_prefs: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
