import * as THREE from 'three';

/** First-person walk inside the lab room. WASD + joystick; look is yaw/pitch. */
export class LabWalker {
  yaw = Math.PI;
  pitch = 0;
  readonly position: THREE.Vector3;
  moveFwd = 0;
  moveStr = 0;
  speed = 2.7;

  private keys = new Set<string>();
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  lookX = 0;
  lookY = 0;
  private readonly lookRate = 2.35;
  private readonly pitchRate = 1.7;
  private readonly lookSens = 0.0032;
  private readonly eyeY: number;
  private readonly minX: number;
  private readonly maxX: number;
  private readonly minZ: number;
  private readonly maxZ: number;
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: THREE.PerspectiveCamera;

  constructor(
    camera: THREE.PerspectiveCamera,
    canvas: HTMLCanvasElement,
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number; y: number },
  ) {
    this.camera = camera;
    this.canvas = canvas;
    this.minX = bounds.minX;
    this.maxX = bounds.maxX;
    this.minZ = bounds.minZ;
    this.maxZ = bounds.maxZ;
    this.eyeY = bounds.y;
    this.position = new THREE.Vector3(0, this.eyeY, (bounds.minZ + bounds.maxZ) * 0.35);
    this.bind();
    this.applyPose();
  }

  setMoveVector(fwd: number, str: number): void {
    this.moveFwd = THREE.MathUtils.clamp(fwd, -1, 1);
    this.moveStr = THREE.MathUtils.clamp(str, -1, 1);
  }

  setLookVector(x: number, y: number): void {
    this.lookX = THREE.MathUtils.clamp(x, -1, 1);
    this.lookY = THREE.MathUtils.clamp(y, -1, 1);
  }

  applyLook(dyaw: number, dpitch: number): void {
    this.yaw -= dyaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dpitch, -1.15, 1.15);
  }

  update(dt: number): void {
    if (this.lookX !== 0 || this.lookY !== 0) {
      this.applyLook(this.lookX * this.lookRate * dt, -this.lookY * this.pitchRate * dt);
    }
    let fwd = this.moveFwd;
    let str = this.moveStr;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) fwd += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) fwd -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) str -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) str += 1;
    fwd = THREE.MathUtils.clamp(fwd, -1, 1);
    str = THREE.MathUtils.clamp(str, -1, 1);
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 1.55 : 1;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const fx = -sin;
    const fz = -cos;
    const rx = cos;
    const rz = -sin;
    this.position.x += (fx * fwd + rx * str) * this.speed * sprint * dt;
    this.position.z += (fz * fwd + rz * str) * this.speed * sprint * dt;
    this.position.x = THREE.MathUtils.clamp(this.position.x, this.minX, this.maxX);
    this.position.z = THREE.MathUtils.clamp(this.position.z, this.minZ, this.maxZ);
    this.position.y = this.eyeY;
    this.applyPose();
  }

  sync(): void {
    this.applyPose();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
  }

  private applyPose(): void {
    this.camera.position.copy(this.position);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = 0;
  }

  private bind(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.keys.clear());
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.canvas.setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    this.applyLook((e.clientX - this.lastX) * this.lookSens, (e.clientY - this.lastY) * this.lookSens);
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private onPointerUp = () => {
    this.dragging = false;
  };
}

const JOY_SIZE = 140;
const JOY_NUB = 56;
const MAX_NUB = (JOY_SIZE - JOY_NUB) / 2;

/** Dual sticks: left = move, right = look. Pointer events cover iOS + mouse. */
export function wireLabJoysticks(walker: LabWalker): void {
  wireStick('joy', 'joynub', (x, y) => walker.setMoveVector(y, x), () => walker.setMoveVector(0, 0));
  wireStick('lookjoy', 'looknub', (x, y) => walker.setLookVector(x, y), () => walker.setLookVector(0, 0));
}

function wireStick(
  id: string,
  nubId: string,
  onVec: (x: number, y: number) => void,
  onEnd: () => void,
): void {
  const el = document.getElementById(id);
  const nub = document.getElementById(nubId);
  if (!el || !nub) return;
  el.style.display = 'block';

  let origin = { x: 0, y: 0 };
  let active = false;

  const apply = (x: number, y: number) => {
    let dx = x - origin.x;
    let dy = y - origin.y;
    const len = Math.hypot(dx, dy);
    if (len > MAX_NUB) {
      dx = (dx / len) * MAX_NUB;
      dy = (dy / len) * MAX_NUB;
    }
    nub.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    onVec(dx / MAX_NUB, -dy / MAX_NUB);
  };

  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    active = true;
    const r = el.getBoundingClientRect();
    origin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    el.setPointerCapture(e.pointerId);
    apply(e.clientX, e.clientY);
  });
  el.addEventListener('pointermove', (e) => {
    if (!active) return;
    e.preventDefault();
    apply(e.clientX, e.clientY);
  });
  const end = () => {
    if (!active) return;
    active = false;
    onEnd();
    nub.style.transform = 'translate(-50%, -50%)';
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}
