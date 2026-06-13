import * as THREE from 'three';
import type { EngineCtx } from '../engine/renderer';

// Interactive props for the living area: speakers (YouTube spatial anchors),
// wall TV, record player, color-cycling neon sign, bar dressing.
export interface PropsRig {
  group: THREE.Group;
  speakerPositions: THREE.Vector3[];
  speakers: THREE.Mesh[];
  tv: {
    mesh: THREE.Mesh;
    screen: THREE.Mesh;
    cycleChannel: () => string;
    cast: (video: HTMLVideoElement) => void;
    stopCast: () => void;
    isCasting: () => boolean;
  };
  neonSign: { mesh: THREE.Mesh; light: THREE.PointLight; cycle: () => string };
  bar: { pulse: () => void; glass: THREE.Object3D };
  recordPlayer: { mesh: THREE.Mesh; setSpin: (on: boolean) => void };
  curtain: { panel: THREE.Mesh; toggle: () => boolean; amount: () => number };
  holo: { base: THREE.Mesh; cycle: () => string };
  lightPanel: THREE.Mesh;
  cat: { body: THREE.Mesh; pet: () => void };
  coffee: { machine: THREE.Mesh; brew: () => boolean };
  assistant: { base: THREE.Mesh; figure: THREE.Group; setTalk: (sec: number) => void };
  art: { frames: THREE.Mesh[]; next: () => void };
  update: (t: number, dt: number) => void;
}

const NEON_COLORS: Array<[number, string]> = [
  [0xff2bdb, '霓紅粉'], [0x5af2ff, '電氣青'], [0xb44dff, '夜紫'], [0xff8a3d, '落日橘'], [0x39ff88, '駭客綠'],
];

export function buildProps(ctx: EngineCtx): PropsRig {
  const group = new THREE.Group();
  group.name = 'Props';
  const updaters: Array<(t: number, dt: number) => void> = [];
  const artFrameMeshes: THREE.Mesh[] = [];

  const matDark = new THREE.MeshStandardMaterial({ color: 0x0a0c14, roughness: 0.4, metalness: 0.6 });
  const matBody = new THREE.MeshStandardMaterial({ color: 0x161b2c, roughness: 0.55, metalness: 0.4 });
  const matSteel = new THREE.MeshStandardMaterial({ color: 0x4a5468, roughness: 0.4, metalness: 0.8 });
  const box = (w: number, h: number, d: number, mat: THREE.Material,
               x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };

  // ---------- floor speakers flanking the desk wall ----------
  const speakerPositions: THREE.Vector3[] = [];
  const speakerBodies: THREE.Mesh[] = [];
  for (const [sx, sz] of [[3.4, 5.6], [5.6, 1.6]] as const) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.15, 0.4), matBody);
    body.position.set(sx, 0.575, sz);
    body.name = 'Speaker';
    group.add(body);
    speakerBodies.push(body);
    for (const [coneY, r] of [[0.85, 0.1], [0.45, 0.14]] as const) {
      const cone = new THREE.Mesh(
        new THREE.CircleGeometry(r, 20),
        new THREE.MeshStandardMaterial({ color: 0x05060a, roughness: 0.9, metalness: 0.1 }),
      );
      cone.position.set(sx - (sx > 5 ? 0.24 : 0), coneY, sz + (sx > 5 ? 0 : 0.21));
      if (sx > 5) cone.rotation.y = -Math.PI / 2;
      group.add(cone);
    }
    const led = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.04, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x05060a, emissive: 0x39ff88, emissiveIntensity: 2 }),
    );
    led.position.set(sx - (sx > 5 ? 0.24 : 0), 1.05, sz + (sx > 5 ? 0 : 0.21));
    group.add(led);
    speakerPositions.push(new THREE.Vector3(sx, 1.0, sz));
  }

  // ---------- spatial-projection TV: slim wall frame projects a floating
  // holo screen into the middle of the living room ----------
  const tvCanvas = document.createElement('canvas');
  tvCanvas.width = 192; tvCanvas.height = 108;
  const tvG = tvCanvas.getContext('2d')!;
  const tvTex = new THREE.CanvasTexture(tvCanvas);
  tvTex.colorSpace = THREE.SRGBColorSpace;
  let tvChannel = 0; // 0 off, 1 static, 2 ad loop, 3 city spectrum
  const tvNames = ['OFF', '雜訊', '廣告', '城市頻譜'];
  // the projector: a slim picture-frame on the wall
  const tv = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.5, 0.72),
    new THREE.MeshStandardMaterial({ color: 0x10141f, metalness: 0.7, roughness: 0.35 }),
  );
  tv.position.set(-5.84, 2.4, 2.2);
  tv.name = 'ProjectorFrame';
  group.add(tv);
  const tvLed = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.05, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x05060a, emissive: 0xff3344, emissiveIntensity: 2 }),
  );
  tvLed.position.set(-5.8, 2.2, 2.2);
  group.add(tvLed);
  // the floating screen, conjured mid-room facing the sofa
  const holoScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 1.8),
    new THREE.MeshBasicMaterial({
      map: tvTex, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  holoScreen.position.set(0.4, 2.2, 5.1);
  holoScreen.rotation.y = Math.PI;
  holoScreen.scale.y = 0.001;
  holoScreen.visible = false;
  holoScreen.name = 'HoloScreen';
  group.add(holoScreen);
  // TV-set dressing: slim bezel + glowing under-bar, scale with the screen
  const tvSet = new THREE.Group();
  const bezelMat = new THREE.MeshBasicMaterial({ color: 0x05070c });
  for (const [bw, bh, bx, by] of [
    [3.3, 0.05, 0, 0.925], [3.3, 0.05, 0, -0.925],
    [0.05, 1.9, -1.625, 0], [0.05, 1.9, 1.625, 0],
  ] as const) {
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), bezelMat);
    bar.position.set(bx, by, 0.001);
    tvSet.add(bar);
  }
  const glowBar = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.03),
    new THREE.MeshBasicMaterial({
      color: 0x5af2ff, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  glowBar.position.set(0, -0.99, 0.001);
  tvSet.add(glowBar);
  tvSet.position.copy(holoScreen.position);
  tvSet.rotation.copy(holoScreen.rotation);
  tvSet.visible = false;
  group.add(tvSet);

  let castTex: THREE.VideoTexture | null = null;
  let castingNow = false;
  const screenMat = holoScreen.material as THREE.MeshBasicMaterial;
  const cast = (video: HTMLVideoElement) => {
    castTex?.dispose();
    castTex = new THREE.VideoTexture(video);
    castTex.colorSpace = THREE.SRGBColorSpace;
    screenMat.map = castTex;
    screenMat.blending = THREE.NormalBlending;   // solid panel: a real TV image
    screenMat.opacity = 1;
    screenMat.needsUpdate = true;
    castingNow = true;
    tvChannel = 0;                                // channels yield to the cast
    holoScreen.visible = true;
    tvSet.visible = true;
    tvScaleTarget = 1;
    (tvLed.material as THREE.MeshStandardMaterial).emissive.setHex(0x5af2ff);
  };
  const stopCast = () => {
    if (!castingNow) return;
    castingNow = false;
    castTex?.dispose();
    castTex = null;
    screenMat.map = tvTex;
    screenMat.blending = THREE.AdditiveBlending;  // back to hologram channels
    screenMat.needsUpdate = true;
    tvSet.visible = false;
    tvScaleTarget = 0;
    (tvLed.material as THREE.MeshStandardMaterial).emissive.setHex(0xff3344);
  };
  let tvScaleTarget = 0;
  let tvTimer = 0;
  const drawTV = () => {
    if (tvChannel === 0) { tvG.fillStyle = '#000'; tvG.fillRect(0, 0, 192, 108); }
    else if (tvChannel === 1) {
      const d = tvG.createImageData(192, 108);
      for (let i = 0; i < d.data.length; i += 4) {
        const v = Math.random() * 255;
        d.data[i] = v; d.data[i + 1] = v; d.data[i + 2] = v; d.data[i + 3] = 255;
      }
      tvG.putImageData(d, 0, 0);
    } else if (tvChannel === 2) {
      tvG.fillStyle = '#0a0614'; tvG.fillRect(0, 0, 192, 108);
      tvG.fillStyle = ['#ff2bdb', '#5af2ff', '#ffe14d'][Math.floor(Date.now() / 900) % 3];
      tvG.font = 'bold 26px sans-serif'; tvG.textAlign = 'center';
      tvG.fillText(['買!', 'NEON', '雨夜'][Math.floor(Date.now() / 900) % 3], 96, 62);
    } else {
      tvG.fillStyle = '#060a14'; tvG.fillRect(0, 0, 192, 108);
      tvG.fillStyle = '#5af2ff';
      for (let i = 0; i < 24; i++) {
        const h = 10 + ((i * 37 + Math.floor(Date.now() / 500)) % 50);
        tvG.fillRect(4 + i * 8, 108 - h, 5, h);
      }
    }
    // projection scanlines baked into the feed
    tvG.fillStyle = 'rgba(0,0,0,.25)';
    for (let y = 0; y < 108; y += 3) tvG.fillRect(0, y, 192, 1);
    tvTex.needsUpdate = true;
  };
  updaters.push((t, dt) => {
    tvTimer += dt;
    if (tvChannel !== 0 && tvTimer > 0.18) { tvTimer = 0; drawTV(); }
    // materialize / collapse + holo flicker
    const target = tvScaleTarget;
    holoScreen.scale.y += (target - holoScreen.scale.y) * Math.min(dt * 7, 1);
    if (holoScreen.scale.y < 0.01 && target === 0) holoScreen.visible = false;
    tvSet.scale.y = Math.max(holoScreen.scale.y, 0.001);
    tvSet.visible = castingNow && holoScreen.scale.y > 0.05;
    if (holoScreen.visible && !castingNow) {
      (holoScreen.material as THREE.MeshBasicMaterial).opacity =
        0.85 + 0.12 * Math.sin(t * 19) + 0.03 * Math.sin(t * 5.1);
    } else if (castingNow) {
      (holoScreen.material as THREE.MeshBasicMaterial).opacity = 1;
    }
  });
  const cycleChannel = () => {
    if (castingNow) return '點播中';
    tvChannel = (tvChannel + 1) % 4;
    if (tvChannel === 0) {
      tvScaleTarget = 0;
      (tvLed.material as THREE.MeshStandardMaterial).emissive.setHex(0xff3344);
    } else {
      holoScreen.visible = true;
      tvScaleTarget = 1;
      (tvLed.material as THREE.MeshStandardMaterial).emissive.setHex(0x39ff88);
    }
    drawTV();
    return tvNames[tvChannel];
  };

  // ---------- record player on a sideboard (back wall of living area) ----------
  const sideboard = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.55, 0.5), matBody);
  sideboard.position.set(-2.6, 0.275, 6.5);
  group.add(sideboard);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.44), matDark);
  deck.position.set(-2.6, 0.59, 6.5);
  deck.name = 'RecordPlayer';
  group.add(deck);
  const vinyl = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.17, 0.012, 24),
    new THREE.MeshStandardMaterial({ color: 0x0a0a10, roughness: 0.35, metalness: 0.3 }),
  );
  vinyl.position.set(-2.65, 0.64, 6.5);
  group.add(vinyl);
  let vinylSpinning = false;
  updaters.push((_t, dt) => { if (vinylSpinning) vinyl.rotation.y += dt * 3.5; });

  // ---------- color-cycling neon wall sign (above sofa, back wall) ----------
  let neonIdx = 0;
  const signTex = makeNeonSignTexture('夜貓');
  const neonSign = new THREE.Mesh(
    new THREE.PlaneGeometry(1.8, 0.7),
    new THREE.MeshStandardMaterial({
      color: 0x05060a, emissive: NEON_COLORS[0][0], emissiveIntensity: 1.6,
      emissiveMap: signTex, transparent: true,
    }),
  );
  neonSign.position.set(0.4, 2.6, 6.86);
  neonSign.rotation.y = Math.PI;
  neonSign.name = 'NeonSign';
  group.add(neonSign);
  const signLight = new THREE.PointLight(NEON_COLORS[0][0], 14, 7, 1.8);
  signLight.position.set(0.4, 2.5, 6.3);
  group.add(signLight);
  const cycleNeon = () => {
    neonIdx = (neonIdx + 1) % NEON_COLORS.length;
    const [hex, name] = NEON_COLORS[neonIdx];
    (neonSign.material as THREE.MeshStandardMaterial).emissive.setHex(hex);
    signLight.color.setHex(hex);
    return name;
  };

  // ---------- bar dressing: bottles + glass on the island ----------
  const bottleColors = [0xff2bdb, 0x5af2ff, 0xffe14d, 0x39ff88];
  bottleColors.forEach((bc, i) => {
    const bottle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.05, 0.28, 10),
      new THREE.MeshPhysicalMaterial({
        color: 0x0a0c14, transparent: true, opacity: 0.85, roughness: 0.1,
        emissive: bc, emissiveIntensity: 0.35,
      }),
    );
    bottle.position.set(-2.75 + i * 0.18, 1.09, -4.75);
    group.add(bottle);
  });
  const glass = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.035, 0.11, 10),
    new THREE.MeshPhysicalMaterial({
      color: 0x90e8ff, transparent: true, opacity: 0.4, roughness: 0.05,
    }),
  );
  glass.position.set(-2.0, 1.01, -4.5);
  glass.visible = false;
  group.add(glass);
  const barLight = new THREE.PointLight(0xff2bdb, 0, 4, 2);
  barLight.position.set(-2.2, 1.6, -4.6);
  group.add(barLight);
  let barPulse = 0;
  updaters.push((_t, dt) => {
    if (barPulse > 0) {
      barPulse -= dt;
      barLight.intensity = Math.max(0, barPulse * 18);
      if (barPulse <= 0) barLight.intensity = 0;
    }
  });
  const pulse = () => { barPulse = 1.2; glass.visible = !glass.visible; };

  // ---------- desk clutter ----------
  const mug = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.045, 0.1, 10),
    new THREE.MeshLambertMaterial({ color: 0xc2306a }),
  );
  mug.position.set(4.4, 0.85, 2.7);
  group.add(mug);
  for (let i = 0; i < 3; i++) {
    const paper = new THREE.Mesh(
      new THREE.PlaneGeometry(0.21, 0.29),
      new THREE.MeshLambertMaterial({ color: 0x8a90a8 }),
    );
    paper.rotation.x = -Math.PI / 2;
    paper.rotation.z = (Math.random() - 0.5) * 0.8;
    paper.position.set(4.5 + Math.random() * 0.3, 0.802 + i * 0.002, 3.0 + Math.random() * 0.2);
    group.add(paper);
  }

  // ---------- motorized roller blind over the big window ----------
  const curtainTex = (() => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#10131e'; g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 4) {
      g.fillStyle = (y / 4) % 2 ? 'rgba(255,255,255,.03)' : 'rgba(0,0,0,.06)';
      g.fillRect(0, y, 256, 2);
    }
    // faint vertical seams every "panel"
    g.fillStyle = 'rgba(0,0,0,.35)';
    for (let x = 0; x < 256; x += 64) g.fillRect(x, 0, 2, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 3);
    return tex;
  })();
  const CURT_TOP = 5.7, CURT_BOTTOM = 0.4, CURT_Z = 6.84;
  const curtainGeo = new THREE.PlaneGeometry(11.9, CURT_TOP - CURT_BOTTOM);
  curtainGeo.translate(0, -(CURT_TOP - CURT_BOTTOM) / 2, 0); // pivot at top edge
  const curtainMesh = new THREE.Mesh(
    curtainGeo,
    new THREE.MeshLambertMaterial({ color: 0x9aa2bb, map: curtainTex, side: THREE.DoubleSide }),
  );
  curtainMesh.position.set(0, CURT_TOP, CURT_Z);
  curtainMesh.rotation.y = Math.PI;
  curtainMesh.scale.y = 0.015;
  group.add(curtainMesh);
  const curtainBar = new THREE.Mesh(
    new THREE.BoxGeometry(12, 0.07, 0.07),
    new THREE.MeshStandardMaterial({
      color: 0x1c2233, metalness: 0.8, roughness: 0.3,
      emissive: 0x5af2ff, emissiveIntensity: 0.6,
    }),
  );
  curtainBar.position.set(0, CURT_TOP, CURT_Z);
  group.add(curtainBar);
  let curtainTarget = 0;   // 0 open … 1 closed
  let curtainAmount = 0;
  updaters.push((_t, dt) => {
    const speed = dt / 3.2; // full travel ≈ 3.2s
    if (curtainAmount < curtainTarget) curtainAmount = Math.min(curtainTarget, curtainAmount + speed);
    else if (curtainAmount > curtainTarget) curtainAmount = Math.max(curtainTarget, curtainAmount - speed);
    curtainMesh.scale.y = Math.max(curtainAmount, 0.015);
    curtainBar.position.y = CURT_TOP - (CURT_TOP - CURT_BOTTOM) * curtainAmount;
  });
  // wall control panel beside the window
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.24, 0.04),
    new THREE.MeshStandardMaterial({
      color: 0x0a0c14, emissive: 0x5af2ff, emissiveIntensity: 1.2,
      emissiveMap: (() => {
        const c = document.createElement('canvas');
        c.width = 64; c.height = 96;
        const g = c.getContext('2d')!;
        g.fillStyle = '#000'; g.fillRect(0, 0, 64, 96);
        g.fillStyle = '#fff';
        g.fillRect(20, 14, 24, 6);
        g.beginPath(); g.moveTo(32, 40); g.lineTo(22, 56); g.lineTo(42, 56); g.fill();
        g.beginPath(); g.moveTo(32, 86); g.lineTo(22, 70); g.lineTo(42, 70); g.fill();
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
      })(),
    }),
  );
  panel.position.set(5.78, 1.5, 6.82);
  panel.name = 'CurtainPanel';
  group.add(panel);

  // light mood switch, mounted next to the curtain panel
  const lightPanel = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.24, 0.04),
    new THREE.MeshStandardMaterial({
      color: 0x0a0c14, emissive: 0xffd9b0, emissiveIntensity: 1.1,
      emissiveMap: (() => {
        const c = document.createElement('canvas');
        c.width = 64; c.height = 96;
        const g = c.getContext('2d')!;
        g.fillStyle = '#000'; g.fillRect(0, 0, 64, 96);
        g.strokeStyle = '#fff'; g.lineWidth = 4;
        g.beginPath(); g.arc(32, 40, 14, 0, 7); g.stroke();   // bulb
        g.fillStyle = '#fff';
        g.fillRect(26, 58, 12, 8);                             // bulb base
        for (let a = 0; a < 6; a++) {                          // rays
          const rad = (a / 6) * Math.PI * 2;
          g.fillRect(32 + Math.cos(rad) * 22 - 1.5, 40 + Math.sin(rad) * 22 - 1.5, 3, 3);
        }
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
      })(),
    }),
  );
  lightPanel.position.set(5.78, 1.5, 6.5);
  lightPanel.name = 'LightPanel';
  group.add(lightPanel);

  // ---------- holographic projection TV (above the coffee table) ----------
  const HOLO_X = 0.2, HOLO_Z = 3.6, HOLO_BASE_Y = 0.375, HOLO_Y = 1.25;
  const holoBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.18, 0.07, 18),
    new THREE.MeshStandardMaterial({ color: 0x0c0f18, metalness: 0.8, roughness: 0.3 }),
  );
  holoBase.position.set(HOLO_X, HOLO_BASE_Y, HOLO_Z);
  holoBase.name = 'HoloProjector';
  group.add(holoBase);
  const holoRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.13, 0.012, 8, 24),
    new THREE.MeshStandardMaterial({ color: 0x05060a, emissive: 0x5af2ff, emissiveIntensity: 2 }),
  );
  holoRing.rotation.x = Math.PI / 2;
  holoRing.position.set(HOLO_X, HOLO_BASE_Y + 0.04, HOLO_Z);
  group.add(holoRing);
  // projection cone
  const holoCone = new THREE.Mesh(
    new THREE.ConeGeometry(0.42, HOLO_Y - HOLO_BASE_Y, 20, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x5af2ff, transparent: true, opacity: 0.06,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  holoCone.rotation.x = Math.PI;
  holoCone.position.set(HOLO_X, (HOLO_BASE_Y + HOLO_Y) / 2 + 0.04, HOLO_Z);
  group.add(holoCone);
  const holoLight = new THREE.PointLight(0x5af2ff, 0, 4, 2);
  holoLight.position.set(HOLO_X, HOLO_Y, HOLO_Z);
  group.add(holoLight);

  const holoMat = (hex: number, wire = true) => new THREE.MeshBasicMaterial({
    color: hex, wireframe: wire, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  // channel 1: wireframe globe + equator ring
  const chGlobe = new THREE.Group();
  chGlobe.add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), holoMat(0x5af2ff)));
  const eq = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.006, 6, 40), holoMat(0xff2bdb, false));
  eq.rotation.x = Math.PI / 2.4;
  chGlobe.add(eq);
  // channel 2: miniature city block
  const chCity = new THREE.Group();
  for (let i = 0; i < 30; i++) {
    const bw = 0.05 + Math.random() * 0.05;
    const bh = 0.1 + Math.random() * 0.4;
    const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bw), holoMat(0xff2bdb));
    b.position.set((Math.random() - 0.5) * 0.6, bh / 2 - 0.28, (Math.random() - 0.5) * 0.6);
    chCity.add(b);
  }
  // channel 3: gem + orbiting sparks
  const chGem = new THREE.Group();
  chGem.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), holoMat(0x39ff88)));
  const sparks: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const s = new THREE.Mesh(new THREE.TetrahedronGeometry(0.025, 0), holoMat(0xffe14d, false));
    chGem.add(s);
    sparks.push(s);
  }
  const holoChannels: Array<[string, THREE.Group | null]> = [
    ['OFF', null], ['地球儀', chGlobe], ['微縮城市', chCity], ['核心水晶', chGem],
  ];
  for (const [, g] of holoChannels) {
    if (g) { g.position.set(HOLO_X, HOLO_Y, HOLO_Z); g.visible = false; group.add(g); }
  }
  let holoIdx = 0;
  const holoCycle = (): string => {
    holoIdx = (holoIdx + 1) % holoChannels.length;
    holoChannels.forEach(([, g], i) => { if (g) g.visible = i === holoIdx; });
    const on = holoIdx !== 0;
    holoCone.visible = on;
    holoLight.intensity = on ? 6 : 0;
    (holoRing.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 3 : 0.6;
    return holoChannels[holoIdx][0];
  };
  holoCone.visible = false;
  updaters.push((t, _dt) => {
    if (holoIdx === 0) return;
    const g = holoChannels[holoIdx][1]!;
    g.rotation.y = t * 0.6;
    // holographic instability: flicker + slight vertical bob
    const flick = 0.5 + 0.12 * Math.sin(t * 23) + 0.05 * Math.sin(t * 61);
    g.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      if (m && 'opacity' in m) m.opacity = flick;
    });
    g.position.y = HOLO_Y + Math.sin(t * 1.7) * 0.02;
    sparks.forEach((s, i) => {
      const a = t * 1.4 + (i / sparks.length) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.4, Math.sin(t * 2 + i) * 0.12, Math.sin(a) * 0.4);
    });
  });

  // ---------- 夜貓 the cat (the neon sign finally makes sense) ----------
  const cat = new THREE.Group();
  const matFur = new THREE.MeshLambertMaterial({ color: 0x232330 }); // dark grey-blue, reads on a dark sofa
  const catBody = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), matFur);
  catBody.scale.set(1.35, 0.72, 0.9);
  catBody.position.y = 0.115;
  catBody.name = 'Cat';
  cat.add(catBody);
  // head group so the cat can track the player with ears attached
  const headGrp = new THREE.Group();
  headGrp.position.set(0.17, 0.19, 0.03);
  const catHead = new THREE.Mesh(new THREE.SphereGeometry(0.095, 12, 9), matFur);
  headGrp.add(catHead);
  const ears: THREE.Mesh[] = [];
  for (const ez of [-0.075, 0.045]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.034, 0.065, 6), matFur);
    ear.position.set(0, 0.085, ez + 0.03);
    headGrp.add(ear);
    ears.push(ear);
  }
  // sleepy eyes: two thin glowing slits that open when alert
  const eyes: THREE.Mesh[] = [];
  for (const ez of [-0.04, 0.04]) {
    const eye = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.006, 0.022),
      new THREE.MeshBasicMaterial({ color: 0x39ff88 }),
    );
    eye.position.set(0.085, 0.015, ez);
    headGrp.add(eye);
    eyes.push(eye);
  }
  cat.add(headGrp);
  const tail = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.024, 6, 12, Math.PI * 1.1), matFur);
  tail.rotation.x = -Math.PI / 2;
  tail.position.set(-0.1, 0.05, -0.02);
  cat.add(tail);
  const collar = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 0.02, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x05060a, emissive: 0x5af2ff, emissiveIntensity: 2 }),
  );
  collar.position.set(0.24, 0.16, 0.03);
  cat.add(collar);
  const CAT_SPOTS: Array<[number, number, number]> = [
    [1.5, 0.43, 2.05],    // sofa cushion
    [-3.3, 3.64, -5.3],   // foot of the bed (mezzanine)
    [1.0, 0.02, 4.2],     // rug, soaking in the city glow
  ];
  let catSpot = 0;
  cat.position.set(...CAT_SPOTS[0]);
  cat.rotation.y = 0.7;
  group.add(cat);
  let petTimer = 0;
  let relocateTimer = 140;
  let alert = 0;             // 0 asleep … 1 fully watching you
  let twitchTimer = 6;
  let twitchT = 0;
  let stretchT = 0;
  const lookTarget = new THREE.Vector3();
  updaters.push((t, dt) => {
    catBody.scale.y = 0.72 + 0.02 * Math.sin(t * 1.6);            // breathing
    // --- presence detection: wake up and watch the player ---
    const dist = ctx.camera.position.distanceTo(cat.position);
    const wantAlert = dist < 2.8 ? 1 : 0;
    const prevAlert = alert;
    alert += (wantAlert - alert) * Math.min(dt * 2.5, 1);
    if (prevAlert < 0.1 && wantAlert === 1) stretchT = 0.9;        // waking stretch
    // head lifts and turns toward the player
    headGrp.position.y = 0.19 + 0.09 * alert;
    if (alert > 0.05) {
      lookTarget.copy(ctx.camera.position);
      cat.worldToLocal(lookTarget);
      const yaw = Math.atan2(lookTarget.z - headGrp.position.z, lookTarget.x - headGrp.position.x);
      headGrp.rotation.y += ((-yaw) - headGrp.rotation.y) * Math.min(dt * 4, 1) * alert;
    } else {
      headGrp.rotation.y *= 1 - Math.min(dt * 2, 1);
    }
    // eyes: closed slits asleep, open ovals when watching
    for (const eye of eyes) eye.scale.y = 1 + 4.5 * alert;
    if (stretchT > 0) {
      stretchT -= dt;
      const k = Math.sin((0.9 - stretchT) / 0.9 * Math.PI);
      catBody.scale.x = 1.35 + 0.16 * k;
    } else {
      catBody.scale.x = 1.35;
    }
    // idle twitches while sleeping: an ear flick or a lazy tail swipe
    twitchTimer -= dt;
    if (twitchTimer <= 0) {
      twitchTimer = 5 + Math.random() * 7;
      twitchT = 0.5;
    }
    if (twitchT > 0) {
      twitchT -= dt;
      ears[0].rotation.x = Math.sin(t * 30) * 0.25 * (twitchT / 0.5);
      if (alert < 0.3) tail.rotation.z = Math.sin(t * 5) * 0.18 * (twitchT / 0.5);
    }
    if (petTimer > 0) {
      petTimer -= dt;
      tail.rotation.z = Math.sin(t * 9) * 0.5;                     // happy tail
    }
    relocateTimer -= dt;
    if (relocateTimer <= 0) {
      relocateTimer = 130 + Math.random() * 160;
      // cats only teleport when nobody is watching
      if (dist > 6) {
        catSpot = (catSpot + 1) % CAT_SPOTS.length;
        cat.position.set(...CAT_SPOTS[catSpot]);
        cat.rotation.y = Math.random() * Math.PI * 2;
      }
    }
  });

  // ---------- coffee machine (kitchen counter) ----------
  const coffeeMachine = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.36, 0.24), matSteel);
  coffeeMachine.position.set(-3.7, 1.19, -6.55);
  coffeeMachine.name = 'CoffeeMachine';
  group.add(coffeeMachine);
  const spoutLight = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.02, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x05060a, emissive: 0xff8a3d, emissiveIntensity: 1.2 }),
  );
  spoutLight.position.set(-3.7, 1.06, -6.44);
  group.add(spoutLight);
  const coffeeMug = new THREE.Mesh(
    new THREE.CylinderGeometry(0.038, 0.034, 0.085, 10),
    new THREE.MeshLambertMaterial({ color: 0xd8dce8 }),
  );
  coffeeMug.position.set(-3.7, 1.05, -6.42);
  coffeeMug.visible = false;
  group.add(coffeeMug);
  const coffeeSteam: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const puff = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.022 + i * 0.008, 0),
      new THREE.MeshBasicMaterial({
        color: 0xcfe2ff, transparent: true, opacity: 0.18,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    puff.position.set(-3.7, 1.12 + i * 0.05, -6.42);
    puff.visible = false;
    group.add(puff);
    coffeeSteam.push(puff);
  }
  let brewT = 0;       // >0 while brewing
  let mugSteamT = 0;   // fresh-coffee steam window
  const brew = (): boolean => {
    if (brewT > 0) return false;
    brewT = 7;
    coffeeMug.visible = true;
    return true;
  };
  updaters.push((t, dt) => {
    if (brewT > 0) {
      brewT -= dt;
      if (brewT <= 0) mugSteamT = 60;
    }
    const steaming = brewT > 0 || mugSteamT > 0;
    if (mugSteamT > 0) mugSteamT -= dt;
    coffeeSteam.forEach((p, i) => {
      p.visible = steaming;
      if (steaming) {
        p.position.y = 1.1 + ((t * 0.22 + i * 0.18) % 0.55);
        (p.material as THREE.MeshBasicMaterial).opacity =
          0.2 * (1 - ((p.position.y - 1.1) / 0.55));
      }
    });
  });

  // ---------- ambient furniture (visual only) ----------
  // floor lamp by the sofa
  box(0.26, 0.02, 0.26, matDark, -1.7, 0.01, 3.9);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 8), matBody);
  pole.position.set(-1.7, 0.76, 3.9);
  group.add(pole);
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.18, 0.24, 12, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x1a1f30, side: THREE.DoubleSide,
      emissive: 0xffd9b0, emissiveIntensity: 0.35,
    }),
  );
  shade.position.set(-1.7, 1.56, 3.9);
  group.add(shade);
  // desk lamp
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 6), matDark);
  arm.rotation.z = 0.6;
  arm.position.set(5.35, 1.0, 3.05);
  group.add(arm);
  const lampHead = new THREE.Mesh(
    new THREE.ConeGeometry(0.05, 0.09, 8, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x10141f, side: THREE.DoubleSide,
      emissive: 0x5af2ff, emissiveIntensity: 0.9,
    }),
  );
  lampHead.rotation.z = -0.8;
  lampHead.position.set(5.23, 1.16, 3.05);
  group.add(lampHead);
  // AC unit high on the right wall
  const ac = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.4, 0.95),
    new THREE.MeshLambertMaterial({ color: 0x6a7488 }));
  ac.position.set(5.74, 3.6, -2.6);
  group.add(ac);
  for (let i = 0; i < 4; i++) {
    box(0.02, 0.3, 0.02, matDark, 5.6, 3.6, -2.95 + i * 0.23);
  }
  const acLed = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.02, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x05060a, emissive: 0x39ff88, emissiveIntensity: 2 }),
  );
  acLed.position.set(5.6, 3.44, -2.3);
  group.add(acLed);
  // lived-in clutter: delivery boxes by the door, noodle cup on the coffee table
  box(0.4, 0.3, 0.36, new THREE.MeshLambertMaterial({ color: 0x7a6248 }), -5.2, 0.15, 2.7);
  const box2 = box(0.3, 0.24, 0.3, new THREE.MeshLambertMaterial({ color: 0x6a5a44 }), -5.16, 0.42, 2.66);
  box2.rotation.y = 0.4;
  const noodle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.035, 0.09, 10),
    new THREE.MeshLambertMaterial({ color: 0xc8444a }),
  );
  noodle.position.set(0.65, 0.39, 3.45);
  group.add(noodle);

  // ---------- living wall art: warm hearth + ukiyo wave + master paintings ----------
  // digital fireplace inset below the TV — the warmest pixel in the apartment
  {
    const c = document.createElement('canvas');
    c.width = 96; c.height = 56;
    const g = c.getContext('2d')!;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    const frame = box(0.08, 0.72, 1.5, matDark, -5.83, 0.85, 2.2);
    void frame;
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(1.36, 0.6),
      new THREE.MeshStandardMaterial({ emissive: 0xffffff, emissiveMap: tex, color: 0x05060a, emissiveIntensity: 1.0 }),
    );
    screen.rotation.y = Math.PI / 2;
    screen.position.set(-5.785, 0.85, 2.2);
    group.add(screen);
    const heat = new Array(96).fill(0);
    let fireTimer = 0;
    updaters.push((_t, dt) => {
      fireTimer += dt;
      if (fireTimer < 0.11) return;
      fireTimer = 0;
      g.fillStyle = 'rgb(8,4,8)';
      g.fillRect(0, 0, 96, 56);
      for (let x = 0; x < 96; x++) {
        heat[x] = Math.max(0,
          heat[x] * 0.82 + (Math.random() - 0.42) * 16 + 12 * Math.exp(-((x - 48) ** 2) / 700));
        const h = Math.min(46, heat[x]);
        const grad = g.createLinearGradient(0, 56, 0, 56 - h);
        grad.addColorStop(0, '#ffdf8a');
        grad.addColorStop(0.35, '#ff9a3d');
        grad.addColorStop(0.8, '#b8331e');
        grad.addColorStop(1, 'rgba(60,10,20,0)');
        g.fillStyle = grad;
        g.fillRect(x, 56 - h, 1, h);
      }
      tex.needsUpdate = true;
    });
  }


  // ---------- rotating museum frames (Met open access) on every art wall ----------
  // [x, y, z, ry, w, h] — replaces the old text posters & the single frames
  const ART_SPOTS: Array<[number, number, number, number, number, number]> = [
    [-5.84, 2.95, 0.0, Math.PI / 2, 0.95, 1.2],     // above the stairs
    [5.805, 3.55, 0.2, -Math.PI / 2, 1.7, 0.95],    // above the bookshelf
    [-5.84, 2.2, -3.5, Math.PI / 2, 0.85, 1.1],     // left wall (kitchen side)
    [5.84, 1.9, -3.0, -Math.PI / 2, 0.85, 1.1],     // right wall (by the frost glass)
    [2.5, 4.55, -6.84, 0, 1.0, 1.25],               // mezzanine back wall A
    [-1.5, 4.4, -6.84, 0, 1.0, 1.25],               // mezzanine back wall B
  ];
  const ART_QUERIES = ['hokusai', 'hiroshige', 'van gogh', 'monet', 'vermeer',
    'rembrandt', 'turner', 'degas', 'cezanne', 'sargent'];
  const artMats: THREE.MeshStandardMaterial[] = [];
  const artLoader = new THREE.TextureLoader();
  artLoader.setCrossOrigin('anonymous');
  const artIdCache = new Map<string, number[]>();
  const artAssign = async (mat: THREE.MeshStandardMaterial, tries = 0): Promise<void> => {
    if (tries > 5) return;
    try {
      const q = ART_QUERIES[Math.floor(Math.random() * ART_QUERIES.length)];
      let ids = artIdCache.get(q);
      if (!ids) {
        const r = await (await fetch(
          'https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&q=' +
          encodeURIComponent(q))).json();
        ids = ((r.objectIDs ?? []) as number[]).slice(0, 80);
        artIdCache.set(q, ids);
      }
      if (!ids.length) return artAssign(mat, tries + 1);
      const id = ids[Math.floor(Math.random() * ids.length)];
      const a = await (await fetch(
        `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`)).json();
      if (!a?.isPublicDomain || !a?.primaryImageSmall) return artAssign(mat, tries + 1);
      artLoader.load(a.primaryImageSmall, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        mat.emissiveMap = tex;
        mat.needsUpdate = true;
      }, undefined, () => { /* keep the previous painting */ });
    } catch { /* offline: frames keep whatever hangs there */ }
  };
  ART_SPOTS.forEach(([x, y, z, ry, w, h]) => {
    const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, h + 0.1, 0.05), matDark);
    back.position.set(x - Math.sin(ry) * 0.035, y, z - Math.cos(ry) * 0.035);
    back.rotation.y = ry;
    group.add(back);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x10131c, emissive: 0xffffff, emissiveIntensity: 0.55,
    });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    screen.position.set(x, y, z);
    screen.rotation.y = ry;
    screen.name = 'ArtFrame';
    group.add(screen);
    artMats.push(mat);
    artFrameMeshes.push(screen);
  });
  artMats.forEach((m, i) => window.setTimeout(() => artAssign(m), 1500 + i * 2500));
  let artTimer = 120;
  updaters.push((_t, dt) => {
    artTimer -= dt;
    if (artTimer <= 0) {
      artTimer = 120;
      const m = artMats[Math.floor(Math.random() * artMats.length)];
      artAssign(m);
    }
  });
  const artNext = (): void => { artMats.forEach((m) => artAssign(m)); };

  // ---------- 虹 // IRIS — holographic home assistant by the window ----------
  const irisBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.21, 0.06, 18),
    new THREE.MeshStandardMaterial({ color: 0x0c0f18, metalness: 0.8, roughness: 0.3 }),
  );
  irisBase.position.set(3.0, 0.03, 6.1);
  irisBase.name = 'IrisBase';
  group.add(irisBase);
  const irisRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.16, 0.014, 8, 26),
    new THREE.MeshStandardMaterial({ color: 0x05060a, emissive: 0x9a6bff, emissiveIntensity: 2.4 }),
  );
  irisRing.rotation.x = Math.PI / 2;
  irisRing.position.set(3.0, 0.07, 6.1);
  group.add(irisRing);
  const irisCone = new THREE.Mesh(
    new THREE.ConeGeometry(0.34, 1.55, 18, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x9a6bff, transparent: true, opacity: 0.05,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  irisCone.rotation.x = Math.PI;
  irisCone.position.set(3.0, 0.85, 6.1);
  group.add(irisCone);
  const irisFigure = new THREE.Group();
  const holoBody = (geo: THREE.BufferGeometry) => new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    color: 0xb09aff, transparent: true, opacity: 0.34,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  const irisTorso = holoBody(new THREE.CapsuleGeometry(0.115, 0.42, 4, 12));
  irisTorso.position.y = 0.62;
  irisFigure.add(irisTorso);
  const irisHead = holoBody(new THREE.SphereGeometry(0.075, 12, 10));
  irisHead.position.y = 1.02;
  irisFigure.add(irisHead);
  const irisVisor = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.02, 0.03),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
  );
  irisVisor.position.set(0, 1.03, -0.062);
  irisFigure.add(irisVisor);
  for (const s of [-0.17, 0.17]) {
    const arm = holoBody(new THREE.CapsuleGeometry(0.035, 0.32, 4, 8));
    arm.position.set(s, 0.62, 0);
    arm.rotation.z = s > 0 ? -0.12 : 0.12;
    irisFigure.add(arm);
  }
  const irisSkirt = holoBody(new THREE.ConeGeometry(0.16, 0.35, 14, 1, true));
  irisSkirt.position.y = 0.28;
  irisFigure.add(irisSkirt);
  irisFigure.position.set(3.0, 0.32, 6.1);
  irisFigure.scale.setScalar(0.95);
  group.add(irisFigure);
  let irisTalk = 0;
  updaters.push((t, dt) => {
    if (irisTalk > 0) irisTalk -= dt;
    const flick = 0.8 + 0.12 * Math.sin(t * 23) + 0.08 * Math.sin(t * 7.7)
                + (irisTalk > 0 ? 0.25 * Math.sin(t * 40) : 0);
    irisFigure.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
      if (m && m.transparent) m.opacity = (o === irisVisor ? 0.9 : 0.34) * flick;
    });
    irisFigure.position.y = 0.32 + Math.sin(t * 1.1) * 0.03;
    // face the player when nearby; otherwise drift in a slow idle spin
    const d = ctx.camera.position.distanceTo(irisFigure.position);
    if (d < 4.5) {
      const target = Math.atan2(
        ctx.camera.position.x - irisFigure.position.x,
        ctx.camera.position.z - irisFigure.position.z,
      ) + Math.PI;
      let delta = target - irisFigure.rotation.y;
      delta = ((delta + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      irisFigure.rotation.y += delta * Math.min(dt * 3, 1);
    } else {
      irisFigure.rotation.y += dt * 0.25;
    }
    (irisRing.material as THREE.MeshStandardMaterial).emissiveIntensity =
      2.0 + (irisTalk > 0 ? 1.6 * Math.abs(Math.sin(t * 14)) : 0.4 * Math.sin(t * 2));
  });


  ctx.scene.add(group);
  return {
    group,
    speakerPositions,
    speakers: speakerBodies,
    tv: {
      mesh: tv, screen: holoScreen, cycleChannel,
      cast, stopCast, isCasting: () => castingNow,
    },
    neonSign: { mesh: neonSign, light: signLight, cycle: cycleNeon },
    bar: { pulse, glass },
    recordPlayer: {
      mesh: deck,
      setSpin: (on: boolean) => { vinylSpinning = on; },
    },
    curtain: {
      panel,
      toggle: () => { curtainTarget = curtainTarget > 0.5 ? 0 : 1; return curtainTarget > 0.5; },
      amount: () => curtainAmount,
    },
    holo: { base: holoBase, cycle: holoCycle },
    lightPanel,
    cat: {
      body: catBody,
      pet: () => { petTimer = 4; },
    },
    coffee: { machine: coffeeMachine, brew },
    art: { frames: artFrameMeshes, next: artNext },
    assistant: {
      base: irisBase,
      figure: irisFigure,
      setTalk: (sec) => { irisTalk = sec; },
    },
    update: (t, dt) => { for (const f of updaters) f(t, dt); },
  };

  function makeNeonSignTexture(text: string): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 200;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, 512, 200);
    g.strokeStyle = '#ffffff'; g.lineWidth = 4;
    g.shadowColor = '#ffffff'; g.shadowBlur = 18;
    g.font = 'bold 110px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.strokeText(text, 256, 95);
    g.strokeStyle = '#ffffff'; g.lineWidth = 2;
    g.strokeRect(30, 14, 452, 172);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

}
