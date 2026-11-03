import { G } from '../core/context.js';

// Coroutine-style scripting on game time: `await s.wait(2)`, `await s.until(() => cond)`.
// cancel() rejects every pending wait so an aborted chapter script stops cleanly.
export class Script {
  constructor() { this.t = 0; this.waits = []; this.cancelled = false; }
  update(dt) {
    this.t += dt;
    for (let i = this.waits.length - 1; i >= 0; i--) {
      const w = this.waits[i];
      let done = false;
      try { done = w.cond(); } catch (e) { console.error(e); done = true; }
      if (done) { this.waits.splice(i, 1); w.resolve(); }
    }
  }
  until(cond) {
    if (this.cancelled) { const r = Promise.reject(ABORT); r.catch(() => {}); return r; }
    const p = new Promise((resolve, reject) => this.waits.push({ cond, resolve, reject }));
    p.catch(() => {}); // fire-and-forget waits must not surface as unhandled when a chapter is aborted
    return p;
  }
  wait(seconds) { const end = this.t + seconds; return this.until(() => this.t >= end); }
  // Real-time wait (ignores slow motion / hit-stop)
  waitReal(seconds) { const end = G.engine.realTime + seconds; return this.until(() => G.engine.realTime >= end); }
  cancel() { this.cancelled = true; for (const w of this.waits) w.reject(ABORT); this.waits = []; }
  run(fn) {
    return fn().catch((e) => { if (e !== ABORT) console.error(e); });
  }
}
export const ABORT = { abort: true };
