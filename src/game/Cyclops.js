import * as THREE from 'three';
import { G } from '../core/context.js';
import { DIFFICULTY } from '../core/Config.js';
import { Humanoid, P } from '../assets/Character.js';
import { Mat } from '../assets/Assets.js';
import { damp, dampAngle, wrapAngle, clamp, smoothstep } from '../core/math.js';
import { POLYPHEMUS } from '../data/crew.js';

export const CYCLOPS_SCALE = 4.4;

// Custom poses (model space) for the giant's activities.
const POSES = {
  tend: (t) => ({ bodyY: -0.22, lean: 0.55, lLegX: -0.9, lKnee: 1.4, rLegX: -0.2, rKnee: 0.9, rArmX: -1.1 + Math.sin(t * 1.6) * 0.25, rArmY: Math.sin(t * 1.6) * 0.4, rElb: -0.4, lArmX: -0.4, lElb: -0.6, headX: 0.35 }),
  milk: (t) => ({ bodyY: -0.3, lean: 0.7, lLegX: -1.0, lKnee: 1.6, rLegX: -1.0, rKnee: 1.6, lArmX: -1.2 + Math.sin(t * 4) * 0.12, rArmX: -1.2 - Math.sin(t * 4) * 0.12, lElb: -0.5, rElb: -0.5, headX: 0.4 }),
  eat: (t) => ({ chestX: -0.05, rArmX: -1.9 + Math.sin(t * 3.2) * 0.25, rElb: -1.9, lArmX: -0.8, lElb: -1.2, headX: -0.1 + Math.sin(t * 3.2) * 0.08 }),
  listen: (t) => ({ lean: -0.05, headX: -0.15, lArmZ: 0.35, rArmZ: -0.35 }),
  drink: (t) => ({ rArmX: -2.2, rElb: -1.7, rArmY: -0.4, headX: -0.45, chestX: -0.1, lArmX: -0.4 }),
  sit: (t) => ({ bodyY: -0.55, lLegX: -1.45, rLegX: -1.45, lKnee: 0.35, rKnee: 0.35, lean: 0.15, lArmX: -1.1 + Math.sin(t * 0.9) * 0.3, rArmX: -1.1 + Math.cos(t * 0.8) * 0.3, lArmZ: 0.4, rArmZ: -0.4, lElb: -0.2, rElb: -0.2 }),
  grope: (t) => ({ bodyY: -0.55, lLegX: -1.45, rLegX: -1.45, lKnee: 0.35, rKnee: 0.35, lean: 0.55, lArmX: -1.45 + Math.sin(t * 1.4) * 0.15, rArmX: -1.4 + Math.sin(t * 1.1 + 1) * 0.15, lArmY: Math.sin(t * 0.7) * 0.5, rArmY: Math.sin(t * 0.8 + 2) * 0.5, lElb: -0.15, rElb: -0.15, headX: 0.2 }),
  flail: (t) => ({ lean: -0.1 + Math.sin(t * 2.3) * 0.15, side: Math.sin(t * 1.7) * 0.12, lArmX: -2.4 + Math.sin(t * 5.1) * 0.6, rArmX: -1.8 + Math.sin(t * 4.3 + 1) * 0.8, lArmZ: 0.6, rArmZ: -0.7, lElb: -1.2, rElb: -0.9 + Math.sin(t * 6) * 0.3, headX: -0.3 + Math.sin(t * 3) * 0.2, headY: Math.sin(t * 2.2) * 0.5 }),
  // two-handed hammer blow: both fists high over the head, back arched, knees loaded
  slamRaise: () => ({ rArmX: -2.85, rArmZ: -0.12, rElb: -0.75, lArmX: -2.85, lArmZ: 0.12, lElb: -0.75, lean: -0.28, chestX: -0.3, headX: -0.15, bodyY: -0.08, lLegX: -0.25, rLegX: 0.15, lKnee: 0.35, rKnee: 0.25 }),
  slamDown: () => ({ rArmX: -1.15, rArmZ: -0.05, rElb: -0.15, lArmX: -1.15, lArmZ: 0.05, lElb: -0.15, lean: 0.85, bodyY: -0.32, lLegX: -0.85, lKnee: 1.05, rLegX: 0.2, rKnee: 0.45, chestX: 0.25, headX: -0.35 }),
  reach: () => ({ lean: 0.7, bodyY: -0.2, rArmX: -1.1, rElb: -0.1, rArmZ: -0.1, lLegX: -0.6, lKnee: 0.7 }),
  // Inspecting a man held at his chest: hand drawn in, head bowed and turned toward it.
  lift: (t) => ({ lean: 0.3, chestX: 0.22, rArmX: -0.35, rArmY: 0, rArmZ: 0.75, rElb: -1.9, rWrist: 0.4, lArmX: -0.4, lElb: -0.9, headX: -0.1 + Math.sin(t * 0.8) * 0.03, headY: 0.18, lLegX: -0.35, rLegX: -0.25, lKnee: 0.6, rKnee: 0.5 }),
  sleep: (t) => ({ lean: 0.08, bodyY: 0, chestX: 0.04 + Math.sin(t * 0.9) * 0.05, lArmX: -0.35, lElb: -0.4, rArmX: -1.1, rElb: -1.5, lLegX: -0.45, lKnee: 0.7, rLegX: -0.15, rKnee: 0.35, lFoot: 0, rFoot: 0, headX: 0.05 }),
  throwHold: () => ({ lArmX: -3.0, rArmX: -3.0, lElb: -1.0, rElb: -1.0, lean: -0.35, chestX: -0.3 }),
  throwRelease: () => ({ lArmX: -0.8, rArmX: -0.8, lElb: -0.1, rElb: -0.1, lean: 0.5, chestX: 0.3 }),
  roll: (t) => ({ lean: 0.6, bodyY: -0.15, lArmX: -1.5, rArmX: -1.5, lElb: -0.3, rElb: -0.3, lLegX: -0.7 + Math.sin(t * 2) * 0.1, lKnee: 0.9, rLegX: 0.4 }),
  // chest thrown out, head back, arms flung wide with the forearms raised
  roar: () => ({ chestX: -0.38, headX: -0.55, lArmX: -0.35, rArmX: -0.35, lArmZ: 0.95, rArmZ: -0.95, lElb: -1.3, rElb: -1.3, lean: -0.18, bodyY: -0.06, lLegX: -0.2, rLegX: 0.15, lKnee: 0.25, rKnee: 0.15 }),
};

export class Cyclops {
  constructor() {
    this.model = new Humanoid({ id: 'polyphemus', look: POLYPHEMUS.look, scale: CYCLOPS_SCALE });
    this.root = this.model.root;
    this.pos = new THREE.Vector3(); this.prev = new THREE.Vector3();
    this.yaw = 0; this.prevYaw = 0;
    this.speed = 0;
    this.radius = 2.2; this.height = 8.2;   // head clears the 10.6 m tunnel and the 13 m outer arch
    this.alive = true; this.noLock = true;
    this.activity = 'idle'; this.actT = 0;
    this.walkTarget = null; this.walkResolve = null; this.walkSpeed = 2.4;
    this.headTarget = null; this.headSmooth = new THREE.Vector3();
    this.lying = 0; this.lyingTarget = 0;
    this.blind = false;
    this.perception = false;
    this.suspicion = 0; this.lastKnown = null; this.lastHeardT = -10;
    this.time = 0;
    this.model.onStep = () => this._step();
    this.model.setExpression('anger', 0.55);   // a permanent scowl under the brow
    this.breathT = 0;
  }
  setZone(z) { this.zone = z; z.scene.add(this.root); }
  place(x, z, yaw = 0) { this.pos.set(x, this.zone ? this.zone.ground(x, z) : 0, z); this.prev.copy(this.pos); this.yaw = this.prevYaw = yaw; }
  get diff() { return DIFFICULTY[G.settings.difficulty] || DIFFICULTY.normal; }
  get masking() { return ['tend', 'milk', 'eat'].includes(this.activity) && !this.walkTarget; }

  setActivity(a) { if (this.activity !== a) { this.activity = a; this.actT = 0; } }
  walkTo(x, z, speed = 2.4) {
    this.walkTarget = new THREE.Vector3(x, 0, z); this.walkSpeed = speed;
    if (this.walkResolve) this.walkResolve();
    return new Promise((r) => { this.walkResolve = r; });
  }
  stopWalk() { this.walkTarget = null; const r = this.walkResolve; this.walkResolve = null; r?.(); }
  face(x, z) { this.faceYaw = Math.atan2(x - this.pos.x, z - this.pos.z); }

  headWorld(out = new THREE.Vector3()) { return this.model.head.getWorldPosition(out); }
  eyeWorld(out = new THREE.Vector3()) { return (this.model.eye || this.model.head).getWorldPosition(out); }
  handWorld(out = new THREE.Vector3()) { return this.model.rHand.getWorldPosition(out); }

  blindIt() {
    this.blind = true;
    this.model.setBlind();
  }

  // Perception against the player: light level, distance, view cone, occluders. Returns sight 0..1.
  sightOf(player, vis) {
    if (this.blind || this.lying > 0.5) return 0;
    const eye = this.eyeWorld(_e);
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 34) return 0;
    const lookYaw = this.yaw + this.model.anim.lookYaw * 1.0;
    const ang = Math.abs(wrapAngle(Math.atan2(dx, dz) - lookYaw));
    if (ang > 1.15 && dist > 4) return 0;
    if (this.zone.blocksSight && this.zone.blocksSight(eye, player.pos)) return 0;
    const near = 1 - smoothstep(4, 34, dist);
    const crouch = player.crouch ? 0.5 : 1;
    const moving = Math.hypot(player.vel.x, player.vel.z) > 0.5 ? 1.25 : 0.8;
    const cone = 1 - smoothstep(0.7, 1.15, ang);
    return clamp(vis * crouch * moving * (0.25 + 0.75 * near) * (0.35 + 0.65 * cone), 0, 1.5);
  }

  hear(pos, radius) {
    if (this.lying > 0.5 && !this.blind) return false;
    const d = Math.hypot(pos.x - this.pos.x, pos.z - this.pos.z);
    const r = radius * (this.masking ? 0.3 : 1) * (this.blind ? 1.5 : 1);
    if (d > r) return false;
    this.lastKnown = pos.clone();
    this.lastHeardT = this.time;
    this.headTarget = pos.clone();
    if (this.perception) this.suspicion = Math.min(1, this.suspicion + 0.22 * (1 - d / r) * this.diff.suspicion);
    return true;
  }

  fixedUpdate(dt, ctx) {
    this.prev.copy(this.pos); this.prevYaw = this.yaw;
    this.time += dt; this.actT += dt;
    if (this.perception && ctx.player) {
      const s = this.sightOf(ctx.player, ctx.vis ?? 1);
      if (s > 0.02) { this.suspicion = Math.min(1.2, this.suspicion + s * 0.9 * this.diff.suspicion * dt); this.lastKnown = ctx.player.pos.clone(); this.headTarget = ctx.player.pos.clone(); }
      else this.suspicion = Math.max(0, this.suspicion - 0.1 * dt);
    }
    // Locomotion
    let spd = 0;
    if (this.walkTarget) {
      const dx = this.walkTarget.x - this.pos.x, dz = this.walkTarget.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.8) this.stopWalk();
      else {
        const want = Math.atan2(dx, dz);
        this.yaw = dampAngle(this.yaw, want, 2.2, dt);
        const align = Math.max(0, Math.cos(wrapAngle(want - this.yaw)));
        spd = this.walkSpeed * align * Math.min(1, d / 2);
        this.pos.x += Math.sin(this.yaw) * spd * dt; this.pos.z += Math.cos(this.yaw) * spd * dt;
        if (this.zone.collideGiant) this.zone.collideGiant(this.pos, this.radius);
      }
    } else if (this.faceYaw !== undefined && this.faceYaw !== null) this.yaw = dampAngle(this.yaw, this.faceYaw, 1.8, dt);
    this.speed = damp(this.speed, spd, 4, dt);
    if (this.zone) this.pos.y = damp(this.pos.y, this.zone.ground(this.pos.x, this.pos.z), 10, dt);
    this.lying = damp(this.lying, this.lyingTarget, 1.2, dt);
    this.model.lidClose = this.blind ? 0.8 : this.lying > 0.5 ? 1 : null;
    // Pupil: wide in the dark, pinpoint in firelight or when he senses prey.
    if (this.model.pupil && this.zone?.light) {
      const lit = this.zone.light(this.pos.x, this.pos.z);
      const want = this.suspicion > 0.4 ? 0.55 : 1.4 - lit * 0.7;
      const s = damp(this.model.pupil.scale.x, want, 4, dt); this.model.pupil.scale.setScalar(s);
    }
  }

  _step() {
    if (!this.zone || this.lying > 0.3) return;
    const p = this.pos;
    const cam = G.camera.position;
    const d = Math.hypot(cam.x - p.x, cam.z - p.z);
    G.audio.play('giantStep', { pos: p, ref: 10, vol: 1.2, reverb: 0.6 });
    G.rig.addTrauma(clamp(0.5 - d / 50, 0.05, 0.45));
    G.input.rumble(0.6 * clamp(1 - d / 40), 0.2, 160);
    const foot = (this.model.anim.phase / Math.PI) & 1 ? this.model.lFt : this.model.rFt;
    const fp = foot.getWorldPosition(_f);
    fp.y = this.zone.ground(fp.x, fp.z) + 0.2;
    this.zone.fx.emit('dust', fp, 10, { scale: 2.2, speed: [2, 6] });
  }

  render(alpha, dt) {
    this.root.position.lerpVectors(this.prev, this.pos, alpha);
    this.root.rotation.y = this.prevYaw + wrapAngle(this.yaw - this.prevYaw) * alpha;
    // Lying down to sleep: tip the whole body onto its side.
    this.root.rotation.z = -this.lying * Math.PI / 2 * 0.98;
    this.root.position.y += this.lying * 1.3;
    const act = this.activity;
    // jaw wide and brow crushed down while he roars or flails, his permanent scowl otherwise
    this.roarT = Math.max(0, (this.roarT || 0) - dt);
    const roaring = this.roarT > 0 || act === 'roar' || act === 'flail';
    if (roaring !== this._roaring) { this._roaring = roaring; this.model.setExpression(roaring ? 'roar' : 'anger', roaring ? 1 : 0.55); }
    const poseFn = POSES[act];
    const custom = poseFn ? poseFn(this.actT) : null;
    let look = null;
    if (this.headTarget) { look = this.headSmooth.lerp(this.headTarget, 1 - Math.exp(-3 * dt)); }
    if (act === 'listen') look = _l.set(this.pos.x + Math.sin(this.yaw + Math.sin(this.actT * 0.8) * 1.1) * 20, this.pos.y + 3, this.pos.z + Math.cos(this.yaw + Math.sin(this.actT * 0.8) * 1.1) * 20);
    this.model.lyingK = this.lying;
    this.model.update(dt, { speed: Math.min(1.7, this.speed * 0.75), groundSpeed: this.speed, custom, customRate: 3, lookAt: this.lying > 0.3 ? null : look, ground: null });
    // Breath: dust stirs from the nostrils
    this.breathT -= dt;
    if (this.breathT <= 0 && this.zone) {
      this.breathT = this.lying > 0.5 ? 3.6 : 2.4;
      const h = this.headWorld(_h);
      const f = _f.set(Math.sin(this.yaw), -0.4, Math.cos(this.yaw));
      if (this.lying > 0.5) { f.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); h.y -= 0.3; }
      this.zone.fx.emit('breath', h.addScaledVector(f, 0.8), this.lying > 0.5 ? 6 : 3, { dir: f, scale: 1.6 });
      if (this.lying > 0.5) G.audio.play('snore', { pos: this.headWorld(_h), ref: 6, vol: 1.2 });
      else G.audio.giantBreath(this.headWorld(_h), false);
    }
  }
}
const _e = new THREE.Vector3(), _f = new THREE.Vector3(), _h = new THREE.Vector3(), _l = new THREE.Vector3();
export { POSES as CYCLOPS_POSES };
