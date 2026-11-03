import * as THREE from 'three';
import { G } from '../core/context.js';
import { Save } from '../core/Save.js';
import { SeaWorld } from './SeaWorld.js';
import { Ship } from '../game/Ship.js';

// Live title: the ship under sunset sail, slow cinematic camera cuts, the logo and the menu.
export class TitleScene {
  constructor() {
    this.world = new SeaWorld('sunset');
    this.threeScene = this.world.scene;
    this.world.addIsland('cyclops');
    this.ship = new Ship({ rowers: 18 });
    this.ship.addTo(this.threeScene);
    this.ship.speed = 5.5; this.ship.yaw = 0.6;
    this.ship.api.sailFurl = 0;
    this.shot = 0; this.shotT = 0;
    this.ready = false;
  }

  enter() {
    G.post.setGrade('title', 0.1);
    G.post.base.god = 0.65; G.post.base.bloom = 0.6; G.post.base.edgeBlur = 0; G.post.base.vignetteAdd = 0;
    G.audio.setAmbience({ waves: 1, surf: 0.8, wind: 0.5, gulls: 1 });
    G.audio.setReverb(0.25);
    G.music.setKey(50, 'dorian');
    G.music.setMood('title', 2);
    G.ui.showHUD(false);
    G.rig.fov = 50; G.rig.avoidSun = false;
    this._cut();
    if (G.started) this.showMenu();
  }

  showMenu() {
    if (this.menu) return;
    G.ui.closeAll();
    this.menu = G.ui.openTitle({
      hasSave: !!Save.loadGame(),
      onNew: () => G.flow.newGame(),
      onContinue: () => G.flow.continueGame(),
    });
  }

  exit() { G.ui.closeAll(); this.world.dispose(); }

  _cut() {
    const s = this.ship, cam = G.rig;
    const p = s.pos;
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    const shots = [
      () => cam.setStatic(new THREE.Vector3(p.x + fz * 40 - fx * 25, 6, p.z - fx * 40 - fz * 25), new THREE.Vector3(p.x, 6, p.z), 0),
      () => cam.setStatic(new THREE.Vector3(p.x - fx * 30 + fz * 6, 2.2, p.z - fz * 30 - fx * 6), new THREE.Vector3(p.x + fx * 20, 5, p.z + fz * 20), 0),
      () => cam.setStatic(new THREE.Vector3(p.x + fx * 60 + fz * 12, 18, p.z + fz * 60 - fx * 12), new THREE.Vector3(p.x, 4, p.z), 0),
    ];
    shots[this.shot % shots.length]();
    this.shotT = 0;
  }

  fixedUpdate(dt) {
    const s = this.ship;
    s.yaw += dt * 0.012;
    s.pos.x += Math.sin(s.yaw) * s.speed * dt;
    s.pos.z += Math.cos(s.yaw) * s.speed * dt;
  }

  update(dt, realDt) {
    this.shotT += dt;
    // Slow drift on static shots so every frame breathes
    const r = G.rig;
    if (r.mode === 'static') {
      const fx = Math.sin(this.ship.yaw), fz = Math.cos(this.ship.yaw);
      r.staticPos.addScaledVector(new THREE.Vector3(fx, 0.02, fz), dt * this.ship.speed * 0.85);
      r.staticLook.lerp(new THREE.Vector3(this.ship.pos.x, 5, this.ship.pos.z), 0.02);
      r.cam.position.copy(r.staticPos);
    }
    if (this.shotT > 14) { this.shot++; this._cut(); }
    this.ship.update(dt, this.world.ocean);
    this.ship.spray(this.world.fx, dt);
    r.update(realDt, null);
    this.world.update(dt, G.camera, this.ship.pos, this.ship);
  }
}
