import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import type { EngineCtx } from '../engine/renderer';
import { buildAdWall } from './ad_wall';
import { buildScanlineMaterial } from './shaders/hologram_scanline.glsl';

export interface CityRig {
  group: THREE.Group;
  update: (t: number, dt: number) => void;
  /** procedural gradient dome — hidden when the HDRI background loads */
  skyDome: THREE.Mesh;
  /** force a video holo-ad to appear now; returns the clip name */
  triggerAd: () => string;
  adVideo: HTMLVideoElement;
  setAdsPaused: (p: boolean) => void;
  /**
   * Bright-source anchors visible from the window — used by the
   * volumetric god-ray pass (M3). Pre-sorted brightest-first; consumers
   * trim to `settings.volumetricSources`. World-space positions, no parent.
   */
  volumetricAnchors: THREE.Vector3[];
  // -------- M4 flicker timeline --------
  /** enable continuous per-frame sub-pulse on tower emissives */
  setFlicker: (on: boolean) => void;
  isFlickerOn: () => boolean;
  /** force a brownout NOW — returns a short label (e.g. "magenta district") */
  triggerBrownout: () => string;
  /** visual flash from above (rim flash) — coupled to thunder; auto-decays */
  triggerLightning: () => void;
}

// The room sits ~150m above street level. The vista: glowing street grid far
// below, hundreds of instanced towers (most tops below the window line),
// animated billboards, streams of flying vehicles, and an occasional ad blimp.
const GROUND_Y = -150;

export function buildCity(ctx: EngineCtx): CityRig {
  const group = new THREE.Group();
  group.name = 'City';
  const updaters: Array<(t: number, dt: number) => void> = [];
  const maxAniso = Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy());
  const aniso = (tex: THREE.Texture) => { tex.anisotropy = maxAniso; return tex; };

  // ---------- sky dome ----------
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x04050c) },
      uMid: { value: new THREE.Color(0x1a0c2e) },
      uHorizon: { value: new THREE.Color(0x582048) },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: `
      varying vec3 vPos;
      uniform vec3 uTop, uMid, uHorizon;
      void main() {
        float h = normalize(vPos).y;
        // keep the bright horizon band tight and centered ahead — at oblique
        // angles a tall saturated band reads as a flat magenta block
        vec3 c = mix(uHorizon, uMid, smoothstep(-0.06, 0.16, h));
        c = mix(c, uTop, smoothstep(0.16, 0.85, h));
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(750, 32, 24), skyMat);
  group.add(sky);

  // ---------- street grid far below ----------
  // Wet variant (M2): texture gains bright avenue streaks + larger
  // intersection pools so the city reads as "after the rain" without
  // requiring a Reflector pass. Free on every preset.
  const streets = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900),
    new THREE.MeshBasicMaterial({
      map: aniso(makeStreetTexture(ctx.settings.enableWetCity)),
      fog: true,
    }),
  );
  streets.rotation.x = -Math.PI / 2;
  streets.position.set(0, GROUND_Y, 250);
  group.add(streets);

  // W5b fix: hot-rebake the street texture once the real photos arrive.
  // Two async loaders (ambientCG asphalt + Wikimedia aerial); a small
  // coalescer waits for either both to land or a 5s timeout before rebake,
  // so we don't pay the canvas-paint cost twice. Fail-soft.
  {
    let asphaltImg: HTMLImageElement | null = null;
    let photoImg: HTMLImageElement | null = null;
    let pendingTimer: number | null = null;
    let rebakeFired = false;
    const rebakeStreets = () => {
      if (rebakeFired) return;
      rebakeFired = true;
      if (pendingTimer !== null) {
        window.clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      const newTex = aniso(makeStreetTexture(
        ctx.settings.enableWetCity, photoImg, asphaltImg));
      const oldMap = (streets.material as THREE.MeshBasicMaterial).map;
      (streets.material as THREE.MeshBasicMaterial).map = newTex;
      (streets.material as THREE.MeshBasicMaterial).needsUpdate = true;
      oldMap?.dispose();
    };
    const noteAndMaybeRebake = () => {
      // If both arrived, rebake now. Otherwise schedule a coalesced rebake
      // 5s out so a missing texture doesn't block the other from showing.
      if (asphaltImg && photoImg) {
        rebakeStreets();
      } else if (pendingTimer === null) {
        pendingTimer = window.setTimeout(rebakeStreets, 5000);
      }
    };
    const loader = new THREE.ImageLoader();
    loader.load(
      '/assets/textures/street_live/asphalt_wet_diff.jpg',
      (img) => { asphaltImg = img; noteAndMaybeRebake(); },
      undefined,
      () => { /* no asphalt — overlay-only or all-procedural fallback */ },
    );
    loader.load(
      '/assets/textures/street_live/street_overlay_night.jpg',
      (img) => { photoImg = img; noteAndMaybeRebake(); },
      undefined,
      () => { /* no overlay — asphalt-only or all-procedural fallback */ },
    );
  }

  // ---------- wet-road specular reflector (Med+ only) ----------
  // A Reflector centred under the player's gaze line along the main avenue.
  // Reflects building emissive into the street so neon signs trail down the
  // wet road. Skipped on Low to keep GPU budget free; Ultra gets a bigger
  // patch + higher render-target resolution.
  if (ctx.settings.enableWetCity && ctx.settings.preset !== 'low') {
    const isUltra = ctx.settings.preset === 'ultra';
    const refGeo = new THREE.PlaneGeometry(isUltra ? 120 : 60, isUltra ? 48 : 24);
    const reflector = new Reflector(refGeo, {
      textureWidth: isUltra ? 512 : 256,
      textureHeight: isUltra ? 256 : 128,
      color: 0x223044,
      clipBias: 0.01,
    });
    reflector.rotation.x = -Math.PI / 2;
    // sit 0.05 above the street so it composites in front; centre under
    // the player's view of the main avenue (z=120..150 from window)
    reflector.position.set(0, GROUND_Y + 0.05, 130);
    reflector.name = 'WetRoadReflector';
    group.add(reflector);
  }

  // ---------- instanced towers ----------
  const towerCount = ctx.settings.buildingCount;
  const towerGeo = new THREE.BoxGeometry(1, 1, 1);
  towerGeo.translate(0, 0.5, 0); // pivot at base so scaling y grows upward
  const winTexA = aniso(makeWindowTexture(0x5af2ff));
  const winTexB = aniso(makeWindowTexture(0xff2bdb));
  const winTexC = aniso(makeWindowTexture(0xffc46b));
  const towerMats = [winTexA, winTexB, winTexC].map((tex) => new THREE.MeshStandardMaterial({
    color: 0x0a0d16, roughness: 0.7, metalness: 0.3,
    emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.72,
  }));
  const per = Math.ceil(towerCount / towerMats.length);
  const m4 = new THREE.Matrix4();
  const rng = mulberry32(20770612);
  const rooftops: Array<[number, number, number, number]> = []; // x, topY, z, width
  const signSpots: Array<[number, number, number, number]> = []; // x, centerY, frontZ, height
  const horizSpots: Array<[number, number, number, number]> = []; // x, centerY, frontZ, width
  for (let mi = 0; mi < towerMats.length; mi++) {
    const inst = new THREE.InstancedMesh(towerGeo, towerMats[mi], per);
    let placed = 0;
    for (let i = 0; i < per; i++) {
      // city spreads z 70..520 with a clear view-cone down the middle so the
      // vista reads as depth, not a wall of façade (per user feedback + IMG_5688).
      // Every 7th tower goes to the side bands (z 12..70, |x| > 60) so oblique
      // views from the window edges stay filled instead of showing empty sky.
      const sideBand = i % 5 === 0;
      // far cap 410: towers stay inside the photo-backdrop cylinder (r=430)
      const z = sideBand ? 12 + rng() * 58 : 70 + rng() * 340;
      let x: number;
      if (sideBand) {
        x = (60 + rng() * 240) * (rng() < 0.5 ? -1 : 1);
      } else {
        x = (rng() - 0.5) * (300 + z * 1.8);
        const cone = 26 + z * 0.13;
        if (Math.abs(x) < cone) x = Math.sign(x || 1) * (cone + rng() * 70);
      }
      const w = 10 + rng() * 22;
      const d = 10 + rng() * 22;
      // near rows stay low so the player looks DOWN onto rooftops; megas live far back
      const mega = !sideBand && z > 180 && rng() < 0.18;
      const h = mega ? 150 + rng() * 100
              : sideBand ? 45 + rng() * 105
              : z < 160 ? 35 + rng() * 75
              : 55 + rng() * 95;
      m4.makeScale(w, h, d);
      m4.setPosition(x, GROUND_Y, z);
      inst.setMatrixAt(placed++, m4);
      if (rng() < 0.3 && z < 380) rooftops.push([x, GROUND_Y + h, z, w]);
      // vertical neon banners hang on the faces of nearer towers (per IMG_5698)
      if (rng() < 0.5 && z < 380 && h > 50) {
        const signH = Math.min(h * (0.35 + rng() * 0.3), 55);
        signSpots.push([
          x + (rng() - 0.5) * w * 0.5,
          GROUND_Y + h * (0.35 + rng() * 0.4),
          z - d / 2 - 0.6,
          signH,
        ]);
      }
      // wide horizontal boards lower on the façades (street-mall floors)
      if (rng() < 0.35 && z < 340 && h > 40) {
        horizSpots.push([
          x + (rng() - 0.5) * w * 0.3,
          GROUND_Y + h * (0.1 + rng() * 0.25),
          z - d / 2 - 0.6,
          Math.min(w * (0.7 + rng() * 0.5), 26),
        ]);
      }
    }
    inst.count = placed;
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  }

  // wide horizontal storefront boards (instanced, tinted)
  {
    const count = Math.min(horizSpots.length, 110);
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: makeSignStripTexture(), transparent: true, side: THREE.DoubleSide, fog: true,
    });
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const tint = new THREE.Color();
    const palette = [0xff2bdb, 0x5af2ff, 0xffe14d, 0xff6b6b, 0x39ff88, 0xb44dff, 0xff8a3d];
    for (let i = 0; i < count; i++) {
      const [sx, sy, sz, sw] = horizSpots[i];
      m4.makeRotationY(Math.PI);
      m4.scale(new THREE.Vector3(sw, sw * 0.22, 1));
      m4.setPosition(sx, sy, sz);
      inst.setMatrixAt(i, m4);
      inst.setColorAt(i, tint.setHex(palette[i % palette.length]));
    }
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  }

  // vertical neon sign strips (one instanced mesh, tinted per instance)
  {
    const count = Math.min(signSpots.length, 260);
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: makeVerticalSignTexture(), transparent: true, side: THREE.DoubleSide, fog: true,
    });
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const tint = new THREE.Color();
    const palette = [0xff4dd2, 0x5af2ff, 0xff6b6b, 0xffe14d, 0x7a5cff, 0x39ff88];
    for (let i = 0; i < count; i++) {
      const [sx, sy, sz, sh] = signSpots[i];
      m4.makeRotationY(Math.PI);
      m4.scale(new THREE.Vector3(sh * 0.16, sh, 1));
      m4.setPosition(sx, sy, sz);
      inst.setMatrixAt(i, m4);
      inst.setColorAt(i, tint.setHex(palette[i % palette.length]));
    }
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  }

  // rooftop antenna spikes with lit tips (IMG_5699 silhouette interest)
  {
    const count = Math.min(rooftops.length, 70);
    const geo = new THREE.BoxGeometry(0.7, 1, 0.7);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0x802030, fog: true });
    const inst = new THREE.InstancedMesh(geo, mat, count);
    for (let i = 0; i < count; i++) {
      const [x, topY, z, w] = rooftops[i];
      m4.makeScale(1, 9 + (i % 5) * 3.5, 1);
      m4.setPosition(x + (w * 0.25) * ((i % 3) - 1), topY, z);
      inst.setMatrixAt(i, m4);
    }
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  }

  // low-rise podium layer: fills the look-down view between the towers
  {
    const podCount = Math.floor(towerCount * 0.7);
    const podInst = new THREE.InstancedMesh(towerGeo, towerMats[0], podCount);
    for (let i = 0; i < podCount; i++) {
      const z = 30 + rng() * 350;
      const x = (rng() - 0.5) * (240 + z * 1.7);
      const w = 14 + rng() * 26;
      m4.makeScale(w, 12 + rng() * 26, 14 + rng() * 26);
      m4.setPosition(x, GROUND_Y, z);
      podInst.setMatrixAt(i, m4);
    }
    podInst.instanceMatrix.needsUpdate = true;
    group.add(podInst);
  }

  // ---------- W5b hero tower (single real-photo façade) ----------
  // ONE dedicated skyscraper laterally visible from the spawn view, mapped
  // with a real cyberpunk-feeling tower photo (Tokyo Cocoon Tower at night
  // by default — fail-soft to a dark procedural face if the photo isn't
  // present). Sits at the cone edge so it reads as part of the city cluster
  // without blocking the centre vista. Box geometry with a multi-material
  // setup: front face (toward player) gets the photo, sides/back stay dark.
  // Placed close-ish (z=55) and slightly off-axis so it's the first thing
  // the player notices when they look out — bright emissive so the lit
  // windows in the photo punch through against the procedural city.
  {
    const heroX = 32, heroZ = 55, heroH = 110, heroW = 22, heroD = 22;
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x0a0d16, roughness: 0.75, metalness: 0.25,
      emissive: 0x1a2236, emissiveIntensity: 0.25,
    });
    // Front face = LED-style additive panel (same trick as the W5b LED
    // billboards). The texture's dark pixels ADD nothing → those parts of
    // the front face vanish so the lit-window pattern reads as glowing
    // points hovering on a dark navy silhouette (the back/sides darkMat
    // gives the building its shape). No "white frame" possible because
    // there's no white base material being modulated by the texture.
    const photoMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,           // map colour passes through unaltered
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
      toneMapped: false,         // keep lit windows from being crushed by ACES
    });
    // BoxGeometry face index order: [+x, -x, +y, -y, +z, -z]. Player is at
    // x≈0; this tower is at x=42, so the visible face is -x (index 1).
    const heroGeo = new THREE.BoxGeometry(heroW, heroH, heroD);
    const heroTower = new THREE.Mesh(heroGeo, [
      darkMat, photoMat, darkMat, darkMat, darkMat, darkMat,
    ]);
    heroTower.position.set(heroX, GROUND_Y + heroH / 2, heroZ);
    heroTower.name = 'HeroTower_Cocoon';
    group.add(heroTower);

    // Channel playlist (W5b-holo direction B). Each tower preloads multiple
    // facade photos and cycles between them every 18-25 s. Cocoon plays
    // [A, B, C]; Shin Kong plays [B, A, C] so the two towers never show the
    // same image. Photos are loaded lazily — the playlist starts empty and
    // we set the first arrival as the active map immediately.
    const cocoonPlaylist: THREE.Texture[] = [];
    const loadInto = (url: string, dst: THREE.Texture[]) => {
      new THREE.TextureLoader().load(url, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = maxAniso;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        dst.push(tex);
        if (!photoMat.map) {
          photoMat.map = tex;
          photoMat.needsUpdate = true;
        }
      }, undefined, () => { /* missing — playlist just shorter, fail-soft */ });
    };
    loadInto('/assets/textures/street_live/cyberpunk_facade_a.jpg', cocoonPlaylist);
    loadInto('/assets/textures/street_live/cyberpunk_facade_b.jpg', cocoonPlaylist);
    loadInto('/assets/textures/street_live/cyberpunk_facade_c.jpg', cocoonPlaylist);

    // CRT scanline overlay (W5b-holo direction C). PlaneGeometry mounted
    // 0.06 forward of the photo face (face is the -x side at x=42 → plane
    // normal is -x). renderOrder 2 so the additive photo composites first.
    const scanline = buildScanlineMaterial();
    const scanPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(heroW, heroH),
      scanline.material,
    );
    scanPlane.position.set(heroX - heroW / 2 - 0.06, GROUND_Y + heroH / 2, heroZ);
    scanPlane.rotation.y = -Math.PI / 2;  // face -x (toward player)
    scanPlane.renderOrder = 2;
    scanPlane.name = 'HeroScan_Cocoon';
    group.add(scanPlane);
    updaters.push((t) => scanline.tick(t));

    // Hologram animation: hue cycle + brightness LFO + glitch frames +
    // channel swap on glitch. Three towers / three textures interplay.
    animateHologram(photoMat, /* phase */ 0.0, updaters, cocoonPlaylist);
  }

  // ---------- W5b hero tower #2 — Shin Kong Life Tower (Taipei) ----------
  // Mirror of the Cocoon hero on the LEFT side of the view so the player's
  // forward gaze is framed by two real-photo skyscrapers. Distinct height
  // and depth from #1 so it doesn't read as a copy. Player sees the +x face
  // (this tower is at negative x).
  {
    const heroX = -34, heroZ = 70, heroH = 130, heroW = 24, heroD = 24;
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x0a0d16, roughness: 0.75, metalness: 0.25,
      emissive: 0x1a2236, emissiveIntensity: 0.25,
    });
    // Additive LED-panel front face (same as Cocoon — see W5b note above).
    const photoMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
      toneMapped: false,
    });
    // BoxGeometry face order [+x, -x, +y, -y, +z, -z]. Tower at x=-34, player
    // at x≈0 → visible face is +x (index 0). Other 5 stay dark.
    const heroGeo = new THREE.BoxGeometry(heroW, heroH, heroD);
    const heroTower = new THREE.Mesh(heroGeo, [
      photoMat, darkMat, darkMat, darkMat, darkMat, darkMat,
    ]);
    heroTower.position.set(heroX, GROUND_Y + heroH / 2, heroZ);
    heroTower.name = 'HeroTower_ShinKong';
    group.add(heroTower);

    // Channel playlist for Shin Kong — starts on B (Shin Kong photo) so the
    // tower's identity is clear at first sight, then cycles through A + C.
    const shinKongPlaylist: THREE.Texture[] = [];
    const loadIntoB = (url: string) => {
      new THREE.TextureLoader().load(url, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = maxAniso;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        shinKongPlaylist.push(tex);
        if (!photoMat.map) {
          photoMat.map = tex;
          photoMat.needsUpdate = true;
        }
      }, undefined, () => { /* missing — playlist just shorter */ });
    };
    loadIntoB('/assets/textures/street_live/cyberpunk_facade_b.jpg');
    loadIntoB('/assets/textures/street_live/cyberpunk_facade_a.jpg');
    loadIntoB('/assets/textures/street_live/cyberpunk_facade_c.jpg');

    // CRT scanline overlay on the +x face of this tower at x=-34
    const scanline = buildScanlineMaterial();
    const scanPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(heroW, heroH),
      scanline.material,
    );
    scanPlane.position.set(heroX + heroW / 2 + 0.06, GROUND_Y + heroH / 2, heroZ);
    scanPlane.rotation.y = Math.PI / 2;  // face +x (toward player)
    scanPlane.renderOrder = 2;
    scanPlane.name = 'HeroScan_ShinKong';
    group.add(scanPlane);
    updaters.push((t) => scanline.tick(t));

    // Hologram animation (offset phase so Cocoon and Shin Kong don't sync)
    animateHologram(photoMat, /* phase */ 1.7, updaters, shinKongPlaylist);
  }

  // rooftop neon signs (one instanced mesh, tinted per instance)
  {
    const signGeo = new THREE.PlaneGeometry(1, 1);
    const signMat = new THREE.MeshBasicMaterial({
      map: makeSignStripTexture(), transparent: true, side: THREE.DoubleSide, fog: true,
    });
    const count = Math.min(rooftops.length, 90);
    const signs = new THREE.InstancedMesh(signGeo, signMat, count);
    const tint = new THREE.Color();
    const palette = [0xff2bdb, 0x5af2ff, 0xffe14d, 0x39ff88, 0xff8a3d];
    for (let i = 0; i < count; i++) {
      const [x, topY, z, w] = rooftops[i];
      const sw = Math.max(8, w * 0.9);
      m4.makeRotationY(Math.PI); // face the room
      m4.scale(new THREE.Vector3(sw, sw * 0.28, 1));
      m4.setPosition(x, topY + sw * 0.18, z);
      signs.setMatrixAt(i, m4);
      signs.setColorAt(i, tint.setHex(palette[i % palette.length]));
    }
    signs.instanceMatrix.needsUpdate = true;
    group.add(signs);
  }

  // photo backdrop: user-provided AI-generated megacity panorama on a curved
  // shell behind the 3D towers (loads async; scene works without it)
  loadPhotoBackdrop(group);

  // far skyline silhouettes (pre-dimmed toward fog color; fog itself would erase them)
  for (const [sz, sy, alpha] of [[400, -10, 0.8], [480, 6, 0.6]] as const) {
    const sil = new THREE.Mesh(
      new THREE.PlaneGeometry(2400, 160),
      new THREE.MeshBasicMaterial({
        map: aniso(makeFarSkylineTexture(alpha)), transparent: true, depthWrite: false, fog: false,
      }),
    );
    sil.position.set(0, sy, sz);
    sil.rotation.y = Math.PI;
    group.add(sil);
  }

  // giant rotating holo ring around a far mega tower — pure Blade Runner
  {
    const ringTex = makeSignStripTexture();
    ringTex.wrapS = THREE.RepeatWrapping;
    ringTex.repeat.x = 6;
    const holoRing = new THREE.Mesh(
      new THREE.CylinderGeometry(46, 46, 9, 48, 1, true),
      new THREE.MeshBasicMaterial({
        map: ringTex, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: true, color: 0xff4dd2,
      }),
    );
    holoRing.position.set(70, 36, 380);
    group.add(holoRing);
    updaters.push((t) => {
      holoRing.rotation.y = t * 0.1;
      (holoRing.material as THREE.MeshBasicMaterial).opacity = 0.4 + 0.12 * Math.sin(t * 3.1);
    });
  }

  // sweeping searchlights from three distant rooftops
  for (const [sx, sz, phase] of [[-130, 200, 0], [115, 240, 2.1], [-60, 330, 4.2]] as const) {
    const pivot = new THREE.Group();
    pivot.position.set(sx, GROUND_Y + 215, sz);
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(10, 160, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xbfd9ff, transparent: true, opacity: 0.045,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
      }),
    );
    cone.rotation.x = Math.PI;   // tip at the pivot, beam opens skyward
    cone.position.y = 80;
    pivot.add(cone);
    group.add(pivot);
    updaters.push((t) => {
      pivot.rotation.z = 0.45 * Math.sin(t * 0.22 + phase);
      pivot.rotation.x = 0.25 * Math.sin(t * 0.31 + phase * 1.7);
    });
  }

  // ---------- near hero towers with billboards ----------
  const billboardDefs: Array<[string, number]> = [
    ['夜市酒場', 0xff2bdb], ['電脳網域', 0x5af2ff], ['未来不動産', 0xffe14d],
    ['RAMEN★', 0xff8a3d], ['NEON DANCE', 0x39ff88], ['仁愛医院', 0xff4d6b],
  ];
  // hero towers flank the view corridor — none planted dead-center
  const heroParams: Array<[number, number, number, number]> = [
    [-85, 110, 26, 175], [80, 130, 30, 200], [-130, 200, 34, 215],
    [115, 240, 30, 230], [-95, 320, 40, 250], [70, 380, 44, 235],
  ];
  let bb = 0;
  for (const [hx, hz, hw, hh] of heroParams) {
    const mat = towerMats[bb % towerMats.length];
    const tower = new THREE.Mesh(towerGeo, mat);
    tower.scale.set(hw, hh, hw);
    tower.position.set(hx, GROUND_Y, hz);
    group.add(tower);
    // 1-2 billboards per hero tower, facing the room
    for (let k = 0; k < 2 && bb < billboardDefs.length * 2; k++, bb++) {
      const [text, color] = billboardDefs[bb % billboardDefs.length];
      const bw = hw * (0.55 + (k ? 0.25 : 0));
      const bh = bw * 0.42;
      const board = new THREE.Mesh(
        new THREE.PlaneGeometry(bw, bh),
        new THREE.MeshBasicMaterial({ map: makeBillboardTexture(text, color, k % 2 === 1), fog: true }),
      );
      const by = GROUND_Y + hh * (0.55 + 0.3 * k) ;
      board.position.set(hx, Math.min(by, 30), hz - hw/2 - 0.5);
      board.rotation.y = Math.PI; // face the room (-z direction)
      group.add(board);
      const phase = bb * 1.7;
      updaters.push((t) => {
        // neon flicker: occasional brown-out per sign
        const flick = Math.sin(t * 2.1 + phase) > -0.92 ? 1 : 0.25;
        (board.material as THREE.MeshBasicMaterial).opacity = flick;
        (board.material as THREE.MeshBasicMaterial).transparent = true;
      });
    }
  }

  // ---------- dense neon AD WALLS on near hero tower faces (reference: cyberpunk lounges) ----------
  // Each near tower gets a packed grid of ~25 small billboards on its room-
  // facing (-z) façade. Uses the same buildAdWall module that powers the
  // indoor wall — re-purposed here for exteriors. Towers are scored by
  // distance so only the front 4 get them (further towers wouldn't read).
  const adTowers: Array<{ hx: number; hz: number; hw: number; yMin: number; yMax: number }> = [
    { hx: -85,  hz: 110, hw: 26, yMin: 12,  yMax: 80 },
    { hx:  80,  hz: 130, hw: 30, yMin: 15,  yMax: 88 },
    { hx: -130, hz: 200, hw: 34, yMin: 25,  yMax: 105 },
    { hx:  115, hz: 240, hw: 30, yMin: 30,  yMax: 115 },
  ];
  for (const spec of adTowers) {
    const halfW = spec.hw * 0.42;
    const adWall = buildAdWall({
      // build at local origin then rotate the whole group so panels face -z
      x: 0, facingX: -1,
      yMin: spec.yMin, yMax: spec.yMax,
      zMin: -halfW, zMax: halfW,
      cols: 5, rows: 6,
      gapRate: 0.12,
      animatedRate: 0.10,           // far panels, fewer redraws (perf)
      seed: Math.floor(spec.hx * 37 + spec.hz * 7) & 0xffffff,
    });
    adWall.group.rotation.y = -Math.PI / 2;   // turn -x face → -z face
    // tower south face = z = hz - hw/2; nudge 0.6 toward room so it sits on the surface
    adWall.group.position.set(spec.hx, 0, spec.hz - spec.hw / 2 - 0.6);
    group.add(adWall.group);
    updaters.push((t) => adWall.update(t));
  }

  // ---------- canyon light pollution: warm glow rising from street level ----------
  // (textures carry their own horizontal falloff — hard plane edges were
  // visible as magenta blocks from the window edges)
  const glowTex = makeCanyonGlowTexture();
  for (const [gz, op] of [[110, 0.22], [200, 0.3], [320, 0.36]] as const) {
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(1500, 90),
      new THREE.MeshBasicMaterial({
        map: glowTex, transparent: true, opacity: op,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }),
    );
    glow.position.set(0, GROUND_Y + 44, gz);
    glow.rotation.y = Math.PI;
    group.add(glow);
  }

  // ---------- ground avenue traffic: rivers of head/tail lights (IMG_5701) ----------
  {
    const gCount = Math.round(ctx.settings.vehicleCount * 1.4);
    const gGeo = new THREE.BoxGeometry(1.2, 0.5, 4.2);
    const gMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true });
    const ground = new THREE.InstancedMesh(gGeo, gMat, gCount);
    ground.frustumCulled = false;
    const gLanes = [-18, -10, 10, 18]; // inside the kept-clear avenue cone
    const gState = new Float32Array(gCount * 2); // [laneIdx, zPos]
    const gColor = new THREE.Color();
    for (let i = 0; i < gCount; i++) {
      const lane = i % gLanes.length;
      gState[i * 2] = lane;
      gState[i * 2 + 1] = 20 + rng() * 500;
      // x<0 lanes drive toward the viewer (headlights), x>0 away (taillights)
      ground.setColorAt(i, gColor.setHex(gLanes[lane] < 0 ? 0xfff2cc : 0xff4444));
    }
    group.add(ground);
    updaters.push((_t, dt) => {
      for (let i = 0; i < gCount; i++) {
        const lane = gState[i * 2];
        const dir = gLanes[lane] < 0 ? -1 : 1;
        let z = gState[i * 2 + 1] + dir * (34 + lane * 5) * dt;
        if (z > 530) z = 20;
        if (z < 20) z = 530;
        gState[i * 2 + 1] = z;
        m4.makeScale(1, 1, 1.6);
        m4.setPosition(gLanes[lane], GROUND_Y + 1.5, z);
        ground.setMatrixAt(i, m4);
      }
      ground.instanceMatrix.needsUpdate = true;
    });
  }

  // =====================================================================
  // W5b LIVING-STREET ADDITIONS (Layers A/B/C) — pedestrians + ground cars
  // + elevated rail. Scale reality: viewer is ~152m above street, so all of
  // this reads as luminous moving dots/streaks/lines. Density gated by
  // ctx.settings.vehicleCount; no new preset flags introduced.
  // =====================================================================

  // ---------- Layer A: sidewalk pedestrian crowd ----------
  // Tiny additive boxes along 8 sidewalks parallel to the major avenues.
  // At 152m a 1.8m human is 0.7 px wide — what reads is the colour palette
  // and the directional drift, not any shape.
  {
    const pedCount = Math.max(40, Math.round(ctx.settings.vehicleCount * 4));
    const pedGeo = new THREE.BoxGeometry(0.6, 1.8, 0.6);
    const pedMat = new THREE.MeshBasicMaterial({
      vertexColors: true, fog: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const peds = new THREE.InstancedMesh(pedGeo, pedMat, pedCount);
    peds.frustumCulled = false;
    peds.name = 'Pedestrians';
    // Two kinds of sidewalks:
    //   - Z-sidewalks alongside the main avenues (4 of them at x=±22,±27),
    //     pedestrians walk along z
    //   - X-sidewalks across cross-avenues at z=80/160/240/320, walk along x
    type Lane = { axis: 'z' | 'x'; coord: number; otherCoord: number; dir: number };
    const pedLanes: Lane[] = [
      { axis: 'z', coord: -27, otherCoord: 30, dir: +1 },
      { axis: 'z', coord: -22, otherCoord: 30, dir: -1 },
      { axis: 'z', coord:  22, otherCoord: 30, dir: +1 },
      { axis: 'z', coord:  27, otherCoord: 30, dir: -1 },
      { axis: 'x', coord:  80, otherCoord: 0,  dir: +1 },
      { axis: 'x', coord: 160, otherCoord: 0,  dir: -1 },
      { axis: 'x', coord: 240, otherCoord: 0,  dir: +1 },
      { axis: 'x', coord: 320, otherCoord: 0,  dir: -1 },
    ];
    // [laneIdx, posAlongAxis, hue]
    const pedState = new Float32Array(pedCount * 3);
    const pedC = new THREE.Color();
    const PED_HUES = [
      0xffd29a, 0xffd29a, 0xffd29a, 0xffd29a, 0xffd29a,  // 50% warm yellow
      0x5af2ff, 0x5af2ff, 0x5af2ff,                       // 30% cyan
      0xff6acc, 0xff6acc,                                  // 20% magenta (umbrellas)
    ];
    for (let i = 0; i < pedCount; i++) {
      const lane = Math.floor(rng() * pedLanes.length);
      pedState[i * 3] = lane;
      // z-lanes span z=20..520; x-lanes span x=-300..+300
      pedState[i * 3 + 1] = pedLanes[lane].axis === 'z'
        ? 20 + rng() * 500
        : -300 + rng() * 600;
      const hue = PED_HUES[Math.floor(rng() * PED_HUES.length)];
      pedState[i * 3 + 2] = hue;
      peds.setColorAt(i, pedC.setHex(hue));
    }
    group.add(peds);
    updaters.push((t, dt) => {
      const SPEED = 1.4;  // m/s, walking
      for (let i = 0; i < pedCount; i++) {
        const lane = pedLanes[pedState[i * 3]];
        let p = pedState[i * 3 + 1] + lane.dir * SPEED * dt;
        // wrap
        if (lane.axis === 'z') {
          if (p > 520) p = 20; else if (p < 20) p = 520;
          m4.identity();
          m4.setPosition(lane.coord, GROUND_Y + 1.0 + Math.sin(t * 3 + i * 0.7) * 0.05, p);
        } else {
          if (p > 300) p = -300; else if (p < -300) p = 300;
          m4.identity();
          m4.setPosition(p, GROUND_Y + 1.0 + Math.sin(t * 3 + i * 0.7) * 0.05, lane.coord);
        }
        pedState[i * 3 + 1] = p;
        peds.setMatrixAt(i, m4);
      }
      peds.instanceMatrix.needsUpdate = true;
    });
  }

  // ---------- Layer B: ground avenue cars (car-shaped) + cross-traffic ----------
  // The earlier `ground` block (lines ~427-459) is light-streak only — keep it
  // for the smear-blur effect. This layer adds car-body shapes for readable
  // headlight/taillight pairs, plus perpendicular cross-traffic at the
  // intersections painted in the street texture.
  {
    const carCount = Math.max(40, Math.round(ctx.settings.vehicleCount * 2));
    const carGeo = new THREE.BoxGeometry(1.4, 0.7, 3.4);
    const carMat = new THREE.MeshBasicMaterial({
      vertexColors: true, fog: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const cars = new THREE.InstancedMesh(carGeo, carMat, carCount);
    cars.frustumCulled = false;
    cars.name = 'GroundCars';
    // 6 lanes: existing avenue ±10/±18 plus service-road ±32
    const carLanes = [-32, -18, -10, 10, 18, 32];
    const carState = new Float32Array(carCount * 2);  // [lane, z]
    const carC = new THREE.Color();
    for (let i = 0; i < carCount; i++) {
      const lane = i % carLanes.length;
      carState[i * 2] = lane;
      carState[i * 2 + 1] = 20 + rng() * 500;
      // x<0 lanes are headlights toward viewer; x>0 are taillights away
      cars.setColorAt(i, carC.setHex(carLanes[lane] < 0 ? 0xfff2cc : 0xff4444));
    }
    group.add(cars);
    updaters.push((_t, dt) => {
      for (let i = 0; i < carCount; i++) {
        const lane = carState[i * 2];
        const dir = carLanes[lane] < 0 ? -1 : 1;
        let z = carState[i * 2 + 1] + dir * (24 + lane * 3) * dt;
        if (z > 530) z = 20; else if (z < 20) z = 530;
        carState[i * 2 + 1] = z;
        m4.identity();
        m4.setPosition(carLanes[lane], GROUND_Y + 1.5, z);
        cars.setMatrixAt(i, m4);
      }
      cars.instanceMatrix.needsUpdate = true;
    });

    // Cross-avenue traffic: short bursts running along x at the cross-streets
    // painted in makeStreetTexture (z = 80/160/240/320). Skipped on Low to
    // keep the GPU budget free.
    if (ctx.settings.preset !== 'low') {
      const crossCount = 60;
      const crossGeo = new THREE.BoxGeometry(3.4, 0.7, 1.4);  // rotated long-axis x
      const crossMat = new THREE.MeshBasicMaterial({
        vertexColors: true, fog: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const crossCars = new THREE.InstancedMesh(crossGeo, crossMat, crossCount);
      crossCars.frustumCulled = false;
      crossCars.name = 'CrossCars';
      const crossZs = [80, 160, 240, 320];
      const crossState = new Float32Array(crossCount * 2);  // [zLane, x]
      const crossC = new THREE.Color();
      for (let i = 0; i < crossCount; i++) {
        const zIdx = i % crossZs.length;
        crossState[i * 2] = zIdx;
        crossState[i * 2 + 1] = -300 + rng() * 600;
        const lane = Math.floor(i / crossZs.length) % 2;
        // alternate row direction
        crossCars.setColorAt(i, crossC.setHex(lane === 0 ? 0xfff2cc : 0xff4444));
      }
      group.add(crossCars);
      updaters.push((_t, dt) => {
        for (let i = 0; i < crossCount; i++) {
          const zIdx = crossState[i * 2];
          const lane = Math.floor(i / crossZs.length) % 2;
          const dir = lane === 0 ? 1 : -1;
          let x = crossState[i * 2 + 1] + dir * 22 * dt;
          if (x > 300) x = -300; else if (x < -300) x = 300;
          crossState[i * 2 + 1] = x;
          m4.identity();
          m4.setPosition(x, GROUND_Y + 1.5, crossZs[zIdx]);
          crossCars.setMatrixAt(i, m4);
        }
        crossCars.instanceMatrix.needsUpdate = true;
      });
    }
  }

  // ---------- Layer C: elevated rail + monorail trains ----------
  // Rails re-routed (W5b fix): both rails now stay clear of the tower belt
  // distribution at city.ts:130-145.
  //   - Rail A "depth vista": along Z, fixed x=22 inside the central view
  //     cone (|x| < 26 + z*0.13 for all z in [70, 410]). Trains travel
  //     into/out of distance — classic Blade Runner depth shot.
  //   - Rail B "cross-view foreground": along X, fixed z=45 BELOW the
  //     tower-belt start at z=70 + within the side-band gap (|x|<55, vs
  //     side-band x range 60..300). Trains slide left↔right across frame.
  // No train ever intersects a tower with this routing.
  //
  // The window-strip CanvasTexture is procedural at boot, hot-swapped to
  // the real Shanghai Maglev livery photo if available (fail-soft).
  // Tracked per-rail so the livery photos can target Rail A vs Rail B
  // independently. Also collect beam + pylon meshes for the concrete texture
  // hot-swap.
  const trainCarsByRail: THREE.Mesh[][] = [[], []];
  const railStructureMeshes: Array<THREE.Mesh | THREE.InstancedMesh> = [];
  {
    type RailSpec = {
      axis: 'x' | 'z';
      anchor: { x: number; y: number; z: number };  // beam centre
      length: number;
      span: { start: number; end: number };          // 1-D motion range along axis
      emissive: number;
      tint: number;
      idleMin: number; idleMax: number;
      speed: number;
    };
    const RAIL_SPECS: RailSpec[] = [
      // A — depth vista (along Z, in view cone)
      {
        axis: 'z',
        anchor: { x: 22, y: -42, z: 205 },
        length: 380,
        span: { start: 15, end: 395 },
        emissive: 0x55b8ff, tint: 0xc8e8ff,
        idleMin: 30, idleMax: 60,
        speed: 28,
      },
      // B — cross-view foreground (along X, before tower belt at z=70)
      {
        axis: 'x',
        anchor: { x: 0, y: -55, z: 45 },
        length: 110,
        span: { start: -55, end: 55 },
        emissive: 0xff5fb0, tint: 0xffd6e8,
        idleMin: 15, idleMax: 25,
        speed: 22,
      },
    ];
    // Procedural fallback texture for train window-strip — replaced at
    // runtime by the real livery photo if it downloads.
    const winStripCanvas = document.createElement('canvas');
    winStripCanvas.width = 1024; winStripCanvas.height = 128;
    {
      const g = winStripCanvas.getContext('2d')!;
      g.fillStyle = '#101820';
      g.fillRect(0, 0, 1024, 128);
      // 22 windows along the body
      const cell = 1024 / 22;
      for (let i = 0; i < 22; i++) {
        const x = i * cell + cell * 0.18;
        const w = cell * 0.64;
        const lit = Math.random() > 0.15;
        g.fillStyle = lit ? (Math.random() > 0.5 ? '#ffe6a8' : '#a8e4ff') : '#222a36';
        g.fillRect(x, 24, w, 24);  // upper window strip
        g.fillStyle = lit ? '#3d5160' : '#181f28';
        g.fillRect(x, 56, w, 8);   // hint of door/lower strip
      }
    }
    const winStripTex = new THREE.CanvasTexture(winStripCanvas);
    winStripTex.colorSpace = THREE.SRGBColorSpace;
    winStripTex.anisotropy = maxAniso;

    type Rail = {
      spec: RailSpec;
      cars: THREE.Mesh[];
      group: THREE.Group;
      state: { t: number; dir: number; idle: number };  // t = 1-D pos along axis
    };

    const onLow = ctx.settings.preset === 'low';
    const railsBuilt: Rail[] = [];
    const railCount = onLow ? 1 : 2;
    for (let r = 0; r < railCount; r++) {
      const spec = RAIL_SPECS[r];
      const railGroup = new THREE.Group();
      railGroup.name = `Rail_${r}_${spec.axis}`;

      // rail beam — long axis aligned with spec.axis. BoxGeometry's local
      // long axis is X; for a z-axis rail we use width=1.0, depth=length.
      const beamGeo = spec.axis === 'x'
        ? new THREE.BoxGeometry(spec.length, 0.6, 1.0)
        : new THREE.BoxGeometry(1.0, 0.6, spec.length);
      const beam = new THREE.Mesh(beamGeo, new THREE.MeshStandardMaterial({
        color: 0x223040, roughness: 0.6, metalness: 0.4,
        emissive: spec.emissive, emissiveIntensity: 0.55,
      }));
      beam.position.set(spec.anchor.x, spec.anchor.y, spec.anchor.z);
      railGroup.add(beam);
      railStructureMeshes.push(beam);

      // pylons spaced along the axis, dropping from beam to ground
      const pylonH = (spec.anchor.y - GROUND_Y) - 1;
      const pylonGeo = new THREE.BoxGeometry(0.7, pylonH, 0.7);
      const pylonMat = new THREE.MeshStandardMaterial({
        color: 0x141822, roughness: 0.7, metalness: 0.5,
        emissive: 0x223040, emissiveIntensity: 0.18,
      });
      const pylonCount = Math.max(2, Math.floor(spec.length / 60));
      const pylons = new THREE.InstancedMesh(pylonGeo, pylonMat, pylonCount);
      pylons.frustumCulled = false;
      for (let p = 0; p < pylonCount; p++) {
        const off = -spec.length / 2 + (p + 0.5) * (spec.length / pylonCount);
        const px = spec.axis === 'x' ? spec.anchor.x + off : spec.anchor.x;
        const pz = spec.axis === 'z' ? spec.anchor.z + off : spec.anchor.z;
        m4.identity();
        m4.setPosition(px, spec.anchor.y - pylonH / 2 - 0.3, pz);
        pylons.setMatrixAt(p, m4);
      }
      railGroup.add(pylons);
      railStructureMeshes.push(pylons);

      // train: 4 cars. BoxGeometry long-axis = X; for a Z-axis rail the car
      // body is built with long-axis Z so it visually follows the rail.
      const CAR_LEN = 14, CAR_W = 3.2, CAR_H = 2.6;
      const cars: THREE.Mesh[] = [];
      for (let c = 0; c < 4; c++) {
        const carGeo = spec.axis === 'x'
          ? new THREE.BoxGeometry(CAR_LEN, CAR_H, CAR_W)
          : new THREE.BoxGeometry(CAR_W, CAR_H, CAR_LEN);
        const carMat = new THREE.MeshStandardMaterial({
          color: 0xe8eef4, roughness: 0.35, metalness: 0.4,
          emissive: spec.tint, emissiveIntensity: onLow ? 0.7 : 1.0,
          map: winStripTex, emissiveMap: winStripTex,
        });
        const car = new THREE.Mesh(carGeo, carMat);
        car.name = `Train${r}_${spec.axis}_Car${c}`;
        railGroup.add(car);
        cars.push(car);
        trainCarsByRail[r].push(car);
      }
      group.add(railGroup);

      railsBuilt.push({
        spec, cars, group: railGroup,
        state: { t: spec.span.start, dir: 1, idle: 0 },
      });
    }

    updaters.push((_t, dt) => {
      const CAR_LEN = 14, CAR_GAP = 0.4;
      for (const rail of railsBuilt) {
        const { spec } = rail;
        if (rail.state.idle > 0) {
          rail.state.idle -= dt;
          // park cars far off-screen
          for (const car of rail.cars) car.position.set(9999, spec.anchor.y, 9999);
          if (rail.state.idle <= 0) {
            rail.state.dir = Math.random() > 0.5 ? 1 : -1;
            rail.state.t = rail.state.dir > 0 ? spec.span.start - 60 : spec.span.end + 60;
          }
          continue;
        }
        rail.state.t += rail.state.dir * spec.speed * dt;
        // place each car along the train, trailing behind the lead
        for (let c = 0; c < rail.cars.length; c++) {
          const offset = c * (CAR_LEN + CAR_GAP) * -rail.state.dir;
          const tAt = rail.state.t + offset;
          const px = spec.axis === 'x' ? tAt : spec.anchor.x;
          const pz = spec.axis === 'z' ? tAt : spec.anchor.z;
          rail.cars[c].position.set(px, spec.anchor.y, pz);
          rail.cars[c].rotation.y = 0;
        }
        // exited?
        if ((rail.state.dir > 0 && rail.state.t > spec.span.end + 30)
         || (rail.state.dir < 0 && rail.state.t < spec.span.start - 30)) {
          rail.state.idle = spec.idleMin + Math.random() * (spec.idleMax - spec.idleMin);
        }
      }
    });

    // Real livery textures (W5b-rails): Rail A trains get the Shanghai
    // Maglev side livery (white-teal, futuristic); Rail B gets a Tokyo
    // Monorail / metro-side photo for visual variety so the two trains
    // don't look identical when they're both visible. Fail-soft: each rail
    // independently falls back to the procedural window strip.
    const applyLivery = (url: string, cars: THREE.Mesh[]) => {
      new THREE.TextureLoader().load(
        url,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.anisotropy = maxAniso;
          for (const car of cars) {
            const m = car.material as THREE.MeshStandardMaterial;
            m.map = tex;
            m.emissiveMap = tex;
            m.emissiveIntensity = Math.max(m.emissiveIntensity, 0.85);
            m.needsUpdate = true;
          }
        },
        undefined,
        () => { /* missing — procedural window strip stays */ },
      );
    };
    applyLivery(
      '/assets/textures/street_live/train_livery_a.jpg',
      trainCarsByRail[0] ?? [],
    );
    if (trainCarsByRail[1]?.length) {
      applyLivery(
        '/assets/textures/street_live/train_livery_b.jpg',
        trainCarsByRail[1],
      );
    }

    // Concrete texture for the elevated rail beam + pylons (W5b-rails).
    // Tile aggressively along the long axis so cast-concrete grain reads at
    // the right scale from the viewer's distance. Fail-soft.
    new THREE.TextureLoader().load(
      '/assets/textures/street_live/concrete_diff.jpg',
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = maxAniso;
        for (const mesh of railStructureMeshes) {
          const m = (mesh as THREE.Mesh).material as THREE.MeshStandardMaterial;
          // Per-material texture clone so beam (long, narrow) and pylons
          // (tall, thin) can have different UV repeats.
          const localTex = tex.clone();
          localTex.needsUpdate = true;
          if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
            // pylons — tall verticals, repeat along Y
            localTex.repeat.set(1, 6);
          } else {
            // beam — repeat 8× along its longest axis
            localTex.repeat.set(8, 1);
          }
          m.map = localTex;
          m.color.setHex(0xa0b4cc);  // lift slightly so the dark tinted concrete reads
          m.needsUpdate = true;
        }
      },
      undefined,
      () => { /* missing — keep procedural look */ },
    );
  }

  // ---------- W5b: large LED façade billboards (real photo) ----------
  // Apply the Shibuya night photo as a stationary emissive LED panel on
  // 4 selected tower faces near the player's viewing angle. Reads as
  // "giant Times-Square-style screen" — way more punch than procedural
  // and uses a real cyberpunk-coded photograph. Fail-soft.
  {
    const facadeSpots = [
      { x:  -42, y: GROUND_Y + 70, z: 120, rotY: 0,         w: 28, h: 32 },
      { x:   58, y: GROUND_Y + 90, z: 170, rotY: -0.25,     w: 34, h: 38 },
      { x:  -70, y: GROUND_Y + 60, z: 230, rotY: 0.18,      w: 30, h: 34 },
      { x:   95, y: GROUND_Y + 50, z: 290, rotY: -0.10,     w: 26, h: 30 },
    ];
    new THREE.TextureLoader().load(
      '/assets/textures/street_live/city_aerial_night.jpg',
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = maxAniso;
        // Each panel gets its own material (so we can flicker opacity per
        // spot independently) and its own phase offset for the LFO. The
        // flicker mixes a slow LFO with a rare full-outage so the city
        // reads as a living grid of dodgy projectors.
        type PanelAnim = {
          mat: THREE.MeshBasicMaterial;
          phase: number;
          outageUntil: number;       // t-seconds until power is restored
          nextOutage: number;        // next planned outage start
        };
        const panels: PanelAnim[] = [];
        for (const s of facadeSpots) {
          const mat = new THREE.MeshBasicMaterial({
            map: tex,
            transparent: true,          // need transparency for flicker
            opacity: 1.0,
            depthWrite: true,
            fog: true,
            toneMapped: false,
          });
          const panel = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), mat);
          panel.position.set(s.x, s.y, s.z);
          panel.rotation.y = s.rotY;
          panel.name = `FacadeLED_${s.x}_${s.z}`;
          group.add(panel);
          panels.push({
            mat,
            phase: Math.random() * Math.PI * 2,
            outageUntil: 0,
            nextOutage: 8 + Math.random() * 20,
          });
        }
        updaters.push((t, _dt) => {
          for (const p of panels) {
            // Slow LFO: opacity 0.78..1.00 — feels like power-grid jitter
            let op = 0.89 + 0.11 * Math.sin(t * 1.4 + p.phase);
            // Fast micro-flicker: occasional sub-frame dim
            op *= 0.92 + 0.08 * Math.sin(t * 17.3 + p.phase * 2.1);
            // Outage event: ~every 12-30s a 0.4-1.2s window where the
            // panel cuts to near-black (a transformer brown-out look)
            if (t < p.outageUntil) {
              op *= 0.06;
            } else if (t > p.nextOutage) {
              p.outageUntil = t + 0.4 + Math.random() * 0.8;
              p.nextOutage = t + 12 + Math.random() * 18;
            }
            p.mat.opacity = op;
          }
        });
      },
      undefined,
      () => { /* texture missing — fewer billboards is fine */ },
    );
  }

  // ---------- haze layers for depth (soft-edged texture, no hard rims) ----------
  const hazeTex = makeHazeTexture();
  for (const [hz, op] of [[90, 0.30], [170, 0.45], [290, 0.6]] as const) {
    const haze = new THREE.Mesh(
      new THREE.PlaneGeometry(1700, 360),
      new THREE.MeshBasicMaterial({
        map: hazeTex, transparent: true, opacity: op, depthWrite: false, fog: false,
      }),
    );
    haze.position.set(0, 10, hz);
    haze.rotation.y = Math.PI;
    group.add(haze);
  }

  // ---------- flying vehicles (instanced light streaks) ----------
  const vCount = ctx.settings.vehicleCount;
  const vGeo = new THREE.BoxGeometry(2.6, 0.5, 1.0);
  const vMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true });
  const vehicles = new THREE.InstancedMesh(vGeo, vMat, vCount);
  vehicles.frustumCulled = false;
  const lanes: Array<{ y: number; z: number; dir: number; speed: number }> = [];
  for (let i = 0; i < 8; i++) {
    lanes.push({
      y: -55 + i * 11 + (i > 5 ? 40 : 0),   // two lanes pass close above window height
      z: 45 + i * 38,
      dir: i % 2 === 0 ? 1 : -1,
      speed: 26 + (i % 3) * 14,
    });
  }
  const vState = new Float32Array(vCount * 2); // [laneIdx, xPos]
  const vColor = new THREE.Color();
  for (let i = 0; i < vCount; i++) {
    const lane = Math.floor(rng() * lanes.length);
    vState[i * 2] = lane;
    vState[i * 2 + 1] = (rng() - 0.5) * 600;
    vehicles.setColorAt(i, vColor.setHex(lanes[lane].dir > 0 ? 0xffeecc : 0xff5566));
  }
  group.add(vehicles);
  updaters.push((_t, dt) => {
    for (let i = 0; i < vCount; i++) {
      const lane = lanes[vState[i * 2]];
      let x = vState[i * 2 + 1] + lane.dir * lane.speed * dt;
      if (x > 330) x = -330;
      if (x < -330) x = 330;
      vState[i * 2 + 1] = x;
      m4.makeScale(1 + lane.speed * 0.04, 1, 1); // faster = longer streak
      m4.setPosition(x, lane.y, lane.z);
      vehicles.setMatrixAt(i, m4);
    }
    vehicles.instanceMatrix.needsUpdate = true;
  });

  // ---------- ad blimp (lit hull — an unlit one reads as a "black ball") ----------
  const blimp = new THREE.Group();
  const hull = new THREE.Mesh(
    new THREE.SphereGeometry(9, 20, 14),
    new THREE.MeshStandardMaterial({
      color: 0x2a3450, roughness: 0.5, metalness: 0.3,
      emissiveMap: aniso(makeWindowTexture(0xff2bdb)), emissive: 0xffffff, emissiveIntensity: 0.5,
    }),
  );
  hull.scale.set(2.6, 1, 1);
  blimp.add(hull);
  const adMat = new THREE.MeshBasicMaterial({
    map: makeBillboardTexture('NEON COLA', 0x5af2ff), fog: true, side: THREE.DoubleSide,
  });
  const ad = new THREE.Mesh(new THREE.PlaneGeometry(36, 14), adMat);
  ad.position.y = -2;
  blimp.add(ad);
  // blinking nav lights at nose/tail/top
  const navLights: THREE.Mesh[] = [];
  for (const [nx, ny, hue] of [[23, 0, 0xff3344], [-23, 0, 0x39ff88], [0, 9.5, 0xffffff]] as const) {
    const nav = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 8, 6),
      new THREE.MeshBasicMaterial({ color: hue, fog: false }),
    );
    nav.position.set(nx, ny, 0);
    blimp.add(nav);
    navLights.push(nav);
  }
  blimp.position.set(-260, 26, 120);
  group.add(blimp);
  let blimpX = -260;
  let blimpWait = 0;
  updaters.push((t, dt) => {
    navLights[0].visible = Math.sin(t * 4) > 0;
    navLights[1].visible = Math.sin(t * 4 + 1.5) > 0;
    navLights[2].visible = Math.sin(t * 7) > -0.4;
    if (blimpWait > 0) { blimpWait -= dt; blimp.visible = false; return; }
    blimp.visible = true;
    blimpX += 3.2 * dt;
    if (blimpX > 280) { blimpX = -280; blimpWait = 25 + Math.random() * 50; }
    blimp.position.set(blimpX, 26 + Math.sin(t * 0.18) * 2.5, 120);
  });

  // ---------- holographic ads between the towers (Cyberpunk-movie style) ----------
  const holoUniforms: Array<{ uTime: { value: number } }> = [];
  const makeHolo = (glyph: string, color: number, w: number, h: number,
                    x: number, y: number, z: number, ry: number) => {
    const uniforms = {
      uTime: { value: 0 },
      uTex: { value: makeHoloTexture(glyph) },
      uColor: { value: new THREE.Color(color) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform sampler2D uTex;
        uniform vec3 uColor;
        uniform float uTime;
        void main() {
          vec4 tex = texture2D(uTex, vUv);
          float scan = 0.75 + 0.25 * sin((vUv.y * 90.0) + uTime * 3.0);
          float flick = 0.82 + 0.18 * sin(uTime * 19.0 + sin(uTime * 6.7) * 4.0);
          float edge = smoothstep(0.0, 0.1, vUv.x) * smoothstep(1.0, 0.9, vUv.x)
                     * smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.92, vUv.y);
          float a = tex.a * scan * flick * edge * 0.85;
          gl_FragColor = vec4(uColor * (tex.rgb + 0.25), a);
        }
      `,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    group.add(m);
    holoUniforms.push(uniforms);
    return m;
  };
  const holoA = makeHolo('夢', 0x5af2ff, 26, 40, -58, -6, 150, Math.PI - 0.25);
  const holoB = makeHolo('飲', 0xff4dd2, 30, 46, 64, -22, 205, Math.PI + 0.3);
  updaters.push((t) => {
    for (const u of holoUniforms) u.uTime.value = t;
    holoA.rotation.y = Math.PI - 0.25 + 0.1 * Math.sin(t * 0.4);
    holoB.rotation.y = Math.PI + 0.3 + 0.12 * Math.sin(t * 0.33 + 2);
  });

  // ---------- video holo-ads: real clips projected between the towers ----------
  // black pixels vanish under additive blending → instant hologram look
  const AD_FILES: Array<[string, string]> = [
    ['/assets/video/hoload_mcl_fEI7nFU.mp4', 'Mr. Whitey™'],
    ['/assets/video/hoload_TW-T7iP5xvk.mp4', 'MEGACITY LOOP'],
    ['/assets/video/hoload_pyR8g6a10R0.mp4', 'I OWN TIME'],
  ];
  // Slot kinds:
  //   'air'  — floating mid-air projection between buildings (default size)
  //   'wall' — bigger projection flush against a tower face, simulating a
  //            giant LED wrap. Wall slots are positioned just outside the
  //            tower-belt cone where main towers actually sit (~z=70+).
  type AdSlot = { x: number; y: number; z: number; ry: number;
                  mode: 'air' | 'wall'; w: number; h: number; };
  const AD_SLOTS: AdSlot[] = [
    { x: -46, y:   8, z: 135, ry: Math.PI - 0.25, mode: 'air',  w: 30, h: 16.9 },
    { x:  60, y:  -2, z: 180, ry: Math.PI + 0.3,  mode: 'air',  w: 30, h: 16.9 },
    { x:   2, y:  26, z: 250, ry: Math.PI,        mode: 'air',  w: 30, h: 16.9 },
    // Wall-mounted: bigger panels parked on tower faces visible from the
    // window. Sizes match the LED-billboard scale (28-50m wide × 30m tall).
    // ry derived from atan2(x_to_player, z_to_player) so each panel faces
    // the spawn camera at (~0, _, 0).
    { x: -52, y:  20, z: 110, ry: Math.PI - 0.44, mode: 'wall', w: 48, h: 28 },
    { x:  65, y:  35, z: 150, ry: Math.PI + 0.41, mode: 'wall', w: 50, h: 30 },
    { x: -38, y:  12, z: 200, ry: Math.PI - 0.19, mode: 'wall', w: 42, h: 26 },
  ];
  const adVideo = document.createElement('video');
  adVideo.muted = true;
  adVideo.playsInline = true;
  adVideo.preload = 'auto';
  const adTex = new THREE.VideoTexture(adVideo);
  adTex.colorSpace = THREE.SRGBColorSpace;
  const adUniforms = {
    uTime: { value: 0 },
    uTex: { value: adTex as THREE.Texture },
  };
  const holoAdMat = new THREE.ShaderMaterial({
    uniforms: adUniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform sampler2D uTex;
      uniform float uTime;
      void main() {
        vec3 tex = texture2D(uTex, vUv).rgb;
        float scan = 0.8 + 0.2 * sin((vUv.y * 140.0) + uTime * 4.0);
        float flick = 0.85 + 0.15 * sin(uTime * 17.0 + sin(uTime * 5.3) * 3.0);
        float edge = smoothstep(0.0, 0.07, vUv.x) * smoothstep(1.0, 0.93, vUv.x)
                   * smoothstep(0.0, 0.1, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
        // cool holographic cast
        vec3 c = tex * vec3(0.75, 0.95, 1.15) * scan * flick * edge;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  const adPlane = new THREE.Mesh(new THREE.PlaneGeometry(30, 16.9), holoAdMat);
  adPlane.visible = false;
  group.add(adPlane);
  let adCooldown = 14;          // first appearance shortly after boot
  let adsPaused = false;
  let adPlaying = false;
  let adName = '';
  const startAd = (): string => {
    const [file, name] = AD_FILES[Math.floor(Math.random() * AD_FILES.length)];
    const slot = AD_SLOTS[Math.floor(Math.random() * AD_SLOTS.length)];
    adPlane.position.set(slot.x, slot.y, slot.z);
    adPlane.rotation.y = slot.ry;
    // Re-scale the plane to match the slot's intended footprint. Base
    // geometry is 30×16.9 so scale factors derive from that.
    adPlane.scale.set(slot.w / 30, slot.h / 16.9, 1);
    adName = name;
    adVideo.src = file;
    adVideo.currentTime = 0;
    adVideo.play().then(() => {
      adPlaying = true;
      adPlane.visible = true;
    }).catch(() => { adCooldown = 20; });
    return name;
  };
  adVideo.addEventListener('ended', () => {
    adPlaying = false;
    adPlane.visible = false;
    adCooldown = 18 + Math.random() * 40;
  });
  updaters.push((t, dt) => {
    adUniforms.uTime.value = t;
    if (!adPlaying && !adsPaused) {
      adCooldown -= dt;
      if (adCooldown <= 0) startAd();
    }
  });

  // rotating holo octahedron floating over the avenue
  const holoGem = new THREE.Mesh(
    new THREE.OctahedronGeometry(7, 0),
    new THREE.MeshBasicMaterial({
      color: 0x5af2ff, wireframe: true, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }),
  );
  holoGem.position.set(2, -8, 130);
  group.add(holoGem);
  updaters.push((t) => {
    holoGem.rotation.y = t * 0.5;
    holoGem.rotation.x = Math.sin(t * 0.3) * 0.3;
    holoGem.position.y = -8 + Math.sin(t * 0.6) * 2;
  });

  ctx.scene.add(group);

  // ---------- M4 flicker timeline ----------
  // Three layered behaviours:
  //   1) sub-pulse: per-frame temporal-hash on the 3 tower material emissives
  //   2) brownout: temporarily kill one material's emissive for 0.5-1.5s
  //   3) lightning: a downward flash via a transient DirectionalLight
  // ON by default once W5 lands — moods/preset/term toggle to taste.
  const baseEmissives = towerMats.map((m) => m.emissiveIntensity);
  const MATERIAL_LABELS = ['青藍', '霓桃', '琥珀'];
  let flickerOn = true;
  let brownoutMatIdx = -1;
  let brownoutT = 0;     // seconds remaining
  let brownoutPrev = 0;  // saved emissive
  // lightning rim light from above the window — added off-screen and pulsed
  const lightning = new THREE.DirectionalLight(0xe8ecff, 0);
  lightning.position.set(0, 80, 30);
  lightning.target.position.set(0, 0, 5);
  ctx.scene.add(lightning);
  ctx.scene.add(lightning.target);
  let lightningT = 0;    // seconds remaining
  const LIGHTNING_PEAK = 5.5;

  const triggerBrownout = (): string => {
    if (brownoutT > 0) return MATERIAL_LABELS[brownoutMatIdx] + ' 區域已熄燈';
    brownoutMatIdx = Math.floor(Math.random() * towerMats.length);
    brownoutPrev = towerMats[brownoutMatIdx].emissiveIntensity;
    brownoutT = 0.5 + Math.random() * 1.0;
    towerMats[brownoutMatIdx].emissiveIntensity = 0.04;
    return MATERIAL_LABELS[brownoutMatIdx] + ' 區域熄燈';
  };
  const triggerLightning = (): void => {
    lightningT = 0.32;
    lightning.intensity = LIGHTNING_PEAK;
  };

  // automatic brownout / lightning timers (decoupled from flickerOn — flicker
  // only gates the per-frame sub-pulse; brownouts and thunder fire on their
  // own schedule for atmosphere)
  let brownoutCooldown = 30 + Math.random() * 60;
  let lightningCooldown = 60 * (4 + Math.random() * 4);

  const update = (t: number, dt: number) => {
    for (const f of updaters) f(t, dt);
    const h = 0.5 + 0.5 * Math.sin(t * 0.25);
    (skyMat.uniforms.uHorizon.value as THREE.Color).setRGB(
      0.33 + 0.05 * h, 0.11, 0.27 + 0.05 * (1 - h),
    );

    // 1) sub-pulse on the 3 tower materials — each follows a slow LFO with a
    //    different phase so the city "breathes" instead of strobing in unison
    if (flickerOn) {
      for (let i = 0; i < towerMats.length; i++) {
        if (i === brownoutMatIdx && brownoutT > 0) continue;
        const lfo = 0.85 + 0.15 * Math.sin(t * (0.43 + i * 0.31) + i * 1.7);
        // occasional spike (every ~7s per material, offset by hash)
        const spikePhase = (t * 0.45 + i * 0.31) % 7;
        const spike = spikePhase < 0.18 ? 1.18 : 1.0;
        towerMats[i].emissiveIntensity = baseEmissives[i] * lfo * spike;
      }
    }
    // 2) brownout decay
    if (brownoutT > 0) {
      brownoutT -= dt;
      if (brownoutT <= 0 && brownoutMatIdx >= 0) {
        towerMats[brownoutMatIdx].emissiveIntensity = brownoutPrev;
        brownoutMatIdx = -1;
      }
    } else {
      brownoutCooldown -= dt;
      if (brownoutCooldown <= 0) {
        brownoutCooldown = 30 + Math.random() * 60;
        triggerBrownout();
      }
    }
    // 3) lightning decay (exp falloff)
    if (lightningT > 0) {
      lightningT -= dt;
      lightning.intensity = Math.max(0, LIGHTNING_PEAK * (lightningT / 0.32));
      if (lightningT <= 0) lightning.intensity = 0;
    } else {
      lightningCooldown -= dt;
      if (lightningCooldown <= 0) {
        lightningCooldown = 60 * (4 + Math.random() * 4);
        triggerLightning();
      }
    }
  };
  // Pre-sorted volumetric source anchors visible through the window —
  // ordered brightest-first so consumers can trim to settings.volumetricSources.
  // World-space (each was already added to `group` in scene coords; we read
  // their position vectors directly since group sits at scene origin).
  const volumetricAnchors: THREE.Vector3[] = [
    new THREE.Vector3(70, 36, 380),         // rotating holo ring (line 295)
    new THREE.Vector3(2, -8, 130),          // holo octahedron over the avenue
    new THREE.Vector3(-130, GROUND_Y + 215, 200), // first sweeping searchlight base
  ];

  return {
    group, update, skyDome: sky, triggerAd: startAd, adVideo,
    setAdsPaused: (p) => {
      adsPaused = p;
      if (p && adPlaying) {
        adVideo.pause();
        adPlaying = false;
        adPlane.visible = false;
        adCooldown = 20;
      }
    },
    volumetricAnchors,
    setFlicker: (on) => {
      flickerOn = on;
      // restore baselines when disabling so the city stops in a known state
      if (!on) {
        for (let i = 0; i < towerMats.length; i++) {
          if (i !== brownoutMatIdx) towerMats[i].emissiveIntensity = baseEmissives[i];
        }
      }
    },
    isFlickerOn: () => flickerOn,
    triggerBrownout,
    triggerLightning,
  };
}

// ---------- photo backdrop (user-supplied AI panoramas) ----------

async function loadPhotoBackdrop(group: THREE.Group): Promise<void> {
  const load = (url: string) => new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });

  // soft-edged, horizontally mirrored copy (inside of a cylinder flips U)
  const processed = (img: HTMLImageElement, mirror: boolean) => {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d')!;
    if (mirror) { g.scale(-1, 1); g.drawImage(img, -c.width, 0); g.setTransform(1, 0, 0, 1, 0, 0); }
    else g.drawImage(img, 0, 0);
    fadeEnds(g, c.width, c.height, 0.2);
    // fade the top into the sky dome
    const grad = g.createLinearGradient(0, 0, 0, c.height * 0.3);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height * 0.3);
    g.globalCompositeOperation = 'source-over';
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
  };

  try {
    // main aerial panorama on a curved shell behind the towers
    const aerial = await load('/assets/textures/backdrop/backdrop_aerial.png');
    const theta = 1.5;
    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(430, 430, 260, 48, 1, true, -theta / 2, theta),
      new THREE.MeshBasicMaterial({
        map: processed(aerial, true), transparent: true, side: THREE.BackSide,
        depthWrite: false, fog: false, toneMapped: false,
        color: 0x9aa2c4, // pull the photo toward the scene's cool night grade
      }),
    );
    cyl.position.set(0, -28, 0);
    group.add(cyl);
  } catch { /* no backdrop asset; procedural layers carry the view */ }

  // street-level fills angled in from the sides
  const sides: Array<[string, number, number, number, number]> = [
    ['/assets/textures/backdrop/backdrop_street_a.png', -240, -52, 215, Math.PI - 0.65],
    ['/assets/textures/backdrop/backdrop_street_b.png', 245, -58, 235, Math.PI + 0.7],
  ];
  for (const [url, x, y, z, ry] of sides) {
    try {
      const img = await load(url);
      const w = 250;
      const h = w * (img.naturalHeight / img.naturalWidth);
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({
          map: processed(img, false), transparent: true, depthWrite: false,
          fog: false, toneMapped: false, color: 0x8c94b8,
        }),
      );
      plane.position.set(x, y, z);
      plane.rotation.y = ry;
      group.add(plane);
    } catch { /* optional */ }
  }
}

function makeHoloTexture(glyph: string): THREE.CanvasTexture {
  // giant glyph + projection ring — white on transparent, tinted by the shader
  const c = document.createElement('canvas');
  c.width = 256; c.height = 384;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 256, 384);
  g.strokeStyle = '#ffffff'; g.lineWidth = 3;
  g.globalAlpha = 0.5;
  g.beginPath(); g.ellipse(128, 350, 100, 18, 0, 0, 7); g.stroke();
  g.beginPath(); g.ellipse(128, 350, 70, 12, 0, 0, 7); g.stroke();
  g.globalAlpha = 1;
  g.shadowColor = '#ffffff'; g.shadowBlur = 26;
  g.fillStyle = '#ffffff';
  g.font = 'bold 190px sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(glyph, 128, 165);
  g.font = 'bold 30px sans-serif';
  g.fillText('● ● ●', 128, 300);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// deterministic layout so the skyline doesn't reshuffle every reload
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let v = Math.imul(a ^ (a >>> 15), 1 | a);
    v = (v + Math.imul(v ^ (v >>> 7), 61 | v)) ^ v;
    return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
  };
}

// Holographic billboard animator for the hero-tower front face. Layers
// (all very subtle — the whole point is to whisper "this is a projection,
// not a poster"):
//   - slow hue cycle: cyan → blue → magenta → purple, period ~30s
//   - brightness LFO: sin breathing at ~0.4Hz, amplitude ±18%
//   - rare glitch: every ~5-9s, a single frame dimmed to 25-50% brightness
//   - channel swap on glitch (W5b-holo direction B): the glitch frame
//     also advances `mat.map = playlist[(idx+1) % N]`. Reads as the
//     hologram momentarily losing signal then re-establishing on a
//     different channel.
// `phase` is a per-tower offset so two hero towers don't sync. Mutates
// material.color in place; callers should NOT also tint it elsewhere.
function animateHologram(
  mat: THREE.MeshBasicMaterial,
  phase: number,
  updaters: Array<(t: number, dt: number) => void>,
  playlist: THREE.Texture[],
): void {
  let glitchT = 0;
  let glitchK = 1;
  let nextGlitch = 5 + Math.random() * 4 + phase;
  // Channel state — start on the first texture (caller sets it on first
  // arrival; we just track the index here for the rotation).
  let channelIdx = 0;
  let nextChannelSwap = 18 + Math.random() * 7 + phase;
  updaters.push((t, _dt) => {
    // 1) hue cycle
    const h = 0.58 + 0.18 * Math.sin(t * 0.21 + phase);
    const s = 0.18;
    const l = 0.50 + 0.18 * Math.sin(t * 2.6 + phase * 1.7);
    mat.color.setHSL(h, s, l);
    // 2) brightness LFO is the L term above
    // 3) glitch (+ channel swap on glitch, if due)
    if (t > nextGlitch) {
      glitchT = 1;
      glitchK = 0.25 + Math.random() * 0.25;
      nextGlitch = t + 5 + Math.random() * 4;
      // Sync channel swap to this glitch if a swap is due — covers the
      // texture change behind a dimmed frame so the cut isn't jarring
      if (t > nextChannelSwap && playlist.length > 1) {
        channelIdx = (channelIdx + 1) % playlist.length;
        mat.map = playlist[channelIdx];
        mat.needsUpdate = true;
        nextChannelSwap = t + 18 + Math.random() * 7;
      }
    }
    // 3b) fallback channel swap if no glitch has fired by 3s past due —
    //     ensures we never park forever on one image
    if (t > nextChannelSwap + 3 && playlist.length > 1) {
      channelIdx = (channelIdx + 1) % playlist.length;
      mat.map = playlist[channelIdx];
      mat.needsUpdate = true;
      nextChannelSwap = t + 18 + Math.random() * 7;
    }
    if (glitchT > 0) {
      mat.color.multiplyScalar(glitchK);
      glitchT -= 1;
    }
  });
}

function makeStreetTexture(
  wet: boolean = false,
  photoImg: HTMLImageElement | null = null,
  asphaltImg: HTMLImageElement | null = null,
): THREE.CanvasTexture {
  // 2048² and cool purple-white avenues per IMG_5703: the old 1024 orange
  // avenue smeared into a dirty yellow band across the city center.
  // When `wet=true` (M2, enableWetCity), the avenues gain bright vertical
  // smear streaks + brighter intersection pools — reads as "wet asphalt
  // catching neon" without any GPU cost.
  //
  // W5b fix: optional photographic textures can layer onto the canvas:
  //   - `asphaltImg` (ambientCG wet asphalt) baked as the BASE layer so the
  //     ground reads as real tarmac, not a flat colour
  //   - `photoImg` (aerial night skyline) screen-blended on top at 0.35
  //     alpha so real headlight scatter + lit windows punch through
  // Both are fail-soft: if not provided, fall through to all-procedural.
  const S = 2048;
  const cell = S / 16;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#05060c';
  g.fillRect(0, 0, S, S);
  // base layer: real wet-asphalt photo tiled 4×4 across the 2048² canvas.
  // 1024² tile at 512px size means 4×4=16 tiles fit. Slight per-tile rotation
  // would help break repetition but at 152m viewing distance it's overkill.
  if (asphaltImg) {
    g.globalAlpha = 0.75;  // let the dark base bleed through so it's not too bright
    const TILE = 512;
    for (let ty = 0; ty < S; ty += TILE) {
      for (let tx = 0; tx < S; tx += TILE) {
        g.drawImage(asphaltImg, tx, ty, TILE, TILE);
      }
    }
    g.globalAlpha = 1;
  }
  // avenue grid — thin crisp cores with a soft lavender bloom
  for (let i = 0; i <= 16; i++) {
    const p = i * cell;
    const major = i % 4 === 0;
    // wide dim bloom first — slightly broader and brighter when wet
    g.strokeStyle = major
      ? (wet ? 'rgba(210,180,255,0.32)' : 'rgba(190,160,255,0.22)')
      : (wet ? 'rgba(120,100,170,0.26)' : 'rgba(90,80,140,0.18)');
    g.lineWidth = major ? (wet ? 34 : 26) : (wet ? 12 : 8);
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(S, p); g.stroke();
    // crisp bright core
    g.strokeStyle = major ? '#e8e2ff' : '#6a5f9a';
    g.lineWidth = major ? 5 : 2;
    g.globalAlpha = major ? 0.95 : 0.6;
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(S, p); g.stroke();
    g.globalAlpha = 1;
  }
  // wet avenue specular streaks — long bright stripes running along the
  // major avenues. Different lengths/offsets so it doesn't read as a ruler.
  if (wet) {
    g.globalAlpha = 0.55;
    for (let i = 0; i <= 4; i++) {
      const p = i * (S / 4);
      for (let k = 0; k < 36; k++) {
        const yStart = Math.random() * S;
        const len = 90 + Math.random() * 240;
        const hue = ['#cfd4ff', '#ffd6ff', '#bfeaff', '#ffe4c4'][k % 4];
        // vertical streak alongside the avenue core (slightly offset)
        const offX = (Math.random() - 0.5) * 14;
        const offY = (Math.random() - 0.5) * 14;
        g.fillStyle = hue;
        g.fillRect(p + offX - 1, yStart, 2, len);            // vertical
        g.fillRect(yStart, p + offY - 1, len, 2);            // horizontal mirror
      }
    }
    g.globalAlpha = 1;
  }
  // traffic dashes along the major avenues (white headlights / red tails)
  for (let i = 0; i <= 4; i++) {
    const p = i * (S / 4);
    for (let k = 0; k < 160; k++) {
      g.fillStyle = ['#ffffff', '#d8ccff', '#ff5566'][k % 3];
      g.globalAlpha = 0.5 + Math.random() * 0.5;
      g.fillRect(p - 7 + Math.random() * 14, Math.random() * S, 3, 11);
      g.fillRect(Math.random() * S, p - 7 + Math.random() * 14, 11, 3);
    }
  }
  // storefront / block speckle
  g.globalAlpha = 0.4;
  for (let i = 0; i < 1600; i++) {
    g.fillStyle = ['#5af2ff', '#ff2bdb', '#b48cff', '#fff2cc'][i % 4];
    g.fillRect(Math.random() * S, Math.random() * S, 5 + Math.random() * 26, 4 + Math.random() * 16);
  }
  // cool glow pools at intersections (purple-white, per reference).
  // Wet variant: larger and brighter — reads as puddle-light catching neon.
  g.globalAlpha = 1;
  const poolR = wet ? 170 : 130;
  for (let gx = 0; gx <= 4; gx++) {
    for (let gy = 0; gy <= 4; gy++) {
      const x = gx * (S / 4), y = gy * (S / 4);
      const grad = g.createRadialGradient(x, y, 0, x, y, poolR);
      grad.addColorStop(0, wet ? 'rgba(240,225,255,0.62)' : 'rgba(225,205,255,0.5)');
      grad.addColorStop(0.5, wet ? 'rgba(185,135,255,0.30)' : 'rgba(170,120,255,0.22)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(x - poolR, y - poolR, poolR * 2, poolR * 2);
    }
  }
  // Photo overlay: blend the aerial night skyline at low alpha + screen
  // compositing so the photo's lit windows add as light, not block detail.
  // Tile 2x2 so a single 1024² photo covers the 2048² canvas; the resulting
  // pattern at 152m viewing distance reads as real city-light scatter on the
  // road surface, not as a recognisable cityscape.
  if (photoImg) {
    g.globalAlpha = 0.35;
    g.globalCompositeOperation = 'screen';
    const TILE = 1024;
    for (let ty = 0; ty < S; ty += TILE) {
      for (let tx = 0; tx < S; tx += TILE) {
        g.drawImage(photoImg, tx, ty, TILE, TILE);
      }
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeWindowTexture(accent: number): THREE.CanvasTexture {
  // 512×1024 with ~10px cells: 4× the window density of the old 128×512 —
  // façades stop reading as giant blocky pixels (user feedback on texture res)
  const c = document.createElement('canvas');
  c.width = 512; c.height = 1024;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 512, 1024);
  const accHex = '#' + accent.toString(16).padStart(6, '0');
  // faint floor slabs give the façade structure between lit windows
  g.fillStyle = '#0d111c';
  for (let y = 0; y < 1024; y += 13) g.fillRect(0, y, 512, 2);
  for (let y = 4; y < 1018; y += 13) {
    // occasional fully-lit floor band (commercial levels, per IMG_5698)
    const band = Math.random() < 0.05;
    for (let x = 3; x < 508; x += 10) {
      const r = Math.random();
      if (band || r > 0.58) {
        g.fillStyle = r > 0.9 ? accHex : '#cfd8e8';
        g.globalAlpha = band ? 0.85 : 0.3 + Math.random() * 0.7;
        g.fillRect(x, y, 6, 8);
      }
    }
    g.globalAlpha = 1;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeVerticalSignTexture(): THREE.CanvasTexture {
  // vertical CJK banner — white glyphs on dark backing, tinted per instance
  const c = document.createElement('canvas');
  c.width = 96; c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(8,6,16,0.92)';
  g.fillRect(0, 0, 96, 512);
  g.strokeStyle = '#ffffff'; g.lineWidth = 4;
  g.globalAlpha = 0.9;
  g.strokeRect(5, 5, 86, 502);
  const glyphs = '酒夢電脳未来市夜光龍茶宿命超級安全北極星雲端不夜城';
  g.fillStyle = '#ffffff';
  g.font = 'bold 58px sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = '#ffffff'; g.shadowBlur = 16;
  const n = 7;
  for (let i = 0; i < n; i++) {
    const ch = glyphs[Math.floor(Math.random() * glyphs.length)];
    g.fillText(ch, 48, 48 + i * ((512 - 80) / (n - 1)));
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCanyonGlowTexture(): THREE.CanvasTexture {
  // warm light-pollution gradient: bright at street level, fades upward AND
  // toward the sides (hard plane edges read as magenta blocks from the window)
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 128, 0, 0);
  grad.addColorStop(0, 'rgba(255,140,80,0.55)');
  grad.addColorStop(0.4, 'rgba(255,80,170,0.28)');
  grad.addColorStop(1, 'rgba(80,60,200,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 128);
  // horizontal unevenness so it doesn't read as a perfect gradient
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.05})`;
    const x = Math.random() * 512;
    g.fillRect(x, 70 + Math.random() * 58, 6 + Math.random() * 30, 60);
  }
  fadeEnds(g, 512, 128, 0.32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeHazeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#150f28';
  g.fillRect(0, 0, 256, 128);
  fadeEnds(g, 256, 128, 0.22);
  // vertical soft edges too
  const v = g.createLinearGradient(0, 0, 0, 128);
  v.addColorStop(0, 'rgba(0,0,0,1)'); v.addColorStop(0.25, 'rgba(0,0,0,0)');
  v.addColorStop(0.75, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = v;
  g.fillRect(0, 0, 256, 128);
  g.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** erase the left/right ends so wide billboard planes never show hard rims */
function fadeEnds(g: CanvasRenderingContext2D, w: number, h: number, frac: number): void {
  const fw = w * frac;
  g.globalCompositeOperation = 'destination-out';
  let grad = g.createLinearGradient(0, 0, fw, 0);
  grad.addColorStop(0, 'rgba(0,0,0,1)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, fw, h);
  grad = g.createLinearGradient(w - fw, 0, w, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = grad;
  g.fillRect(w - fw, 0, fw, h);
  g.globalCompositeOperation = 'source-over';
}

function makeSignStripTexture(): THREE.CanvasTexture {
  // abstract glyph blocks — tinted per instance, so keep it white-on-transparent
  const c = document.createElement('canvas');
  c.width = 256; c.height = 72;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 256, 72);
  g.fillStyle = '#ffffff';
  g.shadowColor = '#ffffff'; g.shadowBlur = 8;
  let x = 8;
  while (x < 240) {
    const w = 14 + Math.random() * 26;
    const h = 30 + Math.random() * 28;
    g.globalAlpha = 0.65 + Math.random() * 0.35;
    g.fillRect(x, (72 - h) / 2, w, h);
    x += w + 8 + Math.random() * 10;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeFarSkylineTexture(alpha: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 192;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 2048, 192);
  // silhouettes pre-mixed toward the fog color so they read as "through haze"
  let x = 0;
  while (x < 2048) {
    const bw = 24 + Math.random() * 70;
    const bh = 50 + Math.random() * 130;
    g.fillStyle = `rgba(26, 20, 48, ${alpha})`;
    g.fillRect(x, 192 - bh, bw, bh);
    g.fillStyle = `rgba(120, 100, 190, ${alpha * 0.35})`;
    for (let wy = 192 - bh + 6; wy < 186; wy += 14) {
      for (let wx = x + 3; wx < x + bw - 3; wx += 9) {
        if (Math.random() > 0.75) g.fillRect(wx, wy, 3, 5);
      }
    }
    x += bw + Math.random() * 8;
  }
  fadeEnds(g, 2048, 192, 0.1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeBillboardTexture(text: string, color: number, vertical = false): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = vertical ? 256 : 640;
  c.height = vertical ? 640 : 256;
  const g = c.getContext('2d')!;
  const hex = '#' + color.toString(16).padStart(6, '0');
  g.fillStyle = '#08060f';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = hex; g.lineWidth = 10;
  g.strokeRect(8, 8, c.width - 16, c.height - 16);
  g.shadowColor = hex; g.shadowBlur = 30;
  g.fillStyle = hex;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (vertical) {
    g.font = 'bold 72px sans-serif';
    const chars = [...text.replace(/\s/g, '')].slice(0, 6);
    chars.forEach((ch, i) => g.fillText(ch, 128, 80 + i * (520 / Math.max(chars.length, 1))));
  } else {
    g.font = 'bold 88px sans-serif';
    g.fillText(text, 320, 132);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
