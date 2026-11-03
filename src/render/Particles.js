import * as THREE from 'three';
import { G } from '../core/context.js';

// Pooled point particles (CPU sim, GPU draw). Two systems: additive (fire, sparks, magic) and alpha (smoke, dust, spray).
const PRESETS = {
  spray:  { add: false, life: [0.7, 1.3], size: [0.5, 1.2], grow: 1.8, speed: [1.5, 5], up: [2, 6], gravity: -9, drag: 0.6, color: [0.92, 0.96, 1], alpha: 0.5 },
  splash: { add: false, life: [0.9, 1.7], size: [0.8, 2.0], grow: 2.4, speed: [3, 9], up: [6, 13], gravity: -9.8, drag: 0.4, color: [0.92, 0.96, 1], alpha: 0.6 },
  ember:  { add: true,  life: [1.2, 2.8], size: [0.05, 0.12], grow: -0.4, speed: [0.2, 0.8], up: [0.8, 2.4], gravity: 0.4, drag: 0.3, color: [1, 0.5, 0.15], alpha: 1, turb: 1.6 },
  smoke:  { add: false, life: [2.5, 4.5], size: [0.8, 1.6], grow: 2.4, speed: [0.2, 0.6], up: [0.8, 1.6], gravity: 0.1, drag: 0.4, color: [0.2, 0.18, 0.17], alpha: 0.3, turb: 0.4 },
  dust:   { add: false, life: [0.8, 1.8], size: [0.4, 1.0], grow: 2.6, speed: [1, 4], up: [0.2, 1.2], gravity: -0.4, drag: 2.2, color: [0.52, 0.45, 0.36], alpha: 0.3 },
  spark:  { add: true,  life: [0.15, 0.45], size: [0.05, 0.11], grow: -0.5, speed: [4, 10], up: [1, 4], gravity: -12, drag: 1, color: [1, 0.82, 0.42], alpha: 1 },
  hit:    { add: true,  life: [0.1, 0.22], size: [0.5, 1.0], grow: 3, speed: [0, 1], up: [0, 0.5], gravity: 0, drag: 1, color: [1, 0.95, 0.8], alpha: 0.9 },
  magic:  { add: true,  life: [1.5, 3], size: [0.08, 0.2], grow: 0, speed: [0.2, 0.8], up: [0.4, 1.2], gravity: 0.2, drag: 0.2, color: [1, 0.9, 0.6], alpha: 1, turb: 2 },
  breath: { add: false, life: [1, 2], size: [0.4, 0.8], grow: 1.6, speed: [0.5, 1.5], up: [-0.1, 0.3], gravity: 0, drag: 1.2, color: [0.45, 0.4, 0.35], alpha: 0.22 },
  wisp:   { add: false, life: [2, 3.5], size: [0.3, 0.6], grow: 2.5, speed: [0.1, 0.3], up: [0.6, 1.2], gravity: 0.2, drag: 0.5, color: [0.35, 0.33, 0.32], alpha: 0.35, turb: 0.8 },
  mote:   { add: true,  life: [4, 8], size: [0.03, 0.07], grow: 0, speed: [0.05, 0.2], up: [-0.05, 0.1], gravity: 0, drag: 0.1, color: [0.9, 0.95, 1], alpha: 0.6, turb: 0.3 },
};

const VERT = `
attribute vec4 aColor; attribute float aSize; uniform float uScale; varying vec4 vColor;
void main(){ vColor = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uScale / max(-mv.z, 0.1); gl_Position = projectionMatrix * mv; }`;
const FRAG = `
varying vec4 vColor;
void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); float a = 1.0 - smoothstep(0.0, 0.5, d); a *= a; gl_FragColor = vec4(vColor.rgb, vColor.a * a); }`;

function makeSystem(add, cap) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(cap * 3), col = new Float32Array(cap * 4), size = new Float32Array(cap);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setDrawRange(0, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 600 } }, vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = add ? 11 : 10;
  return {
    pts, geo, mat, pos, col, size, cap, n: 0,
    vel: new Float32Array(cap * 3), life: new Float32Array(cap), maxLife: new Float32Array(cap), s0: new Float32Array(cap),
    grow: new Float32Array(cap), drag: new Float32Array(cap), grav: new Float32Array(cap), turb: new Float32Array(cap),
    a0: new Float32Array(cap), rgb: new Float32Array(cap * 3),
  };
}

const R = (a) => a[0] + Math.random() * (a[1] - a[0]);

export class Particles {
  constructor(cap = 2500) {
    this.group = new THREE.Group();
    this.add = makeSystem(true, cap);
    this.alpha = makeSystem(false, cap);
    this.group.add(this.add.pts, this.alpha.pts);
    // Fixed pool of flash lights (constant light count avoids shader recompiles).
    this.flashes = [];
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xffd8a0, 0, 14, 2);
      l.userData.t = 0;
      this.group.add(l);
      this.flashes.push(l);
    }
    this._fi = 0;
  }

  emit(type, p, count = 10, o = {}) {
    const P = PRESETS[type];
    if (!P) return;
    const s = (o.add ?? P.add) ? this.add : this.alpha;
    const n = Math.max(1, Math.round(count * (G.quality?.particles ?? 1)));
    const spread = o.spread ?? 0.3;
    for (let k = 0; k < n; k++) {
      if (s.n >= s.cap) return;
      const i = s.n++;
      const ang = Math.random() * Math.PI * 2;
      const sp = R(o.speed || P.speed);
      s.pos[i * 3] = p.x + (Math.random() - 0.5) * spread;
      s.pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * spread * 0.5;
      s.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * spread;
      let vx = Math.cos(ang) * sp, vy = R(o.up || P.up), vz = Math.sin(ang) * sp;
      if (o.dir) { vx = vx * 0.35 + o.dir.x * sp; vy += o.dir.y * sp; vz = vz * 0.35 + o.dir.z * sp; }
      s.vel[i * 3] = vx; s.vel[i * 3 + 1] = vy; s.vel[i * 3 + 2] = vz;
      s.life[i] = s.maxLife[i] = R(o.life || P.life);
      s.s0[i] = R(o.size || P.size) * (o.scale || 1);
      s.grow[i] = o.grow ?? P.grow;
      s.drag[i] = P.drag;
      s.grav[i] = o.gravity ?? P.gravity;
      s.turb[i] = P.turb || 0;
      s.a0[i] = o.alpha ?? P.alpha;
      const c = o.color || P.color;
      const jit = 0.92 + Math.random() * 0.16;
      s.rgb[i * 3] = c[0] * jit; s.rgb[i * 3 + 1] = c[1] * jit; s.rgb[i * 3 + 2] = c[2] * jit;
    }
  }

  flash(p, color = 0xffd8a0, intensity = 30, dur = 0.12) {
    if (G.settings?.reduceFlashing) intensity *= 0.3;
    const l = this.flashes[this._fi++ % this.flashes.length];
    l.position.copy(p); l.color.set(color); l.userData.peak = intensity; l.userData.t = dur; l.userData.dur = dur;
  }

  _step(s, dt) {
    for (let i = 0; i < s.n; i++) {
      s.life[i] -= dt;
      if (s.life[i] <= 0) { this._kill(s, i); i--; continue; }
      const i3 = i * 3;
      const dk = Math.exp(-s.drag[i] * dt);
      s.vel[i3] *= dk; s.vel[i3 + 1] = s.vel[i3 + 1] * dk + s.grav[i] * dt; s.vel[i3 + 2] *= dk;
      if (s.turb[i]) { s.vel[i3] += (Math.random() - 0.5) * s.turb[i] * dt * 6; s.vel[i3 + 2] += (Math.random() - 0.5) * s.turb[i] * dt * 6; }
      s.pos[i3] += s.vel[i3] * dt; s.pos[i3 + 1] += s.vel[i3 + 1] * dt; s.pos[i3 + 2] += s.vel[i3 + 2] * dt;
      const t = 1 - s.life[i] / s.maxLife[i];
      s.size[i] = Math.max(0, s.s0[i] * (1 + s.grow[i] * t));
      const fade = Math.min(1, t * 10) * (1 - t * t);
      s.col[i * 4] = s.rgb[i3]; s.col[i * 4 + 1] = s.rgb[i3 + 1]; s.col[i * 4 + 2] = s.rgb[i3 + 2]; s.col[i * 4 + 3] = s.a0[i] * fade;
    }
    s.geo.attributes.position.needsUpdate = true;
    s.geo.attributes.aColor.needsUpdate = true;
    s.geo.attributes.aSize.needsUpdate = true;
    s.geo.setDrawRange(0, s.n);
  }

  _kill(s, i) {
    const j = --s.n;
    if (i === j) return;
    for (const k of [0, 1, 2]) { s.pos[i * 3 + k] = s.pos[j * 3 + k]; s.vel[i * 3 + k] = s.vel[j * 3 + k]; s.rgb[i * 3 + k] = s.rgb[j * 3 + k]; }
    for (const k of [0, 1, 2, 3]) s.col[i * 4 + k] = s.col[j * 4 + k];
    s.size[i] = s.size[j]; s.life[i] = s.life[j]; s.maxLife[i] = s.maxLife[j]; s.s0[i] = s.s0[j]; s.grow[i] = s.grow[j];
    s.drag[i] = s.drag[j]; s.grav[i] = s.grav[j]; s.turb[i] = s.turb[j]; s.a0[i] = s.a0[j];
  }

  update(dt, camera) {
    const scale = (G.renderer.domElement.height) / (2 * Math.tan((camera.fov * Math.PI) / 360));
    this.add.mat.uniforms.uScale.value = scale;
    this.alpha.mat.uniforms.uScale.value = scale;
    this._step(this.add, dt);
    this._step(this.alpha, dt);
    for (const l of this.flashes) {
      if (l.userData.t > 0) { l.userData.t -= dt; l.intensity = l.userData.peak * Math.max(0, l.userData.t / l.userData.dur); }
      else l.intensity = 0;
    }
  }
}

// Rain streaks around the camera.
export class Rain {
  constructor(count = 2500) {
    this.count = count;
    const pos = new Float32Array(count * 6);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.LineSegments(this.geo, new THREE.LineBasicMaterial({ color: 0xc8d4e0, transparent: true, opacity: 0, depthWrite: false, fog: true }));
    this.mesh.frustumCulled = false;
    this.drops = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { this.drops[i * 3] = (Math.random() - 0.5) * 60; this.drops[i * 3 + 1] = Math.random() * 30; this.drops[i * 3 + 2] = (Math.random() - 0.5) * 60; }
    this.intensity = 0; this.target = 0;
  }
  update(dt, cam) {
    this.intensity += (this.target - this.intensity) * Math.min(1, dt * 0.6);
    this.mesh.material.opacity = 0.35 * this.intensity;
    this.mesh.visible = this.intensity > 0.01;
    if (!this.mesh.visible) return;
    const p = this.geo.attributes.position.array;
    const n = Math.floor(this.count * Math.min(1, this.intensity * 1.2));
    for (let i = 0; i < this.count; i++) {
      const d = this.drops;
      d[i * 3 + 1] -= 32 * dt;
      if (d[i * 3 + 1] < -2) { d[i * 3 + 1] += 32; d[i * 3] = (Math.random() - 0.5) * 60; d[i * 3 + 2] = (Math.random() - 0.5) * 60; }
      const x = cam.position.x + d[i * 3], y = cam.position.y + d[i * 3 + 1] - 10, z = cam.position.z + d[i * 3 + 2];
      const on = i < n ? 1 : 0;
      p[i * 6] = x; p[i * 6 + 1] = y; p[i * 6 + 2] = z;
      p[i * 6 + 3] = x + 0.25 * on; p[i * 6 + 4] = y + 0.9 * on; p[i * 6 + 5] = z + 0.1 * on;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

// Additive ribbon that follows two points (weapon edge, arrow).
export class Trail {
  constructor(n = 14, color = 0xffe2b0, opacity = 0.7) {
    this.n = n;
    this.pts = [];
    const pos = new Float32Array(n * 2 * 3), alpha = new Float32Array(n * 2), idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
      vertexShader: `attribute float aAlpha; varying float vA; void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vA; void main(){ gl_FragColor = vec4(uColor * 2.0, vA * vA * uOpacity); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.active = false;
    this.strength = 0;
  }
  push(a, b) {
    this.pts.unshift([a.clone(), b.clone()]);
    if (this.pts.length > this.n) this.pts.pop();
  }
  update(dt, a, b) {
    this.strength += ((this.active ? 1 : 0) - this.strength) * Math.min(1, dt * (this.active ? 30 : 8));
    if (a && b) this.push(a, b);
    const p = this.geo.attributes.position.array, al = this.geo.attributes.aAlpha.array;
    const m = this.pts.length;
    for (let i = 0; i < this.n; i++) {
      const s = this.pts[Math.min(i, m - 1)];
      if (!s) continue;
      p[i * 6] = s[0].x; p[i * 6 + 1] = s[0].y; p[i * 6 + 2] = s[0].z;
      p[i * 6 + 3] = s[1].x; p[i * 6 + 4] = s[1].y; p[i * 6 + 5] = s[1].z;
      const f = (1 - i / this.n) * this.strength;
      al[i * 2] = f * 0.2; al[i * 2 + 1] = f;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.mesh.visible = this.strength > 0.01;
  }
}
