import * as THREE from 'three';
import { G } from '../core/context.js';
import { TUNING } from '../core/Config.js';
import { Script, ABORT } from '../game/Script.js';
// Background beats are fire-and-forget; an aborted chapter (restart, jump) is not an error.
const quiet = (e) => { if (e !== ABORT) console.error(e); };
import { Particles } from '../render/Particles.js';
import { Player } from '../game/Player.js';
import { CrewMember } from '../game/Crew.js';
import { Boar } from '../game/Boar.js';
import { Cyclops } from '../game/Cyclops.js';
import { Exterior, Interior, CAVE, CAVE_MOUTH, SHIP_SPOT, PATH_X, exteriorHeight } from './CaveZones.js';
import { Mat, rockGeo, setShadows, cachedGeo } from '../assets/Assets.js';
import { CREW, crewById } from '../data/crew.js';
import { CHAPTERS } from '../data/chapters.js';
import * as D from '../data/dialogue.js';
import { clamp, damp, lerp, smoothstep, rand, pick } from '../core/math.js';

const CH = CHAPTERS[2];
const ORDER = ['landing', 'cave', 'stealth', 'climax', 'escape', 'run', 'choice'];
const STATIONS = [
  { pos: [3.5, -2.5], face: CAVE.hearth, act: 'tend', dur: 15 },
  { pos: [11.5, -4], face: CAVE.pen, act: 'milk', dur: 12 },
  { pos: [22, 7], face: CAVE.racks, act: 'eat', dur: 9 },
  { pos: [0, 26], face: new THREE.Vector3(0, 0, 0), act: 'listen', dur: 6 },
  { pos: [-9, -11], face: new THREE.Vector3(-30, 0, 0), act: 'listen', dur: 6 },
];
const SHEEP_PATH = new THREE.CatmullRomCurve3([[13, -1.5], [9, 8], [5.5, 17], [4.2, 25], [4.2, 32], [4.2, 46]].map(([x, z]) => new THREE.Vector3(x, 0, z)));
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

// Chapter III: The Cave of the Cyclops. Built backward from its climax: the stake.
export class CaveChapter {
  constructor(cp = 'landing') {
    this.cp = ORDER.includes(cp) ? cp : 'landing';
    this.pausable = true;
    this.script = new Script();
    this.fx = new Particles(3200);
    G.fx = this.fx;
    this.token = { owner: null };
    this.ext = new Exterior(this);
    this.int = new Interior(this);
    this.player = new Player();
    this.cyclops = new Cyclops();
    this.cyclops.hurt = (dmg, dir, info) => this._giantHurt(info);
    this.crew = CREW.filter((c) => c.party && G.state.isAlive(c.id)).map((c, i) => new CrewMember(c, i));
    this.boars = [];
    this.boulders = [];
    this.markers = [];
    this.flags = G.state.flags;
    if (!this.flags.ch3) this.flags.ch3 = { cunning: G.state.cunning, wrath: G.state.wrath, alive: CREW.filter((m) => m.party).map((m) => m.id) };
    this.obj = null;
    this.hints = new Set();
    this.ai = { mode: 'routine', idx: 0, at: false, walking: false, t: 0, walkId: 0 };
    this.mouthGlow = 1;
    this._setupInteractables();
    this._offDeath = G.bus.on('playerDied', () => this._onDeath());
  }

  // ---------- lifecycle ----------
  enter() {
    G.ui.showHUD(true); G.ui.refreshMeters();
    G.rig.shoulder = 0.55; G.rig.dist = 5.2; G.rig.height = 1.6; G.rig.fov = 55; G.rig.fovAdd = 0; G.rig.minPitch = -0.55; G.rig.maxPitch = 1.15; G.rig.big = null; G.rig.lockTarget = null; G.rig.avoidSun = true;
    G.post.base.god = 0; G.post.base.edgeBlur = 0; G.post.base.vignetteAdd = 0; G.post.base.satMul = 1; G.post.base.exposure = 1; G.post.base.heat = 0;
    G.music.setKey(52, 'phrygian');
    // Configure the starting zone synchronously so the engine renders the right scene.
    const interior = ['cave', 'stealth', 'climax', 'escape'].includes(this.cp);
    this.setZone(interior ? this.int : this.ext);
    this.script.run(() => this._runFrom(this.cp));
  }
  exit() {
    this.script.cancel();
    this._offDeath();
    G.music.setHeartbeat(0);
    G.engine.setTimeScale(1, 100);
    this.ext.env?.dispose(); this.int.env?.dispose();
    this.ext.ocean.dispose(); this.ext.atm.dispose();
    G.input.unlockPointer();
  }
  async _runFrom(cp) {
    for (let i = ORDER.indexOf(cp); i < ORDER.length; i++) await this[ORDER[i]]();
    await this._finish();
  }

  setZone(z) {
    this.zone = z;
    this.threeScene = z.scene;
    z.scene.add(this.fx.group);
    this.player.setZone(z);
    for (const c of this.crew) c.setZone(z);
    G.post.setScene(z.scene);
    G.rig.collide = z === this.ext ? this._camExt : this._camInt;
    if (z === this.int) { G.audio.cracklePos = CAVE.hearth.clone().setY(1); G.audio.dripPos = new THREE.Vector3(0, 8, 0); G.audio.setReverb(0.85); G.audio.setReverbType('cave'); }
    else { G.audio.cracklePos = null; G.audio.setReverb(0.2); G.audio.setReverbType('open'); }
  }

  followCam(yaw) {
    G.rig.follow(this.player.pos, { snap: true, yaw: yaw ?? this.player.yaw });
    G.rig.dist = 5.2; G.rig.shoulder = 0.55; G.rig.height = 1.6; G.rig.fov = 55;
  }

  _camExt = (pivot, desired, dist) => {
    for (let i = 1; i <= 8; i++) {
      const t = i / 8;
      if (exteriorHeight(lerp(pivot.x, desired.x, t), lerp(pivot.z, desired.z, t)) + 0.5 > lerp(pivot.y, desired.y, t)) return Math.max(1.2, dist * (t - 0.12));
    }
    return dist;
  };
  _camInt = (pivot, desired, dist) => {
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      const x = lerp(pivot.x, desired.x, t), y = lerp(pivot.y, desired.y, t), z = lerp(pivot.z, desired.z, t);
      const r = Math.hypot(x, z);
      const ceil = 27 * Math.sqrt(Math.max(0, 1 - (r * r) / 1849));
      if ((r > 36.5 && !(Math.abs(x) < 4 && z > 30)) || y > ceil - 0.8) return Math.max(1.2, dist * (t - 0.1));
      for (const o of this.int.obstacles) if (o.sight && !o.off && o.r > 1.5 && Math.hypot(x - o.x, z - o.z) < o.r) return Math.max(1.2, dist * (t - 0.1));
      if (this.cyclops.zone === this.int) { const lying = this.cyclops.lying > 0.5; if (y < (lying ? 3.2 : 8.5)) for (const c of this.int.giantCircles()) if (Math.hypot(x - c.x, z - c.z) < c.r + 0.4) return Math.max(1.0, dist * (t - 0.1)); }
    }
    return dist;
  };

  // ---------- helpers ----------
  // Every roar: silence first (the voice chain ducks the mix), then shake, falling dust, a fire flare and rumble on the attack.
  giantRoar(o = {}) {
    G.giantVoicePos = this.cyclops.headWorld(new THREE.Vector3());
    const delay = G.audio.giantRoar(o) || 0, k = o.intensity ?? 1;
    this.cyclops.roarT = delay + (o.dur ?? 1.6);
    setTimeout(() => {
      if (this.script.cancelled) return;
      G.rig.addTrauma(Math.min(1, 0.45 * k + (o.scream ? 0.45 : 0)));
      G.input.rumble(Math.min(1, 0.8 * k), 0.4, 600 + 300 * k);
      G.post.kick({ ca: 0.7 * k, radial: 0.4 * k });
      if (this.zone === this.int) {
        this.int.fire.flare = 0.9 * k;
        for (let i = 0; i < 10 * k; i++) { const a = Math.random() * 6.28, r = Math.random() * 30; this.fx.emit('dust', new THREE.Vector3(Math.cos(a) * r, 19, Math.sin(a) * r), 4, { gravity: -6, up: [-1, 0] }); }
      }
    }, delay * 1000);
    return delay;
  }
  alive(id) { return G.state.isAlive(id) && this.crew.some((c) => c.id === id); }
  member(id) { return this.crew.find((c) => c.id === id); }
  // Fire-and-forget barks must not surface aborted waits; awaited calls still stop on abort.
  say(id, text, dur = 3.6) { const p = this._say(id, text, dur); p.catch(() => {}); return p; }
  async _say(id, text, dur = 3.6) {
    if (id === 'odysseus') G.ui.subtitle('Odysseus', text, dur);
    else if (this.alive(id)) this.member(id).say(text, dur);
    else return;
    await this.script.wait(dur * 0.9);
  }
  async sayAny(pref, text, dur) { const id = pref.find((p) => this.alive(p)) || this.crew[0]?.id; if (id) await this.say(id, text, dur); }
  setObj(key, text) { this.obj = key; G.ui.setObjective(text); }
  hint(key, text) { if (this.hints.has(key)) return; this.hints.add(key); G.ui.toast(text, ''); }
  label(a) { return G.input.label(a); }
  lockControl(on) { this.player.control = !on; if (on) { this.player.vel.set(0, 0, 0); G.ui.prompt(null); } }

  // ---------- simulation ----------
  fixedUpdate(dt) {
    this.script.update(dt);
    const p = this.player;
    p.fixedUpdate(dt);
    const ctx = { player: p, nav: this.zone.nav, crew: this.crew };
    for (const c of this.crew) if (c.zone === this.zone) c.fixedUpdate(dt, ctx);
    if (this.zone === this.ext) for (const b of this.boars) b.fixedUpdate(dt, { player: p, token: this.token, crew: this.crew, alerted: this.boarsAlerted, onAlert: () => this._boarsAlert() });
    if (this.cyclops.zone === this.zone) this.cyclops.fixedUpdate(dt, { player: p, vis: this.zone === this.int ? this.int.light(p.pos.x, p.pos.z) : 1 });
    this._updateBoulders(dt);
    if (this.stealthOn) this._stealthAI(dt);
    if (this.flailOn) this._flailAI(dt);
  }

  update(dt, realDt, alpha) {
    const z = this.zone;
    z.update(dt, G.camera, this.player.pos);
    this.player.render(alpha, dt);
    for (const c of this.crew) if (c.zone === z) c.render(alpha, dt);
    for (const b of this.boars) b.render(alpha, dt);
    if (this.cyclops.zone === z) { this.cyclops.render(alpha, dt); G.giantVoicePos = this.cyclops.headWorld(G.giantVoicePos || new THREE.Vector3()); }
    if (this.staffCarried) this._poseStaff();
    this._updateGuide(realDt);
    if (this.held) this._holdUpright(this.held);
    for (const m of this.markers) { m.t += dt; m.mesh.material.opacity = Math.min(0.85, m.t / m.dur) * (0.6 + 0.4 * Math.sin(m.t * 18)); m.mesh.scale.setScalar(0.4 + 0.6 * Math.min(1, m.t / m.dur)); }
    if (this.eyeSmoke && Math.random() < dt * 8) this.fx.emit('wisp', this.cyclops.eyeWorld(_v), 1, { scale: 1.5 });
    const look = G.ui.menuOpen || G.ui.inDialogue ? null : G.input.consumeLook();
    G.rig.update(realDt, look);
    this.fx.update(dt, G.camera);
    this._hud();
    if (this.climaxOn) this._climaxUpdate(dt);
    if (this.clingOn) this._clingUpdate(dt, realDt);
    if (this.heatSource) { const d = this.player.pos.distanceTo(this.heatSource); G.post.base.heat = (1 - smoothstep(1.5, 6, d)) * 0.8; }
  }

  _hud() {
    if (this.stealthOn && this.zone === this.int) {
      const p = this.player, vis = this.int.light(p.pos.x, p.pos.z) * (p.crouch ? 0.6 : 1), g = this.cyclops;
      G.ui.setStealth({ vis, alert: clamp(g.suspicion), masked: g.masking, label: g.masking ? 'his noise covers yours' : vis < 0.22 ? 'hidden' : vis > 0.55 ? 'exposed' : '' });
    } else G.ui.setStealth(null);
  }

  onNoise(pos, radius, kind) {
    if (this.cyclops.zone === this.zone && (this.stealthOn || this.flailOn)) {
      this.cyclops.hear(pos, radius);
      if (this.flailOn) this.lastNoise = { pos: pos.clone(), t: G.engine.gameTime };
    }
    if (this.zone === this.ext && !this.boarsAlerted) for (const b of this.boars) if (b.alive && b.pos.distanceTo(pos) < radius * 1.5) { this._boarsAlert(); break; }
  }

  async _onDeath() {
    if (this._dying) return;
    this._dying = true;
    G.music.setMood('silence', 1.5);
    G.ui.subtitle(null, 'The thread is cut... but the Fates spin again.', 3);
    await new Promise((r) => setTimeout(r, 2600));
    G.flow.restart();
  }

  // ---------- interactables ----------
  _setupInteractables() {
    const I = this.int, E = this.ext, f = this.flags;
    E.interactables.push({
      pos: E.altarPos, radius: 2.6, label: 'Pour a little wine for the gods', enabled: () => !f.altar,
      action: () => { f.altar = true; this.player.heal(100); G.state.addFavor(1, 'An offering at the altar'); G.music.stinger('discover'); this.fx.emit('magic', E.altarPos.clone().setY(E.altarPos.y + 1.4), 50, { spread: 1.2 }); G.ui.subtitle(null, 'The wine sinks into the stone. Something unseen is pleased.', 4); },
    });
    I.interactables.push(
      { pos: CAVE.fresco.clone().multiplyScalar(0.93), radius: 3.2, label: 'Study the painting', enabled: () => !f.fresco && !this.flailOn && !this.clingOn,
        action: () => { f.fresco = true; G.state.lore.includes('fresco_giant') || G.state.lore.push('fresco_giant'); G.ui.toast('Journal: Fresco: The Shepherd', 'discover'); G.ui.subtitle(null, 'Kneeling figures with gifts. Their faces have been scratched away.', 4); } },
      { pos: CAVE.staff, radius: 3.2, label: 'Take up the olive staff', enabled: () => this.obj === 'staff',
        action: () => { this.carryStaff(true); f.staff = true; G.audio.play('pickup'); } },
      { pos: CAVE.whet, radius: 3, label: 'Sharpen the staff', enabled: () => this.obj === 'sharpen' && this.staffCarried,
        get hold() { return Math.max(0.6, 7 - (f.sharpen || 0)); }, progress: () => (f.sharpen || 0) / 7,
        onTick: (dt) => { f.sharpen = (f.sharpen || 0) + dt; this._scrapeT = (this._scrapeT || 0) - dt; if (this._scrapeT <= 0) { this._scrapeT = 0.55; G.audio.play('scrape', { pos: this.player.pos, vol: 0.9 }); this.onNoise(this.player.pos, TUNING.player.noise.scrape, 'scrape'); this.fx.emit('spark', this.player.pos.clone().setY(this.player.pos.y + 0.8), 3); } },
        action: () => { f.sharpened = true; } },
      { pos: CAVE.whet, radius: 3, label: 'Take up the sharpened stake', enabled: () => this.obj === 'take',
        action: () => { this.carryStaff(true); f.carry = true; G.audio.play('pickup'); } },
      { pos: CAVE.hearth, radius: 3.8, label: 'Harden the point in the embers', hold: 3.5, enabled: () => this.obj === 'harden' && this.staffCarried,
        onStart: () => G.audio.play('sizzle', { pos: CAVE.hearth }),
        onTick: (dt, k) => { this.int.staff.tip.material.emissiveIntensity = k * 3; if (Math.random() < dt * 20) this.fx.emit('ember', this.player.pos.clone().setY(this.player.pos.y + 0.9), 2); },
        action: () => { f.hardened = true; } },
      { pos: new THREE.Vector3(), radius: 2.6, label: 'Cling beneath the great ram', enabled: () => this.obj === 'ram', isRam: true, action: () => this._startCling() },
    );
  }

  carryStaff(on) {
    const st = this.int.staff;
    this.staffCarried = on;
    this.player.carry = on ? { slow: true } : null;
    this.player.weapon = 'sword';
    st.tip.visible = !!this.flags.sharpened;
    if (on) { this.player.root.add(st.group); st.group.scale.setScalar(0.6); }
    else { this.int.scene.attach(st.group); st.group.scale.setScalar(1); }
  }
  // A seized man hangs upright in the giant's fist, facing the eye.
  _holdUpright(v) {
    const hand = this.cyclops.model.rHand;
    hand.updateWorldMatrix(true, false);
    const hq = hand.getWorldQuaternion(new THREE.Quaternion());
    const g = this.cyclops, e = g.eyeWorld(new THREE.Vector3()), hp = hand.getWorldPosition(new THREE.Vector3());
    const want = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(e.x - hp.x, e.z - hp.z), 0));
    v.root.quaternion.copy(hq.invert().multiply(want));
    // Fist closes round his waist: grip point in world space, then hang the body 1 m below it.
    const grip = hand.localToWorld(this.cyclops.model.gripOffset.clone());
    v.root.position.copy(hand.worldToLocal(grip.add(new THREE.Vector3(0, -1.0, 0))));
  }

  _poseStaff() {
    const g = this.int.staff.group;
    g.position.set(0.05, 1.05, 0.9);
    g.rotation.set(0, -Math.PI / 2, 0.08 + Math.sin(G.engine.gameTime * 6) * 0.01 * Math.min(1, this.player.vel.length()));
  }

  // =====================================================================
  // 1. LANDFALL AT DUSK
  // =====================================================================
  async landing() {
    const s = this.script, E = this.ext, p = this.player;
    if (this.zone !== E) this.setZone(E);
    G.state.saveCheckpoint('landing');
    E.atm.setPreset('dusk'); E.rebakeEnv();
    G.post.setGrade('dusk', 0.1); G.post.base.god = 0.55; G.post.base.bloom = 0.6;
    G.audio.setAmbience({ waves: 0.9, surf: 0.8, wind: 0.5, gulls: 0.4 });
    G.music.setMood('explore', 3);
    p.place(PATH_X(97) + 1, 97, Math.PI);
    this.crew.forEach((c, i) => c.place(3 + (i % 4) * 1.6, 100 + Math.floor(i / 4) * 1.5, Math.PI));
    this._spawnBoars();

    this.lockControl(true);
    G.ui.letterbox(true);
    G.rig.fov = 50;
    const mpos = new THREE.Vector3(0, 30, -80);
    await G.rig.playShot({ pos: [new THREE.Vector3(30, 6, 175), new THREE.Vector3(18, 9, 150), new THREE.Vector3(8, 6, 124)], look: [mpos, new THREE.Vector3(0, 22, -40), new THREE.Vector3(0, 6, 60)], duration: 8, fov: 50 });
    const card = G.ui.chapterCard(3, CH.title, CH.sub, 3.4);
    await s.waitReal(1.5);
    this.followCam(Math.PI);
    G.ui.letterbox(false);
    await card;
    this.lockControl(false);
    G.input.lockPointer();
    this.crew.forEach((c) => c.follow());
    this.setObj('mountain', 'Find whoever keeps the fire on the mountain');
    this.hint('move', `Move ${this.label('forward')}${this.label('left')}${this.label('back')}${this.label('right')} · Sprint ${this.label('sprint')} · Mouse to look`);
    for (const [id, line] of D.BARKS.landing) { await this.say(id, line, 4); await s.wait(0.6); }
    G.state.lore.includes('maron') || G.state.lore.push('maron');

    await s.until(() => this.boarsAlerted || p.pos.z < 60);
    if (!this.boarsAlerted) this._boarsAlert();
    await s.until(() => this.boars.every((b) => !b.alive) || p.pos.z < -20);
    this.zone.inCombat = false;
    if (this.boars.every((b) => !b.alive)) {
      G.music.setMood('explore', 4); G.music.stinger('triumph');
      await s.wait(1.2);
      const [id, line] = D.BARKS.boarsDone; await this.say(id, line, 4);
    }
    this.setObj('path', 'Follow the path up to the cave');
    await s.until(() => p.pos.z < -28);
    { const [id, line] = D.BARKS.mouth; this.say(id, line, 4); }
    await s.until(() => Math.hypot(p.pos.x - CAVE_MOUTH.x, p.pos.z - (CAVE_MOUTH.z + 3)) < 4);
    this.lockControl(true);
    await G.ui.fade(1, 0.9);
  }

  _spawnBoars() {
    this.boars = [new THREE.Vector3(PATH_X(70) + 12, 0, 72), new THREE.Vector3(-8, 0, 40), new THREE.Vector3(11, 0, 34)].map((h) => {
      const b = new Boar(h); b.setZone(this.ext); return b;
    });
    this.ext.enemies = this.boars;
    this.ext.token = this.token;
    this.ext.onEnemyDied = () => { if (this.boars.every((b) => !b.alive)) this.zone.inCombat = false; };
  }
  _boarsAlert() {
    if (this.boarsAlerted) return;
    this.boarsAlerted = true;
    this.ext.inCombat = true;
    G.music.setMood('combat', 1.5);
    const [id, line] = D.BARKS.boars; this.say(id, line, 3.5);
    setTimeout(() => this.hint('block', `Hold ${this.label('alt')} to raise your shield. Raise it just as they strike to PARRY.`), 900);
    setTimeout(() => this.hint('dodge', `${this.label('dodge')} to roll through a charge · ${this.label('attack')} to strike`), 5000);
    setTimeout(() => this.hint('bow', `${this.label('weapon')} switches to the bow · ${this.label('lock')} locks on`), 11000);
    for (const b of this.boars) if (b.state === 'idle' && b.pos.distanceTo(this.player.pos) < 45) b.set('alert');
  }

  // =====================================================================
  // 2. THE EMPTY CAVE, THEN: HIDE!
  // =====================================================================
  async cave() {
    const s = this.script, I = this.int, p = this.player;
    this.setZone(I);
    I.fire.level = 0.22; I.setDoor(1, '#ff9a5a'); I.doorSpotI = 320; I.shaftMat.uniforms.uI.value = 1;
    G.state.saveCheckpoint('cave');
    G.post.setGrade('cave', 0.1); G.post.base.god = 0; G.post.base.bloom = 0.42;
    G.audio.setAmbience({ cave: 0.8, fire: 0.25, crackle: 0.25, drips: 0.6, wind: 0.15 });
    G.music.setMood('stealth', 3);
    p.place(1, 33, Math.PI);
    this.crew.forEach((c, i) => { c.place(-3 + (i % 4) * 2, 35 + Math.floor(i / 4) * 1.4, Math.PI); c.follow(); });
    this.followCam(Math.PI);
    await G.ui.fade(0, 1.6);
    this.lockControl(false);
    G.input.lockPointer();
    this.setObj('explore', 'Explore the cave');
    G.state.lore.includes('cyclopes') || G.state.lore.push('cyclopes');
    await s.wait(1.5);
    // The men spread out to look and loot
    const loot = [[24, 6], [27, 15], [12, -3], [-4, 8], [6, -15], [-12, -10], [20, 3], [-6, 14], [10, 12], [22, -20], [-15, 6], [3, -8]];
    this.crew.forEach((c, i) => c.goTo(loot[i % loot.length][0], loot[i % loot.length][1]));
    await s.until(() => p.pos.z < 22 || s.t > 12);
    await s.wait(1.5);
    this.lockControl(true);
    const choice = await G.ui.dialogue(D.caveChoice((id) => this.alive(id)));
    this.lockControl(false);
    this.flags.leave = choice === 'leave';
    if (this.flags.leave) { G.state.addCunning(1, 'Caution'); this.crew.forEach((c, i) => c.goTo(-3 + (i % 4) * 2, 28 + Math.floor(i / 4))); this.setObj('leave', 'Gather the men and leave'); await s.wait(5); }
    else { this.setObj('wait', 'Wait for the master of the cave'); await s.wait(8); }

    // --- The quake: footsteps on the mountain
    const greedyIds = ['antiphus', 'elpenor'].filter((id) => this.alive(id));
    while (greedyIds.length < 2 && this.crew.length > greedyIds.length + 1) { const c = this.crew.find((m) => !greedyIds.includes(m.id) && m.id !== 'eurylochus'); if (!c) break; greedyIds.push(c.id); }
    const spots = I.hideSpots.slice();
    const greedy = greedyIds.map((id) => this.member(id));
    G.audio.play('giantStep', { vol: 0.5 }); G.rig.addTrauma(0.2);
    await s.wait(0.6);
    await this.sayAny(['eurylochus', 'kallias'], 'Footsteps. Gods... HIDE! Into the shadows, all of you!', 3);
    this.setObj('hide', 'HIDE! Get every man into the shadows by the west wall');
    for (const c of this.crew) c.model.setExpression('fear', 0.8);
    this.hint('crouch', `${this.label('crouch')} to crouch. Darkness hides you. Light betrays you.`);
    G.music.setMood('tension', 1);
    let si = 0;
    for (const c of this.crew) {
      if (greedy.includes(c)) continue;
      const sp = spots[si++ % spots.length];
      c.goTo(sp.x, sp.z, { run: true }).then(() => { c.crouch = true; c.hidden = true; c.state = 'hide'; c.faceYaw = Math.atan2(-sp.x, -sp.z); });
    }
    const greedyPull = [];
    greedy.forEach((c, k) => {
      const at = k === 0 ? [25.5, 7.5] : [28, 14];
      c.goTo(at[0], at[1], { run: true });
      const it = { pos: c.pos, radius: 2.4, label: `Pull ${c.data.name} into the shadows`, enabled: () => !c.hidden && !c.pulled,
        action: () => { c.pulled = true; this.player.model.play('pull'); const sp = spots[si++ % spots.length]; c.say('Sorry, my king!', 1.6); c.goTo(sp.x, sp.z, { run: true }).then(() => { c.crouch = true; c.hidden = true; c.state = 'hide'; }); } };
      I.interactables.push(it); greedyPull.push(it);
    });
    setTimeout(() => { if (greedy[0] && !greedy[0].pulled) greedy[0].say(D.BARKS.greedy[0][1], 3); }, 2500);
    setTimeout(() => { if (greedy[1] && !greedy[1].pulled) greedy[1].say(D.BARKS.greedy[1][1], 3); }, 7000);
    const diffK = G.settings.difficulty === 'story' ? 1.4 : G.settings.difficulty === 'hard' ? 0.8 : 1;
    const hideTime = (this.flags.leave ? 25 : 20) * diffK;
    const t0 = s.t;
    let stepT = 0;
    await s.until(() => {
      const k = (s.t - t0) / hideTime;
      stepT -= 1 / 60;
      if (stepT <= 0) {
        stepT = lerp(1.9, 1.05, k);
        G.audio.play('giantStep', { vol: 0.3 + k * 1.1, reverb: 0.5 }); G.rig.addTrauma(0.08 + k * 0.25); G.input.rumble(0.3 + k * 0.5, 0.1, 140);
        for (let i = 0; i < 3; i++) { const a = Math.random() * 6.28, r = Math.random() * 30; this.fx.emit('dust', new THREE.Vector3(Math.cos(a) * r, 18, Math.sin(a) * r), 3, { gravity: -6, up: [-1, 0], scale: 0.6 }); }
      }
      return k >= 1;
    });
    for (const it of greedyPull) I.interactables.splice(I.interactables.indexOf(it), 1);

    // --- He arrives: silhouette in the doorway, the boulder seals the cave
    this.lockControl(true);
    G.ui.setObjective(null);
    G.ui.letterbox(true);
    const g = this.cyclops;
    g.setZone(I);
    g.place(0, 47, Math.PI); g.setActivity('idle');
    G.rig.setStatic(new THREE.Vector3(1.5, 1.4, 14), new THREE.Vector3(0, 6.5, 40), 0);
    G.rig.fov = 44;
    G.music.setMood('dread', 0.5); G.music.stinger('dread');
    await g.walkTo(0, 31, 2.0);
    G.audio.play('grunt', { pos: g.headWorld(), pitch: 0.35, vol: 1.4 });
    g.face(0, 50);
    await s.wait(1.4);
    g.setActivity('roll');
    G.audio.play('boulder', { pos: I.boulder.position, dur: 2.8, ref: 10 });
    const d0 = s.t;
    await s.until(() => { const k = clamp((s.t - d0) / 2.6); I.setDoor(1 - k * k); G.rig.addTrauma(0.03); return k >= 1; });
    G.audio.play('impact', { pos: I.boulder.position, size: 1.6, ref: 12 }); G.rig.addTrauma(0.8); G.input.rumble(1, 1, 500);
    this.fx.emit('dust', I.boulder.position.clone().setY(1), 60, { scale: 2.5, speed: [3, 9] });
    G.post.kick({ ca: 0.6, radial: 0.5 });
    await s.wait(1.6);
    g.setActivity('idle');
    g.face(0, 0);
    G.rig.setStatic(new THREE.Vector3(-9, 3, 12), new THREE.Vector3(1, 3, -1), 1.5);
    await g.walkTo(STATIONS[0].pos[0], STATIONS[0].pos[1], 2.2);
    g.face(CAVE.hearth.x, CAVE.hearth.z); g.setActivity('tend');
    const f0 = s.t;
    G.audio.play('whoosh', { pos: CAVE.hearth, vol: 1.2 });
    await s.until(() => { I.fire.level = lerp(0.22, 1, clamp((s.t - f0) / 2.5)); return s.t - f0 > 2.5; });
    G.ui.subtitle('Polyphemus', 'Mm. Something has been at my cheeses...', 3.5);
    await s.wait(2);
    // Anyone caught in the open is taken.
    for (const c of greedy) if (c && !c.hidden && this.crew.includes(c)) { await this._seize(c, 'caught among the cheeses'); }
    g.walkTo(STATIONS[0].pos[0], STATIONS[0].pos[1], 2.2).then(() => { g.face(CAVE.hearth.x, CAVE.hearth.z); g.setActivity('tend'); });
    G.ui.letterbox(false);
    await this.sayAny(['kallias', 'polites'], D.BARKS.hidden[1], 2.5);
  }

  // =====================================================================
  // 3. STEALTH: the staff, the whetstone, the wine
  // =====================================================================
  _prepStealthWorld() {
    const I = this.int, g = this.cyclops;
    if (this.zone !== I) this.setZone(I);
    I.setDoor(0); I.fire.level = 1; I.shaftMat.uniforms.uI.value = 1; I.moon.intensity = 2600;
    if (g.zone !== I) { g.setZone(I); g.place(STATIONS[0].pos[0], STATIONS[0].pos[1], 0); g.face(CAVE.hearth.x, CAVE.hearth.z); g.setActivity('tend'); }
    this.crew.forEach((c, i) => { const sp = I.hideSpots[i % I.hideSpots.length]; if (!c.hidden) c.place(sp.x, sp.z, Math.atan2(-sp.x, -sp.z)); c.crouch = true; c.hidden = true; c.state = 'hide'; c.faceYaw = Math.atan2(-sp.x, -sp.z); });
    G.post.setGrade('cave', 1); G.post.base.bloom = 0.42;
    G.audio.setAmbience({ cave: 0.8, fire: 0.6, crackle: 0.6, drips: 0.5 });
  }

  async stealth() {
    const s = this.script, I = this.int, p = this.player, g = this.cyclops, f = this.flags;
    const fromCheckpoint = this.cp === 'stealth';
    this._prepStealthWorld();
    if (fromCheckpoint) { p.place(-27, -2, Math.PI / 2); this.followCam(Math.PI / 2); await G.ui.fade(0, 1.4); }
    G.state.saveCheckpoint('stealth');
    this.lockControl(false); G.input.lockPointer();
    G.rig.follow(p.pos);
    G.music.setMood('stealth', 2);
    this.stealthOn = true; g.perception = true;
    this.ai = { mode: 'routine', idx: 0, at: true, walking: false, t: 0, walkId: 0 };
    this.hint('stealth', 'Watch the eye above you. The more it opens, the more he sees.');

    if (!f.sharpened) {
      if (!f.staff) {
        this.setObj('staff', 'Find something that could wound a giant');
        await s.until(() => p.pos.distanceTo(CAVE.staff) < 9 || f.staff);
        if (!f.staff) { const [id, line] = D.BARKS.staff; this.say(id, line, 4.5); }
        await s.until(() => f.staff);
      } else this.carryStaff(true);
      this.setObj('sharpen', 'Sharpen the staff in the dark alcove. Scrape only while he makes noise');
      const [id, line] = D.BARKS.sharpen; this.say(id, line, 4);
      this.hint('mask', 'While he hums at the fire, milks, or eats, his own noise covers yours.');
      this.hint('sharpenHow', `Carry the staff to the whetstone in the dark alcove left of the entrance (look for the faint glowing ring) and hold ${this.label('interact')}. Let go if he falls silent; your progress is kept.`);
      await s.until(() => f.sharpened);
      this.carryStaff(false);
      const st = I.staff.group; st.position.set(CAVE.whet.x + 1, 0.25, CAVE.whet.z + 1.6); st.rotation.set(0, 0.9, 0);
      I.staff.tip.visible = true;
      G.music.stinger('discover');
      G.ui.subtitle(null, 'A point, sharp as a spear. You hide it in the shadows.', 3.5);
      await s.wait(1);
    }
    // The wine
    this.setObj('wine', 'Step into his firelight and offer him the wine');
    this.hint('wine', 'He cannot refuse a gift. Walk into the light.');
    await s.until(() => f.wineDone);
  }

  async _wineScene() {
    const s = this.script, p = this.player, g = this.cyclops, f = this.flags, I = this.int;
    this.obj = 'wineScene';
    this.stealthOn = false; g.perception = false; g.suspicion = 0;
    this.lockControl(true);
    G.ui.setObjective(null);
    G.ui.letterbox(true);
    this.ai.walkId++;
    g.stopWalk(); g.setActivity('idle');
    g.face(p.pos.x, p.pos.z);
    p.yaw = Math.atan2(g.pos.x - p.pos.x, g.pos.z - p.pos.z);
    const dir = _v.subVectors(p.pos, g.pos).setY(0).normalize();
    const side = new THREE.Vector3(dir.z, 0, -dir.x);
    G.rig.setStatic(p.pos.clone().addScaledVector(dir, 1.5).addScaledVector(side, 0.85).setY(p.pos.y + 1.45), g.headWorld().clone().add(new THREE.Vector3(0, -0.6, 0)), 0);
    G.rig.fov = 44;
    G.music.setMood('tension', 2);
    p.lookAt = g.headWorld().clone();
    const rim = I.dramaLight, gh = g.headWorld();
    rim.color.set(0x8fa8e0); rim.position.copy(gh).addScaledVector(dir, -9).setY(gh.y + 6); rim.target.position.copy(gh); rim.intensity = 700;
    this.int.fire.flare = 0.4;
    const lines = D.WINE_SCENE((id) => this.alive(id));
    await G.ui.dialogue(lines.slice(0, 4));
    g.setActivity('drink');
    G.audio.play('grunt', { pos: g.headWorld(), pitch: 0.3, vol: 0.8 });
    await s.wait(2.2);
    g.setActivity('idle');
    const name = await G.ui.dialogue(lines.slice(4));
    f.name = name || 'silent';
    if (f.name === 'nobody') { G.state.addCunning(3, 'My name is Nobody'); G.music.stinger('nobody'); }
    else if (f.name === 'odysseus') { G.state.addWrath(1, 'Pride'); G.music.stinger('dread'); }
    else G.state.addCunning(1, 'Silence');
    await G.ui.dialogue(D.WINE_AFTER[f.name]);
    this.giantRoar({ intensity: 0.45, dur: 1.4 });
    p.lookAt = null;
    // He staggers to the hearth-side and falls asleep.
    await g.walkTo(CAVE.sleep.x, CAVE.sleep.z, 1.4);
    g.yaw = Math.atan2(-CAVE.sleep.x, -CAVE.sleep.z) - Math.PI / 2; g.faceYaw = g.yaw;
    g.lyingTarget = 1; g.setActivity('sleep');
    G.audio.play('impact', { pos: g.pos, size: 0.9, ref: 10 }); G.rig.addTrauma(0.5);
    I.dramaLight.intensity = 0; I.dramaLight.color.set(0xffa868);
    this.fx.emit('dust', g.pos.clone().setY(0.5), 40, { scale: 2.2 });
    for (const l of ['maron', 'guestlaw']) G.state.lore.includes(l) || G.state.lore.push(l);
    await s.wait(2.5);
    G.ui.letterbox(false);
    // Hand the camera back: the cutscene left it on a static shot, which froze the view after the wine.
    G.rig.fov = 55;
    this.followCam(p.yaw);
    G.input.lockPointer();
    f.wineDone = true;
    this.lockControl(false);
  }

  // =====================================================================
  // 4. THE STAKE: built so the decisive action is one player input
  // =====================================================================
  async climax() {
    const s = this.script, I = this.int, p = this.player, g = this.cyclops, f = this.flags;
    const fromCheckpoint = this.cp === 'climax';
    this._prepStealthWorld();
    this.stealthOn = false; g.perception = false;
    if (fromCheckpoint || g.lying < 0.5) {
      g.place(CAVE.sleep.x, CAVE.sleep.z, Math.atan2(-CAVE.sleep.x, -CAVE.sleep.z) - Math.PI / 2);
      g.faceYaw = g.yaw; g.lyingTarget = 1; g.lying = 1; g.setActivity('sleep');
      f.sharpened = true; f.staff = true;
      const st = I.staff.group; st.position.set(CAVE.whet.x + 1, 0.25, CAVE.whet.z + 1.6); st.rotation.set(0, 0.9, 0); I.staff.tip.visible = true;
    }
    if (fromCheckpoint) { p.place(-24, 8, Math.PI / 2); this.followCam(Math.PI / 2); await G.ui.fade(0, 1.4); this.lockControl(false); G.input.lockPointer(); }
    G.state.saveCheckpoint('climax');
    // Tension: the fire is dying and the cave goes quiet, but stays readable: moonlight from the smoke hole fills the shadows.
    I.fire.level = 0.8;
    I.hemi.color.set(0x6a7aa0); I.hemi.intensity = 1.0;
    G.music.setMood('stealth', 3);
    G.audio.setAmbience({ cave: 0.6, fire: 0.35, crackle: 0.35, drips: 0.6 }, 4);
    G.post.setGrade('dread', 8);
    if (!f.carry) {
      this.setObj('take', 'Take up the stake from the alcove');
      await s.until(() => f.carry);
    } else this.carryStaff(true);
    this.setObj('harden', 'Harden the point in the embers');
    await s.until(() => f.hardened);
    I.staff.tip.material.emissiveIntensity = 3;
    this.heatSource = null;
    G.audio.play('sizzle', { pos: CAVE.hearth });
    this.setObj('stab', 'Drive the stake into his eye');
    this.player.model.setExpression('determination', 1);
    const [id, line] = D.BARKS.climaxWhisper; this.say(id, line, 3);
    this.climaxOn = true;
    await s.until(() => f.stabbed);
    await this._flail();
  }

  _climaxUpdate(dt) {
    const p = this.player, g = this.cyclops;
    const head = g.headWorld(_w);
    // Measure to a spot in front of his face, so the strike always comes from where you can see the eye.
    const anchor = this._faceAnchor();
    const d = Math.hypot(p.pos.x - anchor.x, p.pos.z - anchor.z) + 1.6;
    const k = 1 - smoothstep(3, 15, d);
    // Silence before the storm: music drains away, a heartbeat takes over, the frame tightens.
    if (k > 0.05 && !this._silenced) { this._silenced = true; G.music.setMood('silence', 5); G.audio.setAmbience({ cave: 0.35, fire: 0.15, crackle: 0.12, drips: 0.25 }, 4); }
    G.music.setHeartbeat(k > 0.05 ? lerp(54, 100, k) : 0);
    G.post.base.vignetteAdd = k * 0.3;
    G.post.base.satMul = 1 - k * 0.35;
    G.rig.fovAdd = -k * 12;
    const close = d < 8;
    this._eyeTarget = this._eyeTarget || new THREE.Vector3();
    this._eyeTarget.copy(head);
    G.rig.lockTarget = close ? this._eyeTarget : null;
    G.rig.dist = lerp(5.2, 3.0, 1 - smoothstep(3, 8, d)); G.rig.shoulder = lerp(0.55, 0.95, 1 - smoothstep(3, 8, d)); G.rig.height = lerp(1.6, 1.35, 1 - smoothstep(3, 8, d));
    G.engine.setTimeScale(lerp(1, 0.55, 1 - smoothstep(2.5, 7, d)), 3);
    this.int.staff.tip.material.emissiveIntensity = 2.6 + Math.sin(G.engine.gameTime * 7) * 0.4;
    this.int.tipLight.intensity = 14 + Math.sin(G.engine.gameTime * 9) * 3 + Math.sin(G.engine.gameTime * 23) * 1.5;
    if (Math.random() < dt * 10) this.fx.emit('ember', this.int.staff.tip.getWorldPosition(_v), 1);
    if (d < 4.6 && p.control) {
      G.ui.bigPrompt(`<span class="key">${this.label('attack')}</span>DRIVE THE STAKE`, '');
      if (G.input.pressed('attack', 0.15) || G.input.pressed('interact', 0.15)) this._stab().catch(quiet);
    } else G.ui.bigPrompt(null);
  }

  _faceAnchor() {
    const g = this.cyclops, e = g.eyeWorld(_v);
    return { x: e.x + Math.sin(g.yaw) * 2.2, z: e.z + Math.cos(g.yaw) * 2.2 };
  }

  async _stab() {
    const s = this.script, p = this.player, g = this.cyclops, I = this.int;
    const an = this._faceAnchor(); p.place(an.x, an.z, p.yaw);
    this.climaxOn = false;
    G.rig.lockTarget = null; G.rig.dist = 5.2; G.rig.shoulder = 0.55; G.rig.height = 1.6;
    G.ui.bigPrompt(null); G.ui.setObjective(null); G.ui.prompt(null);
    G.music.setHeartbeat(0);
    this.lockControl(true);
    const eye = g.eyeWorld(new THREE.Vector3());
    p.yaw = Math.atan2(eye.x - p.pos.x, eye.z - p.pos.z);
    p.prevYaw = p.yaw;
    p.model.play('stab');
    G.bus.emit('peakMomentStart', 'stake');
    // The decisive frame: impact stinger, white flash, slow motion, then nothing.
    G.music.stinger('impact');
    G.audio.play('stake', { pos: eye });
    G.post.kick({ flash: 0.9, color: 0xfff0dc, ca: 1.3, radial: 1.1 });
    G.engine.setTimeScale(0.06, 80);
    G.rig.addTrauma(0.55); G.input.rumble(1, 1, 450);
    G.ui.letterbox(true);
    const side = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    G.rig.setStatic(p.pos.clone().addScaledVector(side, 2.6).setY(p.pos.y + 1.4).addScaledVector(new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw)), -1.2), eye.clone().lerp(p.pos.clone().setY(p.pos.y + 1.1), 0.45), 0);
    G.rig.fov = 38; G.rig.fovAdd = 0;
    g.blindIt();
    this.int.tipLight.intensity = 0;
    this.carryStaff(false);
    const st = I.staff.group; st.position.copy(eye).addScaledVector(new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw)), -3.6); st.rotation.set(0, -p.yaw + Math.PI / 2, -0.1);
    this.fx.emit('spark', eye, 50); this.fx.emit('ember', eye, 40, { spread: 0.6 }); this.fx.flash(eye, 0xff7a30, 140, 0.8);
    setTimeout(() => G.audio.silenceAll(1.5, 0.05), 60);
    await s.waitReal(1.6);
    // The scream: the most intense sound in the game, synced to shake, dust, firelight and rumble.
    G.engine.setTimeScale(1, 2.5);
    const scream = this.giantRoar({ scream: true, intensity: 1.3 });
    setTimeout(() => { G.music.stinger('roar'); G.music.setMood('climax', 0.3); G.rig.addTrauma(1); G.post.kick({ ca: 1.6, radial: 1.3 }); G.input.rumble(1, 1, 1400); I.fire.level = 1.15; I.fire.flare = 1.5; }, scream * 1000);
    G.audio.setAmbience({ cave: 0.8, fire: 0.5, crackle: 0.5, drips: 0 }, 0.5);
    G.post.setGrade('cave', 2); G.post.base.satMul = 1; G.post.base.vignetteAdd = 0;
    p.model.setExpression('fear', 0.8);
    for (const c of this.crew) c.model.setExpression('fear', 1);
    this.eyeSmoke = true;
    g.lyingTarget = 0; g.setActivity('roar');
    I.staff.group.position.set(g.pos.x + 3, 0.3, g.pos.z + 3);
    G.state.addCunning(2, 'The stake');
    G.state.lore.includes('poseidon') || G.state.lore.push('poseidon');
    this.flags.stabbed = true;
    await s.wait(2.2);
    G.ui.letterbox(false);
    this.crew.forEach((c, i) => { const sp = this.int.hideSpots[(i + 5) % this.int.hideSpots.length]; c.goTo(sp.x * 0.98, sp.z * 0.98, { run: true }); c.crouch = false; });
  }

  // Blind fury: telegraphed slams toward the last sound he heard.
  async _flail() {
    const s = this.script, p = this.player, g = this.cyclops, I = this.int;
    p.control = true; G.input.lockPointer();
    this.followCam(p.yaw + Math.PI);
    G.rig.big = { pos: g.pos, radius: 3 };
    this.setObj('fury', 'Survive his blind fury. Keep moving, keep quiet');
    this.hint('fury', `He strikes where he last heard you. ${this.label('dodge')} to roll clear.`);
    this.flailOn = true; this.flail = { t: 1.5, slams: 0, phase: 'idle' };
    g.setActivity('flail');
    await s.until(() => this.flail.slams >= 5 && this.flail.phase === 'idle');
    this.flailOn = false;
    G.rig.big = null;
    // He gropes his way to the door, rolls the boulder aside a crack, and calls his brothers.
    this.lockControl(true);
    G.ui.letterbox(true);
    G.rig.setStatic(new THREE.Vector3(-8, 4, 14), new THREE.Vector3(0, 5, 32), 2);
    g.setActivity('idle');
    await g.walkTo(0, 30, 2.6);
    g.face(0, 50); g.setActivity('roll');
    G.audio.play('boulder', { pos: I.boulder.position, dur: 1.6 });
    const t0 = s.t;
    await s.until(() => { I.setDoor(clamp((s.t - t0) / 1.6) * 0.32, '#3a4a78'); return s.t - t0 > 1.6; });
    I.doorSpotI = 120;
    const lines = D.BLIND_LINES[this.flags.name || 'silent'];
    this.giantRoar({ intensity: 1, dur: 1.8 }); setTimeout(() => G.ui.subtitle(lines[0][0], lines[0][1], 5), 2600);
    await s.wait(4.6);
    G.ui.subtitle(lines[1][0], lines[1][1], 5.5); G.audio.setReverb(1);
    await s.wait(5.5);
    if (this.flags.name === 'odysseus') G.music.stinger('dread');
    g.face(0, 0); g.place(0, 32.5, Math.PI); g.setActivity('sit');
    G.music.setMood('silence', 3);
    await G.ui.fade(1, 2);
    G.ui.subtitle(null, 'All night he sat in the doorway, hands outstretched. At dawn, the flock grew restless.', 5);
    await s.waitReal(5);
  }

  _flailAI(dt) {
    const F = this.flail, g = this.cyclops, p = this.player;
    F.t -= dt;
    if (F.phase === 'idle' && F.t <= 0) {
      const heard = this.lastNoise && G.engine.gameTime - this.lastNoise.t < 2.5;
      const tgt = heard ? this.lastNoise.pos.clone() : p.pos.clone().add(new THREE.Vector3(rand(-4, 4), 0, rand(-4, 4)));
      if (tgt.distanceTo(g.pos) > 7) g.walkTo(tgt.x, tgt.z, 3.0);
      F.target = tgt; F.phase = 'raise'; F.t = 1.15;
      g.face(tgt.x, tgt.z);
      g.setActivity('slamRaise');
      G.audio.play('grunt', { pos: g.headWorld(), pitch: 0.32, vol: 1.3 });
      this._marker(tgt, 3.6, 1.15, 0xff2a14);
      G.audio.play('unblockable', { pos: tgt });
    } else if (F.phase === 'raise' && F.t <= 0) {
      g.stopWalk();
      g.setActivity('slamDown');
      F.phase = 'recover'; F.t = 0.9; F.slams++;
      const hit = F.target;
      hit.y = this.zone.ground(hit.x, hit.z);
      G.audio.play('impact', { pos: hit, size: 1.3 }); G.rig.addTrauma(0.65); G.input.rumble(1, 0.8, 300);
      this.fx.emit('dust', hit.clone().setY(hit.y + 0.3), 40, { scale: 2.4, speed: [4, 10] });
      this.fx.emit('spark', hit, 10);
      G.post.kick({ ca: 0.6, radial: 0.4 });
      if (Math.hypot(p.pos.x - hit.x, p.pos.z - hit.z) < 3.6) p.takeHit(36, hit, { heavy: true, unblockable: true, knock: 10 });
    } else if (F.phase === 'recover' && F.t <= 0) {
      g.setActivity('flail'); F.phase = 'idle'; F.t = rand(1.2, 2.2);
    }
  }

  // Faint pulsing ring on the floor at the current stake objective, so the dark alcove can be found.
  _updateGuide(dt) {
    const at = this.zone === this.int && this.stealthOn && { staff: CAVE.staff, sharpen: CAVE.whet, take: CAVE.whet, harden: CAVE.hearth }[this.obj];
    const need = at && (this.obj !== 'sharpen' || this.staffCarried) && (this.obj !== 'harden' || this.staffCarried);
    if (!this._guide) {
      if (!need) return;
      const m = new THREE.Mesh(cachedGeo('guide', () => { const g = new THREE.RingGeometry(0.82, 1, 48); g.rotateX(-Math.PI / 2); return g; }), new THREE.MeshBasicMaterial({ color: 0xffb066, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      this.int.scene.add(m); this._guide = { m, t: 0 };
    }
    const gd = this._guide, m = gd.m;
    gd.t += dt;
    const near = need ? Math.hypot(this.player.pos.x - at.x, this.player.pos.z - at.z) : 0;
    const target = need ? 0.4 + 0.12 * Math.sin(gd.t * 2.4) : 0;
    m.material.opacity = damp(m.material.opacity, need && near > 1.2 ? target : 0, 4, dt);
    m.visible = m.material.opacity > 0.005;
    if (need) { const r = this.obj === 'harden' ? 3.2 : 1.8; m.scale.set(r, 1, r); m.position.set(at.x, this.int.ground(at.x, at.z) + 0.2, at.z); }
  }

  _marker(pos, radius, dur, color = 0xff6a2a) {
    const m = new THREE.Mesh(cachedGeo('marker', () => { const g = new THREE.RingGeometry(0.75, 1, 40); g.rotateX(-Math.PI / 2); return g; }), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    m.scale.setScalar(radius);
    const mesh = new THREE.Group(); mesh.add(m);
    m.scale.set(radius, 1, radius);
    mesh.position.set(pos.x, this.zone.ground(pos.x, pos.z) + 0.12, pos.z);
    this.zone.scene.add(mesh);
    const entry = { mesh: Object.assign(mesh, { material: m.material }), t: 0, dur };
    this.markers.push(entry);
    setTimeout(() => { mesh.removeFromParent(); this.markers.splice(this.markers.indexOf(entry), 1); }, dur * 1000 + 600);
  }

  // =====================================================================
  // 5. UNDER THE RAM
  // =====================================================================
  async escape() {
    const s = this.script, I = this.int, p = this.player, g = this.cyclops, f = this.flags;
    if (this.zone !== I) this.setZone(I);
    if (g.zone !== I) g.setZone(I);
    g.blind || g.blindIt();
    this.eyeSmoke = true;
    g.place(0, 32.5, Math.PI); g.lying = g.lyingTarget = 0; g.setActivity('grope');
    I.setDoor(0.45, '#ffe4b8'); I.doorSpotI = 900; I.setDoor(0.45);
    I.fire.level = 0.12; I.shaftMat.uniforms.uI.value = 0.35; I.moon.intensity = 900;
    I.penObs.off = true;
    G.post.setGrade('dawn', 0.1); G.post.base.bloom = 0.8;
    G.state.saveCheckpoint('escape');
    G.audio.setAmbience({ cave: 0.7, fire: 0.1, crackle: 0.1, wind: 0.4, drips: 0.3 });
    G.music.setMood('tension', 3);
    for (const c of this.crew) { c.visible = false; c.root.visible = false; }
    this.ram = I.sheep[0];
    this.ram.scripted = true;
    this.ram.pos.copy(SHEEP_PATH.getPointAt(0.22)); this.ram.pos.y = I.ground(this.ram.pos.x, this.ram.pos.z);
    this.ram.u = 0.22;
    this.ram.q.root.position.copy(this.ram.pos);
    I.interactables.find((it) => it.isRam).pos = this.ram.pos;
    // The flock files out past him; your men are lashed beneath.
    this.flock = I.sheep.slice(1).map((sh, i) => { sh.scripted = true; sh.u = 0.2 - i * 0.045; return sh; });
    p.place(10, 1, -0.3);
    this.followCam(-0.3);
    G.rig.big = { pos: g.pos, radius: 4 };
    await G.ui.fade(0, 2.5);
    this.lockControl(false); G.input.lockPointer();
    const [id, line] = D.BARKS.sheep; this.say(id, line, 4);
    this.setObj('ram', 'Cling beneath the great ram');
    this.flockOn = true;
    this._flockLoop().catch(quiet);
    await s.until(() => f.escaped);
  }

  async _flockLoop() {
    const s = this.script, g = this.cyclops;
    let lastBleat = 0;
    while (this.flockOn) {
      await s.wait(0);
      const dt = 1 / 60;
      for (const sh of this.flock) {
        if (sh.gone) continue;
        sh.u += dt * 0.022;
        if (sh.u < 0) { sh.speed = 0; continue; }
        if (sh.u >= 1) { sh.gone = true; sh.q.root.visible = false; continue; }
        const pt = SHEEP_PATH.getPointAt(sh.u), ahead = SHEEP_PATH.getPointAt(Math.min(1, sh.u + 0.01));
        sh.pos.set(pt.x, this.int.ground(pt.x, pt.z), pt.z);
        sh.yaw = Math.atan2(ahead.x - pt.x, ahead.z - pt.z);
        sh.speed = 1.0;
        sh.q.root.position.copy(sh.pos); sh.q.root.rotation.y = sh.yaw;
        if (Math.abs(sh.pos.z - 30) < 1.5 && s.t - lastBleat > 2.5) { lastBleat = s.t; G.audio.play('bleat', { pos: sh.pos, reverb: 0.5 }); g.headTarget = sh.pos.clone(); }
      }
    }
  }

  _startCling() {
    const p = this.player, ram = this.ram;
    this.obj = 'clinging';
    G.ui.setObjective(null);
    this.lockControl(true);
    p.attached = true;
    ram.q.root.add(p.root);
    p.root.position.set(0, 0.32, -0.1); p.root.rotation.set(-Math.PI / 2, 0, Math.PI); p.root.scale.setScalar(1 / 1.45);
    p.customPose = { lArmX: -2.6, rArmX: -2.6, lElb: -0.6, rElb: -0.6, lLegX: -1.4, rLegX: -1.4, lKnee: 1.6, rKnee: 1.6 };
    this.cling = { b: 0, grip: 1, bad: 0, t: 0, pass: -1, passT: 0, passes: [24, 29.5, 34.5], fails: 0, qte: false };
    this.clingOn = true;
    G.ui.letterbox(true);
    G.music.setMood('silence', 3); G.music.setHeartbeat(64);
    G.audio.play('bleat', { pos: ram.pos, pitch: 0.7 });
  }

  _clingUpdate(dt, realDt) {
    const c = this.cling, ram = this.ram, g = this.cyclops, input = G.input, I = this.int;
    if (c.qte) return;
    c.t += dt;
    // Ram walks the path
    ram.u = Math.min(1, ram.u + dt * 0.021);
    const pt = SHEEP_PATH.getPointAt(ram.u), ahead = SHEEP_PATH.getPointAt(Math.min(1, ram.u + 0.01));
    ram.pos.set(pt.x, I.ground(pt.x, pt.z), pt.z);
    ram.yaw = Math.atan2(ahead.x - pt.x, ahead.z - pt.z);
    ram.speed = 1.05;
    ram.q.root.position.copy(ram.pos); ram.q.root.rotation.y = ram.yaw;
    // Low, tight camera beside the ram
    const side = new THREE.Vector3(Math.cos(ram.yaw), 0, -Math.sin(ram.yaw));
    const fwd = new THREE.Vector3(Math.sin(ram.yaw), 0, Math.cos(ram.yaw));
    G.rig.setStatic(ram.pos.clone().addScaledVector(side, -3.4).addScaledVector(fwd, -1.2).setY(ram.pos.y + 0.75), ram.pos.clone().addScaledVector(fwd, 2).setY(ram.pos.y + 1.4 + (c.pass >= 0 ? 2.5 : 0)), 4);
    G.rig.fov = 50;
    // Hand passes
    const nextPass = c.passes[c.pass + 1];
    if (c.passT <= 0 && nextPass !== undefined && ram.pos.z > nextPass) { c.pass++; c.passT = 3.6; G.audio.play('grunt', { pos: g.headWorld(), pitch: 0.3, vol: 0.9 }); g.headTarget = ram.pos.clone(); if (c.pass === 2) this._ramMonologue().catch(quiet); }
    const danger = c.passT > 0;
    if (danger) {
      c.passT -= dt;
      g.setActivity('grope');
      G.post.base.vignetteAdd = 0.35 + Math.sin(c.t * 3) * 0.08;
      if (Math.random() < dt * 3) G.audio.play('whoosh', { pos: ram.pos, vol: 0.25 });
      G.music.setHeartbeat(96);
    } else { G.post.base.vignetteAdd = 0.12; G.music.setHeartbeat(66); }
    // Balance: the ram sways and stumbles; you counter. Hands make it worse.
    const sway = Math.sin(c.t * 1.7) * 0.35 + Math.sin(c.t * 3.3 + 1) * 0.22 + (Math.random() - 0.5) * (danger ? 2.4 : 0.6);
    const m = input.move();
    c.b = clamp(c.b + sway * dt * (danger ? 1.5 : 0.6) - m.x * 1.9 * dt, -1, 1);
    const holding = input.isDown('dodge') || input.isDown('alt') || input.isDown('interact');
    c.grip = clamp(c.grip + (holding ? 0.45 : -0.75) * dt);
    const zone = G.settings.difficulty === 'story' ? 0.5 : G.settings.difficulty === 'hard' ? 0.28 : 0.36;
    if (danger && (Math.abs(c.b) > zone || c.grip <= 0.02)) c.bad += dt; else c.bad = Math.max(0, c.bad - dt * 0.5);
    G.ui.cling({ balance: c.b, zone, grip: c.grip, danger, label: danger ? 'STILL...' : 'HOLD ON', help: `Hold ${this.label('dodge')} to grip · ${this.label('left')} / ${this.label('right')} to keep balance` });
    if (c.bad > 0.5) this._clingFail().catch(quiet);
    if (ram.u > 0.985 || ram.pos.z > 41) this._clingSuccess();
  }

  async _ramMonologue() {
    const s = this.script;
    for (const line of D.RAM_MONOLOGUE) { G.ui.subtitle('Polyphemus', line, 3.6); await s.wait(1.6); }
  }

  async _clingFail() {
    const c = this.cling, s = this.script, g = this.cyclops;
    c.qte = true; c.bad = 0; c.fails++;
    G.engine.setTimeScale(0.3, 30);
    G.ui.cling(null);
    G.ui.bigPrompt(`<span class="key">${this.label('dodge')}</span>ROLL FREE!`, 'His fingers are in the wool');
    G.audio.play('grunt', { pos: g.headWorld(), pitch: 0.4, vol: 1.2 });
    G.input.clear();
    const t0 = G.engine.realTime;
    await s.until(() => G.input.pressed('dodge', 0.3) || G.engine.realTime - t0 > 1.3);
    const saved = G.engine.realTime - t0 <= 1.3;
    G.ui.bigPrompt(null);
    G.engine.setTimeScale(1, 6);
    if (saved) { G.audio.play('whoosh', { vol: 0.8 }); G.ui.subtitle(null, 'You twist free and swing back beneath the ram.', 3); c.b = 0; c.grip = 1; }
    else {
      const victim = this.crew.find((m) => G.state.isAlive(m.id));
      if (victim) { G.ui.subtitle('Polyphemus', 'Ahh... a little one. Under my sheep.', 3); G.state.loseCrew(victim.id, 'found beneath the sheep'); this.crew.splice(this.crew.indexOf(victim), 1); }
      c.b = 0; c.grip = 1;
    }
    c.passT = Math.min(c.passT, 0.8);
    c.qte = false;
  }

  async _clingSuccess() {
    if (this._exiting) return;
    this._exiting = true;
    this.clingOn = false; this.flockOn = false;
    G.ui.cling(null);
    G.music.setHeartbeat(0);
    G.post.base.vignetteAdd = 0;
    if (this.cling.fails === 0) G.state.addCunning(2, 'Unfelt');
    // Blinding daylight
    G.music.stinger('triumph');
    G.post.setGrade('daylight', 1.2);
    const s = this.script;
    const t0 = s.t;
    await s.until(() => { G.post.base.exposure = lerp(1, 4, clamp((s.t - t0) / 1.4)); G.post.base.bloom = lerp(0.8, 2.2, clamp((s.t - t0) / 1.4)); return s.t - t0 > 1.4; });
    await G.ui.fade(1, 0.5, '#fff8ee');
    this.player.attached = false;
    this.player.root.scale.setScalar(1); this.player.root.rotation.set(0, 0, 0);
    this.player.customPose = null;
    this.flags.escaped = true;
  }

  // =====================================================================
  // 6. INTO THE LIGHT: the boulder barrage
  // =====================================================================
  async run() {
    const s = this.script, E = this.ext, p = this.player, g = this.cyclops, f = this.flags;
    this.setZone(E);
    for (const c of this.crew) { c.visible = true; c.root.visible = true; c.crouch = false; c.state = 'follow'; }
    E.atm.setPreset('daylight'); E.rebakeEnv();
    G.post.setGrade('daylight', 0.1); G.post.base.god = 0.4;
    G.state.saveCheckpoint('run');
    this.mouthGlow = 0;
    p.place(0, -41, 0);
    this.crew.forEach((c, i) => c.place(-3 + (i % 4) * 2, -44 + Math.floor(i / 4) * 1.3, 0));
    if (g.zone !== E) { g.setZone(E); }
    g.blind || g.blindIt();
    this.eyeSmoke = true;
    const gz = -59;   // seated just inside the tunnel mouth
    g.place(-4, gz, 0.1); g.lying = g.lyingTarget = 0; g.setActivity('idle');
    for (const b of this.boars) b.root.visible = false;
    this.followCam(0);
    G.rig.pitch = 0.15;
    const startExposure = G.post.base.exposure > 1.5 ? G.post.base.exposure : 3;
    G.ui.fade(0, 2.2);
    const t0 = s.t;
    s.until(() => { const k = clamp((s.t - t0) / 3); G.post.base.exposure = lerp(startExposure, 1, k); G.post.base.bloom = lerp(2, 0.6, k); return k >= 1; });
    G.audio.setAmbience({ waves: 1, surf: 1, wind: 0.6, gulls: 0.5 }, 1);
    G.music.setMood('climax', 1);
    this.lockControl(false); G.input.lockPointer();
    const [id, line] = D.BARKS.daylight; this.say(id, line, 3);
    this.setObj('run', 'Run for the ship!');
    this.hint('run', `Watch for shadows on the ground. ${this.label('dodge')} to roll clear.`);
    this.barrage = { t: 3, n: 0 };
    await s.until(() => {
      this._barrageTick(1 / 60);
      return Math.hypot(p.pos.x - SHIP_SPOT.x, p.pos.z - (SHIP_SPOT.z - 19)) < 7;
    });
    this.barrage = null;
    this.setObj('push', 'Push off!');
    await s.until(() => { G.ui.prompt('Push off!', 'interact'); return G.input.pressed('interact'); });
    G.ui.prompt(null);
  }

  _barrageTick(dt) {
    const B = this.barrage, g = this.cyclops, p = this.player;
    if (!B) return;
    B.t -= dt;
    if (B.t > 0) return;
    B.t = (this.flags.name === 'odysseus' ? 1.5 : 2.3) * rand(0.8, 1.2);
    B.n++;
    g.setActivity('throwRelease');
    setTimeout(() => g.setActivity('throwHold'), 500);
    const from = g.handWorld(new THREE.Vector3()).add(new THREE.Vector3(0, 2, 0));
    if (this.flags.name === 'odysseus' && B.n % 2 === 0) from.set(rand(-70, 70), 50, -90);
    const lead = Math.min(1.6, 0.5 + B.n * 0.05);
    const target = p.pos.clone().addScaledVector(p.vel, lead).add(new THREE.Vector3(rand(-3, 3), 0, rand(-3, 3)));
    // Spare the crew; aim near them only for drama
    this._throwBoulder(from, target, 1.7, 1.4 + Math.random() * 0.6, true);
  }

  _throwBoulder(from, target, dur, size, harmful, onLand) {
    target.y = this.zone.ground(target.x, target.z);
    const mesh = new THREE.Mesh(rockGeo(70 + (Math.random() * 3 | 0), 2), Mat.stone);
    mesh.scale.setScalar(size); mesh.castShadow = true;
    mesh.position.copy(from);
    this.zone.scene.add(mesh);
    const shadow = new THREE.Mesh(cachedGeo('shadowDisc', () => { const g = new THREE.CircleGeometry(1, 28); g.rotateX(-Math.PI / 2); return g; }), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false }));
    shadow.position.set(target.x, target.y + 0.15, target.z);
    if (target.y > -0.5) this.zone.scene.add(shadow);
    G.audio.play('whistle', { pos: target, ref: 8 });
    this.boulders.push({ mesh, shadow, from: from.clone(), to: target.clone(), t: 0, dur, size, harmful, onLand, spin: new THREE.Vector3(Math.random(), Math.random(), Math.random()) });
  }

  _updateBoulders(dt) {
    for (let i = this.boulders.length - 1; i >= 0; i--) {
      const b = this.boulders[i];
      b.t += dt / b.dur;
      const k = Math.min(1, b.t);
      b.mesh.position.lerpVectors(b.from, b.to, k);
      b.mesh.position.y += Math.sin(k * Math.PI) * 18;
      b.mesh.rotation.x += b.spin.x * dt * 4; b.mesh.rotation.y += b.spin.y * dt * 4;
      b.shadow.material.opacity = k * 0.6;
      b.shadow.scale.setScalar(lerp(5, 2.6 * b.size, k));
      if (k >= 1) {
        const p = b.to;
        const water = p.y < -0.3;
        if (water) { this.fx.emit('splash', p.clone().setY(0.3), 50 * b.size, { scale: b.size }); G.audio.play('splash', { pos: p, size: b.size }); }
        else { this.fx.emit('dust', p.clone().setY(p.y + 0.5), 40, { scale: 2, speed: [3, 9] }); this.fx.emit('spark', p, 8); G.audio.play('impact', { pos: p, size: 0.9 + b.size * 0.2 }); }
        const d = this.player.pos.distanceTo(p);
        G.rig.addTrauma(clamp(0.9 - d / 30, 0.1, 0.8)); G.input.rumble(0.8, 0.5, 220);
        if (b.harmful && Math.hypot(this.player.pos.x - p.x, this.player.pos.z - p.z) < 3.6) this.player.takeHit(38, p, { heavy: true, unblockable: true, knock: 11 });
        b.onLand?.(p);
        b.shadow.removeFromParent();
        if (water) b.mesh.removeFromParent(); else setTimeout(() => b.mesh.removeFromParent(), 6000);
        this.boulders.splice(i, 1);
      }
    }
  }

  // =====================================================================
  // 7. THE CHOICE: shout your name, or stay silent
  // =====================================================================
  async choice() {
    const s = this.script, E = this.ext, p = this.player, g = this.cyclops, f = this.flags;
    if (this.zone !== E) this.setZone(E);
    if (this.cp === 'choice') { E.atm.setPreset('daylight'); E.rebakeEnv(); G.post.setGrade('daylight', 0.1); g.setZone(E); g.blind || g.blindIt(); }
    G.state.saveCheckpoint('choice');
    this.lockControl(true);
    G.ui.setObjective(null);
    p.root.visible = false;
    for (const c of this.crew) { c.visible = false; c.root.visible = false; }
    const ship = E.ship;
    ship.setCrewCount(Math.max(2, this.crew.length));
    if (!ship.hero) {
      const { Humanoid } = await import('../assets/Character.js');
      const { ODYSSEUS } = await import('../data/crew.js');
      ship.hero = new Humanoid({ look: ODYSSEUS.look, sword: true, shield: true, cloak: true });
      ship.hero.root.position.set(0.4, 1.0, -8.2);
      ship.group.add(ship.hero.root);
    }
    ship.hero.root.rotation.y = Math.PI;
    G.ui.letterbox(true);
    G.music.setMood('explore', 2);
    G.audio.setAmbience({ waves: 1, surf: 1, wind: 0.6, gulls: 0.6 });
    // Row away; he follows the sound of the oars down to the shore.
    g.place(30, 96, -2.6); g.setActivity('idle'); g.lying = g.lyingTarget = 0;
    ship.rowing = 1; ship.api.sailFurl = 0.9;
    this.sailing = true;
    const t0 = s.t;
    const track = () => {
      const k = clamp((s.t - t0) / 16);
      ship.yaw = lerp(Math.PI, Math.PI * 0.08, ease(k));
      ship.speed = 3.4;
      ship.pos.x += Math.sin(ship.yaw) * ship.speed / 60; ship.pos.z += Math.cos(ship.yaw) * ship.speed / 60;
      ship.rowing = 1;
    };
    const ease = (k) => k * k * (3 - 2 * k);
    G.rig.setStatic(new THREE.Vector3(ship.pos.x - 18, 7, ship.pos.z + 26), ship.pos.clone().setY(3), 0);
    await s.until(() => { track(); G.rig.staticLook.copy(ship.pos).setY(3); G.rig.staticPos.lerp(new THREE.Vector3(ship.pos.x - 14, 6, ship.pos.z + 22), 0.02); return s.t - t0 > 7; });
    // Over the stern: the island, the giant on the rocks
    const behind = () => ship.pos.clone().add(new THREE.Vector3(Math.sin(ship.yaw) * 22, 0, Math.cos(ship.yaw) * 22));
    G.rig.setStatic(behind().setY(5.5), g.pos.clone().setY(g.pos.y + 6), 0);
    g.setActivity('listen');
    G.ui.subtitle('Polyphemus', 'I hear your oars, little men. I hear you...', 4);
    await s.until(() => { track(); G.rig.staticPos.copy(behind().setY(5.5)); return s.t - t0 > 11; });
    G.ui.letterbox(false);
    const pick = await G.ui.choice({
      title: 'The giant is listening',
      sub: 'Your men pull at the oars in silence. The sea is calm.',
      timeout: 15, defaultValue: 'silent',
      options: [
        { label: 'Stay silent', desc: 'Let Nobody leave as Nobody', keyLabel: this.label('interact'), code: G.input.bindings.interact[0], value: 'silent' },
        { label: 'Shout your true name', desc: 'Let him know who bested him', keyLabel: this.label('shout'), code: G.input.bindings.shout[0], value: 'shout' },
      ],
    });
    f.choice = pick;
    G.ui.letterbox(true);
    if (pick === 'shout') await this._shout(track, behind);
    else await this._silent(track, behind);
  }

  async _shout(track, behind) {
    const s = this.script, E = this.ext, g = this.cyclops, ship = E.ship;
    const t0 = s.t;
    ship.heroPose = { lean: -0.2, chestX: -0.25, headX: -0.35, rArmX: -2.6, rArmZ: -0.3, rElb: -0.2, lArmZ: 0.5 };
    const stern = () => ship.group.localToWorld(new THREE.Vector3(0.4, 2.6, -8.2));
    G.rig.setStatic(ship.group.localToWorld(new THREE.Vector3(3.5, 3.4, -5)), stern(), 0);
    G.rig.fov = 42;
    G.ui.subtitle('Odysseus', D.SHOUT.ody, 6.5);
    G.audio.play('grunt', { pitch: 0.8, vol: 1, bus: 'voice' });
    G.state.addWrath(4, 'You shouted your name');
    await s.until(() => { track(); G.rig.staticPos.copy(ship.group.localToWorld(new THREE.Vector3(3.5, 3.4, -5))); G.rig.staticLook.copy(stern()); return s.t - t0 > 6.5; });
    ship.heroPose = null;
    // The curse
    G.rig.setStatic(behind().setY(4), g.pos.clone().setY(g.pos.y + 7), 0);
    G.rig.fov = 40;
    g.setActivity('roar');
    this.giantRoar({ intensity: 1.2, dur: 3.2 });
    G.music.setMood('dread', 1); G.music.stinger('dread');
    E.atm.setPreset('storm', 9);
    E.ocean.setStorm(1);
    G.post.setGrade('storm', 8);
    G.audio.setAmbience({ waves: 1, surf: 1, wind: 1, storm: 1, rain: 0.2, gulls: 0 }, 6);
    await s.wait(3.6);
    G.ui.subtitle('Polyphemus', D.SHOUT.curse1, 3.5);
    await s.until(() => { track(); G.rig.staticPos.copy(behind().setY(4)); return s.t - t0 > 11.5; });
    G.ui.subtitle('Polyphemus', D.SHOUT.curse2, 7);
    E.atm.flash(1); setTimeout(() => G.audio.play('thunder'), 400);
    E.rain.target = 1;
    await s.until(() => { track(); G.rig.staticPos.copy(behind().setY(4)); return s.t - t0 > 16; });
    // A mountain-top hurled into the sea behind them
    g.setActivity('throwHold');
    await s.wait(0.8);
    g.setActivity('throwRelease');
    const target = ship.pos.clone().add(new THREE.Vector3(Math.sin(ship.yaw) * 30, 0, Math.cos(ship.yaw) * 30 + 6));
    this._throwBoulder(g.handWorld(new THREE.Vector3()).add(new THREE.Vector3(0, 2, 0)), target, 2.6, 4.5, false, (pt) => {
      this.fx.emit('splash', pt.clone().setY(0.5), 160, { scale: 3.5 });
      G.audio.play('splash', { pos: pt, size: 2.5 }); G.audio.play('impact', { size: 1.4 });
      ship.buoy.vy += 4; ship.buoy.pitch += 0.12; G.rig.addTrauma(0.9);
      E.atm.flash(1); setTimeout(() => G.audio.play('thunder'), 200);
    });
    const tw = s.t;
    G.rig.setStatic(ship.group.localToWorld(new THREE.Vector3(-14, 9, -30)), ship.pos.clone().setY(2), 0);
    await s.until(() => { track(); G.rig.staticLook.copy(ship.pos).setY(2); return s.t - tw > 7; });
    G.ui.subtitle(null, 'Behind them, the sea itself began to turn.', 4.5);
    await s.wait(4.5);
  }

  async _silent(track, behind) {
    const s = this.script, E = this.ext, g = this.cyclops, ship = E.ship;
    G.state.addCunning(2, 'Silence');
    G.music.setMood('afterglow', 3);
    E.atm.setPreset('sunset', 14);
    G.post.setGrade('afterglow', 8);
    const t0 = s.t;
    G.rig.setStatic(behind().setY(5), g.pos.clone().setY(g.pos.y + 6), 0);
    g.setActivity('listen');
    await s.until(() => { track(); G.rig.staticPos.copy(behind().setY(5)); return s.t - t0 > 3; });
    G.ui.subtitle('Polyphemus', 'Nobody... NOBODY!', 3); this.giantRoar({ intensity: 0.8, dur: 2 });
    await s.wait(3.5);
    // Afterglow: a wide shot, the sea, the men exhaling.
    for (const [id, line] of D.SILENT_LINES) {
      if (!G.state.isAlive(id)) continue;
      G.ui.subtitle(crewById(id).name, line, 4.5);
      const tl = s.t;
      await s.until(() => { track(); return s.t - tl > 4.6; });
    }
    const tw = s.t;
    G.rig.setStatic(ship.group.localToWorld(new THREE.Vector3(30, 14, 40)), ship.pos.clone().setY(2), 0);
    G.audio.play('cheer', { count: Math.max(3, this.crew.length) });
    await s.until(() => { track(); G.rig.staticLook.copy(ship.pos).setY(2); G.rig.staticPos.add(new THREE.Vector3(0.02, 0.01, 0.03)); return s.t - tw > 8; });
  }

  // ---------- chapter end ----------
  async _finish() {
    const f = this.flags, st = G.state;
    await G.ui.fade(1, 2);
    G.ui.letterbox(false);
    const startAlive = f.ch3?.alive || [];
    const saved = startAlive.filter((id) => st.isAlive(id));
    const lost = startAlive.filter((id) => !st.isAlive(id));
    st.chapter = 4;
    st.completed.includes(3) || st.completed.push(3);
    const choiceText = f.choice === 'shout' ? 'Shouted your name' : 'Stayed silent';
    G.input.unlockPointer();
    await G.ui.openSummary({
      n: 3, title: CH.title, saved, lost, cunning: st.cunning - (f.ch3?.cunning || 0), wrath: st.wrath,
      choice: choiceText, epitaph: lost.length ? `${D.EPITAPHS[f.choice === 'shout' ? 'shout' : 'silent']} We pour a cup for ${lost.map((id) => crewById(id).name).join(', ')}.` : D.EPITAPHS[f.choice === 'shout' ? 'shout' : 'silent'],
    });
    G.flow.toSailing({ afterChapter: true });
  }

  // ---------- consequences ----------
  _giantHurt(info) {
    if (this.stealthOn && !this.seizing) { G.ui.subtitle('Polyphemus', 'A sting? From a FLY?', 2.5); this.cyclops.suspicion = 1; }
    return 'immune';
  }

  _stealthAI(dt) {
    const g = this.cyclops, p = this.player, A = this.ai;
    if (this.seizing) return;
    if (this.obj === 'wine' && Math.hypot(p.pos.x - g.pos.x, p.pos.z - g.pos.z) < 13) { this._wineScene().catch(quiet); return; }
    if (this.obj === 'wine') g.suspicion = Math.min(g.suspicion, 0.4);
    if (g.suspicion >= 1) { this._spotted().catch(quiet); return; }
    if (A.mode === 'routine' && g.suspicion > 0.42) {
      A.mode = 'investigate'; A.t = 0; A.walkId++; g.stopWalk(); g.setActivity('listen');
      G.audio.play('grunt', { pos: g.headWorld(), pitch: 0.35, vol: 0.9 });
      G.ui.subtitle('Polyphemus', pick(['Hm? Who is there?', 'I hear you, little mouse...', 'Something squeaks in the dark.']), 2.5);
    }
    if (A.mode === 'routine') {
      const st = STATIONS[A.idx % STATIONS.length];
      if (!A.at && !A.walking) {
        A.walking = true; const id = ++A.walkId; g.setActivity('idle');
        g.walkTo(st.pos[0], st.pos[1], 2.2).then(() => { if (id !== A.walkId) return; A.walking = false; A.at = true; A.t = 0; g.face(st.face.x, st.face.z); g.setActivity(st.act); g.headTarget = null; });
      }
      if (A.at) { A.t += dt; if (A.t > st.dur) { A.at = false; A.idx++; } }
    } else {
      A.t += dt;
      if (g.lastKnown) {
        g.face(g.lastKnown.x, g.lastKnown.z);
        if (g.suspicion > 0.62 && !g.walkTarget && g.lastKnown.distanceTo(g.pos) > 5) g.walkTo(g.lastKnown.x, g.lastKnown.z, 2.6);
      }
      if (A.t > 7 && g.suspicion < 0.35) { A.mode = 'routine'; A.at = false; A.walking = false; A.walkId++; g.stopWalk(); g.headTarget = null; }
    }
  }

  async _spotted() {
    this.seizing = true;
    const g = this.cyclops;
    this.ai.walkId++;
    g.suspicion = 0; g.perception = false; g.stopWalk();
    const victim = this.crew.filter((c) => c.visible).sort((a, b) => a.pos.distanceTo(g.pos) - b.pos.distanceTo(g.pos))[0];
    this.giantRoar({ intensity: 0.9, dur: 1.6 });
    setTimeout(() => G.ui.subtitle('Polyphemus', pick(['THERE you are, little thieves.', 'I smell you... I SEE you.', 'You squeak in my walls? Come here.']), 3), 2400);
    G.rig.addTrauma(0.5);
    if (!victim) { this.player.takeHit(999, g.pos, { unblockable: true, undodgeable: true }); return; }
    await this._seize(victim, 'taken by the Cyclops');
    g.perception = true;
    this.ai = { mode: 'routine', idx: this.ai.idx + 1, at: false, walking: false, t: 0, walkId: this.ai.walkId + 1 };
    this.seizing = false;
  }

  async _seize(victim, cause) {
    const s = this.script, g = this.cyclops;
    this.lockControl(true);
    G.ui.letterbox(true);
    const was = { mode: G.rig.mode };
    G.rig.setStatic(victim.pos.clone().add(new THREE.Vector3(victim.pos.x > 0 ? -7 : 7, 4, 6)), victim.pos.clone().setY(2.5), 0);
    victim.state = 'idle'; victim.crouch = false; victim.custom = { lArmX: -2.4, rArmX: -2.4, headX: -0.5 }; victim.model.setExpression('fear', 1);
    for (const c of this.crew) if (c !== victim) c.model.setExpression('grief', 1);
    this.player.model.setExpression('grief', 0.8);
    const dl = this.int.dramaLight;
    if (this.zone === this.int) { dl.position.set(victim.pos.x * 0.6, 12, victim.pos.z * 0.6); dl.target.position.copy(victim.pos); dl.intensity = 900; }
    const dx = victim.pos.x - g.pos.x, dz = victim.pos.z - g.pos.z, d = Math.hypot(dx, dz);
    if (d > 4.5) await Promise.race([g.walkTo(victim.pos.x - (dx / d) * 3.8, victim.pos.z - (dz / d) * 3.8, 3.4), s.wait(6)]);
    g.stopWalk(); g.face(victim.pos.x, victim.pos.z);
    await s.wait(0.6);
    g.setActivity('reach');
    G.audio.play('grunt', { pos: g.headWorld(), pitch: 0.3, vol: 1.2 });
    await s.wait(0.8);
    this.crew.splice(this.crew.indexOf(victim), 1);
    g.model.rHand.attach(victim.root);
    if (victim.model.spear) victim.model.spear.visible = false;
    this.held = victim;
    g.setActivity('lift');
    G.audio.play('grunt', { pos: victim.pos, pitch: 1.3 });
    G.state.loseCrew(victim.id, cause);
    await s.wait(1.4);
    victim.root.visible = false;
    victim.root.removeFromParent();
    this.held = null;
    dl.intensity = 0;
    g.setActivity('idle');
    await s.wait(1.0);
    G.ui.letterbox(false);
    this.followCam(this.player.yaw);
    this.lockControl(false);
    void was;
  }
}
