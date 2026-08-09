/**
 * check_wall_clip.mjs — deterministic placement gate.
 *
 * Builds the real room+props scene graph headless (no GPU, no browser),
 * runs placement_audit.ts, and exits:
 *   0  = PASS (zero issues and zero non-whitelisted invisible-named meshes)
 *   1  = FAIL (one or more placement issues or suspicious invisible meshes)
 *
 * Usage (from project root):
 *   node --experimental-strip-types \
 *        --loader tools/gate/ts-loader.mjs \
 *        --import tools/gate/headless-globals.mjs \
 *        tools/gate/check_wall_clip.mjs
 *
 * Or via:  npm run gate
 *
 * S6: This script MUST NOT use  2>/dev/null  or  || true  — any internal
 * error must propagate and cause a non-zero exit, not be swallowed.
 */

import * as THREE from 'three';
import { buildRoom }          from '../../src/world/room.ts';
import { buildProps }         from '../../src/world/props.ts';
import { runPlacementAudit, formatAuditReport } from '../../src/dev/placement_audit.ts';
import { ROOM_BOUNDS }        from '../../src/world/room.ts';

// ── Minimal fake EngineCtx (no GPU needed) ───────────────────────────────────

const scene = new THREE.Scene();

const fakeCtx = {
  renderer: {
    capabilities: {
      isWebGL2: true,
      maxTextureSize: 4096,
      getMaxAnisotropy: () => 16,
    },
    getPixelRatio:    () => 1,
    setPixelRatio:    () => {},
    setSize:          () => {},
    setAnimationLoop: () => {},
    shadowMap:        { enabled: false, type: THREE.PCFSoftShadowMap },
    outputColorSpace: THREE.SRGBColorSpace,
    toneMapping:      THREE.NoToneMapping,
    toneMappingExposure: 1,
    compile:          () => {},
    extensions:       { get: () => null },
    info:             { render: { triangles: 0 } },
  },
  scene,
  camera:   new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 100),
  composer: null,
  clock:    new THREE.Clock(),
  settings: {
    preset:           'high',
    pixelRatio:       1,
    enableShadows:    false,
    enableBloom:      false,
    enableSSAO:       false,
    enableHeightFog:  false,
    ssaoRadius:       0,
    ssaoIntensity:    0,
    bloomStrength:    0,
    bloomRadius:      0,
    bloomThreshold:   0,
  },
  applyQuality:    () => {},
  setBloomExposure:() => {},
  setHeightFog:    () => {},
  setTonemap:      () => {},
};

// ── Build scene ───────────────────────────────────────────────────────────────

console.log('check_wall_clip: building headless scene…');

const room  = buildRoom(fakeCtx);
const props = buildProps(fakeCtx);

// ── Run audit ─────────────────────────────────────────────────────────────────
// Pass groups as an array — avoids re-parenting them which would detach them
// from their current parent in THREE.js.

const result = runPlacementAudit([room.group, props.group]);
const report = formatAuditReport(result);

console.log('');
console.log(report);
console.log('');

// ── Tally ─────────────────────────────────────────────────────────────────────

const wallIssues   = result.issues.filter(i => i.kind === 'IN-WALL').length;
const floorIssues  = result.issues.filter(i => i.kind === 'BELOW-FLOOR').length;
const overlapIssues= result.issues.filter(i => i.kind === 'OVERLAP').length;
const invisFail    = result.skipped.filter(s => s.reason === 'invisible').length;

const totalFails = result.issues.length + invisFail;

// ── Verdict ───────────────────────────────────────────────────────────────────

if (totalFails === 0) {
  console.log(
    `GATE check_wall_clip: PASS ` +
    `(0 issues; ${result.skipped.length} skipped meshes all accounted for)`
  );
  process.exit(0);
} else {
  const parts = [];
  if (wallIssues)    parts.push(`${wallIssues} IN-WALL`);
  if (floorIssues)   parts.push(`${floorIssues} BELOW-FLOOR`);
  if (overlapIssues) parts.push(`${overlapIssues} OVERLAP`);
  if (invisFail)     parts.push(`${invisFail} INVISIBLE-NAMED (not in whitelist)`);

  console.log(
    `GATE check_wall_clip: FAIL (${totalFails} issue(s): ${parts.join(', ')})`
  );
  process.exit(1);
}
