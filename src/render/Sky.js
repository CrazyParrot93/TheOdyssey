import * as THREE from 'three';
import { G } from '../core/context.js';
import { SKIES } from '../data/chapters.js';
import { RIM } from '../assets/Assets.js';

const deg = Math.PI / 180;
export function sunDirFrom(elev, az) {
  const e = elev * deg, a = az * deg;
  return new THREE.Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)).normalize();
}

const SKY_VERT = `
varying vec3 vDir;
void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const SKY_FRAG = `
uniform vec3 sunDir, zenith, horizon, ground, sunColor, cloudColor, cloudShadow;
uniform float time, cloudCover, flash, stars, storm;
varying vec3 vDir;
float h21(vec2 p){ p = fract(p * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; mat2 m = mat2(0.8, -0.6, 0.6, 0.8); for (int i = 0; i < 5; i++) { s += a * vn(p); p = m * p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 sky = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.42));
  sky = mix(sky, ground, 1.0 - smoothstep(-0.12, 0.0, h));
  float sd = max(dot(d, sunDir), 0.0);
  sky += sunColor * (pow(sd, 8.0) * 0.1 + pow(sd, 64.0) * 0.32) * (1.0 - storm * 0.8);
  sky += sunColor * 0.12 * pow(sd, 3.0) * exp(-abs(h) * 7.0);
  float disc = smoothstep(0.99935, 0.99965, sd);
  sky += min(sunColor * disc * 2.0, vec3(5.0)) * (1.0 - storm);
  if (stars > 0.0 && h > 0.0) {
    vec2 sp = d.xz / (h + 0.3) * 120.0;
    float st = step(0.997, h21(floor(sp))) * (0.5 + 0.5 * sin(time * 2.0 + h21(floor(sp) + 3.0) * 30.0));
    sky += vec3(st) * stars * smoothstep(0.0, 0.3, h);
  }
  if (h > -0.02) {
    vec2 cuv = d.xz / (max(h, 0.0) + 0.14) * 0.55 + vec2(time * 0.006, time * 0.002);
    float n = fbm(cuv * 1.25);
    float cov = cloudCover;
    float c = smoothstep(1.0 - cov, 1.0 - cov + 0.32, n);
    float n2 = fbm(cuv * 1.25 + sunDir.xz * 0.06);
    float lit = clamp((n - n2) * 3.0 + 0.55, 0.0, 1.0);
    vec3 cc = mix(cloudShadow, cloudColor, lit);
    cc += sunColor * pow(sd, 6.0) * 0.32 * (1.0 - c * 0.7);
    c *= smoothstep(-0.02, 0.12, h);
    sky = mix(sky, cc, c * 0.95);
  }
  sky += flash * vec3(0.75, 0.8, 1.0) * (0.6 + 0.4 * max(h, 0.0));
  gl_FragColor = vec4(min(sky, vec3(9.0)), 1.0);
}`;

// Sky dome + sun light + hemisphere fill + fog, all blended between palette presets.
export class Atmosphere {
  constructor(scene, presetName = 'sunset') {
    this.scene = scene;
    this.uniforms = {
      sunDir: { value: new THREE.Vector3(0, 0.1, -1) }, zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() },
      ground: { value: new THREE.Color() }, sunColor: { value: new THREE.Color() }, cloudColor: { value: new THREE.Color() },
      cloudShadow: { value: new THREE.Color() }, time: { value: 0 }, cloudCover: { value: 0.4 }, flash: { value: 0 },
      stars: { value: 0 }, storm: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.castShadow = !!G.quality.shadows;
    const s = this.sun.shadow;
    s.mapSize.set(G.quality.shadowSize, G.quality.shadowSize);
    s.camera.near = 1; s.camera.far = 260;
    this.shadowExtent = 34;
    s.camera.left = -this.shadowExtent; s.camera.right = this.shadowExtent; s.camera.top = this.shadowExtent; s.camera.bottom = -this.shadowExtent;
    s.bias = -0.0004; s.normalBias = 0.04; s.radius = 3;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    scene.add(this.hemi);
    // Sun-opposite fill: keeps the near side of backlit subjects readable.
    this.fill = new THREE.DirectionalLight(0xffffff, 0);
    scene.add(this.fill, this.fill.target);
    scene.fog = new THREE.FogExp2(0xffffff, 0.002);

    this.water = { deep: new THREE.Color(), shallow: new THREE.Color(), sss: new THREE.Color(), foam: new THREE.Color() };
    this.cur = this._resolve(SKIES[presetName]);
    this.from = this.cur; this.to = this.cur; this.t = 1; this.dur = 1;
    this.lightning = 0;
    this.lightMul = 1;
    this._apply(this.cur);
  }

  _resolve(p) {
    const c = (h) => new THREE.Color(h);
    return {
      sunDir: sunDirFrom(p.sunElev, p.sunAz), zenith: c(p.zenith), horizon: c(p.horizon), ground: c(p.ground),
      sunColor: c(p.sunColor).multiplyScalar(p.sunInt), cloudColor: c(p.cloudColor), cloudShadow: c(p.cloudShadow),
      cloud: p.cloud, fog: c(p.fog), fogDensity: p.fogDensity, light: c(p.light), lightI: p.lightI,
      hemiSky: c(p.hemiSky), hemiGround: c(p.hemiGround), hemiI: p.hemiI,
      deep: c(p.deep), shallow: c(p.shallow), sss: c(p.sss), foam: c(p.foam), stars: p.stars || 0, storm: p.storm || 0, exposure: p.exposure ?? 1,
    };
  }

  setPreset(name, seconds = 0) {
    const p = typeof name === 'string' ? SKIES[name] : name;
    this.from = this._snapshot();
    this.to = this._resolve(p);
    this.t = seconds > 0 ? 0 : 1;
    this.dur = Math.max(0.001, seconds);
    if (seconds <= 0) { this.cur = this.to; this._apply(this.cur); }
  }

  _snapshot() {
    const o = {};
    for (const [k, v] of Object.entries(this.cur)) o[k] = v && v.clone ? v.clone() : v;
    return o;
  }

  _blend(a, b, t) {
    const o = {};
    for (const k of Object.keys(b)) {
      const va = a[k], vb = b[k];
      if (vb && vb.isColor) o[k] = va.clone().lerp(vb, t);
      else if (vb && vb.isVector3) o[k] = va.clone().lerp(vb, t).normalize();
      else o[k] = va + (vb - va) * t;
    }
    return o;
  }

  _apply(c) {
    const u = this.uniforms;
    u.sunDir.value.copy(c.sunDir); u.zenith.value.copy(c.zenith); u.horizon.value.copy(c.horizon); u.ground.value.copy(c.ground);
    u.sunColor.value.copy(c.sunColor); u.cloudColor.value.copy(c.cloudColor); u.cloudShadow.value.copy(c.cloudShadow);
    u.cloudCover.value = c.cloud; u.stars.value = c.stars; u.storm.value = c.storm;
    this.scene.fog.color.copy(c.fog);
    this.scene.fog.density = c.fogDensity;
    this.sun.color.copy(c.light);
    this.hemi.color.copy(c.hemiSky); this.hemi.groundColor.copy(c.hemiGround);
    this.water.deep.copy(c.deep); this.water.shallow.copy(c.shallow); this.water.sss.copy(c.sss); this.water.foam.copy(c.foam);
    if (G.post) G.post.sunDir.copy(c.sunDir);
  }

  flash(amount = 1) { const k = G.settings?.reduceFlashing ? 0.25 : 1; this.lightning = Math.max(this.lightning, amount * k); }

  update(dt, focus, camera) {
    this.uniforms.time.value += dt;
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / this.dur);
      const k = this.t * this.t * (3 - 2 * this.t);
      this.cur = this._blend(this.from, this.to, k);
      this._apply(this.cur);
    }
    this.lightning = Math.max(0, this.lightning - dt * 3.5);
    this.uniforms.flash.value = this.lightning;
    this.sun.intensity = this.cur.lightI * this.lightMul + this.lightning * 4;
    this.hemi.intensity = this.cur.hemiI * this.lightMul + this.lightning * 2;
    const back = G.post ? G.post.backlit : 0;
    if (G.post) { G.post.outdoor = true; G.post.skyExposure = this.cur.exposure ?? 1; }
    this.fill.color.copy(this.cur.hemiSky).lerp(this.cur.light, 0.35);
    this.fill.intensity = this.cur.lightI * (0.1 + 0.6 * back) * this.lightMul;
    RIM.color.value.copy(this.cur.light);
    RIM.strength.value = (0.04 + 0.4 * back) * Math.min(1.2, this.cur.lightI / 3);
    if (camera) this.mesh.position.copy(camera.position);
    if (focus) {
      // Shadow frustum follows the focus, snapped to texels so shadows don't shimmer.
      const texel = (this.shadowExtent * 2) / G.quality.shadowSize;
      const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
      this.sun.target.position.set(fx, focus.y, fz);
      this.sun.position.set(fx, focus.y, fz).addScaledVector(this.cur.sunDir.y < 0.15 ? _low.copy(this.cur.sunDir).setY(0.25).normalize() : this.cur.sunDir, 120);
      this.fill.target.position.set(fx, focus.y, fz);
      this.fill.position.set(fx - this.cur.sunDir.x * 100, focus.y + 40, fz - this.cur.sunDir.z * 100);
    }
  }

  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
const _low = new THREE.Vector3();

// Image-based lighting from the live sky, so bronze and wet stone reflect the real sky.
export function bakeSkyEnv(renderer, atm) {
  const pm = new THREE.PMREMGenerator(renderer);
  const sc = new THREE.Scene();
  sc.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), atm.mesh.material));
  const rt = pm.fromScene(sc, 0.02, 0.1, 1000);
  pm.dispose();
  return rt.texture;
}
export function bakeGradientEnv(renderer, top, mid, bottom) {
  const pm = new THREE.PMREMGenerator(renderer);
  const sc = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { t: { value: new THREE.Color(top) }, m: { value: new THREE.Color(mid) }, b: { value: new THREE.Color(bottom) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 t, m, b; varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 c = h > 0.0 ? mix(m, t, h) : mix(m, b, -h); gl_FragColor = vec4(c, 1.0); }',
  });
  sc.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), mat));
  const rt = pm.fromScene(sc, 0.04, 0.1, 1000);
  pm.dispose();
  return rt.texture;
}
