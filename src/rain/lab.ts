import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createRainSystem, type RainSystem } from './system';
import { createMist, type MistSystem } from './mist';
import { RainBed } from './audio';

/** Dedicated rain-scene (not the loft). Loft: ?room=1 */
export function wantRainLab(): boolean {
  const q = new URLSearchParams(location.search);
  if (q.get('room') === '1') return false;
  if (q.get('lab') === '0' || q.get('lab') === 'off') return false;
  return true;
}

const FOG_COLOR = new THREE.Color(0x0a121c);
const FOG_DENSITY = { thin: 0.022, mid: 0.048, thick: 0.082 };

export async function bootRainLab(): Promise<void> {
  document.title = '落地窗 · 雨';
  document.body.classList.add('rainlab');
  const bootEl = document.getElementById('boot');
  const appEl = document.getElementById('app')!;
  const hud = document.getElementById('hud');
  if (hud) hud.style.display = 'none';
  const joy = document.getElementById('joy');
  if (joy) joy.style.display = 'none';
  const touchhint = document.getElementById('touchhint');
  if (touchhint) touchhint.style.display = 'none';

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none;';
  appEl.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(FOG_COLOR, 1);

  const scene = new THREE.Scene();
  const fog = new THREE.FogExp2(FOG_COLOR.getHex(), FOG_DENSITY.mid);
  scene.fog = fog;
  scene.background = FOG_COLOR.clone();

  const room = { w: 8.4, d: 6.2, h: 3.36 };
  const winZ = room.d / 2;

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.05, 120);
  camera.position.set(0, 1.52, -0.85);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1.48, winZ - 0.2);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.7;
  controls.maxDistance = 5.2;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minPolarAngle = 0.22;
  controls.enablePan = false;
  const keepInside = () => {
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -room.w / 2 + 0.45, room.w / 2 - 0.45);
    camera.position.y = THREE.MathUtils.clamp(camera.position.y, 0.45, room.h - 0.28);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -room.d / 2 + 0.4, winZ - 0.38);
  };
  controls.addEventListener('change', keepInside);

  scene.add(new THREE.HemisphereLight(0x8aa6c0, 0x1a1410, 0.28));
  const fill = new THREE.PointLight(0xc8d4e4, 0.35, 9, 2);
  fill.position.set(0, 2.6, -0.4);
  scene.add(fill);
  const windowKey = new THREE.DirectionalLight(0x9ec4e8, 0.55);
  windowKey.position.set(0, 3.2, 8);
  scene.add(windowKey);

  buildEmptyRoom(scene, room, winZ);
  buildExterior(scene, winZ);

  const current = {
    intensity: 0.8,
    windX: 0.16,
    windZ: 0.04,
    count: 1600,
    fog: FOG_DENSITY.mid,
  };

  function spawnRain(count: number): RainSystem {
    const sys = createRainSystem({
      count,
      yMax: 14,
      yMin: 0.04,
      xSpan: 18,
      z0: winZ + 0.45,
      z1: 38,
      wind: new THREE.Vector2(current.windX, current.windZ),
      color: new THREE.Color(0xc8dcf0),
    });
    sys.setIntensity(current.intensity);
    sys.group.visible = current.intensity > 0.001;
    return sys;
  }

  let rain: RainSystem = spawnRain(current.count);
  scene.add(rain.group);

  const mist: MistSystem = createMist({
    count: 150,
    xSpan: 20,
    z0: winZ + 1.2,
    z1: 36,
    y0: 0.5,
    y1: 7,
  });
  mist.setDensity(0.7);
  scene.add(mist.group);

  const bed = new RainBed();
  const applyWeather = () => {
    rain.setIntensity(current.intensity);
    rain.group.visible = current.intensity > 0.001;
    const n = Math.min(current.intensity, 1.9) / 1.9;
    mist.setDensity(0.35 + 0.7 * n);
    fog.density = THREE.MathUtils.lerp(current.fog * 0.7, current.fog * 1.15, n);
    const haze = FOG_COLOR.clone().lerp(new THREE.Color(0x152030), n * 0.35);
    fog.color.copy(haze);
    scene.background = haze;
    renderer.setClearColor(haze, 1);
    if (bed.ready) bed.setIntensity(current.intensity);
  };
  applyWeather();

  const panel = mountPanel({
    onIntensity: (k) => {
      current.intensity = k;
      applyWeather();
      bed.start();
      bed.setIntensity(k);
      panel.setAudio(true);
    },
    onWind: (x, z) => {
      current.windX = x;
      current.windZ = z;
      rain.setWind(x, z);
    },
    onCount: (n) => {
      scene.remove(rain.group);
      rain.dispose();
      current.count = n;
      rain = spawnRain(n);
      scene.add(rain.group);
    },
    onFog: (d) => {
      current.fog = d;
      applyWeather();
    },
    onRoom: () => {
      const url = new URL(location.href);
      url.searchParams.set('room', '1');
      url.searchParams.delete('lab');
      location.href = url.toString();
    },
  });

  const armAudio = () => {
    bed.start();
    bed.setIntensity(current.intensity);
    panel.setAudio(true);
  };
  canvas.addEventListener('pointerdown', armAudio, { once: false });
  panel.root.addEventListener('pointerdown', armAudio, { once: false });

  const clock = new THREE.Clock();
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  if (bootEl) {
    bootEl.classList.add('gone');
    window.setTimeout(() => bootEl.remove(), 500);
  }

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    rain.update(dt);
    mist.update(dt);
    controls.update();
    keepInside();
    renderer.render(scene, camera);
    panel.tick(current.count);
  });
}

function buildEmptyRoom(scene: THREE.Scene, room: { w: number; d: number; h: number }, winZ: number): void {
  const { w, d, h } = room;
  const wall = new THREE.MeshStandardMaterial({
    color: 0x16181e, roughness: 0.92, metalness: 0.02, fog: false,
  });
  const floor = new THREE.MeshStandardMaterial({
    color: 0x12141a, roughness: 0.22, metalness: 0.45, fog: false,
  });
  const ceil = new THREE.MeshStandardMaterial({
    color: 0x101216, roughness: 0.95, metalness: 0.0, fog: false,
  });
  const frame = new THREE.MeshStandardMaterial({
    color: 0x0a0c10, roughness: 0.35, metalness: 0.55, fog: false,
  });

  const box = (sx: number, sy: number, sz: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    scene.add(m);
    return m;
  };

  box(w, 0.08, d, floor, 0, -0.04, 0);
  box(w, 0.08, d, ceil, 0, h + 0.04, 0);
  box(0.16, h, d, wall, -w / 2, h / 2, 0);
  box(0.16, h, d, wall, w / 2, h / 2, 0);
  box(w, h, 0.16, wall, 0, h / 2, -d / 2);

  const sillH = 0.07;
  const headH = 0.12;
  const jamb = 0.1;
  box(w, sillH, 0.22, frame, 0, sillH / 2, winZ);
  box(w, headH, 0.22, frame, 0, h - headH / 2, winZ);
  box(jamb, h - sillH - headH, 0.22, frame, -w / 2 + jamb / 2, (sillH + h - headH) / 2, winZ);
  box(jamb, h - sillH - headH, 0.22, frame, w / 2 - jamb / 2, (sillH + h - headH) / 2, winZ);

  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(w - jamb * 2 - 0.04, h - sillH - headH - 0.04),
    new THREE.MeshPhysicalMaterial({
      color: 0xb7d0e4,
      transparent: true,
      opacity: 0.07,
      roughness: 0.06,
      metalness: 0.0,
      reflectivity: 0.55,
      fog: false,
      side: THREE.DoubleSide,
    }),
  );
  glass.position.set(0, (sillH + h - headH) / 2, winZ - 0.03);
  glass.renderOrder = 2;
  glass.name = 'LabGlass';
  scene.add(glass);
}

function buildExterior(scene: THREE.Scene, winZ: number): void {
  const wet = new THREE.MeshStandardMaterial({
    color: 0x0b1018, roughness: 0.2, metalness: 0.68, fog: true,
  });
  const street = new THREE.Mesh(new THREE.PlaneGeometry(48, 70), wet);
  street.rotation.x = -Math.PI / 2;
  street.position.set(0, -0.02, winZ + 22);
  scene.add(street);

  const facade = (hex: number) => new THREE.MeshStandardMaterial({
    color: 0x10141c,
    emissive: new THREE.Color(hex),
    emissiveIntensity: 0.38,
    roughness: 0.8,
    metalness: 0.16,
    fog: true,
  });
  const towers = [
    { x: -11, z: 14, w: 4.2, h: 18, d: 4, c: 0xff2bdb },
    { x: -7, z: 22, w: 3.4, h: 12, d: 3.4, c: 0x2b6dff },
    { x: 0.5, z: 28, w: 5.0, h: 22, d: 4.2, c: 0x1ad6c4 },
    { x: 8, z: 18, w: 3.8, h: 15, d: 3.6, c: 0xaa44ff },
    { x: 12, z: 30, w: 4.4, h: 20, d: 4, c: 0xff5a7a },
    { x: -14, z: 32, w: 3.2, h: 10, d: 3, c: 0x2bd4ff },
  ];
  for (const t of towers) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(t.w, t.h, t.d), facade(t.c));
    m.position.set(t.x, t.h / 2, winZ + t.z);
    scene.add(m);
  }

  const lampMat = new THREE.MeshStandardMaterial({ color: 0x1a1e26, roughness: 0.4, metalness: 0.6, fog: true });
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffe6b0, fog: true });
  for (let i = 0; i < 4; i++) {
    const z = winZ + 6 + i * 8;
    const x = i % 2 === 0 ? -5.2 : 5.2;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 3.2, 8), lampMat);
    pole.position.set(x, 1.6, z);
    scene.add(pole);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), bulbMat);
    bulb.position.set(x, 3.2, z);
    scene.add(bulb);
    const light = new THREE.PointLight(0xffd8a0, 1.1, 10, 2);
    light.position.set(x, 3.15, z);
    scene.add(light);
  }
}

function mountPanel(handlers: {
  onIntensity: (k: number) => void;
  onWind: (x: number, z: number) => void;
  onCount: (n: number) => void;
  onFog: (d: number) => void;
  onRoom: () => void;
}) {
  const el = document.createElement('div');
  el.id = 'rainlab-panel';
  el.innerHTML = `
    <div class="rl-title">落地窗</div>
    <div class="rl-sub">空房間 · 窗外雨 · 霧 · 雨聲</div>
    <div class="rl-row" data-row="intensity">
      <span>雨勢</span>
      <button type="button" data-i="0">停</button>
      <button type="button" data-i="0.8" class="on">小</button>
      <button type="button" data-i="1.3">中</button>
      <button type="button" data-i="1.9">大</button>
    </div>
    <div class="rl-row" data-row="fog">
      <span>霧</span>
      <button type="button" data-f="thin">薄</button>
      <button type="button" data-f="mid" class="on">中</button>
      <button type="button" data-f="thick">濃</button>
    </div>
    <div class="rl-row" data-row="wind">
      <span>風</span>
      <button type="button" data-w="0,0">無</button>
      <button type="button" data-w="0.18,0.05" class="on">微</button>
      <button type="button" data-w="0.58,0.14">強</button>
    </div>
    <div class="rl-row" data-row="count">
      <span>顆數</span>
      <button type="button" data-c="600">少</button>
      <button type="button" data-c="1600" class="on">中</button>
      <button type="button" data-c="2800">密</button>
    </div>
    <button class="rl-room" type="button">回 Neon Loft</button>
    <div class="rl-hint">點一下開雨聲 · 拖曳看窗外</div>
    <div class="rl-stat" id="rainlab-stat"></div>
  `;
  document.body.appendChild(el);

  const setOn = (row: string, btn: Element) => {
    el.querySelectorAll(`[data-row="${row}"] button`).forEach((b) => b.classList.remove('on'));
    btn.classList.add('on');
  };

  el.querySelectorAll('[data-i]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setOn('intensity', btn);
      handlers.onIntensity(Number((btn as HTMLElement).dataset.i));
    });
  });
  el.querySelectorAll('[data-f]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setOn('fog', btn);
      const key = (btn as HTMLElement).dataset.f as keyof typeof FOG_DENSITY;
      handlers.onFog(FOG_DENSITY[key]);
    });
  });
  el.querySelectorAll('[data-w]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setOn('wind', btn);
      const [x, z] = String((btn as HTMLElement).dataset.w).split(',').map(Number);
      handlers.onWind(x, z);
    });
  });
  el.querySelectorAll('[data-c]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setOn('count', btn);
      handlers.onCount(Number((btn as HTMLElement).dataset.c));
    });
  });
  el.querySelector('.rl-room')!.addEventListener('click', handlers.onRoom);

  const stat = el.querySelector('#rainlab-stat') as HTMLElement;
  const hint = el.querySelector('.rl-hint') as HTMLElement;
  return {
    root: el,
    setAudio: (on: boolean) => {
      hint.textContent = on ? '雨聲已開 · 拖曳看窗外' : '點一下開雨聲 · 拖曳看窗外';
    },
    tick: (count: number) => {
      stat.textContent = `${count} 雨滴`;
    },
  };
}
