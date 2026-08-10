/**
 * scene.mjs — shared headless scene builder.
 *
 * Builds the real room+props scene graph with a minimal fake EngineCtx (no GPU,
 * no DOM). Used by both the gate (check_wall_clip.mjs) and the baseline
 * regenerator (regen_baseline.mjs) so the two can never drift apart: if they
 * built the scene differently, a regenerated baseline would not describe the
 * scene the gate actually checks.
 *
 * This file MUST NOT use  2>/dev/null  or  || true  — any internal error must
 * propagate and cause a non-zero exit, not be swallowed.
 */

import * as THREE from 'three';
import { buildRoom }  from '../../src/world/room.ts';
import { buildProps } from '../../src/world/props.ts';

export function buildHeadlessScene() {
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
    applyQuality:     () => {},
    setBloomExposure: () => {},
    setHeightFog:     () => {},
    setTonemap:       () => {},
  };

  const room  = buildRoom(fakeCtx);
  const props = buildProps(fakeCtx);

  return { scene, room, props, roots: [room.group, props.group] };
}
