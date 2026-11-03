import { G } from '../core/context.js';
import { Save } from '../core/Save.js';
import { Input, ACTION_LABELS, DEFAULT_BINDINGS } from '../core/Input.js';
import { QUALITY_PRESETS } from '../core/Config.js';
import { CREW, ODYSSEUS } from '../data/crew.js';
import { CHAPTERS, ROMAN } from '../data/chapters.js';
import { LORE } from '../data/lore.js';
import { portrait } from './Portraits.js';

const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class UI {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div id="hud" class="hidden">
        <div class="objective"><div class="obj-label">Objective</div><div class="obj-text"></div></div>
        <div class="vitals">
          <div class="bar hp"><div class="fill"></div><div class="ghost"></div></div>
          <div class="bar st"><div class="fill"></div></div>
          <div class="weapon"><span class="wicon"></span><span class="arrows"></span></div>
        </div>
        <div class="meters">
          <div class="crew-count"><span class="ic">⚓</span><span class="v"></span></div>
          <div class="cunning" title="Cunning"><span class="ic">🦉</span><span class="v">0</span></div>
          <div class="wrath" title="Poseidon's Wrath"><span class="ic">🔱</span><span class="pips"></span></div>
        </div>
        <div class="compass"><div class="strip"></div><div class="needle"></div></div>
        <div class="stealth"><svg viewBox="0 0 100 50"><path class="lid" d="M5 25 Q50 -10 95 25 Q50 60 5 25Z"/><circle class="pupil" cx="50" cy="25" r="11"/></svg><div class="stealth-label"></div></div>
        <div class="crosshair"></div>
        <div class="prompt"><span class="key"></span><span class="ptext"></span><div class="pring"><div class="pfill"></div></div></div>
      </div>
      <div class="bigprompt"><div class="bp-text"></div><div class="bp-sub"></div></div>
      <div class="cling"><div class="cl-label"></div><div class="cl-track"><div class="cl-zone"></div><div class="cl-mark"></div></div><div class="cl-grip"><div class="cl-gfill"></div></div><div class="cl-help"></div></div>
      <div class="toasts"></div>
      <div class="subtitle"><span class="who"></span><span class="line"></span></div>
      <div class="letterbox top"></div><div class="letterbox bottom"></div>
      <div class="chapter-card"><div class="cc-num"></div><div class="cc-rule"></div><div class="cc-title"></div><div class="cc-sub"></div></div>
      <div id="dialogue" class="hidden"><canvas class="portrait" width="160" height="160"></canvas><div class="dbody"><div class="dname"></div><div class="dtext"></div><div class="dchoices"></div><div class="dtimer"><div class="dtfill"></div></div><div class="dnext">▼</div></div></div>
      <div id="menus"></div>
      <div class="fade"></div><div class="loading-text"></div>`;
    const $ = (s) => root.querySelector(s);
    this.el = {
      hud: $('#hud'), obj: $('.objective'), objText: $('.obj-text'), hp: $('.bar.hp .fill'), hpGhost: $('.bar.hp .ghost'), st: $('.bar.st .fill'), vitals: $('.vitals'),
      weapon: $('.weapon'), wicon: $('.wicon'), arrows: $('.arrows'), meters: $('.meters'), crew: $('.crew-count .v'), cunning: $('.cunning .v'), wrath: $('.wrath .pips'),
      compass: $('.compass'), strip: $('.compass .strip'), stealth: $('.stealth'), stealthLabel: $('.stealth-label'), cross: $('.crosshair'),
      prompt: $('.prompt'), pkey: $('.prompt .key'), ptext: $('.prompt .ptext'), pring: $('.prompt .pring'), pfill: $('.prompt .pfill'),
      big: $('.bigprompt'), bigText: $('.bp-text'), bigSub: $('.bp-sub'), cling: $('.cling'), toasts: $('.toasts'), sub: $('.subtitle'), subWho: $('.subtitle .who'), subLine: $('.subtitle .line'),
      lbTop: $('.letterbox.top'), lbBot: $('.letterbox.bottom'), card: $('.chapter-card'), dlg: $('#dialogue'), menus: $('#menus'), fade: $('.fade'),
    };
    this.hudVisible = false;
    this.vitals = { hp: 100, maxHp: 100, stamina: 100, arrows: 0, weapon: 'sword', inCombat: false };
    this.vitalsShowT = 0; this.metersShowT = 0;
    this.subT = 0; this.menuStack = [];
    this.dialogueState = null;
    this._ghostHp = 100;
    this._lastObj = '';
    G.bus.on('crewLost', (e) => this._onCrewLost(e));
    G.bus.on('cunningChanged', (e) => { this.metersShowT = 4; this.el.cunning.textContent = e.value; if (e.delta > 0) this.toast(`Cunning +${e.delta}${e.why ? ' · ' + e.why : ''}`, 'cunning'); });
    G.bus.on('wrathChanged', (e) => { this.metersShowT = 5; this._renderWrath(e.value); if (e.delta > 0) this.toast(`Poseidon's Wrath rises${e.why ? ' · ' + e.why : ''}`, 'wrath'); });
    G.bus.on('favorChanged', (e) => { if (e.delta > 0) this.toast(`Athena's favor +${e.delta}${e.why ? ' · ' + e.why : ''}`, 'favor'); });
    G.bus.on('checkpoint', () => this.toast('Progress saved', 'save'));
    G.bus.on('padbutton', (i) => this._padNav(i));
    addEventListener('keydown', (e) => this._keyNav(e));
  }

  // ---------- HUD ----------
  showHUD(on) { this.hudVisible = on; this.el.hud.classList.toggle('hidden', !on); }
  setVitals(v) { Object.assign(this.vitals, v); }
  refreshMeters() {
    const s = G.state; if (!s) return;
    this.el.crew.textContent = `${s.alive().length}`;
    this.el.cunning.textContent = s.cunning;
    this._renderWrath(s.wrath);
  }
  flashMeters(t = 4) { this.metersShowT = t; this.refreshMeters(); }
  _renderWrath(v) { this.el.wrath.innerHTML = Array.from({ length: 10 }, (_, i) => `<i class="${i < v ? 'on' : ''}"></i>`).join(''); }

  setObjective(text) {
    if (text === this._lastObj) return;
    this._lastObj = text || '';
    const o = this.el.obj;
    if (!text) { o.classList.remove('show'); return; }
    o.classList.remove('show');
    setTimeout(() => { this.el.objText.textContent = text; o.classList.add('show', 'pulse'); setTimeout(() => o.classList.remove('pulse'), 1600); }, 250);
    G.audio?.play('ui');
  }

  prompt(text, action = 'interact', progress = null) {
    const p = this.el.prompt;
    if (!text) { p.classList.remove('show'); return; }
    this.el.pkey.textContent = G.input.label(action);
    this.el.ptext.textContent = text;
    p.classList.add('show');
    this.el.pring.style.display = progress === null ? 'none' : 'block';
    if (progress !== null) this.el.pfill.style.width = `${Math.round(progress * 100)}%`;
  }
  bigPrompt(text, sub = '') {
    const b = this.el.big;
    if (!text) { b.classList.remove('show'); return; }
    this.el.bigText.innerHTML = text; this.el.bigSub.innerHTML = sub;
    b.classList.add('show');
  }
  crosshair(on) { this.el.cross.classList.toggle('show', on); }
  setStealth(st) {
    const e = this.el.stealth;
    if (!st) { e.classList.remove('show'); return; }
    e.classList.add('show');
    e.style.setProperty('--vis', st.vis.toFixed(2));
    e.style.setProperty('--alert', st.alert.toFixed(2));
    e.classList.toggle('alert', st.alert > 0.5);
    e.classList.toggle('masked', !!st.masked);
    this.el.stealthLabel.textContent = st.label || '';
  }
  setCompass(items, heading) {
    const c = this.el.compass;
    if (!items) { c.classList.remove('show'); return; }
    c.classList.add('show');
    // Cardinals first, then the goal, then nearer places. Each label takes the first row where it
    // fits; one that fits nowhere shrinks to a tick, so labels never overlap.
    const rank = (m) => (m.cls === 'card' ? 0 : m.cls === 'goal' ? 1 : 2 + (m.dist ?? 1e6) / 1e6);
    const marks = [['N', 0], ['E', Math.PI / 2], ['S', Math.PI], ['W', -Math.PI / 2]].map(([n, a]) => ({ label: n, angle: a, cls: 'card' }))
      .concat(items).sort((a, b) => rank(a) - rank(b));
    const W = c.clientWidth || 460, rows = [[], []], out = [];
    for (const m of marks) {
      let d = m.angle - heading; d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) > 1.6) continue;
      const left = 50 + (d / 1.6) * 50;
      const half = ((m.label.length + (m.cls === 'goal' ? 2 : 0)) * 3.8 + 8) / W * 100;
      const row = rows.findIndex((r) => r.every(([a, b]) => left + half < a || left - half > b));
      if (row < 0) { out.push(`<span class="cm tick ${m.cls || ''}" style="left:${left}%"></span>`); continue; }
      rows[row].push([left - half, left + half]);
      out.push(`<span class="cm ${m.cls || ''}" style="left:${left}%;top:${5 + row * 18}px">${esc(m.label)}</span>`);
    }
    this.el.strip.innerHTML = out.join('');
  }
  cling(st) {
    const c = this.el.cling;
    if (!st) { c.classList.remove('show'); return; }
    c.classList.add('show');
    c.querySelector('.cl-label').textContent = st.label || '';
    c.querySelector('.cl-help').textContent = st.help || '';
    c.querySelector('.cl-mark').style.left = `${50 + st.balance * 50}%`;
    const z = c.querySelector('.cl-zone'); z.style.width = `${st.zone * 100}%`; z.style.left = `${50 - st.zone * 50}%`;
    c.querySelector('.cl-gfill').style.width = `${st.grip * 100}%`;
    c.classList.toggle('danger', !!st.danger);
  }

  toast(text, kind = '') {
    const t = h('div', `toast ${kind}`, esc(text));
    this.el.toasts.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 800); }, kind === 'loss' ? 5200 : 3200);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
  }

  _onCrewLost({ id, cause }) {
    const c = CREW.find((m) => m.id === id);
    if (!c) return;
    this.toast(`${c.name} is lost.`, 'loss');
    this.metersShowT = 6;
    this.refreshMeters();
    G.music?.stinger('loss');
  }

  subtitle(who, text, dur = 3.5) {
    if (who === 'Polyphemus') G.audio?.giantSpeak?.(text);
    if (!G.settings.subtitles && who) { this.subT = 0; return; }
    this.el.subWho.textContent = who ? who : '';
    this.el.subLine.textContent = text;
    this.el.sub.classList.add('show');
    this.el.sub.classList.toggle('narration', !who);
    this.subT = dur;
  }

  loading(text) { const e = this.root.querySelector('.loading-text'); e.textContent = text || ''; e.classList.toggle('show', !!text); }
  letterbox(on) { this.el.lbTop.classList.toggle('on', on); this.el.lbBot.classList.toggle('on', on); }

  fade(to = 1, seconds = 1, color = '#000') {
    const f = this.el.fade;
    f.style.background = color;
    f.style.transition = `opacity ${seconds}s ease`;
    f.style.opacity = to;
    return new Promise((r) => setTimeout(r, seconds * 1000 + 30));
  }

  async chapterCard(n, title, sub, hold = 3.2) {
    const c = this.el.card;
    c.querySelector('.cc-num').textContent = n ? `Chapter ${ROMAN[n]}` : '';
    c.querySelector('.cc-title').textContent = title;
    c.querySelector('.cc-sub').textContent = sub || '';
    c.classList.add('show');
    G.audio?.play('sting', { bus: 'music' });
    await new Promise((r) => setTimeout(r, hold * 1000));
    c.classList.remove('show');
    await new Promise((r) => setTimeout(r, 900));
  }

  // ---------- dialogue ----------
  // lines: [{ who: person, text, choices?: [{text, value, cunning?}], timed?: sec, defaultValue? }]
  dialogue(lines) {
    return new Promise((resolve) => {
      this.dialogueState = { lines, i: -1, resolve, result: null, typing: false };
      this.el.dlg.classList.remove('hidden');
      requestAnimationFrame(() => this.el.dlg.classList.add('show'));
      G.audio?.duck(true);
      this._nextLine();
    });
  }
  get inDialogue() { return !!this.dialogueState; }

  _nextLine() {
    const d = this.dialogueState;
    d.i++;
    if (d.i >= d.lines.length) {
      this.el.dlg.classList.remove('show');
      setTimeout(() => this.el.dlg.classList.add('hidden'), 300);
      G.audio?.duck(false);
      const r = d.resolve, res = d.result;
      this.dialogueState = null;
      G.input.clear();
      r(res);
      return;
    }
    const line = d.lines[d.i];
    const who = line.who || ODYSSEUS;
    const pc = this.el.dlg.querySelector('.portrait');
    const g = pc.getContext('2d'); g.clearRect(0, 0, 160, 160); g.drawImage(portrait(who, 160), 0, 0);
    this.el.dlg.querySelector('.dname').textContent = who.name;
    this.el.dlg.classList.toggle('giant', who.id === 'polyphemus');
    const textEl = this.el.dlg.querySelector('.dtext');
    textEl.textContent = '';
    this.el.dlg.querySelector('.dchoices').innerHTML = '';
    this.el.dlg.querySelector('.dtimer').style.display = 'none';
    this.el.dlg.querySelector('.dnext').style.opacity = 0;
    d.line = line; d.shown = 0; d.typing = true; d.text = line.text; d.blip = 0; d.wait = line.auto || 0; d.timer = 0;
    d.voice = who.voice || 1; d.whoId = who.id;
    if (who.id === 'polyphemus') G.audio?.giantSpeak?.(line.text);
  }

  _finishTyping() {
    const d = this.dialogueState;
    d.typing = false; d.shown = d.text.length;
    this.el.dlg.querySelector('.dtext').textContent = d.text;
    const line = d.line;
    if (line.choices) {
      const box = this.el.dlg.querySelector('.dchoices');
      box.innerHTML = '';
      line.choices.forEach((c, i) => {
        const b = h('button', 'choice', `<span class="num">${i + 1}</span>${esc(c.text)}`);
        b.onclick = () => this._choose(c);
        box.appendChild(b);
      });
      G.input.intentionalUnlock = !!document.pointerLockElement; G.input.unlockPointer();
      box.firstChild?.focus();
      if (line.timed) { d.timer = line.timed; d.timerMax = line.timed; this.el.dlg.querySelector('.dtimer').style.display = 'block'; }
    } else if (!line.auto) this.el.dlg.querySelector('.dnext').style.opacity = 1;
  }

  _choose(c) {
    const d = this.dialogueState; if (!d) return;
    G.audio?.play('uiConfirm');
    d.result = c.value;
    if (G.engine.scene?.pausable) G.input.lockPointer();
    if (c.then) d.lines.splice(d.i + 1, 0, ...c.then);
    this._nextLine();
  }

  _advance() {
    const d = this.dialogueState; if (!d) return;
    if (d.typing) { this._finishTyping(); return; }
    if (d.line.choices) return;
    G.audio?.play('ui');
    this._nextLine();
  }

  // ---------- generic choice overlay (big decisions) ----------
  choice({ title, sub = '', options, timeout = 0, defaultValue = null }) {
    return new Promise((resolve) => {
      const m = h('div', 'menu choice-menu');
      m.innerHTML = `<div class="choice-title">${esc(title)}</div><div class="choice-sub">${esc(sub)}</div><div class="choice-opts"></div>${timeout ? '<div class="choice-timer"><div class="ctf"></div></div>' : ''}`;
      const box = m.querySelector('.choice-opts');
      let done = false;
      G.input.intentionalUnlock = !!document.pointerLockElement; G.input.unlockPointer();
      const finish = (v) => { if (done) return; done = true; if (G.engine.scene?.pausable) G.input.lockPointer(); G.audio?.play('uiConfirm'); m.classList.remove('show'); setTimeout(() => m.remove(), 400); offKey(); resolve(v); };
      options.forEach((o) => {
        const b = h('button', 'big-choice', `<span class="bk">${esc(o.keyLabel || '')}</span><span class="bl">${esc(o.label)}</span><span class="bd">${esc(o.desc || '')}</span>`);
        b.onclick = () => finish(o.value);
        box.appendChild(b);
      });
      const offKey = G.bus.on('keydown', (code) => { const o = options.find((x) => x.code === code); if (o) finish(o.value); });
      this.el.menus.appendChild(m);
      requestAnimationFrame(() => m.classList.add('show'));
      box.firstChild?.focus();
      if (timeout) {
        const fill = m.querySelector('.ctf');
        const start = performance.now();
        const tick = () => { if (done) return; const k = 1 - (performance.now() - start) / (timeout * 1000); fill.style.width = `${Math.max(0, k) * 100}%`; if (k <= 0) finish(defaultValue); else requestAnimationFrame(tick); };
        tick();
      }
    });
  }

  // ---------- menus ----------
  _menu(cls, html) {
    const m = h('div', `menu ${cls}`, html);
    this.el.menus.appendChild(m);
    requestAnimationFrame(() => m.classList.add('show'));
    this.menuStack.push(m);
    setTimeout(() => m.querySelector('button:not([disabled])')?.focus(), 50);
    return m;
  }
  closeTop() {
    const m = this.menuStack.pop();
    if (!m) return;
    m.classList.remove('show');
    setTimeout(() => m.remove(), 350);
    if (m._onClose) m._onClose();
    setTimeout(() => this.menuStack[this.menuStack.length - 1]?.querySelector('button:not([disabled])')?.focus(), 60);
  }
  closeAll() { while (this.menuStack.length) this.closeTop(); }
  get menuOpen() { return this.menuStack.length > 0; }

  openTitle({ onNew, onContinue, hasSave }) {
    const m = this._menu('title-menu', `
      <div class="logo"><div class="logo-main">NOSTOS</div><div class="logo-rule"></div><div class="logo-sub">The Long Way Home</div></div>
      <div class="title-buttons">
        <button data-a="continue" ${hasSave ? '' : 'disabled'}>Continue</button>
        <button data-a="new">Begin the Voyage</button>
        <button data-a="chapters">Chapters</button>
        <button data-a="journal">Journal</button>
        <button data-a="settings">Settings</button>
        <button data-a="credits">Credits</button>
      </div>
      <div class="title-foot">Vertical slice · Chapter III: The Cave of the Cyclops</div>`);
    m.querySelector('.title-buttons').addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.a; if (!a) return;
      G.audio?.play('uiConfirm');
      if (a === 'new') onNew(); else if (a === 'continue') onContinue();
      else if (a === 'chapters') this.openChapters(onNew);
      else if (a === 'journal') this.openJournal();
      else if (a === 'settings') this.openSettings();
      else if (a === 'credits') this.openCredits();
    });
    m._isTitle = true;
    return m;
  }

  openPause({ onResume, onRestart, onQuit }) {
    const m = this._menu('pause-menu', `<div class="panel"><div class="ptitle">Paused</div><div class="meander"></div>
      <button data-a="resume">Resume</button><button data-a="journal">Journal</button><button data-a="settings">Settings</button>
      <button data-a="restart">Restart from checkpoint</button><button data-a="quit">Return to title</button></div>`);
    m._onClose = onResume;
    m.addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.a; if (!a) return;
      G.audio?.play('uiConfirm');
      if (a === 'resume') this.closeTop();
      else if (a === 'journal') this.openJournal();
      else if (a === 'settings') this.openSettings();
      else if (a === 'restart') { m._onClose = null; this.closeAll(); onRestart(); }
      else if (a === 'quit') { m._onClose = null; this.closeAll(); onQuit(); }
    });
  }

  openSettings() {
    const s = G.settings;
    const sel = (key, opts) => `<select data-k="${key}">${opts.map(([v, l]) => `<option value="${v}" ${String(s[key]) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    const rng = (key, min = 0, max = 1, step = 0.05) => `<input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${s[key]}">`;
    const chk = (key) => `<input type="checkbox" data-k="${key}" ${s[key] ? 'checked' : ''}>`;
    const m = this._menu('settings-menu', `<div class="panel wide"><div class="ptitle">Settings</div><div class="meander"></div>
      <div class="tabs"><button data-tab="gfx" class="on">Graphics</button><button data-tab="audio">Audio</button><button data-tab="controls">Controls</button><button data-tab="access">Accessibility</button></div>
      <div class="tab gfx on">
        <label>Quality preset ${sel('quality', Object.entries(QUALITY_PRESETS).map(([k, v]) => [k, v.name]))}</label>
        <p class="hint">Changing the preset reloads the current scene's shadows and effects. Shadows and resolution apply immediately.</p>
      </div>
      <div class="tab audio">
        <label>Master ${rng('masterVol')}</label><label>Music ${rng('musicVol')}</label><label>Effects ${rng('sfxVol')}</label><label>Ambience ${rng('ambVol')}</label><label>Voices ${rng('voiceVol')}</label>
      </div>
      <div class="tab controls">
        <label>Mouse sensitivity ${rng('sensitivity', 0.3, 2.5, 0.05)}</label><label>Gamepad sensitivity ${rng('padSensitivity', 0.3, 2.5, 0.05)}</label><label>Invert look Y ${chk('invertY')}</label><label>Bow aim assist (gamepad) ${chk('aimAssist')}</label>
        <div class="binds"></div><button data-a="resetbinds" class="small">Reset bindings</button>
      </div>
      <div class="tab access">
        <label>Difficulty ${sel('difficulty', [['story', 'Story'], ['normal', 'Hero'], ['hard', 'Legend']])}</label>
        <label>Subtitles ${chk('subtitles')}</label>
        <label>Reduce motion (camera shake, blur) ${chk('reduceMotion')}</label>
        <label>Reduce bright flashes (lightning, impacts, sun) ${chk('reduceFlashing')}</label>
        <label>Glare intensity ${rng('glare', 0, 1.5, 0.05)}</label>
        <label>Colorblind correction ${sel('colorblind', [['none', 'Off'], ['protanopia', 'Protanopia'], ['deuteranopia', 'Deuteranopia'], ['tritanopia', 'Tritanopia']])}</label>
        <label>Text speed ${rng('textSpeed', 0.5, 3, 0.25)}</label>
      </div>
      <button data-a="back">Back</button></div>`);
    const renderBinds = () => {
      const box = m.querySelector('.binds');
      box.innerHTML = Object.keys(ACTION_LABELS).map((a) => `<div class="bind"><span>${ACTION_LABELS[a]}</span><button data-bind="${a}">${Input.codeName(G.input.bindings[a][0])}</button></div>`).join('');
    };
    renderBinds();
    m.addEventListener('input', (e) => {
      const k = e.target.dataset.k; if (!k) return;
      const v = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'range' ? parseFloat(e.target.value) : e.target.value;
      s[k] = v;
      G.applySettings?.(k);
      Save.saveSettings(s);
    });
    m.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.tab) {
        m.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
        m.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.classList.contains(b.dataset.tab)));
        G.audio?.play('ui');
      } else if (b.dataset.bind) {
        const a = b.dataset.bind;
        b.textContent = 'Press a key…'; b.classList.add('wait');
        G.input.capture = (code) => {
          if (code === 'Escape') { renderBinds(); return; }
          const binds = { ...(s.bindings || {}) };
          binds[a] = [code, ...(DEFAULT_BINDINGS[a].slice(1).filter((c) => c !== code))];
          s.bindings = binds; G.input.setBindings(binds); Save.saveSettings(s); renderBinds(); G.audio?.play('uiConfirm');
        };
      } else if (b.dataset.a === 'resetbinds') { s.bindings = null; G.input.setBindings(null); Save.saveSettings(s); renderBinds(); }
      else if (b.dataset.a === 'back') { G.audio?.play('uiBack'); this.closeTop(); }
    });
  }

  openJournal() {
    const st = G.state;
    const crewHtml = CREW.map((c) => {
      const rec = st?.crew.find((r) => r.id === c.id);
      const lost = rec && !rec.alive;
      return `<div class="jcrew ${lost ? 'lost' : ''} ${c.party ? 'party' : ''}" data-id="${c.id}"><canvas width="96" height="96"></canvas><div class="jinfo"><div class="jname">${esc(c.name)}</div><div class="jrole">${esc(c.role)}</div><div class="jline">“${esc(c.line)}”</div><div class="jstatus">${lost ? `Lost — ${esc(rec.cause || 'the sea')}` : c.party ? 'Landing party' : 'With the ship'}</div></div></div>`;
    }).join('');
    const known = (st?.lore || ['war', 'nostos']);
    const loreHtml = LORE.map((l) => known.includes(l.id) ? `<div class="jlore"><div class="lt">${esc(l.title)}</div><div class="lb">${esc(l.text)}</div></div>` : `<div class="jlore locked"><div class="lt">Undiscovered</div><div class="lb">…</div></div>`).join('');
    const m = this._menu('journal-menu', `<div class="panel wide tall"><div class="ptitle">Journal</div><div class="meander"></div>
      <div class="tabs"><button data-tab="crew" class="on">Crew</button><button data-tab="lore">Lore</button><button data-tab="voyage">Voyage</button></div>
      <div class="tab crew on"><div class="jgrid">${crewHtml}</div></div>
      <div class="tab lore">${loreHtml}</div>
      <div class="tab voyage"><div class="jstats">
        <div><b>${st ? st.alive().length : 24}</b><span>crew aboard</span></div><div><b>${st?.cunning ?? 0}</b><span>Cunning</span></div>
        <div><b>${st?.wrath ?? 0}/10</b><span>Poseidon's Wrath</span></div><div><b>${st?.favor ?? 1}</b><span>Athena's favor</span></div><div><b>${st?.supplies ?? 70}</b><span>supplies</span></div></div></div>
      <button data-a="back">Back</button></div>`);
    m.querySelectorAll('.jcrew').forEach((el) => {
      const c = CREW.find((x) => x.id === el.dataset.id);
      el.querySelector('canvas').getContext('2d').drawImage(portrait(c, 96), 0, 0);
    });
    m.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.tab) { m.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b)); m.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.classList.contains(b.dataset.tab))); G.audio?.play('ui'); }
      else if (b.dataset.a === 'back') { G.audio?.play('uiBack'); this.closeTop(); }
    });
  }

  openChapters(onPlay) {
    const m = this._menu('chapters-menu', `<div class="panel wide tall"><div class="ptitle">The Voyage</div><div class="meander"></div><div class="chlist">
      ${CHAPTERS.map((c) => `<button class="ch ${c.playable ? '' : 'locked'}" data-n="${c.n}" ${c.playable ? '' : 'disabled'}>
        <span class="chn">${ROMAN[c.n]}</span><span class="cht">${esc(c.title)}<em>${esc(c.sub)}</em></span>
        <span class="chp">${c.palette.map((p) => `<i style="background:${p}"></i>`).join('')}</span><span class="chs">${c.playable ? 'Play' : 'In development'}</span></button>`).join('')}
      </div><button data-a="back">Back</button></div>`);
    m.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.n) { G.audio?.play('uiConfirm'); this.closeAll(); onPlay(); }
      else if (b.dataset.a === 'back') { G.audio?.play('uiBack'); this.closeTop(); }
    });
  }

  openCredits() {
    const m = this._menu('credits-menu', `<div class="panel"><div class="ptitle">Credits</div><div class="meander"></div>
      <p class="credits">NOSTOS: The Long Way Home<br><br>Inspired by Homer's <em>Odyssey</em>.<br>All models, textures, music, sound, and writing are original and generated procedurally in your browser.<br><br>Built with three.js and the Web Audio API.<br>Fonts: Cinzel and Cormorant Garamond (Google Fonts).</p>
      <button data-a="back">Back</button></div>`);
    m.addEventListener('click', (e) => { if (e.target.closest('button')) { G.audio?.play('uiBack'); this.closeTop(); } });
  }

  openSummary(data) {
    return new Promise((resolve) => {
      const lostNames = data.lost.map((id) => CREW.find((c) => c.id === id)?.name).filter(Boolean);
      const savedNames = data.saved.map((id) => CREW.find((c) => c.id === id)?.name).filter(Boolean);
      const m = this._menu('summary-menu', `<div class="panel wide"><div class="cc-num">Chapter ${ROMAN[data.n]} complete</div><div class="ptitle">${esc(data.title)}</div><div class="meander"></div>
        <div class="sum-grid">
          <div class="sum-col"><div class="sum-h">Came out of the cave</div><div class="names">${savedNames.map((n) => `<span>${esc(n)}</span>`).join('') || '<em>No one</em>'}</div></div>
          <div class="sum-col lost"><div class="sum-h">Remembered</div><div class="names">${lostNames.map((n) => `<span>${esc(n)}</span>`).join('') || '<em>None lost. Every man came home to the ship.</em>'}</div></div>
        </div>
        <div class="jstats"><div><b>+${data.cunning}</b><span>Cunning</span></div><div><b>${data.wrath}/10</b><span>Poseidon's Wrath</span></div><div><b>${esc(data.choice)}</b><span>Your choice</span></div></div>
        <p class="sum-epitaph">${esc(data.epitaph)}</p>
        <button data-a="go">Continue the voyage</button></div>`);
      m.addEventListener('click', (e) => { if (e.target.closest('button')) { G.audio?.play('uiConfirm'); this.closeTop(); resolve(); } });
    });
  }

  // ---------- navigation ----------
  _focusables() { const top = this.menuStack[this.menuStack.length - 1] || this.el.menus.querySelector('.choice-menu') || (this.dialogueState ? this.el.dlg : null); return top ? [...top.querySelectorAll('button:not([disabled]), input, select')].filter((e) => e.offsetParent !== null) : []; }
  _move(dir) { const f = this._focusables(); if (!f.length) return; const i = f.indexOf(document.activeElement); const n = f[(i + dir + f.length) % f.length]; n.focus(); G.audio?.play('ui'); }
  _keyNav(e) {
    if (G.input.capture) return;
    if (this.dialogueState) {
      const d = this.dialogueState;
      if (d.line?.choices && /^Digit[1-4]$/.test(e.code)) { const c = d.line.choices[+e.code.slice(5) - 1]; if (c) { if (d.typing) this._finishTyping(); this._choose(c); } return; }
      if (['Space', 'Enter', 'KeyE'].includes(e.code) && !(d.line?.choices && !d.typing)) { e.preventDefault(); this._advance(); return; }
    }
    if (!this.menuOpen && !this.el.menus.querySelector('.choice-menu')) return;
    if (e.code === 'ArrowDown') { e.preventDefault(); this._move(1); }
    else if (e.code === 'ArrowUp') { e.preventDefault(); this._move(-1); }
    else if (e.code === 'Escape' || e.code === 'Backspace') {
      const top = this.menuStack[this.menuStack.length - 1];
      if (top && !top._isTitle && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); G.audio?.play('uiBack'); this.closeTop(); }
    }
  }
  _padNav(i) {
    if (this.dialogueState) {
      const d = this.dialogueState;
      if (d.line?.choices && !d.typing) { if (i === 12) this._move(-1); else if (i === 13) this._move(1); else if (i === 0) document.activeElement?.click?.(); }
      else if (i === 0 || i === 3) this._advance();
      return;
    }
    if (!this.menuOpen && !this.el.menus.querySelector('.choice-menu')) return;
    if (i === 12) this._move(-1); else if (i === 13) this._move(1);
    else if (i === 0) document.activeElement?.click?.();
    else if (i === 1) { const top = this.menuStack[this.menuStack.length - 1]; if (top && !top._isTitle) this.closeTop(); }
  }

  // ---------- per-frame ----------
  update(dt) {
    const v = this.vitals;
    // Vitals fade in when hurt, tired, or fighting; fade out when calm.
    if (v.hp < v.maxHp - 0.5 || v.stamina < 99 || v.inCombat) this.vitalsShowT = 3;
    this.vitalsShowT -= dt; this.metersShowT -= dt;
    this.el.vitals.classList.toggle('show', this.vitalsShowT > 0);
    this.el.meters.classList.toggle('show', this.metersShowT > 0 || this.menuOpen);
    this.el.hp.style.width = `${(v.hp / v.maxHp) * 100}%`;
    this._ghostHp += (v.hp - this._ghostHp) * Math.min(1, dt * (this._ghostHp > v.hp ? 1.5 : 10));
    this.el.hpGhost.style.width = `${(this._ghostHp / v.maxHp) * 100}%`;
    this.el.st.style.width = `${v.stamina}%`;
    this.el.st.parentElement.classList.toggle('low', v.stamina < 20);
    this.el.wicon.textContent = v.weapon === 'bow' ? '➶' : '⚔';
    this.el.arrows.textContent = v.weapon === 'bow' ? `${v.arrows}` : '';
    if (this.subT > 0) { this.subT -= dt; if (this.subT <= 0) this.el.sub.classList.remove('show'); }

    const d = this.dialogueState;
    if (d && d.typing) {
      const speed = 42 * (G.settings.textSpeed || 1);
      d.shown += dt * speed;
      const n = Math.min(d.text.length, Math.floor(d.shown));
      const el = this.el.dlg.querySelector('.dtext');
      if (el.textContent.length !== n) {
        el.textContent = d.text.slice(0, n);
        d.blip += 1;
        if (d.blip % 3 === 0 && /\w/.test(d.text[n - 1] || '')) {
          if (d.whoId !== 'polyphemus') G.audio?.play('blip', { pitch: d.voice, bus: 'voice' });
          G.bus.emit('speakBlip', d.whoId);
        }
      }
      if (n >= d.text.length) this._finishTyping();
    } else if (d && d.line?.auto && !d.line.choices) {
      d.wait -= dt; if (d.wait <= 0) this._nextLine();
    } else if (d && d.timer > 0) {
      d.timer -= dt;
      this.el.dlg.querySelector('.dtfill').style.width = `${Math.max(0, d.timer / d.timerMax) * 100}%`;
      if (d.timer <= 0) {
        const def = d.line.choices.find((c) => c.value === d.line.defaultValue) || { value: d.line.defaultValue, then: d.line.timeoutThen };
        this._choose(def);
      }
    }
    if (d && !d.typing && !d.line?.choices && !d.line?.auto && (G.input.pressed('attack', 0.1))) this._advance();
  }
}
