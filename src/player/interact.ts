import * as THREE from 'three';

export interface Interactable {
  object: THREE.Object3D;
  prompt: string;
  maxDist: number;
  onUse: () => void;
}

// Center-screen raycast interaction: look at a registered object within range
// → toast prompt → E to trigger. Gated off while the OS overlay is open.
export class InteractSystem {
  private ray = new THREE.Raycaster();
  private targets: Interactable[] = [];
  private current: Interactable | null = null;
  private toastEl: HTMLElement;
  enabled = true;

  constructor(private camera: THREE.Camera) {
    this.toastEl = document.getElementById('toast')!;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyE' && this.enabled && this.current) this.current.onUse();
    });
  }

  /** External trigger entry-point (touch tap, XR trigger button). Same
   *  semantics as pressing E: fire the current targeted interactable's
   *  onUse() if any. */
  triggerCurrent(): void {
    if (this.enabled && this.current) this.current.onUse();
  }

  add(object: THREE.Object3D, prompt: string, onUse: () => void, maxDist = 2.6): void {
    this.targets.push({ object, prompt, maxDist, onUse });
  }

  /** transient message in the same toast slot (auto-clears) */
  flash(msg: string, ms = 2200): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('on');
    window.setTimeout(() => {
      // don't clear a prompt that re-appeared after the flash
      if (this.toastEl.textContent === msg) {
        this.toastEl.classList.remove('on');
      }
    }, ms);
  }

  update(): void {
    if (!this.enabled) { this.setCurrent(null); return; }
    this.ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    this.ray.far = 4;
    const objects = this.targets.map((t) => t.object);
    const hits = this.ray.intersectObjects(objects, false);
    let next: Interactable | null = null;
    if (hits.length > 0) {
      const hit = hits[0];
      const t = this.targets.find((x) => x.object === hit.object);
      if (t && hit.distance <= t.maxDist) next = t;
    }
    this.setCurrent(next);
  }

  private setCurrent(t: Interactable | null): void {
    if (t === this.current) return;
    this.current = t;
    if (t) {
      this.toastEl.textContent = `[E] ${t.prompt}`;
      this.toastEl.classList.add('on');
    } else {
      this.toastEl.classList.remove('on');
    }
  }
}
