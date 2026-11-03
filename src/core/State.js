import { G } from './context.js';
import { CREW } from '../data/crew.js';
import { Save } from './Save.js';

// Persistent run state: crew, Cunning, Wrath, Athena's favor, supplies, checkpoint.
export class GameState {
  constructor(data) { Object.assign(this, GameState.fresh(), data || {}); }

  static fresh() {
    return {
      chapter: 3, checkpoint: 'sailing',
      crew: CREW.map((c) => ({ id: c.id, alive: true, lostIn: null, cause: null })),
      cunning: 0, wrath: 0, favor: 1, supplies: 70, arrows: 12, maxArrows: 12,
      found: [], lore: ['war', 'nostos'], flags: {}, stats: {}, completed: [],
    };
  }

  alive(ids) { return this.crew.filter((c) => c.alive && (!ids || ids.includes(c.id))); }
  isAlive(id) { return !!this.crew.find((c) => c.id === id)?.alive; }

  loseCrew(id, cause) {
    if (G.debug.god) return false;
    const c = this.crew.find((m) => m.id === id);
    if (!c || !c.alive) return false;
    c.alive = false; c.lostIn = this.chapter; c.cause = cause;
    G.bus.emit('crewLost', { id, cause });
    return true;
  }
  addCunning(n, why) { this.cunning = Math.max(0, this.cunning + n); G.bus.emit('cunningChanged', { value: this.cunning, delta: n, why }); }
  addWrath(n, why) { this.wrath = Math.max(0, Math.min(10, this.wrath + n)); G.bus.emit('wrathChanged', { value: this.wrath, delta: n, why }); }
  addFavor(n, why) { this.favor = Math.max(0, this.favor + n); G.bus.emit('favorChanged', { value: this.favor, delta: n, why }); }
  stat(key, n = 1) { this.stats[key] = (this.stats[key] || 0) + n; }

  saveCheckpoint(name) {
    this.checkpoint = name;
    G.lastCheckpoint = JSON.parse(JSON.stringify(this));
    Save.saveGame(this);
    G.bus.emit('checkpoint', name);
  }
  static restoreLast() {
    const snap = G.lastCheckpoint || Save.loadGame();
    return new GameState(snap ? JSON.parse(JSON.stringify(snap)) : null);
  }
}
