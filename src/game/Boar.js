import * as THREE from 'three';
import { G } from '../core/context.js';
import { DIFFICULTY } from '../core/Config.js';
import { COMBAT } from '../core/Tuning.js';
import { Quadruped } from '../assets/Character.js';
import { damp, dampAngle, wrapAngle, clamp, rand } from '../core/math.js';

// Wild boar: readable telegraph (paw, snort, head down, dust), turn-taking via a shared attack token,
// flanking, and adaptation: feints if the player keeps parrying, homes in if the player spams dodges.
export class Boar {
  constructor(home) {
    this.model = new Quadruped('boar', 1.2);
    this.root = this.model.root;
    this.home = home.clone();
    this.pos = home.clone(); this.prev = home.clone();
    this.vel = new THREE.Vector3();
    this.yaw = Math.random() * 6; this.prevYaw = this.yaw;
    const diff = DIFFICULTY[G.settings.difficulty] || DIFFICULTY.normal;
    this.maxHp = this.hp = 42 * diff.enemyHp;
    this.radius = 0.85; this.height = 1.0; this.mass = 1.2;
    this.alive = true; this.vulnerable = false;
    this.state = 'idle'; this.t = 0;
    this.flash = 0;
    this.orbitDir = Math.random() < 0.5 ? 1 : -1;
    this.wanderT = 0; this.feint = false;
    this.hitPlayer = false;
    this.mats = [];
    this.root.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); this.mats.push(o.material); } });
  }
  setZone(z) { this.zone = z; z.scene.add(this.root); this.pos.y = z.ground(this.pos.x, this.pos.z); }
  set(s) { this.state = s; this.t = 0; }

  fixedUpdate(dt, ctx) {
    this.prev.copy(this.pos); this.prevYaw = this.yaw;
    this.t += dt;
    const p = ctx.player, token = ctx.token;
    const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z, dist = Math.hypot(dx, dz);
    const toP = Math.atan2(dx, dz);
    let want = 0, wantYaw = null, turn = 6;

    switch (this.state) {
      case 'idle': {
        this.wanderT -= dt;
        if (this.wanderT <= 0) { this.wanderT = rand(2, 5); this.wander = this.home.clone().add(new THREE.Vector3(rand(-5, 5), 0, rand(-5, 5))); }
        const wx = this.wander ? this.wander.x - this.pos.x : 0, wz = this.wander ? this.wander.z - this.pos.z : 0;
        if (Math.hypot(wx, wz) > 0.8) { want = 1.2; wantYaw = Math.atan2(wx, wz); }
        const seen = dist < 22 && Math.abs(wrapAngle(toP - this.yaw)) < 1.1;
        if ((seen || dist < 8 || ctx.alerted) && p.alive) { this.set('alert'); G.audio.play('snort', { pos: this.pos }); ctx.onAlert?.(); }
        break;
      }
      case 'alert':
        wantYaw = toP; turn = 8;
        if (this.t > 0.9) this.set('circle');
        break;
      case 'circle': {
        if (!p.alive) { this.set('idle'); break; }
        // Flank: orbit at range, offset from whoever holds the token.
        const ring = 7.5;
        let ang = Math.atan2(-dx, -dz) + this.orbitDir * 0.9 * dt * 2;
        if (token.owner && token.owner !== this) ang = Math.atan2(token.owner.pos.x - p.pos.x, token.owner.pos.z - p.pos.z) + Math.PI * 0.7 * this.orbitDir;
        const gx = p.pos.x + Math.sin(ang) * ring, gz = p.pos.z + Math.cos(ang) * ring;
        const ex = gx - this.pos.x, ez = gz - this.pos.z;
        if (Math.hypot(ex, ez) > 0.6) { want = 3.2; this.moveYaw = Math.atan2(ex, ez); }
        wantYaw = toP;
        if (!token.owner && this.t > rand(1.2, 2.2) && dist < 13) { token.owner = this; this.feint = (p.parryStreak >= 2) && Math.random() < 0.8; this.set('telegraph'); G.audio.play('snort', { pos: this.pos, vol: 1.2 }); }
        break;
      }
      case 'telegraph': {
        wantYaw = toP; turn = 10;
        const tel = this.feint ? 0.55 : 0.95 / (G.settings.difficulty === 'hard' ? 1.25 : 1);
        this.model.paw = 1;
        if (Math.random() < dt * 14) this.zone.fx.emit('dust', this.pos.clone().add(new THREE.Vector3(Math.sin(this.yaw) * 0.6, 0.1, Math.cos(this.yaw) * 0.6)), 1, { scale: 0.7 });
        if (this.t > tel) {
          this.model.paw = 0;
          this.chargeYaw = toP + wrapAngle(Math.atan2(p.vel.x, p.vel.z) - toP) * 0.0;
          this.chargeLen = this.feint ? 0.3 : 1.25;
          this.hitPlayer = false;
          this.set('charge');
          G.audio.play('squeal', { pos: this.pos });
        }
        break;
      }
      case 'charge': {
        // Spam-dodgers get homed: late steering toward the player
        if (p.dodgeLog.length >= 3) this.chargeYaw = this.yaw + clamp(wrapAngle(toP - this.yaw), -1.2 * dt, 1.2 * dt);
        this.yaw = this.chargeYaw;
        want = 13; this.moveYaw = this.chargeYaw;
        if (Math.random() < dt * 20) this.zone.fx.emit('dust', this.pos, 1, { scale: 0.8 });
        if (!this.hitPlayer && dist < 1.5 && p.alive) {
          this.hitPlayer = true;
          const res = p.takeHit(22, this.pos, { knock: 9 });
          if (res === 'parried') { this.stun(2.6); token.owner = null; return; }
          if (res === 'blocked' || res === 'partial' || res === 'guardbreak') { this.vel.multiplyScalar(-0.4); this.set('recover'); token.owner = null; return; }
        }
        for (const c of ctx.crew || []) { if (c.visible && c.pos.distanceTo(this.pos) < 1.4 && !c._dove) { c._dove = true; c.vel.add(new THREE.Vector3(Math.cos(this.yaw) * 6, 0, -Math.sin(this.yaw) * 6)); setTimeout(() => (c._dove = false), 1500); } }
        if (this.t > this.chargeLen || this._bumped) {
          this._bumped = false;
          if (this.feint) { this.feint = false; this.set('telegraph'); this.t = 0.6; }
          else { this.set('recover'); token.owner = null; }
        }
        break;
      }
      case 'recover':
        want = 0.5; wantYaw = toP; turn = 2;
        this.vulnerable = this.t < 1.1;
        if (this.t > 1.4) { this.vulnerable = false; this.set('circle'); }
        break;
      case 'stunned':
        this.vulnerable = true;
        this.model.root.rotation.z = Math.sin(this.t * 20) * 0.08;
        if (this.t > this.stunT) { this.vulnerable = false; this.model.root.rotation.z = 0; this.set('circle'); }
        break;
      case 'flinch':
        if (this.t > 0.3) this.set(this.prevState === 'charge' ? 'recover' : 'circle');
        break;
      case 'dead':
        this.model.root.rotation.z = damp(this.model.root.rotation.z, Math.PI / 2, 6, dt);
        if (this.t > 4) this.root.position.y -= dt * 0.3;
        if (this.t > 7) this.root.visible = false;
        this.vel.multiplyScalar(0.9);
        break;
    }
    if (this.state === 'dead') { this.pos.addScaledVector(this.vel, dt); return; }

    if (wantYaw !== null) this.yaw = dampAngle(this.yaw, wantYaw, turn, dt);
    const my = this.moveYaw ?? this.yaw;
    this.moveYaw = undefined;
    this.vel.x = damp(this.vel.x, Math.sin(my) * want, this.state === 'charge' ? 6 : 5, dt);
    this.vel.z = damp(this.vel.z, Math.cos(my) * want, this.state === 'charge' ? 6 : 5, dt);
    const bx = this.pos.x, bz = this.pos.z;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    this.zone.collide(this.pos, this.radius, this.prev);
    if (this.state === 'charge' && Math.hypot(this.pos.x - bx, this.pos.z - bz) < this.vel.length() * dt * 0.4) { this._bumped = true; this.stun(1.8); ctx.token.owner = null; G.audio.play('thunk', { pos: this.pos }); G.rig.addTrauma(0.15); }
    this.pos.y = damp(this.pos.y, this.zone.ground(this.pos.x, this.pos.z), 20, dt);
  }

  stun(t) { this.stunT = t; this.set('stunned'); G.audio.play('squeal', { pos: this.pos, vol: 0.7 }); }

  hurt(dmg, dir, info) {
    if (!this.alive) return 'none';
    this.hp -= dmg * (this.vulnerable ? 1.5 : 1);
    this.flash = 1;
    this.vel.addScaledVector(dir, (info.heavy ? COMBAT.knockHeavy : COMBAT.knockLight) / this.mass);
    G.audio.play('squeal', { pos: this.pos, vol: 0.5 });
    if (this.hp <= 0) {
      this.alive = false; this.set('dead');
      if (this.zone.token.owner === this) this.zone.token.owner = null;
      this.zone.onEnemyDied?.(this);
      return 'kill';
    }
    if (this.state !== 'charge' && this.state !== 'stunned') { this.prevState = this.state; this.set('flinch'); if (this.zone.token.owner === this) this.zone.token.owner = null; }
    return 'hit';
  }

  render(alpha, dt) {
    this.root.position.lerpVectors(this.prev, this.pos, alpha);
    this.root.rotation.y = this.prevYaw + wrapAngle(this.yaw - this.prevYaw) * alpha;
    this.model.update(dt, this.state === 'dead' ? 0 : Math.hypot(this.vel.x, this.vel.z), { headDown: this.state === 'telegraph' || this.state === 'charge' });
    this.flash = Math.max(0, this.flash - dt * 6);
    const tele = this.state === 'telegraph' ? 0.5 + 0.5 * Math.sin(this.t * 30) : 0;
    for (const m of this.mats) { m.emissive.setRGB(this.flash + tele * 0.5, this.flash * 0.8 + tele * 0.12, this.flash * 0.6); }
  }
}
