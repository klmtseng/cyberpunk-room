/**
 * editable.ts — stable semantic entity ID system + overrides pipeline.
 *
 * Provides a module-level registry of named scene objects (editables) and
 * a shared applyOverrides() function that both src/main.ts (runtime) and
 * tools/gate/scene.mjs (headless gate) call through the same code path.
 *
 * Design constraints:
 * - IDs are human-written semantic strings, never derived from build order,
 *   array index, position, or THREE.Object3D.id.
 * - Duplicate ID registration throws immediately in all environments (dev,
 *   headless Node gate, and PROD). Silently accepting duplicates in PROD is
 *   the worst possible outcome: a copy-paste error where a developer forgets
 *   to change the ID would result in last-write-wins with no warning.
 * - Orphaned overrides (ids not in registry) are surfaced, never silently
 *   ignored.
 * - No try/catch error-swallowing, no || true, no 2>/dev/null.
 */

import * as THREE from 'three';

// ── Module-level registry ────────────────────────────────────────────────────

const _registry = new Map<string, THREE.Object3D>();

// Authored (pre-override) transforms, snapshotted at registration time.
// Values are plain number arrays (copies), not THREE objects.
interface AuthoredTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}
const _authored = new Map<string, AuthoredTransform>();

/** Clear the registry. Call once at the start of buildRoom(). */
export function resetEditableRegistry(): void {
  _registry.clear();
  _authored.clear();
}

/**
 * Register a scene object under a stable semantic ID.
 * Sets obj.userData.editorId = id and stores obj in the registry.
 * Returns obj for chaining.
 *
 * IMPORTANT: Call this AFTER the object's authored transform (position,
 * rotation, scale) has been fully set up. The function snapshots the
 * current transform as the "authored" baseline at registration time.
 * If you call this before setting position/rotation/scale the snapshot
 * will capture the wrong values.
 *
 * Guard: throws if the same id is registered twice in ANY environment
 * (dev, Node headless gate, and PROD). Duplicate IDs most commonly arise
 * when a developer copies a furniture code block and forgets to change the
 * ID; silently overwriting in PROD is the worst possible result because
 * one object becomes permanently uncontrollable without any error signal.
 */
export function registerEditable(obj: THREE.Object3D, id: string): THREE.Object3D {
  if (_registry.has(id)) {
    throw new Error(
      `duplicate editor id "${id}" — each editable must have a unique semantic ID`,
    );
  }
  obj.userData.editorId = id;
  _registry.set(id, obj);

  // Snapshot the authored transform as plain arrays (copies, not references).
  // Callers mutating these arrays will not affect the registry.
  _authored.set(id, {
    position: [obj.position.x, obj.position.y, obj.position.z],
    rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
    scale:    [obj.scale.x,    obj.scale.y,    obj.scale.z],
  });

  return obj;
}

/** Look up a registered object by its semantic ID. */
export function getEditable(id: string): THREE.Object3D | undefined {
  return _registry.get(id);
}

/** List all registered semantic IDs. */
export function listEditableIds(): string[] {
  return Array.from(_registry.keys());
}

/**
 * Return the authored (pre-override) transform that was snapshotted when
 * the object was registered.  The returned object is a plain-value copy;
 * mutating it has no effect on the registry.
 *
 * Returns undefined for unknown ids (does not throw).
 */
export function getAuthoredTransform(id: string): AuthoredTransform | undefined {
  const t = _authored.get(id);
  if (!t) return undefined;
  // Return a fresh copy so the caller cannot mutate our stored snapshot.
  return {
    position: [...t.position] as [number, number, number],
    rotation: [...t.rotation] as [number, number, number],
    scale:    [...t.scale]    as [number, number, number],
  };
}

// ── Override shape ───────────────────────────────────────────────────────────

interface OverrideEntry {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
}

interface OverridesDoc {
  version: 1;
  overrides: Record<string, OverrideEntry>;
}

// Allowed keys on an override entry.
const ALLOWED_ENTRY_KEYS = new Set(['position', 'rotation', 'scale']);

/**
 * Validate and coerce a value claimed to be a [number, number, number] tuple.
 *
 * Throws a descriptive error that includes the id and field name on failure.
 * Checks performed:
 *   - Must be an Array of length 3
 *   - Every element must be typeof 'number'
 *   - Every element must be Number.isFinite  (rejects Infinity, -Infinity, NaN;
 *     note: 1e999 is Infinity in JavaScript and would otherwise slip through)
 * For scale: callers additionally check > 0 after calling this.
 */
function assertVec3(val: unknown, label: string): [number, number, number] {
  if (
    !Array.isArray(val) ||
    val.length !== 3 ||
    typeof val[0] !== 'number' ||
    typeof val[1] !== 'number' ||
    typeof val[2] !== 'number'
  ) {
    throw new Error(
      `applyOverrides: "${label}" must be an array of exactly 3 numbers, got: ${JSON.stringify(val)}`,
    );
  }
  if (!Number.isFinite(val[0]) || !Number.isFinite(val[1]) || !Number.isFinite(val[2])) {
    throw new Error(
      `applyOverrides: "${label}" contains a non-finite value (Infinity or NaN), got: [${val[0]}, ${val[1]}, ${val[2]}]`,
    );
  }
  return val as [number, number, number];
}

/**
 * Apply overrides from a parsed JSON document to the registered objects.
 *
 * Accepts shape: { version: 1, overrides: { [id]: { position?, rotation?, scale? } } }
 *
 * Returns { applied, orphaned }:
 *   applied  — ids that were found in the registry and updated
 *   orphaned — ids in the override doc that had no matching registry entry
 *
 * Throws on any malformed entry shape. Never silently ignores errors.
 *
 * Two-phase execution:
 *   Phase 1 (validation): iterate the full document without touching the scene.
 *   Phase 2 (apply):      only runs if phase 1 passes entirely.
 *
 * Scope of the atomicity guarantee, stated precisely because the earlier wording
 * ("the scene is guaranteed to be unchanged") claimed more than the code does:
 * a phase-1 rejection leaves the scene untouched, which is the case this design
 * exists for — one bad entry cannot half-apply a document. Phase 2 has no
 * rollback. It only performs copy/set on already-validated finite numbers, so
 * there is no known way for it to throw partway; but if it ever did, entries
 * applied before the throw would stay applied.
 */
export function applyOverrides(data: unknown): { applied: string[]; orphaned: string[] } {
  const doc = data as OverridesDoc;
  if (!doc || typeof doc !== 'object') {
    throw new Error('applyOverrides: data must be an object');
  }
  if (doc.version !== 1) {
    throw new Error(`applyOverrides: unsupported version ${(doc as any).version}`);
  }
  if (!doc.overrides || typeof doc.overrides !== 'object') {
    throw new Error('applyOverrides: missing "overrides" object');
  }

  // ── Phase 1: validate the entire document without touching the scene ─────

  // Pre-coerce all valid entries so phase 2 never re-validates.
  interface CoercedEntry {
    id: string;
    obj: THREE.Object3D;
    position?: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number];
  }
  const coerced: CoercedEntry[] = [];
  const orphaned: string[] = [];

  for (const [id, entry] of Object.entries(doc.overrides)) {
    const obj = _registry.get(id);
    if (!obj) {
      orphaned.push(id);
      continue;
    }

    // entry must be a plain object (not null, not an array, not a primitive)
    if (
      entry === null ||
      typeof entry !== 'object' ||
      Array.isArray(entry)
    ) {
      throw new Error(
        `applyOverrides: entry for id "${id}" must be a plain object, got: ${JSON.stringify(entry)}`,
      );
    }

    // Check for unknown keys
    for (const key of Object.keys(entry)) {
      if (!ALLOWED_ENTRY_KEYS.has(key)) {
        throw new Error(
          `applyOverrides: entry for id "${id}" contains unknown key "${key}" — only "position", "rotation", "scale" are allowed`,
        );
      }
    }

    // Entry must specify at least one of position/rotation/scale
    if (
      (entry as any).position === undefined &&
      (entry as any).rotation === undefined &&
      (entry as any).scale === undefined
    ) {
      throw new Error(
        `applyOverrides: entry for id "${id}" must specify at least one of "position", "rotation", "scale"`,
      );
    }

    const c: CoercedEntry = { id, obj };

    if ((entry as any).position !== undefined) {
      c.position = assertVec3((entry as any).position, `${id}.position`);
    }
    if ((entry as any).rotation !== undefined) {
      c.rotation = assertVec3((entry as any).rotation, `${id}.rotation`);
    }
    if ((entry as any).scale !== undefined) {
      const [sx, sy, sz] = assertVec3((entry as any).scale, `${id}.scale`);
      // Scale components must be > 0.
      // Zero collapses geometry to a plane/line/point; negative values flip the
      // winding order of triangles, which inverts surface normals and breaks
      // standard lighting (faces appear dark or invisible from the "correct" side).
      if (sx <= 0 || sy <= 0 || sz <= 0) {
        throw new Error(
          `applyOverrides: "${id}.scale" components must all be > 0, got: [${sx}, ${sy}, ${sz}]`,
        );
      }
      c.scale = [sx, sy, sz];
    }

    coerced.push(c);
  }

  // ── Phase 2: apply — only reached if phase 1 completed without throwing ──

  const applied: string[] = [];

  for (const c of coerced) {
    if (c.position !== undefined) {
      c.obj.position.set(...c.position);
    }
    if (c.rotation !== undefined) {
      c.obj.rotation.set(...c.rotation);
    }
    if (c.scale !== undefined) {
      c.obj.scale.set(...c.scale);
    }
    c.obj.updateMatrixWorld(true);
    applied.push(c.id);
  }

  return { applied, orphaned };
}
