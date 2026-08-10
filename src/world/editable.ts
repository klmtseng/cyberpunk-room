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
 * - Duplicate ID registration throws immediately (except in PROD builds).
 * - Orphaned overrides (ids not in registry) are surfaced, never silently
 *   ignored.
 * - No try/catch error-swallowing, no || true, no 2>/dev/null.
 */

import * as THREE from 'three';

// ── Module-level registry ────────────────────────────────────────────────────

const _registry = new Map<string, THREE.Object3D>();

/** Clear the registry. Call once at the start of buildRoom(). */
export function resetEditableRegistry(): void {
  _registry.clear();
}

/**
 * Register a scene object under a stable semantic ID.
 * Sets obj.userData.editorId = id and stores obj in the registry.
 * Returns obj for chaining.
 *
 * Guard 1 (duplicate ID): throws if the same id is registered twice,
 * except in PROD builds (import.meta.env.PROD === true). In Node headless
 * environments import.meta.env is undefined, so the guard is active there too
 * — which is exactly what we want for the gate.
 */
export function registerEditable(obj: THREE.Object3D, id: string): THREE.Object3D {
  if ((import.meta as any).env?.PROD !== true) {
    if (_registry.has(id)) {
      throw new Error(
        `duplicate editor id "${id}" — each editable must have a unique semantic ID`,
      );
    }
  }
  obj.userData.editorId = id;
  _registry.set(id, obj);
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
 * Throws on malformed field shapes. Never silently ignores errors.
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

  const applied: string[] = [];
  const orphaned: string[] = [];

  for (const [id, entry] of Object.entries(doc.overrides)) {
    const obj = _registry.get(id);
    if (!obj) {
      orphaned.push(id);
      continue;
    }

    if (entry.position !== undefined) {
      const [x, y, z] = assertVec3(entry.position, `${id}.position`);
      obj.position.set(x, y, z);
    }
    if (entry.rotation !== undefined) {
      const [x, y, z] = assertVec3(entry.rotation, `${id}.rotation`);
      obj.rotation.set(x, y, z);
    }
    if (entry.scale !== undefined) {
      const [x, y, z] = assertVec3(entry.scale, `${id}.scale`);
      obj.scale.set(x, y, z);
    }

    obj.updateMatrixWorld(true);
    applied.push(id);
  }

  return { applied, orphaned };
}
