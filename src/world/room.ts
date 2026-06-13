import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import type { EngineCtx } from '../engine/renderer';
import { BOOKS, type Book } from '../lib/books';

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
  };
  wardrobe: { mesh: THREE.Mesh; cycleOutfit: () => string };
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
  const matDark = new THREE.MeshStandardMaterial({ color: 0x05060a, roughness: 0.45, metalness: 0.7 });
  const matSteel = new THREE.MeshStandardMaterial({
    color: 0x9aa4bd, map: texBrushed, roughness: 0.4, metalness: 0.85,
  });
  const matFurn = new THREE.MeshLambertMaterial({ color: 0x959dba, map: texBrushed });
  const matFabric = new THREE.MeshLambertMaterial({ color: 0xb0b6cc, map: texFabric });
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
  // glowing backsplash tiles
  const splash = new THREE.Mesh(
    new THREE.PlaneGeometry(4.6, 0.8),
    new THREE.MeshStandardMaterial({
      color: 0x0a0612, emissive: 0xb44dff, emissiveIntensity: 0.9,
      emissiveMap: makeTileTexture(), roughness: 0.3,
    }),
  );
  splash.position.set(-2.0, 1.45, -6.86);
  group.add(splash);
  box(4.6, 0.7, 0.5, matFurn, -2.0, 2.3, -6.6);                   // upper cabinets
  strip(4.4, 0.03, 0.03, 0xffc6a0, -2.0, 1.92, -6.42, 1.6);       // under-cabinet warm strip
  solid(0.85, 1.9, 0.7, matSteel, 1.1, 0.95, -6.5);               // fridge
  strip(0.03, 1.7, 0.03, 0x5af2ff, 0.72, 0.95, -6.18, 2.0);       // fridge edge glow
  // island + stools
  solid(1.6, 0.9, 0.8, matFurn, -2.2, 0.45, -4.6);
  box(1.6, 0.05, 0.9, matDark, -2.2, 0.925, -4.6);
  for (const sx of [-2.7, -1.7]) {
    box(0.35, 0.07, 0.35, matDark, sx, 0.62, -3.9);
    box(0.06, 0.6, 0.06, matSteel, sx, 0.3, -3.9);
  }
  strip(4.4, 0.04, 0.04, 0xffffff, -2.0, MEZZ_Y - 0.25, -5.4, 1.1); // kitchen ceiling tube

  // ---------- living area (double-height zone) ----------
  // L-sofa facing the window
  solid(3.0, 0.42, 1.05, matFabric, 0.4, 0.21, 2.0);
  box(3.0, 0.55, 0.25, matFabric, 0.4, 0.69, 1.6);                 // backrest
  solid(1.0, 0.42, 2.2, matFabric, 2.15, 0.21, 2.6);               // chaise
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

  // contact shadows under the major pieces
  blob(3.8, 1.8, 0.4, 2.0, 0.014);          // sofa
  blob(1.6, 2.8, 2.15, 2.6, 0.014);         // chaise
  blob(1.9, 1.2, 0.2, 3.6, 0.015);          // coffee table
  blob(3.0, 1.5, 4.7, 3.4);                 // desk
  blob(1.0, 1.0, 3.7, 3.4);                 // chair
  blob(0.9, 3.0, 5.7, 0.2);                 // bookshelf
  blob(2.2, 1.3, -2.2, -4.6);               // island
  blob(5.2, 1.1, -2.0, -6.4);               // kitchen counter
  blob(0.7, 0.7, -3.4, 6.3, 0.013, 0.35);   // plants
  blob(0.7, 0.7, 3.6, 6.35, 0.013, 0.35);
  blob(3.0, 2.3, -3.6, -5.6, MEZZ_Y + 0.012); // bed
  blob(0.8, 0.7, -2.2, -6.3, MEZZ_Y + 0.012); // side table
  blob(2.5, 0.9, 3.4, -6.55, MEZZ_Y + 0.012); // dresser

  // ---------- netrunner desk (right wall, per IMG_5689) ----------
  solid(2.4, 0.74, 0.95, matFurn, 4.7, 0.37, 3.4);
  box(2.4, 0.05, 1.0, matDark, 4.7, 0.77, 3.4);
  // triple monitors — center one is the future CyberOS screen
  // all three monitors stand ON the desk (z 2.93..3.88), stands resting on the top
  const monitorPlane = makeMonitor(1.1, 0.62, 0x5af2ff, 4.72, 1.44, 3.4, -Math.PI/2);
  monitorPlane.name = 'Monitor';
  makeMonitor(0.62, 0.5, 0x39ff88, 4.76, 1.38, 3.02, -Math.PI/2 + 0.3);
  makeMonitor(0.62, 0.5, 0xff2bdb, 4.76, 1.38, 3.78, -Math.PI/2 - 0.3);
  strip(0.04, 0.04, 1.9, 0xff8a3d, 5.85, 0.82, 3.4, 1.4);          // desk back edge glow
  box(0.5, 0.04, 0.18, matDark, 4.35, 0.8, 3.4, -Math.PI/2);       // keyboard
  // desk chair
  box(0.55, 0.1, 0.55, matFabric, 3.7, 0.45, 3.4);
  box(0.55, 0.7, 0.1, matFabric, 3.4, 0.85, 3.4);
  box(0.08, 0.4, 0.08, matSteel, 3.7, 0.2, 3.4);

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
  strip(0.1, 0.22, 0.1, 0xffc6a0, -2.2, MEZZ_Y + 0.62, -6.3, 1.6); // bedside lamp
  solid(2.0, 1.3, 0.4, matFurn, 3.4, MEZZ_Y + 0.65, -6.6);         // dresser
  // wall art with neon frame
  strip(1.5, 0.9, 0.04, 0x8a2be2, -3.6, MEZZ_Y + 1.9, -6.84, 0.7);

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
  box(0.02, 2.0, 0.02, matDark, 0.7, MEZZ_Y + 1.1, -6.34);        // door seam
  strip(0.03, 1.9, 0.02, 0x5af2ff, 1.24, MEZZ_Y + 1.1, -6.33, 0.8);
  // open rail with the actual outfits — the one you wear leaves the rail
  const OUTFITS: Array<[number, number, string]> = [
    [0x141a28, 0x5af2ff, '夜行黑 × 電氣青'],
    [0x2a1230, 0xff2bdb, '暗紫 × 霓紅粉'],
    [0x2e2618, 0xffd24d, '軍墨 × 鍍金'],
    [0x102218, 0x39ff88, '叢林綠 × 駭客綠'],
    [0x301518, 0xff5566, '猩紅 × 警示紅'],
  ];
  box(0.03, 0.03, 1.1, matSteel, 1.95, MEZZ_Y + 1.95, -6.6);       // rail
  const jackets: THREE.Mesh[] = [];
  OUTFITS.forEach(([suit], i) => {
    const jz = -6.78 + 0.18 * i; // evenly spaced under the rail
    const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.1, 6), matSteel);
    hanger.position.set(1.95, MEZZ_Y + 1.89, jz);
    group.add(hanger);
    const jacket = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.52, 0.06), // flat side along the rail, like real hangers
      new THREE.MeshLambertMaterial({ color: suit }),
    );
    jacket.position.set(1.95, MEZZ_Y + 1.56, jz);
    group.add(jacket);
    jackets.push(jacket);
  });
  let outfitIdx = 0;
  jackets[0].visible = false; // wearing the first one already
  const cycleOutfit = (): string => {
    jackets[outfitIdx].visible = true;            // hang the old one back
    outfitIdx = (outfitIdx + 1) % OUTFITS.length;
    jackets[outfitIdx].visible = false;           // take the next one off the rail
    const [suit, accent, name] = OUTFITS[outfitIdx];
    matBodySuit.color.setHex(suit);
    (visor.material as THREE.MeshBasicMaterial).color.setHex(accent);
    (chest.material as THREE.MeshBasicMaterial).color.setHex(accent);
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
    group, walls, windowPlane, monitorPlane, heightAt, update,
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
    },
    wardrobe: { mesh: wardrobe, cycleOutfit },
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
