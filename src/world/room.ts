import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import type { EngineCtx } from '../engine/renderer';
import { BOOKS, type Book } from '../lib/books';
import { buildAdWall } from './ad_wall';
import { buildWindowRainMaterial, type WindowRainHandle } from './shaders/window_rain.glsl';

export interface AABB { min: THREE.Vector3; max: THREE.Vector3; }

export interface RealWeather {
  city: string;
  tempC: number;
  desc: string;
  humidity: number;
}

export interface RoomBuild {
  group: THREE.Group;
  walls: AABB[];
  windowPlane: THREE.Mesh;
  windowRain: WindowRainHandle | null;   // null when preset disables it (none ATM; Low still shows)
  monitorPlane: THREE.Mesh;
  heightAt: (x: number, z: number, feetY: number) => number;
  update: (t: number) => void;
  bathroom: {
    door: THREE.Mesh;
    toggleDoor: () => boolean;       // returns true when opening
    toilet: THREE.Mesh;
    mirror: THREE.Mesh;
    shower: THREE.Mesh;
    toggleShower: () => boolean;
    setRealWeather: (w: RealWeather | null) => void;
    setNews: (titles: string[]) => void;
    setPrivate: (on: boolean) => void;   // occupancy-sensing privacy glass
    reflector: THREE.Mesh;
    avatar: THREE.Group;
  };
  washer: THREE.Mesh;
  bookshelf: THREE.Mesh;
  titledBooks: Array<{ mesh: THREE.Mesh; book: Book }>;
  shardTrayArt: THREE.Mesh;     // upper shard row → art gallery
  shardTrayAudio: THREE.Mesh;   // lower shard row → family recordings
  devlogShard: THREE.Mesh;      // golden easter-egg chip → build log
  entry: {
    door: THREE.Mesh;
    toggle: () => boolean;          // true = opening
    isOpen: () => boolean;
    package: THREE.Mesh;            // delivery box (hidden until delivered)
    setDelivered: (on: boolean) => void;
    keypad: THREE.Mesh;             // green LED strip → DND toggle (interact target)
  };
  wardrobe: { mesh: THREE.Mesh; cycleOutfit: () => string };
  starProjector: { hit: THREE.Object3D; cycle: () => string; isOn: () => boolean; currentMode: () => string };
  fridge: { hit: THREE.Object3D; toggle: () => boolean; isOpen: () => boolean };
}

// Double-height industrial loft per reference images:
// mezzanine bedroom over the back half, stairs along the left wall,
// full-wall mullioned window facing the city, kitchen tucked under the mezzanine.
const W = 12;          // x: -6..6
const D = 14;          // z: -7..7  (window wall at +7)
const H = 6;           // double-height ceiling
const MEZZ_Y = 3;      // mezzanine floor height
const MEZZ_EDGE = -1;  // mezzanine spans z in [-7, MEZZ_EDGE]
const STAIR_X0 = -6, STAIR_X1 = -4.75;   // stair footprint (left wall)
const STAIR_Z_BOTTOM = 2, STAIR_Z_TOP = -2; // ramp from h=0 to h=MEZZ_Y

export function buildRoom(ctx: EngineCtx): RoomBuild {
  const group = new THREE.Group();
  group.name = 'Room';
  const walls: AABB[] = [];
  const animated: Array<(t: number) => void> = [];

  // ---------- shared materials (procedural textures for realism on a budget) ----------
  const texConcrete = makeConcreteTexture();
  texConcrete.wrapS = texConcrete.wrapT = THREE.RepeatWrapping;
  texConcrete.repeat.set(3, 3.5);
  const texConcreteRough = makeConcreteRoughness();
  texConcreteRough.wrapS = texConcreteRough.wrapT = THREE.RepeatWrapping;
  texConcreteRough.repeat.set(3, 3.5);
  const texPanel = makeWallPanelTexture();
  texPanel.wrapS = texPanel.wrapT = THREE.RepeatWrapping;
  texPanel.repeat.set(3, 1.6);
  const texFabric = makeFabricTexture(0x1b2030);
  texFabric.wrapS = texFabric.wrapT = THREE.RepeatWrapping;
  texFabric.repeat.set(3, 3);
  const texBrushed = makeBrushedMetalTexture();
  texBrushed.wrapS = texBrushed.wrapT = THREE.RepeatWrapping;

  const matFloor = new THREE.MeshStandardMaterial({
    color: 0xb8bdc9, map: texConcrete, roughnessMap: texConcreteRough,
    roughness: 1.0, metalness: 0.3,
  });
  const matWall = new THREE.MeshStandardMaterial({
    color: 0xaab0c4, map: texPanel, roughness: 0.75, metalness: 0.08,
  });
  const texDarkStone = makeDarkStoneTexture();
  const texDarkStoneRough = makeDarkStoneRoughness();
  const matDark = new THREE.MeshStandardMaterial({
    color: 0x131625, map: texDarkStone, roughnessMap: texDarkStoneRough,
    roughness: 0.55, metalness: 0.55,
  });
  const matSteel = new THREE.MeshStandardMaterial({
    color: 0x9aa4bd, map: texBrushed, roughness: 0.4, metalness: 0.85,
  });
  const matFurn = new THREE.MeshLambertMaterial({ color: 0x959dba, map: texBrushed });
  const matFabric = new THREE.MeshLambertMaterial({ color: 0xb0b6cc, map: texFabric });

  // Sofa-only PBR upholstery — Polyhaven CC0 leather/microsuede (1K diff +
  // normal + roughness). Tinted to the original cyberpunk slate-blue so the
  // colour profile of the lounge doesn't shift. Bed + other matFabric users
  // keep the cheaper procedural texture above.
  // See THIRD_PARTY_ASSETS.md for source/license details.
  const texLoader = new THREE.TextureLoader();
  const sofaDiff = texLoader.load('/assets/textures/sofa/leather_white_diff_1k.jpg');
  const sofaNorm = texLoader.load('/assets/textures/sofa/leather_white_nor_gl_1k.jpg');
  const sofaRough = texLoader.load('/assets/textures/sofa/leather_white_rough_1k.jpg');
  for (const t of [sofaDiff, sofaNorm, sofaRough]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1.6, 1.6);            // tile so the weave reads at sofa scale
    t.anisotropy = 6;
  }
  sofaDiff.colorSpace = THREE.SRGBColorSpace;
  // normal + rough must stay in linear (data) space — three.js default
  // M6: upgraded to MeshPhysicalMaterial for `sheen` — picks up grazing
  // neon from the city IBL (scene.environment). The sheen colour is a
  // muted blue so the halo reads as "city light catching the fabric" not
  // as a coloured highlight that competes with the room moods.
  const matSofa = new THREE.MeshPhysicalMaterial({
    color: 0x6a7390,                   // slate-blue tint over the neutral suede
    map: sofaDiff,
    normalMap: sofaNorm,
    normalScale: new THREE.Vector2(1.2, 1.2),
    roughnessMap: sofaRough,
    roughness: 0.85,
    metalness: 0.02,
    sheen: 0.45,
    sheenColor: new THREE.Color(0x3a4a6a),
    sheenRoughness: 0.6,
  });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x101e36, transparent: true, opacity: 0.16, roughness: 0.05,
    metalness: 0, transmission: 0.7, ior: 1.4, side: THREE.DoubleSide, depthWrite: false,
  });

  const box = (w: number, h: number, d: number, mat: THREE.Material,
               x: number, y: number, z: number, ry = 0): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    if (ry) m.rotation.y = ry;
    group.add(m);
    return m;
  };
  const solid = (w: number, h: number, d: number, mat: THREE.Material,
                 x: number, y: number, z: number): THREE.Mesh => {
    const m = box(w, h, d, mat, x, y, z);
    walls.push({
      min: new THREE.Vector3(x - w/2, y - h/2, z - d/2),
      max: new THREE.Vector3(x + w/2, y + h/2, z + d/2),
    });
    return m;
  };
  const blocker = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    walls.push({
      min: new THREE.Vector3(x - w/2, y - h/2, z - d/2),
      max: new THREE.Vector3(x + w/2, y + h/2, z + d/2),
    });
  };
  // fake contact shadows: radial-gradient decals are ~free on HD 4000
  // and ground the furniture far better than no shadows at all
  const blobTex = makeBlobShadowTexture();
  const blob = (w: number, d: number, x: number, z: number, y = 0.013, opacity = 0.5) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({
        map: blobTex, transparent: true, opacity, depthWrite: false,
      }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.renderOrder = 1;
    group.add(m);
  };
  const strip = (w: number, h: number, d: number, color: number,
                 x: number, y: number, z: number, intensity = 2.2): THREE.Mesh => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: 0x05060a, emissive: color, emissiveIntensity: intensity }),
    );
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };

  // ---------- shell ----------
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), matFloor);
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);

  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), matWall);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = H;
  group.add(ceil);
  // industrial ceiling beams
  for (const bz of [-3.5, 0.5, 4.5]) box(W, 0.28, 0.22, matDark, 0, H - 0.14, bz);

  solid(W, H, 0.25, matWall, 0, H/2, -D/2);            // back wall
  solid(0.25, H, D, matWall, -W/2, H/2, 0);            // left wall
  solid(0.25, H, D, matWall,  W/2, H/2, 0);            // right wall

  // ---------- window wall (full-width mullioned grid) ----------
  blocker(W, H, 0.3, 0, H/2, D/2);  // collision for the whole front face
  box(W, 0.4, 0.25, matWall, 0, 0.2, D/2);             // sill base
  box(W, 0.3, 0.25, matWall, 0, H - 0.15, D/2);        // header
  const winY0 = 0.4, winY1 = H - 0.3;
  const winH = winY1 - winY0;
  for (let i = 0; i <= 6; i++) {                       // vertical mullions
    if (i === 3) continue; // keep the central bay open — a post dead-center
                           // reads as a giant black pillar from up close
    box(0.07, winH, 0.12, matSteel, -W/2 + i * (W/6), winY0 + winH/2, D/2);
  }
  box(W, 0.09, 0.12, matDark, 0, MEZZ_Y, D/2);         // horizontal mullion
  box(W, 0.09, 0.12, matDark, 0, 4.6, D/2);
  const windowPlane = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.1, winH), glassMat);
  windowPlane.position.set(0, winY0 + winH/2, D/2 - 0.02);
  windowPlane.name = 'WindowGlass';
  group.add(windowPlane);

  // Rain-on-glass overlay (M1): a second, slightly inset plane carrying
  // a fragment-only ShaderMaterial that paints drops + condensation. Layers
  // OVER the transparent glassMat so the see-through city behind stays
  // intact. Uniforms are pushed every frame from main.ts.
  let windowRain: WindowRainHandle | null = null;
  if (ctx.settings.windowRainShader) {
    windowRain = buildWindowRainMaterial();
    const rainPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(W - 0.1, winH),
      windowRain.material,
    );
    // 1cm inside the glass plane (room-side) so the shader composites in
    // front of the transmission layer when viewed from the living area.
    rainPlane.position.set(0, winY0 + winH/2, D/2 - 0.035);
    rainPlane.renderOrder = 2;       // after the transparent glass
    rainPlane.name = 'WindowRainOverlay';
    group.add(rainPlane);
  }

  // ---------- mezzanine ----------
  const mezzD = MEZZ_EDGE - (-D/2);                    // 6m deep
  const mezzZ = (-D/2 + MEZZ_EDGE) / 2;                // center z = -4
  box(W, 0.18, mezzD, matSteel, 0, MEZZ_Y - 0.09, mezzZ);
  strip(W, 0.05, 0.06, 0xb44dff, 0, MEZZ_Y - 0.2, MEZZ_EDGE + 0.02, 2.6); // edge LED
  // mezzanine front railing (gap at stair top, x < -4.5)
  const railMat = matSteel;
  for (let x = -4.5; x <= 6; x += 1.05) box(0.05, 1.0, 0.05, railMat, Math.min(x, 5.8), MEZZ_Y + 0.5, MEZZ_EDGE);
  box(10.5, 0.06, 0.06, railMat, 0.75, MEZZ_Y + 1.0, MEZZ_EDGE);
  box(10.5, 0.04, 0.04, railMat, 0.75, MEZZ_Y + 0.55, MEZZ_EDGE);
  blocker(10.6, 1.05, 0.1, 0.75, MEZZ_Y + 0.55, MEZZ_EDGE);

  // ---------- stairs ----------
  const steps = 12;
  const runZ = STAIR_Z_BOTTOM - STAIR_Z_TOP;           // 4m
  const stepD = runZ / steps;
  const stepH = MEZZ_Y / steps;
  const stairW = STAIR_X1 - STAIR_X0;
  for (let i = 0; i < steps; i++) {
    const z = STAIR_Z_BOTTOM - stepD * (i + 0.5);
    box(stairW, 0.07, stepD, matSteel, (STAIR_X0 + STAIR_X1)/2, stepH * (i + 1) - 0.035, z);
    // riser LED every third step (per IMG_5690 stair glow)
    if (i % 3 === 0) strip(stairW - 0.1, 0.03, 0.02, 0xb44dff, (STAIR_X0+STAIR_X1)/2, stepH * (i + 1) - 0.08, z + stepD/2, 1.8);
  }
  // stair inner railing + entry blocking (enter only from bottom or top)
  for (let i = 0; i <= 4; i++) {
    const z = STAIR_Z_BOTTOM - (runZ / 4) * i;
    const h = MEZZ_Y * (i / 4);
    box(0.05, 1.0, 0.05, railMat, STAIR_X1, h + 0.5, z);
  }
  const rail = box(0.05, 0.05, Math.hypot(runZ, MEZZ_Y) + 0.2, railMat,
                   STAIR_X1, MEZZ_Y/2 + 0.9, (STAIR_Z_BOTTOM + STAIR_Z_TOP)/2);
  rail.rotation.x = Math.atan2(MEZZ_Y, runZ); // sloped handrail following the ramp
  blocker(0.1, 2.2, runZ, STAIR_X1, MEZZ_Y/2 + 1.1, (STAIR_Z_BOTTOM + STAIR_Z_TOP)/2);
  // under-stair: storage clutter + purple glow, blocked off in two height tiers.
  // Tier tops stay below the ramp soffit minus body radius so climbers never clip them.
  blocker(stairW, 1.7, 1.25, (STAIR_X0+STAIR_X1)/2, 0.85, -1.375);
  blocker(stairW, 0.75, 1.25, (STAIR_X0+STAIR_X1)/2, 0.375, -0.125);
  box(0.9, 0.7, 0.8, matFurn, -5.4, 0.35, -1.3);
  box(0.7, 0.45, 0.6, matFurn, -5.3, 0.95, -1.5);
  strip(0.04, 2.4, 0.04, 0xb44dff, STAIR_X1 - 0.08, 1.2, -1.9, 2.8);

  // ---------- kitchen under mezzanine (per IMG_5690) ----------
  solid(4.6, 0.95, 0.65, matFurn, -2.0, 0.475, -6.55);            // counter run
  box(4.6, 0.06, 0.72, matDark, -2.0, 0.98, -6.55);               // countertop
  // backsplash slot — the FlipMosaic mounts here at boot. We leave a black
  // placeholder so the wall isn't a hole if the mosaic ever fails to load.
  const splashSlot = new THREE.Mesh(
    new THREE.PlaneGeometry(4.6, 0.8),
    new THREE.MeshBasicMaterial({ color: 0x05030a }),
  );
  splashSlot.position.set(-2.0, 1.45, -6.86);
  splashSlot.name = 'KitchenSplashSlot';
  group.add(splashSlot);
  box(4.6, 0.7, 0.5, matFurn, -2.0, 2.3, -6.6);                   // upper cabinets
  strip(4.4, 0.03, 0.03, 0xffc6a0, -2.0, 1.92, -6.42, 1.6);       // under-cabinet warm strip
  solid(0.85, 1.9, 0.7, matSteel, 1.1, 0.95, -6.5);               // fridge
  strip(0.03, 1.7, 0.03, 0x5af2ff, 0.72, 0.95, -6.18, 2.0);       // fridge edge glow
  // smart-fridge holo display: top of door shows a small status panel
  const fridgeDisplay = (() => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#021018'; g.fillRect(0, 0, 256, 128);
    g.font = '14px monospace'; g.fillStyle = '#5af2ff';
    g.fillText('SMARTFRIDGE-K3', 12, 22);
    g.fillStyle = '#39ff88';
    g.fillText('TEMP  4°C', 12, 50);
    g.fillText('STOCK 78%', 12, 70);
    g.fillStyle = '#ff8a3d';
    g.fillText('EXP 牛奶 03H', 12, 96);
    return new THREE.CanvasTexture(c);
  })();
  fridgeDisplay.colorSpace = THREE.SRGBColorSpace;
  const fridgeScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.28, 0.14),
    new THREE.MeshBasicMaterial({ map: fridgeDisplay, transparent: true }),
  );
  fridgeScreen.position.set(0.72, 1.55, -6.18);
  fridgeScreen.rotation.y = Math.PI / 2;
  group.add(fridgeScreen);
  // fridge interior — visible when door is "open" (toggle by E)
  const fridgeInterior = new THREE.Group();
  fridgeInterior.visible = false;
  // inner light glow
  const fridgeGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.65, 1.5),
    new THREE.MeshBasicMaterial({
      color: 0xddeeff, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  fridgeGlow.position.set(0.71, 0.95, -6.18);
  fridgeGlow.rotation.y = Math.PI / 2;
  fridgeInterior.add(fridgeGlow);
  // contents: a row of colourful drink cans + a glowing purple bottle
  const canColors = [0xff2bdb, 0x5af2ff, 0xffe14d, 0x39ff88, 0xff5566];
  for (let i = 0; i < canColors.length; i++) {
    const can = new THREE.Mesh(
      new THREE.CylinderGeometry(0.038, 0.038, 0.12, 12),
      new THREE.MeshStandardMaterial({
        color: 0x0a0c14, emissive: canColors[i], emissiveIntensity: 0.6,
        roughness: 0.4, metalness: 0.6,
      }),
    );
    can.position.set(0.72, 1.40, -6.7 + i * 0.10);
    fridgeInterior.add(can);
  }
  // mystery glowing bottle (one shelf down)
  const bottle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.05, 0.18, 14),
    new THREE.MeshPhysicalMaterial({
      color: 0x331b66, emissive: 0xb44dff, emissiveIntensity: 1.2,
      transparent: true, opacity: 0.85, roughness: 0.12, transmission: 0.4,
    }),
  );
  bottle.position.set(0.72, 1.10, -6.5);
  fridgeInterior.add(bottle);
  // a plastic flower in a vase (callback to BR2049 / 鄰居誤送)
  const vase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.022, 0.08, 10),
    new THREE.MeshStandardMaterial({ color: 0xe8e8f4, roughness: 0.8 }),
  );
  vase.position.set(0.72, 0.65, -6.55);
  fridgeInterior.add(vase);
  const flower = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff8ec5 }),
  );
  flower.position.set(0.72, 0.74, -6.55);
  fridgeInterior.add(flower);
  group.add(fridgeInterior);
  let fridgeOpen = false;
  let fridgeCloseTimer = 0;
  const toggleFridge = (): boolean => {
    fridgeOpen = !fridgeOpen;
    fridgeInterior.visible = fridgeOpen;
    if (fridgeOpen) fridgeCloseTimer = 6;   // auto-close after 6s
    return fridgeOpen;
  };
  animated.push(() => {
    if (fridgeOpen && fridgeCloseTimer > 0) {
      fridgeCloseTimer -= 1 / 60;
      if (fridgeCloseTimer <= 0) {
        fridgeOpen = false;
        fridgeInterior.visible = false;
      }
    }
  });
  // raycast proxy on the door (since the fridge body is matSteel solid)
  const fridgeHit = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 1.8, 0.6),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  fridgeHit.position.set(0.71, 0.95, -6.5);
  fridgeHit.name = 'FridgeDoor';
  group.add(fridgeHit);
  // island + stools — bar widened to 2.4m (was 1.6m, felt cramped after
  // surface texture turned darker). Slight depth bump too (0.9 → 1.0).
  solid(2.4, 0.9, 0.85, matFurn, -2.2, 0.45, -4.6);
  box(2.4, 0.05, 1.0, matDark, -2.2, 0.925, -4.6);
  // 3 stools instead of 2 — the bar is wide enough for it now
  for (const sx of [-3.10, -2.20, -1.30]) {
    box(0.35, 0.07, 0.35, matDark, sx, 0.62, -3.9);
    box(0.06, 0.6, 0.06, matSteel, sx, 0.3, -3.9);
  }
  strip(4.4, 0.04, 0.04, 0xffffff, -2.0, MEZZ_Y - 0.25, -5.4, 1.1); // kitchen ceiling tube

  // ---------- living area (double-height zone) ----------
  // L-sofa facing the window
  // (The 3-box procedural L-sofa was replaced by two GLB sofas loaded from
  // main.ts: a custom curved cyberpunk L-sectional + a Polyhaven Victorian
  // classic for A/B comparison. See src/world/lounge_sofas.ts.)
  box(0.5, 0.16, 0.5, new THREE.MeshLambertMaterial({ color: 0xc2306a }), -0.5, 0.5, 1.9); // accent cushion
  box(0.5, 0.16, 0.5, matFurn, 0.9, 0.5, 1.95);
  strip(2.9, 0.03, 0.03, 0x5af2ff, 0.4, 0.06, 2.55, 1.4);          // sofa underglow
  // coffee table + rug
  solid(1.3, 0.34, 0.7, matDark, 0.2, 0.17, 3.6);
  strip(1.32, 0.02, 0.02, 0xff2bdb, 0.2, 0.35, 3.95, 1.2);
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 3.2),
    new THREE.MeshLambertMaterial({ color: 0xc5c9da, map: makeRugTexture() }));
  rug.rotation.x = -Math.PI/2;
  rug.position.set(0.4, 0.012, 3.0);
  group.add(rug);

  // ---------- lounge ceiling pendants (cozy cyber-loft vibe per reference) ----------
  // 4 small Turkish-style hanging lanterns over the sofa + coffee table area.
  // The mosaic glass body is omitted (just a brass cup) so they read as
  // industrial filament bulbs hanging from the rafters — that's closer to
  // the reference photos than another mosaic-glass lamp.
  const matBrass = new THREE.MeshStandardMaterial({
    color: 0x6a4a1c, metalness: 0.9, roughness: 0.45,
  });
  const matFilament = new THREE.MeshBasicMaterial({ color: 0xffd49a });
  // 4 positions: left + right above sofa, plus 1 over coffee table, plus 1
  // over the chaise. Each cord length varies slightly for organic feel.
  const pendantSpots: Array<{ x: number; z: number; y: number; cord: number }> = [
    { x: -0.9, z: 2.6, y: 3.6, cord: 0.85 },   // over sofa, left
    { x:  0.4, z: 3.5, y: 3.2, cord: 0.65 },   // over coffee table (lowest)
    { x:  1.4, z: 3.1, y: 3.8, cord: 0.95 },   // over sofa B (centred on its x≈1.45 axis)
    { x:  2.5, z: 2.0, y: 3.5, cord: 0.75 },   // over chaise
  ];
  const pendantLights: THREE.PointLight[] = [];
  for (const p of pendantSpots) {
    // cord — thin dark cylinder from ceiling (y=6) down to fitting (p.y + p.cord)
    const cordTop = 6.0;
    const cordBottom = p.y + 0.04;
    const cordLen = cordTop - cordBottom;
    const cord = new THREE.Mesh(
      new THREE.CylinderGeometry(0.005, 0.005, cordLen, 6),
      matDark,
    );
    cord.position.set(p.x, (cordTop + cordBottom) / 2, p.z);
    group.add(cord);
    // brass cup / shade — small cone opening downward
    const cup = new THREE.Mesh(
      new THREE.ConeGeometry(0.07, 0.10, 14, 1, true),
      matBrass,
    );
    cup.position.set(p.x, p.y + 0.05, p.z);
    cup.rotation.x = Math.PI;   // open end faces down
    group.add(cup);
    // filament bulb — small warm-emissive sphere
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), matFilament);
    bulb.position.set(p.x, p.y - 0.02, p.z);
    group.add(bulb);
    // light (warm amber) — soft, short range so it pools on the sofa/table
    const light = new THREE.PointLight(0xffc890, 6, 3.5, 1.8);
    light.position.set(p.x, p.y - 0.05, p.z);
    group.add(light);
    pendantLights.push(light);
  }
  // gentle flicker — synchronous-ish but each with a different phase
  pendantLights.forEach((l, i) => {
    const phase = i * 1.3;
    const base = l.intensity;
    animated.push((t) => {
      l.intensity = base * (1 + Math.sin(t * 1.8 + phase) * 0.04 + Math.sin(t * 0.7 + phase) * 0.02);
    });
  });
  // Soft volumetric light shafts — billboard sprites with a teardrop radial
  // gradient texture. Always face the camera, so the cone always looks
  // properly "fogged" instead of like a flat cone with a hard silhouette.
  // Opacity is low so the effect reads as "dust in lamp light", not a beam.
  const lightShaftTex = (() => {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#000';
    g.fillRect(0, 0, 128, 256);
    // teardrop gradient: brightest at top-centre (bulb), softly fading
    // outward in an elongated radial. Edges go to fully transparent for
    // a clean fade-to-air look — no harsh silhouette.
    const grad = g.createRadialGradient(64, 14, 0, 64, 150, 150);
    grad.addColorStop(0,    'rgba(255, 220, 170, 1)');
    grad.addColorStop(0.15, 'rgba(255, 200, 140, 0.55)');
    grad.addColorStop(0.45, 'rgba(255, 170, 110, 0.18)');
    grad.addColorStop(0.85, 'rgba(255, 140, 80, 0.04)');
    grad.addColorStop(1,    'rgba(0, 0, 0, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 256);
    // sub-pixel noise so the gradient doesn't band on iGPU (banding kills
    // the "volumetric" illusion more than anything else)
    const img = g.getImageData(0, 0, 128, 256);
    for (let p = 0; p < img.data.length; p += 4) {
      const n = (Math.random() - 0.5) * 16;
      img.data[p + 3] = Math.max(0, Math.min(255, img.data[p + 3] + n));
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();
  for (const p of pendantSpots) {
    const sprMat = new THREE.SpriteMaterial({
      map: lightShaftTex,
      color: 0xffc890,
      opacity: 0.30,                 // moderate — gradient itself carries most of the fade
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const sprite = new THREE.Sprite(sprMat);
    // shaft spans from bulb (y=p.y) to floor (y=0). Width tapers via gradient.
    const shaftH = p.y * 1.05;
    const shaftW = shaftH * 0.55;    // gradient already tapers; sprite stays slim
    sprite.scale.set(shaftW, shaftH, 1);
    sprite.position.set(p.x, p.y - shaftH / 2 + 0.05, p.z);
    group.add(sprite);
  }

  // (Floating dust particles removed at user request — the warm shaft sprites
  // alone read better as cosy lamp pools without the distracting motes.)

  // ---------- coffee-table candle cluster (warm flickering) ----------
  // Coffee table top at y = 0.17 + 0.17 = 0.34. Cluster of 4 candles of
  // varying heights at the centre, each with a tiny flame plane + flickering
  // amber point light.
  const matWax = new THREE.MeshStandardMaterial({ color: 0xe8d9b8, roughness: 0.85 });
  const candleSpots: Array<{ x: number; z: number; h: number }> = [
    { x:  0.04, z: 3.55, h: 0.13 },
    { x:  0.22, z: 3.62, h: 0.18 },
    { x:  0.36, z: 3.50, h: 0.10 },
    { x:  0.18, z: 3.42, h: 0.15 },
  ];
  const candleLights: THREE.PointLight[] = [];
  const flameMeshes: THREE.Mesh[] = [];
  for (const c of candleSpots) {
    // wax cylinder
    const wax = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.030, c.h, 12), matWax,
    );
    wax.position.set(c.x, 0.34 + c.h / 2, c.z);
    group.add(wax);
    // wick (tiny black bit)
    const wick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0025, 0.0025, 0.015, 4),
      new THREE.MeshBasicMaterial({ color: 0x222 }),
    );
    wick.position.set(c.x, 0.34 + c.h + 0.007, c.z);
    group.add(wick);
    // flame — small additive teardrop sprite (a SphereGeometry scaled tall)
    const flame = new THREE.Mesh(
      new THREE.SphereGeometry(0.018, 8, 6),
      new THREE.MeshBasicMaterial({
        color: 0xffd070, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    flame.scale.set(1, 2.2, 1);
    flame.position.set(c.x, 0.34 + c.h + 0.038, c.z);
    group.add(flame);
    flameMeshes.push(flame);
    // candle point light — short range, warm
    const cl = new THREE.PointLight(0xffb060, 2.2, 1.2, 2.2);
    cl.position.set(c.x, 0.34 + c.h + 0.05, c.z);
    group.add(cl);
    candleLights.push(cl);
  }
  // candle flicker — independent per candle so the cluster feels alive
  candleLights.forEach((l, i) => {
    const phase = i * 1.7 + 0.5;
    const baseI = l.intensity;
    const flame = flameMeshes[i];
    const baseY = flame.position.y;
    animated.push((t) => {
      const f = 1 + Math.sin(t * 6 + phase) * 0.18 + Math.sin(t * 17 + phase) * 0.05;
      l.intensity = baseI * f;
      flame.scale.set(1 + 0.10 * Math.sin(t * 13 + phase),
                       2.2 + 0.25 * Math.sin(t * 11 + phase), 1);
      flame.position.y = baseY + Math.sin(t * 9 + phase) * 0.004;
    });
  });

  // ---------- plush throw cushions + blanket on the sofa ----------
  // Reference photos are heavy on layered pillows. Add 6 more cushions of
  // varying sizes and warm colours scattered across the L-sofa, plus a folded
  // throw blanket draped on the chaise armrest.
  // Cushion positions tuned for the 2× Polyhaven Sofa_02 L-formation set up
  // in main.ts. Sofa_02 seat top sits ~0.45m → cushion y=0.50 puts cushion
  // bottom on seat (height 0.16 → top at 0.58, well clear of backrest 0.71).
  //   Sofa A (centred -0.4, rot 0):     x∈[-1.30, 0.50], z∈[1.29, 2.10]
  //   Sofa B (centred  1.45, rot -π/2): x∈[ 1.05, 1.85], z∈[1.79, 3.59]
  const cushionPalette: Array<[number, number, number, number, number, number]> = [
    // [x, y, z, w, h, color]
    [-1.05, 0.52, 1.65, 0.34, 0.17,  0xb04060],   // burgundy on sofa A, left
    [-0.30, 0.52, 1.55, 0.30, 0.15,  0x303860],   // navy on sofa A, mid
    [ 0.35, 0.52, 1.60, 0.36, 0.18,  0x884420],   // burnt orange on sofa A, right
    [ 1.55, 0.52, 2.10, 0.34, 0.16,  0x506080],   // slate on sofa B, low z
    [ 1.55, 0.52, 3.30, 0.30, 0.17,  0xa0826a],   // sand on sofa B, high z
    [ 1.55, 0.52, 2.80, 0.28, 0.15,  0x383454],   // plum on sofa B, mid
  ];
  for (const [cx, cy, cz, cw, ch, col] of cushionPalette) {
    const cushion = new THREE.Mesh(
      new THREE.BoxGeometry(cw, ch, cw),
      new THREE.MeshLambertMaterial({ color: col }),
    );
    cushion.position.set(cx, cy, cz);
    cushion.rotation.y = (Math.random() - 0.5) * 0.5;
    group.add(cushion);
  }
  // folded throw blanket draped over the chaise top
  const blanketMat = new THREE.MeshLambertMaterial({
    color: 0xb05030, map: makeFabricTexture(0x6a3018),
  });
  const blanket = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.08, 0.55), blanketMat);
  // draped over the back-end of sofa B (which extends along +z). Position
  // moved off the sand cushion (was at the same z=3.30 → cushion poked through).
  blanket.position.set(1.55, 0.50, 2.45);
  blanket.rotation.y = Math.PI / 2 + 0.15;     // long edge along z to match sofa B
  group.add(blanket);

  // contact shadows under the major pieces
  blob(3.8, 1.8, 0.4, 2.0, 0.014);          // sofa
  blob(1.6, 2.8, 2.15, 2.6, 0.014);         // chaise
  blob(1.9, 1.2, 0.2, 3.6, 0.015);          // coffee table
  blob(1.2, 2.6, 5.65, 3.4);                // desk (long edge along z)
  blob(0.9, 0.9, 5.00, 3.4);                // chair
  blob(0.9, 3.0, 5.7, 0.2);                 // bookshelf
  blob(3.0, 1.4, -2.2, -4.6);               // island
  blob(5.2, 1.1, -2.0, -6.4);               // kitchen counter
  blob(0.7, 0.7, -3.4, 6.3, 0.013, 0.35);   // plants
  blob(0.7, 0.7, 3.6, 6.35, 0.013, 0.35);
  blob(3.0, 2.3, -3.6, -5.6, MEZZ_Y + 0.012); // bed
  blob(0.8, 0.7, -2.2, -6.3, MEZZ_Y + 0.012); // side table
  blob(2.5, 0.9, 3.4, -6.55, MEZZ_Y + 0.012); // dresser

  // ---------- netrunner gaming desk (long edge along z, hugging right wall) ----------
  // Right wall at x=+6.125. Desk depth 0.95 along x, length 2.4 along z.
  // Desk back ~6.0 (near wall), front ~5.18 (toward chair).
  solid(0.95, 0.74, 2.4, matFurn, 5.65, 0.37, 3.4);                 // base (collision)
  box(1.0, 0.05, 2.5, matDark, 5.65, 0.775, 3.4);                   // dark-stone top slab → top surface y=0.80
  // gaming-style accent strips on the short ends (front and back of long edge)
  for (const sz of [2.275, 4.525]) {
    strip(0.05, 0.45, 0.02, 0x5af2ff, 5.20, 0.30, sz, 1.8);          // angled side accent
  }
  // RGB front underglow — runs along the long edge (z), at the front face (x=5.175)
  strip(0.02, 0.02, 2.30, 0xff2bdb, 5.175, 0.715, 3.4, 2.1);

  // monitor riser shelf — runs along z near the back wall, lifts centre monitor
  box(0.22, 0.05, 0.95, matDark, 5.95, 0.83, 3.4);

  // triple monitors — all face -x (toward chair), arranged along z
  const monitorPlane = makeMonitor(1.1, 0.62, 0x5af2ff, 5.95, 1.50, 3.4, -Math.PI/2);
  monitorPlane.name = 'Monitor';
  makeMonitor(0.62, 0.5, 0x39ff88, 5.97, 1.40, 3.02, -Math.PI/2 + 0.3);
  makeMonitor(0.62, 0.5, 0xff2bdb, 5.97, 1.40, 3.78, -Math.PI/2 - 0.3);

  // peripherals — keyboard centred + mouse to the right, both sit ON desk top (y=0.80)
  box(0.18, 0.04, 0.5, matDark, 5.55, 0.82, 3.4);                   // mech keyboard (long edge along z)
  strip(0.005, 0.01, 0.45, 0x39ff88, 5.55, 0.846, 3.4, 1.5);        // keyboard underglow
  // XL mousepad covering most of the front-of-desk
  const padMat = new THREE.MeshStandardMaterial({
    color: 0x0a0b14, roughness: 0.88, metalness: 0.02,
  });
  const mousepad = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.5), padMat);
  mousepad.rotation.x = -Math.PI / 2;
  mousepad.position.set(5.55, 0.801, 3.4);
  group.add(mousepad);
  box(0.08, 0.03, 0.05, matDark, 5.55, 0.815, 3.85);                // mouse (to right of keyboard)
  strip(0.05, 0.005, 0.005, 0xff2bdb, 5.55, 0.832, 3.85, 2.0);      // mouse RGB

  // desktop speakers flanking the side monitors — sit ON desk top
  for (const [sx, sy, sz] of [[5.92, 0.90, 2.75], [5.92, 0.90, 4.05]] as const) {
    box(0.14, 0.20, 0.12, matDark, sx, sy, sz);
    const cone = new THREE.Mesh(
      new THREE.CircleGeometry(0.045, 18),
      new THREE.MeshStandardMaterial({ color: 0x0a0a14, roughness: 0.6 }),
    );
    cone.rotation.y = -Math.PI / 2;
    cone.position.set(sx - 0.075, sy + 0.02, sz);
    group.add(cone);
  }
  // cable management grommet on desk top (near back wall, behind monitors)
  const grommet = new THREE.Mesh(
    new THREE.CircleGeometry(0.045, 18),
    new THREE.MeshBasicMaterial({ color: 0x000000 }),
  );
  grommet.rotation.x = -Math.PI / 2;
  grommet.position.set(5.85, 0.801, 3.5);
  group.add(grommet);

  // headphone hook on the front-left side of the desk + headphones hanging
  box(0.10, 0.02, 0.03, matSteel, 5.10, 0.66, 2.27);                // small hook arm sticking out
  const headband = new THREE.Mesh(
    new THREE.TorusGeometry(0.075, 0.012, 8, 24, Math.PI),
    matSteel,
  );
  headband.rotation.set(0, 0, Math.PI);
  headband.position.set(5.05, 0.56, 2.27);
  group.add(headband);
  for (const ex of [-0.075, 0.075]) {
    const earcup = new THREE.Mesh(
      new THREE.CylinderGeometry(0.038, 0.040, 0.045, 12),
      new THREE.MeshStandardMaterial({ color: 0x0c0c14, roughness: 0.8 }),
    );
    earcup.rotation.x = Math.PI / 2;
    earcup.position.set(5.05 + ex, 0.50, 2.27);
    group.add(earcup);
  }

  // PC tower under desk, back-right corner, cyan side window facing the chair
  box(0.30, 0.50, 0.50, matDark, 5.55, 0.25, 4.40);
  const pcWindow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.45, 0.42),
    new THREE.MeshBasicMaterial({
      color: 0x05060a, map: makeCodeTexture(0x5af2ff),
      transparent: true, opacity: 0.85,
    }),
  );
  pcWindow.rotation.y = -Math.PI / 2;
  pcWindow.position.set(5.395, 0.27, 4.40);
  group.add(pcWindow);

  // ---------- esports gaming chair — tucked in close to the desk ----------
  // facing = π/2 → chair seat faces +x (toward desk at x=5.65)
  // chair centre at x=5.00 → seat front at x=5.25, slightly under the desk overhang
  buildGamingChair(group, 5.00, 0, 3.4, Math.PI / 2, matDark, matSteel);

  // (Indoor AD wall removed — user wanted dense ad density on EXTERIOR city
  // buildings instead, not on the home wall. See city.ts buildAdWall import
  // for the outdoor placement.)

  // ---------- bookshelf (right wall): antique paper above, data shards below ----------
  // open-front frame (a solid box would swallow the books entirely)
  box(0.05, 2.65, 2.4, matFurn, 5.86, 1.325, 0.2);              // back panel
  for (const sz of [-1.0, 1.4]) box(0.34, 2.65, 0.05, matFurn, 5.77, 1.325, sz); // sides
  for (const by of [0.4, 0.9, 1.4, 1.9, 2.4, 2.62]) {           // boards
    box(0.34, 0.05, 2.4, matFurn, 5.77, by, 0.2);
  }
  blocker(0.4, 2.65, 2.45, 5.78, 1.325, 0.2);                   // walk-through guard
  const shelf = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 2.6, 2.35),
    new THREE.MeshBasicMaterial({ visible: false }),            // raycast target only
  );
  shelf.position.set(5.82, 1.3, 0.2);
  shelf.name = 'Bookshelf';
  group.add(shelf);
  // all 44 real library books get individual titled spines across the upper
  // three shelves: look at one and press E to open exactly that book
  const titledBooks: Array<{ mesh: THREE.Mesh; book: Book }> = [];
  {
    const ROWS = [2.43, 1.93, 1.43];
    const perRow = Math.ceil(BOOKS.length / ROWS.length);
    let z = -0.92;
    BOOKS.forEach((book, i) => {
      const h = 0.26 + ((i * 7) % 5) * 0.012;
      const thick = 0.052 + ((i * 3) % 3) * 0.008;
      if (i > 0 && i % perRow === 0) z = -0.92;
      const y = ROWS[Math.floor(i / perRow)];
      // a lived-in shelf: most stand (slightly askew), some lean, some lie flat
      let style = (i * 13) % 10;
      // overflow guards: keep every spine inside the bay (side panel at z=1.375)
      if (style < 2 && z + h > 1.18) style = 9;          // no room to lie down
      if (z + thick > 1.30) z = 1.30 - thick;            // clamp the last one
      const coverMat = new THREE.MeshLambertMaterial({
        color: new THREE.Color(book.spine).multiplyScalar(0.75),
      });
      const spineMat = new THREE.MeshLambertMaterial({ map: makeSpineTexture(book) });
      let cover: THREE.Mesh;
      if (style < 2) {
        // lying flat, spine facing the room, title reading sideways
        cover = new THREE.Mesh(new THREE.BoxGeometry(0.16, thick, h), coverMat);
        cover.position.set(5.72, y + thick / 2 + 0.005, z + h / 2);
        const spine = new THREE.Mesh(
          new THREE.PlaneGeometry(thick - 0.004, h - 0.004), spineMat);
        spine.rotation.set(0, -Math.PI / 2, Math.PI / 2);
        spine.position.set(5.72 - 0.082, y + thick / 2 + 0.005, z + h / 2);
        group.add(spine);
        z += h + 0.02;
      } else {
        const lean = style < 4 ? (style === 2 ? 0.16 : -0.13) : (Math.random() - 0.5) * 0.05;
        if (Math.abs(lean) > 0.1) z += 0.055;            // swing clearance before
        cover = new THREE.Mesh(new THREE.BoxGeometry(0.16, h, thick), coverMat);
        cover.rotation.set(0, Math.PI / 2 + (Math.random() - 0.5) * 0.1, lean);
        cover.position.set(5.72, y + h / 2 + 0.008, z);
        const spine = new THREE.Mesh(
          new THREE.PlaneGeometry(thick - 0.004, h - 0.004), spineMat);
        spine.rotation.set(0, -Math.PI / 2, lean);
        spine.position.set(
          5.72 - 0.082,
          y + h / 2 + 0.008,
          z - Math.sin(lean) * h * 0.5 * 0.4, // spine follows the lean roughly
        );
        group.add(spine);
        z += thick + 0.016 + (Math.abs(lean) > 0.1 ? 0.055 : 0)
          + (Math.random() < 0.2 ? 0.05 : 0);            // swing clearance after
      }
      cover.name = `Book:${book.id}`;
      group.add(cover);
      titledBooks.push({ mesh: cover, book });
    });
  }
  // the golden dev-log shard: one bright archive chip among the data trays
  const devlogShard = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.13, 0.022),
    new THREE.MeshStandardMaterial({
      color: 0x05060a, emissive: 0xffd24d, emissiveIntensity: 2.2,
    }),
  );
  devlogShard.position.set(5.68, 1.17, 1.18);
  devlogShard.rotation.x = -0.15;
  devlogShard.name = 'DevlogShard';
  group.add(devlogShard);
  animated.push((t) => {
    (devlogShard.material as THREE.MeshStandardMaterial).emissiveIntensity =
      1.8 + 0.8 * Math.sin(t * 2.2);
  });
  // data-shard racks on the lower two shelves: glowing slats in dark trays
  for (const shelfY of [0.43, 0.93]) {
    box(0.3, 0.06, 2.0, matDark, 5.72, shelfY + 0.03, 0.2);
    for (let i = 0; i < 14; i++) {
      const hue = [0x5af2ff, 0xff2bdb, 0x39ff88, 0xffe14d][i % 4];
      const lit = Math.random() > 0.3;
      const shard = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.1, 0.018),
        lit
          ? new THREE.MeshStandardMaterial({ color: 0x05060a, emissive: hue, emissiveIntensity: 1.3 })
          : matDark,
      );
      shard.position.set(5.7, shelfY + 0.12, -0.72 + i * 0.135);
      shard.rotation.x = (Math.random() - 0.5) * 0.1;
      group.add(shard);
    }
  }
  strip(0.03, 2.5, 0.03, 0x5af2ff, 5.55, 1.3, -1.05, 1.2);
  // invisible interact targets over each shard tray
  const trayProxy = (y: number, name: string) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.2, 2.0),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    m.position.set(5.68, y, 0.2);
    m.name = name;
    group.add(m);
    return m;
  };
  const shardTrayArt = trayProxy(1.05, 'ShardTrayArt');
  const shardTrayAudio = trayProxy(0.55, 'ShardTrayAudio');

  // (solid arcade cabinets replaced by the holographic arcade in props/arcade.ts)

  // (vending machine evicted — it kept blocking the path between the stairs
  //  and the entry door; two strikes, it's out)

  // ---------- plants by the window ----------
  for (const [px, pz] of [[-3.4, 6.3], [3.6, 6.35], [5.5, 5.8]] as const) {
    box(0.4, 0.45, 0.4, matDark, px, 0.225, pz);
    const foliage = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.42, 1),
      new THREE.MeshLambertMaterial({ color: 0x1d4d34 }),
    );
    foliage.position.set(px, 0.85, pz);
    foliage.scale.y = 1.5;
    group.add(foliage);
  }

  // ---------- mezzanine bedroom ----------
  solid(2.3, 0.45, 1.7, matFabric, -3.6, MEZZ_Y + 0.225, -5.6);    // bed platform
  const matSheets = new THREE.MeshLambertMaterial({ color: 0xc9cede, map: makeFabricTexture(0x394257) });
  box(2.1, 0.18, 1.5, matSheets, -3.6, MEZZ_Y + 0.54, -5.6);       // mattress
  box(0.6, 0.1, 0.4, new THREE.MeshLambertMaterial({ color: 0x4a5570 }), -4.2, MEZZ_Y + 0.68, -5.9);
  strip(2.3, 0.04, 0.04, 0xb44dff, -3.6, MEZZ_Y + 0.05, -4.72, 1.8); // bed underglow
  box(0.5, 0.5, 0.4, matFurn, -2.2, MEZZ_Y + 0.25, -6.3);          // side table
  // (Bedside lamp replaced with a star projector — see starProjector block below.)
  solid(2.0, 1.3, 0.4, matFurn, 3.4, MEZZ_Y + 0.65, -6.6);         // dresser
  // wall art with neon frame
  strip(1.5, 0.9, 0.04, 0x8a2be2, -3.6, MEZZ_Y + 1.9, -6.84, 0.7);

  // ---------- bedside star projector (replaces the plain glow strip lamp) ----------
  // Sits on the side table at (-2.2, MEZZ_Y + 0.5, -6.3). E cycles modes:
  //   off → 賽博全息 → 營火暖光 → 古典星象 → off
  // A faint additive cone of light goes from the lens up to a textured plane
  // pinned just below the ceiling (y=5.99). Each mode redraws the plane's
  // canvas in animated.push().
  const PROJ_X = -2.2, PROJ_Y_BASE = MEZZ_Y + 0.5, PROJ_Z = -6.3;
  const projBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.085, 0.10, 0.05, 18),
    new THREE.MeshStandardMaterial({ color: 0x05060a, metalness: 0.6, roughness: 0.45 }),
  );
  projBase.position.set(PROJ_X, PROJ_Y_BASE + 0.025, PROJ_Z);
  group.add(projBase);
  const projDome = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x0c0e1e, metalness: 0.55, roughness: 0.35 }),
  );
  projDome.position.set(PROJ_X, PROJ_Y_BASE + 0.05, PROJ_Z);
  projDome.name = 'StarProjector';
  group.add(projDome);
  // lens (cycles colour by mode)
  const projLensMat = new THREE.MeshBasicMaterial({
    color: 0x5af2ff, transparent: true, opacity: 0,
  });
  const projLens = new THREE.Mesh(new THREE.CircleGeometry(0.05, 20), projLensMat);
  projLens.rotation.x = -Math.PI / 2;
  projLens.position.set(PROJ_X, PROJ_Y_BASE + 0.122, PROJ_Z);
  group.add(projLens);
  // LED ring around base
  const projRingMat = new THREE.MeshBasicMaterial({ color: 0x5af2ff });
  const projRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.094, 0.005, 6, 28), projRingMat,
  );
  projRing.rotation.x = Math.PI / 2;
  projRing.position.set(PROJ_X, PROJ_Y_BASE + 0.005, PROJ_Z);
  group.add(projRing);

  // beam cone — additive blending semi-transparent "light shaft"
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0x88c8ff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const beamH = 5.99 - (PROJ_Y_BASE + 0.122);
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(0.78, beamH, 18, 1, true), beamMat,
  );
  beam.rotation.x = Math.PI;       // tip points down at the projector
  beam.position.set(PROJ_X, PROJ_Y_BASE + 0.122 + beamH / 2, PROJ_Z);
  beam.visible = false;
  group.add(beam);

  // ceiling projection plane — canvas-driven
  const projCanvas = document.createElement('canvas');
  projCanvas.width = 1024; projCanvas.height = 1024;
  const projTex = new THREE.CanvasTexture(projCanvas);
  projTex.colorSpace = THREE.SRGBColorSpace;
  const projPlaneMat = new THREE.MeshBasicMaterial({
    map: projTex, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const projPlane = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), projPlaneMat);
  projPlane.rotation.x = Math.PI / 2;
  projPlane.position.set(PROJ_X, 5.985, PROJ_Z);
  projPlane.visible = false;
  group.add(projPlane);

  type ProjMode = 'off' | 'cyber' | 'cozy' | 'planet';
  let projMode: ProjMode = 'off';
  const PROJ_LABELS: Record<ProjMode, string> = {
    off: '熄滅', cyber: '賽博全息', cozy: '營火暖光', planet: '古典星象',
  };
  const PROJ_TINTS: Record<ProjMode, { lens: number; beam: number }> = {
    off:    { lens: 0x000000, beam: 0x000000 },
    cyber:  { lens: 0x5af2ff, beam: 0x88c8ff },
    cozy:   { lens: 0xffb070, beam: 0xff9050 },
    planet: { lens: 0xc0e0ff, beam: 0xa0c0ff },
  };

  const cycleProjector = (): string => {
    const order: ProjMode[] = ['off', 'cyber', 'cozy', 'planet'];
    projMode = order[(order.indexOf(projMode) + 1) % order.length];
    const tint = PROJ_TINTS[projMode];
    projLensMat.color.setHex(tint.lens);
    projRingMat.color.setHex(tint.lens === 0x000000 ? 0x102030 : tint.lens);
    beamMat.color.setHex(tint.beam);
    return PROJ_LABELS[projMode];
  };

  animated.push((t) => {
    const on = projMode !== 'off';
    beam.visible = on;
    projPlane.visible = on;
    if (!on) {
      projLensMat.opacity = 0;
      beamMat.opacity = 0;
      projPlaneMat.opacity = 0;
      return;
    }
    // breathing intensities — the projector "lives"
    const flicker = 0.85 + 0.10 * Math.sin(t * 11) + 0.05 * Math.sin(t * 3.7);
    projLensMat.opacity = 0.9 * flicker;
    beamMat.opacity = 0.10 * flicker;
    projPlaneMat.opacity = 0.78 * flicker;

    const g = projCanvas.getContext('2d')!;
    g.clearRect(0, 0, 1024, 1024);

    if (projMode === 'cyber') {
      // Star Wars hologram blue — dark navy + scanlines + planet outline + stars
      g.fillStyle = 'rgba(2, 8, 28, 0.95)';
      g.fillRect(0, 0, 1024, 1024);
      // sweeping scan
      const scanY = (t * 220) % 1024;
      const grad = g.createLinearGradient(0, scanY - 40, 0, scanY + 40);
      grad.addColorStop(0, 'rgba(120,200,255,0)');
      grad.addColorStop(0.5, 'rgba(140,220,255,0.4)');
      grad.addColorStop(1, 'rgba(120,200,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, scanY - 40, 1024, 80);
      // hologram grid
      g.strokeStyle = 'rgba(80,160,220,0.10)';
      g.lineWidth = 1;
      for (let i = 0; i < 1024; i += 32) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 1024); g.stroke();
        g.beginPath(); g.moveTo(0, i); g.lineTo(1024, i); g.stroke();
      }
      // many tiny stars
      for (let i = 0; i < 110; i++) {
        const seed = i * 73 + 13;
        const x = (seed * 31) % 1024;
        const y = (seed * 47) % 1024;
        const fl = 0.4 + 0.6 * Math.sin(t * 2 + i * 0.7);
        g.fillStyle = `rgba(190,220,255,${(fl * 0.9).toFixed(3)})`;
        const sz = 1 + (i % 3);
        g.fillRect(x, y, sz, sz);
      }
      // central planet outline + orbital ring
      g.strokeStyle = '#5af2ff'; g.lineWidth = 2;
      g.shadowColor = '#5af2ff'; g.shadowBlur = 14;
      g.beginPath(); g.arc(512, 512, 160, 0, Math.PI * 2); g.stroke();
      // ring tilted, slowly rotating
      g.lineWidth = 1.4;
      g.strokeStyle = 'rgba(170,220,255,0.7)';
      g.beginPath();
      g.ellipse(512, 512, 280, 60, t * 0.18, 0, Math.PI * 2);
      g.stroke();
      // moon
      const mx = 512 + Math.cos(t * 0.45) * 280;
      const my = 512 + Math.sin(t * 0.45) * 60;
      g.fillStyle = '#a0e8ff';
      g.beginPath(); g.arc(mx, my, 7, 0, Math.PI * 2); g.fill();
      g.shadowBlur = 0;
    } else if (projMode === 'cozy') {
      // warm radial bloom + flickering embers
      const grad = g.createRadialGradient(512, 512, 30, 512, 512, 480);
      grad.addColorStop(0, 'rgba(255, 200, 110, 0.78)');
      grad.addColorStop(0.4, 'rgba(255, 130, 50, 0.45)');
      grad.addColorStop(1, 'rgba(40,10,5,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 1024, 1024);
      // logs (dark central shape)
      g.fillStyle = 'rgba(50, 25, 15, 0.6)';
      g.beginPath();
      g.ellipse(512, 540, 130, 28, 0.1, 0, Math.PI * 2); g.fill();
      g.beginPath();
      g.ellipse(512, 520, 100, 22, -0.2, 0, Math.PI * 2); g.fill();
      // embers swirling
      for (let i = 0; i < 70; i++) {
        const seed = i * 91 + 7;
        const baseX = 200 + (seed * 31) % 624;
        const baseY = 200 + (seed * 53) % 624;
        const sway = Math.sin(t * 1.5 + i * 0.7) * 30;
        const x = baseX + sway;
        const y = baseY + Math.cos(t * 0.8 + i) * 22;
        const fl = 0.35 + 0.65 * Math.sin(t * 4 + i * 0.5);
        const r = 4 + fl * 3;
        const eg = g.createRadialGradient(x, y, 0, x, y, r);
        eg.addColorStop(0, `rgba(255, 230, 110, ${fl.toFixed(3)})`);
        eg.addColorStop(1, 'rgba(255, 90, 30, 0)');
        g.fillStyle = eg;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
    } else { // planet (classic planetarium)
      g.fillStyle = 'rgba(2, 4, 12, 0.96)';
      g.fillRect(0, 0, 1024, 1024);
      // milky way band
      g.save();
      g.translate(512, 512); g.rotate(-0.4);
      const mw = g.createLinearGradient(-512, 0, 512, 0);
      mw.addColorStop(0, 'rgba(120,140,200,0)');
      mw.addColorStop(0.5, 'rgba(180,200,255,0.18)');
      mw.addColorStop(1, 'rgba(120,140,200,0)');
      g.fillStyle = mw;
      g.fillRect(-512, -70, 1024, 140);
      g.restore();
      // dense star field
      for (let i = 0; i < 280; i++) {
        const seed = i * 53 + 11;
        const x = (seed * 31) % 1024;
        const y = (seed * 47) % 1024;
        const fl = 0.5 + 0.5 * Math.sin(t * 1.5 + i);
        const sz = i % 30 === 0 ? 3 : 1;
        g.fillStyle = `rgba(240,240,255,${(fl * 0.85).toFixed(3)})`;
        g.fillRect(x, y, sz, sz);
      }
      // Orion-ish constellation
      const pts: Array<[number, number]> = [
        [380, 380], [440, 460], [500, 500], [560, 460], [620, 380],
        [580, 520], [560, 600], [500, 660], [440, 600], [420, 520],
      ];
      g.strokeStyle = 'rgba(200,220,255,0.45)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.stroke();
      for (const [px, py] of pts) {
        const fl = 0.7 + 0.3 * Math.sin(t * 2 + px);
        g.fillStyle = `rgba(255,245,225,${fl.toFixed(3)})`;
        g.beginPath(); g.arc(px, py, 3, 0, Math.PI * 2); g.fill();
      }
    }
    projTex.needsUpdate = true;
  });
  const starProjector = { hit: projDome, cycle: cycleProjector,
    isOn: () => projMode !== 'off',
    currentMode: () => projMode as string };

  // ---------- mezz neon wall décor (cyberpunk sleeping area) ----------
  // 1) Synthwave SUN above the bed — 8 horizontal bars in semicircle, gradient
  //    orange (horizon) → magenta (zenith). On the back wall just above the bed.
  {
    const SUN_R = 0.5;
    const SUN_BARS = 8;
    const SUN_CX = -3.6, SUN_CY = MEZZ_Y + 1.7, SUN_Z = -6.83;
    for (let i = 0; i < SUN_BARS; i++) {
      const t = i / (SUN_BARS - 1);                 // 0 horizon → 1 zenith
      const y = SUN_CY + t * SUN_R * 0.92;
      const dy = y - SUN_CY;
      const halfW = Math.sqrt(Math.max(0, SUN_R * SUN_R - dy * dy));
      // gradient: 0xff8a3d (orange) → 0xff2bdb (magenta)
      const r = Math.round(255 * (1 - t * 0.0));
      const g = Math.round((1 - t) * 138 + t * 43);
      const b = Math.round((1 - t) * 61  + t * 219);
      const color = (r << 16) | (g << 8) | b;
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(halfW * 2, 0.032, 0.020),
        new THREE.MeshStandardMaterial({
          color: 0x05060a, emissive: color, emissiveIntensity: 2.0, roughness: 0.4,
        }),
      );
      bar.position.set(SUN_CX, y, SUN_Z);
      group.add(bar);
    }
  }

  // 2) Floating CJK character 夢 (dream) — canvas-textured plane with bloom
  {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 256, 256);
    ctx.font = 'bold 196px serif';
    ctx.fillStyle = '#5af2ff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#5af2ff';
    ctx.shadowBlur = 32;
    ctx.fillText('夢', 128, 138);
    // pass again — multiple shadowed strokes deepen the bloom
    ctx.shadowBlur = 12;
    ctx.fillText('夢', 128, 138);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const dream = new THREE.Mesh(
      new THREE.PlaneGeometry(0.55, 0.55),
      new THREE.MeshBasicMaterial({
        map: tex, transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    dream.position.set(-3.6, MEZZ_Y + 0.55, -6.83);
    group.add(dream);
  }

  // 3) Three vertical neon tube columns on the left wall beside the bed
  //    (cyan / magenta / purple — synthwave gradient)
  for (let i = 0; i < 3; i++) {
    const z = -5.8 + i * 0.55;                      // -5.8, -5.25, -4.70
    const color = [0x5af2ff, 0xff2bdb, 0xb44dff][i];
    strip(0.04, 1.3, 0.04, color, -5.83, MEZZ_Y + 1.0, z, 2.2);
  }

  // ---------- bathroom pod (under the mezzanine, right-back corner) ----------
  // capsule look from outside: frosted panel + neon edge strips (no real
  // transmission material — too costly on iGPU)
  const BA_X0 = 2.6, BA_Z1 = -3.9; // west wall plane / south wall plane
  const matFrost = new THREE.MeshStandardMaterial({
    color: 0x8fa3c8, transparent: true, opacity: 0.32, roughness: 0.85, metalness: 0.05,
    side: THREE.DoubleSide,
  });
  // privacy glass: senses occupancy — frosted → fully opaque while you're inside
  let privTarget = 0;
  let privAmount = 0;
  const frostClear = new THREE.Color(0x8fa3c8);
  const frostSolid = new THREE.Color(0x39414f);
  animated.push(() => {
    privAmount += (privTarget - privAmount) * 0.06;
    matFrost.opacity = 0.32 + 0.66 * privAmount;
    matFrost.color.lerpColors(frostClear, frostSolid, privAmount);
  });
  // west wall with door opening (door slides between z -4.9..-4.1)
  solid(0.12, 2.9, 2.0, matWall, BA_X0, 1.45, -5.9);     // back segment of west wall
  solid(0.12, 2.9, 0.2, matWall, BA_X0, 1.45, -4.0);     // front sliver beside door
  solid(0.12, 0.7, 0.8, matWall, BA_X0, 2.55, -4.5);     // header above door
  // south wall: frosted glass with neon edge
  const frostPanel = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 2.9), matFrost);
  frostPanel.position.set((BA_X0 + W/2) / 2 + 0.05, 1.45, BA_Z1);
  group.add(frostPanel);
  blocker(3.3, 2.9, 0.12, (BA_X0 + W/2) / 2 + 0.05, 1.45, BA_Z1);
  strip(3.3, 0.04, 0.04, 0x5af2ff, (BA_X0 + W/2) / 2 + 0.05, 2.86, BA_Z1 + 0.04, 1.6);
  strip(0.04, 2.86, 0.04, 0x5af2ff, BA_X0 + 0.06, 1.45, BA_Z1 + 0.04, 1.6);
  // sliding door (animated; collision box mutates when open)
  const doorMat = new THREE.MeshStandardMaterial({
    color: 0x49566f, transparent: true, opacity: 0.55, roughness: 0.6, metalness: 0.3,
  });
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.5, 0.82), doorMat);
  door.position.set(BA_X0, 1.25, -4.5);
  door.name = 'BathroomDoor';
  group.add(door);
  strip(0.03, 2.4, 0.03, 0xff2bdb, BA_X0 + 0.05, 1.25, -4.12, 1.4); // door edge glow
  const doorAABB: AABB = {
    min: new THREE.Vector3(BA_X0 - 0.2, 0, -4.92),
    max: new THREE.Vector3(BA_X0 + 0.2, 2.5, -4.08),
  };
  walls.push(doorAABB);
  let doorOpen = false;
  let doorZ = -4.5;
  const toggleDoor = (): boolean => {
    doorOpen = !doorOpen;
    if (doorOpen) {
      // park the collision box far away while the doorway is passable
      doorAABB.min.set(9999, 9999, 9999);
      doorAABB.max.set(9999, 9999, 9999);
    } else {
      doorAABB.min.set(BA_X0 - 0.2, 0, -4.92);
      doorAABB.max.set(BA_X0 + 0.2, 2.5, -4.08);
    }
    return doorOpen;
  };
  animated.push(() => {
    const target = doorOpen ? -5.36 : -4.5;
    doorZ += (target - doorZ) * 0.14;
    door.position.z = doorZ;
  });

  // toilet (right-back corner inside)
  solid(0.55, 0.42, 0.45, matFurn, 5.45, 0.21, -6.45);            // base
  const toiletSeat = new THREE.Mesh(
    new THREE.CylinderGeometry(0.21, 0.18, 0.08, 14),
    new THREE.MeshLambertMaterial({ color: 0xb9c2d8 }),
  );
  toiletSeat.position.set(5.45, 0.46, -6.35);
  toiletSeat.name = 'Toilet';
  group.add(toiletSeat);
  box(0.5, 0.5, 0.18, matFurn, 5.45, 0.65, -6.78);                // tank
  strip(0.3, 0.03, 0.02, 0x39ff88, 5.45, 0.92, -6.68, 1.5);       // flush panel glow

  // smart-mirror basin
  solid(0.5, 0.8, 0.42, matFurn, 3.3, 0.4, -6.6);
  const bowl = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.14, 0.1, 14),
    new THREE.MeshStandardMaterial({ color: 0x9aa6c0, metalness: 0.6, roughness: 0.25 }),
  );
  bowl.position.set(3.3, 0.86, -6.6);
  group.add(bowl);
  // live smart-mirror HUD: clock + fictional NC weather + real local weather
  const mirrorCanvas = document.createElement('canvas');
  mirrorCanvas.width = 256; mirrorCanvas.height = 360;
  const mirrorTex = new THREE.CanvasTexture(mirrorCanvas);
  mirrorTex.colorSpace = THREE.SRGBColorSpace;
  let realWeather: RealWeather | null = null;
  let realWeatherFailed = false;
  let newsTitles: string[] = [];
  let newsIdx = 0;
  const drawMirror = () => {
    const g = mirrorCanvas.getContext('2d')!;
    g.clearRect(0, 0, 256, 360); // transparent: the real reflection shows through
    g.strokeStyle = 'rgba(90,242,255,.5)'; g.lineWidth = 2;
    g.strokeRect(4, 4, 248, 352);
    // translucent backing panels keep text readable over the reflection
    g.fillStyle = 'rgba(8,12,20,.62)';
    g.fillRect(10, 12, 236, 120);
    g.fillRect(10, 140, 236, 70);
    g.fillRect(10, 286, 236, 62);
    g.fillStyle = 'rgba(90,242,255,.95)';
    g.font = 'bold 38px monospace'; g.textAlign = 'left';
    g.fillText(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), 22, 54);
    g.font = '13px monospace';
    g.fillStyle = 'rgba(90,242,255,.85)';
    g.fillText('NIGHT CITY 17°C ☂92%', 22, 84);
    g.fillStyle = 'rgba(255,225,77,.9)';
    if (realWeather) {
      g.fillText(`${realWeather.city} ${realWeather.tempC.toFixed(0)}°C ${realWeather.desc}`, 22, 106);
      g.fillText(`濕度 ${realWeather.humidity}%`, 22, 124);
    } else {
      g.fillText(realWeatherFailed ? '⛔ 連線被 ICE 攔截' : '定位中…', 22, 106);
    }
    // rotating local headline
    g.fillStyle = 'rgba(255,43,219,.85)';
    g.font = 'bold 12px monospace';
    g.fillText('▌LOCAL FEED', 20, 158);
    g.fillStyle = 'rgba(220,235,255,.9)';
    g.font = '12px sans-serif';
    if (newsTitles.length > 0) {
      const title = newsTitles[newsIdx % newsTitles.length].replace(/\s*[-|–].{0,40}$/, '');
      g.fillText(title.slice(0, 17), 20, 178);
      if (title.length > 17) g.fillText(title.slice(17, 34), 20, 196);
    } else {
      g.fillText('擷取當地新聞中…', 20, 178);
    }
    g.fillStyle = 'rgba(255,43,219,.6)';
    g.font = '12px monospace';
    g.fillText('義體狀態 OK · 心率 -- bpm', 20, 310);
    g.fillText('REFLECT//v2 鏡像同步中', 20, 330);
    mirrorTex.needsUpdate = true;
  };
  drawMirror();
  let lastMirrorDraw = 0;
  animated.push((t) => {
    if (t - lastMirrorDraw > 9) {
      lastMirrorDraw = t;
      newsIdx++;
      drawMirror();
    }
  });

  // real reflection underneath the HUD (low-res target; main.ts culls by distance)
  const reflector = new Reflector(new THREE.PlaneGeometry(0.66, 0.9), {
    textureWidth: 256,
    textureHeight: 352,
    color: 0x8a93a8,
    clipBias: 0.003,
  });
  reflector.position.set(3.3, 1.8, -6.865);
  group.add(reflector);
  // HUD glass floats just in front of the reflective surface
  const mirror = new THREE.Mesh(
    new THREE.PlaneGeometry(0.66, 0.9),
    new THREE.MeshBasicMaterial({
      map: mirrorTex, transparent: true, depthWrite: false,
    }),
  );
  mirror.position.set(3.3, 1.8, -6.85);
  mirror.name = 'SmartMirror';
  group.add(mirror);

  // cyber-avatar: only exists inside the reflection (no first-person body)
  const avatar = new THREE.Group();
  const matBodySuit = new THREE.MeshLambertMaterial({ color: 0x141a28 }); // the outfit
  const matHead = new THREE.MeshLambertMaterial({ color: 0x1a1620 });    // stays put
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.62, 4, 10), matBodySuit);
  torso.position.y = 0.95;
  avatar.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), matHead);
  head.position.y = 1.58;
  avatar.add(head);
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.035, 0.04),
    new THREE.MeshBasicMaterial({ color: 0x5af2ff }),
  );
  visor.position.set(0, 1.6, -0.095); // avatar faces -z, matching yaw convention
  avatar.add(visor);
  const chest = new THREE.Mesh(
    new THREE.CircleGeometry(0.03, 10),
    new THREE.MeshBasicMaterial({ color: 0xff2bdb }),
  );
  chest.position.set(0, 1.18, -0.195);
  avatar.add(chest);
  for (const s of [-0.26, 0.26]) {                      // arms
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.5, 4, 8), matBodySuit);
    arm.position.set(s, 0.98, 0);
    avatar.add(arm);
  }
  avatar.visible = false; // shown only during the reflector's render pass
  group.add(avatar);
  {
    const orig = reflector.onBeforeRender.bind(reflector);
    reflector.onBeforeRender = (renderer, scene, camera, geom, mat, grp) => {
      avatar.visible = true;
      orig(renderer, scene, camera, geom, mat, grp);
      avatar.visible = false;
    };
  }
  strip(0.74, 0.03, 0.03, 0x5af2ff, 3.3, 2.3, -6.85, 1.8);         // mirror top light

  // shower corner with glass partition + steam (own material: stays frosted
  // even when the privacy wall goes opaque)
  const showerGlassA = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 2.4), matFrost.clone());
  showerGlassA.position.set(4.45, 1.2, -4.55);
  showerGlassA.rotation.y = Math.PI / 2;
  group.add(showerGlassA);
  blocker(0.1, 2.4, 1.1, 4.45, 1.2, -4.55);
  const showerHeadArm = box(0.05, 0.05, 0.4, matSteel, 5.3, 2.45, -4.6);
  showerHeadArm.name = 'ShowerArm';
  const showerHead = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.13, 0.05, 12),
    matSteel,
  );
  showerHead.position.set(5.3, 2.4, -4.42);
  showerHead.name = 'Shower';
  group.add(showerHead);
  box(0.02, 1.0, 0.02, matSteel, 5.55, 1.6, -4.3);                  // riser pipe
  // steam puffs (additive, animated when shower on)
  const steamGroup = new THREE.Group();
  const steamMat = new THREE.MeshBasicMaterial({
    color: 0xcfe2ff, transparent: true, opacity: 0.1,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  for (let i = 0; i < 5; i++) {
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18 + i * 0.05, 0), steamMat);
    puff.position.set(5.15 + (i % 2) * 0.2, 0.6 + i * 0.4, -4.5);
    steamGroup.add(puff);
  }
  steamGroup.visible = false;
  group.add(steamGroup);
  let showerOn = false;
  const toggleShower = (): boolean => {
    showerOn = !showerOn;
    steamGroup.visible = showerOn;
    return showerOn;
  };
  animated.push((t) => {
    if (!showerOn) return;
    steamGroup.children.forEach((p, i) => {
      p.position.y = 0.6 + ((t * 0.35 + i * 0.4) % 2.0);
      const m = (p as THREE.Mesh).material as THREE.MeshBasicMaterial;
      m.opacity = 0.13 * (1 - (p.position.y - 0.6) / 2.0);
      p.rotation.y = t * 0.5 + i;
    });
  });
  // bathroom interior lights + ceiling strip (user: it was too dim inside)
  const bathLight = new THREE.PointLight(0xfff0dd, 36, 7, 1.6);
  bathLight.position.set(4.3, 2.5, -5.4);
  group.add(bathLight);
  const mirrorLight = new THREE.PointLight(0xcfe2ff, 14, 4.5, 1.8);
  mirrorLight.position.set(3.3, 2.1, -6.2);
  group.add(mirrorLight);
  strip(1.6, 0.03, 0.03, 0xffffff, 4.3, 2.84, -5.4, 1.8);
  strip(1.6, 0.03, 0.03, 0xffffff, 3.4, 2.84, -4.6, 1.5);
  // towel bar
  box(0.03, 0.03, 0.7, matSteel, 2.72, 1.3, -5.6);
  box(0.02, 0.5, 0.55, new THREE.MeshLambertMaterial({ color: 0x7c5cd6 }), 2.74, 1.0, -5.6);

  // ---------- washing machine (kitchen run, next to the fridge) ----------
  solid(0.7, 0.85, 0.65, matSteel, 1.95, 0.425, -6.5);
  const washerDoor = new THREE.Mesh(
    new THREE.CircleGeometry(0.24, 20),
    new THREE.MeshStandardMaterial({
      color: 0x0a1020, metalness: 0.4, roughness: 0.2,
      emissive: 0x5af2ff, emissiveIntensity: 0.25,
    }),
  );
  washerDoor.position.set(1.95, 0.45, -6.17);
  washerDoor.name = 'Washer';
  group.add(washerDoor);
  const washerRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.25, 0.02, 8, 24),
    new THREE.MeshStandardMaterial({ color: 0x1c2233, metalness: 0.8, roughness: 0.3 }),
  );
  washerRing.position.copy(washerDoor.position);
  group.add(washerRing);
  // SONIC WASH label above the door — "this isn't your grandma's washer, it's a
  // sonic-cleaning capsule" lore touch.
  const sonicLabel = (() => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#02060a'; g.fillRect(0, 0, 256, 64);
    g.font = 'bold 22px sans-serif';
    g.fillStyle = '#5af2ff';
    g.shadowColor = '#5af2ff'; g.shadowBlur = 12;
    g.fillText('SONIC WASH', 32, 38);
    g.shadowBlur = 0;
    g.font = '11px monospace';
    g.fillStyle = '#39ff88';
    g.fillText('K3-Ultrasonic', 32, 56);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(
      new THREE.PlaneGeometry(0.36, 0.09),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true }),
    );
  })();
  sonicLabel.position.set(1.95, 0.78, -6.165);
  group.add(sonicLabel);
  let washing = 0;
  animated.push((t) => {
    if (washing > 0) {
      washing -= 1 / 60;
      (washerDoor.material as THREE.MeshStandardMaterial).emissiveIntensity =
        0.6 + 0.45 * Math.sin(t * 9);
      washerDoor.rotation.z = t * 6;
      if (washing <= 0) {
        (washerDoor.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.25;
      }
    }
  });
  washerDoor.userData.startWash = () => { washing = 20; };

  // ---------- entry door (left wall, between TV and arcade corner) ----------
  // a loft needs a way in: sliding blast door + keypad, opens onto a faux corridor
  const DOOR_Z = 3.72, DOOR_W = 0.92, DOOR_H = 2.25;
  // glowing corridor backdrop hidden in the wall recess
  const corridor = new THREE.Mesh(
    new THREE.PlaneGeometry(DOOR_W + 0.2, DOOR_H),
    new THREE.MeshStandardMaterial({
      color: 0x0c1018, emissive: 0x39ff88, emissiveIntensity: 0.25,
      emissiveMap: canvasTexture(128, 256, (g) => {
        g.fillStyle = '#000'; g.fillRect(0, 0, 128, 256);
        g.fillStyle = '#fff';
        for (let y = 20; y < 256; y += 48) g.fillRect(10, y, 108, 3); // corridor light bars
      }),
    }),
  );
  // wall is solid, so the whole assembly mounts proud of it; the recess plane
  // fakes corridor depth and the original wall AABB keeps blocking passage
  corridor.rotation.y = Math.PI / 2;
  corridor.position.set(-5.862, DOOR_H / 2, DOOR_Z);
  group.add(corridor);
  // frame
  box(0.12, 0.12, DOOR_W + 0.3, matDark, -5.82, DOOR_H + 0.06, DOOR_Z);
  box(0.12, DOOR_H, 0.1, matDark, -5.82, DOOR_H / 2, DOOR_Z - DOOR_W / 2 - 0.07);
  box(0.12, DOOR_H, 0.1, matDark, -5.82, DOOR_H / 2, DOOR_Z + DOOR_W / 2 + 0.07);
  const entryDoor = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, DOOR_H, DOOR_W),
    new THREE.MeshStandardMaterial({
      color: 0x2a3346, metalness: 0.75, roughness: 0.35,
      emissive: 0xff8a3d, emissiveIntensity: 0.12,
    }),
  );
  entryDoor.position.set(-5.8, DOOR_H / 2, DOOR_Z);
  entryDoor.name = 'EntryDoor';
  group.add(entryDoor);
  // keypad
  const keypad = strip(0.05, 0.14, 0.1, 0x39ff88, -5.78, 1.35, DOOR_Z + DOOR_W / 2 + 0.2, 1.4);
  keypad.name = 'Keypad';
  let entryOpen = false;
  let entryZ = DOOR_Z;
  const entryToggle = (): boolean => {
    entryOpen = !entryOpen;
    return entryOpen;
  };
  animated.push(() => {
    const target = entryOpen ? DOOR_Z - DOOR_W - 0.08 : DOOR_Z;
    entryZ += (target - entryZ) * 0.16;
    entryDoor.position.z = entryZ;
  });
  // delivery package (appears at the doorstep when the bell has rung)
  const pkg = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.26, 0.3),
    new THREE.MeshLambertMaterial({ color: 0x8a6d4a }),
  );
  const pkgTape = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 0.27, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x05060a, emissive: 0xff2bdb, emissiveIntensity: 0.8 }),
  );
  pkg.add(pkgTape);
  pkg.position.set(-5.55, 0.14, DOOR_Z);
  pkg.visible = false;
  pkg.name = 'Package';
  group.add(pkg);

  // ---------- wardrobe (mezzanine) — swaps the mirror avatar's accent color ----------
  const wardrobe = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.5),
    new THREE.MeshLambertMaterial({ color: 0x95a0bd, map: matFurn.map }));
  wardrobe.position.set(0.7, MEZZ_Y + 1.1, -6.6);
  wardrobe.name = 'Wardrobe';
  group.add(wardrobe);
  walls.push({
    min: new THREE.Vector3(0.1, MEZZ_Y, -6.85),
    max: new THREE.Vector3(1.3, MEZZ_Y + 2.2, -6.35),
  });
  const doorSeam = box(0.02, 2.0, 0.02, matDark, 0.7, MEZZ_Y + 1.1, -6.34);
  const doorAccent = strip(0.03, 1.9, 0.02, 0x5af2ff, 1.24, MEZZ_Y + 1.1, -6.33, 0.8);
  // mirror-door overlay: invisible by default. When the player changes outfit,
  // it flashes in over the wardrobe face (faked reflection via polished
  // metallic material) and fades out again. No real reflector — too costly
  // on iGPU when one's already running in the bathroom.
  const mirrorMat = new THREE.MeshStandardMaterial({
    color: 0xb8c6dd, metalness: 1.0, roughness: 0.06,
    transparent: true, opacity: 0,
    side: THREE.DoubleSide,
    envMapIntensity: 1.4,
  });
  const mirrorDoor = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 2.18), mirrorMat);
  mirrorDoor.position.set(0.7, MEZZ_Y + 1.1, -6.345);
  mirrorDoor.visible = false;
  group.add(mirrorDoor);
  // Stylized cyberpunk avatar painted onto the mirror — repainted on each
  // outfit cycle so the figure wears the chosen suit colour + accent.
  // Drawn from primitives (head, jacket silhouette, leg pants, gear).
  const avatarCanvas = document.createElement('canvas');
  avatarCanvas.width = 360; avatarCanvas.height = 760;
  const avatarSil = new THREE.CanvasTexture(avatarCanvas);
  avatarSil.colorSpace = THREE.SRGBColorSpace;
  const hexToCss = (h: number): string =>
    `#${h.toString(16).padStart(6, '0')}`;
  const paintAvatar = (
    type: 'biker' | 'trench' | 'military' | 'hooded' | 'kimono',
    suitHex: number, accentHex: number,
  ): void => {
    const g = avatarCanvas.getContext('2d')!;
    g.clearRect(0, 0, 360, 760);
    // background rim glow (soft halo behind the figure)
    const grd = g.createRadialGradient(180, 380, 80, 180, 380, 320);
    grd.addColorStop(0, `${hexToCss(accentHex)}33`);
    grd.addColorStop(1, 'transparent');
    g.fillStyle = grd;
    g.fillRect(0, 0, 360, 760);
    const suit = hexToCss(suitHex);
    const accent = hexToCss(accentHex);
    // skin tone (cool grey-blue under city lights)
    const skin = '#c8d4e0';
    // pants (always dark)
    const pants = '#1a1c28';

    // helpers
    const fill = (color: string, pts: [number, number][]): void => {
      g.fillStyle = color; g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.closePath(); g.fill();
    };
    const stroke = (color: string, w: number, pts: [number, number][]): void => {
      g.strokeStyle = color; g.lineWidth = w; g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.stroke();
    };

    // ---- head ----
    g.shadowColor = accent; g.shadowBlur = 16;
    g.fillStyle = skin;
    g.beginPath(); g.ellipse(180, 130, 52, 60, 0, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
    // hair / hood / helmet depending on outfit
    if (type === 'hooded') {
      // pulled-up hood covering top of head
      fill(suit, [[122, 110], [180, 50], [238, 110], [232, 155], [128, 155]]);
    } else if (type === 'kimono') {
      // bun + hair pins
      g.fillStyle = '#0a0810';
      g.beginPath(); g.arc(180, 78, 22, 0, Math.PI * 2); g.fill();
      g.fillStyle = accent;
      g.fillRect(168, 60, 6, 22);
    } else if (type === 'military') {
      // peaked cap
      fill('#1a1418', [[120, 92], [240, 92], [255, 76], [105, 76]]);
      fill(accent, [[120, 92], [240, 92], [240, 100], [120, 100]]);
    } else {
      // undercut hair: shaved sides + top wave
      g.fillStyle = '#0a0a14';
      g.beginPath(); g.ellipse(180, 88, 50, 38, 0, Math.PI, 0); g.fill();
      // single neon hair streak
      g.fillStyle = accent;
      g.fillRect(170, 56, 10, 30);
    }
    // cyber eye / visor line
    g.strokeStyle = accent; g.lineWidth = 3;
    g.shadowColor = accent; g.shadowBlur = 12;
    g.beginPath(); g.moveTo(140, 132); g.lineTo(220, 132); g.stroke();
    g.shadowBlur = 0;

    // ---- neck + shoulders ----
    fill(skin, [[166, 188], [194, 188], [200, 218], [160, 218]]);

    // ---- jacket / outerwear silhouette ----
    if (type === 'biker') {
      // short jacket, sharp shoulders, wide collar
      fill(suit, [
        [110, 222], [250, 222], [262, 252], [262, 405], [240, 415], [120, 415], [98, 405], [98, 252],
      ]);
      // open collar
      fill('#0a0a12', [[150, 218], [210, 218], [200, 270], [180, 290], [160, 270]]);
      // central zipper
      g.strokeStyle = accent; g.lineWidth = 4;
      g.beginPath(); g.moveTo(180, 270); g.lineTo(180, 410); g.stroke();
      // stud row
      g.fillStyle = accent;
      for (let i = 0; i < 5; i++) {
        g.beginPath(); g.arc(220, 280 + i * 26, 4, 0, Math.PI * 2); g.fill();
      }
      // shoulder piping
      stroke(accent, 3, [[112, 226], [98, 252]]);
      stroke(accent, 3, [[248, 226], [262, 252]]);
    } else if (type === 'trench') {
      // long trench, sash, wide lapels
      fill(suit, [
        [104, 220], [256, 220], [268, 250], [268, 540], [246, 560], [114, 560], [92, 540], [92, 250],
      ]);
      // lapels
      fill(accent, [[150, 222], [180, 280], [160, 360], [128, 290]]);
      fill(accent, [[210, 222], [180, 280], [200, 360], [232, 290]]);
      // sash / belt
      fill(accent, [[92, 390], [268, 390], [268, 412], [92, 412]]);
      // belt buckle
      g.fillStyle = '#0a0a12';
      g.fillRect(174, 388, 12, 26);
    } else if (type === 'military') {
      // medium length, epaulettes, double-row buttons
      fill(suit, [
        [110, 220], [250, 220], [262, 250], [262, 480], [240, 495], [120, 495], [98, 480], [98, 250],
      ]);
      // epaulettes
      fill(accent, [[100, 224], [148, 224], [150, 242], [102, 242]]);
      fill(accent, [[212, 224], [260, 224], [258, 242], [210, 242]]);
      // brass buttons two columns
      g.fillStyle = accent;
      for (let i = 0; i < 6; i++) {
        for (const x of [156, 204]) {
          g.beginPath(); g.arc(x, 260 + i * 36, 5, 0, Math.PI * 2); g.fill();
        }
      }
      // high standing collar
      fill(suit, [[150, 218], [210, 218], [212, 232], [148, 232]]);
    } else if (type === 'hooded') {
      // tech hoodie, drawstrings, neon side panels
      fill(suit, [
        [110, 222], [250, 222], [260, 254], [260, 430], [240, 442], [120, 442], [100, 430], [100, 254],
      ]);
      // hood drape on shoulders
      fill('#0a0a12', [[110, 222], [180, 270], [250, 222], [240, 240], [180, 280], [120, 240]]);
      // drawstrings
      stroke(accent, 3, [[164, 230], [164, 286]]);
      stroke(accent, 3, [[196, 230], [196, 286]]);
      // neon side panels
      g.fillStyle = accent;
      g.fillRect(100, 260, 6, 160);
      g.fillRect(254, 260, 6, 160);
      // kanji on chest
      g.fillStyle = accent; g.font = 'bold 28px serif';
      g.shadowColor = accent; g.shadowBlur = 12;
      g.fillText('夜', 158, 360);
      g.shadowBlur = 0;
    } else { // kimono
      fill(suit, [
        [90, 220], [270, 220], [288, 270], [276, 540], [254, 560], [106, 560], [84, 540], [72, 270],
      ]);
      // wide sleeves
      fill(suit, [[60, 240], [110, 250], [120, 420], [50, 410]]);
      fill(suit, [[300, 240], [250, 250], [240, 420], [310, 410]]);
      // obi sash
      fill(accent, [[84, 380], [276, 380], [276, 416], [84, 416]]);
      // V-neck stripes
      fill(accent, [[150, 218], [180, 300], [160, 380], [128, 290]]);
      fill(accent, [[210, 218], [180, 300], [200, 380], [232, 290]]);
    }

    // ---- pants / legs ----
    const legTop = (type === 'trench' || type === 'kimono' || type === 'military') ? 540 : 415;
    fill(pants, [
      [130, legTop], [180, legTop],
      [170, 740], [125, 740],
    ]);
    fill(pants, [
      [180, legTop], [230, legTop],
      [235, 740], [190, 740],
    ]);
    // accent stripes down legs
    stroke(accent, 3, [[140, legTop + 20], [134, 730]]);
    stroke(accent, 3, [[220, legTop + 20], [226, 730]]);

    // ---- boots ----
    g.fillStyle = '#080812';
    g.fillRect(116, 728, 60, 24);
    g.fillRect(184, 728, 60, 24);
    g.fillStyle = accent;
    g.fillRect(116, 750, 60, 4);
    g.fillRect(184, 750, 60, 4);

    avatarSil.needsUpdate = true;
  };
  // initial paint matches outfit index 0
  paintAvatar('biker', 0x141a28, 0x5af2ff);
  const silhouettePlane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.85, 1.9),
    new THREE.MeshBasicMaterial({
      map: avatarSil, transparent: true,
      blending: THREE.NormalBlending, depthWrite: false, opacity: 0,
    }),
  );
  silhouettePlane.position.set(0.7, MEZZ_Y + 1.0, -6.342);
  silhouettePlane.visible = false;
  group.add(silhouettePlane);

  // open rail with the actual outfits — each is a stylized jacket built from
  // primitives. Five distinct silhouettes match the OUTFITS list below.
  const OUTFITS: Array<[number, number, string, 'biker' | 'trench' | 'military' | 'hooded' | 'kimono']> = [
    [0x141a28, 0x5af2ff, '夜行黑 × 電氣青 (機車夾克)', 'biker'],
    [0x2a1230, 0xff2bdb, '暗紫 × 霓紅粉 (長版風衣)', 'trench'],
    [0x2e2618, 0xffd24d, '軍墨 × 鍍金 (軍式大衣)', 'military'],
    [0x102218, 0x39ff88, '叢林綠 × 駭客綠 (連帽外套)', 'hooded'],
    [0x301518, 0xff5566, '猩紅 × 警示紅 (霓虹和服)', 'kimono'],
  ];

  const buildJacket = (type: typeof OUTFITS[0][3], suit: number, accent: number): THREE.Group => {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: suit });
    const accentMat = new THREE.MeshBasicMaterial({ color: accent });
    switch (type) {
      case 'biker': {
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.46, 0.05), bodyMat);
        body.position.y = -0.05; g.add(body);
        const collar = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.07, 0.055), bodyMat);
        collar.position.y = 0.215; g.add(collar);
        const zip = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.44, 0.006), accentMat);
        zip.position.set(0, -0.05, 0.029); g.add(zip);
        for (const dx of [-0.12, 0.12]) {
          const epaul = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.014, 0.006), accentMat);
          epaul.position.set(dx, 0.17, 0.029); g.add(epaul);
        }
        // zipper studs along front
        for (let j = 0; j < 4; j++) {
          const stud = new THREE.Mesh(new THREE.CircleGeometry(0.006, 8), accentMat);
          stud.position.set(0.06, 0.1 - j * 0.10, 0.030);
          g.add(stud);
        }
        break;
      }
      case 'trench': {
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.84, 0.07), bodyMat);
        body.position.y = -0.25; g.add(body);
        const lapL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.32, 0.04), accentMat);
        lapL.position.set(-0.085, 0.06, 0.038); lapL.rotation.z = -0.18; g.add(lapL);
        const lapR = lapL.clone();
        lapR.position.x = 0.085; lapR.rotation.z = 0.18; g.add(lapR);
        const belt = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.038, 0.072), accentMat);
        belt.position.y = -0.18; g.add(belt);
        // standing collar
        const collar = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 0.06), bodyMat);
        collar.position.y = 0.22; g.add(collar);
        break;
      }
      case 'military': {
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.66, 0.06), bodyMat);
        body.position.y = -0.15; g.add(body);
        for (const dx of [-0.135, 0.135]) {
          const epaul = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.022, 0.075), accentMat);
          epaul.position.set(dx, 0.18, 0); g.add(epaul);
        }
        // brass buttons in two columns
        for (let j = 0; j < 4; j++) {
          for (const dx of [-0.05, 0.05]) {
            const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.005, 10), accentMat);
            btn.rotation.x = Math.PI / 2;
            btn.position.set(dx, 0.1 - j * 0.13, 0.034); g.add(btn);
          }
        }
        // standing high collar
        const collar = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.07, 0.07), bodyMat);
        collar.position.y = 0.225; g.add(collar);
        break;
      }
      case 'hooded': {
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.54, 0.06), bodyMat);
        body.position.y = -0.10; g.add(body);
        // hood (rounded-ish: box + small cylinder cap)
        const hood = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.18, 0.12), bodyMat);
        hood.position.y = 0.27; g.add(hood);
        const hoodTop = new THREE.Mesh(new THREE.SphereGeometry(0.10, 12, 8), bodyMat);
        hoodTop.position.set(0, 0.30, 0.0); hoodTop.scale.y = 0.7; g.add(hoodTop);
        // neon trim down both sides + drawstring tips
        for (const dx of [-0.16, 0.16]) {
          const trim = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.5, 0.005), accentMat);
          trim.position.set(dx, -0.10, 0.032); g.add(trim);
        }
        for (const dx of [-0.04, 0.04]) {
          const string_ = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.18, 6), accentMat);
          string_.position.set(dx, 0.10, 0.033); g.add(string_);
        }
        break;
      }
      case 'kimono': {
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.72, 0.05), bodyMat);
        body.position.y = -0.20; g.add(body);
        // wide sleeves flaring out
        const sleeveL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.45, 0.04), bodyMat);
        sleeveL.position.set(-0.21, -0.13, 0); sleeveL.rotation.z = -0.12; g.add(sleeveL);
        const sleeveR = sleeveL.clone();
        sleeveR.position.x = 0.21; sleeveR.rotation.z = 0.12; g.add(sleeveR);
        // obi (waist sash)
        const obi = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.10, 0.054), accentMat);
        obi.position.y = -0.05; g.add(obi);
        // V-neck stripes
        const collarL = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.22, 0.005), accentMat);
        collarL.position.set(-0.06, 0.13, 0.027); collarL.rotation.z = 0.18; g.add(collarL);
        const collarR = collarL.clone();
        collarR.position.x = 0.06; collarR.rotation.z = -0.18; g.add(collarR);
        break;
      }
    }
    return g;
  };

  // The rail + hanging jackets are kept in scene but HIDDEN behind the closed
  // wardrobe door — the user found the boxy procedural jackets unattractive.
  // Visible state is replaced by the painted cyberpunk avatar on the mirror
  // (see paintAvatar above). Keeping the jackets array around lets future
  // work re-enable them with proper GLB models if we ever drop one in.
  const wardrobeRail = box(0.03, 0.03, 1.1, matSteel, 1.95, MEZZ_Y + 1.95, -6.6);
  wardrobeRail.visible = false;
  const jackets: THREE.Object3D[] = [];
  OUTFITS.forEach(([suit, accent, , type], i) => {
    const jz = -6.78 + 0.18 * i;
    const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.1, 6), matSteel);
    hanger.position.set(1.95, MEZZ_Y + 1.89, jz);
    hanger.visible = false;
    group.add(hanger);
    const jacket = buildJacket(type, suit, accent);
    jacket.position.set(1.95, MEZZ_Y + 1.56, jz);
    jacket.visible = false;
    group.add(jacket);
    jackets.push(jacket);
  });
  let outfitIdx = 0;

  // mirror animation state — triggered by cycleOutfit, driven by animated tick.
  let mirrorTriggerArmed = false;
  let mirrorStartT = -10;
  const MIRROR_UP = 0.35, MIRROR_HOLD = 1.6, MIRROR_DOWN = 0.6;
  animated.push((t) => {
    if (mirrorTriggerArmed) { mirrorStartT = t; mirrorTriggerArmed = false; }
    const dt = t - mirrorStartT;
    let op = 0;
    if (dt < 0) op = 0;
    else if (dt < MIRROR_UP) op = dt / MIRROR_UP;
    else if (dt < MIRROR_UP + MIRROR_HOLD) op = 1;
    else if (dt < MIRROR_UP + MIRROR_HOLD + MIRROR_DOWN)
      op = 1 - (dt - MIRROR_UP - MIRROR_HOLD) / MIRROR_DOWN;
    else op = 0;
    mirrorMat.opacity = op;
    mirrorDoor.visible = op > 0.01;
    (silhouettePlane.material as THREE.MeshBasicMaterial).opacity = op * 0.9;
    silhouettePlane.visible = op > 0.01;
    // hide the seam & accent strip behind the mirror while it's fully up
    const hideDoorFurn = op > 0.4;
    doorSeam.visible = !hideDoorFurn;
    doorAccent.visible = !hideDoorFurn;
  });

  const cycleOutfit = (): string => {
    outfitIdx = (outfitIdx + 1) % OUTFITS.length;
    const [suit, accent, name, type] = OUTFITS[outfitIdx];
    matBodySuit.color.setHex(suit);
    (visor.material as THREE.MeshBasicMaterial).color.setHex(accent);
    (chest.material as THREE.MeshBasicMaterial).color.setHex(accent);
    paintAvatar(type, suit, accent);              // repaint mirror avatar
    mirrorTriggerArmed = true;                    // flash the mirror door
    return name;
  };

  // (text posters removed — wall art is now rotating museum paintings in props.ts)

  // ---------- ceiling pendants over living area ----------
  for (const [lx, lz] of [[-0.6, 3.2], [1.4, 3.2]] as const) {
    box(0.02, 1.6, 0.02, matDark, lx, H - 0.8, lz);
    const shade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.22, 0.2, 10, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x111522, side: THREE.DoubleSide }),
    );
    shade.position.set(lx, H - 1.65, lz);
    group.add(shade);
    strip(0.08, 0.08, 0.08, 0xffd9b0, lx, H - 1.72, lz, 2.4);
  }

  ctx.scene.add(group);

  // ---------- walkable height field ----------
  const heightAt = (x: number, z: number, feetY: number): number => {
    let best = 0;
    // stair ramp
    if (x >= STAIR_X0 && x <= STAIR_X1 && z <= STAIR_Z_BOTTOM && z >= STAIR_Z_TOP) {
      const t = (STAIR_Z_BOTTOM - z) / (STAIR_Z_BOTTOM - STAIR_Z_TOP);
      const h = Math.min(MEZZ_Y, Math.max(0, t * MEZZ_Y));
      if (h <= feetY + 0.55 && h > best) best = h;
    }
    // mezzanine slab
    if (z <= MEZZ_EDGE - 0.05 && z >= -D/2) {
      if (MEZZ_Y <= feetY + 0.55 && MEZZ_Y > best) best = MEZZ_Y;
    }
    return best;
  };

  const update = (t: number) => { for (const f of animated) f(t); };

  return {
    group, walls, windowPlane, windowRain, monitorPlane, heightAt, update,
    bathroom: {
      door, toggleDoor, toilet: toiletSeat, mirror, shower: showerHead, toggleShower,
      setRealWeather: (w) => {
        realWeather = w;
        realWeatherFailed = w === null;
        drawMirror();
      },
      setNews: (titles) => { newsTitles = titles; newsIdx = 0; drawMirror(); },
      setPrivate: (on: boolean) => { privTarget = on ? 1 : 0; },
      reflector,
      avatar,
    },
    washer: washerDoor,
    bookshelf: shelf,
    titledBooks,
    shardTrayArt,
    shardTrayAudio,
    devlogShard,
    entry: {
      door: entryDoor,
      toggle: entryToggle,
      isOpen: () => entryOpen,
      package: pkg,
      setDelivered: (on) => { pkg.visible = on; },
      keypad,
    },
    wardrobe: { mesh: wardrobe, cycleOutfit },
    starProjector,
    fridge: { hit: fridgeHit, toggle: toggleFridge, isOpen: () => fridgeOpen },
  };

  // ---------- helpers ----------
  function makeMonitor(w: number, h: number, glow: number,
                       x: number, y: number, z: number, ry: number): THREE.Mesh {
    // ry is the facing direction: plane normal = (sin ry, 0, cos ry)
    const nx = Math.sin(ry), nz = Math.cos(ry);
    box(w + 0.06, h + 0.06, 0.05, matDark, x, y, z, ry);
    box(0.06, 0.3, 0.06, matSteel, x, y - h/2 - 0.18, z, ry);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({
        color: 0x02030a, emissive: 0xffffff, emissiveIntensity: 0.7,
        emissiveMap: makeCodeTexture(glow),
      }),
    );
    screen.position.set(x + nx * 0.04, y, z + nz * 0.04); // just in front of the bezel
    screen.rotation.y = ry;
    group.add(screen);
    return screen;
  }
}

function makeSpineTexture(book: Book): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 320;
  const g = c.getContext('2d')!;
  const base = '#' + book.spine.toString(16).padStart(6, '0');
  g.fillStyle = base; g.fillRect(0, 0, 64, 320);
  // aging: darken edges + noise
  const grad = g.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, 'rgba(0,0,0,.45)');
  grad.addColorStop(0.2, 'rgba(0,0,0,0)');
  grad.addColorStop(0.8, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,.45)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 320);
  for (let i = 0; i < 160; i++) {
    g.fillStyle = Math.random() > 0.5 ? 'rgba(255,240,210,.04)' : 'rgba(0,0,0,.07)';
    g.fillRect(Math.random() * 64, Math.random() * 320, 2, 2);
  }
  // gold band top/bottom (classic hardback)
  g.fillStyle = 'rgba(214,180,110,.6)';
  g.fillRect(6, 14, 52, 2.5); g.fillRect(6, 302, 52, 2.5);
  g.fillStyle = 'rgba(240,228,200,.92)';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (book.zh) {
    // vertical CJK title
    g.font = 'bold 26px serif';
    const chars = [...book.title].slice(0, 8);
    const step = Math.min(34, 250 / chars.length);
    chars.forEach((ch, i) => g.fillText(ch, 32, 52 + i * step));
  } else {
    // rotated latin title along the spine
    g.save();
    g.translate(32, 158);
    g.rotate(Math.PI / 2);
    g.font = 'bold 17px serif';
    const t = book.title.slice(0, 22);
    g.fillText(t, 0, 0);
    g.restore();
  }
  g.font = '11px serif';
  g.fillStyle = 'rgba(240,228,200,.6)';
  g.fillText(book.author.slice(0, 10), 32, 290);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function addBooks(group: THREE.Group, x: number, depth: number, zCenter: number, width: number) {
  // aged paper: muted, sun-faded spines (an antique collection, not a modern shelf)
  const palette = [0x8a6d4a, 0x6e4a3a, 0x5a5a4a, 0x7a3a3a, 0x4a5568, 0x9a8a6a, 0x6a5a7a];
  const geo = new THREE.BoxGeometry(0.16, 0.24, 0.045);
  const mat = new THREE.MeshLambertMaterial();
  const count = 40;
  const inst = new THREE.InstancedMesh(geo, mat, count);
  const m4 = new THREE.Matrix4();
  const color = new THREE.Color();
  let i = 0;
  for (const shelfY of [1.93, 2.43]) {
    let z = zCenter - width/2 + 0.1;
    while (z < zCenter + width/2 - 0.1 && i < count) {
      // antique shelf: gaps and lean angles, like a collector's stash
      if (Math.random() < 0.18) { z += 0.1 + Math.random() * 0.12; continue; }
      m4.makeRotationY(Math.PI/2 + (Math.random() - 0.5) * 0.22);
      m4.setPosition(x, shelfY + 0.12, z);
      inst.setMatrixAt(i, m4);
      inst.setColorAt(i, color.setHex(palette[Math.floor(Math.random() * palette.length)]).multiplyScalar(0.65));
      z += 0.05 + Math.random() * 0.05;
      i++;
    }
  }
  inst.count = i;
  group.add(inst);
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeTileTexture(): THREE.CanvasTexture {
  return canvasTexture(512, 96, (g) => {
    g.fillStyle = '#0a0612'; g.fillRect(0, 0, 512, 96);
    g.fillStyle = '#b44dff';
    for (let y = 4; y < 96; y += 24) {
      for (let x = 4 + ((y/24) % 2) * 12; x < 512; x += 26) g.fillRect(x, y, 20, 18);
    }
  });
}

function makeVendingTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 512, (g) => {
    g.fillStyle = '#0a0e18'; g.fillRect(0, 0, 256, 512);
    g.fillStyle = '#fff5d6'; g.fillRect(16, 16, 224, 300);
    g.fillStyle = '#0a0e18';
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 5; col++) {
        g.fillStyle = ['#e53e3e', '#3182ce', '#38a169', '#d69e2e', '#805ad5'][col];
        g.fillRect(28 + col * 42, 30 + row * 70, 30, 52);
      }
    }
    g.fillStyle = '#ff2bdb'; g.fillRect(16, 340, 224, 60);
    g.fillStyle = '#05060a'; g.font = 'bold 36px sans-serif'; g.textAlign = 'center';
    g.fillText('飲料', 128, 382);
  });
}

function makePosterTexture(text: string, color: number): THREE.CanvasTexture {
  return canvasTexture(256, 360, (g) => {
    const hex = '#' + color.toString(16).padStart(6, '0');
    g.fillStyle = '#0a0a14'; g.fillRect(0, 0, 256, 360);
    g.strokeStyle = hex; g.lineWidth = 6; g.strokeRect(10, 10, 236, 340);
    g.shadowColor = hex; g.shadowBlur = 24;
    g.fillStyle = hex; g.textAlign = 'center';
    g.font = `bold ${text.length > 2 ? 56 : 84}px sans-serif`;
    if (text.length <= 2) g.fillText(text, 128, 200);
    else {
      g.fillText(text.slice(0, 2), 128, 150);
      g.fillText(text.slice(2), 128, 250);
    }
  });
}

function makeCodeTexture(glow: number): THREE.CanvasTexture {
  return canvasTexture(256, 160, (g) => {
    const hex = '#' + glow.toString(16).padStart(6, '0');
    g.fillStyle = '#02030a'; g.fillRect(0, 0, 256, 160);
    g.fillStyle = hex; g.font = '9px monospace'; g.textAlign = 'left';
    for (let y = 12; y < 156; y += 12) {
      let line = '';
      const len = 8 + Math.floor(Math.random() * 22);
      for (let i = 0; i < len; i++) line += String.fromCharCode(33 + Math.floor(Math.random() * 90));
      g.globalAlpha = 0.5 + Math.random() * 0.5;
      g.fillText(line, 8 + (Math.random() * 12), y);
    }
  });
}

// ---------- procedural surface textures ----------

function makeConcreteTexture(): THREE.CanvasTexture {
  return canvasTexture(512, 512, (g) => {
    g.fillStyle = '#171b26'; g.fillRect(0, 0, 512, 512);
    // low-frequency blotches
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * 512, y = Math.random() * 512, r = 40 + Math.random() * 110;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      const tone = Math.random() > 0.5 ? '255,255,255' : '0,0,0';
      grad.addColorStop(0, `rgba(${tone},0.05)`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // speckles
    for (let i = 0; i < 1600; i++) {
      g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.05)';
      g.fillRect(Math.random() * 512, Math.random() * 512, 1.5, 1.5);
    }
    // tile seams
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 2;
    for (let p = 0; p <= 512; p += 128) {
      g.beginPath(); g.moveTo(p, 0); g.lineTo(p, 512); g.stroke();
      g.beginPath(); g.moveTo(0, p); g.lineTo(512, p); g.stroke();
    }
  });
}

function buildGamingChair(
  group: THREE.Group, cx: number, cy: number, cz: number, facing: number,
  matFrame: THREE.Material, matMetal: THREE.Material,
): void {
  // Esports/racing seat — high-back, bolstered, with 5-star caster base. Built
  // entirely from primitives so it stays cheap on the iGPU.
  const chair = new THREE.Group();
  chair.position.set(cx, cy, cz);
  chair.rotation.y = facing;   // facing = +π/2 → seat faces +x (toward desk)
  group.add(chair);

  const matSeatFabric = new THREE.MeshLambertMaterial({ color: 0x0c0e18 });
  const matBolster   = new THREE.MeshLambertMaterial({ color: 0x171a28 });
  const matAccent    = new THREE.MeshBasicMaterial({ color: 0xff2bdb });
  const matAccentCy  = new THREE.MeshBasicMaterial({ color: 0x5af2ff });
  const matPillow    = new THREE.MeshLambertMaterial({ color: 0x1c1d2c });

  const add = (mesh: THREE.Mesh, x: number, y: number, z: number,
               rx = 0, ry = 0, rz = 0): THREE.Mesh => {
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    chair.add(mesh);
    return mesh;
  };

  // ---- 5-star base + casters ----
  // central hub
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 16), matMetal), 0, 0.07, 0);
  // 5 legs radiating out with proper caster brackets at the ends
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5;
    const legGroup = new THREE.Group();
    legGroup.rotation.y = a;                     // local +x points outward along the leg
    // tapered leg arm
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.045, 0.06), matMetal);
    leg.position.set(0.16, 0.075, 0);            // raised to clear the wheel
    legGroup.add(leg);
    // caster yoke (bracket between leg and wheel)
    const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.06, 0.07), matMetal);
    yoke.position.set(0.32, 0.06, 0);
    legGroup.add(yoke);
    // wheel — cylinder axis along local Z so it rolls in the leg's +x direction
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.030, 16), matMetal);
    wheel.rotation.x = Math.PI / 2;              // Y axis → Z axis = horizontal wheel
    wheel.position.set(0.32, 0.035, 0);          // wheel centre at radius=0.035 → bottom touches floor
    legGroup.add(wheel);
    chair.add(legGroup);
  }
  // gas piston column (raised so it starts above the hub top)
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.36, 12), matMetal), 0, 0.275, 0);
  // seat tilt plate (small disc above piston)
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.02, 16), matMetal), 0, 0.465, 0);

  // ---- seat pan with bolsters (racing-seat profile) ----
  // main seat cushion
  add(new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.08, 0.50), matSeatFabric), 0, 0.505, 0);
  // side bolsters (left/right raised cushions)
  add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.13, 0.42), matBolster), -0.22, 0.535, 0);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.13, 0.42), matBolster),  0.22, 0.535, 0);
  // accent piping along seat front edge
  add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.012, 0.012), matAccent), 0, 0.548, 0.25);

  // ---- tall backrest with central spine + side wings ----
  // central back panel (slight backward lean)
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.85, 0.10), matSeatFabric);
  back.position.set(0, 0.96, -0.20);
  back.rotation.x = -0.18;   // slight recline
  chair.add(back);
  // side back wings (bolsters extending up)
  for (const sx of [-0.20, 0.20]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.78, 0.10), matBolster);
    wing.position.set(sx, 0.94, -0.18);
    wing.rotation.x = -0.18;
    chair.add(wing);
  }
  // RGB accent strip running vertically down the back spine
  const accent = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.78, 0.012), matAccentCy);
  accent.position.set(0, 0.94, -0.135);
  accent.rotation.x = -0.18;
  chair.add(accent);

  // ---- head pillow ----
  const pillow = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.12), matPillow);
  pillow.position.set(0, 1.42, -0.18);
  pillow.rotation.x = -0.18;
  chair.add(pillow);

  // ---- lumbar pillow (small cushion in the lower back) ----
  const lumbar = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.12, 0.10), matPillow);
  lumbar.position.set(0, 0.78, -0.14);
  lumbar.rotation.x = -0.18;
  chair.add(lumbar);

  // ---- armrests ----
  for (const sx of [-0.30, 0.30]) {
    // vertical post
    add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.18, 0.04), matMetal),
        sx, 0.635, -0.05);
    // armrest pad
    add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.32), matSeatFabric),
        sx, 0.745, -0.02);
    // armrest accent
    add(new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.005, 0.30), matAccent),
        sx, 0.768, -0.02);
  }

  // ---- logo badge on the headrest ----
  add(new THREE.Mesh(new THREE.PlaneGeometry(0.10, 0.04), matAccentCy),
      0, 1.43, -0.122, -0.18);
}

function makeDarkStoneTexture(): THREE.CanvasTexture {
  // dark engineered stone / laminate: subtle warm-violet veins + scratch streaks +
  // sparse dust speckle. Designed to read as "expensive worn surface" on the
  // counters/desk/coffee table.
  const tex = canvasTexture(512, 512, (g) => {
    // base
    const grad = g.createLinearGradient(0, 0, 512, 512);
    grad.addColorStop(0, '#0e1020');
    grad.addColorStop(0.5, '#171a2e');
    grad.addColorStop(1, '#0c0e1c');
    g.fillStyle = grad; g.fillRect(0, 0, 512, 512);
    // long winding mineral veins
    for (let i = 0; i < 6; i++) {
      g.strokeStyle = `rgba(${[180,140,210][i%3]},${[140,120,180][i%3]},${[220,180,240][i%3]},${0.06 + Math.random()*0.04})`;
      g.lineWidth = 0.8 + Math.random() * 1.2;
      g.beginPath();
      let x = Math.random() * 512, y = Math.random() * 512;
      g.moveTo(x, y);
      for (let s = 0; s < 90; s++) {
        x += (Math.random() - 0.5) * 22;
        y += (Math.random() - 0.5) * 22;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // hairline scratches
    g.strokeStyle = 'rgba(255,255,255,0.04)';
    g.lineWidth = 0.5;
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * 512, y = Math.random() * 512;
      const len = 10 + Math.random() * 60;
      const ang = Math.random() * Math.PI * 2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      g.stroke();
    }
    // micro dust speckle (high freq noise)
    const img = g.getImageData(0, 0, 512, 512);
    for (let p = 0; p < img.data.length; p += 4) {
      const n = (Math.random() - 0.5) * 12;
      img.data[p]   = Math.max(0, Math.min(255, img.data[p]   + n));
      img.data[p+1] = Math.max(0, Math.min(255, img.data[p+1] + n));
      img.data[p+2] = Math.max(0, Math.min(255, img.data[p+2] + n));
    }
    g.putImageData(img, 0, 0);
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);  // tile the pattern so it doesn't read as a single mark
  return tex;
}

function makeDarkStoneRoughness(): THREE.CanvasTexture {
  // bright = rougher, dark = glossier. Stone is mostly satin (~0.6) with
  // occasional polished patches around the veins.
  const tex = canvasTexture(256, 256, (g) => {
    g.fillStyle = '#8c8c8c'; g.fillRect(0, 0, 256, 256);  // satin baseline
    for (let i = 0; i < 12; i++) {
      const x = Math.random() * 256, y = Math.random() * 256, r = 18 + Math.random() * 50;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(48,48,48,0.6)');   // glossier centre
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

function makeConcreteRoughness(): THREE.CanvasTexture {
  const tex = canvasTexture(256, 256, (g) => {
    g.fillStyle = '#6e6e6e'; g.fillRect(0, 0, 256, 256); // mid roughness baseline
    for (let i = 0; i < 24; i++) {
      const x = Math.random() * 256, y = Math.random() * 256, r = 25 + Math.random() * 70;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      // darker = smoother = wet-look polished patches
      grad.addColorStop(0, 'rgba(38,38,38,0.55)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
  tex.colorSpace = THREE.NoColorSpace; // data map, not color
  return tex;
}

function makeWallPanelTexture(): THREE.CanvasTexture {
  return canvasTexture(512, 512, (g) => {
    g.fillStyle = '#151a2c'; g.fillRect(0, 0, 512, 512);
    // subtle vertical gradient (darker near floor — cheap AO)
    const grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, 'rgba(255,255,255,0.04)');
    grad.addColorStop(1, 'rgba(0,0,0,0.22)');
    g.fillStyle = grad; g.fillRect(0, 0, 512, 512);
    // panel seams + bolts
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 3;
    for (let x = 0; x <= 512; x += 170) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke();
    }
    g.beginPath(); g.moveTo(0, 256); g.lineTo(512, 256); g.stroke();
    g.fillStyle = 'rgba(160,170,200,0.25)';
    for (let x = 12; x < 512; x += 170) {
      for (let y = 16; y < 512; y += 80) { g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); }
    }
    // grime streaks
    for (let i = 0; i < 26; i++) {
      g.fillStyle = 'rgba(0,0,0,0.05)';
      const x = Math.random() * 512;
      g.fillRect(x, Math.random() * 280, 2 + Math.random() * 5, 90 + Math.random() * 160);
    }
  });
}

function makeFabricTexture(base: number): THREE.CanvasTexture {
  const tex = canvasTexture(256, 256, (g) => {
    g.fillStyle = '#' + base.toString(16).padStart(6, '0');
    g.fillRect(0, 0, 256, 256);
    // woven crosshatch
    for (let y = 0; y < 256; y += 4) {
      g.fillStyle = (y / 4) % 2 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.06)';
      g.fillRect(0, y, 256, 2);
    }
    for (let x = 0; x < 256; x += 4) {
      g.fillStyle = (x / 4) % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.04)';
      g.fillRect(x, 0, 2, 256);
    }
  });
  return tex;
}

function makeBrushedMetalTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = '#1d2334'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 320; i++) {
      g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.05)';
      const y = Math.random() * 256;
      g.fillRect(0, y, 256, 0.8 + Math.random());
    }
    // wear marks
    for (let i = 0; i < 12; i++) {
      g.fillStyle = 'rgba(0,0,0,0.08)';
      g.fillRect(Math.random() * 256, Math.random() * 256, 8 + Math.random() * 30, 2 + Math.random() * 4);
    }
  });
}

function makeRugTexture(): THREE.CanvasTexture {
  return canvasTexture(512, 384, (g) => {
    g.fillStyle = '#11141f'; g.fillRect(0, 0, 512, 384);
    g.strokeStyle = 'rgba(90,242,255,0.28)'; g.lineWidth = 5;
    g.strokeRect(14, 14, 484, 356);
    g.strokeStyle = 'rgba(255,43,219,0.22)'; g.lineWidth = 2;
    g.strokeRect(30, 30, 452, 324);
    // geometric inner pattern
    g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 1.5;
    for (let x = 50; x < 470; x += 42) {
      g.beginPath(); g.moveTo(x, 48); g.lineTo(x + 30, 336); g.stroke();
      g.beginPath(); g.moveTo(x + 30, 48); g.lineTo(x, 336); g.stroke();
    }
    // pile noise
    for (let i = 0; i < 2200; i++) {
      g.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.05)';
      g.fillRect(Math.random() * 512, Math.random() * 384, 2, 2);
    }
  });
}

function makeBlobShadowTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(128, 128, (g) => {
    const grad = g.createRadialGradient(64, 64, 6, 64, 64, 62);
    grad.addColorStop(0, 'rgba(0,0,0,0.85)');
    grad.addColorStop(0.65, 'rgba(0,0,0,0.4)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  });
  return tex;
}

export const ROOM_BOUNDS = { w: W, d: D, h: H };
