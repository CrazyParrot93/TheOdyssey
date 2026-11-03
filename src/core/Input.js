import { G } from './context.js';
import { COMBAT } from './Tuning.js';

export const ACTION_LABELS = {
  forward: 'Move forward', back: 'Move back', left: 'Move left', right: 'Move right',
  sprint: 'Sprint', crouch: 'Crouch / sneak', dodge: 'Dodge roll', interact: 'Interact',
  attack: 'Attack / fire', alt: 'Shield / aim bow', weapon: 'Switch sword / bow', lock: 'Lock on',
  shout: 'Shout', journal: 'Journal', pause: 'Pause',
};
export const DEFAULT_BINDINGS = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'], crouch: ['KeyC', 'ControlLeft'], dodge: ['Space'], interact: ['KeyE'],
  attack: ['Mouse0'], alt: ['Mouse2'], weapon: ['KeyQ'], lock: ['KeyF', 'Mouse1'], shout: ['KeyR'],
  journal: ['KeyJ'], pause: ['Escape', 'KeyP'],
};
// Standard gamepad mapping
const PAD = { 0: 'dodge', 1: 'crouch', 2: 'attack', 3: 'interact', 4: 'weapon', 5: 'lock', 6: 'alt', 7: 'alt', 8: 'journal', 9: 'pause', 10: 'sprint', 11: 'shout' };
export const PAD_LABELS = { dodge: 'A', crouch: 'B', attack: 'X', interact: 'Y', weapon: 'LB', lock: 'RB', alt: 'LT', journal: 'View', pause: 'Menu', sprint: 'L3', shout: 'R3' };

export class Input {
  constructor(el) {
    this.el = el;
    this.down = new Set();
    this.presses = new Map();
    this.look = { x: 0, y: 0 };
    this.padDown = new Set();
    this.padPrev = [];
    this.padMove = { x: 0, y: 0 };
    this.pad = null;
    this.device = 'kbm';
    this.capture = null;
    this.setBindings(null);

    addEventListener('keydown', (e) => this._key(e, true));
    addEventListener('keyup', (e) => this._key(e, false));
    el.addEventListener('mousedown', (e) => this._code('Mouse' + e.button, true));
    addEventListener('mouseup', (e) => this._code('Mouse' + e.button, false));
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === this.el) { this.look.x += e.movementX; this.look.y += e.movementY; this.device = 'kbm'; }
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('gamepadconnected', (e) => G.bus?.emit('gamepad', { connected: true, id: e.gamepad.id }));
    addEventListener('gamepaddisconnected', (e) => G.bus?.emit('gamepad', { connected: false, id: e.gamepad.id }));
    addEventListener('blur', () => this.down.clear());
  }

  setBindings(b) {
    this.bindings = JSON.parse(JSON.stringify(DEFAULT_BINDINGS));
    if (b) for (const k of Object.keys(b)) if (this.bindings[k]) this.bindings[k] = b[k];
    this.codeMap = new Map();
    for (const [a, codes] of Object.entries(this.bindings)) for (const c of codes) {
      if (!this.codeMap.has(c)) this.codeMap.set(c, []);
      this.codeMap.get(c).push(a);
    }
  }

  _key(e, isDown) {
    if (this.capture && isDown) { e.preventDefault(); const cb = this.capture; this.capture = null; cb(e.code); return; }
    const tag = document.activeElement?.tagName;
    if (['Space', 'Tab', 'F3', 'F4', 'F6', 'ArrowUp', 'ArrowDown'].includes(e.code) && tag !== 'INPUT' && tag !== 'SELECT') {
      if (e.code !== 'Tab' || document.pointerLockElement) e.preventDefault();
    }
    if (isDown && e.repeat) return;
    this._code(e.code, isDown);
    this.device = 'kbm';
    G.bus?.emit(isDown ? 'keydown' : 'keyup', e.code);
  }

  _code(code, isDown) {
    if (this.capture && isDown && code.startsWith('Mouse')) { const cb = this.capture; this.capture = null; cb(code); return; }
    if (isDown) {
      this.down.add(code);
      const acts = this.codeMap.get(code);
      if (acts) for (const a of acts) this.presses.set(a, performance.now());
    } else this.down.delete(code);
  }

  isDown(a) {
    const codes = this.bindings[a];
    if (codes) for (const c of codes) if (this.down.has(c)) return true;
    return this.padDown.has(a);
  }
  // Buffered edge: true once if the action was pressed within `buffer` seconds.
  pressed(a, buffer = 0.18) {
    const t = this.presses.get(a);
    if (t === undefined) return false;
    this.presses.delete(a);
    return performance.now() - t <= buffer * 1000;
  }
  peek(a, buffer = 0.18) { const t = this.presses.get(a); return t !== undefined && performance.now() - t <= buffer * 1000; }
  clear() { this.presses.clear(); }

  move() {
    let x = 0, y = 0;
    if (this.isDown('right')) x += 1;
    if (this.isDown('left')) x -= 1;
    if (this.isDown('forward')) y += 1;
    if (this.isDown('back')) y -= 1;
    x += this.padMove.x; y += this.padMove.y;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }
  consumeLook() { const l = { x: this.look.x, y: this.look.y }; this.look.x = this.look.y = 0; return l; }

  poll(dt) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) if (p && p.connected) { gp = p; break; }
    this.pad = gp;
    this.padDown.clear();
    this.padMove.x = this.padMove.y = 0;
    if (!gp) return;
    // Radial deadzone with a response curve: precise near centre, full speed at the rim.
    const radial = (x, y) => {
      const m = Math.hypot(x, y), dzn = COMBAT.padDeadzone;
      if (m < dzn) return [0, 0];
      const k = Math.pow(Math.min(1, (m - dzn) / (1 - dzn)), COMBAT.padCurve) / m;
      return [x * k, y * k];
    };
    const [lx, ly] = radial(gp.axes[0] || 0, gp.axes[1] || 0), [rx, ry] = radial(gp.axes[2] || 0, gp.axes[3] || 0);
    this.padMove.x = lx; this.padMove.y = -ly;
    const ps = COMBAT.padLook * (G.settings?.padSensitivity || 1);
    if (rx || ry) { this.look.x += rx * dt * ps; this.look.y += ry * dt * ps * 0.68; this.device = 'pad'; }
    if (lx || ly) this.device = 'pad';
    gp.buttons.forEach((b, i) => {
      const on = b.pressed || b.value > 0.5;
      const a = PAD[i];
      if (on && a) this.padDown.add(a);
      if (on && !this.padPrev[i]) {
        if (a) this.presses.set(a, performance.now());
        this.device = 'pad';
        G.bus?.emit('padbutton', i);
      }
      this.padPrev[i] = on;
    });
  }

  rumble(strong = 0.5, weak = 0.5, ms = 120) {
    const act = this.pad?.vibrationActuator;
    if (!act?.playEffect) return;
    const k = G.settings?.reduceMotion ? 0.5 : 1;
    act.playEffect('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong * k), weakMagnitude: Math.min(1, weak * k) }).catch(() => {});
  }

  lockPointer() {
    if (document.pointerLockElement === this.el) return;
    // Raw mouse input (no OS acceleration) where supported, plain pointer lock otherwise.
    try {
      const p = this.el.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { const q = this.el.requestPointerLock(); if (q && q.catch) q.catch(() => {}); } catch (e) { /* not allowed yet */ } });
    } catch (e) { /* not allowed yet */ }
  }
  unlockPointer() { if (document.pointerLockElement) document.exitPointerLock(); }
  get locked() { return document.pointerLockElement === this.el; }

  label(action) {
    if (this.device === 'pad') return PAD_LABELS[action] || action;
    const c = this.bindings[action]?.[0] || '?';
    return Input.codeName(c);
  }
  static codeName(c) {
    const map = { Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'R-Shift', ControlLeft: 'Ctrl', Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
    if (map[c]) return map[c];
    return c.replace(/^Key/, '').replace(/^Digit/, '');
  }
}
