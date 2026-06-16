import type { FPControls } from './fp-controls';
import type { InteractSystem } from './interact';

// Touch-screen control layer for NEON LOFT. On a touch device main.ts adds
// `body.touch` and instantiates this class once, after FPControls + interact
// are ready. CSS for the DOM nodes lives in `index.html`'s `<style>`.
//
//   - Bottom-left: virtual joystick (140×140) — drag from centre, drives
//     FPControls.setMoveVector each frame.
//   - Anywhere on the right half (touches that don't start in the joystick
//     zone): camera yaw/pitch via touchmove deltas → FPControls.applyLook.
//   - A short, low-movement tap (≤200ms, ≤8 px total) on the right half is
//     treated as `E` (interact) — calls interact.triggerCurrent().
//
// Multi-touch friendly: the joystick claims its initial touch ID and the
// look layer claims any other concurrent touches. No global state leaks.

const JOY_SIZE = 140;         // px diameter of the outer joystick disc
const JOY_NUB_SIZE = 56;      // px diameter of the moving nub
const MAX_NUB_OFFSET = (JOY_SIZE - JOY_NUB_SIZE) / 2;  // px the nub can travel
const LOOK_SENS = 0.0035;     // rad / px — about 60% of mouse sens (touch overshoots otherwise)
const TAP_MAX_MS = 200;
const TAP_MAX_PX = 8;

export class TouchControls {
  private joyEl: HTMLElement;
  private nubEl: HTMLElement;
  private joyTouchId: number | null = null;
  private joyOrigin = { x: 0, y: 0 };       // touch start screen coords
  private lookTouchId: number | null = null;
  private lookLastX = 0;
  private lookLastY = 0;
  private lookStartX = 0;
  private lookStartY = 0;
  private lookStartT = 0;
  private lookMovedPx = 0;

  constructor(
    private controls: FPControls,
    private interact: InteractSystem,
  ) {
    this.joyEl = document.getElementById('joy')!;
    this.nubEl = document.getElementById('joynub')!;
    if (!this.joyEl || !this.nubEl) {
      console.warn('[touch] missing #joy / #joynub — skipping touch wiring');
      return;
    }
    document.addEventListener('touchstart', this.onTouchStart, { passive: false });
    document.addEventListener('touchmove', this.onTouchMove, { passive: false });
    document.addEventListener('touchend', this.onTouchEnd, { passive: false });
    document.addEventListener('touchcancel', this.onTouchEnd, { passive: false });
  }

  /** Returns true if (clientX, clientY) is inside the joystick hit area. */
  private isInsideJoystick(x: number, y: number): boolean {
    const r = this.joyEl.getBoundingClientRect();
    // Slight padding so the player can grab the joystick a bit outside the
    // visible disc — easier on chubby thumbs.
    const pad = 20;
    return x >= r.left - pad && x <= r.right + pad
        && y >= r.top  - pad && y <= r.bottom + pad;
  }

  private onTouchStart = (e: TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      // First-priority claim: joystick zone if not already held
      if (this.joyTouchId === null && this.isInsideJoystick(t.clientX, t.clientY)) {
        this.joyTouchId = t.identifier;
        const r = this.joyEl.getBoundingClientRect();
        this.joyOrigin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        this.updateJoystick(t.clientX, t.clientY);
        e.preventDefault();
        continue;
      }
      // Otherwise: claim as a look touch if we don't already have one
      if (this.lookTouchId === null) {
        this.lookTouchId = t.identifier;
        this.lookLastX = this.lookStartX = t.clientX;
        this.lookLastY = this.lookStartY = t.clientY;
        this.lookStartT = performance.now();
        this.lookMovedPx = 0;
        e.preventDefault();
      }
    }
  };

  private onTouchMove = (e: TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === this.joyTouchId) {
        this.updateJoystick(t.clientX, t.clientY);
        e.preventDefault();
      } else if (t.identifier === this.lookTouchId) {
        const dx = t.clientX - this.lookLastX;
        const dy = t.clientY - this.lookLastY;
        this.controls.applyLook(dx * LOOK_SENS, dy * LOOK_SENS);
        this.lookMovedPx += Math.abs(dx) + Math.abs(dy);
        this.lookLastX = t.clientX;
        this.lookLastY = t.clientY;
        e.preventDefault();
      }
    }
  };

  private onTouchEnd = (e: TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === this.joyTouchId) {
        this.joyTouchId = null;
        this.controls.setMoveVector(0, 0);
        // recentre nub
        this.nubEl.style.transform = 'translate(-50%, -50%)';
      } else if (t.identifier === this.lookTouchId) {
        const dt = performance.now() - this.lookStartT;
        this.lookTouchId = null;
        // Tap = short + low movement → fire E
        if (dt < TAP_MAX_MS && this.lookMovedPx < TAP_MAX_PX) {
          this.interact.triggerCurrent();
        }
      }
    }
  };

  private updateJoystick(touchX: number, touchY: number): void {
    let dx = touchX - this.joyOrigin.x;
    let dy = touchY - this.joyOrigin.y;
    const len = Math.hypot(dx, dy);
    if (len > MAX_NUB_OFFSET) {
      dx = (dx / len) * MAX_NUB_OFFSET;
      dy = (dy / len) * MAX_NUB_OFFSET;
    }
    this.nubEl.style.transform =
      `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    // Map to forward/strafe: up (negative y) → forward +, right → strafe +
    const fwd = -dy / MAX_NUB_OFFSET;
    const str =  dx / MAX_NUB_OFFSET;
    this.controls.setMoveVector(fwd, str);
  }
}
