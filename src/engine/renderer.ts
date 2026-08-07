import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect,
  ChromaticAberrationEffect, ToneMappingEffect, ToneMappingMode,
} from 'postprocessing';
import type { QualitySettings } from './quality';

// Bloom luminance threshold at "standard" ambient scale.
// Moods scale this up/down so neon halos stay visible at low exposure
// and don't over-blow at reading brightness.
const BASE_THRESHOLD = 0.55;

export interface EngineCtx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  clock: THREE.Clock;
  settings: QualitySettings;
  /** Apply a new quality preset without reloading the page.
   *  Only covers fields that don't require geometry rebuild — caller is
   *  responsible for gating on needsReload() first (see quality.ts). */
  applyQuality(next: QualitySettings): void;
  /** Scale the bloom luminance threshold with the scene's overall exposure.
   *  @param scale — the mood's ambient multiplier (e.g. 0.35 for cinema).
   *  Clamped to [0.08, 0.95] so threshold never fully collapses or disappears. */
  setBloomExposure(scale: number): void;
}

export function createEngine(canvas: HTMLCanvasElement, settings: QualitySettings): EngineCtx {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: settings.preset !== 'low',
    powerPreference: 'high-performance',
    stencil: false,
    preserveDrawingBuffer: true, // allows canvas.toDataURL captures (remote shutter)
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio * settings.pixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = settings.enableShadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.xr.enabled = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060a);
  // light haze: the vista reaches ~250m, dense fog would swallow the city.
  // Slightly bumped (0.0045 → 0.0058) so interior depth reads as "air with
  // particulate" per cozy-cyberpunk reference photos. Still well under the
  // threshold where 250m city skyline drowns out.
  scene.fog = new THREE.FogExp2(0x0c1224, 0.0058);

  const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 900);
  camera.position.set(0, 1.7, 0);

  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
  });
  composer.addPass(new RenderPass(scene, camera));

  // All effects are always constructed and placed in a single EffectPass so
  // that switching quality presets never requires rebuilding the pass or
  // recompiling shaders. Effects that are "off" have their opacity set to 0
  // rather than being removed from the pipeline.
  const bloom = new BloomEffect({
    intensity: settings.preset === 'low' ? 0.6 : 1.0,
    luminanceThreshold: BASE_THRESHOLD,
    luminanceSmoothing: 0.2,
    mipmapBlur: true,
  });
  bloom.blendMode.opacity.value = settings.enableBloom ? 1 : 0;

  const chromaticAberration = new ChromaticAberrationEffect();
  (chromaticAberration as any).offset = new THREE.Vector2(0.0012, 0.0012);
  chromaticAberration.blendMode.opacity.value = settings.enableChromaticAberration ? 1 : 0;

  // AgX over ACES. Measured on this scene (Firefox, low preset, 6 paired
  // captures across 標準/影院/派對, /tmp/shots + docs/tonemap-agx-compare.md):
  //   near-black pixels (max channel < 0.02)   15.0% → 0.0%   (interior pose)
  //   stddev of the darkest 40% of the frame    1.17 → 3.69   (= separation)
  //   highlight saturation (top 2% luminance)  0.541 → 0.376  (AgX desaturates MORE)
  //   hue drift between the two                median 1-2°    (neither shifts hue here)
  // So the win is specifically the LOW end: ACES crushes this dark, neon-only
  // room into flat black and the loft geometry disappears; AgX's longer toe
  // keeps furniture and wall planes readable. The often-cited AgX "no hue
  // skew in highlights" advantage did NOT show up here — this scene never
  // pushes highlights hard enough to trigger the ACES skew. Cost: zero, same
  // single fullscreen pass, same effect object.
  const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.AGX });

  const effectPass = new EffectPass(camera, bloom, chromaticAberration, toneMapping);
  composer.addPass(effectPass);

  const clock = new THREE.Clock();

  window.addEventListener('resize', () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });

  let currentSettings = settings;

  const ctx: EngineCtx = {
    renderer,
    scene,
    camera,
    composer,
    clock,
    get settings() { return currentSettings; },

    applyQuality(next: QualitySettings): void {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio * next.pixelRatio, 2));

      // Shadow map changes take effect on the next frame only after
      // needsUpdate is set; this is a three.js requirement.
      if (renderer.shadowMap.enabled !== next.enableShadows) {
        renderer.shadowMap.enabled = next.enableShadows;
        renderer.shadowMap.needsUpdate = true;
      }

      bloom.blendMode.opacity.value = next.enableBloom ? 1 : 0;
      if (next.enableBloom) {
        // Preserve intensity tier between low and higher presets
        bloom.intensity = next.preset === 'low' ? 0.6 : 1.0;
      }
      chromaticAberration.blendMode.opacity.value = next.enableChromaticAberration ? 1 : 0;

      currentSettings = next;
    },

    setBloomExposure(scale: number): void {
      // Clamp so threshold never fully collapses into "everything blooms" or
      // rises so high that no neon surpasses it.
      const threshold = Math.min(0.95, Math.max(0.08, BASE_THRESHOLD * scale));
      (bloom as any).luminanceMaterial.threshold = threshold;
    },
  };

  return ctx;
}
