/**
 * placement_audit.ts — pure-logic placement checker.
 *
 * Extracted from main.ts so it can run both:
 *   (a) In-browser via `window.neon.audit()` (main.ts imports this).
 *   (b) Headless in Node via tools/gate/check_wall_clip.mjs.
 *
 * NO renderer, NO EngineCtx, NO DOM — only THREE.js math.
 */

import * as THREE from 'three';
import { ROOM_BOUNDS } from '../world/room';
// The single checked-in wall census. Imported (not read from disk) so the
// browser build and the headless gate share one source of truth.
// The `with { type: 'json' }` attribute is required by Node's ESM loader (the
// headless gate runs this file directly); Vite and tsc accept it too.
import WALL_BASELINE from '../../tools/gate/wall_baseline.json' with { type: 'json' };

// ─── Wall slabs derived from room dimensions (no magic numbers) ─────────────
// Room: x ∈ [-W/2, W/2], z ∈ [-D/2, D/2].
// Wall thickness is 0.25 (half = 0.125), centred on the boundary plane.
const HALF_W = ROOM_BOUNDS.w / 2;   // 6
const HALF_D = ROOM_BOUNDS.d / 2;   // 7
const WALL_T = 0.125;               // half-thickness of each slab

export const WALL_SLABS: THREE.Box3[] = [
  // Left wall  (x ≈ -6)
  new THREE.Box3(
    new THREE.Vector3(-HALF_W - WALL_T, -1, -HALF_D - WALL_T),
    new THREE.Vector3(-HALF_W + WALL_T,  7,  HALF_D + WALL_T),
  ),
  // Right wall (x ≈ +6)
  new THREE.Box3(
    new THREE.Vector3( HALF_W - WALL_T, -1, -HALF_D - WALL_T),
    new THREE.Vector3( HALF_W + WALL_T,  7,  HALF_D + WALL_T),
  ),
  // Back wall  (z ≈ -7)
  new THREE.Box3(
    new THREE.Vector3(-HALF_W - WALL_T, -1, -HALF_D - WALL_T),
    new THREE.Vector3( HALF_W + WALL_T,  7, -HALF_D + WALL_T),
  ),
  // Front wall (z ≈ +7)
  new THREE.Box3(
    new THREE.Vector3(-HALF_W - WALL_T, -1,  HALF_D - WALL_T),
    new THREE.Vector3( HALF_W + WALL_T,  7,  HALF_D + WALL_T),
  ),
];

// The outer skin of the room: the interior plus the wall slabs themselves, and
// the floor-to-ceiling span. Anything an editor-movable entity does INSIDE this
// box is somebody else's check (wall census, below-floor, overlap); anything
// that leaves it is out of the building.
//
// Why this exists: the wall census only fires on meshes that *intersect* a wall
// slab, and the below-floor check only fires between -0.03 and -3. Both are
// scope conditions that were correct for authored geometry, which never moves.
// Once an editor can write arbitrary transforms, they leave a hole the size of
// the rest of the universe — a prop pushed clean through a wall, dropped 50
// units down, or parked 20 units behind the room touches no slab and is below
// the floor check's lower bound, so every check declines jurisdiction and the
// gate reports ALL CLEAR. Reproduced at 6 positions before this was added.
export const ROOM_ENVELOPE = new THREE.Box3(
  new THREE.Vector3(-HALF_W - WALL_T, -0.05, -HALF_D - WALL_T),
  new THREE.Vector3( HALF_W + WALL_T, ROOM_BOUNDS.h,  HALF_D + WALL_T),
);

// ─── Types ───────────────────────────────────────────────────────────────────

export type IssueKind =
  | 'IN-WALL'
  | 'BELOW-FLOOR'
  | 'OVERLAP'
  | 'WALL-NEW'      // intersects a wall slab but has no baseline entry
  | 'WALL-DEEPER'   // has a baseline entry, but penetrates deeper than recorded
  | 'OUT-OF-ROOM';  // an editor-movable entity left the room envelope entirely

export interface AuditIssue {
  kind: IssueKind;
  name: string;
  detail: string;
}

export interface SkippedMesh {
  reason: 'invisible' | 'infinite-bounds';
  name: string;
}

// ─── Wall-intersection census ────────────────────────────────────────────────
// Every mesh whose world AABB intersects a wall slab produces exactly one
// census row. There is NO default exemption: a row is either matched against a
// checked-in baseline entry or reported as an issue.

/** Inner faces of the four walls, and which direction counts as "into the wall". */
export const WALL_FACES = [
  { face: 'left',  axis: 'x' as const, inner: -HALF_W + WALL_T, sign: -1 },
  { face: 'right', axis: 'x' as const, inner:  HALF_W - WALL_T, sign:  1 },
  { face: 'back',  axis: 'z' as const, inner: -HALF_D + WALL_T, sign: -1 },
  { face: 'front', axis: 'z' as const, inner:  HALF_D - WALL_T, sign:  1 },
];

export interface CensusRow {
  /** Stable identity key: geometry type + quantised world centre + world size. */
  key: string;
  /** Deepest penetration past any wall inner face, in world units. */
  depth: number;
  /** Which wall face that deepest penetration is measured against. */
  face: string;
  /** mesh.name, or '(anon)' — informational only, never used for exemption. */
  name: string;
}

export interface BaselineEntry {
  key: string;
  depth: number;
  face: string;
  name: string;
  /** Human-readable justification; required for every baseline row. */
  why: string;
}

export interface AuditResult {
  issues: AuditIssue[];
  skipped: SkippedMesh[];
  /** Total meshes traversed (all meshes, wall-touching or not). */
  meshesSeen: number;
  /** Meshes whose AABB intersects at least one wall slab. */
  wallTouching: number;
  /** Wall-touching meshes matched to a baseline entry. */
  baselineMatched: number;
  /** Number of entries in the baseline that was supplied. */
  baselineSize: number;
  /** Number of exact-match whitelist entries. */
  whitelistSize: number;
  /**
   * Editor ids whose subtree was found in the scene and tested against
   * ROOM_ENVELOPE. Printed so an empty set (= containment check silently
   * covering nothing) is visible rather than looking like a clean pass.
   */
  editablesChecked: string[];
  /** Baseline entries that matched nothing this run (scene shrank / drifted). */
  baselineUnused: string[];
  /** The census actually computed — used by the baseline regeneration tool. */
  census: CensusRow[];
}

// ─── Whitelist ────────────────────────────────────────────────────────────────
// Meshes intentionally placed inside or overlapping walls (architecture, glass
// panes, sub-geometry that forms part of a wall panel).
// RULE: exact string match only — no includes/startsWith/regex.
// Every entry must have a one-line comment explaining why it's intentional.

const WHITELIST = new Set<string>([
  // WindowGlass: the large mullioned window plane sits flush with the front
  // wall (+z face) — its centre is in the front-wall slab by design.
  'WindowGlass',
  // ShelfTrayProxy: bounding-box proxy used for interaction raycasting;
  // embedded in the bookshelf body which itself touches the right wall.
  'ShelfTrayProxy',
  // ShardTrayArt / ShardTrayAudio: invisible interaction-raycast proxies that
  // deliberately overlap the Bookshelf body — they are the clickable hitboxes
  // for the shard shelf built into the right-wall bookcase.
  'ShardTrayArt',
  'ShardTrayAudio',
  // Package: decorative parcel near the front door; starts invisible and
  // appears during specific game events — intentionally hidden at boot.
  'Package',
]);

// ─── Core audit ──────────────────────────────────────────────────────────────

/**
 * Run the placement audit over one or more scene roots.
 *
 * Accepts either a single Object3D or an array of Object3D roots so that
 * callers can pass multiple groups without re-parenting them (re-parenting
 * removes them from their existing parent in THREE.js, which would break the
 * live scene).
 */
/** Quantise a number to 3 decimals so float jitter does not churn the baseline. */
function q(v: number): string {
  // Normalise -0 to 0 so the key text is stable across sign-preserving maths.
  const r = Number(v.toFixed(3));
  return (Object.is(r, -0) ? 0 : r).toFixed(3);
}

/**
 * Identity key for a wall-touching mesh.
 *
 * Deliberately built from geometry type + world-space centre + world-space size
 * rather than mesh.name: the scene has 14k lines of imperative geometry and most
 * meshes are anonymous, so a name-based key would exempt almost everything.
 * Verified collision-free on both known-good (75/75) and known-bad (87/87).
 */
export function censusKey(geoType: string, c: THREE.Vector3, s: THREE.Vector3): string {
  return `${geoType}|${q(c.x)},${q(c.y)},${q(c.z)}|${q(s.x)},${q(s.y)},${q(s.z)}`;
}

/** Depth tolerance (world units) before an existing row counts as WALL-DEEPER. */
export const DEPTH_TOLERANCE = 0.005;

/**
 * Run the placement audit.
 *
 * `baseline` defaults to the checked-in census so that the in-browser caller
 * (window.neon.audit) and the headless gate apply exactly the same rules. The
 * gate passes it explicitly after validating the file's self-consistency.
 */
export function runPlacementAudit(
  root: THREE.Object3D | THREE.Object3D[],
  baseline: BaselineEntry[] = WALL_BASELINE.entries as BaselineEntry[],
): AuditResult {
  const roots = Array.isArray(root) ? root : [root];
  const issues: AuditIssue[] = [];
  const skipped: SkippedMesh[] = [];

  const meshes: Array<{ m: THREE.Mesh; box: THREE.Box3; vol: number }> = [];
  let meshesSeen = 0;

  // Editable subtrees, accumulated as a union AABB per editor id. Read from
  // userData.editorId (set by registerEditable) rather than importing the
  // registry, so this module stays pure THREE math with no world/ dependency.
  const editableBoxes = new Map<string, THREE.Box3>();
  const ownerEditableId = (o: THREE.Object3D): string | null => {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) {
      const id = p.userData?.editorId;
      if (typeof id === 'string') return id;
    }
    return null;
  };

  for (const r of roots) r.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshesSeen++;

    const label =
      mesh.name ||
      `${mesh.geometry?.type ?? 'Mesh'}@${mesh.position.toArray().map((v) => v.toFixed(2)).join(',')}`;

    // Invisible meshes are NOT skipped for the wall census — hiding a prop must
    // not silence the gate (that was a known forgery path). They are recorded
    // here only so the report can show the count, and they still fall through
    // to the census below.
    if (!mesh.visible) {
      skipped.push({ reason: 'invisible', name: label });
    }

    const box = new THREE.Box3().setFromObject(mesh);
    if (!isFinite(box.min.x)) {
      // Infinite/empty bounds cannot be tested geometrically; collected and
      // reported, never silently dropped.
      skipped.push({ reason: 'infinite-bounds', name: label });
      return;
    }

    const s = new THREE.Vector3();
    box.getSize(s);
    meshes.push({ m: mesh, box, vol: s.x * s.y * s.z });

    const owner = ownerEditableId(mesh);
    if (owner) {
      const acc = editableBoxes.get(owner);
      if (acc) acc.union(box);
      else editableBoxes.set(owner, box.clone());
    }
  });

  // ── Wall census: every wall-touching mesh is accounted for ────────────────
  const census: CensusRow[] = [];
  for (const { m, box } of meshes) {
    // Scope condition, not an exemption: a mesh that touches no wall slab is
    // out of this check's subject matter. It is still counted in `meshesSeen`,
    // and (meshesSeen - wallTouching) is printed, so nothing vanishes silently.
    if (!WALL_SLABS.some((slab) => box.intersectsBox(slab))) continue;

    // Deepest penetration past any inner face.
    let best = { depth: 0, face: '' };
    for (const f of WALL_FACES) {
      const lo = f.axis === 'x' ? box.min.x : box.min.z;
      const hi = f.axis === 'x' ? box.max.x : box.max.z;
      const depth = f.sign > 0 ? hi - f.inner : f.inner - lo;
      if (depth > best.depth) best = { depth, face: f.face };
    }

    const c = new THREE.Vector3(); box.getCenter(c);
    const s = new THREE.Vector3(); box.getSize(s);
    census.push({
      key: censusKey(m.geometry?.type ?? 'Mesh', c, s),
      depth: best.depth,
      face: best.face,
      name: m.name || '(anon)',
    });
  }

  // ── Match census against baseline ────────────────────────────────────────
  const byKey = new Map<string, BaselineEntry>();
  for (const e of baseline) byKey.set(e.key, e);
  const usedKeys = new Set<string>();
  let baselineMatched = 0;

  for (const row of census) {
    // A name on the exact-match whitelist is the one hand-maintained exemption
    // route; it is counted and printed, never open-ended.
    // Mark the key used even so: a mesh can be covered by BOTH the whitelist and
    // a baseline row, and failing to mark it would report the baseline row as
    // stale on a scene that never changed.
    if (WHITELIST.has(row.name)) {
      usedKeys.add(row.key);
      baselineMatched++;
      continue;
    }

    const entry = byKey.get(row.key);
    if (!entry) {
      issues.push({
        kind: 'WALL-NEW',
        name: row.name,
        detail: `${row.face} depth=${row.depth.toFixed(3)} key=${row.key}`,
      });
      continue;
    }
    usedKeys.add(row.key);
    baselineMatched++;
    if (row.depth > entry.depth + DEPTH_TOLERANCE) {
      issues.push({
        kind: 'WALL-DEEPER',
        name: row.name,
        detail: `${row.face} depth=${row.depth.toFixed(3)} > baseline ${entry.depth.toFixed(3)}`,
      });
    }
  }

  const baselineUnused = baseline
    .filter((e) => !usedKeys.has(e.key))
    .map((e) => `${e.name} ${e.key}`);

  // ── BELOW-FLOOR check (named meshes only) ────────────────────────────────
  for (const { m, box } of meshes) {
    if (!m.name) continue;          // structural/unnamed geometry: floor check is name-scoped by design
    if (WHITELIST.has(m.name)) continue;
    if (box.min.y < -0.03 && box.min.y > -3) {
      issues.push({
        kind: 'BELOW-FLOOR',
        name: m.name,
        detail: `minY=${box.min.y.toFixed(3)}`,
      });
    }
  }

  // ── OUT-OF-ROOM check (editor-movable entities only) ─────────────────────
  // Scoped to registered editables on purpose: authored geometry legitimately
  // lives outside the room (skyline, exterior signage), and this check must not
  // become a whitelist-farming exercise over static props that cannot move.
  // The subject is exactly the set of things a save can relocate.
  for (const [id, box] of editableBoxes) {
    if (ROOM_ENVELOPE.containsBox(box)) continue;
    const over = (lo: number, hi: number, elo: number, ehi: number) =>
      Math.max(elo - lo, hi - ehi);
    const parts: string[] = [];
    const ex = over(box.min.x, box.max.x, ROOM_ENVELOPE.min.x, ROOM_ENVELOPE.max.x);
    const ey = over(box.min.y, box.max.y, ROOM_ENVELOPE.min.y, ROOM_ENVELOPE.max.y);
    const ez = over(box.min.z, box.max.z, ROOM_ENVELOPE.min.z, ROOM_ENVELOPE.max.z);
    if (ex > 0) parts.push(`x by ${ex.toFixed(3)}`);
    if (ey > 0) parts.push(`y by ${ey.toFixed(3)}`);
    if (ez > 0) parts.push(`z by ${ez.toFixed(3)}`);
    issues.push({
      kind: 'OUT-OF-ROOM',
      name: id,
      detail: `outside room envelope: ${parts.join(', ')}`,
    });
  }

  // ── OVERLAP check ────────────────────────────────────────────────────────
  const big = meshes.filter((x) => x.vol > 0.02 && x.m.name && !WHITELIST.has(x.m.name));
  for (let i = 0; i < big.length; i++) {
    for (let j = i + 1; j < big.length; j++) {
      const a = big[i], b = big[j];
      if (a.box.intersectsBox(b.box)) {
        const inter = a.box.clone().intersect(b.box);
        const s = new THREE.Vector3();
        inter.getSize(s);
        const overlap = s.x * s.y * s.z;
        if (overlap > 0.25 * Math.min(a.vol, b.vol)) {
          issues.push({
            kind: 'OVERLAP',
            name: `${a.m.name} × ${b.m.name}`,
            detail: `${(overlap * 1000).toFixed(0)}L`,
          });
        }
      }
    }
  }

  return {
    issues,
    skipped,
    meshesSeen,
    wallTouching: census.length,
    baselineMatched,
    baselineSize: baseline.length,
    whitelistSize: WHITELIST.size,
    editablesChecked: [...editableBoxes.keys()].sort(),
    baselineUnused,
    census,
  };
}

// ─── Formatter ───────────────────────────────────────────────────────────────

export function formatAuditReport(result: AuditResult): string {
  const { issues, skipped } = result;

  const lines: string[] = [];

  if (issues.length === 0) {
    lines.push('Placement audit: ALL CLEAR');
  } else {
    const tally: Record<string, number> = {};
    for (const i of issues) tally[i.kind] = (tally[i.kind] ?? 0) + 1;
    const summary = Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(' · ');
    lines.push(`Placement audit: ${issues.length} issue(s) — ${summary}`);
    lines.push('');
    for (const i of issues.slice(0, 18)) {
      lines.push(`  [${i.kind}] ${i.name}  ${i.detail}`);
    }
    if (issues.length > 18) {
      lines.push(`  … and ${issues.length - 18} more`);
    }
  }

  // Coverage accounting — every mesh must be reachable in these numbers.
  const invisibleSkipped = skipped.filter((s) => s.reason === 'invisible');
  const infiniteSkipped  = skipped.filter((s) => s.reason === 'infinite-bounds');
  lines.push('');
  lines.push(
    `Coverage: ${result.meshesSeen} meshes traversed · ` +
    `${result.wallTouching} intersect a wall slab · ` +
    `${result.baselineMatched} exempted by baseline/whitelist · ` +
    `${result.issues.filter((i) => i.kind === 'WALL-NEW' || i.kind === 'WALL-DEEPER').length} wall issues`,
  );
  lines.push(
    `Rules: baseline entries=${result.baselineSize} · whitelist entries=${result.whitelistSize} · ` +
    `depth tolerance=${DEPTH_TOLERANCE}`,
  );
  lines.push(
    `Containment: ${result.editablesChecked.length} editable(s) tested against room envelope` +
    (result.editablesChecked.length ? ` [${result.editablesChecked.join(', ')}]` : ' — NONE FOUND'),
  );
  lines.push(
    `Non-geometric: ${invisibleSkipped.length} invisible (still censused), ` +
    `${infiniteSkipped.length} infinite-bounds (cannot be tested)`,
  );
  for (const s of infiniteSkipped) {
    lines.push(`  [INFINITE-BOUNDS] ${s.name}`);
  }
  if (result.baselineUnused.length > 0) {
    lines.push(`Baseline entries unused this run: ${result.baselineUnused.length}`);
    for (const u of result.baselineUnused) lines.push(`  [BASELINE-UNUSED] ${u}`);
  }

  return lines.join('\n');
}
