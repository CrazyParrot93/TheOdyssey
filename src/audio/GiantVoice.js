import { G } from '../core/context.js';

// Polyphemus' voice. Everything routes through one chain: source → grit/formants → distance filter
// → HRTF panner → voice bus (+ cave reverb send). Recorded WAV/OGG files dropped into
// assets/voice/ (see README) run through the same chain instead of the synthesized source.
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const rnd = (a, b) => a + Math.random() * (b - a);
// Vowel formants (Hz) for an average adult; scaled down for a giant's vocal tract.
const VOWELS = { a: [800, 1200, 2600], e: [500, 1850, 2500], i: [330, 2200, 2900], o: [520, 860, 2400], u: [360, 780, 2300], y: [330, 2100, 2800] };
const TRACT = 0.6;

export class GiantVoice {
  constructor(audio) {
    this.a = audio;
    this.samples = null;
  }
  get ready() { return !!this.a.ctx; }

  async loadSamples() {
    try {
      const res = await fetch('assets/voice/manifest.json', { cache: 'no-store' });
      if (!res.ok) return;
      const man = await res.json();
      const dec = async (u) => this.a.ctx.decodeAudioData(await (await fetch('assets/voice/' + u)).arrayBuffer());
      this.samples = { roars: await Promise.all((man.roars || []).map(dec)), lines: {} };
      for (const [k, u] of Object.entries(man.lines || {})) this.samples.lines[k] = await dec(u);
    } catch (e) { /* no recorded voice: synthesis is used */ }
  }

  // Distance shaping: far = muffled and echoing, close = dry and enormous.
  chain(pos, { dryBoost = 1 } = {}) {
    const a = this.a;
    const input = a.gain(1);
    const sat = a.ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 1.8) / Math.tanh(1.8); }
    sat.curve = curve;
    const lp = a.filter('lowpass', 16000, 0.5);
    const dist = pos && G.camera ? G.camera.position.distanceTo(pos) : 12;
    lp.frequency.value = 16000 - 14500 * clamp01(dist / 70);
    const out = a.out({ pos, bus: 'voice', ref: 14, rolloff: 0.85, vol: 1.15 * dryBoost });
    input.connect(sat); sat.connect(lp); lp.connect(out);
    const send = a.gain(0.25 + 0.55 * clamp01(dist / 45));
    lp.connect(send); send.connect(a.reverbIn);
    return input;
  }

  // Layered roar. Returns seconds until the explosive attack, so shake/dust/rumble can land on it.
  roar({ pos, intensity = 1, scream = false, dur } = {}) {
    const a = this.a, ctx = a.ctx;
    if (!ctx) return 0;
    const D = dur || (scream ? rnd(4.4, 5.4) : rnd(2.3, 3.4));
    const pitch = (scream ? 1.85 : 1) * rnd(0.86, 1.14);
    const inhale = scream ? 0.25 : rnd(0.55, 0.95), gap = scream ? 0.05 : rnd(0.12, 0.25);
    const t0 = a.now + 0.03, t1 = t0 + inhale + gap, tEnd = t1 + D;
    a.duckFor(inhale + gap + D + 0.8, 0.3, inhale * 0.6);
    const input = this.chain(pos, { dryBoost: scream ? 1.25 : 1 });

    if (this.samples?.roars?.length) {
      const s = ctx.createBufferSource(); s.buffer = this.samples.roars[(Math.random() * this.samples.roars.length) | 0];
      s.playbackRate.value = 0.62 * pitch;
      const g = a.gain(1.3 * intensity); s.connect(g); g.connect(input); s.start(t1);
      this._sub(input, t1, t1 + s.buffer.duration / s.playbackRate.value, 55 * pitch, intensity);
      return t1 - a.now;
    }
    // Air: the inhale before the roar
    { const s = a.src('pink'), f = a.filter('bandpass', 380, 1.3), g = a.gain();
      f.frequency.setValueAtTime(320, t0); f.frequency.linearRampToValueAtTime(1100, t0 + inhale);
      s.connect(f); f.connect(g); g.connect(input);
      g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.45 * intensity, t0 + inhale * 0.85); g.gain.linearRampToValueAtTime(0.0001, t0 + inhale);
      s.start(t0, Math.random()); s.stop(t0 + inhale + 0.05); }
    // Shared VCA: explosive attack, sustained growl, ragged decay
    const env = a.gain(0); env.connect(input);
    const e = env.gain;
    e.setValueAtTime(0.0001, t1); e.linearRampToValueAtTime(1.0 * intensity, t1 + 0.05); e.linearRampToValueAtTime(0.8 * intensity, t1 + 0.3);
    let tt = t1 + D * 0.5;
    e.linearRampToValueAtTime(0.72 * intensity, tt);
    for (let i = 0; i < 6; i++) { tt += D * 0.075; e.linearRampToValueAtTime((0.15 + Math.random() * 0.45) * intensity * (1 - i / 7), tt); }
    e.linearRampToValueAtTime(0.0001, tEnd);
    // Sub layer: felt more than heard
    this._sub(env, t1, tEnd, 58 * (scream ? 0.75 : 1), 1);
    // Body: detuned saws + subharmonic, very low, through a giant-sized formant bank
    const f0 = (scream ? 118 : 64) * pitch;
    const glottis = a.gain(1);
    const wob = a.osc('sine', rnd(4.5, 6.5)), wobG = a.gain(f0 * 0.04); wob.connect(wobG); wob.start(t1); wob.stop(tEnd + 0.2);
    const oscs = [['sawtooth', 1, -9, 0.5], ['sawtooth', 1, 8, 0.5], ['square', 0.5, 0, 0.28]].map(([type, mul, det, v]) => {
      const o = a.osc(type, f0 * mul); o.detune.value = det; wobG.connect(o.frequency);
      const g = a.gain(v); o.connect(g); g.connect(glottis);
      const f = o.frequency;
      f.setValueAtTime(f0 * mul * 0.82, t1); f.linearRampToValueAtTime(f0 * mul * 1.15, t1 + D * 0.22); f.linearRampToValueAtTime(f0 * mul * 0.72, tEnd);
      if (scream) for (let i = 0; i < 9; i++) { const tc = t1 + D * (0.15 + Math.random() * 0.7); f.setValueAtTime(f0 * mul * rnd(0.75, 1.45), tc); }
      o.start(t1); o.stop(tEnd + 0.2);
      return o;
    });
    void oscs;
    { const s = a.src('brown'), g = a.gain(0.6); s.connect(g); g.connect(glottis); s.start(t1, Math.random()); s.stop(tEnd + 0.2); }
    const AH = VOWELS.a, OH = VOWELS.o;
    [0, 1, 2].forEach((k) => {
      const bp = a.filter('bandpass', AH[k] * TRACT, [5, 7, 9][k]);
      bp.frequency.setValueAtTime(AH[k] * TRACT * (scream ? 1.25 : 1), t1);
      bp.frequency.linearRampToValueAtTime(OH[k] * TRACT * (scream ? 1.2 : 1), tEnd);
      const g = a.gain([1.6, 1.0, 0.45][k]);
      glottis.connect(bp); bp.connect(g); g.connect(env);
    });
    // Grit: distorted noise ring-modulated at 20–40 Hz for a wet, throaty growl
    { const s = a.src('white'), sh = ctx.createWaveShaper(), c = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; c[i] = Math.tanh(x * 7); }
      sh.curve = c;
      const ring = a.gain(0), lfo = a.osc('sine', rnd(22, 38)); lfo.connect(ring.gain); lfo.start(t1); lfo.stop(tEnd + 0.2);
      const bp = a.filter('bandpass', 520, 0.8), g = a.gain(scream ? 0.55 : 0.42);
      s.connect(sh); sh.connect(ring); ring.connect(bp); bp.connect(g); g.connect(env);
      glottis.connect(ring);
      s.start(t1, Math.random()); s.stop(tEnd + 0.2); }
    // Wet breath tail
    { const s = a.src('pink'), f = a.filter('lowpass', 900), g = a.gain();
      s.connect(f); f.connect(g); g.connect(input);
      g.gain.setValueAtTime(0.0001, tEnd - 0.25); g.gain.linearRampToValueAtTime(0.3 * intensity, tEnd); g.gain.exponentialRampToValueAtTime(0.0001, tEnd + 1.1);
      s.start(tEnd - 0.25, Math.random()); s.stop(tEnd + 1.2); }
    return t1 - a.now;
  }

  _sub(dest, t1, tEnd, f, k) {
    const a = this.a, o = a.osc('sine', f), tri = a.osc('triangle', f * 0.5), g = a.gain();
    o.frequency.setValueAtTime(f, t1); o.frequency.exponentialRampToValueAtTime(Math.max(28, f * 0.55), tEnd);
    tri.frequency.setValueAtTime(f * 0.5, t1); tri.frequency.exponentialRampToValueAtTime(26, tEnd);
    o.connect(g); tri.connect(g); g.connect(dest);
    g.gain.setValueAtTime(0.0001, t1); g.gain.linearRampToValueAtTime(1.1 * k, t1 + 0.08); g.gain.linearRampToValueAtTime(0.0001, tEnd + 0.3);
    o.start(t1); tri.start(t1); o.stop(tEnd + 0.4); tri.stop(tEnd + 0.4);
  }

  // Slow, deliberate formant speech, an octave and more below a man, with a detuned double voice.
  speak(text, { pos } = {}) {
    const a = this.a, ctx = a.ctx;
    if (!ctx) return 0;
    if (this.samples?.lines?.[text]) {
      const s = ctx.createBufferSource(); s.buffer = this.samples.lines[text]; s.playbackRate.value = 0.7;
      const input = this.chain(pos); s.connect(input); s.start();
      const d = s.buffer.duration / 0.7; a.duckFor(d + 0.4, 0.35, 0.2); return d;
    }
    const tokens = text.match(/[a-zA-Z']+|[.,!?;:…—-]/g) || [];
    const plan = [];
    for (const tk of tokens) {
      if (/^[.,!?;:…—-]$/.test(tk)) { plan.push({ pause: /[.!?…]/.test(tk) ? 0.38 : 0.2 }); continue; }
      const syls = tk.toLowerCase().match(/[^aeiouy]*[aeiouy]+[^aeiouy]*/g) || [tk.toLowerCase()];
      syls.forEach((s, i) => plan.push({ syl: s, dur: rnd(0.17, 0.26) * (i === syls.length - 1 ? 1.25 : 1) }));
      plan.push({ pause: 0.06 });
    }
    const total = plan.reduce((n, p) => n + (p.pause || p.dur), 0);
    const t0 = a.now + 0.08, tEnd = t0 + total;
    a.duckFor(total + 0.6, 0.32, 0.15);
    const input = this.chain(pos);
    const shout = /[!]|[A-Z]{3,}/.test(text);
    const f0 = (shout ? 92 : 70) * rnd(0.95, 1.05);
    // Glottal source: two detuned saws + subharmonic, through three formant filters automated per syllable.
    const glottis = a.gain(1), vca = a.gain(0);
    const oscs = [[1, -14, 0.5], [1.004, 12, 0.45], [0.5, 0, 0.3]].map(([m, det, v]) => {
      const o = a.osc(m === 0.5 ? 'square' : 'sawtooth', f0 * m); o.detune.value = det;
      const g = a.gain(v); o.connect(g); g.connect(glottis); o.start(t0); o.stop(tEnd + 0.3);
      o.frequency.setValueAtTime(f0 * m * 1.08, t0); o.frequency.linearRampToValueAtTime(f0 * m * 0.82, tEnd);
      return o;
    });
    void oscs;
    const forms = [0, 1, 2].map((k) => { const bp = a.filter('bandpass', 500, [6, 8, 10][k]); const g = a.gain([1.7, 0.9, 0.35][k]); glottis.connect(bp); bp.connect(g); g.connect(vca); return bp; });
    vca.connect(input);
    // a little ring-mod grit on the voice
    { const ring = a.gain(0), lfo = a.osc('sine', 31); lfo.connect(ring.gain); lfo.start(t0); lfo.stop(tEnd + 0.3); const g = a.gain(0.18); glottis.connect(ring); ring.connect(g); g.connect(vca); }
    this._sub(vca, t0, tEnd, 46, 0.6);
    let t = t0;
    for (const p of plan) {
      if (p.pause) { vca.gain.setTargetAtTime(0.0001, t, 0.03); t += p.pause; continue; }
      const v = (p.syl.match(/[aeiouy]/) || ['a'])[0];
      const F = VOWELS[v] || VOWELS.a;
      forms.forEach((bp, k) => bp.frequency.setTargetAtTime(F[k] * TRACT, t, 0.03));
      const onset = p.syl[0];
      if (/[sfzhx]|sh|th/.test(onset)) this._noise(input, t, 0.09, 4200, 2, 0.35);
      else if (/[ptkbdgcq]/.test(onset)) { this._noise(input, t, 0.03, 1600, 1.2, 0.55); vca.gain.setValueAtTime(0.0001, t); }
      const att = /[mnl]/.test(onset) ? 0.06 : 0.025;
      vca.gain.setTargetAtTime(shout ? 1.15 : 0.9, t + 0.02, att);
      vca.gain.setTargetAtTime(0.35, t + p.dur * 0.7, 0.04);
      t += p.dur;
    }
    vca.gain.setTargetAtTime(0.0001, t, 0.08);
    return total;
  }

  _noise(dest, t, d, f, q, v) {
    const a = this.a, s = a.src('white'), bp = a.filter('bandpass', f, q), g = a.gain();
    s.connect(bp); bp.connect(g); g.connect(dest);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    s.start(t, Math.random()); s.stop(t + d + 0.02);
  }

  // Chest-heaving breath; louder and drier as he nears the listener.
  breath(pos, lying = false) {
    const a = this.a; if (!a.ctx) return;
    const input = this.chain(pos);
    const t = a.now + 0.02, inT = lying ? 1.3 : 0.9, outT = lying ? 1.6 : 1.1;
    for (const [start, len, f0, f1, v] of [[0, inT, 300, 700, 0.35], [inT + 0.15, outT, 650, 260, 0.5]]) {
      const s = a.src('pink'), bp = a.filter('bandpass', f0, 1.4), g = a.gain();
      bp.frequency.setValueAtTime(f0, t + start); bp.frequency.linearRampToValueAtTime(f1, t + start + len);
      s.connect(bp); bp.connect(g); g.connect(input);
      g.gain.setValueAtTime(0.0001, t + start); g.gain.linearRampToValueAtTime(v, t + start + len * 0.4); g.gain.linearRampToValueAtTime(0.0001, t + start + len);
      s.start(t + start, Math.random()); s.stop(t + start + len + 0.05);
    }
  }
}
