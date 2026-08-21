import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createRainSystem, type RainSystem } from './system';

/** Default preview is the rain lab while we develop the technique.
 *  Neon Loft itself: add ?room=1 */
export function wantRainLab(): boolean {
  const q = new URLSearchParams(location.search);
  if (q.get('room') === '1') return false;
  if (q.get('lab') === '0' || q.get('lab') === 'off') return false;
  return true;
}

export async function bootRainLab(): Promise<void> {
  document.title = '下雨試驗 — THREE.Points';
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
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;';
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
  renderer.setClearColor(0x070910, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x070910, 0.045);

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.05, 200);
  camera.position.set(3.2, 1.85, 7.4);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1.15, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 2.2;
  controls.maxDistance = 18;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minPolarAngle = 0.12;
  controls.enablePan = false;

  scene.add(new THREE.HemisphereLight(0x8aa0c8, 0x12141c, 0.7));
  const key = new THREE.DirectionalLight(0xc8d4ee, 0.55);
  key.position.set(-4, 8, 6);
  scene.add(key);
  const neon = new THREE.PointLight(0xff4ad2, 2.2, 18, 2);
  neon.position.set(-3.2, 2.4, -2.4);
  scene.add(neon);
  const cyan = new THREE.PointLight(0x4df0ff, 1.6, 16, 2);
  cyan.position.set(3.4, 2.1, -1.2);
  scene.add(cyan);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(48, 48),
    new THREE.MeshStandardMaterial({
      color: 0x0b1018,
      roughness: 0.22,
      metalness: 0.55,
      envMapIntensity: 0.4,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const grid = new THREE.GridHelper(48, 24, 0x1c3a55, 0x121a28);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.35;
  scene.add(grid);

  const slab = (w: number, h: number, d: number, x: number, z: number, hex: number) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({
        color: 0x141820,
        emissive: new THREE.Color(hex),
        emissiveIntensity: 0.55,
        roughness: 0.7,
        metalness: 0.2,
      }),
    );
    m.position.set(x, h / 2, z);
    scene.add(m);
  };
  slab(1.4, 5.2, 1.4, -4.2, -5.5, 0xff2bdb);
  slab(1.8, 7.4, 1.6, 0.2, -7.2, 0x2b7dff);
  slab(1.2, 3.6, 1.2, 3.8, -4.6, 0x2bffd0);

  const current = {
    intensity: 0.8,
    windX: 0.16,
    windZ: 0.04,
    count: 1200,
  };

  function spawnRain(count: number): RainSystem {
    const sys = createRainSystem({
      count,
      yMax: 14,
      yMin: 0.05,
      xSpan: 16,
      z0: -8,
      z1: 8,
      wind: new THREE.Vector2(current.windX, current.windZ),
      color: new THREE.Color(0xd0e4f8),
    });
    sys.setIntensity(current.intensity);
    sys.group.visible = current.intensity > 0.001;
    return sys;
  }

  let rain: RainSystem = spawnRain(1200);
  scene.add(rain.group);

  const panel = mountPanel({
    onIntensity: (k) => {
      current.intensity = k;
      rain.setIntensity(k);
      rain.group.visible = k > 0.001;
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
    onRoom: () => {
      const url = new URL(location.href);
      url.searchParams.set('room', '1');
      url.searchParams.delete('lab');
      location.href = url.toString();
    },
  });

  rain.setIntensity(current.intensity);

  const clock = new THREE.Clock();
  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);

  if (bootEl) {
    bootEl.classList.add('gone');
    window.setTimeout(() => bootEl.remove(), 500);
  }

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    rain.update(dt);
    controls.update();
    renderer.render(scene, camera);
    panel.tick(renderer.info.render.calls, current.count);
  });
}

function mountPanel(handlers: {
  onIntensity: (k: number) => void;
  onWind: (x: number, z: number) => void;
  onCount: (n: number) => void;
  onRoom: () => void;
}) {
  const el = document.createElement('div');
  el.id = 'rainlab-panel';
  el.innerHTML = `
    <div class="rl-title">下雨試驗</div>
    <div class="rl-sub">THREE.Points · GPU 下落 · 落地水花</div>
    <div class="rl-row" data-row="intensity">
      <span>雨勢</span>
      <button data-i="0">停</button>
      <button data-i="0.8" class="on">小</button>
      <button data-i="1.3">中</button>
      <button data-i="1.9">大</button>
    </div>
    <div class="rl-row" data-row="wind">
      <span>風</span>
      <button data-w="0,0">無</button>
      <button data-w="0.16,0.04" class="on">微</button>
      <button data-w="0.55,0.12">強</button>
    </div>
    <div class="rl-row" data-row="count">
      <span>顆數</span>
      <button data-c="400">400</button>
      <button data-c="1200" class="on">1200</button>
      <button data-c="2400">2400</button>
    </div>
    <button class="rl-room" type="button">回房間</button>
    <div class="rl-hint">拖曳旋轉 · 兩指縮放</div>
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
  return {
    refresh: () => {},
    tick: (calls: number, count: number) => {
      stat.textContent = `${count} pts · ${calls} draws`;
    },
  };
}
