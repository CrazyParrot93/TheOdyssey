import { G } from '../core/context.js';

// F3: performance overlay. F4: debug menu (jump to checkpoints, god mode, meters, AI visuals).
export class DebugUI {
  constructor() {
    this.overlay = document.createElement('div'); this.overlay.id = 'debug-overlay'; this.overlay.style.display = 'none';
    document.body.appendChild(this.overlay);
    this.menu = null;
    this.t = 0;
    G.bus.on('keydown', (code) => {
      if (code === 'F3') { G.debug.overlay = !G.debug.overlay; this.overlay.style.display = G.debug.overlay ? 'block' : 'none'; }
      if (code === 'F4') this.toggleMenu();
    });
  }
  toggleMenu() {
    if (this.menu) { this.menu.remove(); this.menu = null; return; }
    G.input.unlockPointer();
    const m = document.createElement('div'); m.id = 'debug-menu';
    const jumps = ['landing', 'cave', 'stealth', 'climax', 'escape', 'run', 'choice'];
    m.innerHTML = `<h4>NOSTOS debug</h4>
      <label>God mode <input type="checkbox" data-k="god" ${G.debug.god ? 'checked' : ''}></label>
      <label>AI perception log <input type="checkbox" data-k="perception" ${G.debug.perception ? 'checked' : ''}></label>
      <h4>Meters</h4>
      <button data-a="cun+">Cunning +1</button><button data-a="wra+">Wrath +1</button><button data-a="wra-">Wrath -1</button><button data-a="heal">Heal</button>
      <h4>Jump / peak moments</h4>
      <button data-a="title">Title screen</button><button data-a="sail">Sailing map</button>
      ${jumps.map((j) => `<button data-j="${j}">Ch.III · ${j}</button>`).join('')}
      <h4>Camera</h4><button data-a="fly">Toggle fly camera (WASD + mouse, Shift fast)</button>
      <h4>Time</h4><button data-a="slow">Time ×0.25</button><button data-a="norm">Time ×1</button><button data-a="kill">Kill enemies</button>`;
    m.addEventListener('change', (e) => { const k = e.target.dataset.k; if (k) G.debug[k] = e.target.checked; });
    m.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const a = b.dataset.a, j = b.dataset.j, st = G.state;
      if (j) { this.toggleMenu(); G.flow.jump(j); return; }
      if (a === 'cun+') st?.addCunning(1, 'debug');
      if (a === 'wra+') st?.addWrath(1, 'debug');
      if (a === 'wra-') st?.addWrath(-1, 'debug');
      if (a === 'heal') G.engine.scene?.player?.heal(100);
      if (a === 'title') { this.toggleMenu(); G.flow.toTitle(); }
      if (a === 'sail') { this.toggleMenu(); if (!G.state) G.flow.newGame(); else G.flow.toSailing({}); }
      if (a === 'fly') { const on = G.rig.toggleFly(); b.textContent = on ? 'Fly camera: ON' : 'Toggle fly camera (WASD + mouse, Shift fast)'; }
      if (a === 'slow') G.engine.setTimeScale(0.25, 20);
      if (a === 'norm') G.engine.setTimeScale(1, 20);
      if (a === 'kill') for (const e2 of G.engine.scene?.zone?.enemies || []) if (e2.hurt && e2 !== G.engine.scene.cyclops) e2.hurt(999, { x: 0, y: 0, z: 1, clone() { return this; } }, {});
    });
    document.body.appendChild(m);
    this.menu = m;
  }
  update(dt) {
    if (!G.debug.overlay) return;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.25;
    const info = G.renderer.info;
    const sc = G.engine.scene;
    const g = sc?.cyclops;
    this.overlay.textContent = `FPS ${G.engine.fps.toFixed(0)}  ${G.engine.frameMs.toFixed(1)} ms
draw calls ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(0)}k
geo ${info.memory.geometries}  tex ${info.memory.textures}  quality ${G.qualityName}
time ×${G.engine.timeScale.toFixed(2)}  ${sc?.constructor?.name || ''}${g && G.debug.perception ? `\ngiant: ${g.activity} susp ${g.suspicion.toFixed(2)} mask ${g.masking}` : ''}`;
  }
}
