/** Procedural rain bed for the lab. No files. Must start() on a user gesture. */

export class RainBed {
  private ctx: AudioContext | null = null;
  private rainGain: GainNode | null = null;
  private dripGain: GainNode | null = null;
  private humGain: GainNode | null = null;
  private band: BiquadFilterNode | null = null;
  private started = false;
  private intensity = 0.8;

  get ready(): boolean { return this.started; }

  start(): void {
    if (this.started) return;
    this.started = true;
    const ac = new AudioContext();
    this.ctx = ac;
    void ac.resume();

    const noise = ac.createBufferSource();
    noise.buffer = makeNoise(ac, 2.2, 'white');
    noise.loop = true;
    const band = ac.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1700;
    band.Q.value = 0.42;
    this.band = band;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4800;
    this.rainGain = ac.createGain();
    this.rainGain.gain.value = 0.0;
    const lfo = ac.createOscillator();
    lfo.frequency.value = 0.19;
    const lfoAmp = ac.createGain();
    lfoAmp.gain.value = 0.05;
    lfo.connect(lfoAmp).connect(this.rainGain.gain);
    noise.connect(band).connect(lp).connect(this.rainGain).connect(ac.destination);
    noise.start();
    lfo.start();

    // Occasional close drip: sparse filtered clicks from the same noise.
    const drip = ac.createBufferSource();
    drip.buffer = makeNoise(ac, 1.4, 'white');
    drip.loop = true;
    const dripBp = ac.createBiquadFilter();
    dripBp.type = 'bandpass';
    dripBp.frequency.value = 2400;
    dripBp.Q.value = 3.2;
    this.dripGain = ac.createGain();
    this.dripGain.gain.value = 0.0;
    const dripLfo = ac.createOscillator();
    dripLfo.type = 'square';
    dripLfo.frequency.value = 0.7;
    const dripAmp = ac.createGain();
    dripAmp.gain.value = 0.018;
    dripLfo.connect(dripAmp).connect(this.dripGain.gain);
    drip.connect(dripBp).connect(this.dripGain).connect(ac.destination);
    drip.start();
    dripLfo.start();

    const hum = ac.createBufferSource();
    hum.buffer = makeNoise(ac, 3.0, 'brown');
    hum.loop = true;
    const humLp = ac.createBiquadFilter();
    humLp.type = 'lowpass';
    humLp.frequency.value = 180;
    this.humGain = ac.createGain();
    this.humGain.gain.value = 0.04;
    hum.connect(humLp).connect(this.humGain).connect(ac.destination);
    hum.start();

    this.setIntensity(this.intensity);
  }

  setIntensity(k: number): void {
    this.intensity = Math.max(0, Math.min(3, k));
    if (!this.ctx || !this.rainGain) return;
    const t = this.ctx.currentTime;
    const n = Math.min(this.intensity, 1.9) / 1.9;
    this.rainGain.gain.setTargetAtTime(n <= 0 ? 0.0 : 0.06 + 0.28 * n, t, 0.35);
    if (this.dripGain) this.dripGain.gain.setTargetAtTime(n <= 0 ? 0.0 : 0.012 + 0.03 * n, t, 0.4);
    if (this.band) this.band.frequency.setTargetAtTime(1300 + 1100 * n, t, 0.5);
    if (this.humGain) this.humGain.gain.setTargetAtTime(0.025 + 0.03 * n, t, 0.6);
  }
}

function makeNoise(ac: AudioContext, seconds: number, kind: 'white' | 'brown'): AudioBuffer {
  const len = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    if (kind === 'white') data[i] = white;
    else {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
  }
  return buf;
}
