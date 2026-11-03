import * as THREE from 'three';
import { G } from '../core/context.js';
import { buildShip } from '../assets/Assets.js';
import { Buoyancy } from '../render/Ocean.js';
import { Humanoid } from '../assets/Character.js';
import { ODYSSEUS, CREW } from '../data/crew.js';
import { damp, dampAngle, clamp } from '../core/math.js';

// The black ship: lofted hull, billowing sail, rowing oars, instanced rowers, buoyancy on the shared waves.
export class Ship {
  constructor({ rowers = 18, hero = true } = {}) {
    this.api = buildShip();
    this.group = this.api.group;
    this.pos = new THREE.Vector3();
    this.yaw = 0; this.speed = 0; this.targetSpeed = 0; this.turn = 0;
    this.buoy = new Buoyancy(22, 4);
    this.time = 0;
    this.wind = 1;
    this.rowing = 0.6;
    // Rowers: the crew themselves, seated on the benches facing aft, pulling in time.
    this.rowerCount = Math.min(rowers, 12);
    this.rowerModels = [];
    for (let i = 0; i < this.rowerCount; i++) {
      const c = CREW[(i * 5) % CREW.length];
      const m = new Humanoid({ id: 'rower' + i, look: c.look });
      const row = Math.floor(i / 2), side = i % 2 ? 1 : -1;
      m.root.position.set(side * 0.78, 0.48, -6.2 + row * 1.75);
      m.root.rotation.y = Math.PI;
      m.phase = row * 0.08;
      this.group.add(m.root);
      this.rowerModels.push(m);
    }
    this.shown = this.rowerCount;
    if (hero) {
      this.hero = new Humanoid({ look: ODYSSEUS.look, sword: true, shield: true, cloak: true });
      this.hero.root.position.set(0.4, 1.0, -8.2);
      this.group.add(this.hero.root);
    }
  }
  setCrewCount(n) { this.shown = Math.min(this.rowerCount, n); this.rowerModels.forEach((m, i) => { m.root.visible = i < this.shown; }); }
  addTo(scene) { scene.add(this.group); }

  // Controlled sailing physics
  steer(dt, throttle, rudder, windDir) {
    this.targetSpeed = clamp(this.targetSpeed + throttle * dt * 4, 0, 14);
    const align = Math.cos(this.yaw - windDir);
    const eff = 0.55 + 0.45 * align;
    this.wind = clamp(0.35 + 0.65 * Math.max(0, align), 0.2, 1);
    const top = this.targetSpeed * eff;
    this.speed = damp(this.speed, top, 0.6, dt);
    this.turn = damp(this.turn, rudder, 2.5, dt);
    this.yaw += this.turn * dt * (0.12 + Math.min(this.speed, 10) * 0.03);
    this.pos.x += Math.sin(this.yaw) * this.speed * dt;
    this.pos.z += Math.cos(this.yaw) * this.speed * dt;
    this.rowing = this.targetSpeed > 0.5 ? clamp(0.4 + this.targetSpeed / 14, 0, 1) : 0;
  }

  update(dt, ocean) {
    this.time += dt;
    this.buoy.update(ocean, this.pos.x, this.pos.z, this.yaw, dt, 0.35);
    const g = this.group;
    g.position.set(this.pos.x, this.buoy.y, this.pos.z);
    g.rotation.set(this.buoy.pitch, this.yaw, this.buoy.roll - this.turn * 0.04 * Math.min(1, this.speed / 6));
    this.api.update(this.time, this.wind, this.rowing);
    // Stroke: reach forward with straight arms, then lean back and pull the handle to the chest.
    const ph = this.time * 2.4, k = this.rowing;
    for (let i = 0; i < this.shown; i++) {
      const m = this.rowerModels[i], c = Math.cos(ph - m.phase), side = i % 2 ? 1 : -1;
      const pull = 0.5 - 0.5 * c;
      m.update(dt, { speed: 0, customRate: 8, custom: {
        bodyY: -0.42, lLegX: -1.45, rLegX: -1.45, lKnee: 1.55, rKnee: 1.55, lFoot: 0.2, rFoot: 0.2,
        lean: (0.35 - pull * 0.65) * k + 0.05 * (1 - k), chestX: 0.05,
        lArmX: (-1.35 + pull * 0.55) * k - 0.4 * (1 - k), rArmX: (-1.35 + pull * 0.55) * k - 0.4 * (1 - k),
        lArmY: side * 0.25 * k, rArmY: side * 0.25 * k, lElb: -0.15 - pull * 1.3 * k, rElb: -0.15 - pull * 1.3 * k, headX: 0.1,
      } });
    }
    if (this.hero) this.hero.update(dt, { speed: 0, custom: this.heroPose || { lArmX: -0.3, rArmX: -0.2 } });
  }

  // Spray from the bow when cutting through swells
  spray(fx, dt) {
    if (this.speed < 3) return;
    if (Math.random() < dt * this.speed * 0.6) {
      const fx0 = Math.sin(this.yaw), fz0 = Math.cos(this.yaw);
      const side = Math.random() < 0.5 ? -1 : 1;
      const p = new THREE.Vector3(this.pos.x + fx0 * 11.5 + fz0 * side * 0.8, this.buoy.y + 0.3, this.pos.z + fz0 * 11.5 - fx0 * side * 0.8);
      fx.emit('spray', p, 3, { dir: new THREE.Vector3(fz0 * side, 0.4, -fx0 * side), scale: 1.3 });
    }
  }
}
