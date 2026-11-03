import * as THREE from 'three';
import { G } from '../core/context.js';

// One wave function, two implementations (GLSL + JS) so ships ride exactly the surface you see.
// [direction angle, steepness, wavelength]
const WAVES = [
  [0.35, 0.17, 62], [1.15, 0.15, 33], [-0.45, 0.13, 19], [2.1, 0.1, 11.5], [0.8, 0.08, 6.4], [-1.25, 0.06, 3.7],
  [1.7, 0.045, 2.3], [-0.2, 0.035, 1.45],
];

const GERSTNER = `
#define NW 8
uniform vec4 uWaves[NW];
uniform float uTime, uSteep, uLen;
vec3 gerstner(vec2 p, inout vec3 T, inout vec3 B, float dist){
  vec3 o = vec3(0.0);
  for (int i = 0; i < NW; i++) {
    vec4 w = uWaves[i];
    float L = w.w * uLen;
    float k = 6.28318 / L;
    float c = sqrt(9.8 / k);
    vec2 d = w.xy;
    float Q = w.z * uSteep * (1.0 - smoothstep(L * 22.0, L * 70.0, dist));
    float a = Q / k;
    float f = k * (dot(d, p) - c * uTime);
    float cf = cos(f), sf = sin(f);
    o.x += d.x * a * cf; o.y += a * sf; o.z += d.y * a * cf;
    T += vec3(-d.x * d.x * Q * sf, d.x * Q * cf, -d.x * d.y * Q * sf);
    B += vec3(-d.x * d.y * Q * sf, d.y * Q * cf, -d.y * d.y * Q * sf);
  }
  return o;
}`;

// Up to four island heightmaps (height encoded [-20, 40] → [0, 1]).
const TERRAIN = `
uniform sampler2D uHT0, uHT1, uHT2, uHT3; uniform vec4 uHR[4];
float tsample(sampler2D tx, vec4 r, vec2 p){
  if (r.w < 0.5) return -40.0;
  vec2 uv = (p - r.xy) / r.z;
  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return -40.0;
  return texture2D(tx, uv).r * 60.0 - 20.0;
}
float terrainH(vec2 p){ return max(max(tsample(uHT0, uHR[0], p), tsample(uHT1, uHR[1], p)), max(tsample(uHT2, uHR[2], p), tsample(uHT3, uHR[3], p))); }
float shoalOf(float th){ return 1.0 - smoothstep(-7.0, -0.4, th); }`;

// The ship's hull footprint in its own frame (matches buildShip: length 24 m, beam 3.8 m).
const HULL = `
uniform vec4 uShip; uniform float uShipY;
float hullHalfW(float along) { float t = clamp(along / 24.0 + 0.5, 0.0, 1.0); return 1.9 * pow(sin(3.14159 * clamp(t * 1.02 - 0.01, 0.001, 0.999)), 0.62); }
// signed distance (metres, negative inside) from a world xz point to the hull outline
float hullDist(vec2 p) {
  if (uShip.w < -0.5) return 1e4;
  vec2 rel = p - uShip.xy, f = vec2(sin(uShip.z), cos(uShip.z));
  float along = dot(rel, f), side = dot(rel, vec2(f.y, -f.x));
  return max(abs(along) - 11.9, abs(side) - hullHalfW(along));
}`;
const VERT = `
${GERSTNER}
${TERRAIN}
${HULL}
uniform vec2 uOrigin;
varying vec3 vWorld; varying vec2 vGrid; varying float vH; varying float vDist; varying float vShoal;
void main(){
  vec2 g = position.xz + uOrigin;
  float dist = length(position.xz);
  vec3 T = vec3(1.0, 0.0, 0.0), B = vec3(0.0, 0.0, 1.0);
  vec3 d = gerstner(g, T, B, dist);
  // Waves die in the shallows so the sea never climbs onto the land.
  float shoal = shoalOf(terrainH(g));
  d *= mix(0.05, 1.0, shoal);
  // Calm water against the hull: crests ease toward the ship's waterline so none climbs over the gunwale.
  float near = 1.0 - smoothstep(1.0, 7.0, hullDist(g));
  d.y = mix(d.y, uShipY + (d.y - uShipY) * 0.3, near);
  vShoal = shoal;
  vec3 wp = vec3(g.x + d.x, d.y, g.y + d.z);
  vWorld = wp; vGrid = g; vH = d.y; vDist = dist;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const FRAG = `
${GERSTNER}
${TERRAIN}
uniform vec3 uSunDir, uSunColor, uDeep, uShallow, uSSS, uFoamColor, uFogColor, uZenith, uHorizon;
uniform float uFogDensity, uFlash, uStorm, uMaxAmp;
${HULL}
uniform float uBacklit;
varying vec3 vWorld; varying vec2 vGrid; varying float vH; varying float vDist; varying float vShoal;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm3(vec2 p){ float s = 0.0, a = 0.5; mat2 m = mat2(0.8, -0.6, 0.6, 0.8); for (int i = 0; i < 3; i++) { s += a * vn(p); p = m * p * 2.07 + 3.1; a *= 0.5; } return s / 0.875; }
vec3 skyCol(vec3 d){
  float h = max(d.y, 0.0);
  vec3 s = mix(uHorizon, uZenith, pow(h, 0.42));
  float sd = max(dot(d, uSunDir), 0.0);
  s += uSunColor * (pow(sd, 6.0) * 0.18 + pow(sd, 48.0) * 0.45) * (1.0 - uStorm * 0.8);
  return s;
}
void main(){
  vec3 T = vec3(1.0, 0.0, 0.0), B = vec3(0.0, 0.0, 1.0);
  gerstner(vGrid, T, B, vDist);
  vec3 N = normalize(cross(B, T));
  N = normalize(mix(vec3(0.0, 1.0, 0.0), N, mix(0.12, 1.0, vShoal)));
  float t = uTime;
  vec2 p = vWorld.xz;
  float rf = 1.0 - smoothstep(25.0, 260.0, vDist);
  vec2 r = vec2(0.0);
  r += vec2(0.8, 0.6) * cos(dot(p, vec2(0.8, 0.6)) * 1.7 + t * 2.1) * 0.06;
  r += vec2(-0.5, 0.85) * cos(dot(p, vec2(-0.5, 0.85)) * 2.9 + t * 2.9) * 0.045;
  r += vec2(0.95, -0.3) * cos(dot(p, vec2(0.95, -0.3)) * 4.6 + t * 3.8) * 0.03;
  float n1 = fbm3(mat2(0.8, -0.6, 0.6, 0.8) * p * 0.7 + t * 0.3), n2 = fbm3(mat2(0.6, 0.8, -0.8, 0.6) * p * 0.7 + vec2(5.2, 1.3) - t * 0.25);
  r += (vec2(n1, n2) - 0.5) * 0.14;
  N = normalize(N + vec3(r.x, 0.0, r.y) * rf * (1.0 + uStorm));

  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = uSunDir;
  float NdV = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);

  // Never draw sea inside the hull.
  if (hullDist(vWorld.xz) < -0.07) discard;
  float depth = vWorld.y - terrainH(vWorld.xz);
  if (depth < -0.05) discard;
  float shallowF = 1.0 - smoothstep(0.0, 10.0, depth);
  vec3 body = mix(uDeep, mix(uDeep, uShallow, 0.35), pow(1.0 - NdV, 2.0));
  body = mix(body, uShallow * 0.85, shallowF * 0.75);
  float crest = smoothstep(-0.2, uMaxAmp, vH);
  float sss = pow(clamp(dot(V, -normalize(L + N * 0.5)), 0.0, 1.0), 3.0) * (0.2 + crest * 1.5);
  body += uSSS * sss * (0.5 + 0.5 * clamp(L.y * 3.0, 0.0, 1.0));
  body *= 0.55 + 0.45 * max(dot(N, L), 0.0);

  vec3 R = reflect(-V, N); R.y = abs(R.y);
  vec3 col = mix(body, skyCol(R), fres);

  vec3 H = normalize(L + V); float nh = max(dot(N, H), 0.0);
  // Ship-relative masks: no glitter on the hull, slightly darker water behind it when backlit.
  vec2 shipRel = vWorld.xz - uShip.xy; vec2 shipFwd = vec2(sin(uShip.z), cos(uShip.z));
  float shipAlong = clamp(dot(shipRel, shipFwd), -12.0, 12.0);
  float shipDist = length(shipRel - shipFwd * shipAlong);
  float hullFade = uShip.w > -0.5 ? smoothstep(2.5, 9.0, shipDist) : 1.0;
  float spec = min(pow(nh, 900.0) * 10.0, 3.5) + pow(nh, 120.0) * 0.14;
  float glit = step(0.985, h21(floor(vWorld.xz * 9.0) + floor(t * 10.0))) * pow(nh, 140.0) * 3.5 * (1.0 - smoothstep(10.0, 140.0, vDist));
  col += min(uSunColor * (spec + glit), vec3(5.0)) * smoothstep(-0.05, 0.1, L.y) * (1.0 - uStorm * 0.85) * hullFade;
  col *= 1.0 - 0.28 * uBacklit * (1.0 - smoothstep(4.0, 34.0, shipDist));

  float fn = fbm3(vec2(vGrid.x * 0.31 + vGrid.y * 0.12, vGrid.y * 0.33 - vGrid.x * 0.1) + t * 0.12);
  float foam = smoothstep(0.72, 1.0, crest) * smoothstep(0.45, 0.8, fn) * (0.7 + uStorm);
  float shore = 1.0 - smoothstep(0.0, 0.45, depth);
  float bands = smoothstep(0.75, 1.0, sin(depth * 4.5 - t * 1.6) * 0.5 + 0.5) * (1.0 - smoothstep(0.2, 2.2, depth));
  foam = max(foam, clamp(shore + bands * 0.55, 0.0, 1.0) * smoothstep(0.3, 0.65, fn + 0.15));

  if (uShip.w > 0.05) {
    vec2 sd = vec2(sin(uShip.z), cos(uShip.z));
    vec2 rel = vWorld.xz - uShip.xy;
    float along = -dot(rel, sd) - 10.0;
    float side = dot(rel, vec2(sd.y, -sd.x));
    if (along > -14.0 && along < 170.0) {
      float spread = abs(side) - max(along, 0.0) * 0.36;
      float edge = exp(-spread * spread * 0.3) * smoothstep(-6.0, 6.0, along);
      float center = exp(-abs(side) / (1.4 + max(along, 0.0) * 0.07)) * smoothstep(-14.0, 0.0, along);
      float bow = exp(-abs(side) * 0.5) * (1.0 - smoothstep(-24.0, -12.0, along)) * step(along, -12.0);
      float fade = exp(-max(along, 0.0) / 60.0);
      float wn = smoothstep(0.3, 0.7, fbm3(vec2(side * 0.8, along * 0.22 - t * 0.4))) * 0.8 + 0.2;
      foam = max(foam, (edge * 0.75 + center * 0.9) * fade * wn * clamp(uShip.w / 5.0, 0.0, 1.0));
    }
  }
  vec3 foamCol = uFoamColor * (0.55 + 0.45 * max(dot(N, L), 0.0)) + uSunColor * 0.04;
  col = mix(col, foamCol, clamp(foam, 0.0, 1.0));
  col += uFlash * vec3(0.55, 0.6, 0.75) * (0.3 + fres);

  float dist = length(cameraPosition - vWorld);
  float f = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, clamp(f, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}`;

function polarGrid(rings, segs, radius) {
  const pos = [0, 0, 0];
  const k = 5.4;   // rings packed toward the camera: smooth wake foam close up, coarse at the horizon
  for (let i = 1; i <= rings; i++) {
    const r = radius * (Math.exp((i / rings) * k) - 1) / (Math.exp(k) - 1);
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  }
  const idx = [];
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let i = 0; i < rings - 1; i++) {
    const a0 = 1 + i * segs, b0 = 1 + (i + 1) * segs;
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs;
      idx.push(a0 + j, a0 + j1, b0 + j, a0 + j1, b0 + j1, b0 + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export class Ocean {
  constructor(atmosphere) {
    this.atm = atmosphere;
    this.steep = 0.62; this.len = 1;
    this.stormT = 0; this.storm = 0;
    this.waves = WAVES.map(([ang, q, L]) => ({ dx: Math.cos(ang), dz: Math.sin(ang), q, L }));
    const su = atmosphere.uniforms;
    this.uniforms = {
      uWaves: { value: this.waves.map((w) => new THREE.Vector4(w.dx, w.dz, w.q, w.L)) },
      uTime: { value: 0 }, uSteep: { value: this.steep }, uLen: { value: this.len }, uOrigin: { value: new THREE.Vector2() },
      uSunDir: su.sunDir, uSunColor: su.sunColor, uZenith: su.zenith, uHorizon: su.horizon,
      uDeep: { value: atmosphere.water.deep }, uShallow: { value: atmosphere.water.shallow }, uSSS: { value: atmosphere.water.sss },
      uFoamColor: { value: atmosphere.water.foam }, uFogColor: { value: atmosphere.scene.fog.color },
      uFogDensity: { value: 0.002 }, uFlash: su.flash, uStorm: { value: 0 }, uMaxAmp: { value: 1.5 },
      uHT0: { value: null }, uHT1: { value: null }, uHT2: { value: null }, uHT3: { value: null }, uHR: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 1, 0)) }, uShipY: { value: 0 }, uShip: { value: new THREE.Vector4(0, 0, 0, -1) }, uBacklit: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, fog: false });
    this.mesh = new THREE.Mesh(polarGrid(G.quality.oceanRings, G.quality.oceanSegs, 3200), mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = false;
    atmosphere.scene.add(this.mesh);
    this._d = new THREE.Vector3();
  }

  // Up to four islands: { tex, minX, minZ, size, height(x, z) }. height mirrors the texture on the CPU.
  setIslands(list) {
    const u = this.uniforms;
    for (let i = 0; i < 4; i++) {
      const it = list[i];
      u['uHT' + i].value = it ? it.tex : null;
      u.uHR.value[i].set(it ? it.minX : 0, it ? it.minZ : 0, it ? it.size : 1, it ? 1 : 0);
    }
    this.heightFns = list.filter((it) => it && it.height).map((it) => it.height);
  }
  setIsland(tex, minX, minZ, size, height) { this.setIslands([{ tex, minX, minZ, size, height }]); }
  terrainAt(x, z) { let h = -40; for (const f of this.heightFns || []) h = Math.max(h, f(x, z)); return h; }
  shoalAt(x, z) { const k = Math.min(1, Math.max(0, (this.terrainAt(x, z) + 7) / 6.6)); return 1 - k * k * (3 - 2 * k); }
  setStorm(target) { this.stormTarget = target; }

  // CPU twin of the GLSL gerstner() (without distance fade).
  displace(x, z, t, out) {
    let ox = 0, oy = 0, oz = 0;
    for (const w of this.waves) {
      const L = w.L * this.len, k = (Math.PI * 2) / L, c = Math.sqrt(9.8 / k);
      const Q = w.q * this.steep, a = Q / k;
      const f = k * (w.dx * x + w.dz * z - c * t);
      const cf = Math.cos(f);
      ox += w.dx * a * cf; oy += a * Math.sin(f); oz += w.dz * a * cf;
    }
    return out.set(ox, oy, oz);
  }
  heightAt(x, z, t = this.uniforms.uTime.value) {
    let px = x, pz = z;
    for (let i = 0; i < 3; i++) { this.displace(px, pz, t, this._d); px = x - this._d.x; pz = z - this._d.z; }
    return this.displace(px, pz, t, this._d).y * (0.05 + 0.95 * this.shoalAt(x, z));
  }

  update(time, dt, camera, ship) {
    if (this.stormTarget !== undefined) this.storm += (this.stormTarget - this.storm) * Math.min(1, dt * 0.35);
    const wrath = (G.state?.wrath || 0) / 10;
    const s = Math.max(this.storm, wrath * 0.35);
    this.steep = 0.6 + s * 0.42;
    this.len = 1 + s * 0.9;
    const u = this.uniforms;
    u.uTime.value = time;
    u.uSteep.value = this.steep;
    u.uLen.value = this.len;
    u.uStorm.value = this.storm;
    u.uMaxAmp.value = this.waves.reduce((a, w) => a + (w.q * w.L) / (Math.PI * 2), 0) * this.steep * this.len * 0.8;
    u.uFogDensity.value = this.atm.scene.fog.density;
    u.uOrigin.value.set(camera.position.x, camera.position.z);
    if (ship) { u.uShip.value.set(ship.x, ship.z, ship.yaw, ship.speed); u.uShipY.value = ship.waterY ?? 0; } else u.uShip.value.set(1e6, 1e6, 0, -1);
    u.uBacklit.value = G.post?.backlit || 0;
  }

  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}

// Buoyancy: sample bow/stern/port/starboard on the same wave function, then spring toward it.
export class Buoyancy {
  constructor(length = 22, beam = 4) { this.len = length; this.beam = beam; this.y = 0; this.vy = 0; this.pitch = 0; this.roll = 0; }
  update(ocean, x, z, yaw, dt, draft = 0.5) {
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const hl = this.len * 0.42, hb = this.beam * 0.5;
    const bow = ocean.heightAt(x + fx * hl, z + fz * hl), stern = ocean.heightAt(x - fx * hl, z - fz * hl);
    let port = 0, stbd = 0;
    for (const a of [-0.3, 0, 0.3]) { const ax = x + fx * hl * a, az = z + fz * hl * a; port += ocean.heightAt(ax + fz * hb * 1.6, az - fx * hb * 1.6) / 3; stbd += ocean.heightAt(ax - fz * hb * 1.6, az + fx * hb * 1.6) / 3; }
    const mid = ocean.heightAt(x, z);
    this.water = (bow + stern + port + stbd + mid * 2) / 6;
    const target = this.water - draft;
    this.vy += ((target - this.y) * 18 - this.vy * 5) * dt;
    this.y += this.vy * dt;
    // a long, heavy hull pitches and rolls gently: clamp the angles and let them settle slowly
    const tp = Math.max(-0.07, Math.min(0.07, Math.atan2(stern - bow, hl * 2))), tr = Math.max(-0.07, Math.min(0.07, Math.atan2(port - stbd, hb * 3.2) * 0.8));
    this.pitch += (tp - this.pitch) * Math.min(1, dt * 1.6);
    this.roll += (tr - this.roll) * Math.min(1, dt * 1.2);
  }
}
