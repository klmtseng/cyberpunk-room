// Headless unit tests for the OUT-OF-ROOM containment check.
// Run: npm run test:placement
//
// Why this file exists: before the containment check, the gate reported
// ALL CLEAR for an editor-movable prop pushed through a wall, dropped 50 units
// below the floor, or parked 20 units behind the room — the wall census only
// fires on meshes that intersect a wall slab, and the below-floor check had a
// -3 lower bound. Every assertion below is paired with a control that must
// behave the opposite way, so a check that can no longer fail shows up as a
// failing control rather than a green suite.

import * as THREE from 'three';
import { runPlacementAudit, ROOM_ENVELOPE } from '../../src/dev/placement_audit.ts';

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { pass++; } else { fail++; console.error('  ✗ FAIL:', msg); }
}

/** A registered editable holding one small box mesh, placed at `pos`. */
function editableAt(pos: [number, number, number], id = 'test.prop'): THREE.Object3D {
  const root = new THREE.Object3D();
  root.userData.editorId = id;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4));
  mesh.name = 'TestProp';
  root.add(mesh);
  root.position.set(...pos);
  root.updateMatrixWorld(true);
  return root;
}

const outOfRoom = (root: THREE.Object3D) =>
  runPlacementAudit(root, []).issues.filter((i) => i.kind === 'OUT-OF-ROOM');

// ── The check fires for every escape route that used to pass ───────────────
const escapes: Array<[string, [number, number, number]]> = [
  ['through the left wall',  [-6.6, 2, 0]],
  ['far outside on x',       [-20, 2, 0]],
  ['far behind on z',        [0, 2, -30]],
  ['just below the floor',   [0, -0.6, 0]],
  ['deep fall past -3',      [0, -50, 0]],
  ['above the ceiling',      [0, 9, 0]],
];
for (const [label, pos] of escapes) {
  const found = outOfRoom(editableAt(pos));
  ok(found.length === 1, `OUT-OF-ROOM fires: ${label}`);
  ok(found[0]?.name === 'test.prop', `issue is named by editor id, not mesh name: ${label}`);
}

// ── CONTROL: legal positions inside the room must NOT fire ────────────────
// Without these, an always-FAIL check would score 100% above.
for (const [label, pos] of [
  ['room centre',        [0, 1.5, 0]],
  ['near the left wall', [-5.5, 1.5, 0]],
  ['high but inside',    [0, 5.5, 0]],
] as Array<[string, [number, number, number]]>) {
  ok(outOfRoom(editableAt(pos)).length === 0, `CONTROL: no issue for ${label}`);
}

// ── Scope: unregistered geometry outside the room is NOT the subject ───────
// Authored exteriors (skyline, signage) legitimately live outside; only things
// a save can relocate are tested.
{
  const anon = new THREE.Object3D();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  mesh.name = 'Skyline';
  anon.add(mesh);
  anon.position.set(0, 2, -40);
  anon.updateMatrixWorld(true);
  ok(outOfRoom(anon).length === 0, 'unregistered geometry outside the room is out of scope');
  ok(runPlacementAudit(anon, []).editablesChecked.length === 0,
     'editablesChecked reports 0 so an empty scope is visible, not a silent pass');
}

// ── The id is reported, and a nested mesh still resolves to its owner ──────
{
  const root = editableAt([0, 1.5, 0], 'room.monitor.main');
  const deep = new THREE.Object3D();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2));
  mesh.position.set(0, 0, -40);   // child pushed out of the room on its own
  deep.add(mesh);
  root.add(deep);
  root.updateMatrixWorld(true);
  const r = runPlacementAudit(root, []);
  ok(r.editablesChecked.join(',') === 'room.monitor.main', 'editablesChecked lists the id');
  ok(r.issues.some((i) => i.kind === 'OUT-OF-ROOM'),
     'a grandchild mesh outside the envelope is attributed to its editable ancestor');
}

// ── The envelope is the wall skin, not the bare interior ──────────────────
ok(Math.abs(ROOM_ENVELOPE.max.x - 6.125) < 1e-9, 'envelope +x is the outer wall face');
ok(Math.abs(ROOM_ENVELOPE.max.z - 7.125) < 1e-9, 'envelope +z is the outer wall face');

console.log(`placement_audit: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
