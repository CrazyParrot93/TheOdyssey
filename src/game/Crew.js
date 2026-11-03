import * as THREE from 'three';
import { G } from '../core/context.js';
import { Humanoid } from '../assets/Character.js';
import { damp, dampAngle, wrapAngle, clamp } from '../core/math.js';

// A named companion: follows in formation (A* when blocked), runs scripted moves, hides, reacts.
export class CrewMember {
  constructor(data, index) {
    this.data = data; this.id = data.id; this.index = index;
    this.model = new Humanoid({ id: data.id, look: data.look, spear: index % 3 === 0 });
    this.root = this.model.root;
    this.pos = new THREE.Vector3(); this.prev = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.prevYaw = 0;
    this.state = 'follow';
    this.target = new THREE.Vector3();
    this.path = null; this.pathT = 0;
    this.crouch = false;
    this.lookAt = null;
    this.custom = null;
    this.speed = 0;
    this.arrive = null;
    this.zone = null;
    this.visible = true;
    this.model.onStep = () => { if (this.zone && this.speed > 5 && Math.random() < 0.25 && this.zone.surface?.(this.pos.x, this.pos.z) === 'sand') this.zone.fx.emit('dust', this.pos, 1, { scale: 0.35, alpha: 0.18 }); };
  }
  setZone(z) { this.zone = z; z.scene.add(this.root); }
  place(x, z, yaw = 0) { this.pos.set(x, this.zone ? this.zone.ground(x, z) : 0, z); this.prev.copy(this.pos); this.yaw = this.prevYaw = yaw; this.path = null; }

  goTo(x, z, { run = false, crouch = false, face = null } = {}) {
    this.state = 'goto';
    this.target.set(x, 0, z);
    this.run = run; this.crouch = crouch; this.faceYaw = face;
    this.path = null; this.pathT = 0;
    return new Promise((r) => { this.arrive = r; });
  }
  follow() { this.state = 'follow'; this.crouch = false; this.path = null; }
  idle(face = null) { this.state = 'idle'; this.faceYaw = face; }

  fixedUpdate(dt, ctx) {
    this.prev.copy(this.pos); this.prevYaw = this.yaw;
    if (!this.visible) return;
    const { player, nav, crew } = ctx;
    let tx = null, tz = null, run = false;
    if (this.state === 'follow' && player) {
      // V formation behind the player
      const row = Math.floor(this.index / 2) + 1, side = this.index % 2 ? 1 : -1;
      const back = 1.2 + row * 1.5, lat = side * (2.4 + row * 0.9);
      const fy = player.yaw;
      tx = player.pos.x - Math.sin(fy) * back - Math.cos(fy) * lat;
      tz = player.pos.z - Math.cos(fy) * back + Math.sin(fy) * lat;
      const d = Math.hypot(tx - this.pos.x, tz - this.pos.z);
      run = d > 5;
      if (d < 1.2) { tx = null; }
    } else if (this.state === 'goto') {
      tx = this.target.x; tz = this.target.z; run = this.run;
      if (Math.hypot(tx - this.pos.x, tz - this.pos.z) < 0.5) {
        this.state = 'idle'; tx = null;
        const r = this.arrive; this.arrive = null; r?.();
      }
    }

    let wantX = 0, wantZ = 0, spd = 0;
    if (tx !== null) {
      let gx = tx, gz = tz;
      if (nav) {
        this.pathT -= dt;
        if ((!this.path || this.pathT <= 0) && !nav.lineClear(this.pos.x, this.pos.z, tx, tz)) {
          this.path = nav.findPath(this.pos.x, this.pos.z, tx, tz); this.pathT = 0.8;
        } else if (this.pathT <= 0) { this.path = null; this.pathT = 0.8; }
        if (this.path && this.path.length > 1) {
          let wp = this.path[1];
          if (Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z) < 0.7 && this.path.length > 2) { this.path.shift(); wp = this.path[1]; }
          gx = wp.x; gz = wp.z;
        }
      }
      const dx = gx - this.pos.x, dz = gz - this.pos.z, d = Math.hypot(dx, dz) || 1;
      spd = this.crouch ? 2.0 : run ? 6.2 : Math.min(4.2, 1.5 + d);
      wantX = (dx / d) * spd; wantZ = (dz / d) * spd;
    }
    // Separation
    if (crew) for (const o of crew) {
      if (o === this || !o.visible) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < 1.2 && d2 > 1e-4) { const d = Math.sqrt(d2); wantX += (dx / d) * (1.1 - d) * 4; wantZ += (dz / d) * (1.1 - d) * 4; }
    }
    if (player) {
      const dx = this.pos.x - player.pos.x, dz = this.pos.z - player.pos.z, d2 = dx * dx + dz * dz;
      if (d2 < 1.0 && d2 > 1e-4) { const d = Math.sqrt(d2); wantX += (dx / d) * (1 - d) * 6; wantZ += (dz / d) * (1 - d) * 6; }
    }
    this.vel.x = damp(this.vel.x, wantX, 8, dt); this.vel.z = damp(this.vel.z, wantZ, 8, dt);
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    if (this.zone) { this.zone.collide(this.pos, 0.38, this.prev); this.pos.y = damp(this.pos.y, this.zone.ground(this.pos.x, this.pos.z), 20, dt); }
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.speed > 0.4) this.yaw = dampAngle(this.yaw, Math.atan2(this.vel.x, this.vel.z), 9, dt);
    else if (this.faceYaw !== null && this.faceYaw !== undefined) this.yaw = dampAngle(this.yaw, this.faceYaw, 4, dt);
    else if (player && this.state !== 'hide') this.yaw = dampAngle(this.yaw, Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z), 2, dt);
  }

  render(alpha, dt) {
    this.root.visible = this.visible && this.root.position.distanceTo(G.camera.position) > 1.4;
    if (!this.visible) return;
    this.root.position.lerpVectors(this.prev, this.pos, alpha);
    this.root.rotation.y = this.prevYaw + wrapAngle(this.yaw - this.prevYaw) * alpha;
    this.model.update(dt, { speed: this.speed, groundSpeed: this.speed, crouch: this.crouch, lookAt: this.lookAt, custom: this.custom, ground: this.zone ? (x, z) => this.zone.ground(x, z) : null });
  }

  say(text, dur = 3.5) { this.model.talkFor(Math.min(dur * 0.75, text.length / 14)); G.ui.subtitle(this.data.name, text, dur); G.audio.play('blip', { pitch: this.data.voice, bus: 'voice' }); }
}
