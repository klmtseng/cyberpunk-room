// Unit tests for the live-vs-reload dispatch logic.
// Run: node --experimental-strip-types src/engine/quality_live.test.ts
// (zero GPU, pure logic — same runner pattern as src/state/room_state.test.ts)
import { settingsFor, needsReload, LIVE_FIELDS } from './quality.ts';

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { pass++; } else { fail++; console.error('  ✗ FAIL:', msg); }
}

// ── (a) only pixelRatio changes → live path ───────────────────────────────
{
  const a = settingsFor('medium');
  const b = { ...a, pixelRatio: 0.75 };
  ok(!needsReload(a, b), '(a) pixelRatio-only change → live (no reload needed)');
  ok(LIVE_FIELDS.includes('pixelRatio'), '(a) pixelRatio is in LIVE_FIELDS');
}

// ── (b) buildingCount changes → reload path ───────────────────────────────
{
  const a = settingsFor('medium');   // buildingCount: 420
  const b = { ...a, buildingCount: 900 };
  ok(needsReload(a, b), '(b) buildingCount change → reload required');
  ok(!LIVE_FIELDS.includes('buildingCount'), '(b) buildingCount is NOT in LIVE_FIELDS');
}

// ── (c) low → ultra (multiple geometry fields) → reload path ────────────
{
  const a = settingsFor('low');
  const b = settingsFor('ultra');
  ok(needsReload(a, b), '(c) low→ultra → reload required');
}

// ── extra: medium → medium, same settings → live (no-op, no reload) ──────
{
  const a = settingsFor('medium');
  const b = settingsFor('medium');
  ok(!needsReload(a, b), 'identical presets → no reload');
}

// ── extra: only enableBloom changes → live ───────────────────────────────
{
  const a = settingsFor('low');
  const b = { ...a, enableBloom: false };
  ok(!needsReload(a, b), 'enableBloom toggle → live');
}

// ── extra: only rainCount changes → reload ───────────────────────────────
{
  const a = settingsFor('high');
  const b = { ...a, rainCount: 1 };
  ok(needsReload(a, b), 'rainCount change → reload');
}

// ── extra: vehicleCount changes → reload ─────────────────────────────────
{
  const a = settingsFor('high');
  const b = { ...a, vehicleCount: 1 };
  ok(needsReload(a, b), 'vehicleCount change → reload');
}

console.log(`\nquality_live test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
