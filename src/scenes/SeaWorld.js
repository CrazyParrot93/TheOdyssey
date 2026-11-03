import * as THREE from 'three';
import { G } from '../core/context.js';
import { Atmosphere, bakeSkyEnv } from '../render/Sky.js';
import { Ocean } from '../render/Ocean.js';
import { Particles, Rain } from '../render/Particles.js';
import { buildIsland } from '../game/Terrain.js';
import { wetness } from './CaveZones.js';
import { Mat, rockGeo, instanced, cypressGeo, oliveTreeGeos, shaderTime } from '../assets/Assets.js';
import { fbm2, smoothstep, clamp } from '../core/math.js';

// Open-sea world: sky, ocean, distant islands, weather. Shared by the title screen and the sailing map.
export const ISLANDS = {
  cyclops: { name: "Cyclops' Isle", x: 0, z: -1150, size: 420, peak: 95, seed: 3, smoke: true, colors: { grass: '#6e7440', dry: '#9a8a52' } },
  goat:    { name: 'Goat Island', x: 420, z: -820, size: 200, peak: 28, seed: 9, colors: { grass: '#7d8448' } },
  lotus:   { name: 'Isle of the Lotus', x: -950, z: 650, size: 300, peak: 20, seed: 5, colors: { grass: '#a8b878', dry: '#e0c8b0', sand: '#f0d8c8' } },
  aeolus:  { name: 'Isle of Winds', x: 1500, z: -2600, size: 380, peak: 120, seed: 12, colors: { rock: '#8a6a40', dark: '#6a4a28' }, locked: true },
};

export function islandHeight(def) {
  const R = def.size * 0.36;
  return (x, z) => {
    const r = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    const edge = R * (0.85 + 0.25 * fbm2(Math.cos(a) * 1.5 + def.seed, Math.sin(a) * 1.5, 3));
    let h = -7 + smoothstep(edge + 16, edge - 10, r) * 8.5;
    const inland = smoothstep(edge - 6, edge - 34, r);
    h += inland * (2.5 + 3.5 * fbm2(x * 0.03 + def.seed, z * 0.03, 3));
    h += def.peak * Math.exp(-(r * r) / (2 * Math.pow(R * 0.38, 2))) * (0.75 + 0.5 * fbm2(x * 0.02 + def.seed, z * 0.02, 3));
    h += (fbm2(x * 0.08, z * 0.08 + def.seed, 3) - 0.5) * 1.5 * inland;
    if (r > edge + 16) h = Math.min(h, -7 - (r - edge - 16) * 0.2);
    return Math.max(h, -20);
  };
}

export class SeaWorld {
  constructor(preset = 'sunset') {
    this.scene = new THREE.Scene();
    this.atm = new Atmosphere(this.scene, preset);
    this.ocean = new Ocean(this.atm);
    this.fx = new Particles(2000);
    this.scene.add(this.fx.group);
    this.rain = new Rain(); this.scene.add(this.rain.mesh);
    this.islands = [];
    this.envT = 0;
    this.rebakeEnv();
    this.thunderT = 6;
  }
  rebakeEnv() {
    if (this.scene.environment) this.scene.environment.dispose();
    this.scene.environment = bakeSkyEnv(G.renderer, this.atm);
  }

  addIsland(key) {
    const def = ISLANDS[key];
    const isl = buildIsland({ size: def.size, res: 96, height: islandHeight(def), colors: def.colors });
    isl.mesh.position.set(def.x, 0, def.z);
    isl.mesh.castShadow = false;
    this.scene.add(isl.mesh);
    const hf = islandHeight(def);
    // Trees and rocks
    const items = [], rocks = [];
    for (let i = 0; i < 120; i++) {
      const x = (Math.random() - 0.5) * def.size * 0.6, z = (Math.random() - 0.5) * def.size * 0.6, y = hf(x, z);
      if (y > 3 && y < def.peak * 0.6) items.push({ x: def.x + x, y: y - 0.3, z: def.z + z, s: 1.4 + Math.random() });
      else if (y > 0.5) rocks.push({ x: def.x + x, y, z: def.z + z, s: 2 + Math.random() * 4 });
    }
    if (items.length) this.scene.add(instanced(cypressGeo(), Mat.cypress, items, { cast: false }));
    if (rocks.length) this.scene.add(instanced(rockGeo(2, 2), Mat.stone, rocks, { cast: false }));
    const o = { key, def, mesh: isl.mesh, tex: isl.tex, height: (x, z) => hf(x - def.x, z - def.z) };
    if (def.locked) {
      // Bronze wall ringing the Isle of Winds
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(def.size * 0.3, def.size * 0.3, 26, 64, 1, true), Mat.bronze);
      wall.position.set(def.x, 22, def.z);
      this.scene.add(wall);
    }
    this.islands.push(o);
    return o;
  }

  nearestIsland(x, z) {
    let best = null, bd = Infinity;
    for (const i of this.islands) { const d = Math.hypot(i.def.x - x, i.def.z - z); if (d < bd) { bd = d; best = i; } }
    return best ? { island: best, dist: bd } : null;
  }

  update(dt, camera, focus, ship) {
    shaderTime.value += dt;
    const t = G.engine.gameTime;
    this.atm.update(dt, focus, camera);
    this.ocean.update(t, dt, camera, ship ? { x: ship.pos.x, z: ship.pos.z, yaw: ship.yaw, speed: ship.speed, waterY: ship.buoy.water ?? 0 } : null);
    if (this._islCount !== this.islands.length) {
      this._islCount = this.islands.length;
      this.ocean.setIslands(this.islands.slice(0, 4).map((i) => ({ tex: i.tex, minX: i.def.x - i.def.size / 2, minZ: i.def.z - i.def.size / 2, size: i.def.size, height: i.height })));
    }
    for (const i of this.islands) {
      if (i.def.smoke && Math.random() < dt * 14) {
        const p = new THREE.Vector3(i.def.x + 8, i.height(i.def.x + 8, i.def.z - 6) + 2, i.def.z - 6);
        this.fx.emit('smoke', p, 1, { scale: 14, life: [10, 16], up: [5, 9], alpha: 0.32, color: [0.46, 0.42, 0.4], spread: 6 });
      }
    }
    this.fx.update(dt, camera);
    this.rain.update(dt, camera);
    wetness(this.rain.intensity);
    // Storm: lightning + thunder when the sea is angry
    if (this.ocean.storm > 0.5) {
      this.thunderT -= dt;
      if (this.thunderT <= 0) {
        this.thunderT = 5 + Math.random() * 9;
        this.atm.flash(1);
        setTimeout(() => G.audio.play('thunder', { vol: 1 }), 300 + Math.random() * 900);
      }
    }
  }

  dispose() {
    // Geometries/materials are shared through the asset cache; only per-scene GPU targets are freed.
    this.scene.environment?.dispose();
    this.ocean.dispose();
    this.atm.dispose();
  }
}
