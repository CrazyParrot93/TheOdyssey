import * as THREE from 'three';
import { G } from '../core/context.js';
import { SeaWorld, ISLANDS } from './SeaWorld.js';
import { Ship } from '../game/Ship.js';
import { Mat, frescoTexture, rockGeo, setShadows, Fire } from '../assets/Assets.js';
import { CREW } from '../data/crew.js';
import { clamp, pick } from '../core/math.js';

// The sailing overworld: steer the ship, manage supplies and crew, find the shrine and the wreck,
// make landfall where smoke rises from the mountain.
export class SailingScene {
  constructor({ intro = false, afterChapter = false } = {}) {
    this.intro = intro; this.after = afterChapter;
    const angry = (G.state.wrath || 0) >= 5;
    this.world = new SeaWorld(angry ? 'storm' : G.state.chapter > 3 ? 'daylight' : 'sunset');
    this.threeScene = this.world.scene;
    for (const k of ['cyclops', 'goat', 'lotus', 'aeolus']) this.world.addIsland(k);
    if (angry) { this.world.ocean.setStorm(0.85); this.world.rain.target = 0.8; }
    this.ship = new Ship({ rowers: 18 });
    this.ship.addTo(this.threeScene);
    const start = G.state.chapter > 3 ? { x: 120, z: -820, yaw: 2.4 } : { x: -420, z: 260, yaw: Math.PI * 0.86 };
    this.ship.pos.set(start.x, 0, start.z); this.ship.yaw = start.yaw; this.ship.targetSpeed = 6;
    this.windDir = Math.PI * 0.9;
    this.supplyT = 0; this.barkT = 12; this.helpT = 0;
    this.pois = [];
    this._buildPOIs();
    this.landfall = false;
    this.pausable = true;
  }

  _buildPOIs() {
    // Shrine of Athena: marble columns on a sea stack
    const shrine = new THREE.Group();
    const stack = new THREE.Mesh(rockGeo(7, 3), Mat.stone); stack.scale.set(14, 16, 14); stack.position.y = -2; shrine.add(stack);
    const marble = new THREE.MeshStandardMaterial({ color: 0xf2ece0, roughness: 0.35 });
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const c = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 7, 12), marble); c.position.set(Math.cos(a) * 4, 13.5, Math.sin(a) * 4); shrine.add(c); }
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 0.8, 24), marble); roof.position.y = 17.3; shrine.add(roof);
    const flame = new Fire({ scale: 0.8, intensity: 40, color: 0xffe0a0 }); flame.group.position.y = 10.4; shrine.add(flame.group);
    shrine.position.set(-260, 0, -380);
    setShadows(shrine);
    this.threeScene.add(shrine);
    this.pois.push({ id: 'shrine', name: 'Shrine of Athena', pos: shrine.position, radius: 70, fire: flame, done: G.state.found.includes('shrine'),
      label: 'Pour an offering to Athena', act: () => { G.state.addFavor(1, 'Shrine of Athena'); G.state.found.push('shrine'); G.state.lore.includes('athena') || G.state.lore.push('athena'); G.music.stinger('discover'); this.world.fx.emit('magic', new THREE.Vector3(-260, 12, -380), 80, { spread: 6 }); G.ui.subtitle(null, 'Grey-eyed Athena, guide us. Not by strength, but by wit.', 4); } });
    // Wreck: broken hull and floating debris
    const wreck = new THREE.Group();
    for (let i = 0; i < 9; i++) { const plank = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 2 + Math.random() * 3), Mat.darkWood); plank.position.set((Math.random() - 0.5) * 14, 0.1, (Math.random() - 0.5) * 14); plank.rotation.y = Math.random() * 6; wreck.add(plank); }
    const ribs = new THREE.Mesh(new THREE.TorusGeometry(3, 0.2, 6, 12, Math.PI), Mat.darkWood); ribs.rotation.set(0, 0.4, Math.PI); ribs.position.y = 0.6; wreck.add(ribs);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 9, 6), Mat.darkWood); mast.rotation.z = 1.2; mast.position.set(2, 0.5, 1); wreck.add(mast);
    wreck.position.set(260, 0, -360);
    this.threeScene.add(wreck);
    this.wreck = wreck;
    this.pois.push({ id: 'wreck', name: 'A wreck', pos: wreck.position, radius: 45, done: G.state.found.includes('wreck'),
      label: 'Salvage the wreck', act: () => { G.state.found.push('wreck'); G.state.arrows = Math.min(G.state.maxArrows + 6, G.state.arrows + 8); G.state.supplies += 12; G.ui.toast('Salvaged: 8 arrows, 12 supplies', 'discover'); G.state.lore.includes('fresco_ship') || G.state.lore.push('fresco_ship'); G.music.stinger('discover'); } });
  }

  enter() {
    G.post.setGrade(G.state.wrath >= 5 ? 'storm' : 'sea', 0.1);
    G.post.base.god = 0.22; G.post.base.bloom = 0.42; G.post.base.edgeBlur = 0; G.post.base.vignetteAdd = 0; G.post.base.satMul = 1;
    G.audio.setAmbience({ waves: 1, surf: 1, wind: 0.7, gulls: G.state.wrath >= 5 ? 0 : 0.7, rain: this.world.rain.target, storm: G.state.wrath >= 5 ? 0.8 : 0 });
    G.audio.setReverb(0.2);
    G.music.setKey(50, 'dorian');
    G.music.setMood(G.state.wrath >= 5 ? 'tension' : 'sea', 3);
    G.ui.showHUD(true); G.ui.refreshMeters(); G.ui.flashMeters(6);
    G.rig.follow(this.ship.pos, { snap: true, yaw: this.ship.yaw });
    G.rig.dist = 34; G.rig.height = 7; G.rig.shoulder = 0; G.rig.fov = 55; G.rig.collide = null; G.rig.big = null; G.rig.lockTarget = null; G.rig.aim = false; G.rig.minPitch = 0.02; G.rig.maxPitch = 0.9; G.rig.pitch = 0.22; G.rig.avoidSun = true;
    this.ship.setCrewCount(Math.min(18, Math.max(4, G.state.alive().length - 6)));
    if (this.intro) this._introScript();
    else if (G.state.chapter > 3) {
      G.ui.setObjective('Sail on toward the Isle of Winds');
      setTimeout(() => G.ui.subtitle(null, G.state.wrath >= 5 ? 'The sea has learned your name. It will not forget it.' : 'Behind you, the giant\'s island sinks into the haze.', 5), 1500);
    } else G.ui.setObjective('Sail toward the smoke on the horizon');
    G.input.lockPointer();
  }

  async _introScript() {
    await G.ui.chapterCard(0, 'Ten years of war. Troy is ash.', 'Now the sea stands between Odysseus and home.', 4);
    G.ui.setObjective('Sail toward the smoke on the horizon');
    G.ui.subtitle('Kleitos', 'Smoke on that mountain, my king. Where there\'s smoke, there\'s a hearth.', 5);
    setTimeout(() => G.ui.toast(`${G.input.label('forward')} / ${G.input.label('back')}  sail · ${G.input.label('left')} / ${G.input.label('right')}  steer · mouse looks`, ''), 2500);
  }

  exit() { this.world.dispose(); }

  fixedUpdate(dt) {
    const input = G.input;
    const control = !G.ui.menuOpen && !G.ui.inDialogue && !this.landfall && !G.debug.fly;
    const m = control ? input.move() : { x: 0, y: 0 };
    this.ship.steer(dt, m.y, -m.x, this.windDir);
    // keep within the known sea
    const r = Math.hypot(this.ship.pos.x, this.ship.pos.z + 600);
    if (r > 2600) { this.ship.yaw += dt * 0.6; }
    // island collision: push away from land
    for (const isl of this.world.islands) {
      const h = isl.height(this.ship.pos.x + Math.sin(this.ship.yaw) * 12, this.ship.pos.z + Math.cos(this.ship.yaw) * 12);
      if (h > -1.5) { if ((this._scrapeT = (this._scrapeT || 0) - dt) <= 0 && this.ship.speed > 1) { this._scrapeT = 0.8; G.audio.play('creak', { vol: 1.2 }); G.audio.play('scrape', { vol: 0.6 }); G.rig.addTrauma(0.15); G.input.rumble(0.4, 0.6, 200); } this.ship.speed *= 0.9; this.ship.targetSpeed = Math.min(this.ship.targetSpeed, 2); const dx = this.ship.pos.x - isl.def.x, dz = this.ship.pos.z - isl.def.z, d = Math.hypot(dx, dz); this.ship.pos.x += (dx / d) * dt * 3; this.ship.pos.z += (dz / d) * dt * 3; }
    }
    this.supplyT += dt;
    if (this.supplyT > 25) { this.supplyT = 0; G.state.supplies = Math.max(0, G.state.supplies - 1); }
    this.windDir += Math.sin(G.engine.gameTime * 0.05) * dt * 0.02;
  }

  update(dt, realDt) {
    this.ship.update(dt, this.world.ocean);
    this.ship.spray(this.world.fx, dt);
    G.rig.update(realDt, G.ui.menuOpen ? null : G.input.consumeLook());
    this.world.update(dt, G.camera, this.ship.pos, this.ship);
    for (const p of this.pois) p.fire?.update(G.engine.gameTime, dt, this.world.fx, G.camera);
    // Compass: islands and discoveries
    const items = [];
    for (const isl of this.world.islands) {
      const a = Math.atan2(isl.def.x - this.ship.pos.x, isl.def.z - this.ship.pos.z);
      const target = (isl.key === 'cyclops' && G.state.chapter <= 3) || (isl.key === 'aeolus' && G.state.chapter > 3);
      items.push({ label: isl.def.name, angle: a, dist: Math.hypot(isl.def.x - this.ship.pos.x, isl.def.z - this.ship.pos.z), cls: target ? 'goal' : isl.def.locked ? 'lock' : '' });
    }
    for (const p of this.pois) if (!p.done && p.pos.distanceTo(this.ship.pos) < 700) items.push({ label: p.name, angle: Math.atan2(p.pos.x - this.ship.pos.x, p.pos.z - this.ship.pos.z), dist: p.pos.distanceTo(this.ship.pos), cls: '' });
    G.ui.setCompass(items, this.ship.yaw);
    G.ui.setVitals({ hp: 100, maxHp: 100, stamina: 100, weapon: 'sword', inCombat: false });

    // Proximity interactions
    let prompt = null, act = null;
    for (const p of this.pois) {
      if (p.done) continue;
      if (Math.hypot(p.pos.x - this.ship.pos.x, p.pos.z - this.ship.pos.z) < p.radius) { prompt = p.label; act = () => { p.done = true; p.act(); }; }
    }
    const cy = ISLANDS.cyclops, dC = Math.hypot(cy.x - this.ship.pos.x, cy.z - this.ship.pos.z);
    if (G.state.chapter <= 3 && dC < 330) { prompt = 'Make landfall on the island'; act = () => this._landfall(); }
    const ae = ISLANDS.aeolus, dA = Math.hypot(ae.x - this.ship.pos.x, ae.z - this.ship.pos.z);
    if (G.state.chapter > 3 && dA < 600) { prompt = 'Approach the Isle of Winds'; act = () => this._endOfSlice(); }
    G.ui.prompt(this.landfall ? null : prompt, 'interact');
    if (act && G.input.pressed('interact') && !this.landfall) act();

    // Crew barks while sailing
    this.barkT -= dt;
    if (this.barkT <= 0) {
      this.barkT = 22 + Math.random() * 25;
      const alive = G.state.alive();
      if (alive.length) {
        const pid = pick(alive).id; const c = CREW.find((x) => x.id === pid);
        const lost = G.state.crew.filter((x) => !x.alive);
        const line = lost.length && Math.random() < 0.4 ? `I keep looking for ${(() => { const lid = pick(lost).id; return CREW.find((x) => x.id === lid).name; })()} at the oars.` : c.line;
        G.ui.subtitle(c.name, line, 5);
      }
    }
  }

  async _landfall() {
    this.landfall = true;
    G.ui.prompt(null);
    G.audio.play('uiConfirm');
    G.flow.startChapter('landing');
  }

  async _endOfSlice() {
    this.landfall = true;
    G.ui.prompt(null);
    await G.ui.chapterCard(4, 'The Isle of Winds', 'Chapter IV is still being built. Your voyage pauses here.', 5);
    G.ui.toast('Thank you for playing the vertical slice of NOSTOS.', 'discover');
    this.landfall = false;
  }
}
