/**
 * override_merge.ts — Pure function for computing the new overrides document.
 *
 * Accepts the existing overrides record, the list of editable IDs to walk,
 * and two query callbacks (current transform, authored transform).
 * Returns the new overrides record.
 *
 * No DOM, fetch, or editor-closure dependencies — safe for headless testing.
 */

export interface OverrideEntry {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
}

export interface ObjectTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

/** Round to 6 decimal places (mirrors the editor's r6 helper). */
function r6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/** True when two vec3 tuples are within 1e-6 of each other on every axis. */
function vec3Near(a: [number, number, number], b: [number, number, number]): boolean {
  return Math.abs(a[0] - b[0]) < 1e-6 &&
         Math.abs(a[1] - b[1]) < 1e-6 &&
         Math.abs(a[2] - b[2]) < 1e-6;
}

/**
 * Compute the new overrides record by walking every registered editable id.
 *
 * Rules:
 *  - Orphan entries in `existing` (ids not in `editableIds`) are preserved as-is.
 *  - For each id in `editableIds`:
 *    - If `getAuthoredTransform(id)` returns undefined, the id is skipped
 *      (caller should warn; existing override for that id, if any, is preserved).
 *    - If the current transform differs from authored on any axis, the entry is
 *      written (only the fields that differ are included).
 *    - If the current transform matches authored on all axes, the entry is
 *      removed (keeps the file clean).
 *
 * @param existing           The current overrides record (merged base).
 * @param editableIds        Ids to walk (from listEditableIds()).
 * @param getCurrentTransform  Callback: given an id, return current transform or undefined.
 * @param getAuthoredTransform Callback: given an id, return authored transform or undefined.
 * @returns New overrides record.
 */
export function computeOverrides(
  existing: Record<string, OverrideEntry>,
  editableIds: string[],
  getCurrentTransform: (id: string) => ObjectTransform | undefined,
  getAuthoredTransform: (id: string) => ObjectTransform | undefined,
): Record<string, OverrideEntry> {
  // Start from a shallow copy so orphan entries are preserved by default.
  const merged: Record<string, OverrideEntry> = { ...existing };

  for (const id of editableIds) {
    const authored = getAuthoredTransform(id);
    if (authored === undefined) {
      // Skip this id; preserve any existing override for it.
      continue;
    }

    const current = getCurrentTransform(id);
    if (current === undefined) {
      // Object not in scene; preserve any existing override.
      continue;
    }

    const pos: [number, number, number] = [r6(current.position[0]), r6(current.position[1]), r6(current.position[2])];
    const rot: [number, number, number] = [r6(current.rotation[0]), r6(current.rotation[1]), r6(current.rotation[2])];
    const scl: [number, number, number] = [r6(current.scale[0]),    r6(current.scale[1]),    r6(current.scale[2])];

    const entry: OverrideEntry = {};
    if (!vec3Near(pos, authored.position)) entry.position = pos;
    if (!vec3Near(rot, authored.rotation)) entry.rotation = rot;
    if (!vec3Near(scl, authored.scale))    entry.scale    = scl;

    if (Object.keys(entry).length > 0) {
      merged[id] = entry;
    } else {
      // All fields match authored → remove the override (keep file clean).
      delete merged[id];
    }
  }

  return merged;
}
