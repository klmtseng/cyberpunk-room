/**
 * entity_pos.mjs — headless probe: print world position of a registered entity.
 *
 * Usage (from project root):
 *   node --experimental-strip-types --loader ./tools/gate/ts-loader.mjs --import ./tools/gate/headless-globals.mjs ./tools/gate/entity_pos.mjs <entityId>
 *
 * Example:
 *   node --experimental-strip-types --loader ./tools/gate/ts-loader.mjs --import ./tools/gate/headless-globals.mjs ./tools/gate/entity_pos.mjs room.monitor.main
 *
 * Exits 1 if the id is not found or if no argument is provided.
 */

import * as THREE from 'three';
import { buildHeadlessScene } from './scene.mjs';
import { getEditable } from '../../src/world/editable.ts';

const id = process.argv[2];
if (!id) {
  console.error('entity_pos: no entity id provided');
  console.error('Usage: node <loader flags> tools/gate/entity_pos.mjs <entityId>');
  process.exit(1);
}

buildHeadlessScene(); // populates the registry and applies overrides

const obj = getEditable(id);
if (!obj) {
  console.error(`entity_pos: id "${id}" not found in scene registry`);
  process.exit(1);
}

const worldPos = new THREE.Vector3();
obj.getWorldPosition(worldPos);

console.log(`entityId: ${obj.userData.editorId}`);
console.log(
  `worldPosition: ${worldPos.x.toFixed(6)} ${worldPos.y.toFixed(6)} ${worldPos.z.toFixed(6)}`,
);
