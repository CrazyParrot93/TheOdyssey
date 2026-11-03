import { G } from '../core/context.js';
import { GameState } from '../core/State.js';
import { Save } from '../core/Save.js';
import { TitleScene } from '../scenes/TitleScene.js';
import { SailingScene } from '../scenes/SailingScene.js';
import { CaveChapter } from '../scenes/CaveChapter.js';
import { prebuild } from '../assets/Anatomy.js';
import { CREW, ODYSSEUS, POLYPHEMUS } from '../data/crew.js';

const LOOKS = [ODYSSEUS.look, POLYPHEMUS.look, ...CREW.filter((c) => c.party).map((c) => c.look)];

// Top-level game flow: title → sailing → chapter → summary → sailing.
let busy = false;
async function swap(make, fadeOut = 0.9, fadeIn = 1.4) {
  if (busy) return;
  busy = true;
  try {
    await G.ui.fade(1, fadeOut);
    G.ui.closeAll();
    G.ui.showHUD(false); G.ui.prompt(null); G.ui.bigPrompt(null); G.ui.setStealth(null); G.ui.setCompass(null); G.ui.cling(null); G.ui.letterbox(false); G.ui.setObjective(null);
    G.engine.paused = false;
    G.input.clear();
    await prebuild(LOOKS, (i, n) => G.ui.loading?.(`Sculpting the crew… ${Math.round((i / n) * 100)}%`));
    G.ui.loading?.(null);
    G.engine.setScene(make());
    await new Promise((r) => setTimeout(r, 120));
    G.ui.fade(0, fadeIn);
  } finally { busy = false; }
}

export const Flow = {
  toTitle() { G.input.unlockPointer(); return swap(() => new TitleScene()); },
  newGame() {
    Save.clearGame();
    G.state = new GameState();
    G.state.checkpoint = 'sailing';
    G.lastCheckpoint = JSON.parse(JSON.stringify(G.state));
    return swap(() => new SailingScene({ intro: true }), 1.2, 2);
  },
  continueGame() {
    const s = Save.loadGame();
    G.state = new GameState(s);
    G.lastCheckpoint = JSON.parse(JSON.stringify(G.state));
    return this.resume();
  },
  resume() {
    const cp = G.state.checkpoint;
    if (!cp || cp === 'sailing') return swap(() => new SailingScene({}));
    return swap(() => new CaveChapter(cp));
  },
  toSailing(opts = {}) { G.state.saveCheckpoint('sailing'); return swap(() => new SailingScene(opts), 1.2, 2); },
  startChapter(cp = 'landing') { return swap(() => new CaveChapter(cp), 1.2, 1.5); },
  restart() { G.state = GameState.restoreLast(); return this.resume(); },
  jump(cp) { if (!G.state) G.state = new GameState(); G.state.checkpoint = cp; G.lastCheckpoint = JSON.parse(JSON.stringify(G.state)); return this.resume(); },
};
G.flow = Flow;
