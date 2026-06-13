import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect,
  ChromaticAberrationEffect, ToneMappingEffect, ToneMappingMode,
} from 'postprocessing';
import type { QualitySettings } from './quality';

export interface EngineCtx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  clock: THREE.Clock;
  settings: QualitySettings;
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
  // light haze: the vista reaches ~250m, dense fog would swallow the city
  scene.fog = new THREE.FogExp2(0x0a0e1c, 0.0045);

  const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 900);
  camera.position.set(0, 1.7, 0);

  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
  });
  composer.addPass(new RenderPass(scene, camera));

  const effects: any[] = [];
  if (settings.enableBloom) {
    effects.push(new BloomEffect({
      intensity: settings.preset === 'low' ? 0.6 : 1.0,
      luminanceThreshold: 0.55,
      luminanceSmoothing: 0.2,
      mipmapBlur: true,
    }));
  }
  if (settings.enableChromaticAberration) {
    const ca = new ChromaticAberrationEffect();
    (ca as any).offset = new THREE.Vector2(0.0012, 0.0012);
    effects.push(ca);
  }
  effects.push(new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }));
  composer.addPass(new EffectPass(camera, ...effects));

  const clock = new THREE.Clock();

  window.addEventListener('resize', () => {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });

  return { renderer, scene, camera, composer, clock, settings };
}
