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
  document.title = '雨巷試驗';
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
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(FOG_COLOR, 1);

  const scene = new THREE.Scene();
  const fog = new THREE.FogExp2(FOG_COLOR.getHex(), FOG_DENSITY.mid);
  scene.fog = fog;
  scene.background = FOG_COLOR.clone();

  const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.05, 120);
  camera.position.set(1.6, 1.55, 9.2);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1.25, -4);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 2.4;
  controls.maxDistance = 22;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minPolarAngle = 0.18;
  controls.enablePan = false;

  scene.add(new THREE.HemisphereLight(0x6a88aa, 0x080a10, 0.45));
  const key = new THREE.DirectionalLight(0x9bb4d0, 0.28);
  key.position.set(-6, 10, 4);
  scene.add(key);

  buildAlley(scene);

  const current = {
    intensity: 0.8,
    windX: 0.18,
    windZ: 0.05,
    count: 1600,
    fog: FOG_DENSITY.mid,
  };

  function spawnRain(count: number): RainSystem {
    const sys = createRainSystem({
      count,
      yMax: 16,
      yMin: 0.04,
      xSpan: 14,
      z0: -32,
      z1: 12,
      wind: new THREE.Vector2(current.windX, current.windZ),
      color: new THREE.Color(0xc8dcf0),
    });
    sys.setIntensity(current.intensity);
    sys.group.visible = current.intensity > 0.001;
    return sys;
  }

  let rain: RainSystem = spawnRain(current.count);
  scene.add(rain.group);

  const mist: MistSystem = createMist({ count: 160 });
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
    renderer.render(scene, camera);
    panel.tick(current.count);
  });
}

function buildAlley(scene: THREE.Scene): void {
  const wet = new THREE.MeshStandardMaterial({
    color: 0x0c1118,
    roughness: 0.18,
    metalness: 0.72,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(18, 80), wet);
  ground.rotation.x = -Math.PI / 2;
  ground.position.z = -12;
  scene.add(ground);

  const curbMat = new THREE.MeshStandardMaterial({ color: 0x161c26, roughness: 0.7, metalness: 0.15 });
  for (const x of [-6.4, 6.4]) {
    const curb = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 80), curbMat);
    curb.position.set(x, 0.09, -12);
    scene.add(curb);
  }

  const facade = (hex: number) => new THREE.MeshStandardMaterial({
    color: 0x12161e,
    emissive: new THREE.Color(hex),
    emissiveIntensity: 0.42,
    roughness: 0.78,
    metalness: 0.18,
  });

  const left = [
    { z: 4, h: 6.2, w: 3.2, c: 0xff2bdb },
    { z: -2, h: 9.4, w: 3.6, c: 0x2b6dff },
    { z: -9, h: 5.1, w: 3.0, c: 0x1ad6c4 },
    { z: -16, h: 11.2, w: 3.8, c: 0xaa44ff },
    { z: -24, h: 7.6, w: 3.2, c: 0xff5a7a },
  ];
  const right = [
    { z: 2, h: 8.0, w: 3.4, c: 0x2bd4ff },
    { z: -5, h: 4.8, w: 2.8, c: 0xffaa33 },
    { z: -12, h: 10.4, w: 3.6, c: 0xff2bdb },
    { z: -20, h: 6.5, w: 3.1, c: 0x4477ff },
    { z: -28, h: 9.0, w: 3.4, c: 0x33e0a8 },
  ];
  for (const b of left) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, 4.2), facade(b.c));
    m.position.set(-8.2, b.h / 2, b.z);
    scene.add(m);
  }
  for (const b of right) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, 4.2), facade(b.c));
    m.position.set(8.2, b.h / 2, b.z);
    scene.add(m);
  }

  const lampMat = new THREE.MeshStandardMaterial({
    color: 0x1a1e26, roughness: 0.4, metalness: 0.6,
  });
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffe6b0 });
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xffcc77, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide,
  });
  for (let i = 0; i < 6; i++) {
    const z = 6 - i * 7.2;
    const x = i % 2 === 0 ? -5.6 : 5.6;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.4, 8), lampMat);
    pole.position.set(x, 1.7, z);
    scene.add(pole);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), bulbMat);
    bulb.position.set(x, 3.35, z);
    scene.add(bulb);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.85, 16, 12), glowMat);
    glow.position.set(x, 3.35, z);
    scene.add(glow);
    const light = new THREE.PointLight(0xffd8a0, 1.35, 11, 2);
    light.position.set(x, 3.3, z);
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
    <div class="rl-title">雨巷</div>
    <div class="rl-sub">獨立場景 · 雨絲 · 雨聲 · 霧</div>
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
    <button class="rl-room" type="button">回房間</button>
    <div class="rl-hint">點一下開雨聲 · 拖曳轉視角</div>
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
      hint.textContent = on ? '雨聲已開 · 拖曳轉視角' : '點一下開雨聲 · 拖曳轉視角';
    },
    tick: (count: number) => {
      stat.textContent = `${count} 雨滴`;
    },
  };
}
