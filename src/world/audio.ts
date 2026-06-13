import * as THREE from 'three';

// Procedural ambience — no audio assets needed.
// Rain: filtered white noise, louder near the window. City: low rumble bed.
export class Ambience {
  private ctx: AudioContext | null = null;
  private rainGain: GainNode | null = null;
  private humGain: GainNode | null = null;
  private started = false;

  /** Must be called from a user gesture (pointer-lock click) for autoplay policy. */
  start(): void {
    if (this.started) return;
    this.started = true;
    const ac = new AudioContext();
    this.ctx = ac;

    // --- rain: white noise → bandpass → lowpass, slow gusting LFO ---
    const noise = ac.createBufferSource();
    noise.buffer = makeNoiseBuffer(ac, 2.0, 'white');
    noise.loop = true;
    const band = ac.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1600;
    band.Q.value = 0.45;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4200;
    this.rainGain = ac.createGain();
    this.rainGain.gain.value = 0.0;
    const lfo = ac.createOscillator();
    lfo.frequency.value = 0.17;
    const lfoAmp = ac.createGain();
    lfoAmp.gain.value = 0.045;
    lfo.connect(lfoAmp).connect(this.rainGain.gain);
    noise.connect(band).connect(lp).connect(this.rainGain).connect(ac.destination);
    noise.start();
    lfo.start();

    // --- distant city hum: brown noise, heavily low-passed ---
    const hum = ac.createBufferSource();
    hum.buffer = makeNoiseBuffer(ac, 3.0, 'brown');
    hum.loop = true;
    const humLp = ac.createBiquadFilter();
    humLp.type = 'lowpass';
    humLp.frequency.value = 220;
    this.humGain = ac.createGain();
    this.humGain.gain.value = 0.05;
    hum.connect(humLp).connect(this.humGain).connect(ac.destination);
    hum.start();
  }

  /** Rain swells as the player approaches the window wall (z = +windowZ). */
  update(playerPos: THREE.Vector3, windowZ: number, rainIntensity: number): void {
    if (!this.ctx || !this.rainGain) return;
    const dist = Math.max(0, windowZ - playerPos.z);          // 0 at the glass
    const proximity = Math.pow(1 - Math.min(dist / 12, 1), 2); // quadratic swell
    const base = 0.05 + 0.30 * proximity;                      // always faintly audible
    const target = base * Math.min(rainIntensity, 1.5);
    this.rainGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.4);
  }

  // ---------- bathroom one-shots ----------

  /** toilet flush: short noise burst with a falling sweep */
  flush(): void {
    if (!this.ctx) return;
    const ac = this.ctx;
    const src = ac.createBufferSource();
    src.buffer = makeNoiseBuffer(ac, 1.6, 'white');
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1400, ac.currentTime);
    bp.frequency.exponentialRampToValueAtTime(280, ac.currentTime + 1.4);
    bp.Q.value = 0.8;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0, ac.currentTime);
    g.gain.linearRampToValueAtTime(0.22, ac.currentTime + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 1.5);
    src.connect(bp).connect(g).connect(ac.destination);
    src.start();
  }

  private showerGain: GainNode | null = null;

  /** shower hiss loop on/off */
  shower(on: boolean): void {
    if (!this.ctx) return;
    const ac = this.ctx;
    if (on && !this.showerGain) {
      const src = ac.createBufferSource();
      src.buffer = makeNoiseBuffer(ac, 2.0, 'white');
      src.loop = true;
      const hp = ac.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 900;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 6500;
      this.showerGain = ac.createGain();
      this.showerGain.gain.value = 0;
      this.showerGain.gain.setTargetAtTime(0.12, ac.currentTime, 0.5);
      src.connect(hp).connect(lp).connect(this.showerGain).connect(ac.destination);
      src.start();
    } else if (!on && this.showerGain) {
      const g = this.showerGain;
      this.showerGain = null;
      g.gain.setTargetAtTime(0, ac.currentTime, 0.3);
      window.setTimeout(() => g.disconnect(), 1500);
    }
  }

  /** tiny arcade beep */
  blip(freq: number): void {
    if (!this.ctx) return;
    const ac = this.ctx;
    const o = ac.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.04, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.09);
    o.connect(g).connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + 0.1);
  }

  /** cat purr: low rumble with ~24Hz tremolo */
  purr(): void {
    if (!this.ctx) return;
    const ac = this.ctx;
    const osc = ac.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 52;
    const trem = ac.createOscillator();
    trem.frequency.value = 24;
    const tremGain = ac.createGain();
    tremGain.gain.value = 0.04;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.001, ac.currentTime);
    g.gain.linearRampToValueAtTime(0.07, ac.currentTime + 0.3);
    g.gain.setTargetAtTime(0.0, ac.currentTime + 2.0, 0.4);
    trem.connect(tremGain).connect(g.gain);
    osc.connect(g).connect(ac.destination);
    osc.start(); trem.start();
    window.setTimeout(() => { osc.stop(); trem.stop(); }, 3500);
  }

  /** apartment doorbell: two-tone chime */
  doorbell(): void {
    if (!this.ctx) return;
    const ac = this.ctx;
    [[880, 0], [659, 0.22]].forEach(([f, dt]) => {
      const o = ac.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, ac.currentTime + dt);
      g.gain.linearRampToValueAtTime(0.12, ac.currentTime + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dt + 0.8);
      o.connect(g).connect(ac.destination);
      o.start(ac.currentTime + dt);
      o.stop(ac.currentTime + dt + 1);
    });
  }

  /** coffee machine: pump hiss + drips */
  brewSound(): void {
    if (!this.ctx) return;
    const ac = this.ctx;
    const src = ac.createBufferSource();
    src.buffer = makeNoiseBuffer(ac, 2.0, 'white');
    src.loop = true;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 750;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, ac.currentTime);
    g.gain.linearRampToValueAtTime(0.06, ac.currentTime + 0.4);
    g.gain.setTargetAtTime(0, ac.currentTime + 5.6, 0.4);
    src.connect(lp).connect(g).connect(ac.destination);
    src.start();
    window.setTimeout(() => src.stop(), 8000);
  }

  // ---------- lo-fi synth pad for the record player (no audio assets) ----------
  private padNodes: { gain: GainNode; oscs: OscillatorNode[]; timer: number } | null = null;

  get padPlaying(): boolean { return this.padNodes !== null; }

  togglePad(): boolean {
    if (this.padNodes) { this.stopPad(); return false; }
    if (!this.ctx) return false;
    const ac = this.ctx;
    const master = ac.createGain();
    master.gain.value = 0.0;
    master.gain.setTargetAtTime(0.06, ac.currentTime, 1.2);
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    master.connect(lp).connect(ac.destination);
    // slow chord cycle: Am → F → C → G (lo-fi double saw, heavily filtered)
    const chords = [
      [220.0, 261.6, 329.6], [174.6, 220.0, 261.6],
      [196.0, 261.6, 329.6], [196.0, 246.9, 293.7],
    ];
    const oscs: OscillatorNode[] = [];
    for (let v = 0; v < 3; v++) {
      for (const det of [-4, 4]) {
        const o = ac.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = chords[0][v];
        o.detune.value = det;
        const g = ac.createGain();
        g.gain.value = 0.33;
        o.connect(g).connect(master);
        o.start();
        oscs.push(o);
      }
    }
    let ci = 0;
    const timer = window.setInterval(() => {
      ci = (ci + 1) % chords.length;
      oscs.forEach((o, i) => {
        o.frequency.setTargetAtTime(chords[ci][Math.floor(i / 2)], ac.currentTime, 0.6);
      });
    }, 4200);
    this.padNodes = { gain: master, oscs, timer };
    return true;
  }

  private stopPad(): void {
    if (!this.padNodes || !this.ctx) return;
    const { gain, oscs, timer } = this.padNodes;
    window.clearInterval(timer);
    gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    window.setTimeout(() => oscs.forEach((o) => o.stop()), 2000);
    this.padNodes = null;
  }
}

/** Distance-based gain for the YouTube player: nearest speaker wins. 0..1. */
export function speakerGain(playerPos: THREE.Vector3, speakers: THREE.Vector3[]): number {
  if (speakers.length === 0) return 1;
  let min = Infinity;
  for (const s of speakers) min = Math.min(min, playerPos.distanceTo(s));
  // full volume within 2m, fades to a floor of 0.15 by 12m (room-scale rolloff)
  const t = Math.min(Math.max((min - 2) / 10, 0), 1);
  return 1 - t * 0.85;
}

function makeNoiseBuffer(ac: AudioContext, seconds: number, kind: 'white' | 'brown'): AudioBuffer {
  const len = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    if (kind === 'white') {
      data[i] = white;
    } else {
      last = (last + 0.02 * white) / 1.02; // leaky integrator → brown noise
      data[i] = last * 3.5;
    }
  }
  return buf;
}
