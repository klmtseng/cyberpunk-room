import * as THREE from 'three';
import { EffectPass, GodRaysEffect, KernelSize } from 'postprocessing';
import type { EngineCtx } from './renderer';

// Wraps the postprocessing GodRaysEffect to give us one additive "light shaft"
// per bright neon anchor in the city. Composer chain looks like:
//
//   RenderPass → [god-rays...] → bloom/ACES EffectPass
//
// God-rays must run BEFORE bloom so the bloom amplifies the shaft tips, and
// they take a screen-space light source mesh (small additive sphere placed at
// the anchor world position). On HD 4000 we leave this stack empty.
//
// Reads from QualitySettings.volumetricSources (count) and volumetricSamples.

export interface VolumetricRig {
  pass: EffectPass | null;             // null when disabled
  sources: THREE.Mesh[];               // tiny additive spheres in the scene
  dispose: () => void;
}

export function buildVolumetric(
  ctx: EngineCtx,
  anchors: THREE.Vector3[],
): VolumetricRig {
  const { settings, camera, scene, composer } = ctx;
  const count = Math.min(settings.volumetricSources, anchors.length);
  if (count <= 0) return { pass: null, sources: [], dispose: () => {} };

  const sources: THREE.Mesh[] = [];
  const effects: GodRaysEffect[] = [];

  // tiny screen-space "lamp" for each source — must be a Mesh because
  // GodRaysEffect re-renders it to its own buffer to mask the shaft.
  const lampGeo = new THREE.SphereGeometry(1.2, 12, 10);
  for (let i = 0; i < count; i++) {
    const a = anchors[i];
    const lampMat = new THREE.MeshBasicMaterial({
      color: i === 0 ? 0xff4dd2 : i === 1 ? 0x5af2ff : 0xffd6a8,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.copy(a);
    lamp.name = `VolumetricSource_${i}`;
    scene.add(lamp);
    sources.push(lamp);

    const eff = new GodRaysEffect(camera, lamp, {
      samples: settings.volumetricSamples,
      density: 0.94,
      decay: 0.92,
      weight: 0.32,
      exposure: 0.5,
      clampMax: 1.0,
      kernelSize: KernelSize.SMALL,
      resolutionScale: 0.5,
    });
    effects.push(eff);
  }

  // Combine all god-rays into one EffectPass, then prepend to the composer
  // BEFORE the existing bloom/ACES pass. RenderPass is at index 0; the
  // bloom pass is index 1. We insert at index 1, pushing bloom to index 2.
  const pass = new EffectPass(camera, ...effects);
  // Re-construct the composer pass order: postprocessing exposes `passes`
  // as an array we can manipulate via removePass + addPass at index.
  // `addPass(pass, index)` accepts a target index argument.
  composer.addPass(pass, 1);

  return {
    pass,
    sources,
    dispose: () => {
      composer.removePass(pass);
      pass.dispose();
      for (const s of sources) {
        scene.remove(s);
        (s.material as THREE.Material).dispose();
      }
      lampGeo.dispose();
    },
  };
}
