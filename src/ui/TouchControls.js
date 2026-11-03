import { G } from '../core/context.js';

// On-screen controls for phones and tablets. A floating move stick appears wherever the left thumb lands,
// the right half of the screen is drag-to-look, and thumb buttons cover the actions. Everything feeds the
// same Input actions the keyboard and gamepad use, so gameplay code needs no changes.
export const isTouchDevice = () => matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

const BUTTONS = [
  // [action, label, css class, mode] — mode: 'hold' keeps the action down while touched, 'toggle' latches
  ['attack', '⚔', 'tb-attack', 'hold'],
  ['dodge', '⤳', 'tb-dodge', 'hold'],
  ['alt', '⛨', 'tb-alt', 'hold'],
  ['interact', 'E', 'tb-interact', 'hold'],
  ['crouch', '⇩', 'tb-crouch', 'hold'],
  ['sprint', '»', 'tb-sprint', 'toggle'],
  ['weapon', '⇄', 'tb-weapon', 'hold'],
  ['lock', '◎', 'tb-lock', 'hold'],
];

export class TouchControls {
  constructor(input) {
    this.input = input;
    this.stick = null; this.lookId = null; this.lastLook = null;
    const root = (this.root = document.createElement('div'));
    root.id = 'touch';
    root.innerHTML = `<div class="t-pad"></div><div class="t-stick"><div class="t-knob"></div></div>
      ${BUTTONS.map(([a, l, c]) => `<button class="tbtn ${c}" data-a="${a}">${l}</button>`).join('')}
      <button class="tbtn tb-pause" data-pause="1">❚❚</button>`;
    document.body.appendChild(root);
    document.body.classList.add('is-touch');
    this.pad = root.querySelector('.t-pad'); this.stickEl = root.querySelector('.t-stick'); this.knob = root.querySelector('.t-knob');
    const pad = this.pad;
    pad.addEventListener('pointerdown', (e) => this._down(e));
    pad.addEventListener('pointermove', (e) => this._move(e));
    for (const ev of ['pointerup', 'pointercancel']) pad.addEventListener(ev, (e) => this._up(e));
    for (const b of root.querySelectorAll('.tbtn')) {
      if (b.dataset.pause) { b.addEventListener('pointerdown', (e) => { e.preventDefault(); G.bus.emit('keydown', 'Escape'); }); continue; }
      const [a, , , mode] = BUTTONS.find((x) => x[0] === b.dataset.a);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
        if (mode === 'toggle') { const on = !input.touchDown.has(a); on ? input.touchDown.add(a) : input.touchDown.delete(a); b.classList.toggle('on', on); }
        else { input.touchDown.add(a); b.classList.add('on'); }
        input.presses.set(a, performance.now());
        input.device = 'touch';
      });
      if (mode !== 'toggle') for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => { input.touchDown.delete(a); b.classList.remove('on'); });
    }
    // Taps advance dialogue (keyboard players press Space or E).
    document.getElementById('dialogue')?.addEventListener('pointerdown', () => { const d = G.ui.dialogueState; if (d && !(d.line?.choices && !d.typing)) G.ui._advance(); });
  }

  _down(e) {
    e.preventDefault();
    try { this.pad.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
    if (e.clientX < innerWidth * 0.45 && !this.stick) {
      this.stick = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.stickEl.style.left = e.clientX + 'px'; this.stickEl.style.top = e.clientY + 'px';
      this.stickEl.classList.add('on');
    } else if (this.lookId === null) { this.lookId = e.pointerId; this.lastLook = { x: e.clientX, y: e.clientY }; }
    this.input.device = 'touch';
  }
  _move(e) {
    const s = this.stick;
    if (s && e.pointerId === s.id) {
      const R = 56, dx = e.clientX - s.x, dy = e.clientY - s.y, m = Math.hypot(dx, dy), k = m > R ? R / m : 1;
      this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      const v = Math.min(1, m / R), dz = 0.12, mag = v < dz ? 0 : (v - dz) / (1 - dz);
      this.input.touchMove.x = m ? (dx / m) * mag : 0; this.input.touchMove.y = m ? (-dy / m) * mag : 0;
    } else if (e.pointerId === this.lookId && this.lastLook) {
      const sens = 1.7 * (G.settings?.touchSensitivity || 1);
      this.input.look.x += (e.clientX - this.lastLook.x) * sens; this.input.look.y += (e.clientY - this.lastLook.y) * sens;
      this.lastLook = { x: e.clientX, y: e.clientY };
    }
  }
  _up(e) {
    if (this.stick && e.pointerId === this.stick.id) {
      this.stick = null; this.input.touchMove.x = this.input.touchMove.y = 0;
      this.knob.style.transform = ''; this.stickEl.classList.remove('on');
    }
    if (e.pointerId === this.lookId) { this.lookId = null; this.lastLook = null; }
  }

  // Shown only while actually playing: hidden behind menus, dialogue, cutscenes and the title.
  update() {
    const s = G.engine.scene;
    const show = G.started && s?.pausable && !G.ui.menuOpen && !(s.player && !s.player.control) && !G.ui.inDialogue;
    if (show !== this.shown) {
      this.shown = show; this.root.classList.toggle('show', !!show);
      if (!show) { this.input.touchDown.clear(); this.input.touchMove.x = this.input.touchMove.y = 0; this.stick = null; this.lookId = null; for (const b of this.root.querySelectorAll('.tbtn.on')) b.classList.remove('on'); this.knob.style.transform = ''; this.stickEl.classList.remove('on'); }
    }
  }
}
