// RoomState — the single serialisable source of truth for every toggle-able
// device in the loft (lamps, curtain, light mood, music, …).
//
// WHY THIS EXISTS (the M2 architecture nail):
// The original props each hid their state inside a closure and only exposed
// *relative* ops (`toggle()`, `cycle()` → advance to next). That makes three
// later milestones impossible: you cannot save a room (M4) you cannot read,
// you cannot sync a room (M5) you cannot SET to an absolute value, and you
// cannot reload a shared layout. RoomState fixes this once:
//
//   • devices register an ABSOLUTE `apply(value)` adapter + their ordered
//     `states` enumeration,
//   • interactions stop poking props directly and instead call
//     `state.advance(id)` (E-press) or `state.set(id, value)`,
//   • the store owns the canonical value, so `snapshot()` serialises the
//     whole room and `restore()` rebuilds it,
//   • every mutation is tagged with an `origin` and broadcast to
//     `subscribe()` listeners — that single hook is all M5 (multiplayer)
//     and M4 (share) plug into. The echo-guard (skip when value unchanged)
//     stops a remote→local→remote feedback loop before it can start.
//
// Framework-agnostic on purpose: no THREE import. A device's `apply` is the
// only thing that touches the scene, so this file stays unit-testable in
// plain Node with zero GPU.

/** Values must round-trip through JSON (URL share + network sync). */
export type StateValue = boolean | number | string;

export interface DeviceDef<T extends StateValue = StateValue> {
  /** stable id — also the key used in snapshots/URLs, so don't rename casually */
  id: string;
  /** initial/default value; must be one of `states` when `states` is given */
  value: T;
  /** push an absolute value into the scene. Must be idempotent. */
  apply: (value: T) => void;
  /** ordered enumeration enabling `advance()` (E-press "next"). Optional:
   *  a free-scalar device (e.g. a dimmer 0..1) can omit it and only accept
   *  `set()`. When present, `set`/`restore` reject values not in the list. */
  states?: readonly T[];
  /** equality test for the echo-guard; defaults to `===` (fine for scalars) */
  eq?: (a: T, b: T) => boolean;
}

export interface ChangeEvent {
  id: string;
  value: StateValue;
  /** 'local' = this client's user; 'restore' = load from URL/save;
   *  'remote' = a synced peer. Listeners use it to avoid re-broadcasting. */
  origin: string;
}

interface Entry {
  def: DeviceDef;
  value: StateValue;
}

export type Snapshot = Record<string, StateValue>;

export class RoomState {
  private entries = new Map<string, Entry>();
  private listeners = new Set<(e: ChangeEvent) => void>();

  /** Register a device and apply its initial value once. */
  register<T extends StateValue>(def: DeviceDef<T>): void {
    if (this.entries.has(def.id)) {
      throw new Error(`RoomState: duplicate device id "${def.id}"`);
    }
    if (def.states && !def.states.includes(def.value)) {
      throw new Error(`RoomState: initial value for "${def.id}" not in states`);
    }
    this.entries.set(def.id, { def: def as unknown as DeviceDef, value: def.value });
    def.apply(def.value); // make the scene match the declared default
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  get(id: string): StateValue | undefined {
    return this.entries.get(id)?.value;
  }

  ids(): string[] {
    return [...this.entries.keys()];
  }

  /**
   * Set a device to an absolute value. No-ops (and does NOT notify) when the
   * value is unchanged — this is the echo-guard that keeps multiplayer sync
   * from looping. Returns the effective value (unchanged on a rejected set).
   */
  set(id: string, value: StateValue, origin = 'local'): StateValue | undefined {
    const e = this.entries.get(id);
    if (!e) return undefined; // unknown id (stale save / hostile peer) → ignore
    if (e.def.states && !e.def.states.includes(value)) return e.value; // invalid → ignore
    const eq = e.def.eq ?? ((a, b) => a === b);
    if (eq(e.value, value)) return e.value; // unchanged → no apply, no notify
    e.value = value;
    e.def.apply(value);
    this.emit({ id, value, origin });
    return value;
  }

  /** Advance an enumerated device to its next state (wraps). The E-press path. */
  advance(id: string, origin = 'local'): StateValue | undefined {
    const e = this.entries.get(id);
    if (!e) return undefined;
    if (!e.def.states || e.def.states.length === 0) {
      throw new Error(`RoomState: advance() on non-enumerated device "${id}"`);
    }
    const i = e.def.states.indexOf(e.value);
    const next = e.def.states[(i + 1) % e.def.states.length];
    return this.set(id, next, origin);
  }

  /** Whole-room serialisation: id → value for every registered device. */
  snapshot(): Snapshot {
    const out: Snapshot = {};
    for (const [id, e] of this.entries) out[id] = e.value;
    return out;
  }

  /**
   * Rebuild from a snapshot. Unknown ids and invalid values are skipped, not
   * thrown — a saved/shared room must survive devices being added or removed
   * between versions, and a snapshot off the wire is untrusted input.
   */
  restore(snap: Snapshot, origin = 'restore'): void {
    if (!snap || typeof snap !== 'object') return;
    for (const id of Object.keys(snap)) this.set(id, snap[id], origin);
  }

  // --- M4 share-by-URL: compact, URL-safe, self-describing ----------------

  /** snapshot → URL-safe base64 token (for ?room=… links and the gallery). */
  encode(): string {
    const json = JSON.stringify(this.snapshot());
    return toBase64Url(json);
  }

  /** token → snapshot (returns null on garbage; never throws). */
  static decode(token: string): Snapshot | null {
    try {
      const json = fromBase64Url(token);
      const obj = JSON.parse(json);
      return obj && typeof obj === 'object' ? (obj as Snapshot) : null;
    } catch {
      return null;
    }
  }

  /** Convenience: decode a token and restore in one step. */
  loadToken(token: string, origin = 'restore'): boolean {
    const snap = RoomState.decode(token);
    if (!snap) return false;
    this.restore(snap, origin);
    return true;
  }

  // --- M5 sync hook -------------------------------------------------------

  /** Subscribe to every effective mutation. Returns an unsubscribe fn. */
  subscribe(cb: (e: ChangeEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(e: ChangeEvent): void {
    for (const cb of this.listeners) {
      try { cb(e); } catch { /* a bad listener must not break the store */ }
    }
  }
}

// Base64url helpers that work in both the browser (btoa/atob) and Node
// (Buffer) so the store stays environment-agnostic and Node-testable.
function toBase64Url(s: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const NodeBuffer = (globalThis as any).Buffer;
  const b64 = typeof btoa === 'function'
    ? btoa(unescape(encodeURIComponent(s)))
    : NodeBuffer.from(s, 'utf8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const NodeBuffer = (globalThis as any).Buffer;
  return typeof atob === 'function'
    ? decodeURIComponent(escape(atob(b64)))
    : NodeBuffer.from(b64, 'base64').toString('utf8');
}
