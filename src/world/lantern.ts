import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Turkish mosaic-glass lanterns built in Blender. Two reference photos in
// docs gave us two lamps:
//   * bar lantern   — small handheld piece, 20cm, on the kitchen island (IMG_5714/15)
//   * desk lantern  — larger ornate piece, 24cm, on the netrunner desk (IMG_5728-31)
// The same loader handles both; brightness mode differs (2- vs 3-state).

export type LanternLevelLabel = 'off' | 'dim' | 'bright';

export interface Lantern {
  group: THREE.Group;
  hit: THREE.Object3D;
  /** Cycle to next brightness level. Returns the new label. */
  cycle: () => LanternLevelLabel;
  /** Convenience: cycle wrapping off↔bright (skips dim). */
  toggle: () => boolean;
  isOn: () => boolean;
  level: () => LanternLevelLabel;
  update: (dt: number) => void;
}
export type BarLantern = Lantern;   // back-compat alias

interface LanternOpts {
  position: THREE.Vector3;
  modelUrl: string;
  mosaicUrl: string;
  roughUrl?: string;
  /** y offset (m) of the glass body centre above the prop origin. Drives the inner light + hit proxy. */
  bodyCentreY: number;
  /** radius of the invisible raycast proxy around the body. */
  proxyRadius: number;
  /** 'bar' = 2-state on/off; 'desk' = 3-state off/dim/bright. */
  brightnessMode: 'bar' | 'desk';
  groupName?: string;
  onClick?: () => void;
}

// brightness level → [emissive_intensity, point_light_candela]
const BRIGHTNESS_PROFILE: Record<LanternLevelLabel, [number, number]> = {
  off:    [0,    0  ],
  dim:    [0.85, 1.6],
  bright: [1.75, 3.6],
};

const LABEL_ORDER_BAR: LanternLevelLabel[] = ['off', 'bright'];
const LABEL_ORDER_DESK: LanternLevelLabel[] = ['off', 'dim', 'bright'];

export async function buildLantern(opts: LanternOpts): Promise<Lantern> {
  const group = new THREE.Group();
  group.name = opts.groupName ?? 'Lantern';
  group.position.copy(opts.position);

  const texLoader = new THREE.TextureLoader();
  const mosaicTex = await texLoader.loadAsync(opts.mosaicUrl);
  mosaicTex.colorSpace = THREE.SRGBColorSpace;
  mosaicTex.anisotropy = 8;
  mosaicTex.wrapS = mosaicTex.wrapT = THREE.RepeatWrapping;

  let roughTex: THREE.Texture | undefined;
  if (opts.roughUrl) {
    try {
      roughTex = await texLoader.loadAsync(opts.roughUrl);
      roughTex.wrapS = roughTex.wrapT = THREE.RepeatWrapping;
    } catch { /* optional */ }
  }

  const glassMat = new THREE.MeshPhysicalMaterial({
    map: mosaicTex,
    emissiveMap: mosaicTex,
    emissive: new THREE.Color(0xffb060),
    emissiveIntensity: 0,
    roughness: 0.55,
    roughnessMap: roughTex,
    metalness: 0.0,
    transmission: 0.05,
    thickness: 0.6,
    ior: 1.45,
    side: THREE.FrontSide,
  });

  const gltf = await new GLTFLoader().loadAsync(opts.modelUrl);
  const root = gltf.scene;
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const mesh = o as THREE.Mesh;
    const mat = mesh.material as THREE.Material | undefined;
    const matName = (Array.isArray(mat) ? mat[0]?.name : mat?.name) ?? '';
    if (mesh.name.includes('Glass') || matName === 'MosaicGlass') {
      mesh.material = glassMat;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    } else if (mat && (mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
      const sm = mat as THREE.MeshStandardMaterial;
      sm.metalness = 1.0;
      sm.roughness = Math.max(0.35, sm.roughness ?? 0.42);
      sm.envMapIntensity = 1.2;
    }
  });
  group.add(root);

  const inner = new THREE.PointLight(0xffb060, 0, 1.8, 1.6);
  inner.position.set(0, opts.bodyCentreY, 0);
  group.add(inner);

  const hit = new THREE.Mesh(
    new THREE.SphereGeometry(opts.proxyRadius, 16, 12),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hit.position.set(0, opts.bodyCentreY, 0);
  hit.name = `${group.name}Proxy`;
  group.add(hit);

  // ---- state ----
  const order = opts.brightnessMode === 'desk' ? LABEL_ORDER_DESK : LABEL_ORDER_BAR;
  let idx = 0;   // 'off'
  let level = 0; // smoothed 0..1+ for emissive ramp
  let targetEmis = 0;
  let targetLightCd = 0;

  const applyTarget = (): void => {
    const lvl = order[idx];
    const [emis, cd] = BRIGHTNESS_PROFILE[lvl];
    targetEmis = emis;
    targetLightCd = cd;
  };

  const update = (dt: number): void => {
    const targetLevel = (targetEmis === 0 && targetLightCd === 0) ? 0 : 1;
    if (Math.abs(level - targetLevel) > 0.001 || targetLevel === 1) {
      const speed = targetLevel > level ? 4.5 : 3.2;
      level += Math.sign(targetLevel - level) * Math.min(Math.abs(targetLevel - level), dt * speed);
      glassMat.emissiveIntensity = level * targetEmis;
      inner.intensity = level * targetLightCd;
      // subtle flicker only when near full-on (lit-bulb feel)
      if (targetLevel === 1 && level > 0.9 && targetLightCd > 0) {
        const flicker = 1 + (Math.sin(performance.now() * 0.013) + Math.sin(performance.now() * 0.041)) * 0.015;
        inner.intensity = targetLightCd * flicker;
      }
    }
  };

  const cycle = (): LanternLevelLabel => {
    idx = (idx + 1) % order.length;
    applyTarget();
    if (opts.onClick) opts.onClick();
    return order[idx];
  };

  // toggle: jump off → bright (or bright → off), skipping intermediate dim
  const toggle = (): boolean => {
    idx = order[idx] === 'off' ? order.indexOf('bright') : 0;
    if (idx < 0) idx = order.length - 1;
    applyTarget();
    if (opts.onClick) opts.onClick();
    return order[idx] !== 'off';
  };

  return {
    group, hit, cycle, toggle,
    isOn: () => order[idx] !== 'off',
    level: () => order[idx],
    update,
  };
}

// ---- back-compat wrapper: matches the original buildBarLantern signature ----
export async function buildBarLantern(
  position: THREE.Vector3,
  onClick?: () => void,
): Promise<Lantern> {
  return buildLantern({
    position,
    modelUrl: '/assets/models/bar_lantern.glb',
    mosaicUrl: '/assets/textures/lantern_mosaic.png',
    roughUrl: '/assets/textures/lantern_mosaic_rough.png',
    bodyCentreY: 0.098,
    proxyRadius: 0.072,
    brightnessMode: 'bar',
    groupName: 'BarLantern',
    onClick,
  });
}

export async function buildDeskLantern(
  position: THREE.Vector3,
  onClick?: () => void,
): Promise<Lantern> {
  return buildLantern({
    position,
    modelUrl: '/assets/models/desk_lantern.glb',
    mosaicUrl: '/assets/textures/desk_lantern_mosaic.png',
    roughUrl: '/assets/textures/desk_lantern_mosaic_rough.png',
    // egg body centre sits ~12cm above prop origin per the Blender build
    bodyCentreY: 0.12,
    proxyRadius: 0.082,
    brightnessMode: 'desk',
    groupName: 'DeskLantern',
    onClick,
  });
}
