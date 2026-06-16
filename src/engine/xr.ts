import * as THREE from 'three';
import type { EngineCtx } from './renderer';
import type { FPControls } from '../player/fp-controls';
import type { InteractSystem } from '../player/interact';

// WebXR session bootstrap + controller wiring for NEON LOFT.
//
// When an immersive-VR session is requested the player gets:
//   - HEAD POSE: three.js drives the camera rotation automatically via
//     renderer.xr; FPControls.xrPresenting=true makes it stop fighting.
//   - LEFT STICK: smooth locomotion relative to current head yaw.
//   - RIGHT STICK: snap-turn in 30° increments (rising-edge detection on
//     |axes[2]| > 0.7). Snap turn is the standard cure for VR sim sickness.
//   - TRIGGER (either controller): equivalent of `E` — raycasts from the
//     controller's tip and fires the first interact target hit.
//
// On a non-XR device the button just isn't appended and no listeners fire.
// On this dev box, navigator.xr is undefined and the whole thing no-ops.

export interface XRDeps {
  controls: FPControls;
  interact: InteractSystem;
}

const SNAP_DEG = 30;
const SNAP_RAD = (SNAP_DEG * Math.PI) / 180;
const STICK_DEAD = 0.18;        // |axis| below this counts as zero
const SNAP_FIRE = 0.70;         // |axis| above triggers a snap
const SNAP_RESET = 0.30;        // |axis| must fall below this before next snap

export async function initXR(ctx: EngineCtx, deps: XRDeps): Promise<void> {
  const xr = (navigator as any).xr;
  if (!xr || typeof xr.isSessionSupported !== 'function') return;
  let supported = false;
  try { supported = await xr.isSessionSupported('immersive-vr'); } catch { supported = false; }
  if (!supported) return;

  const button = document.createElement('button');
  button.id = 'xr-enter';
  button.textContent = 'ENTER VR';
  Object.assign(button.style, {
    position: 'fixed', right: '14px', top: '14px', zIndex: '20',
    background: 'transparent', color: '#5af2ff',
    border: '1px solid #5af2ff66', padding: '8px 14px',
    fontFamily: "'Share Tech Mono', monospace", fontSize: '12px',
    letterSpacing: '.15em', cursor: 'pointer',
  } as CSSStyleDeclaration);
  document.body.appendChild(button);

  // --- Controllers + pointer rays ---
  const c0 = ctx.renderer.xr.getController(0);   // left, by convention
  const c1 = ctx.renderer.xr.getController(1);   // right
  ctx.scene.add(c0, c1);

  const rayMat = new THREE.LineBasicMaterial({
    color: 0x5af2ff, transparent: true, opacity: 0.55, depthTest: false,
  });
  const rayGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -4),
  ]);
  const ray0 = new THREE.Line(rayGeo, rayMat); ray0.renderOrder = 30;
  const ray1 = new THREE.Line(rayGeo, rayMat); ray1.renderOrder = 30;
  c0.add(ray0); c1.add(ray1);

  // --- Trigger interact ---
  const raycaster = new THREE.Raycaster();
  const tmpDir = new THREE.Vector3();
  const tmpOrigin = new THREE.Vector3();
  const fireTrigger = (controller: THREE.Group) => {
    // Compute ray from controller world transform
    controller.getWorldPosition(tmpOrigin);
    tmpDir.set(0, 0, -1).applyQuaternion(controller.getWorldQuaternion(new THREE.Quaternion()));
    raycaster.set(tmpOrigin, tmpDir);
    raycaster.far = 5.0;
    // Use the interact registry's targets directly — interact.ts already
    // exposes the public update() but not the array; we walk all scene
    // candidates instead. Cheap because interact.targets is small.
    const targets = (deps.interact as any).targets as Array<{ object: THREE.Object3D; maxDist: number; onUse: () => void }>;
    if (!targets || targets.length === 0) return;
    const hits = raycaster.intersectObjects(targets.map((t) => t.object), false);
    if (hits.length === 0) return;
    const hit = hits[0];
    const t = targets.find((x) => x.object === hit.object);
    if (t && hit.distance <= t.maxDist) t.onUse();
  };
  c0.addEventListener('selectstart', () => fireTrigger(c0));
  c1.addEventListener('selectstart', () => fireTrigger(c1));

  // --- Per-frame locomotion + snap-turn driven from gamepad axes ---
  // Three.js calls our setAnimationLoop callback in XR too, but axes need
  // to be polled via navigator.gamepads / inputSources. We attach a small
  // setAnimationLoop hook here that runs alongside the main one.
  let rightArmed = true;  // ready to accept a snap; flips false until stick recenters
  const tickXR = () => {
    const session = ctx.renderer.xr.getSession();
    if (!session) return;
    // Iterate XRInputSource list — typed loosely because @types/webxr varies
    const sources = (session as any).inputSources as Array<any>;
    if (!sources) return;
    let leftFwd = 0, leftStr = 0;
    let rightAxisX = 0;
    for (const src of sources) {
      const gp = src.gamepad;
      if (!gp || !gp.axes) continue;
      // Quest controllers expose thumbstick on axes[2..3] (axes[0..1] is
      // the touchpad, unused on Touch controllers).
      const ax = gp.axes[2] ?? 0;
      const ay = gp.axes[3] ?? 0;
      if (src.handedness === 'left') {
        if (Math.abs(ax) > STICK_DEAD || Math.abs(ay) > STICK_DEAD) {
          leftStr = ax;
          leftFwd = -ay;   // up on stick = forward
        }
      } else if (src.handedness === 'right') {
        rightAxisX = ax;
      }
    }
    // Locomotion: drive FPControls with head-yaw-relative input. Reading
    // the headset world yaw is the simplest cross-platform option.
    const headYaw = ctx.renderer.xr.getCamera().rotation.y;
    deps.controls.setOrientation(headYaw, deps.controls.getPitch());
    deps.controls.setMoveVector(leftFwd, leftStr);
    // Snap-turn — rising-edge detection on right stick X
    if (rightArmed && Math.abs(rightAxisX) > SNAP_FIRE) {
      const dir = rightAxisX > 0 ? 1 : -1;
      const yaw = deps.controls.getYaw() - dir * SNAP_RAD;
      deps.controls.setOrientation(yaw, deps.controls.getPitch());
      rightArmed = false;
    } else if (!rightArmed && Math.abs(rightAxisX) < SNAP_RESET) {
      rightArmed = true;
    }
  };
  // The main animation loop in main.ts calls ctx.composer.render(); we can't
  // easily slot tickXR there from here, so we install our own xr.onframe-style
  // hook by registering a high-frequency setInterval. WebXR's compositor still
  // drives the render — we just poll axes alongside. 16ms ≈ 60Hz, good enough.
  let pollHandle: number | null = null;

  // --- Session lifecycle ---
  ctx.renderer.xr.addEventListener('sessionstart', () => {
    deps.controls.xrPresenting = true;
    document.body.classList.add('xr');
    deps.controls.setLocked(true);   // engage movement code
    pollHandle = window.setInterval(tickXR, 16);
  });
  ctx.renderer.xr.addEventListener('sessionend', () => {
    deps.controls.xrPresenting = false;
    document.body.classList.remove('xr');
    deps.controls.setLocked(false);
    deps.controls.setMoveVector(0, 0);
    if (pollHandle !== null) { window.clearInterval(pollHandle); pollHandle = null; }
  });

  button.onclick = async () => {
    try {
      const session = await xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
      });
      await ctx.renderer.xr.setSession(session);
    } catch (err) { console.warn('VR session failed', err); }
  };
}
