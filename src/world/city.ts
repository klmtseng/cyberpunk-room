import * as THREE from 'three';
import type { EngineCtx } from '../engine/renderer';

export interface CityRig {
  group: THREE.Group;
  update: (t: number, dt: number) => void;
  /** procedural gradient dome — hidden when the HDRI background loads */
  skyDome: THREE.Mesh;
  /** force a video holo-ad to appear now; returns the clip name */
  triggerAd: () => string;
  adVideo: HTMLVideoElement;
  setAdsPaused: (p: boolean) => void;
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
  const streets = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900),
    new THREE.MeshBasicMaterial({ map: aniso(makeStreetTexture()), fog: true }),
  );
  streets.rotation.x = -Math.PI / 2;
  streets.position.set(0, GROUND_Y, 250);
  group.add(streets);

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
  const AD_SLOTS: Array<[number, number, number, number]> = [
    [-46, 8, 135, Math.PI - 0.25],
    [60, -2, 180, Math.PI + 0.3],
    [2, 26, 250, Math.PI],
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
    const [ax, ay, az, ry] = AD_SLOTS[Math.floor(Math.random() * AD_SLOTS.length)];
    adPlane.position.set(ax, ay, az);
    adPlane.rotation.y = ry;
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

  const update = (t: number, dt: number) => {
    for (const f of updaters) f(t, dt);
    const h = 0.5 + 0.5 * Math.sin(t * 0.25);
    (skyMat.uniforms.uHorizon.value as THREE.Color).setRGB(
      0.33 + 0.05 * h, 0.11, 0.27 + 0.05 * (1 - h),
    );
  };
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

function makeStreetTexture(): THREE.CanvasTexture {
  // 2048² and cool purple-white avenues per IMG_5703: the old 1024 orange
  // avenue smeared into a dirty yellow band across the city center
  const S = 2048;
  const cell = S / 16;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#05060c';
  g.fillRect(0, 0, S, S);
  // avenue grid — thin crisp cores with a soft lavender bloom
  for (let i = 0; i <= 16; i++) {
    const p = i * cell;
    const major = i % 4 === 0;
    // wide dim bloom first
    g.strokeStyle = major ? 'rgba(190,160,255,0.22)' : 'rgba(90,80,140,0.18)';
    g.lineWidth = major ? 26 : 8;
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
  // cool glow pools at intersections (purple-white, per reference)
  g.globalAlpha = 1;
  for (let gx = 0; gx <= 4; gx++) {
    for (let gy = 0; gy <= 4; gy++) {
      const x = gx * (S / 4), y = gy * (S / 4);
      const grad = g.createRadialGradient(x, y, 0, x, y, 130);
      grad.addColorStop(0, 'rgba(225,205,255,0.5)');
      grad.addColorStop(0.5, 'rgba(170,120,255,0.22)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(x - 130, y - 130, 260, 260);
    }
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
