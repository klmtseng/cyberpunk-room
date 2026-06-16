import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Loads the two lounge sofas:
//   1. Custom cyberpunk L-sectional (Blender CLI build, tufted, curved edges)
//   2. Polyhaven Sofa_02 (Victorian black tufted leather, CC0)
//
// The Polyhaven asset ships with its own PBR maps via the gltf manifest, so
// we let GLTFLoader resolve them. The custom build is plain geometry — we
// override its material with the Polyhaven leather texture we already use
// on the procedural box-sofa cushions for visual consistency.

export interface LoungeSofas {
  custom: THREE.Object3D | null;
  classic: THREE.Object3D | null;
  ottoman: THREE.Object3D | null;
  armchair: THREE.Object3D | null;
}

/** Build the two sofa objects in parallel. Each resolves independently. */
export async function loadLoungeSofas(): Promise<LoungeSofas> {
  const loader = new GLTFLoader();
  const texLoader = new THREE.TextureLoader();

  // Shared upholstery material for the custom build (Polyhaven leather PBR)
  const upDiff  = texLoader.load('/assets/textures/sofa/leather_white_diff_1k.jpg');
  const upNorm  = texLoader.load('/assets/textures/sofa/leather_white_nor_gl_1k.jpg');
  const upRough = texLoader.load('/assets/textures/sofa/leather_white_rough_1k.jpg');
  for (const t of [upDiff, upNorm, upRough]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2, 2);
    t.anisotropy = 6;
  }
  upDiff.colorSpace = THREE.SRGBColorSpace;
  const customMat = new THREE.MeshStandardMaterial({
    color: 0x55617a,             // dark slate-blue tint to keep cyberpunk palette
    map: upDiff,
    normalMap: upNorm,
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughnessMap: upRough,
    roughness: 0.88,
    metalness: 0.02,
  });

  // ---- 1. custom Blender-built L-sectional ----
  let customRoot: THREE.Object3D | null = null;
  try {
    const gltf = await loader.loadAsync('/assets/models/lounge_sofa.glb');
    customRoot = gltf.scene;
    customRoot.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      const m = o as THREE.Mesh;
      m.material = customMat;
      m.castShadow = false;
      m.receiveShadow = false;
    });
    customRoot.name = 'CustomLoungeSofa';
  } catch (e) {
    console.warn('[sofa] custom build failed', e);
  }

  // small helper for the 3 Polyhaven imports — same try/catch pattern + disable shadows
  const loadPH = async (gltfPath: string, name: string): Promise<THREE.Object3D | null> => {
    try {
      const gltf = await loader.loadAsync(gltfPath);
      gltf.scene.name = name;
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) { m.castShadow = false; m.receiveShadow = false; }
      });
      return gltf.scene;
    } catch (e) {
      console.warn(`[sofa] ${name} load failed`, e);
      return null;
    }
  };

  // ---- 2-4. Polyhaven Victorian-classic lounge set (Sofa + Armchair + Ottoman) ----
  const [classicRoot, ottomanRoot, armchairRoot] = await Promise.all([
    loadPH('/assets/models/polyhaven/sofa_02/sofa_02_1k.gltf',         'ClassicSofa02'),
    loadPH('/assets/models/polyhaven/Ottoman_01/Ottoman_01_1k.gltf',   'Ottoman01'),
    loadPH('/assets/models/polyhaven/ArmChair_01/ArmChair_01_1k.gltf', 'ArmChair01'),
  ]);

  return {
    custom: customRoot,
    classic: classicRoot,
    ottoman: ottomanRoot,
    armchair: armchairRoot,
  };
}
