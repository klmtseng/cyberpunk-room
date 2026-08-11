// Headless regression test for editor click-selection candidate collection.
// Run: npm run test:pick
//
// Guards the bug this file was written for: BookReader parks a hidden Group on
// the camera holding five VISIBLE meshes half a metre in front of the lens
// (src/player/bookreader.ts:60-61). Because `traverse` descends into hidden
// subtrees and a non-recursive `intersectObjects` never checks ancestors, those
// meshes won the raycast on every editor click and selection reported
// "not editable". Real mouse selection had never worked; every prior test used
// the __editorSelectById hook, which does not go through the raycast at all.

import * as THREE from 'three';
import { collectSelectableMeshes } from '../../src/editor/editor.ts';

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) {
  if (cond) { pass++; } else { fail++; console.error('  ✗ FAIL:', msg); }
}

const mkMesh = (name: string) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1));
  m.name = name;
  return m;
};

const scene = new THREE.Scene();
const gizmo = new THREE.Object3D();      // stands in for tc.getHelper()
const gizmoChild = mkMesh('GizmoHandle');
gizmo.add(gizmoChild);
scene.add(gizmo);

const prop = mkMesh('VisibleProp');
scene.add(prop);

// The shape of the bug: hidden parent, visible children.
const hiddenGroup = new THREE.Object3D();
hiddenGroup.visible = false;
const page1 = mkMesh('BookPageL');
const page2 = mkMesh('BookPageR');
hiddenGroup.add(page1, page2);
scene.add(hiddenGroup);

// A mesh hidden on its own, and one hidden two levels up.
const selfHidden = mkMesh('SelfHidden');
selfHidden.visible = false;
scene.add(selfHidden);

const outer = new THREE.Object3D();
outer.visible = false;
const inner = new THREE.Object3D();
const deep = mkMesh('DeepUnderHidden');
inner.add(deep); outer.add(inner); scene.add(outer);

const picked = collectSelectableMeshes(scene, gizmo);
const names = picked.map((o) => o.name).sort();

ok(names.includes('VisibleProp'), 'CONTROL: a plain visible mesh IS selectable');
ok(!names.includes('BookPageL') && !names.includes('BookPageR'),
   'meshes under a hidden parent are excluded (the actual bug)');
ok(!names.includes('SelfHidden'), 'a mesh hidden on its own is excluded');
ok(!names.includes('DeepUnderHidden'), 'hidden two levels up is still excluded');
ok(!names.includes('GizmoHandle'), 'the transform gizmo is never a pick target');
ok(names.length === 1, `exactly one selectable mesh, got [${names.join(', ')}]`);

// Un-hiding the group must bring its meshes back — otherwise the filter could be
// excluding them for some unrelated reason and this suite would not notice.
hiddenGroup.visible = true;
const names2 = collectSelectableMeshes(scene, gizmo).map((o) => o.name).sort();
ok(names2.includes('BookPageL') && names2.includes('BookPageR'),
   'CONTROL: un-hiding the parent makes its meshes selectable again');
ok(!names2.includes('SelfHidden'), 'un-hiding one group does not leak others in');

console.log(`editor_pick: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
