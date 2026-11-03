import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G } from '../core/context.js';
import { Atmosphere, bakeSkyEnv, bakeGradientEnv } from '../render/Sky.js';
import { Ocean } from '../render/Ocean.js';
import { Rain } from '../render/Particles.js';
import { buildIsland } from '../game/Terrain.js';
import { NavGrid } from '../game/NavGrid.js';
import { Ship } from '../game/Ship.js';
import { Quadruped } from '../assets/Character.js';
import { RIM, Mat, rockGeo, instanced, oliveTreeGeos, cypressGeo, grassBladeGeo, Fire, cheeseWheel, boulderMesh, buildStaff, frescoTexture, setShadows, cachedGeo, shaderTime } from '../assets/Assets.js';
import { fbm2, noise2, smoothstep, lerp, clamp, rng } from '../core/math.js';

// Rain darkens and glosses stone, earth and wood.
export function wetness(w) {
  Mat.terrain.roughness = 0.95 - 0.5 * w; Mat.stone.roughness = 1 - 0.55 * w; Mat.wood.roughness = 0.85 - 0.4 * w;
  Mat.hull.roughness = 0.7 - 0.35 * w; Mat.darkWood.roughness = 0.8 - 0.4 * w; Mat.sail.roughness = 0.95 - 0.25 * w;
  Mat.terrain.color.setScalar(1 - 0.25 * w);
}

// ---------- shared zone behaviour ----------
class Zone {
  constructor(ch) {
    this.ch = ch;
    this.scene = new THREE.Scene();
    this.obstacles = [];     // { x, z, r, sight, giant }
    this.enemies = [];
    this.interactables = [];
    this.fx = ch.fx;
    this.token = ch.token;
    this.inCombat = false;
  }
  noise(pos, radius, kind) { this.ch.onNoise(pos, radius, kind); }
  addObstacle(x, z, r, sight = false, extra = {}) { const o = { x, z, r, sight, ...extra }; this.obstacles.push(o); return o; }
  collideCircles(pos, r) {
    for (const o of this.obstacles) {
      if (o.off) continue;
      const dx = pos.x - o.x, dz = pos.z - o.z, d = Math.hypot(dx, dz), m = o.r + r;
      if (d < m && d > 1e-4) { pos.x = o.x + (dx / d) * m; pos.z = o.z + (dz / d) * m; }
    }
  }
  blocksSight(a, b) {
    for (const o of this.obstacles) {
      if (!o.sight || o.off) continue;
      const abx = b.x - a.x, abz = b.z - a.z, L2 = abx * abx + abz * abz;
      const t = clamp(((o.x - a.x) * abx + (o.z - a.z) * abz) / L2, 0, 1);
      const cx = a.x + abx * t - o.x, cz = a.z + abz * t - o.z;
      if (cx * cx + cz * cz < o.r * o.r * 0.8 && t > 0.05 && t < 0.97) return true;
    }
    return false;
  }
}

// =====================================================================
// EXTERIOR: the Cyclops' island, beach to cave mouth
// =====================================================================
export const PATH_X = (z) => 6 * Math.sin(z * 0.035) + (z > 60 ? (z - 60) * 0.1 : 0);
function baseHeight(x, z) {
  const r = Math.hypot(x, z), a = Math.atan2(z, x);
  const edge = 116 + 10 * (fbm2(Math.cos(a) * 1.3 + 7, Math.sin(a) * 1.3, 3) - 0.5) * 2;
  let h = smoothstep(edge + 10, edge - 22, r) * 6.5 - 4.5;
  const inland = smoothstep(edge - 4, edge - 40, r);
  const bumps = (fbm2(x * 0.025 + 3, z * 0.025, 4) - 0.3) * 5 * inland;
  const pd = Math.abs(x - PATH_X(z));
  h += bumps * (1 - smoothstep(6, 2, pd) * 0.75);
  if (h < 1.6) h += (1.6 - h) * inland; // inland never dips below the sea
  const md = Math.hypot(x / 1.15, z + 100);
  h += 78 * Math.exp(-(md * md) / (2 * 30 * 30));
  h += (fbm2(x * 0.09, z * 0.09, 3) - 0.5) * 1.2 * smoothstep(10, 30, h);
  if (r > edge + 6) h = Math.min(h, -4.5 - (r - edge - 6) * 0.55);
  return Math.max(h, -30);
}
const TERRACE = { x: 0, z: -47, y: baseHeight(0, -47) };
export const CAVE_MOUTH = new THREE.Vector3(0, TERRACE.y, -53.5);
// The terrace is flattened only in front of the mouth; behind it the mountain rises steeply over the tunnel.
export function exteriorHeight(x, z) {
  const td = Math.hypot(x - TERRACE.x, z - TERRACE.z);
  return lerp(baseHeight(x, z), TERRACE.y, smoothstep(14, 6, td) * smoothstep(CAVE_MOUTH.z - 1.5, CAVE_MOUTH.z + 0.5, z));
}
// Footprint of the tunnel that runs into the mountain: its floor is level with the terrace.
const inTunnel = (x, z) => Math.abs(x) < 10.5 && z < CAVE_MOUTH.z + 0.5 && z > CAVE_MOUTH.z - 30;
export const SHIP_SPOT = { x: 6, z: 125, yaw: Math.PI };

export class Exterior extends Zone {
  constructor(ch) {
    super(ch);
    const sc = this.scene;
    this.atm = new Atmosphere(sc, 'dusk');
    this.ocean = new Ocean(this.atm);
    this.rain = new Rain(); sc.add(this.rain.mesh);
    const isl = buildIsland({ size: 300, res: Math.round(150 + 90 * (G.quality.trees || 1)), height: exteriorHeight, colors: { grass: '#6c7340', dry: '#a08f58', rock: '#7a7064' } });
    // Open the hillside where it would ramp up through the tunnel mouth (a heightmap cannot overhang);
    // the portal's rock frame covers the cut edges and the tunnel roof sits under the slope behind it.
    {
      const g = isl.mesh.geometry, p = g.attributes.position, idx = g.index.array, keep = [], v = new THREE.Vector3();
      isl.mesh.updateMatrixWorld(true);
      for (let i = 0; i < idx.length; i += 3) {
        let cx = 0, cz = 0;
        for (let k = 0; k < 3; k++) { v.fromBufferAttribute(p, idx[i + k]).applyMatrix4(isl.mesh.matrixWorld); cx += v.x / 3; cz += v.z / 3; }
        if (Math.abs(cx - CAVE_MOUTH.x) < 11.6 && cz < CAVE_MOUTH.z + 0.6 && cz > CAVE_MOUTH.z - 6) continue;
        keep.push(idx[i], idx[i + 1], idx[i + 2]);
      }
      g.setIndex(keep);
    }
    sc.add(isl.mesh);
    this.ocean.setIsland(isl.tex, isl.minX, isl.minZ, isl.size, exteriorHeight);
    this._props();
    this.ship = new Ship({ rowers: 6, hero: false });
    this.ship.addTo(sc);
    this.ship.pos.set(SHIP_SPOT.x, 0, SHIP_SPOT.z); this.ship.yaw = SHIP_SPOT.yaw; this.ship.api.sailFurl = 0.9; this.ship.rowing = 0;
    this.nav = new NavGrid(-120, -70, 240, 1.5, (x, z) => this._blocked(x, z));
    this.env = bakeSkyEnv(G.renderer, this.atm);
    sc.environment = this.env;
  }

  _blocked(x, z) {
    const h = exteriorHeight(x, z);
    if (h < -0.8) return true;
    const e = 1.2, gx = exteriorHeight(x + e, z) - exteriorHeight(x - e, z), gz = exteriorHeight(x, z + e) - exteriorHeight(x, z - e);
    if (Math.hypot(gx, gz) / (2 * e) > 0.8) return true;
    for (const o of this.obstacles) if (Math.hypot(x - o.x, z - o.z) < o.r + 0.3) return true;
    return false;
  }

  _props() {
    const sc = this.scene, R = rng(31);
    const onPath = (x, z, pad = 0) => Math.abs(x - PATH_X(z)) < 4.5 + pad && z > -45 && z < 120;
    // Placement rules shared by everything that grows or lies on the ground: stay off the path, the
    // terrace and the cave mouth, the landing beach and the altar; never overlap rocks or trunks.
    const H = exteriorHeight, up = new THREE.Vector3(0, 1, 0);
    const normalAt = (x, z) => new THREE.Vector3(H(x - 0.6, z) - H(x + 0.6, z), 1.2, H(x, z - 0.6) - H(x, z + 0.6)).normalize();
    const keepOut = (x, z, pad = 0) => onPath(x, z, pad) || Math.hypot(x - CAVE_MOUTH.x, (z - CAVE_MOUTH.z) * 0.8) < 26 + pad || Math.hypot(x, z - 45) < 13 + pad
      || Math.hypot(x + 30, z - 58) < 5 + pad || Math.hypot(x - SHIP_SPOT.x, z - 118) < 12 + pad;
    const solids = [];   // [x, z, r] footprints of rocks and trunks
    const hits = (x, z, r) => solids.some(([sx, sz, sr]) => Math.hypot(x - sx, z - sz) < sr + r);
    // Rocks: bedded into the ground on their downhill side, tilted with the slope, in loose scatters.
    for (let v = 0; v < 3; v++) {
      const items = [];
      for (let i = 0; i < 90 && items.length < 55; i++) {
        const x = (R() - 0.5) * 220, z = -80 + R() * 200, h = H(x, z);
        const rs = 0.5 + R() * R() * 3.5;
        if (h < -2 || keepOut(x, z, rs) || hits(x, z, rs * 0.9)) continue;
        let low = h; for (let k = 0; k < 6; k++) { const a = (k / 6) * 6.28; low = Math.min(low, H(x + Math.cos(a) * rs * 0.8, z + Math.sin(a) * rs * 0.8)); }
        const q = new THREE.Quaternion().setFromUnitVectors(up, up.clone().lerp(normalAt(x, z), 0.7).normalize()).multiply(new THREE.Quaternion().setFromAxisAngle(up, R() * 6.28));
        items.push({ x, y: low + rs * 0.12, z, s: rs, q });
        solids.push([x, z, rs * 0.85]);
        if (rs > 1.2) this.addObstacle(x, z, rs * 0.75, true);
      }
      sc.add(instanced(rockGeo(10 + v, 3), Mat.stone, items));
    }
    // Olive groves: a handful of clusters, trees spaced naturally inside each, trunks sunk to the low side.
    const trunks = [[], [], []], leaves = [[], [], []];
    const treeN = Math.round(110 * (G.quality.trees || 1));
    const groves = [];
    for (let i = 0; i < 400 && groves.length < 16; i++) { const x = (R() - 0.5) * 180, z = -25 + R() * 130, h = H(x, z); if (h > 3 && h < 24 && !keepOut(x, z, 4)) groves.push([x, z, 6 + R() * 9]); }
    for (let i = 0; i < treeN * 8 && trunks.flat().length < treeN; i++) {
      const [gx, gz, gr] = groves[i % groves.length];
      const a = R() * 6.28, rr = gr * Math.sqrt(R()) * (1 + (R() - 0.5) * 0.4), x = gx + Math.cos(a) * rr, z = gz + Math.sin(a) * rr;
      const h = H(x, z), ts = 0.75 + R() * 0.75;
      if (h < 2.5 || h > 26 || keepOut(x, z, 1) || hits(x, z, 2.2 * ts) || normalAt(x, z).y < 0.8) continue;
      const k = (R() * 3) | 0, ry = R() * 6.28;
      const low = Math.min(H(x + 0.4, z), H(x - 0.4, z), H(x, z + 0.4), H(x, z - 0.4)) - 0.12;
      trunks[k].push({ x, y: low, z, s: ts, ry }); leaves[k].push({ x, y: low, z, s: ts, ry });
      solids.push([x, z, 0.5 * ts]);
      this.addObstacle(x, z, 0.45 * ts);
    }
    for (let k = 0; k < 3; k++) {
      const g = oliveTreeGeos(k + 1);
      if (trunks[k].length) { sc.add(instanced(g.trunk, Mat.bark, trunks[k])); sc.add(instanced(g.leaves, Mat.olive, leaves[k])); }
    }
    // Cypresses: tight stands of two to five on the higher slopes.
    const cyp = [];
    for (let i = 0; i < 60 && cyp.length < 42; i++) {
      const cx = (R() - 0.5) * 200, cz = -90 + R() * 120;
      if (H(cx, cz) < 8 || H(cx, cz) > 50 || keepOut(cx, cz, 4)) continue;
      const n = 2 + ((R() * 4) | 0);
      for (let j = 0; j < n; j++) {
        const x = cx + (R() - 0.5) * 7, z = cz + (R() - 0.5) * 7, h = H(x, z);
        if (h < 6 || keepOut(x, z, 1) || hits(x, z, 1.2) || normalAt(x, z).y < 0.72) continue;
        const low = Math.min(H(x + 0.3, z), H(x - 0.3, z), H(x, z + 0.3), H(x, z - 0.3)) - 0.15;
        cyp.push({ x, y: low, z, s: 0.75 + R() * 0.6, ry: R() * 6.28 });
        solids.push([x, z, 0.6]); this.addObstacle(x, z, 0.6);
      }
    }
    sc.add(instanced(cypressGeo(), Mat.cypress, cyp));
    // Grass: patches that thicken toward their centres, each tuft tilted to the slope, kept off paths and stone.
    const blades = [];
    const gn = Math.round(9000 * (G.quality.grass || 0.5));
    for (let p = 0; p < 2000 && blades.length < gn; p++) {
      const px = (R() - 0.5) * 200, pz = -40 + R() * 150, ph = H(px, pz);
      if (ph < 2.8 || ph > 24 || fbm2(px * 0.05, pz * 0.05, 2) < 0.4) continue;
      const pr = 2 + R() * 4.5, n = 12 + ((R() * 30) | 0);
      for (let j = 0; j < n; j++) {
        const a = R() * 6.28, rr = pr * Math.pow(R(), 0.7), x = px + Math.cos(a) * rr, z = pz + Math.sin(a) * rr, h = H(x, z);
        if (h < 2.8 || keepOut(x, z, 0.3) || hits(x, z, 0.25)) continue;
        const nrm = normalAt(x, z);
        if (nrm.y < 0.75) continue;
        const q = new THREE.Quaternion().setFromUnitVectors(up, nrm).multiply(new THREE.Quaternion().setFromAxisAngle(up, R() * 6.28));
        blades.push({ x, y: h - 0.03, z, s: (0.6 + R() * 0.8) * (1 - rr / pr * 0.35), q });
      }
    }
    if (blades.length) { const g = instanced(grassBladeGeo(), Mat.grass, blades, { cast: false }); sc.add(g); }

    // The cave mouth: a cliff portal of great stones bedded into the hillside, framing a rough tunnel that
    // runs 30 m into the mountain. Sized so the 8 m giant clears it: 21 m wide, 13 m clear at the crown.
    const arch = new THREE.Group(), M = CAVE_MOUTH;
    {
      const tg = new THREE.CylinderGeometry(11, 11, 30, 36, 10, true, Math.PI / 2, Math.PI);
      const tp = tg.attributes.position;
      for (let i = 0; i < tp.count; i++) {
        const x = tp.getX(i), y = tp.getY(i), z = tp.getZ(i), k = 1 + (fbm2(x * 0.18 + y * 0.07, z * 0.18, 3) - 0.5) * 0.12;
        tp.setXYZ(i, x * k, y, z * k);
      }
      tg.computeVertexNormals();
      const tunnelMat = Mat.caveRock.clone(); tunnelMat.side = THREE.DoubleSide;
      const tunnel = new THREE.Mesh(tg, tunnelMat);
      tunnel.rotation.x = Math.PI / 2; tunnel.position.set(0, -0.3, -15);
      tunnel.receiveShadow = true; arch.add(tunnel);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(22, 30), Mat.stone); floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0.02, -15); floor.receiveShadow = true; arch.add(floor);
      const back = new THREE.Mesh(new THREE.CircleGeometry(12, 32, 0, Math.PI), new THREE.MeshBasicMaterial({ color: 0x030201 })); back.position.set(0, -0.3, -29.5); arch.add(back);
      // Cliff face: a rough rock wall that rises from the terrace to meet the hillside at every column,
      // leaning back into the slope, with the tunnel opening cut out of it.
      const NX = 56, NY = 30, W = 46, verts = [], uvs = [], tris = [], inside = [];
      const topAt = (x) => exteriorHeight(x, M.z - 5) - M.y + 2.5, botAt = (x) => Math.min(0, exteriorHeight(x, M.z + 1.5) - M.y) - 1.2;
      for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
        let x = (i / NX - 0.5) * W, y = lerp(botAt(x), Math.max(topAt(x), 13.5), j / NY);
        // vertices inside the opening slide out onto a smooth ellipse just inside the tunnel's rim
        const OX = 10.0, OY = 10.5, e = Math.hypot(x / OX, Math.max(0, y) / OY);
        inside.push(e < 1 && y > -0.4);
        if (e < 1 && y > -0.4) x = Math.sign(x || 1) * OX * Math.sqrt(Math.max(0, 1 - (Math.max(0, y) / OY) ** 2));   // slide sideways onto the jamb
        const open = Math.hypot(x / OX, Math.max(0, y) / OY);
        const rim = Math.max(0, 1 - Math.abs(open - 1) * 3) * 1.1;
        const side = Math.max(0, Math.abs(x) / (W / 2) - 0.45) / 0.55;
        const z = (fbm2(x * 0.16 + 3, y * 0.16, 4) - 0.5) * 3.2 + (noise2(x * 0.6, y * 0.6) - 0.5) * 0.6 - Math.max(0, y) * 0.22 + rim - side * side * 9;
        verts.push(x, y, z); uvs.push(x * 0.12, y * 0.12);
      }
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
        const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1;
        // drop quads lying wholly inside the opening; the rest keep their snapped, smooth edge
        if (inside[a] && inside[b] && inside[c] && inside[d]) continue;
        if (!(inside[a] && inside[c] && inside[b])) tris.push(a, c, b);
        if (!(inside[b] && inside[c] && inside[d])) tris.push(b, c, d);
      }
      const fg = new THREE.BufferGeometry();
      fg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); fg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); fg.setIndex(tris);
      fg.computeVertexNormals();
      const faceMat = Mat.stone.clone(); faceMat.side = THREE.DoubleSide;
      const face = new THREE.Mesh(fg, faceMat); face.position.z = 0.6; arch.add(face);
      // a few great stones bedded at its foot and shoulders, half sunk into the face and the ground
      const stones = [[-13.2, 0.2, 1.6, 2.6], [12.8, 0.1, 1.8, 2.9], [-17.5, 0.5, 0.2, 3.4], [17.8, 0.4, 0.4, 3.2], [-12.2, 0.0, 3.6, 1.3], [11.6, 0.0, 4.0, 1.1]];
      stones.forEach(([x, y, z, sc], i) => {
        const m = new THREE.Mesh(rockGeo(20 + i, 3), Mat.stone);
        m.scale.set(sc, sc * 0.9, sc); m.rotation.set(0, i * 1.7, (i % 3 - 1) * 0.15);
        m.position.set(x, y + (y < 1 ? Math.min(0, exteriorHeight(M.x + x, M.z + z) - M.y) : 0), z);
        arch.add(m);
      });
    }
    arch.position.copy(CAVE_MOUTH);
    setShadows(arch);
    sc.add(arch);
    this.arch = arch;
    for (const sx of [-1, 1]) this.addObstacle(sx * 14.2, CAVE_MOUTH.z + 0.5, 4.2, true);
    // Embers glow from within (guides the eye in the dusk)
    this.mouthLight = new THREE.PointLight(0xff8a40, 30, 30, 2);
    this.mouthLight.position.set(0, CAVE_MOUTH.y + 3, CAVE_MOUTH.z - 9);
    sc.add(this.mouthLight);

    // Offering altar with a secret boon (off the path, under an old olive)
    const altar = new THREE.Group();
    const slab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 1.0), Mat.stone); slab.position.y = 0.5; altar.add(slab);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.18, 1.2), Mat.stone); top.position.y = 1.08; altar.add(top);
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), Mat.bronze); bowl.rotation.x = Math.PI; bowl.position.y = 1.3; altar.add(bowl);
    const ax = -30, az = 58;
    altar.position.set(ax, exteriorHeight(ax, az), az);
    setShadows(altar);
    sc.add(altar);
    this.addObstacle(ax, az, 1.1);
    this.altarPos = altar.position.clone();
  }

  ground(x, z) { return inTunnel(x, z) ? CAVE_MOUTH.y : exteriorHeight(x, z); }
  surface(x, z) { const h = exteriorHeight(x, z); return h < 2.4 ? 'sand' : Math.abs(x - PATH_X(z)) < 3 ? 'sand' : h > 14 ? 'stone' : 'grass'; }

  collide(pos, r, prev) {
    this.collideCircles(pos, r);
    if (prev) {
      // Too steep or too deep: slide along the slope instead of climbing it.
      const ok = (x, z) => {
        const h = exteriorHeight(x, z), h0 = exteriorHeight(prev.x, prev.z);
        if (h < -1.0) return false;
        const d = Math.hypot(x - prev.x, z - prev.z);
        return d < 1e-4 || (h - h0) / d < 0.95;
      };
      if (!ok(pos.x, pos.z)) {
        if (ok(pos.x, prev.z)) pos.z = prev.z;
        else if (ok(prev.x, pos.z)) pos.x = prev.x;
        else { pos.x = prev.x; pos.z = prev.z; }
      }
    }
    // Keep away from the ship hull
    const s = this.ship;
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    const dx = pos.x - s.pos.x, dz = pos.z - s.pos.z;
    const along = dx * fx + dz * fz, side = dx * fz - dz * fx;
    if (Math.abs(along) < 12 && Math.abs(side) < 2.2 + r) { const sgn = Math.sign(side) || 1; const push = 2.2 + r - Math.abs(side); pos.x += fz * sgn * push; pos.z -= fx * sgn * push; }
  }
  collideGiant() {}

  update(dt, camera, focus) {
    shaderTime.value += dt;
    this.atm.update(dt, focus, camera);
    this.ocean.update(G.engine.gameTime, dt, camera, { x: this.ship.pos.x, z: this.ship.pos.z, yaw: this.ship.yaw, speed: this.ship.speed, waterY: this.ship.buoy.water ?? 0 });
    this.ship.update(dt, this.ocean);
    this.rain.update(dt, camera);
    wetness(this.rain.intensity);
    // Smoke from the smoke-hole on the mountain: the landmark seen from the sea
    if (Math.random() < dt * 5) {
      const p = new THREE.Vector3(10, exteriorHeight(10, -80) + 1, -80);
      this.fx.emit('smoke', p, 1, { scale: 6, life: [7, 10], up: [3, 5], alpha: 0.3 });
    }
    this.mouthLight.intensity = (this.ch.mouthGlow ?? 1) * (24 + Math.sin(G.engine.gameTime * 9) * 4);
  }
  rebakeEnv() { this.env?.dispose(); this.env = bakeSkyEnv(G.renderer, this.atm); this.scene.environment = this.env; }
}

// =====================================================================
// INTERIOR: the giant's cave
// =====================================================================
export const CAVE = {
  R: 40, hearth: new THREE.Vector3(0, 0, 2), pen: new THREE.Vector3(18, 0, -9), penR: 7.5,
  racks: new THREE.Vector3(27, 0, 11), bed: new THREE.Vector3(-15, 0, -16), staff: new THREE.Vector3(10, 0, -29),
  whet: new THREE.Vector3(-30, 0, 13), entrance: new THREE.Vector3(0, 0, 37), fresco: new THREE.Vector3(-22, 0, 28),
  moon: new THREE.Vector3(10, 0, -27), sleep: new THREE.Vector3(-12, 0, -6),
};
export function hideSpots() {
  const out = [];
  for (let i = 0; i < 14; i++) { const a = Math.PI * (0.72 + i * 0.045); const r = 33.5 - (i % 2) * 1.6; out.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
  return out;
}
export function caveGround(x, z) {
  const r = Math.hypot(x, z);
  return (noise2(x * 0.18, z * 0.18) - 0.5) * 0.5 + smoothstep(33, 41, r) * 3.2 - smoothstep(6, 2, Math.hypot(x - CAVE.hearth.x, z - CAVE.hearth.z)) * 0.15;
}

const shaftVert = `varying vec3 vP; varying vec2 vUv; void main(){ vUv = uv; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const shaftFrag = `uniform float uI, uT; varying vec2 vUv; void main(){ float a = (1.0 - vUv.y) * 0.35 + vUv.y * 0.08; a *= 0.75 + 0.25 * sin(vUv.x * 40.0 + uT * 0.6); gl_FragColor = vec4(vec3(0.55, 0.65, 0.9) * a * uI, a * uI); }`;

export class Interior extends Zone {
  constructor(ch) {
    super(ch);
    const sc = this.scene;
    sc.fog = new THREE.FogExp2(0x1e120b, 0.011);
    sc.background = new THREE.Color(0x020101);
    this.hemi = new THREE.HemisphereLight(0x5a6890, 0x5a3418, 0.9); sc.add(this.hemi);
    sc.environment = bakeGradientEnv(G.renderer, '#1c1824', '#5a3418', '#2a180c');
    this.env = sc.environment;
    // Dome
    const dome = new THREE.SphereGeometry(CAVE.R + 3, 72, 40);
    const p = dome.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = fbm2(v.x * 0.07 + 3, v.z * 0.07 + v.y * 0.05, 4);
      v.multiplyScalar(1 + (n - 0.5) * 0.28);
      v.y *= 0.64;
      p.setXYZ(i, v.x, v.y, v.z);
    }
    dome.computeVertexNormals();
    // Cut the doorway out of the dome so the outside light (and the giant's silhouette) can be seen.
    const idx = dome.index.array, keep = [];
    for (let i = 0; i < idx.length; i += 3) {
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < 3; k++) { cx += p.getX(idx[i + k]); cy += p.getY(idx[i + k]); cz += p.getZ(idx[i + k]); }
      cx /= 3; cy /= 3; cz /= 3;
      if (Math.hypot(cx, Math.max(0, cy - 0.5)) < 12.2 && cz > 20 && cy > -2) continue;   // round, just wider than the bore (its outer wall fills the margin)
      keep.push(idx[i], idx[i + 1], idx[i + 2]);
    }
    dome.setIndex(keep);
    const domeMesh = new THREE.Mesh(dome, Mat.caveRock);
    domeMesh.receiveShadow = true;
    sc.add(domeMesh);
    // The real (noisy) ceiling and walls, found by raycasting the dome, so hanging and leaning things touch rock.
    const probe = new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), ray = new THREE.Raycaster();
    const castDome = (o, d) => { ray.set(o, d); const h = ray.intersectObject(probe, false)[0]; return h || null; };
    this.ceiling = (x, z) => { const h = castDome(new THREE.Vector3(x, 0, z), new THREE.Vector3(0, 1, 0)); return h ? h.point.y : 20; };
    this.wallAt = (ang, y) => { const h = castDome(new THREE.Vector3(0, y, 0), new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang))); return h ? h.point : null; };
    // both faces: where the bore juts into the cave its outside must read as rock, not let the glow through
    const boreMat = Mat.caveRock.clone(); boreMat.side = THREE.DoubleSide;
    const tunnel = new THREE.Mesh(new THREE.CylinderGeometry(10.6, 10.6, 20, 28, 1, true, Math.PI / 2, Math.PI), boreMat);
    tunnel.rotation.x = Math.PI / 2; tunnel.position.set(0, 0.5, CAVE.R + 2.5);
    tunnel.receiveShadow = true;
    sc.add(tunnel);
    // the bore's floor continues the cave floor (which rises toward the walls) out to the dusk beyond
    const boreFloor = new THREE.Mesh(new THREE.PlaneGeometry(22, 16), Mat.stone); boreFloor.rotation.x = -Math.PI / 2;
    boreFloor.position.set(0, caveGround(0, 41) - 0.02, CAVE.R + 6); boreFloor.receiveShadow = true; sc.add(boreFloor);
    // Floor
    const floor = new THREE.PlaneGeometry(92, 92, 120, 120); floor.rotateX(-Math.PI / 2);
    const fp = floor.attributes.position;
    for (let i = 0; i < fp.count; i++) fp.setY(i, caveGround(fp.getX(i), fp.getZ(i)));
    floor.computeVertexNormals();
    const fuv = floor.attributes.uv; for (let i = 0; i < fuv.count; i++) fuv.setXY(i, fuv.getX(i) * 14, fuv.getY(i) * 14);
    const floorMat = Mat.stone.clone(); floorMat.color = new THREE.Color(0x6a5a4a);
    const floorMesh = new THREE.Mesh(floor, floorMat); floorMesh.receiveShadow = true; sc.add(floorMesh);
    // Stalactites
    const R = rng(77);
    const tites = [], mites = [];
    for (let i = 0; i < 90; i++) {
      const a = R() * 6.28, r = 6 + R() * 30;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      tites.push({ x, y: this.ceiling(x, z) + 0.6, z, sv: new THREE.Vector3(0.6 + R() * 0.8, 2 + R() * 5, 0.6 + R() * 0.8) });
    }
    const titeGeo = cachedGeo('tite', () => { const g = new THREE.ConeGeometry(1, 1, 7); g.rotateX(Math.PI); g.translate(0, -0.5, 0); return g; });
    sc.add(instanced(titeGeo, Mat.stone, tites, { cast: false }));
    // Rock columns: real cover for stealth
    const cols = [[-8, -22], [13, 17], [-20, 4], [-13, 22], [-25, -18], [24, -24], [30, -6]];
    for (const [x, z] of cols) {
      const c = new THREE.Mesh(rockGeo(40 + x, 3), Mat.stone);
      const top = this.ceiling(x, z) + 1.5, bot = caveGround(x, z) - 1.5;
      c.scale.set(2.2, (top - bot) / 2, 2.2); c.position.set(x, (top + bot) / 2, z);
      setShadows(c); sc.add(c);
      this.addObstacle(x, z, 2.0, true);
    }
    // Boulders near walls
    for (let i = 0; i < 26; i++) {
      const a = R() * 6.28, r = 26 + R() * 9;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(x) < 7 && z > 25) continue;
      if (Math.hypot(x - CAVE.whet.x, z - CAVE.whet.z) < 4) continue;
      const s = 1 + R() * 2.4;
      mites.push({ x, y: caveGround(x, z) + s * 0.3, z, s });
      this.addObstacle(x, z, s * 0.8, s > 1.8);
    }
    sc.add(instanced(rockGeo(51, 3), Mat.stone, mites));

    // Hearth
    const ring = [];
    for (let i = 0; i < 14; i++) { const a = (i / 14) * 6.28; const x = CAVE.hearth.x + Math.cos(a) * 1.8, z = CAVE.hearth.z + Math.sin(a) * 1.8; ring.push({ x, y: caveGround(x, z) + 0.08, z, s: 0.35 + R() * 0.15 }); }
    sc.add(instanced(rockGeo(60, 2), Mat.wetStone, ring));
    const logs = new THREE.Group();
    for (let i = 0; i < 5; i++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 2.2, 6), Mat.darkWood); l.rotation.set(Math.PI / 2 - 0.3, (i / 5) * 6.28, 0); l.position.y = 0.35; logs.add(l); }
    logs.position.copy(CAVE.hearth); logs.position.y = caveGround(CAVE.hearth.x, CAVE.hearth.z) - 0.05; sc.add(logs);
    this.fire = new Fire({ scale: 1.6, intensity: 225, shadow: !!G.quality.pointShadows, color: 0xffb262 });
    this.fire.group.position.copy(CAVE.hearth);
    this.fire.level = 0.22;
    sc.add(this.fire.group);
    // Firelight bouncing off the vault: a soft, shadowless warm fill high over the hearth, so the far
    // walls and the doorway read, while the hearth itself keeps its hot key and deep shadows.
    this.bounce = new THREE.PointLight(0xff9a50, 0, 0, 1.4);
    this.bounce.position.set(CAVE.hearth.x, 13, CAVE.hearth.z);
    sc.add(this.bounce);
    // Warm haze glowing round the fire (smoke catching the light).
    const hazeTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,170,90,0.55)'); gr.addColorStop(0.4, 'rgba(255,120,50,0.18)'); gr.addColorStop(1, 'rgba(255,100,40,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    this.haze = new THREE.Sprite(new THREE.SpriteMaterial({ map: hazeTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0.5 }));
    this.haze.scale.set(26, 18, 1); this.haze.position.set(CAVE.hearth.x, 5, CAVE.hearth.z);
    sc.add(this.haze);
    this.addObstacle(CAVE.hearth.x, CAVE.hearth.z, 2.2);
    // Moonbeam through the smoke-hole: lights the staff (guide by light, not arrows)
    this.moon = new THREE.SpotLight(0x9ab0e0, 2600, 60, 0.22, 0.6, 1.6);
    this.moon.position.set(CAVE.moon.x, 26, CAVE.moon.z);
    this.moon.target.position.copy(CAVE.moon);
    this.moon.castShadow = false;
    sc.add(this.moon, this.moon.target);
    // Warm key light reserved for seizures, so the player sees exactly what their mistake cost.
    this.dramaLight = new THREE.SpotLight(0xffa868, 0, 40, 0.6, 0.7, 1.4);
    sc.add(this.dramaLight, this.dramaLight.target);
    this.shaftMat = new THREE.ShaderMaterial({ uniforms: { uI: { value: 1 }, uT: shaderTime }, vertexShader: shaftVert, fragmentShader: shaftFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 4, 26, 24, 1, true), this.shaftMat);
    shaft.position.set(CAVE.moon.x, 13, CAVE.moon.z);
    sc.add(shaft);
    this.shaft = shaft;
    // Entrance: dusk light outside, the great boulder
    // the dusk beyond: a half-disc that exactly fills the far end of the tunnel bore
    this.doorLight = new THREE.Mesh(new THREE.CircleGeometry(10.7, 32, 0, Math.PI), new THREE.MeshBasicMaterial({ color: 0xffa060, fog: false }));
    this.doorLight.position.set(0, 0.5, CAVE.R + 12.4); this.doorLight.rotation.y = Math.PI;
    sc.add(this.doorLight);
    this.doorSpot = new THREE.SpotLight(0xffa868, 0, 80, 0.6, 0.7, 1.2);
    this.doorSpot.position.set(0, 11, CAVE.R + 4); this.doorSpot.target.position.set(0, 0, 8);
    sc.add(this.doorSpot, this.doorSpot.target);
    this.boulder = boulderMesh(7.4);
    this.boulderOpen = new THREE.Vector3(15.5, 6.8, CAVE.R - 3.5);
    this.boulderClosed = new THREE.Vector3(0, 6.8, CAVE.R - 1);
    this.boulder.position.copy(this.boulderOpen);
    sc.add(this.boulder);
    this.boulderObs = this.addObstacle(this.boulderOpen.x, this.boulderOpen.z, 6.6);
    // Sheep pen
    const posts = [], rails = [];
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * 6.28;
      const x = CAVE.pen.x + Math.cos(a) * CAVE.penR, z = CAVE.pen.z + Math.sin(a) * CAVE.penR;
      posts.push({ x, y: caveGround(x, z), z, sv: new THREE.Vector3(1, 1, 1), ry: 0 });
      const a2 = ((i + 0.5) / 28) * 6.28;
      for (const hy of [0.55, 1.05]) rails.push({ x: CAVE.pen.x + Math.cos(a2) * CAVE.penR, y: caveGround(x, z) + hy, z: CAVE.pen.z + Math.sin(a2) * CAVE.penR, ry: -a2, sv: new THREE.Vector3(1, 1, 1) });
    }
    sc.add(instanced(cachedGeo('post', () => { const g = new THREE.CylinderGeometry(0.1, 0.12, 1.4, 6); g.translate(0, 0.7, 0); return g; }), Mat.darkWood, posts));
    sc.add(instanced(cachedGeo('rail', () => new THREE.BoxGeometry(0.08, 0.1, 1.75)), Mat.darkWood, rails));
    this.penObs = this.addObstacle(CAVE.pen.x, CAVE.pen.z, CAVE.penR + 0.3);
    this.sheep = [];
    for (let i = 0; i < 15; i++) {
      const q = new Quadruped(i === 0 ? 'ram' : (i % 5 === 3 ? 'blackSheep' : 'sheep'), i === 0 ? 1.45 : 1.05 + R() * 0.2);
      const a = R() * 6.28, r = R() * (CAVE.penR - 1.5);
      const s = { q, pos: new THREE.Vector3(CAVE.pen.x + Math.cos(a) * r, 0, CAVE.pen.z + Math.sin(a) * r), yaw: R() * 6.28, target: null, t: R() * 5, speed: 0, ram: i === 0 };
      s.pos.y = caveGround(s.pos.x, s.pos.z);
      sc.add(q.root);
      this.sheep.push(s);
    }
    // Cheese racks, baskets, pails
    const rack = new THREE.Group();
    for (let k = 0; k < 2; k++) {
      const frame = new THREE.Group();
      for (const sy of [0.6, 1.6, 2.6]) { const shelf = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.12, 1.3), Mat.darkWood); shelf.position.y = sy; frame.add(shelf); for (let c = 0; c < 4; c++) { const ch = new THREE.Mesh(cheeseWheel(), Mat.cheese); ch.position.set(-1.6 + c * 1.07, sy + 0.22, 0); ch.scale.setScalar(0.8 + R() * 0.3); frame.add(ch); } }
      for (const sx of [-2.2, 2.2]) for (const sz of [-0.6, 0.6]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.2, 0.14), Mat.darkWood); leg.position.set(sx, 1.6, sz); frame.add(leg); }
      frame.position.set(0, 0, k * 4.5 - 2.25);
      rack.add(frame);
    }
    for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.45, 0.9, 10, 1, true), Mat.wicker); b.position.set(-3 + (i % 3) * 1.2, 0.45, 6 + Math.floor(i / 3) * 1.3); rack.add(b); }
    rack.position.copy(CAVE.racks); rack.rotation.y = -0.5;
    rack.position.y = caveGround(CAVE.racks.x, CAVE.racks.z) - 0.04;
    rack.updateMatrixWorld(true);
    for (const b of rack.children.filter((c) => c.isMesh)) { const w = b.getWorldPosition(new THREE.Vector3()); b.position.y = caveGround(w.x, w.z) - rack.position.y + 0.43; }
    setShadows(rack); sc.add(rack);
    this.addObstacle(CAVE.racks.x, CAVE.racks.z - 2.1, 2.4, true);
    this.addObstacle(CAVE.racks.x + 1.2, CAVE.racks.z + 2.2, 2.4, true);
    // Giant's wooden bowl near the hearth
    const prof = [[0, 0], [0.9, 0], [1.25, 0.25], [1.45, 0.8], [1.5, 1.05], [1.38, 1.08], [1.32, 0.85], [1.12, 0.38], [0.8, 0.2], [0, 0.18]].map(([r, y]) => new THREE.Vector2(r, y));
    const bowl = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), Mat.darkWood);
    bowl.position.set(-3.5, caveGround(-3.5, 5.5) - 0.03, 5.5); setShadows(bowl); sc.add(bowl);
    this.addObstacle(-3.5, 5.5, 1.4);
    // Fleece bed
    // Fleece bed: overlapping sheepskins with ragged outlines, draped over the uneven floor, in mixed natural colours.
    {
      const tones = [0xd8cdb4, 0x8a7458, 0xc9b998, 0x3a332c, 0xb8a684, 0x6a5a48, 0xd2c4a6];
      for (let i = 0; i < 7; i++) {
        const g = new THREE.CircleGeometry(1, 28, 0, Math.PI * 2); const gp = g.attributes.position;
        const fx = CAVE.bed.x + (i % 3) * 2.6 - 2.6 + (R() - 0.5) * 0.8, fz = CAVE.bed.z + Math.floor(i / 3) * 2.4 - 2.2 + (R() - 0.5) * 0.8;
        const rx = 1.9 + R() * 0.5, rz = 1.4 + R() * 0.4, rot = R() * 6.28, seed = R() * 10;
        for (let k = 0; k < gp.count; k++) {
          const x = gp.getX(k), y = gp.getY(k), a = Math.atan2(y, x), rr = Math.hypot(x, y);
          const edge = 1 + (noise2(Math.cos(a) * 1.7 + seed, Math.sin(a) * 1.7) - 0.5) * 0.45 + Math.sin(a * 2) * 0.08;   // legs and neck of the hide
          const lx = x * rx * edge, lz = y * rz * edge;
          const wx = fx + lx * Math.cos(rot) - lz * Math.sin(rot), wz = fz + lx * Math.sin(rot) + lz * Math.cos(rot);
          gp.setXYZ(k, wx, caveGround(wx, wz) + 0.06 + i * 0.025 + (1 - rr) * 0.12 + (noise2(wx * 1.3, wz * 1.3) - 0.5) * 0.1, wz);
        }
        g.computeVertexNormals();
        const m = Mat.wool.clone(); m.color.setHex(tones[i % tones.length]); m.side = THREE.DoubleSide;
        const hide = new THREE.Mesh(g, m); hide.receiveShadow = true; sc.add(hide);
      }
    }
    // His club: a whole olive trunk, knotted and smoke-black, leaning by his bed
    {
      const g = new THREE.CylinderGeometry(0.32, 0.62, 9.5, 10, 8); const cp = g.attributes.position;
      for (let i = 0; i < cp.count; i++) { const k = 1 + (noise2(cp.getY(i) * 0.9, Math.atan2(cp.getZ(i), cp.getX(i)) * 1.5) - 0.5) * 0.35; cp.setX(i, cp.getX(i) * k); cp.setZ(i, cp.getZ(i) * k); }
      g.computeVertexNormals();
      // leaning against the rock column at (-25, -18): foot on the floor, top resting on the stone
      const foot = new THREE.Vector3(-20.6, caveGround(-20.6, -21.2) + 0.2, -21.2), top = new THREE.Vector3(-23.0, 0, -19.3);
      top.y = foot.y + Math.sqrt(Math.max(1, 9.5 * 9.5 - foot.clone().setY(0).distanceToSquared(top.clone().setY(0))));
      const club = new THREE.Mesh(g, Mat.bark);
      club.position.copy(foot).lerp(top, 0.5);
      club.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(foot).normalize());
      setShadows(club); sc.add(club); this.addObstacle(foot.x, foot.z, 1.0);
    }
    // Whetstone alcove
    const whet = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 1.0), Mat.wetStone); whet.position.set(CAVE.whet.x + 1.2, caveGround(CAVE.whet.x + 1.2, CAVE.whet.z) + 0.24, CAVE.whet.z); whet.rotation.y = 0.3; setShadows(whet); sc.add(whet);
    this.addObstacle(CAVE.whet.x + 1.2, CAVE.whet.z, 0.9);
    // The olive staff, lying in the moonbeam
    this.staff = buildStaff();
    this.staff.group.position.set(CAVE.staff.x, caveGround(CAVE.staff.x, CAVE.staff.z) + 0.2, CAVE.staff.z);
    this.staff.group.rotation.y = 0.4;
    sc.add(this.staff.group);
    this.tipLight = new THREE.PointLight(0xff6a20, 0, 9, 2);
    this.tipLight.position.x = 0.3;
    this.staff.tip.add(this.tipLight);
    // Fresco (secret side story)
    const fresco = new THREE.Mesh(new THREE.PlaneGeometry(5, 2.5), new THREE.MeshStandardMaterial({ map: frescoTexture('giant'), roughness: 0.9 }));
    const fa = Math.atan2(CAVE.fresco.z, CAVE.fresco.x);
    const slab = new THREE.Mesh(rockGeo(71, 3), Mat.caveRock.clone()); slab.material.side = THREE.FrontSide;
    const wall = this.wallAt(fa, 4.2), wr = wall ? Math.hypot(wall.x, wall.z) : 40;
    slab.scale.set(4.2, 4.6, (wr - 37.4) + 1.2);
    slab.position.set(Math.cos(fa) * (37.4 + (wr - 37.4) / 2 + 0.6), caveGround(Math.cos(fa) * 38, Math.sin(fa) * 38) + 3.8, Math.sin(fa) * (37.4 + (wr - 37.4) / 2 + 0.6));
    slab.lookAt(0, slab.position.y, 0); setShadows(slab); sc.add(slab);
    fresco.position.set(Math.cos(fa) * 37.35, 4.2, Math.sin(fa) * 37.35);
    fresco.lookAt(0, 4.2, 0);
    sc.add(fresco);
    // Set dressing: gnawed bones by the hearth, and the shepherd's tall wine jars by the racks.
    {
      const boneG = cachedGeo('bone', () => { const shaft = new THREE.CylinderGeometry(0.07, 0.08, 1.1, 7); shaft.rotateZ(Math.PI / 2);
        const ends = [-0.55, 0.55].flatMap((x) => [0.07, -0.07].map((z) => { const k = new THREE.SphereGeometry(0.1, 8, 6); k.translate(x, 0, z); return k; }));
        return mergeGeometries([shaft, ...ends].map((q) => q.toNonIndexed())); });
      const boneMat = new THREE.MeshStandardMaterial({ color: 0xcfc2a2, roughness: 0.75 });
      const bones = [];
      for (let i = 0; i < 16; i++) { const a = R() * 6.28, r = 4.2 + R() * 3.5, x = CAVE.hearth.x - 4 + Math.cos(a) * r * 0.6, z = CAVE.hearth.z - 3 + Math.sin(a) * r * 0.5; bones.push({ x, y: caveGround(x, z) + 0.06, z, ry: R() * 6.28, s: 0.7 + R() * 0.7 }); }
      sc.add(instanced(boneG, boneMat, bones, { cast: true }));
      const jarProf = [[0, 0], [0.32, 0.02], [0.55, 0.45], [0.62, 0.95], [0.5, 1.5], [0.24, 1.75], [0.2, 2.0], [0.28, 2.06], [0.26, 2.1], [0, 2.1]].map(([r, y]) => new THREE.Vector2(r, y));
      const jarG = new THREE.LatheGeometry(jarProf, 18), jarMat = new THREE.MeshStandardMaterial({ color: 0x8a4a2a, roughness: 0.7 });
      for (const [jx, jz, lean] of [[22.5, 2.5, 0], [23.8, 3.4, 0], [21.6, 3.8, 0.05], [24.6, 1.9, 0]]) {
        const j = new THREE.Mesh(jarG, jarMat); j.scale.setScalar(1.5); j.position.set(jx, caveGround(jx, jz) - 0.05, jz); j.rotation.set(lean, R() * 6, 0); setShadows(j); sc.add(j);
      }
      this.addObstacle(23.2, 2.9, 2.2, true);
    }
    // Crew hiding crevices: dark niches in the west wall
    this.hideSpots = hideSpots();
    this.nav = new NavGrid(-44, -44, 88, 1, (x, z) => this._blocked(x, z));
    this.motesT = 0;
  }

  _blocked(x, z) {
    if (Math.hypot(x, z) > 37.5 && !(Math.abs(x) < 5 && z > 30)) return true;
    for (const o of this.obstacles) if (!o.off && Math.hypot(x - o.x, z - o.z) < o.r + 0.35) return true;
    return false;
  }
  ground(x, z) { return caveGround(x, z); }
  surface() { return 'stone'; }
  collide(pos, r) {
    this.collideCircles(pos, r);
    const giant = this.ch.cyclops;
    if (giant && giant.zone === this) {
      for (const c of this.giantCircles()) {
        const dx = pos.x - c.x, dz = pos.z - c.z, d = Math.hypot(dx, dz), m = c.r + r;
        if (d < m && d > 1e-4) { pos.x = c.x + (dx / d) * m; pos.z = c.z + (dz / d) * m; }
      }
    }
    const d = Math.hypot(pos.x, pos.z), lim = 37.2 - r;
    const doorOpen = this.boulderObs.x !== this.boulderClosed.x;
    if (d > lim && !(doorOpen && Math.abs(pos.x) < 7 && pos.z > 30)) { pos.x *= lim / d; pos.z *= lim / d; }
    if (pos.z > CAVE.R + 6) pos.z = CAVE.R + 6;
  }
  giantCircles() {
    const g = this.ch.cyclops;
    if (g.lying > 0.5) {
      const lx = Math.cos(g.yaw), lz = -Math.sin(g.yaw);
      return [0, 2.4, 4.8, 7.0].map((k, i) => ({ x: g.pos.x + lx * k, z: g.pos.z + lz * k, r: i === 3 ? 1.3 : 1.8 }));
    }
    return [{ x: g.pos.x, z: g.pos.z, r: g.activity === 'sit' || g.activity === 'grope' ? 2.8 : 1.8 }];
  }
  collideGiant(pos, r) {
    for (const o of this.obstacles) {
      if (o.off || o.r < 1.6) continue;
      const dx = pos.x - o.x, dz = pos.z - o.z, d = Math.hypot(dx, dz), m = o.r + r * 0.6;
      if (d < m && d > 1e-4) { pos.x = o.x + (dx / d) * m; pos.z = o.z + (dz / d) * m; }
    }
  }

  // How lit is a point (0 dark .. 1 bright): firelight falloff + moonbeam.
  light(x, z) {
    const df = Math.hypot(x - CAVE.hearth.x, z - CAVE.hearth.z);
    const fire = this.fire.level * (1 - smoothstep(3, 6 + 17 * Math.min(1, this.fire.level), df));
    const dm = Math.hypot(x - CAVE.moon.x, z - CAVE.moon.z);
    const moon = (1 - smoothstep(2.5, 4.5, dm)) * 0.7 * this.shaftMat.uniforms.uI.value;
    const door = this.doorSpot.intensity > 1 ? (1 - smoothstep(6, 26, Math.hypot(x, z - 34))) * Math.min(1, this.doorSpot.intensity / 320) : 0;
    return clamp(fire + moon + door + 0.04);
  }

  setDoor(open01, color) {
    this.boulder.position.lerpVectors(this.boulderClosed, this.boulderOpen, open01);
    this.boulder.rotation.z = (1 - open01) * 1.6;
    this.boulderObs.x = this.boulder.position.x; this.boulderObs.z = this.boulder.position.z;
    if (color) this.doorLight.material.color.set(color);
    this.doorLight.visible = open01 > 0.02;
    this.doorSpot.intensity = open01 * (this.doorSpotI ?? 320);
  }

  update(dt, camera) {
    shaderTime.value += dt;
    G.post.outdoor = false; G.post.skyExposure = 1;
    RIM.color.value.setRGB(1, 0.55, 0.25); RIM.strength.value = 0.025 + 0.05 * this.fire.level;
    this.fire.update(G.engine.gameTime, dt, this.fx, camera);
    // Sheep mill about the pen
    for (const s of this.sheep) {
      if (s.scripted) { s.q.update(dt, s.speed); continue; }
      s.t -= dt;
      if (s.t <= 0) { s.t = 2 + Math.random() * 6; const a = Math.random() * 6.28, r = Math.random() * (CAVE.penR - 1.5); s.target = new THREE.Vector3(CAVE.pen.x + Math.cos(a) * r, 0, CAVE.pen.z + Math.sin(a) * r); if (Math.random() < 0.15) G.audio.play('bleat', { pos: s.pos, vol: 0.6, reverb: 0.5 }); }
      let sp = 0;
      if (s.target) { const dx = s.target.x - s.pos.x, dz = s.target.z - s.pos.z, d = Math.hypot(dx, dz); if (d > 0.4) { sp = 0.7; s.yaw = Math.atan2(dx, dz); s.pos.x += (dx / d) * sp * dt; s.pos.z += (dz / d) * sp * dt; } }
      s.speed = sp;
      s.pos.y = caveGround(s.pos.x, s.pos.z);
      s.q.root.position.copy(s.pos); s.q.root.rotation.y = s.yaw;
      s.q.update(dt, sp, { headDown: sp === 0 && s.t > 3 });
    }
    const lvl = this.fire.light.intensity / 225;
    this.bounce.intensity = 60 * lvl;
    this.haze.material.opacity = 0.35 * Math.min(1.2, lvl);
    // Dust drifting through the firelight and the moonbeam
    if (Math.random() < dt * 6 * Math.min(1, lvl)) this.fx.emit('mote', new THREE.Vector3(CAVE.hearth.x + (Math.random() - 0.5) * 16, 1 + Math.random() * 8, CAVE.hearth.z + (Math.random() - 0.5) * 16), 1);
    // Dust motes drifting in the moonbeam
    this.motesT -= dt;
    if (this.motesT <= 0 && this.shaftMat.uniforms.uI.value > 0.2) { this.motesT = 0.25; this.fx.emit('mote', new THREE.Vector3(CAVE.moon.x + (Math.random() - 0.5) * 4, 1 + Math.random() * 12, CAVE.moon.z + (Math.random() - 0.5) * 4), 1); }
  }
}
