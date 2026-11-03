import * as THREE from 'three';
import { G } from '../core/context.js';
import { TUNING, DIFFICULTY } from '../core/Config.js';
import { COMBAT, RUMBLE, Tuning } from '../core/Tuning.js';
import { clamp, damp, dampAngle, wrapAngle, lerp } from '../core/math.js';
import { Humanoid, ACTIONS } from '../assets/Character.js';
import { Mat, cachedGeo } from '../assets/Assets.js';
import { Trail } from '../render/Particles.js';
import { ODYSSEUS } from '../data/crew.js';

const T = TUNING.player;
const COMBO = ['slash1', 'slash2', 'heavy'];
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3();

export class Player {
  constructor() {
    this.model = new Humanoid({ id: 'odysseus', look: ODYSSEUS.look, sword: true, shield: true, bow: true, cloak: true });
    this.root = this.model.root;
    this.pos = new THREE.Vector3(); this.prev = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.prevYaw = 0;
    this.hp = 100; this.maxHp = 100; this.stamina = T.stamina; this.staminaDelay = 0;
    this.state = 'move'; this.stateT = 0;
    this.weapon = 'sword';
    this.control = true;
    this.crouch = false; this.sprinting = false; this.blocking = false; this.blockStart = -10; this.aiming = false; this.draw = 0;
    this.combo = 0; this.comboResetT = 0; this.riposteT = 0;
    this.hitSet = new Set();
    this.carry = null;           // { slow, noise } when carrying the stake
    this.zone = null;
    this.focus = null;           // current interactable
    this.holdT = 0;
    this.lockTarget = null;
    this.arrows = [];
    this.parryStreak = 0; this.dodgeLog = [];
    this.autoMove = null;
    this.trail = new Trail(12, 0xffe0b0, 0.55);
    this.model.onStep = () => this._step();
    this.time = 0;
  }

  setZone(zone) {
    this.zone = zone;
    zone.scene.add(this.root);
    zone.scene.add(this.trail.mesh);
    for (const a of this.arrows) zone.scene.add(a.mesh);
  }
  place(x, z, yaw = this.yaw) {
    this.pos.set(x, this.zone ? this.zone.ground(x, z) : 0, z);
    this.prev.copy(this.pos); this.vel.set(0, 0, 0);
    this.yaw = this.prevYaw = yaw;
  }
  get alive() { return this.state !== 'dead'; }
  get forward() { return _u.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  get iframes() { return this.state === 'dodge' && this.stateT >= T.iframeStart && this.stateT <= T.iframeEnd; }
  get noiseRadius() {
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp < 0.4) return 0;
    if (this.carry) return T.noise.carry;
    if (this.crouch) return T.noise.crouch;
    return this.sprinting ? T.noise.sprint : T.noise.run;
  }
  get diff() { return DIFFICULTY[G.settings.difficulty] || DIFFICULTY.normal; }

  setState(s) { this.state = s; this.stateT = 0; }

  fixedUpdate(dt) {
    this.time += dt;
    this.prev.copy(this.pos); this.prevYaw = this.yaw;
    this.stateT += dt;
    const input = G.input;
    const canAct = this.control && !G.ui.inDialogue && !G.ui.menuOpen && !G.debug.fly;
    const camYaw = G.rig.yaw;

    // Desired movement relative to the camera
    let wishX = 0, wishZ = 0, mag = 0;
    if (this.autoMove) {
      const a = this.autoMove;
      const dx = a.x - this.pos.x, dz = a.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.35) { const r = a.resolve; this.autoMove = null; r?.(); }
      else { wishX = dx / d; wishZ = dz / d; mag = Math.min(1, d) * (a.speed || 0.5); }
    } else if (canAct) {
      const m = input.move();
      const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
      // camera right = (-cos yaw, 0, sin yaw)
      wishX = fx * m.y - Math.cos(camYaw) * m.x;
      wishZ = fz * m.y + Math.sin(camYaw) * m.x;
      mag = Math.min(1, Math.hypot(m.x, m.y));
      if (mag > 0.01) { const l = Math.hypot(wishX, wishZ); wishX /= l; wishZ /= l; }
    }

    if (canAct) {
      if (input.pressed('crouch')) this.crouch = !this.crouch;
      if (input.pressed('weapon') && this.state === 'move' && !this.carry) {
        this.weapon = this.weapon === 'sword' ? 'bow' : 'sword';
        G.audio.play('pickup', { vol: 0.5 });
      }
      if (input.pressed('lock')) this._toggleLock();
    }
    if (this.lockTarget && (!this.lockTarget.alive || this.lockTarget.pos.distanceTo(this.pos) > 24)) this._toggleLock(true);

    this.blocking = false; this.aiming = false;
    const st = this.state;
    if (st === 'move') this._move(dt, wishX, wishZ, mag, canAct);
    else if (st === 'attack') this._attack(dt, canAct);
    else if (st === 'dodge') this._dodge(dt);
    else if (st === 'hit' || st === 'stagger') { this._friction(dt, 6); if (this.stateT > (st === 'hit' ? 0.38 : 0.9)) this.setState('move'); }
    else if (st === 'interact') this._interact(dt, canAct);
    else if (st === 'dead' || st === 'locked') this._friction(dt, 8);

    // Integrate & collide
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    if (this.zone) {
      this.zone.collide(this.pos, 0.42, this.prev);
      const gy = this.zone.ground(this.pos.x, this.pos.z);
      this.pos.y = damp(this.pos.y, gy, 25, dt);
    }

    // Stamina
    if (this.staminaDelay > 0) this.staminaDelay -= dt;
    else this.stamina = Math.min(T.stamina, this.stamina + T.staminaRegen * dt * (this.blocking ? 0.3 : 1));
    if (this.riposteT > 0) this.riposteT -= dt;
    if (this.comboResetT > 0) { this.comboResetT -= dt; if (this.comboResetT <= 0) this.combo = 0; }
    this.dodgeLog = this.dodgeLog.filter((t) => this.time - t < 6);

    this._updateArrows(dt);
    this._updateFocus(canAct);
  }

  _friction(dt, k) { this.vel.x = damp(this.vel.x, 0, k, dt); this.vel.z = damp(this.vel.z, 0, k, dt); }

  _move(dt, wx, wz, mag, canAct) {
    const input = G.input;
    const bow = this.weapon === 'bow';
    if (canAct && !this.carry) {
      if (this.blockLock > 0) this.blockLock -= dt;
      else if (!bow && input.isDown('alt')) { if (!this._wasBlock) { this.blockStart = this.time; this._blockHit = false; } this.blocking = true; }
      if (this._wasBlock && !this.blocking && !this._blockHit && this.time - this.blockStart < 0.35) this.blockLock = COMBAT.parryMissRecovery;
      if (bow && input.isDown('alt')) this.aiming = true;
    }
    this._wasBlock = this.blocking;
    if (this.aiming) {
      if (this.draw === 0) G.audio.play('bowDraw', { vol: 0.6 });
      this.draw = Math.min(1, this.draw + dt / 0.6);
    } else this.draw = 0;
    G.rig.aim = this.aiming;

    this.sprinting = canAct && input.isDown('sprint') && mag > 0.3 && !this.crouch && !this.carry && !this.blocking && !this.aiming && this.stamina > 1;
    let speed = T.runSpeed;
    if (this.crouch) speed = T.crouchSpeed;
    if (this.sprinting) { speed = T.sprintSpeed; this.stamina -= T.sprintCost * dt; this.staminaDelay = 0.4; }
    if (this.carry) speed = T.carrySpeed;
    if (this.blocking) speed = T.blockSpeed;
    if (this.aiming) speed = T.aimSpeed;
    if (this.autoMove) speed = T.runSpeed;
    const tx = wx * speed * mag, tz = wz * speed * mag;
    const k = mag > 0.01 ? T.accel : T.decel;
    this.vel.x = damp(this.vel.x, tx, k, dt); this.vel.z = damp(this.vel.z, tz, k, dt);

    // Facing
    let faceYaw = null;
    if (this.aiming) faceYaw = G.rig.yaw;
    else if (this.lockTarget && !this.sprinting) faceYaw = Math.atan2(this.lockTarget.pos.x - this.pos.x, this.lockTarget.pos.z - this.pos.z);
    else if (this.blocking && mag < 0.1) faceYaw = null;
    else if (mag > 0.05) faceYaw = Math.atan2(wx, wz);
    if (faceYaw !== null) this.yaw = dampAngle(this.yaw, faceYaw, T.turnRate, dt);

    if (!canAct) return;
    // Actions (buffered)
    const buf = COMBAT.inputBuffer;
    if (input.pressed('dodge', buf) && this.stamina >= T.dodgeCost * 0.5 && !this.carry) return this._startDodge(wx, wz, mag);
    if (bow && this.aiming && input.pressed('attack', buf + 0.07) && this.draw > 0.3) return this._fireArrow();
    if (!bow && !this.blocking && !this.carry && input.pressed('attack', buf + 0.07)) return this._startAttack();
    if (this.aiming && G.input.device === 'pad' && G.settings.aimAssist) this._aimAssist(dt);
    if (this.focus && input.pressed('interact')) this._beginInteract();
  }

  _startAttack() {
    let name = COMBO[this.combo % COMBO.length];
    if (this.riposteT > 0) { name = 'riposte'; this.riposteT = 0; }
    this.atk = ACTIONS[name]; this.atkName = name;
    this.setState('attack');
    this.hitSet.clear();
    this.stamina -= T.attackCost * (this.atk.heavy ? 1.6 : 1); this.staminaDelay = T.staminaDelay;
    this.model.play(name);
    this._swung = false;
    // Snap toward lock target or nearest enemy in front (soft aim assist)
    const tgt = this.lockTarget || this._nearestEnemy(4.5, 1.3);
    if (tgt) this.yaw = Math.atan2(tgt.pos.x - this.pos.x, tgt.pos.z - this.pos.z);
  }

  _attack(dt, canAct) {
    const a = this.atk, t = this.stateT / a.dur;
    const input = G.input;
    // Root motion lunge during the strike
    const lunge = t > a.active[0] - 0.12 && t < a.active[1] ? a.step / ((a.active[1] - a.active[0] + 0.12) * a.dur) : 0;
    const f = this.forward;
    this.vel.x = damp(this.vel.x, f.x * lunge, 20, dt); this.vel.z = damp(this.vel.z, f.z * lunge, 20, dt);
    if (!this._swung && t >= a.active[0] - 0.05) { this._swung = true; G.audio.play('swing', { pitch: a.heavy ? 0.7 : 1 + Math.random() * 0.2, pos: this.pos }); }
    this.trail.active = a.trail && t >= a.active[0] - 0.04 && t <= a.active[1] + 0.04;
    if (t >= a.active[0] && t <= a.active[1]) this._hitCheck(a);
    if (canAct) {
      const inActive = t >= a.active[0] && t <= a.active[1];
      if (!inActive && input.pressed('dodge') && this.stamina > 5) { this.trail.active = false; const m = input.move(); const cy = G.rig.yaw; return this._startDodge(Math.sin(cy) * m.y - Math.cos(cy) * m.x, Math.cos(cy) * m.y + Math.sin(cy) * m.x, Math.hypot(m.x, m.y)); }
      if (!inActive && this.weapon === 'sword' && input.isDown('alt') && t < a.active[0]) { this.trail.active = false; this.setState('move'); this.model.stop(); this.blockStart = this.time; return; }
      if (t >= a.cancel && input.pressed('attack', 0.4) && this.stamina > 4) {
        this.combo = (this.combo + 1) % COMBO.length;
        this.trail.active = false;
        return this._startAttack();
      }
    }
    if (t >= 1) { this.trail.active = false; this.combo = (this.combo + 1) % COMBO.length; this.comboResetT = 0.45; this.setState('move'); }
  }

  _hitCheck(a) {
    const enemies = this.zone?.enemies || [];
    const f = this.forward;
    for (const e of enemies) {
      if (!e.alive || this.hitSet.has(e)) continue;
      _v.subVectors(e.pos, this.pos); _v.y = 0;
      const d = _v.length();
      if (d > a.reach + e.radius) continue;
      _v.normalize();
      if (Math.acos(clamp(_v.dot(f), -1, 1)) > a.arc * 0.5 + (d < e.radius + 0.6 ? 0.8 : 0)) continue;
      this.hitSet.add(e);
      const crit = !!a.crit || (e.vulnerable && a.heavy);
      const dmg = a.dmg * (crit ? 1.5 : 1);
      const res = e.hurt(dmg, _w.copy(_v), { heavy: a.heavy, crit, from: this });
      this._hitFeedback(e, a, crit, res);
    }
  }

  _hitFeedback(e, a, crit, res) {
    const p = _w.copy(this.pos).lerp(e.pos, 0.6); p.y = this.pos.y + 1.1;
    if (res === 'immune') {
      G.engine.hitStop(0.06); G.rig.addTrauma(0.25);
      G.audio.play('thunk', { pos: p }); this.zone.fx.emit('dust', p, 6);
      return;
    }
    G.engine.hitStop(crit ? COMBAT.hitStopCrit : a.heavy ? COMBAT.hitStopHeavy : COMBAT.hitStopLight);
    G.rig.addTrauma(crit ? COMBAT.shakeCrit : a.heavy ? COMBAT.shakeHeavy : COMBAT.shakeLight);
    G.input.rumble(...(crit ? RUMBLE.crit : a.heavy ? RUMBLE.heavy : RUMBLE.light));
    if (crit) { G.engine.setTimeScale(COMBAT.slowmoCrit, 40); setTimeout(() => G.engine.setTimeScale(1, 4), 220); G.rig.fovKick(-5); }
    G.audio.play('hit', { pos: p, heavy: a.heavy || crit });
    this.zone.fx.emit('hit', p, crit ? 3 : 2);
    this.zone.fx.emit('spark', p, crit ? 26 : 12, { dir: this.forward });
    this.zone.fx.emit('dust', p, 4);
    this.zone.fx.flash(p, crit ? 0xfff0c0 : 0xffd090, crit ? 60 : 30, 0.12);
    if (a.heavy || crit) G.post.kick({ ca: crit ? 1 : 0.5, radial: crit ? 0.8 : 0.3 });
  }

  _startDodge(wx, wz, mag) {
    let dx = wx, dz = wz;
    if (mag < 0.1) { dx = -Math.sin(this.yaw); dz = -Math.cos(this.yaw); }
    const l = Math.hypot(dx, dz) || 1;
    this.dodgeDir = { x: dx / l, z: dz / l };
    this.yaw = Math.atan2(this.dodgeDir.x, this.dodgeDir.z);
    this.stamina -= T.dodgeCost; this.staminaDelay = T.staminaDelay;
    this.setState('dodge');
    this.model.play('dodge');
    this.dodgeLog.push(this.time);
    G.audio.play('whoosh', { pos: this.pos, vol: 0.8 });
  }
  _dodge(dt) {
    const t = this.stateT / T.dodgeTime;
    const sp = T.dodgeSpeed * (1 - t * t) * (t < 0.85 ? 1 : 0.3);
    this.vel.x = this.dodgeDir.x * sp; this.vel.z = this.dodgeDir.z * sp;
    if (t > 0.35 && t < 0.4 && this.zone) this.zone.fx.emit('dust', this.pos, 2, { scale: 0.6 });
    if (t >= 1) this.setState('move');
  }

  _fireArrow() {
    if (G.state.arrows <= 0) { G.ui.toast('No arrows left', 'warn'); G.audio.play('uiBack'); return; }
    G.state.arrows--;
    const cam = G.camera;
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const target = cam.position.clone().addScaledVector(dir, 70);
    const origin = this.pos.clone().add(new THREE.Vector3(0, 1.45, 0)).addScaledVector(this.forward, 0.5);
    const v = target.sub(origin).normalize().multiplyScalar(30 + 30 * this.draw);
    const mesh = new THREE.Mesh(cachedGeo('arrow', () => { const g = new THREE.CylinderGeometry(0.012, 0.012, 0.8, 4); g.rotateX(Math.PI / 2); return g; }), Mat.darkWood);
    mesh.position.copy(origin);
    this.zone.scene.add(mesh);
    const trail = new Trail(8, 0xfff0d0, 0.35); trail.active = true; this.zone.scene.add(trail.mesh);
    this.arrows.push({ mesh, pos: origin, vel: v, life: 8, stuck: false, trail, dmg: 10 + 16 * this.draw });
    this.draw = 0;
    G.audio.play('bowRelease', { pos: origin });
    G.rig.addTrauma(0.08);
  }

  _updateArrows(dt) {
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.life -= dt;
      if (!a.stuck) {
        a.vel.y -= 6 * dt;
        a.pos.addScaledVector(a.vel, dt);
        a.mesh.position.copy(a.pos);
        a.mesh.lookAt(_v.copy(a.pos).add(a.vel));
        a.trail.update(dt, a.pos, _w.copy(a.pos).addScaledVector(a.vel, -0.012));
        for (const e of this.zone.enemies) {
          if (!e.alive) continue;
          _v.copy(e.pos); _v.y += e.height ? e.height * 0.5 : 0.7;
          if (_v.distanceTo(a.pos) < e.radius + 0.25) {
            const res = e.hurt(a.dmg, _w.copy(a.vel).setY(0).normalize(), { arrow: true, from: this });
            this._hitFeedback(e, { heavy: false }, false, res);
            a.life = 0; break;
          }
        }
        if (this.zone.ground(a.pos.x, a.pos.z) > a.pos.y) { a.stuck = true; a.trail.active = false; G.audio.play('thunk', { pos: a.pos, vol: 0.5 }); this.zone.fx.emit('dust', a.pos, 3, { scale: 0.4 }); }
      } else a.trail.update(dt);
      if (a.life <= 0) { a.mesh.removeFromParent(); a.trail.mesh.removeFromParent(); this.arrows.splice(i, 1); }
    }
  }

  _nearestEnemy(range, arc = Math.PI) {
    let best = null, bd = range;
    for (const e of this.zone?.enemies || []) {
      if (!e.alive || e.noLock) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d > bd) continue;
      if (Math.abs(wrapAngle(Math.atan2(dx, dz) - this.yaw)) > arc) continue;
      best = e; bd = d;
    }
    return best;
  }
  _toggleLock(off = false) {
    if (this.lockTarget || off) { this.lockTarget = null; G.rig.lockTarget = null; return; }
    const e = this._nearestEnemy(20);
    if (e) { this.lockTarget = e; G.rig.lockTarget = e.pos; G.audio.play('ui'); }
  }

  // ---------- interaction ----------
  _updateFocus(canAct) {
    this.focus = null;
    if (!this.zone?.interactables || !canAct || this.state === 'dead') return;
    let bd = Infinity;
    for (const it of this.zone.interactables) {
      if (it.enabled && !it.enabled()) continue;
      const d = Math.hypot(it.pos.x - this.pos.x, it.pos.z - this.pos.z);
      if (d < (it.radius || 2.2) && d < bd) { bd = d; this.focus = it; }
    }
  }
  _beginInteract() {
    const it = this.focus;
    if (it.hold) { this.setState('interact'); this.holdT = 0; this.holdNeed = it.hold; this.interacting = it; this.model.play('interact'); it.onStart?.(); }
    else { this.model.play(it.anim || 'interact'); it.action(); }
  }
  _interact(dt, canAct) {
    this._friction(dt, 12);
    const it = this.interacting;
    if (!it || !canAct || !G.input.isDown('interact') || (it.enabled && !it.enabled())) { it?.onCancel?.(); this.interacting = null; this.setState('move'); this.model.stop(); return; }
    if (this.model.actionDone) this.model.play('interact');
    this.holdT += dt;
    it.onTick?.(dt, this.holdT / this.holdNeed);
    if (this.holdT >= this.holdNeed) { this.interacting = null; this.setState('move'); it.action(); }
  }

  // ---------- damage ----------
  takeHit(dmg, fromPos, o = {}) {
    if (this.state === 'dead') return 'none';
    if (this.iframes && !o.undodgeable) {
      if (this.stateT < 0.2) { G.engine.setTimeScale(0.35, 30); setTimeout(() => G.engine.setTimeScale(1, 4), 280); }
      return 'dodged';
    }
    _v.subVectors(fromPos, this.pos); _v.y = 0; _v.normalize();
    const facing = _v.dot(this.forward) > 0.25;
    if (this.blocking && facing && !o.unblockable) {
      const p = _w.copy(this.pos).addScaledVector(_v, 0.6); p.y += 1.2;
      const held = this.time - this.blockStart, perfect = Tuning.parryWindow(G.settings.difficulty);
      this._blockHit = true;
      if (held < perfect) {
        // Perfect parry: hit-stop, bright burst, ring + thud, slight zoom-in, riposte opening.
        this.model.play('parry');
        G.audio.play('perfect', { pos: p }); G.audio.play('thunk', { pos: p, vol: 0.9 });
        this.zone.fx.emit('spark', p, 46, { dir: _v });
        this.zone.fx.emit('hit', p, 4);
        this.zone.fx.flash(p, 0xfff4d0, 90, 0.2);
        G.engine.hitStop(COMBAT.parryHitStop);
        G.engine.setTimeScale(0.25, 40); setTimeout(() => G.engine.setTimeScale(1, 3), 350);
        G.rig.addTrauma(0.35); G.rig.fovKick(-COMBAT.parryZoom); G.post.kick({ ca: 0.8 });
        G.input.rumble(...RUMBLE.parry);
        this.riposteT = COMBAT.riposteWindow;
        this.parryStreak++;
        return 'parried';
      }
      this.parryStreak = 0;
      const partial = held < perfect + COMBAT.partialWindow;
      this.stamina -= dmg * COMBAT.blockStaminaMul * (partial ? 0.6 : 1); this.staminaDelay = T.staminaDelay;
      G.audio.play('clang', { pos: p, pitch: partial ? 1.1 : 0.9 });
      this.zone.fx.emit('spark', p, partial ? 22 : 12, { dir: _v });
      G.rig.addTrauma(partial ? 0.3 : 0.22); G.rig.punch(_v.x * 0.02, 0.01);
      G.input.rumble(...RUMBLE.block);
      this.vel.addScaledVector(_v, -4);
      if (this.stamina <= 0) { this.stamina = 0; this.setState('stagger'); this.model.play('stagger'); this._damage(dmg * 0.5, o, fromPos); return 'guardbreak'; }
      const chip = dmg * (partial ? COMBAT.partialDamage * 0.5 : COMBAT.blockDamage);
      if (chip > 0.5 && !G.debug.god) this.hp = Math.max(1, this.hp - chip * this.diff.dmgTaken);
      return partial ? 'partial' : 'blocked';
    }
    this.parryStreak = 0;
    this._damage(dmg, o, fromPos);
    this.vel.addScaledVector(_v, -(o.knock ?? 6));
    if (this.state !== 'dead') { this.setState(o.heavy ? 'stagger' : 'hit'); this.model.play(o.heavy ? 'stagger' : 'hit'); }
    return 'hit';
  }
  _damage(dmg, o, fromPos) {
    if (G.debug.god) dmg = 0;
    dmg *= this.diff.dmgTaken;
    this.hp = Math.max(0, this.hp - dmg);
    G.audio.play('grunt', { pos: this.pos, pitch: 0.9 + Math.random() * 0.2 });
    G.audio.play('hit', { pos: this.pos, heavy: o.heavy });
    G.rig.addTrauma(o.heavy ? Math.min(1, COMBAT.shakeTaken * 1.5) : COMBAT.shakeTaken);
    // Directional camera punch away from the blow.
    if (fromPos) { const dx = this.pos.x - fromPos.x, dz = this.pos.z - fromPos.z, l = Math.hypot(dx, dz) || 1; const camSide = (dx / l) * -Math.cos(G.rig.yaw) + (dz / l) * Math.sin(G.rig.yaw); G.rig.punch(camSide * 0.05, -0.03); }
    G.post.hurt(0.5 + dmg / 60);
    G.post.kick({ ca: 0.6 });
    G.input.rumble(...RUMBLE.hurt);
    G.engine.hitStop(COMBAT.hitStopTaken);
    this.model.setExpression('pain', 1); setTimeout(() => this.model.setExpression(null, 0), 900);
    this.trail.active = false; this.interacting = null;
    if (this.hp <= 0) { this.setState('dead'); this.model.play('death'); G.bus.emit('playerDied'); }
  }
  heal(n) { this.hp = Math.min(this.maxHp, this.hp + n); }

  // Gamepad bow assist: gentle magnetism toward an enemy near the crosshair.
  _aimAssist(dt) {
    const cam = G.camera, dir = cam.getWorldDirection(_u.clone());
    let best = null, bestAng = 0.16;
    for (const e of this.zone?.enemies || []) {
      if (!e.alive || e.noLock) continue;
      const to = _v.copy(e.pos).setY(e.pos.y + (e.height || 1) * 0.5).sub(cam.position);
      const d = to.length(); if (d > 45) continue;
      const ang = dir.angleTo(to.normalize());
      if (ang < bestAng) { bestAng = ang; best = e; }
    }
    if (!best) return;
    const to = _v.copy(best.pos).setY(best.pos.y + (best.height || 1) * 0.5).sub(cam.position);
    const yaw = Math.atan2(to.x, to.z), pitch = Math.atan2(-to.y, Math.hypot(to.x, to.z));
    const k = COMBAT.aimAssist * dt * 6;
    G.rig.yaw += wrapAngle(yaw - G.rig.yaw) * k;
    G.rig.pitch += (pitch - G.rig.pitch) * k;
  }

  _step() {
    if (!this.zone) return;
    const surf = this.zone.surface ? this.zone.surface(this.pos.x, this.pos.z) : 'stone';
    const r = this.noiseRadius;
    G.audio.play('step', { surface: surf, pos: this.pos, vol: this.crouch ? 0.25 : this.sprinting ? 0.9 : 0.55 });
    if (r > 0 && this.zone.noise) this.zone.noise(this.pos, r, 'step');
    if (this.sprinting && surf !== 'stone') this.zone.fx.emit('dust', this.pos, 1, { scale: 0.5 });
  }

  // ---------- render ----------
  render(alpha, dt) {
    if (!this.attached) {
      this.root.position.lerpVectors(this.prev, this.pos, alpha);
      this.root.rotation.y = this.prevYaw + wrapAngle(this.yaw - this.prevYaw) * alpha;
    }
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.model.update(dt, {
      speed: this.state === 'move' || this.state === 'locked' ? sp : 0, groundSpeed: this.state === 'move' || this.state === 'locked' ? sp : 0,
      crouch: this.crouch && this.state === 'move', block: this.blocking, aim: this.aiming, draw: this.draw,
      carry: !!this.carry, ground: this.zone ? (x, z) => this.zone.ground(x, z) : null,
      lookAt: this.lookAt || (this.lockTarget ? _v.copy(this.lockTarget.pos).setY(this.lockTarget.pos.y + 1) : null),
      custom: this.customPose || null, hideSword: !!this.carry,
    });
    if (this.model.swordTip) {
      const tip = this.model.swordTip.getWorldPosition(_v), base = this.model.swordBase.getWorldPosition(_w);
      this.trail.update(dt, base, tip);
    }
    G.post.lowHealth = this.hp / this.maxHp < COMBAT.lowHealth ? 1 - this.hp / (this.maxHp * COMBAT.lowHealth) : 0;
    G.ui.setVitals({ hp: this.hp, maxHp: this.maxHp, stamina: this.stamina, arrows: G.state.arrows, weapon: this.weapon, inCombat: !!this.zone?.inCombat });
    G.ui.crosshair(this.aiming);
    if (this.state === 'interact' && this.interacting) G.ui.prompt(this.interacting.label, 'interact', this.interacting.progress ? this.interacting.progress() : this.holdT / this.holdNeed);
    else if (this.focus && this.control) G.ui.prompt(this.focus.label + (this.focus.hold ? ' (hold)' : ''), 'interact');
    else G.ui.prompt(null);
  }
}
