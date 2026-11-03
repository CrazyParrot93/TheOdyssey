import * as THREE from 'three';
import { G } from '../core/context.js';
import { GiantVoice } from './GiantVoice.js';

// Fully synthesized audio: buses, ducking, reverb, HRTF spatialization, procedural ambience and SFX.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.amb = {};
    this.ambTarget = {};
    this.timers = { crackle: 0, drip: 0, gull: 3 };
    this.duckLevel = 1;
    this.duckTarget = 1;
    this.listener = { x: 0, y: 0, z: 0 };
    this.voices = {};
    this._vol = {};
  }

  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    // iPhone/iPad: Web Audio counts as "ambient" sound, which the ring/silent switch mutes. Asking for the
    // playback category (Safari 17+) makes it behave like a video or music app.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* not supported */ }
    // 'balanced' latency gives the audio thread a larger buffer, so heavy moments don't crackle or drop out.
    let ctx;
    try { ctx = new AC({ latencyHint: 'balanced' }); } catch { ctx = new AC(); }
    this.ctx = ctx;
    this._unlock();
    this.master = ctx.createGain();
    this.muffle = ctx.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000; this.muffle.Q.value = 0.5;
    this.comp = ctx.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 4; this.comp.attack.value = 0.005; this.comp.release.value = 0.2;
    // Safety: glue compressor → brickwall limiter → soft clipper, so nothing ever clips or spikes.
    this.limiter = ctx.createDynamicsCompressor(); this.limiter.threshold.value = -3; this.limiter.knee.value = 0; this.limiter.ratio.value = 20; this.limiter.attack.value = 0.001; this.limiter.release.value = 0.08;
    this.clipper = ctx.createWaveShaper(); { const c = new Float32Array(2048); for (let i = 0; i < 2048; i++) { const x = i / 1024 - 1; c[i] = Math.tanh(x * 1.2) / Math.tanh(1.2); } this.clipper.curve = c; }
    this.master.connect(this.muffle); this.muffle.connect(this.comp); this.comp.connect(this.limiter); this.limiter.connect(this.clipper); this.clipper.connect(ctx.destination);
    this.bus = {};
    for (const k of ['music', 'sfx', 'amb', 'voice']) { this.bus[k] = ctx.createGain(); this.bus[k].connect(this.master); }
    // Reverb send
    this.reverb = ctx.createConvolver();
    this.irOpen = this._impulse(2.8, 2.2);
    this.irCave = this._caveImpulse();
    this.reverb.buffer = this.irOpen;
    this.reverbOut = ctx.createGain(); this.reverbOut.gain.value = 0.35;
    this.reverb.connect(this.reverbOut); this.reverbOut.connect(this.master);
    this.reverbIn = ctx.createGain(); this.reverbIn.connect(this.reverb);
    // Noise sources
    this.noise = { white: this._noiseBuf('white'), pink: this._noiseBuf('pink'), brown: this._noiseBuf('brown') };
    this.giant = new GiantVoice(this);
    this.giant.loadSamples();
    this._startAmbience();
    this.applyVolumes();
    if (this._pendingAmb) this.setAmbience(this._pendingAmb, 1);
  }

  // Mobile Safari only lets audio start inside a user gesture, and suspends ("interrupted") the context when
  // the page is backgrounded or a call comes in. Prime it now (we are inside the first tap), keep a silent
  // looping <audio> element playing (older iOS: switches the session to playback, so the silent switch doesn't
  // mute the game), and resume on every later tap, key or return to the page.
  _unlock() {
    const ctx = this.ctx;
    const prime = () => {
      if (ctx.state !== 'running') ctx.resume?.().catch(() => {});
      try { const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch { /* closed */ }
      if (this._silent && this._silent.paused) this._silent.play().catch(() => {});
    };
    if (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
      const sr = 8000, n = 800, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
      const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
      w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
      const a = (this._silent = document.createElement('audio'));
      a.src = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })); a.loop = true; a.setAttribute('playsinline', ''); a.preload = 'auto';
    }
    prime();
    for (const ev of ['touchend', 'pointerdown', 'keydown', 'click']) addEventListener(ev, prime, { passive: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) prime(); });
    ctx.addEventListener?.('statechange', () => { if (ctx.state === 'interrupted') this._wasInterrupted = true; });
  }

  get ready() { return !!this.ctx; }
  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  applyVolumes() {
    if (!this.ctx) return;
    const s = G.settings, t = this.now;
    const set = (key, param, v) => { if (Math.abs((this._vol[key] ?? -1) - v) < 0.002) return; this._vol[key] = v; param.cancelScheduledValues(t); param.setTargetAtTime(v, t, 0.03); };
    set('master', this.master.gain, s.masterVol);
    set('music', this.bus.music.gain, s.musicVol * this.duckLevel);
    set('sfx', this.bus.sfx.gain, s.sfxVol);
    set('amb', this.bus.amb.gain, s.ambVol * (0.5 + 0.5 * this.duckLevel));
    set('voice', this.bus.voice.gain, s.voiceVol);
  }

  duck(on) { this.duckBase = on ? 0.45 : 1; }
  // Timed duck under the giant's voice: near-silence first (pre), then ~-10 dB for the rest.
  duckFor(seconds, level = 0.32, pre = 0) { this.duckTimedT = Math.max(this.duckTimedT || 0, seconds); this.duckTimed = level; this.duckPreT = pre; }
  setReverbType(type) { if (!this.ctx) return; const b = type === 'cave' ? this.irCave : this.irOpen; if (this.reverb.buffer !== b) this.reverb.buffer = b; }
  giantRoar(o = {}) { return this.giant ? this.giant.roar({ pos: G.giantVoicePos, ...o }) : 0; }
  giantSpeak(text) { return this.giant ? this.giant.speak(text, { pos: G.giantVoicePos }) : 0; }
  giantBreath(pos, lying) { this.giant?.breath(pos, lying); }
  // Long dark cave: discrete early reflections off rock, then a low-passed, slowly decaying tail.
  _caveImpulse() {
    const ctx = this.ctx, sr = ctx.sampleRate, len = Math.floor(sr * 4.2), buf = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let k = 0; k < 14; k++) { const i = Math.floor(sr * (0.012 + Math.random() * 0.09)); d[i] += (Math.random() < 0.5 ? -1 : 1) * (0.9 - k * 0.05); }
      let lp = 0;
      for (let i = Math.floor(sr * 0.03); i < len; i++) {
        const t = i / sr, cut = 0.35 * Math.exp(-t * 0.9) + 0.03;
        lp += ((Math.random() * 2 - 1) - lp) * cut;
        d[i] += lp * Math.exp(-t / 1.15) * 1.6;
      }
    }
    return buf;
  }
  setReverb(wet) { if (this.ctx) this.reverbOut.gain.setTargetAtTime(wet, this.now, 0.5); }

  // Muffle the whole mix (shock after a huge impact), then recover.
  shock(seconds = 1.5, freq = 280) {
    if (!this.ctx) return;
    const t = this.now, f = this.muffle.frequency;
    f.cancelScheduledValues(t); f.setValueAtTime(freq, t); f.setValueAtTime(freq, t + seconds * 0.6); f.exponentialRampToValueAtTime(20000, t + seconds);
  }
  silenceAll(seconds = 1.5, restore = 1.2) {
    if (!this.ctx) return;
    const t = this.now, g = this.master.gain, v = G.settings.masterVol;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0.0001, t + 0.05);
    g.setValueAtTime(0.0001, t + seconds); g.linearRampToValueAtTime(v, t + seconds + restore);
    this._vol.master = v;
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx, len = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return buf;
  }
  _noiseBuf(type) {
    const ctx = this.ctx, len = ctx.sampleRate * 3, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (type === 'white') d[i] = w;
      else if (type === 'pink') { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18; }
      else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    }
    return buf;
  }
  src(type = 'white', loop = false) { const s = this.ctx.createBufferSource(); s.buffer = this.noise[type]; s.loop = loop; return s; }
  osc(type, freq) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = freq; return o; }
  gain(v = 0) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  filter(type, freq, q = 1) { const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f; }
  env(g, t, a, peak, d, curve = 'exp') {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    else g.gain.linearRampToValueAtTime(0.0001, t + a + d);
  }

  // ---------- ambience ----------
  _startAmbience() {
    const ctx = this.ctx;
    const layer = (name, srcType, filters, lfo) => {
      const s = this.src(srcType, true);
      let node = s;
      for (const f of filters) { node.connect(f); node = f; }
      // The level gain is the only thing setAmbience drives. A swell LFO modulates a separate unity gain
      // before it, so a layer set to 0 is truly silent (an LFO summed into the level itself kept the sea
      // audible everywhere, even in the cave).
      const swell = this.gain(1), g = this.gain(0);
      node.connect(swell); swell.connect(g); g.connect(this.bus.amb);
      if (lfo) {
        const o = this.osc('sine', lfo.rate), og = this.gain(lfo.depth);
        o.connect(og); og.connect(lfo.param(filters, swell)); o.start();
      }
      s.start(0, Math.random() * 2);
      this.amb[name] = g; this.ambTarget[name] = 0;
    };
    layer('waves', 'brown', [this.filter('lowpass', 520, 0.6)], { rate: 0.11, depth: 0.35, param: (f, g) => g.gain });
    layer('surf', 'white', [this.filter('bandpass', 1800, 0.5), this.filter('lowpass', 4000)], { rate: 0.13, depth: 0.25, param: (f, g) => g.gain });
    layer('wind', 'pink', [this.filter('bandpass', 650, 0.9)], { rate: 0.07, depth: 380, param: (f) => f[0].frequency });
    layer('fire', 'brown', [this.filter('lowpass', 260, 0.8)], null);
    layer('cave', 'brown', [this.filter('lowpass', 110, 0.7)], null);
    layer('rain', 'white', [this.filter('highpass', 900), this.filter('lowpass', 7000)], null);
    layer('storm', 'brown', [this.filter('lowpass', 180, 1.2)], { rate: 0.19, depth: 0.4, param: (f, g) => g.gain });
    this.ambMix = { waves: 0, surf: 0, wind: 0, fire: 0, cave: 0, rain: 0, storm: 0, drips: 0, crackle: 0, gulls: 0 };
    void ctx;
  }

  setAmbience(mix, fade = 2) {
    if (!this.ctx) { this._pendingAmb = mix; return; }
    const levels = { waves: 0.55, surf: 0.18, wind: 0.22, fire: 0.5, cave: 0.6, rain: 0.25, storm: 0.6 };
    for (const k of Object.keys(this.amb)) {
      const v = (mix[k] || 0) * (levels[k] || 0.5);
      this.amb[k].gain.setTargetAtTime(v, this.now, fade / 3);
    }
    // A mix is complete: anything it leaves out is silent (merging kept beach gulls crying inside the cave).
    this.ambMix = { waves: 0, surf: 0, wind: 0, fire: 0, cave: 0, rain: 0, storm: 0, drips: 0, crackle: 0, gulls: 0, ...mix };
  }

  // ---------- positional playback ----------
  // One-shot output chain. Equal-power panning by default: HRTF is far heavier on the audio thread and,
  // with dozens of crackles, steps and drips a second, it was what made the mix stutter. Only the sounds
  // that ask for it (o.hrtf) get HRTF. Every chain is disconnected once its sound has died away.
  out(o = {}) {
    const bus = this.bus[o.bus || 'sfx'];
    let dest = bus, p = null, r = null;
    if (o.pos) {
      p = this.ctx.createPanner();
      p.panningModel = o.hrtf ? 'HRTF' : 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = o.ref || 4; p.maxDistance = 500; p.rolloffFactor = o.rolloff || 1.1;
      if (p.positionX) { p.positionX.value = o.pos.x; p.positionY.value = o.pos.y; p.positionZ.value = o.pos.z; } else p.setPosition(o.pos.x, o.pos.y, o.pos.z);
      p.connect(bus); dest = p;
    }
    const g = this.gain(o.vol ?? 1);
    g.connect(dest);
    if (o.reverb) { r = this.gain(o.reverb); g.connect(r); r.connect(this.reverbIn); }
    setTimeout(() => { try { g.disconnect(); p?.disconnect(); r?.disconnect(); } catch { /* already gone */ } }, (o.life ?? 8) * 1000);
    return g;
  }

  // Voice limiting: the same sound can't stack up faster than its minimum gap, or past a few at once.
  _allow(name) {
    const now = this.ctx.currentTime, L = LIMITS[name] || LIMITS.default, v = (this.voices[name] ||= []);
    while (v.length && v[0] < now - L.window) v.shift();
    if (v.length >= L.max || (v.length && now - v[v.length - 1] < L.gap)) return false;
    v.push(now);
    return true;
  }

  play(name, o = {}) {
    if (!this.ctx) return;
    if (this.ctx.state !== 'running') { this.ctx.resume().catch(() => {}); return; }
    const fn = SFX[name];
    if (!fn || !this._allow(name)) return;
    const t = Math.max(this.now, o.at ?? 0);
    try { fn(this, this.out(o), t, o); } catch (e) { console.warn('sfx', name, e); }
  }

  updateListener(cam) {
    if (!this.ctx) return;
    const l = this.ctx.listener, p = cam.position;
    const f = cam.getWorldDirection(_dir);
    // Plain value writes: scheduling six setTargetAtTime events a frame, never cleared, grew the audio
    // thread's automation timeline without bound and made the whole mix stutter over time.
    if (l.positionX) {
      l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z;
      l.forwardX.value = f.x; l.forwardY.value = f.y; l.forwardZ.value = f.z;
      if (!this._upSet) { l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0; this._upSet = true; }
    } else { l.setPosition(p.x, p.y, p.z); l.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
  }

  update(dt) {
    if (!this.ctx) return;
    if (this.duckTimedT > 0) { this.duckTimedT -= dt; this.duckPreT -= dt; }
    const timed = this.duckTimedT > 0 ? (this.duckPreT > 0 ? 0.06 : this.duckTimed) : 1;
    this.duckTarget = Math.min(this.duckBase ?? 1, timed);
    this.duckLevel += (this.duckTarget - this.duckLevel) * Math.min(1, dt * (this.duckTarget < this.duckLevel ? 8 : 2));
    this.applyVolumes();
    if (G.camera) this.updateListener(G.camera);
    const m = this.ambMix;
    if (m.crackle > 0) { this.timers.crackle -= dt; if (this.timers.crackle <= 0) { this.timers.crackle = 0.04 + Math.random() * 0.25; this.play('crackle', { vol: m.crackle * (0.3 + Math.random() * 0.7), bus: 'amb', pos: this.cracklePos }); } }
    if (m.drips > 0) { this.timers.drip -= dt; if (this.timers.drip <= 0) { this.timers.drip = 0.8 + Math.random() * 3; this.play('drip', { vol: m.drips, bus: 'amb', reverb: 0.8, pos: this.dripPos ? { x: this.dripPos.x + (Math.random() - 0.5) * 50, y: 8, z: this.dripPos.z + (Math.random() - 0.5) * 50 } : null }); } }
    if (m.gulls > 0) { this.timers.gull -= dt; if (this.timers.gull <= 0) { this.timers.gull = 5 + Math.random() * 12; this.play('gull', { vol: m.gulls * 0.4, bus: 'amb' }); } }
  }
}
const _dir = new THREE.Vector3();
// Per-sound limits: minimum gap between starts, and how many may start within the window.
const LIMITS = {
  default: { gap: 0.03, max: 6, window: 0.5 },
  crackle: { gap: 0.06, max: 4, window: 0.6 }, drip: { gap: 0.25, max: 2, window: 1 }, step: { gap: 0.08, max: 4, window: 0.5 },
  giantStep: { gap: 0.25, max: 2, window: 1 }, hit: { gap: 0.02, max: 6, window: 0.4 }, whoosh: { gap: 0.04, max: 4, window: 0.4 },
  scrape: { gap: 0.2, max: 2, window: 0.6 }, heartbeat: { gap: 0.25, max: 3, window: 1 },
};

// ---------- synthesized sound effects ----------
// Each: (audio, outNode, startTime, opts)
const SFX = {
  swing(a, out, t, o) {
    const s = a.src('white'), f = a.filter('bandpass', 500, 1.4), g = a.gain();
    f.frequency.setValueAtTime(400 * (o.pitch || 1), t); f.frequency.exponentialRampToValueAtTime(2600 * (o.pitch || 1), t + 0.18);
    s.connect(f); f.connect(g); g.connect(out); a.env(g, t, 0.03, 0.5, 0.2); s.start(t); s.stop(t + 0.3);
  },
  hit(a, out, t, o) {
    const k = o.heavy ? 1.4 : 1;
    const os = a.osc('sine', 140), og = a.gain(); os.frequency.exponentialRampToValueAtTime(45, t + 0.25); os.connect(og); og.connect(out); a.env(og, t, 0.003, 0.9 * k, 0.3); os.start(t); os.stop(t + 0.4);
    const s = a.src('white'), f = a.filter('bandpass', 900, 0.8), g = a.gain(); s.connect(f); f.connect(g); g.connect(out); a.env(g, t, 0.002, 0.6 * k, 0.12); s.start(t); s.stop(t + 0.2);
    const s2 = a.src('brown'), f2 = a.filter('lowpass', 400), g2 = a.gain(); s2.connect(f2); f2.connect(g2); g2.connect(out); a.env(g2, t, 0.005, 0.8 * k, 0.25); s2.start(t); s2.stop(t + 0.35);
  },
  clang(a, out, t, o) {
    const p = o.pitch || 1;
    for (const [fr, v, d] of [[520, 0.35, 0.9], [1183, 0.25, 0.7], [1731, 0.2, 0.55], [2654, 0.14, 0.4], [3870, 0.08, 0.3]]) {
      const os = a.osc('sine', fr * p), g = a.gain(); os.connect(g); g.connect(out); a.env(g, t, 0.001, v, d * (o.long ? 1.8 : 1)); os.start(t); os.stop(t + d * 2);
    }
    const s = a.src('white'), f = a.filter('highpass', 3000), g = a.gain(); s.connect(f); f.connect(g); g.connect(out); a.env(g, t, 0.001, 0.4, 0.06); s.start(t); s.stop(t + 0.1);
  },
  perfect(a, out, t) {
    SFX.clang(a, out, t, { pitch: 1.25, long: true });
    for (let i = 0; i < 4; i++) { const os = a.osc('triangle', [1568, 1976, 2349, 3136][i]), g = a.gain(); os.connect(g); g.connect(out); a.env(g, t + i * 0.04, 0.005, 0.12, 1.2); os.start(t); os.stop(t + 1.6); }
  },
  whoosh(a, out, t) {
    const s = a.src('pink'), f = a.filter('bandpass', 300, 0.8), g = a.gain();
    f.frequency.setValueAtTime(250, t); f.frequency.exponentialRampToValueAtTime(1200, t + 0.15); f.frequency.exponentialRampToValueAtTime(300, t + 0.4);
    s.connect(f); f.connect(g); g.connect(out); a.env(g, t, 0.08, 0.6, 0.35, 'lin'); s.start(t); s.stop(t + 0.5);
  },
  step(a, out, t, o) {
    const s = a.src(o.surface === 'stone' ? 'white' : 'pink'), f = a.filter(o.surface === 'stone' ? 'bandpass' : 'lowpass', o.surface === 'stone' ? 1400 : 900, 0.9), g = a.gain();
    s.connect(f); f.connect(g); g.connect(out); a.env(g, t, 0.004, 0.25, 0.07 + Math.random() * 0.03); s.start(t, Math.random()); s.stop(t + 0.15);
  },
  giantStep(a, out, t) {
    const os = a.osc('sine', 46), og = a.gain(); os.frequency.exponentialRampToValueAtTime(24, t + 0.7); os.connect(og); og.connect(out); a.env(og, t, 0.01, 1.2, 0.8); os.start(t); os.stop(t + 1);
    const s = a.src('brown'), f = a.filter('lowpass', 160), g = a.gain(); s.connect(f); f.connect(g); g.connect(out); a.env(g, t, 0.01, 1.4, 1.0); s.start(t); s.stop(t + 1.2);
    const s2 = a.src('white'), f2 = a.filter('bandpass', 2400, 2), g2 = a.gain(); s2.connect(f2); f2.connect(g2); g2.connect(out); a.env(g2, t + 0.05, 0.05, 0.05, 0.6, 'lin'); s2.start(t); s2.stop(t + 0.8);
  },
  roar(a, out, t, o) {
    const dur = o.dur || 3.2;
    const shaper = a.ctx.createWaveShaper(); const curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 3); } shaper.curve = curve;
    const f1 = a.filter('bandpass', 480, 2.5), f2 = a.filter('bandpass', 1050, 3), mixG = a.gain(); f1.connect(mixG); f2.connect(mixG); mixG.connect(out);
    shaper.connect(f1); shaper.connect(f2);
    const base = o.pitch || 1;
    for (const [fr, v] of [[92, 0.5], [138, 0.4], [184, 0.3], [61, 0.5]]) {
      const os = a.osc('sawtooth', fr * base), g = a.gain(), vib = a.osc('sine', 5.5), vg = a.gain(fr * 0.04);
      vib.connect(vg); vg.connect(os.frequency);
      os.frequency.setValueAtTime(fr * base * 0.8, t); os.frequency.linearRampToValueAtTime(fr * base * 1.15, t + dur * 0.3); os.frequency.linearRampToValueAtTime(fr * base * 0.7, t + dur);
      os.connect(g); g.connect(shaper); a.env(g, t, 0.15, v, dur, 'lin'); os.start(t); vib.start(t); os.stop(t + dur + 0.2); vib.stop(t + dur + 0.2);
    }
    const s = a.src('brown'), sf = a.filter('lowpass', 700), sg = a.gain(); s.connect(sf); sf.connect(sg); sg.connect(out); a.env(sg, t, 0.1, 1.2, dur, 'lin'); s.start(t); s.stop(t + dur + 0.2);
    mixG.gain.value = 0.8;
  },
  grunt(a, out, t, o) {
    const os = a.osc('sawtooth', 110 * (o.pitch || 1)), f = a.filter('bandpass', 700, 3), g = a.gain();
    os.frequency.exponentialRampToValueAtTime(70 * (o.pitch || 1), t + 0.25);
    os.connect(f); f.connect(g); g.connect(out); a.env(g, t, 0.02, 0.4, 0.25); os.start(t); os.stop(t + 0.35);
  },
  boulder(a, out, t, o) {
    const d = o.dur || 2.6;
    const s = a.src('brown'), f = a.filter('lowpass', 220), g = a.gain(); s.connect(f); f.connect(g); g.connect(out); a.env(g, t, 0.3, 1.4, d, 'lin'); s.start(t); s.stop(t + d + 0.5);
    const s2 = a.src('white'), f2 = a.filter('bandpass', 320, 4), g2 = a.gain(), lfo = a.osc('square', 7), lg = a.gain(0.25); lfo.connect(lg); lg.connect(g2.gain);
    s2.connect(f2); f2.connect(g2); g2.connect(out); g2.gain.setValueAtTime(0.3, t); g2.gain.linearRampToValueAtTime(0.0001, t + d); s2.start(t); lfo.start(t); s2.stop(t + d); lfo.stop(t + d);
  },
  impact(a, out, t, o) {
    const k = o.size || 1;
    const os = a.osc('sine', 70), og = a.gain(); os.frequency.exponentialRampToValueAtTime(28, t + 0.8); os.connect(og); og.connect(out); a.env(og, t, 0.005, 1.4 * k, 1.1); os.start(t); os.stop(t + 1.3);
    const s = a.src('brown'), f = a.filter('lowpass', 900), g = a.gain(); f.frequency.exponentialRampToValueAtTime(120, t + 1.5); s.connect(f); f.connect(g); g.connect(out); a.env(g, t, 0.005, 1.5 * k, 1.6); s.start(t); s.stop(t + 1.8);
    const s2 = a.src('white'), f2 = a.filter('bandpass', 1800, 0.7), g2 = a.gain(); s2.connect(f2); f2.connect(g2); g2.connect(out); a.env(g2, t, 0.002, 0.6 * k, 0.3); s2.start(t); s2.stop(t + 0.4);
  },
  stake(a, out, t) {
    // Wet, heavy thrust + hiss of the hot point. Deliberately short: silence follows.
    const os = a.osc('sine', 90), og = a.gain(); os.frequency.exponentialRampToValueAtTime(30, t + 0.5); os.connect(og); og.connect(out); a.env(og, t, 0.002, 1.6, 0.6); os.start(t); os.stop(t + 0.7);
    const s = a.src('white'), f = a.filter('highpass', 2500), g = a.gain(); s.connect(f); f.connect(g); g.connect(out); a.env(g, t, 0.01, 0.5, 0.9); s.start(t); s.stop(t + 1);
  },
  ring(a, out, t, o) {
    const os = a.osc('sine', 3900), g = a.gain(); os.connect(g); g.connect(out); a.env(g, t, 0.05, 0.05, o.dur || 2.2, 'lin'); os.start(t); os.stop(t + (o.dur || 2.2) + 0.2);
  },
  snort(a, out, t) {
    for (let i = 0; i < 2; i++) { const s = a.src('white'), f = a.filter('bandpass', 380 + i * 120, 3), g = a.gain(); s.connect(f); f.connect(g); g.connect(out); a.env(g, t + i * 0.16, 0.01, 0.6, 0.12); s.start(t + i * 0.16); s.stop(t + i * 0.16 + 0.2); }
  },
  squeal(a, out, t) {
    const os = a.osc('sawtooth', 700), f = a.filter('bandpass', 1500, 2), g = a.gain();
    os.frequency.setValueAtTime(700, t); os.frequency.linearRampToValueAtTime(1500, t + 0.12); os.frequency.linearRampToValueAtTime(500, t + 0.5);
    os.connect(f); f.connect(g); g.connect(out); a.env(g, t, 0.02, 0.35, 0.5); os.start(t); os.stop(t + 0.6);
  },
  bleat(a, out, t, o) {
    const p = o.pitch || (0.85 + Math.random() * 0.3);
    const os = a.osc('sawtooth', 340 * p), vib = a.osc('sine', 7), vg = a.gain(30 * p), f = a.filter('bandpass', 1100, 2), g = a.gain();
    vib.connect(vg); vg.connect(os.frequency); os.connect(f); f.connect(g); g.connect(out);
    os.frequency.linearRampToValueAtTime(300 * p, t + 0.6);
    a.env(g, t, 0.05, 0.22, 0.6); os.start(t); vib.start(t); os.stop(t + 0.8); vib.stop(t + 0.8);
  },
  bowDraw(a, out, t) {
    const s = a.src('pink'), f = a.filter('bandpass', 300, 6), g = a.gain(); f.frequency.linearRampToValueAtTime(900, t + 0.6);
    s.connect(f); f.connect(g); g.connect(out); a.env(g, t, 0.3, 0.2, 0.4, 'lin'); s.start(t); s.stop(t + 0.8);
  },
  bowRelease(a, out, t) {
    const os = a.osc('triangle', 130), g = a.gain(); os.frequency.exponentialRampToValueAtTime(90, t + 0.3); os.connect(g); g.connect(out); a.env(g, t, 0.002, 0.5, 0.35); os.start(t); os.stop(t + 0.4);
    SFX.whoosh(a, out, t + 0.02);
  },
  thunk(a, out, t) {
    const os = a.osc('square', 180), f = a.filter('lowpass', 700), g = a.gain(); os.frequency.exponentialRampToValueAtTime(60, t + 0.1);
    os.connect(f); f.connect(g); g.connect(out); a.env(g, t, 0.001, 0.4, 0.12); os.start(t); os.stop(t + 0.2);
  },
  splash(a, out, t, o) {
    const s = a.src('white'), f = a.filter('lowpass', 3000), g = a.gain(); f.frequency.exponentialRampToValueAtTime(400, t + 1.2);
    s.connect(f); f.connect(g); g.connect(out); a.env(g, t, 0.01, 0.8 * (o.size || 1), 1.2); s.start(t); s.stop(t + 1.4);
  },
  thunder(a, out, t) {
    const s = a.src('brown'), f = a.filter('lowpass', 600), g = a.gain(); f.frequency.exponentialRampToValueAtTime(90, t + 4);
    s.connect(f); f.connect(g); g.connect(out); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(1.6, t + 0.08); g.gain.exponentialRampToValueAtTime(0.5, t + 0.6); g.gain.linearRampToValueAtTime(1.0, t + 1.0); g.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);
    s.start(t); s.stop(t + 4.6);
    const c = a.src('white'), cf = a.filter('highpass', 1500), cg = a.gain(); c.connect(cf); cf.connect(cg); cg.connect(out); a.env(cg, t, 0.002, 0.5, 0.25); c.start(t); c.stop(t + 0.3);
  },
  heartbeat(a, out, t, o) {
    for (const [dt, v] of [[0, 1], [0.18, 0.7]]) { const os = a.osc('sine', 58), g = a.gain(); os.frequency.exponentialRampToValueAtTime(36, t + dt + 0.15); os.connect(g); g.connect(out); a.env(g, t + dt, 0.008, (o.vol || 1) * v, 0.18); os.start(t + dt); os.stop(t + dt + 0.25); }
  },
  pluck(a, out, t, o) {
    const f0 = o.freq || 440;
    const os = a.osc('triangle', f0), os2 = a.osc('sine', f0 * 2), lp = a.filter('lowpass', f0 * 6), g = a.gain();
    lp.frequency.exponentialRampToValueAtTime(f0 * 1.5, t + 0.4);
    os.connect(lp); os2.connect(lp); lp.connect(g); g.connect(out); a.env(g, t, 0.003, 0.25, o.decay || 1.2); os.start(t); os2.start(t); os.stop(t + 1.6); os2.stop(t + 1.6);
  },
  ui(a, out, t) { SFX.pluck(a, out, t, { freq: 880, decay: 0.3 }); },
  uiConfirm(a, out, t) { SFX.pluck(a, out, t, { freq: 587, decay: 0.6 }); SFX.pluck(a, out, t + 0.07, { freq: 880, decay: 0.8 }); },
  uiBack(a, out, t) { SFX.pluck(a, out, t, { freq: 440, decay: 0.4 }); },
  blip(a, out, t, o) {
    const os = a.osc('triangle', (o.pitch || 1) * (180 + Math.random() * 40)), f = a.filter('lowpass', 1400), g = a.gain();
    os.connect(f); f.connect(g); g.connect(out); a.env(g, t, 0.004, 0.12, 0.06); os.start(t); os.stop(t + 0.1);
  },
  scrape(a, out, t) {
    const s = a.src('white'), f = a.filter('bandpass', 2600, 3), g = a.gain(); f.frequency.linearRampToValueAtTime(3400, t + 0.35);
    s.connect(f); f.connect(g); g.connect(out); a.env(g, t, 0.05, 0.35, 0.35, 'lin'); s.start(t); s.stop(t + 0.5);
  },
  snore(a, out, t) {
    const s = a.src('brown'), f = a.filter('bandpass', 180, 2), g = a.gain(), os = a.osc('sawtooth', 48), og = a.gain();
    s.connect(f); f.connect(g); g.connect(out); os.connect(og); og.connect(f);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.9, t + 1.0); g.gain.linearRampToValueAtTime(0.0001, t + 1.8);
    og.gain.value = 0.05; s.start(t); os.start(t); s.stop(t + 2); os.stop(t + 2);
  },
  whistle(a, out, t) {
    const os = a.osc('sine', 1400), g = a.gain(); os.frequency.exponentialRampToValueAtTime(380, t + 1.4); os.connect(g); g.connect(out);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.12, t + 1.0); g.gain.linearRampToValueAtTime(0.0001, t + 1.45); os.start(t); os.stop(t + 1.5);
  },
  sizzle(a, out, t) {
    const s = a.src('white'), f = a.filter('highpass', 3500), g = a.gain(), lfo = a.osc('square', 23), lg = a.gain(0.15); lfo.connect(lg); lg.connect(g.gain);
    s.connect(f); f.connect(g); g.connect(out); g.gain.setValueAtTime(0.3, t); g.gain.linearRampToValueAtTime(0.0001, t + 1.6); s.start(t); lfo.start(t); s.stop(t + 1.7); lfo.stop(t + 1.7);
  },
  crackle(a, out, t) {
    const s = a.src('white'), f = a.filter('highpass', 1500 + Math.random() * 2000), g = a.gain(); s.connect(f); f.connect(g); g.connect(out); a.env(g, t, 0.001, 0.3, 0.02 + Math.random() * 0.03); s.start(t, Math.random()); s.stop(t + 0.08);
  },
  drip(a, out, t) {
    const os = a.osc('sine', 1200 + Math.random() * 900), g = a.gain(); os.frequency.exponentialRampToValueAtTime(500, t + 0.08); os.connect(g); g.connect(out); a.env(g, t, 0.002, 0.12, 0.12); os.start(t); os.stop(t + 0.2);
  },
  gull(a, out, t) {
    for (let i = 0; i < 3; i++) { const os = a.osc('sawtooth', 1300), f = a.filter('bandpass', 1800, 4), g = a.gain(); const s = t + i * 0.28; os.frequency.setValueAtTime(1500, s); os.frequency.linearRampToValueAtTime(1100, s + 0.2); os.connect(f); f.connect(g); g.connect(out); a.env(g, s, 0.02, 0.1, 0.2); os.start(s); os.stop(s + 0.3); }
  },
  creak(a, out, t) {
    const os = a.osc('sawtooth', 90), f = a.filter('bandpass', 600, 8), g = a.gain(); os.frequency.linearRampToValueAtTime(140, t + 0.6);
    os.connect(f); f.connect(g); g.connect(out); a.env(g, t, 0.2, 0.15, 0.5, 'lin'); os.start(t); os.stop(t + 0.8);
  },
  cheer(a, out, t, o) {
    const n = o.count || 8;
    for (let i = 0; i < n; i++) {
      const s = t + Math.random() * 0.3, os = a.osc('sawtooth', 160 + Math.random() * 120), f = a.filter('bandpass', 800 + Math.random() * 600, 4), g = a.gain();
      os.frequency.linearRampToValueAtTime(os.frequency.value * 1.3, s + 0.4); os.connect(f); f.connect(g); g.connect(out); a.env(g, s, 0.05, 0.08, 0.8); os.start(s); os.stop(s + 1);
    }
  },
  // Unblockable tell: a low brassy blare with a bone rattle, distinct from every other cue.
  unblockable(a, out, t) {
    for (const [f, v] of [[73, 0.5], [110, 0.35], [146, 0.2]]) { const o = a.osc('sawtooth', f), bp = a.filter('bandpass', f * 4, 3), g = a.gain(); o.connect(bp); bp.connect(g); g.connect(out); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.12); g.gain.linearRampToValueAtTime(v * 0.7, t + 0.6); g.gain.linearRampToValueAtTime(0.0001, t + 0.9); o.start(t); o.stop(t + 1); }
    const s = a.src('white'), f = a.filter('bandpass', 2400, 6), g = a.gain(), l = a.osc('square', 18), lg = a.gain(0.2); l.connect(lg); lg.connect(g.gain); s.connect(f); f.connect(g); g.connect(out); g.gain.setValueAtTime(0.2, t); g.gain.linearRampToValueAtTime(0.0001, t + 0.7); s.start(t); l.start(t); s.stop(t + 0.75); l.stop(t + 0.75);
  },
  pickup(a, out, t) { SFX.pluck(a, out, t, { freq: 659, decay: 0.5 }); SFX.pluck(a, out, t + 0.08, { freq: 988, decay: 0.7 }); },
  sting(a, out, t) { SFX.pluck(a, out, t, { freq: 294, decay: 1.5 }); SFX.pluck(a, out, t + 0.12, { freq: 349, decay: 1.5 }); },
};
