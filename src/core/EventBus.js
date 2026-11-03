// Decoupled pub/sub. Events used: crewLost, cunningChanged, wrathChanged, favorChanged,
// bossPhaseChanged, peakMomentStart, checkpoint, objective, gamepad, appBlur.
export class EventBus {
  constructor() { this.map = new Map(); }
  on(ev, fn) {
    if (!this.map.has(ev)) this.map.set(ev, new Set());
    this.map.get(ev).add(fn);
    return () => this.off(ev, fn);
  }
  off(ev, fn) { this.map.get(ev)?.delete(fn); }
  emit(ev, data) {
    const set = this.map.get(ev);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(data); } catch (e) { console.error(`[bus:${ev}]`, e); }
    }
  }
}
