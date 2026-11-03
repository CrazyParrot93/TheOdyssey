import { G } from '../core/context.js';

// Adaptive modal score. Layers (drone, pad, choir, lyre, pulse, drums, shimmer) crossfade by mood;
// stingers fire immediately so they land on the exact frame of a decisive input.
const MODES = {
  dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], aeolian: [0, 2, 3, 5, 7, 8, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10],
};
const MOODS = {
  silence:   { bpm: 60 },
  title:     { bpm: 58, drone: 0.4, pad: 0.35, lyre: 0.6, melody: 'theme', choir: 0.12, mode: 'dorian' },
  sea:       { bpm: 64, drone: 0.32, pad: 0.3, lyre: 0.42, melody: 'wander', mode: 'dorian' },
  explore:   { bpm: 64, drone: 0.38, pad: 0.24, lyre: 0.36, melody: 'sparse', mode: 'dorian' },
  tension:   { bpm: 58, drone: 0.5, pad: 0.16, lyre: 0.2, melody: 'low', pulse: 0.35, mode: 'phrygian' },
  stealth:   { bpm: 54, drone: 0.42, pad: 0.1, lyre: 0.14, melody: 'low', pulse: 0.22, shimmer: 0.22, mode: 'phrygian' },
  combat:    { bpm: 104, drone: 0.4, pad: 0.28, lyre: 0.45, melody: 'ostinato', drums: 0.85, pulse: 0.45, meter: 7, mode: 'phrygian' },
  climax:    { bpm: 92, drone: 0.55, pad: 0.45, lyre: 0.5, melody: 'ostinato', drums: 1, pulse: 0.55, choir: 0.8, meter: 7, mode: 'phrygian' },
  dread:     { bpm: 48, drone: 0.65, choir: 0.4, drums: 0.35, melody: 'none', mode: 'phrygian', slowDrum: true },
  afterglow: { bpm: 56, drone: 0.26, pad: 0.45, lyre: 0.55, melody: 'theme', choir: 0.22, mode: 'dorian' },
};
// The "Home" motif (scale degree, length in eighths). Setup at the title, payoff at Ithaca.
const THEME = [[4, 2], [3, 1], [2, 1], [3, 2], [0, 2], [1, 1], [2, 1], [3, 2], [4, 3], [null, 1], [6, 2], [5, 1], [4, 1], [3, 2], [2, 2], [1, 2], [2, 2], [0, 4], [null, 4]];
const PROGRESSION = [0, 6, 3, 0, 5, 3, 6, 0];

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  constructor(audio) { this.a = audio; this.ready = false; this.mood = 'silence'; this.root = 50; this.modeName = 'dorian'; this.heartBpm = 0; }

  init() {
    const a = this.a;
    if (!a.ctx || this.ready) return;
    const ctx = a.ctx;
    this.out = a.gain(1); this.out.connect(a.bus.music);
    this.rev = a.gain(0.45); this.rev.connect(a.reverbIn);
    this.layers = {};
    for (const k of ['drone', 'pad', 'choir', 'lyre', 'pulse', 'drums', 'shimmer', 'stinger']) {
      const g = a.gain(k === 'stinger' ? 1 : 0); g.connect(this.out);
      if (k !== 'drums' && k !== 'pulse') g.connect(this.rev);
      this.layers[k] = g;
    }
    // Continuous drone: saw + sub through a breathing lowpass
    this.droneF = a.filter('lowpass', 260, 1.5);
    const lfo = a.osc('sine', 0.08), lg = a.gain(120); lfo.connect(lg); lg.connect(this.droneF.frequency); lfo.start();
    this.droneOsc = [];
    for (const [mul, type, v] of [[0.5, 'sawtooth', 0.22], [0.5 * 1.004, 'sawtooth', 0.18], [0.75, 'triangle', 0.25], [0.25, 'sine', 0.5]]) {
      const o = a.osc(type, mtof(this.root) * mul), g = a.gain(v); o.connect(g); g.connect(this.droneF); o.start(); this.droneOsc.push({ o, mul });
    }
    this.droneF.connect(this.layers.drone);
    this.lyreCache = new Map();
    this.step = 0; this.bar = 0; this.next = ctx.currentTime + 0.1; this.themeIdx = 0; this.themeWait = 0; this.heartNext = 0;
    this.ready = true;
    this.setMood(this.mood, 0.1);
  }

  setKey(root, mode) {
    this.root = root; this.modeName = mode || this.modeName;
    if (!this.ready) return;
    for (const d of this.droneOsc) d.o.frequency.setTargetAtTime(mtof(root) * d.mul, this.a.now, 1.5);
  }

  setMood(name, fade = 3) {
    const m = MOODS[name];
    if (!m) return;
    this.mood = name;
    this.cfg = m;
    if (m.mode) this.modeName = m.mode;
    if (!this.ready) return;
    const t = this.a.now;
    for (const k of ['drone', 'pad', 'choir', 'lyre', 'pulse', 'drums', 'shimmer']) this.layers[k].gain.setTargetAtTime(m[k] || 0, t, Math.max(0.05, fade / 3));
    if (name === 'silence' || name === 'dread') this.themeIdx = 0;
  }

  setHeartbeat(bpm) { this.heartBpm = bpm; }

  degree(d, octave = 0) {
    const sc = MODES[this.modeName] || MODES.dorian;
    const n = sc.length, o = Math.floor(d / n), i = ((d % n) + n) % n;
    return this.root + sc[i] + 12 * (o + octave);
  }

  // Karplus-Strong lyre string, rendered once per pitch.
  lyreBuffer(midi) {
    if (this.lyreCache.has(midi)) return this.lyreCache.get(midi);
    const ctx = this.a.ctx, sr = ctx.sampleRate, len = Math.floor(sr * 2.6), buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
    const period = Math.max(2, Math.round(sr / mtof(midi)));
    const ring = new Float32Array(period);
    for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;
    let idx = 0, prev = 0;
    const decay = 0.996 - Math.max(0, midi - 60) * 0.0004;
    for (let i = 0; i < len; i++) {
      const cur = ring[idx];
      const nxt = ring[(idx + 1) % period];
      ring[idx] = (cur + nxt) * 0.5 * decay;
      prev = prev * 0.3 + cur * 0.7;
      d[i] = prev * 0.6;
      idx = (idx + 1) % period;
    }
    this.lyreCache.set(midi, buf);
    return buf;
  }
  lyre(midi, t, vol = 0.5, dest = this.layers.lyre) {
    const s = this.a.ctx.createBufferSource(); s.buffer = this.lyreBuffer(midi);
    const g = this.a.gain(vol); s.connect(g); g.connect(dest); s.start(t); s.stop(t + 2.6);
  }
  padChord(degrees, t, dur, dest, vowel = false, vol = 0.12) {
    const a = this.a;
    for (const d of degrees) {
      const f = mtof(this.degree(d, vowel ? 0 : -1));
      const g = a.gain(), lp = a.filter('lowpass', vowel ? 2400 : 900, 0.7);
      lp.connect(g); g.connect(dest);
      let feed = (o) => o.connect(lp);
      if (vowel) {
        const f1 = a.filter('bandpass', 730, 4), f2 = a.filter('bandpass', 1090, 5), mg = a.gain(1.6);
        f1.connect(mg); f2.connect(mg); mg.connect(lp);
        feed = (o) => { o.connect(f1); o.connect(f2); };
      }
      for (const det of [-7, 6]) {
        const o = a.osc('sawtooth', f); o.detune.value = det + (Math.random() - 0.5) * 4;
        if (vowel) { const vib = a.osc('sine', 4.8 + Math.random()), vg = a.gain(f * 0.006); vib.connect(vg); vg.connect(o.frequency); vib.start(t); vib.stop(t + dur + 3); }
        feed(o); o.start(t); o.stop(t + dur + 3);
      }
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + Math.min(1.8, dur * 0.4)); g.gain.setValueAtTime(vol, t + dur); g.gain.linearRampToValueAtTime(0.0001, t + dur + 2.8);
    }
  }
  drum(t, low = true, vol = 1, dest = this.layers.drums) {
    const a = this.a;
    const o = a.osc('sine', low ? 95 : 190), g = a.gain(); o.frequency.exponentialRampToValueAtTime(low ? 48 : 120, t + 0.3);
    o.connect(g); g.connect(dest); a.env(g, t, 0.003, (low ? 0.9 : 0.4) * vol, low ? 0.45 : 0.15); o.start(t); o.stop(t + 0.6);
    const s = a.src('white'), f = a.filter('bandpass', low ? 600 : 1800, 1.2), sg = a.gain(); s.connect(f); f.connect(sg); sg.connect(dest);
    a.env(sg, t, 0.001, (low ? 0.25 : 0.4) * vol, low ? 0.08 : 0.05); s.start(t, Math.random()); s.stop(t + 0.15);
  }
  pulse(t, vol = 0.5, dur = 0.3) {
    const a = this.a, o = a.osc('triangle', mtof(this.root - 12)), f = a.filter('lowpass', 300), g = a.gain();
    o.connect(f); f.connect(g); g.connect(this.layers.pulse); a.env(g, t, 0.01, vol, dur); o.start(t); o.stop(t + dur + 0.1);
  }

  _schedule(step, t, stepDur) {
    const m = this.cfg, meter = m.meter || 8;
    const s = step % meter;
    if (s === 0) this.bar++;
    // Pads and choir: one chord every two bars
    if (s === 0 && this.bar % 2 === 0 && ((m.pad || 0) > 0 || (m.choir || 0) > 0)) {
      const deg = PROGRESSION[(this.bar / 2) % PROGRESSION.length];
      const chord = [deg, deg + 2, deg + 4];
      const dur = stepDur * meter * 2;
      if (m.pad) this.padChord(chord, t, dur, this.layers.pad, false, 0.1);
      if (m.choir) this.padChord(chord.map((d) => d + 7), t, dur, this.layers.choir, true, 0.07);
    }
    // Pulse
    if (m.pulse) {
      if (meter === 7) { if (s === 0 || s === 3 || s === 5) this.pulse(t, 0.6, stepDur * 1.5); else this.pulse(t, 0.2, stepDur * 0.8); }
      else if (s % 4 === 0) { this.pulse(t, 0.7, 0.25); this.pulse(t + stepDur * 0.6, 0.45, 0.2); }
    }
    // Frame drums: aksak 7/8 (3+2+2)
    if (m.drums) {
      if (m.slowDrum) { if (s === 0 && this.bar % 2 === 0) this.drum(t, true, 1.2); }
      else if (meter === 7) { if (s === 0) this.drum(t, true, 1); else if (s === 3 || s === 5) this.drum(t, false, 0.9); else if (Math.random() < 0.35) this.drum(t, false, 0.35); }
      else { if (s === 0 || s === 4) this.drum(t, true); else if (s === 2 || s === 6) this.drum(t, false, 0.7); }
    }
    // Melody
    const mel = m.melody;
    if (mel === 'theme' && m.lyre) {
      if (this.themeWait > 0) this.themeWait--;
      else {
        const [d, len] = THEME[this.themeIdx % THEME.length];
        if (d !== null) this.lyre(this.degree(d, 1), t, 0.55);
        if (d !== null && Math.random() < 0.3) this.lyre(this.degree(d - 7, 1), t + 0.01, 0.25);
        this.themeWait = len - 1;
        this.themeIdx++;
        if (this.themeIdx % THEME.length === 0) this.themeWait += 8;
      }
    } else if (mel === 'wander' || mel === 'sparse' || mel === 'low') {
      const p = mel === 'wander' ? 0.4 : mel === 'sparse' ? 0.22 : 0.14;
      if (Math.random() < p) {
        this.walk = Math.max(-3, Math.min(9, (this.walk || 2) + [-2, -1, -1, 1, 1, 2, 0][(Math.random() * 7) | 0]));
        this.lyre(this.degree(this.walk, mel === 'low' ? 0 : 1), t, mel === 'low' ? 0.4 : 0.5);
      }
    } else if (mel === 'ostinato') {
      const pat = meter === 7 ? [0, 2, 4, 1, 3, 2, 4] : [0, 2, 4, 2, 0, 2, 5, 2];
      const chordDeg = PROGRESSION[(Math.floor(this.bar / 2)) % PROGRESSION.length];
      this.lyre(this.degree(chordDeg + pat[s % pat.length], 0), t, s === 0 ? 0.5 : 0.32);
    }
    if (m.shimmer && Math.random() < 0.12) this.lyre(this.degree(7 + ((Math.random() * 7) | 0), 2), t, 0.18, this.layers.shimmer);
  }

  stinger(name) {
    if (!this.ready) return;
    const a = this.a, t = a.now + 0.005, dest = this.layers.stinger;
    if (name === 'impact') {
      this.drum(t, true, 2.2, dest); this.drum(t + 0.002, false, 1.2, dest);
      this.padChord([0, 1, 4, 7], t, 1.5, dest, true, 0.16);
      a.play('impact', { size: 1.4, bus: 'music' });
    } else if (name === 'roar') {
      this.padChord([0, 4, 7, 9], t, 3, dest, true, 0.2);
      for (let i = 0; i < 6; i++) this.drum(t + i * 0.11, i % 2 === 0, 1.3 - i * 0.12, dest);
    } else if (name === 'discover') {
      [0, 2, 4, 7].forEach((d, i) => this.lyre(this.degree(d, 1), t + i * 0.09, 0.5, dest));
    } else if (name === 'loss') {
      [4, 3, 1, 0].forEach((d, i) => this.lyre(this.degree(d, 0), t + i * 0.42, 0.55, dest));
      this.padChord([0, 2, 4], t, 2.5, dest, false, 0.08);
    } else if (name === 'triumph') {
      this.padChord([0, 2, 4, 7], t, 3, dest, true, 0.2);
      for (let i = 0; i < 8; i++) this.drum(t + i * 0.07, i === 0, 0.5 + i * 0.08, dest);
    } else if (name === 'dread') {
      this.padChord([0, 1, 3], t, 4, dest, true, 0.12);
      this.drum(t, true, 1.6, dest);
    } else if (name === 'nobody') {
      this.padChord([0, 4, 9], t, 3, dest, true, 0.12);
      this.lyre(this.degree(4, 1), t, 0.5, dest); this.lyre(this.degree(0, 1), t + 0.6, 0.5, dest);
    } else if (name === 'tick') {
      this.lyre(this.degree(7, 1), t, 0.35, dest);
    }
  }

  // Scheduled from its own 25 ms timer as well as the frame loop, with a 0.3 s lookahead, so a slow
  // frame or a shader compile never starves it. If it does fall behind, the missed steps are skipped
  // instead of all firing at once (that burst was the audible "lag").
  update() {
    if (!this.ready) return;
    if (!this._timer) this._timer = setInterval(() => this.update(), 25);
    const ctx = this.a.ctx;
    const stepDur = 60 / (this.cfg.bpm || 60) / 2;
    if (this.next < ctx.currentTime - stepDur) { const skip = Math.ceil((ctx.currentTime - this.next) / stepDur); this.step += skip; this.next += skip * stepDur; }
    while (this.next < ctx.currentTime + 0.3) {
      if (this.mood !== 'silence') this._schedule(this.step, this.next, stepDur);
      this.step++;
      this.next += stepDur;
    }
    if (this.heartBpm > 0) {
      if (this.heartNext < ctx.currentTime) this.heartNext = ctx.currentTime + 0.05;
      while (this.heartNext < ctx.currentTime + 0.3) {
        this.a.play('heartbeat', { bus: 'music', vol: 1.2, at: this.heartNext });
        this.heartNext += 60 / this.heartBpm;
      }
    }
  }
}
