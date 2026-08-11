/**
 * editor.ts — DEV-only Blender-style modal transform editor.
 *
 * Entry point: mountEditor(ctx, scene, camera, renderer, controls?)
 * Called from src/main.ts inside `if (import.meta.env.DEV)`.
 *
 * Features:
 *  - Click to select any registered editable entity (walks up parent chain
 *    to find first ancestor with userData.editorId).
 *  - TransformControls gizmo for mouse-drag.
 *  - Blender modal: G/R/S → X/Y/Z → type number → Enter (commit) / Esc (cancel).
 *  - Rotation input in degrees; stored as radians.
 *  - F2 toggles editor on/off; G/R/S/numbers only intercepted while enabled.
 *  - Ctrl+S → POST /__editor/save → gate result shown in HUD.
 *  - Orphaned overrides shown in red.
 *  - Save merges with existing overrides (other entities preserved).
 */

import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { getEditable, listEditableIds, getAuthoredTransform } from '../world/editable';
import type { EngineCtx } from '../engine/renderer';

// ── Types ─────────────────────────────────────────────────────────────────────

type ModalOp = 'grab' | 'rotate' | 'scale';
type AxisLock = 'x' | 'y' | 'z' | null;

interface ModalState {
  active: boolean;
  op: ModalOp | null;
  axis: AxisLock;
  buffer: string;
}

interface TransformSnapshot {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
}

interface OverrideEntry {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
}

interface OverridesDoc {
  version: 1;
  overrides: Record<string, OverrideEntry>;
}

const EPSILON = 1e-5;

function vec3Near(a: [number, number, number], b: [number, number, number]): boolean {
  return Math.abs(a[0] - b[0]) < EPSILON
    && Math.abs(a[1] - b[1]) < EPSILON
    && Math.abs(a[2] - b[2]) < EPSILON;
}

// ── Main mount function ───────────────────────────────────────────────────────

/**
 * Meshes a click is allowed to pick, in the flat form `intersectObjects(list,
 * false)` wants.
 *
 * The visibility filter is load-bearing, not tidiness. `Object3D.traverse`
 * descends into hidden subtrees, and a NON-recursive `intersectObjects` never
 * looks at ancestors — so a mesh whose parent is `visible = false` lands in the
 * list and can win the raycast while being invisible on screen. That is exactly
 * what happened here: BookReader parks a hidden Group on the camera
 * (`player/bookreader.ts:60-61`) holding five visible page/cover meshes half a
 * metre in front of the lens. Every editor click hit a book page nobody could
 * see and reported "not editable"; real mouse selection had never worked, and
 * the existing tests all went through the `__editorSelectById` hook, which
 * bypasses the raycast entirely.
 *
 * Exported so it can be tested headlessly without a DOM.
 */
export function collectSelectableMeshes(
  scene: THREE.Object3D,
  gizmoRoot: THREE.Object3D,
): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (o === gizmoRoot) return;
    if (gizmoRoot.getObjectById(o.id)) return;
    if (!(o as THREE.Mesh).isMesh) return;
    for (let p: THREE.Object3D | null = o; p; p = p.parent) {
      if (!p.visible) return;
    }
    out.push(o);
  });
  return out;
}

export interface EditorInputAdapter {
  /** Take exclusive input ownership: disable player controls, exit pointer lock. */
  acquire(): void;
  /** Release input ownership: restore player controls to their pre-acquire state. */
  release(): void;
}

export function mountEditor(
  ctx: EngineCtx,
  _scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  renderer: THREE.WebGLRenderer,
  inputAdapter?: EditorInputAdapter,
  orbitControls?: { enabled: boolean },
): void {
  const scene = ctx.scene;
  const canvas = renderer.domElement;

  // ── Keyboard focus (known prototype issue: must set tabindex) ───────────────
  canvas.setAttribute('tabindex', '0');
  canvas.focus();

  // ── Editor enable/disable toggle ────────────────────────────────────────────
  let editorEnabled = false;

  // ── TransformControls ───────────────────────────────────────────────────────
  const tc = new TransformControls(camera, canvas);
  scene.add(tc.getHelper());

  tc.addEventListener('dragging-changed', (e: any) => {
    if (orbitControls) orbitControls.enabled = !e.value;
  });

  tc.addEventListener('objectChange', () => {
    updateHUD();
  });

  // ── Raycast selection ───────────────────────────────────────────────────────
  const raycaster = new THREE.Raycaster();

  let selectedRoot: THREE.Object3D | null = null;
  let savedMessage = '';

  function findEditableAncestor(obj: THREE.Object3D): THREE.Object3D | null {
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      if (cur.userData.editorId) return cur;
      cur = cur.parent;
    }
    return null;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!editorEnabled) return;
    if (e.button !== 0) return;
    if ((tc as any).dragging) return;
    if (modal.active) return;

    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);

    const gizmoRoot = tc.getHelper();
    const candidates = collectSelectableMeshes(scene, gizmoRoot);

    const hits = raycaster.intersectObjects(candidates, false);
    if (hits.length > 0) {
      const editable = findEditableAncestor(hits[0].object);
      if (editable) {
        selectedRoot = editable;
        tc.attach(selectedRoot);
        savedMessage = '';
        updateHUD();
        console.log('[editor] selected:', editable.userData.editorId);
      } else {
        // Hit something but no editable ancestor
        tc.detach();
        selectedRoot = null;
        savedMessage = 'not editable';
        updateHUD();
        console.log('[editor] not editable');
      }
    }
  });

  // ── Modal state ─────────────────────────────────────────────────────────────
  const modal: ModalState = {
    active: false,
    op: null,
    axis: null,
    buffer: '',
  };
  let snapshot: TransformSnapshot | null = null;

  function captureSnapshot(obj: THREE.Object3D): TransformSnapshot {
    return {
      position: obj.position.clone(),
      rotation: new THREE.Euler(obj.rotation.x, obj.rotation.y, obj.rotation.z, obj.rotation.order),
      scale: obj.scale.clone(),
    };
  }

  function applySnapshot(obj: THREE.Object3D, snap: TransformSnapshot) {
    obj.position.copy(snap.position);
    obj.rotation.copy(snap.rotation);
    obj.scale.copy(snap.scale);
  }

  function enterModal(op: ModalOp) {
    if (!selectedRoot) return;
    modal.active = true;
    modal.op = op;
    modal.axis = null;
    modal.buffer = '';
    snapshot = captureSnapshot(selectedRoot);
    if (orbitControls) orbitControls.enabled = false;
    tc.enabled = false;
    updateHUD();
  }

  const DEG2RAD = Math.PI / 180;

  function applyNumericTransform(obj: THREE.Object3D, op: ModalOp, axis: AxisLock, val: number) {
    if (op === 'grab') {
      if (axis === 'x') obj.position.x += val;
      else if (axis === 'y') obj.position.y += val;
      else if (axis === 'z') obj.position.z += val;
      else {
        obj.position.x += val;
        obj.position.y += val;
        obj.position.z += val;
      }
    } else if (op === 'rotate') {
      // Input is in degrees; convert to radians internally
      const rad = val * DEG2RAD;
      if (axis === 'x') obj.rotation.x += rad;
      else if (axis === 'y') obj.rotation.y += rad;
      else if (axis === 'z') obj.rotation.z += rad;
      else obj.rotation.y += rad;
    } else if (op === 'scale') {
      if (axis === 'x') obj.scale.x *= val;
      else if (axis === 'y') obj.scale.y *= val;
      else if (axis === 'z') obj.scale.z *= val;
      else { obj.scale.x *= val; obj.scale.y *= val; obj.scale.z *= val; }
    }
  }

  function commitModal() {
    if (!modal.active || !selectedRoot) return;
    const val = parseFloat(modal.buffer);
    const hasValue = modal.buffer !== '' && !isNaN(val);
    if (hasValue) {
      applyNumericTransform(selectedRoot, modal.op!, modal.axis, val);
    }
    exitModal(false);
  }

  function cancelModal() {
    if (!modal.active || !selectedRoot || !snapshot) return;
    applySnapshot(selectedRoot, snapshot);
    exitModal(false);
  }

  function exitModal(detach = false) {
    modal.active = false;
    modal.op = null;
    modal.axis = null;
    modal.buffer = '';
    snapshot = null;
    if (orbitControls) orbitControls.enabled = true;
    tc.enabled = true;
    if (detach) { tc.detach(); selectedRoot = null; }
    updateHUD();
  }

  // ── Keyboard handler ─────────────────────────────────────────────────────────
  window.addEventListener('keydown', (e) => {
    // F2 always toggles editor, regardless of state
    if (e.key === 'F2') {
      editorEnabled = !editorEnabled;
      if (editorEnabled) {
        inputAdapter?.acquire();
      } else {
        if (modal.active) cancelModal();
        tc.detach();
        selectedRoot = null;
        inputAdapter?.release();
      }
      updateHUD();
      return;
    }

    if (!editorEnabled) return;

    // Ctrl+S: save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveOverrides();
      return;
    }

    if (modal.active) {
      // Axis lock
      if (e.key === 'x' || e.key === 'X') { modal.axis = 'x'; updateHUD(); return; }
      if (e.key === 'y' || e.key === 'Y') { modal.axis = 'y'; updateHUD(); return; }
      if (e.key === 'z' || e.key === 'Z') { modal.axis = 'z'; updateHUD(); return; }

      // Numeric buffer
      if (/^[0-9]$/.test(e.key)) { modal.buffer += e.key; updateHUD(); return; }
      if (e.key === '-' && modal.buffer === '') { modal.buffer = '-'; updateHUD(); return; }
      if (e.key === '.' && !modal.buffer.includes('.')) {
        modal.buffer += (modal.buffer === '' || modal.buffer === '-') ? '0.' : '.';
        updateHUD(); return;
      }
      if (e.key === 'Backspace') { modal.buffer = modal.buffer.slice(0, -1); updateHUD(); return; }
      if (e.key === 'Enter') { commitModal(); return; }
      if (e.key === 'Escape') { cancelModal(); return; }
      return; // swallow all other keys in modal
    }

    // Outside modal — editor mode keys
    if (e.key === 'g' || e.key === 'G') { enterModal('grab'); return; }
    if (e.key === 'r' || e.key === 'R') { enterModal('rotate'); return; }
    if (e.key === 's' || e.key === 'S') { enterModal('scale'); return; }
    if (e.key === 'Escape') { tc.detach(); selectedRoot = null; savedMessage = ''; updateHUD(); }
  });

  // ── Save logic ───────────────────────────────────────────────────────────────
  async function saveOverrides() {
    if (!selectedRoot) { savedMessage = '⚠ nothing selected'; updateHUD(); return; }

    // Fetch current overrides.json from the server to merge with.
    // If the fetch fails (network error or non-OK status) we ABORT the save:
    // proceeding with an empty base would erase overrides for other entities.
    let existing: OverridesDoc;
    try {
      const r = await fetch('/overrides.json', { cache: 'no-store' });
      if (!r.ok) {
        savedMessage = `✗ save aborted: could not read /overrides.json (HTTP ${r.status} ${r.statusText})`;
        updateHUD();
        return;
      }
      existing = await r.json() as OverridesDoc;
    } catch (fetchErr) {
      savedMessage = `✗ save aborted: could not read /overrides.json — ${String(fetchErr).slice(0, 80)}`;
      updateHUD();
      return;
    }

    const merged: Record<string, OverrideEntry> = { ...existing.overrides };

    // Write all currently modified editables (only entities where we have
    // a selected root for now — extend to "all dirty" later).
    // For the vertical slice we save the selected entity.
    const id = selectedRoot.userData.editorId as string;
    const obj = selectedRoot;

    const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
    const pos: [number, number, number] = [r6(obj.position.x), r6(obj.position.y), r6(obj.position.z)];
    const rot: [number, number, number] = [r6(obj.rotation.x), r6(obj.rotation.y), r6(obj.rotation.z)];
    const scl: [number, number, number] = [r6(obj.scale.x), r6(obj.scale.y), r6(obj.scale.z)];

    const authored = getAuthoredTransform(id);
    if (authored === undefined) {
      // ID not in registry — should not happen if the user selected via the editor,
      // but guard explicitly rather than silently using default-0 values.
      savedMessage = `✗ save aborted: "${id}" is not in the editable registry`;
      updateHUD();
      return;
    }
    // Only write fields that differ from authored defaults
    const entry: OverrideEntry = {};
    if (!vec3Near(pos, authored.position)) entry.position = pos;
    if (!vec3Near(rot, authored.rotation)) entry.rotation = rot;
    if (!vec3Near(scl, authored.scale)) entry.scale = scl;

    if (Object.keys(entry).length > 0) {
      merged[id] = entry;
    } else {
      // All fields match authored → remove the override (keep file clean)
      delete merged[id];
    }

    const doc: OverridesDoc = { version: 1, overrides: merged };

    try {
      const resp = await fetch('/__editor/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doc),
      });
      const result = await resp.json() as {
        ok: boolean;
        gateExit: number;
        gateVerdict: string;
      };
      savedMessage = result.gateExit === 0
        ? `✓ SAVED — GATE: ${result.gateVerdict}`
        : `✗ GATE FAIL — ${result.gateVerdict}`;
    } catch (err) {
      savedMessage = `✗ save error: ${String(err).slice(0, 60)}`;
    }
    updateHUD();
  }

  // ── HUD ──────────────────────────────────────────────────────────────────────
  const hud = document.createElement('div');
  hud.id = 'neon-editor-hud';
  hud.style.cssText = [
    'position:fixed', 'top:12px', 'right:12px', 'z-index:9999',
    'background:rgba(2,4,12,0.92)', 'border:1px solid #5af2ff55',
    'color:#5af2ff', 'font-family:"Share Tech Mono",monospace,monospace',
    'font-size:12px', 'padding:10px 14px', 'line-height:1.7',
    'white-space:pre', 'min-width:300px', 'pointer-events:none',
  ].join(';');
  document.body.appendChild(hud);

  // Save button (pointer-events:auto override)
  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'SAVE (Ctrl+S)';
  saveBtn.style.cssText = [
    'display:block', 'margin-top:6px', 'padding:3px 10px',
    'background:#0d1220', 'color:#5af2ff', 'border:1px solid #5af2ff77',
    'cursor:pointer', 'font-family:inherit', 'font-size:11px',
    'pointer-events:auto',
  ].join(';');
  saveBtn.addEventListener('click', () => saveOverrides());

  function updateHUD() {
    const lines: string[] = [];
    const status = editorEnabled ? '[EDITOR ON] F2 to disable' : '[EDITOR OFF] F2 to enable';
    lines.push(status);
    lines.push('─────────────────────────────────');

    if (!editorEnabled) {
      hud.textContent = lines.join('\n');
      if (hud.contains(saveBtn)) hud.removeChild(saveBtn);
      return;
    }

    if (modal.active) {
      const opLabel = (modal.op ?? '').toUpperCase();
      const axisLabel = modal.axis ? modal.axis.toUpperCase() : 'FREE';
      const unitHint = modal.op === 'rotate' ? ' (degrees)' : '';
      lines.push(`▶ MODAL: ${opLabel}   AXIS: ${axisLabel}${unitHint}`);
      lines.push(`  INPUT: ${modal.buffer || '(type number)'}`);
      lines.push('  X/Y/Z=lock  Enter=commit  Esc=cancel');
      lines.push('─────────────────────────────────');
    } else {
      lines.push('Click=select  G=grab  R=rotate  S=scale');
      lines.push('Esc=deselect');
      lines.push('─────────────────────────────────');
    }

    if (selectedRoot) {
      const p = selectedRoot.position;
      const r = selectedRoot.rotation;
      const s = selectedRoot.scale;
      lines.push(`SELECTED: ${selectedRoot.userData.editorId}`);
      lines.push(`pos ${p.x.toFixed(3)} ${p.y.toFixed(3)} ${p.z.toFixed(3)}`);
      lines.push(`rot ${r.x.toFixed(3)} ${r.y.toFixed(3)} ${r.z.toFixed(3)} (rad)`);
      lines.push(`scl ${s.x.toFixed(3)} ${s.y.toFixed(3)} ${s.z.toFixed(3)}`);
    } else {
      lines.push('(no object selected)');
    }

    // Orphaned overrides
    const orphaned: string[] = (window as any).neon?.overrides?.orphaned ?? [];
    if (orphaned.length > 0) {
      lines.push('─────────────────────────────────');
      // orphaned IDs shown below as red text — we append a marker line
      lines.push('⚠ ORPHANED: ' + orphaned.join(', ') + ' — orphaned override');
    }

    if (savedMessage) {
      lines.push('─────────────────────────────────');
      lines.push(savedMessage);
    }

    hud.textContent = lines.join('\n');

    // Colorize orphaned line
    if (orphaned.length > 0) {
      const text = hud.textContent!;
      const orphanedIdx = text.lastIndexOf('⚠ ORPHANED');
      if (orphanedIdx >= 0) {
        // Split into before+after and wrap the orphaned part in red
        const before = text.slice(0, orphanedIdx);
        const after = text.slice(orphanedIdx);
        hud.innerHTML = '';
        const pre1 = document.createTextNode(before);
        const span = document.createElement('span');
        span.style.color = '#ff4444';
        span.textContent = after;
        hud.appendChild(pre1);
        hud.appendChild(span);
      }
    }

    // Gate FAIL → red save message
    if (savedMessage.startsWith('✗')) {
      // Find and colorize the last line
      const children = hud.childNodes;
      let lastText: Node | null = children[children.length - 1] ?? null;
      if (lastText && lastText.textContent?.includes(savedMessage)) {
        const span2 = document.createElement('span');
        span2.style.color = '#ff4444';
        span2.textContent = savedMessage;
        // Replace text in lastText with span
        if (lastText.nodeType === Node.TEXT_NODE) {
          const orig = lastText.textContent ?? '';
          const idx = orig.lastIndexOf(savedMessage);
          if (idx >= 0) {
            const pre = document.createTextNode(orig.slice(0, idx));
            hud.removeChild(lastText);
            hud.appendChild(pre);
            hud.appendChild(span2);
          }
        }
      }
    }

    // Append save button
    hud.appendChild(saveBtn);
  }

  updateHUD();

  // Expose programmatic selection for automated testing
  // Usage: window.__editorSelectById('room.monitor.main')
  (window as any).__editorSelectById = (id: string): boolean => {
    const obj = getEditable(id);
    if (!obj) return false;
    selectedRoot = obj;
    tc.attach(selectedRoot);
    savedMessage = '';
    updateHUD();
    return true;
  };

  console.log('[editor] mounted — press F2 to enable');
}
