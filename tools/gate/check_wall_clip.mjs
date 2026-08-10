/**
 * check_wall_clip.mjs — deterministic placement gate.
 *
 * Builds the real room+props scene graph headless (no GPU, no browser), takes a
 * census of every mesh whose world AABB intersects a wall slab, and compares
 * that census against the checked-in baseline in tools/gate/wall_baseline.json.
 *
 *   0  = PASS (census matches baseline; no placement issues)
 *   1  = FAIL (a mesh entered a wall, went deeper, or another check tripped)
 *
 * WHY A BASELINE AND NOT A GEOMETRIC THRESHOLD
 * --------------------------------------------
 * Measured on the known-bad commit 4e9a4dd: the buried monitors penetrate the
 * right wall by 0.075–0.219 world units, while legitimate architecture (wall
 * panels, floor risers, skirting) penetrates by up to 0.725. The buried props
 * are SHALLOWER than the legal geometry, so no depth threshold separates them.
 * Penetration fraction fails the same way: walls sit at frac=1.000 and window
 * mullions at frac=1.542, overlapping the buried props' 0.81–2.0.
 * The only signal that separates the 12 offending sub-meshes is "these are new
 * relative to a known-good scene", which is what the baseline encodes.
 *
 * NO DEFAULT EXEMPTIONS
 * ---------------------
 * Every wall-touching mesh is either reported as an issue or matched to an
 * explicitly enumerated baseline/whitelist entry. There is no "unnamed geometry
 * is probably structural" shortcut — that was the bug this rewrite removes.
 *
 * Usage (from project root):  npm run gate
 * Regenerate baseline:        npm run gate:baseline -- --i-am-changing-the-baseline
 *
 * This script MUST NOT use  2>/dev/null  or  || true  — any internal error must
 * propagate and cause a non-zero exit, not be swallowed.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildHeadlessScene } from './scene.mjs';
import { runPlacementAudit, formatAuditReport } from '../../src/dev/placement_audit.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = join(HERE, 'wall_baseline.json');

// ── Load baseline ────────────────────────────────────────────────────────────
// A missing or empty baseline is a hard failure, not a free pass: an absent
// baseline would otherwise make every wall-touching mesh "new" or, worse, make
// a naive implementation exempt everything.

if (!existsSync(BASELINE_PATH)) {
  console.error(`GATE check_wall_clip: FAIL — baseline missing at ${BASELINE_PATH}`);
  console.error('Generate it with: npm run gate:baseline -- --i-am-changing-the-baseline');
  process.exit(1);
}

const baselineDoc = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
const baseline = baselineDoc.entries;

if (!Array.isArray(baseline) || baseline.length === 0) {
  console.error('GATE check_wall_clip: FAIL — baseline has no entries.');
  process.exit(1);
}
if (baselineDoc.entryCount !== baseline.length) {
  console.error(
    `GATE check_wall_clip: FAIL — baseline entryCount=${baselineDoc.entryCount} ` +
    `disagrees with entries.length=${baseline.length}.`,
  );
  process.exit(1);
}

// ── Build scene and audit ────────────────────────────────────────────────────

console.log('check_wall_clip: building headless scene…');
console.log(`check_wall_clip: baseline ${BASELINE_PATH} (${baseline.length} entries)`);

const { roots, overrides } = buildHeadlessScene();

const result = runPlacementAudit(roots, baseline);
const report = formatAuditReport(result);

console.log('');
console.log(report);
console.log('');

// ── Tally ────────────────────────────────────────────────────────────────────

const tally = (kind) => result.issues.filter((i) => i.kind === kind).length;

const wallNew     = tally('WALL-NEW');
const wallDeeper  = tally('WALL-DEEPER');
const inWall      = tally('IN-WALL');
const floorIssues = tally('BELOW-FLOOR');
const overlaps    = tally('OVERLAP');

// Baseline entries that matched nothing mean the scene changed under the
// baseline's feet. That is not automatically a bug, but it must not be silent:
// it is the signal that the baseline is stale and hiding real coverage loss.
const staleBaseline = result.baselineUnused.length;

// Meshes we could not test geometrically must also count — an untestable mesh
// is not a passing mesh.
const untestable = result.skipped.filter((s) => s.reason === 'infinite-bounds').length;

// Orphaned overrides: ids in overrides.json that have no matching registered
// entity. Each is an ORPHAN-OVERRIDE issue — the editor pipeline is broken.
const orphanedOverrides = overrides.orphaned;
if (orphanedOverrides.length > 0) {
  for (const id of orphanedOverrides) {
    console.error(
      `ORPHAN-OVERRIDE: id "${id}" is in overrides.json but was not found in the scene registry`,
    );
  }
}

const totalFails = result.issues.length + staleBaseline + untestable + orphanedOverrides.length;

// ── Coverage summary line (overrides) ────────────────────────────────────────

console.log(
  `overrides applied=${overrides.applied.length} orphaned=${orphanedOverrides.length}`,
);

// ── Verdict ──────────────────────────────────────────────────────────────────

if (totalFails === 0) {
  console.log(
    `GATE check_wall_clip: PASS ` +
    `(${result.meshesSeen} meshes checked, ${result.wallTouching} wall-touching, ` +
    `${result.baselineMatched} matched to ${baseline.length} baseline + ` +
    `${result.whitelistSize} whitelist entries, 0 issues)`,
  );
  process.exit(0);
} else {
  const parts = [];
  if (wallNew)                    parts.push(`${wallNew} WALL-NEW`);
  if (wallDeeper)                 parts.push(`${wallDeeper} WALL-DEEPER`);
  if (inWall)                     parts.push(`${inWall} IN-WALL`);
  if (floorIssues)                parts.push(`${floorIssues} BELOW-FLOOR`);
  if (overlaps)                   parts.push(`${overlaps} OVERLAP`);
  if (staleBaseline)              parts.push(`${staleBaseline} BASELINE-UNUSED`);
  if (untestable)                 parts.push(`${untestable} UNTESTABLE`);
  if (orphanedOverrides.length)   parts.push(`${orphanedOverrides.length} ORPHAN-OVERRIDE`);

  console.log(
    `GATE check_wall_clip: FAIL (${totalFails} issue(s): ${parts.join(', ')})`,
  );
  process.exit(1);
}
