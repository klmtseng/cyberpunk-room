import * as THREE from 'three';
import type { AABB } from '../world/room';

export interface FPSConfig {
  eyeHeight: number;
  walkSpeed: number;
  runSpeed: number;
  bodyRadius: number;
  jumpVel: number;
  gravity: number;
}

const DEFAULT: FPSConfig = {
  eyeHeight: 1.7,
  walkSpeed: 3.0,
  runSpeed: 5.4,
  bodyRadius: 0.32,
  jumpVel: 4.2,
  gravity: 14,
};

export class FPControls {
  readonly camera: THREE.PerspectiveCamera;
  readonly domElement: HTMLElement;
  readonly cfg: FPSConfig;
  private yaw = 0;
  private pitch = 0;
  private keys = new Set<string>();
  private vel = new THREE.Vector3();
  private onGround = true;
  private walls: AABB[] = [];
  private heightSampler: ((x: number, z: number, feetY: number) => number) | null = null;
  private bounds = { minX: -5.8, maxX: 5.8, minZ: -6.8, maxZ: 6.8 };
  private locked = false;
  private listeners: Array<() => void> = [];
  /** false while the OS overlay owns input (movement + jump suspended) */
  enabled = true;
  // Touch / XR additive input — keyboard path stays untouched. Each frame
  // `update(dt)` reads these alongside `keys`; touch-controls writes them
  // from joystick state.
  private moveForward = 0;   // -1..1 (joystick Y, push up = +1)
  private moveStrafe = 0;    // -1..1 (joystick X)
  // When the WebXR session is active, three.js owns the camera rotation
  // (head pose). We must stop fighting it in update(). Set by main.ts via
  // a session-start listener.
  xrPresenting = false;

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement, cfg: Partial<FPSConfig> = {}) {
    this.camera = camera;
    this.domElement = dom;
    this.cfg = { ...DEFAULT, ...cfg };
    this.camera.rotation.order = 'YXZ';
    this.bindEvents();
  }

  setWalls(walls: AABB[]) { this.walls = walls; }

  /** Walkable ground height (stairs, mezzanine). Receives current feet height. */
  setHeightSampler(fn: (x: number, z: number, feetY: number) => number) {
    this.heightSampler = fn;
  }

  getYaw() { return this.yaw; }
  getPitch() { return this.pitch; }
  clearKeys() { this.keys.clear(); this.vel.set(0, this.vel.y, 0); }

  setOrientation(yaw: number, pitch: number = 0) {
    this.yaw = yaw;
    this.pitch = Math.max(-Math.PI/2 + 0.02, Math.min(Math.PI/2 - 0.02, pitch));
    if (!this.xrPresenting) this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  /** Drive movement directly (touch joystick / XR left stick). Each component
   *  in [-1, 1]; forward=+1 walks the way the camera is facing. Coexists with
   *  keyboard — both are summed in update(). */
  setMoveVector(forward: number, strafe: number): void {
    this.moveForward = Math.max(-1, Math.min(1, forward));
    this.moveStrafe = Math.max(-1, Math.min(1, strafe));
  }

  /** Add a yaw / pitch delta. Used by touch-look + (later) XR head-pose
   *  exceptions. Same accumulation semantics as the existing mousemove. */
  applyLook(dyaw: number, dpitch: number): void {
    this.yaw -= dyaw;
    this.pitch -= dpitch;
    this.pitch = Math.max(-Math.PI/2 + 0.02, Math.min(Math.PI/2 - 0.02, this.pitch));
  }

  /** Fake the pointer-lock state for the input layer on platforms that have
   *  no pointer-lock (touch, XR). Movement code reads `this.locked` to gate
   *  WASD; we want the same gate for joystick. */
  setLocked(on: boolean): void {
    if (this.locked === on) return;
    this.locked = on;
    this.listeners.forEach((f) => f());
  }

  get isLocked() { return this.locked; }

  onLockChange(cb: () => void) { this.listeners.push(cb); }

  requestLock() {
    if (!this.locked && this.domElement.requestPointerLock) {
      this.domElement.requestPointerLock();
    }
  }

  release() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private bindEvents() {
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.domElement;
      this.listeners.forEach((f) => f());
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const sens = 0.0022;
      this.yaw   -= e.movementX * sens;
      this.pitch -= e.movementY * sens;
      this.pitch = Math.max(-Math.PI/2 + 0.02, Math.min(Math.PI/2 - 0.02, this.pitch));
    });
    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      this.keys.add(e.code);
      if (e.code === 'Space' && this.onGround) {
        this.vel.y = this.cfg.jumpVel;
        this.onGround = false;
      }
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
  }

  update(dt: number) {
    if (!this.enabled) return;
    const { camera, cfg } = this;
    // rotation — but NEVER fight the WebXR head pose; three.js handles that
    if (!this.xrPresenting) camera.rotation.set(this.pitch, this.yaw, 0);

    // movement (only when locked, otherwise still apply gravity)
    if (this.locked || this.xrPresenting) {
      const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const move = new THREE.Vector3();
      if (this.keys.has('KeyW')) move.add(fwd);
      if (this.keys.has('KeyS')) move.sub(fwd);
      if (this.keys.has('KeyD')) move.add(right);
      if (this.keys.has('KeyA')) move.sub(right);
      // Joystick / XR stick additive contribution. Range [-1, 1] each.
      if (this.moveForward !== 0 || this.moveStrafe !== 0) {
        move.addScaledVector(fwd, this.moveForward);
        move.addScaledVector(right, this.moveStrafe);
      }
      if (move.lengthSq() > 0) move.normalize();
      const speed = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
        ? cfg.runSpeed : cfg.walkSpeed;
      this.vel.x = move.x * speed;
      this.vel.z = move.z * speed;
    } else {
      this.vel.x *= 0.8;
      this.vel.z *= 0.8;
    }

    // gravity
    this.vel.y -= cfg.gravity * dt;

    // integrate + collide per axis (simple swept-AABB style)
    const pos = camera.position.clone();
    const dx = this.vel.x * dt;
    const dy = this.vel.y * dt;
    const dz = this.vel.z * dt;
    pos.x += dx; this.resolveX(pos);
    pos.z += dz; this.resolveZ(pos);
    pos.y += dy; this.resolveY(pos);

    // room outer bounds (failsafe; walls already block, but bounds catch corner glitches)
    pos.x = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, pos.x));
    pos.z = Math.max(this.bounds.minZ, Math.min(this.bounds.maxZ, pos.z));

    camera.position.copy(pos);
  }

  private resolveX(pos: THREE.Vector3) {
    const r = this.cfg.bodyRadius;
    for (const w of this.walls) {
      if (pos.y - this.cfg.eyeHeight < w.max.y && pos.y > w.min.y - 0.1
          && pos.z + r > w.min.z && pos.z - r < w.max.z
          && pos.x + r > w.min.x && pos.x - r < w.max.x) {
        // push back along x
        if (this.vel.x > 0) pos.x = w.min.x - r - 0.001;
        else                pos.x = w.max.x + r + 0.001;
        this.vel.x = 0;
      }
    }
  }

  private resolveZ(pos: THREE.Vector3) {
    const r = this.cfg.bodyRadius;
    for (const w of this.walls) {
      if (pos.y - this.cfg.eyeHeight < w.max.y && pos.y > w.min.y - 0.1
          && pos.x + r > w.min.x && pos.x - r < w.max.x
          && pos.z + r > w.min.z && pos.z - r < w.max.z) {
        if (this.vel.z > 0) pos.z = w.min.z - r - 0.001;
        else                pos.z = w.max.z + r + 0.001;
        this.vel.z = 0;
      }
    }
  }

  private resolveY(pos: THREE.Vector3) {
    const feetY = pos.y - this.cfg.eyeHeight;
    const ground = this.heightSampler ? this.heightSampler(pos.x, pos.z, feetY) : 0;
    const groundY = ground + this.cfg.eyeHeight;
    if (pos.y <= groundY) {
      pos.y = groundY;
      this.vel.y = 0;
      this.onGround = true;
    } else if (this.onGround && pos.y - groundY < 0.45 && this.vel.y <= 0) {
      // stick to ground when walking down stairs (avoid micro-bouncing)
      pos.y = groundY;
      this.vel.y = 0;
    } else {
      this.onGround = false;
    }
  }
}
