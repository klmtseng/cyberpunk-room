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

// ─── Types ───────────────────────────────────────────────────────────────────

export type IssueKind = 'IN-WALL' | 'BELOW-FLOOR' | 'OVERLAP';

export interface AuditIssue {
  kind: IssueKind;
  name: string;
  detail: string;
}

export interface SkippedMesh {
  reason: 'invisible' | 'infinite-bounds';
  name: string;
}

export interface AuditResult {
  issues: AuditIssue[];
  skipped: SkippedMesh[];
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
export function runPlacementAudit(root: THREE.Object3D | THREE.Object3D[]): AuditResult {
  const roots = Array.isArray(root) ? root : [root];
  const issues: AuditIssue[] = [];
  const skipped: SkippedMesh[] = [];

  const meshes: Array<{ m: THREE.Mesh; box: THREE.Box3; vol: number }> = [];

  for (const r of roots) r.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;

    const label =
      mesh.name ||
      `${mesh.geometry?.type ?? 'Mesh'}@${mesh.position.toArray().map((v) => v.toFixed(2)).join(',')}`;

    // S5: invisible meshes are NOT silently skipped — they are collected.
    // Only NAMED meshes can hide a mis-placed prop; unnamed structural geometry
    // is legitimately hidden (beam, projector cone, etc.) and not checked.
    if (!mesh.visible) {
      if (mesh.name && !WHITELIST.has(mesh.name)) {
        // Non-whitelisted invisible named mesh → FAIL signal.
        skipped.push({ reason: 'invisible', name: mesh.name });
      }
      return;
    }

    const box = new THREE.Box3().setFromObject(mesh);
    if (!isFinite(box.min.x)) {
      // S5: infinite-bounds meshes also collected, not silently dropped.
      skipped.push({ reason: 'infinite-bounds', name: label });
      return;
    }

    const s = new THREE.Vector3();
    box.getSize(s);
    meshes.push({ m: mesh, box, vol: s.x * s.y * s.z });
  });

  // ── IN-WALL check (named meshes only) ────────────────────────────────────
  // Named meshes are user-placed props. Unnamed geometry is structural (wall
  // panels, floor tiles, etc.) and is expected to be inside slabs by design.
  for (const { m, box } of meshes) {
    if (!m.name) continue;          // skip structural/unnamed geometry
    if (WHITELIST.has(m.name)) continue;
    const c = new THREE.Vector3();
    box.getCenter(c);
    for (const slab of WALL_SLABS) {
      if (slab.containsPoint(c)) {
        issues.push({
          kind: 'IN-WALL',
          name: m.name,
          detail: c.toArray().map((v) => v.toFixed(2)).join(','),
        });
        break; // report once per mesh even if it hits two slabs
      }
    }
  }

  // ── BELOW-FLOOR check (named meshes only) ────────────────────────────────
  for (const { m, box } of meshes) {
    if (!m.name) continue;          // skip structural/unnamed geometry
    if (WHITELIST.has(m.name)) continue;
    if (box.min.y < -0.03 && box.min.y > -3) {
      issues.push({
        kind: 'BELOW-FLOOR',
        name: m.name,
        detail: `minY=${box.min.y.toFixed(3)}`,
      });
    }
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

  return { issues, skipped };
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

  // S5: always report skipped counts
  const invisibleSkipped = skipped.filter((s) => s.reason === 'invisible');
  const infiniteSkipped  = skipped.filter((s) => s.reason === 'infinite-bounds');
  lines.push('');
  lines.push(
    `Skipped: ${invisibleSkipped.length} invisible, ${infiniteSkipped.length} infinite-bounds` +
    ` (whitelist entries: ${WHITELIST.size})`,
  );
  if (invisibleSkipped.length > 0) {
    for (const s of invisibleSkipped) {
      lines.push(`  [SKIPPED-INVISIBLE] ${s.name}`);
    }
  }

  return lines.join('\n');
}
