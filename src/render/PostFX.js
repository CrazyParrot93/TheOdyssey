import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { G } from '../core/context.js';
import { GRADES } from '../data/chapters.js';

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// Firefly clamp: isolated super-bright specular pixels would otherwise bloom into squares.
const ClampShader = { uniforms: { tDiffuse: { value: null }, uMax: { value: 6.0 } }, vertexShader: VERT,
  fragmentShader: 'uniform sampler2D tDiffuse; uniform float uMax; varying vec2 vUv; void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; float m = max(c.r, max(c.g, c.b)); if (m > uMax) c *= uMax / m; gl_FragColor = vec4(c, 1.0); }' };

// HDR lens pass: god rays, radial blur, chromatic aberration, dream wobble, heat haze.
const LensShader = {
  defines: { GR: 24 },
  uniforms: {
    tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uGod: { value: 0 },
    uGodColor: { value: new THREE.Color(1, 0.85, 0.62) }, uCA: { value: 0 }, uRadial: { value: 0 },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) }, uDream: { value: 0 }, uHeat: { value: 0 }, uTime: { value: 0 },
  },
  vertexShader: VERT,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uSun, uCenter; uniform float uGod, uCA, uRadial, uDream, uHeat, uTime; uniform vec3 uGodColor;
    varying vec2 vUv;
    void main(){
      vec2 uv = vUv;
      if (uDream > 0.001) uv += uDream * 0.006 * vec2(sin(uv.y * 14.0 + uTime * 1.3), cos(uv.x * 11.0 + uTime * 1.1));
      if (uHeat > 0.001) uv += uHeat * 0.0035 * vec2(sin(uv.y * 70.0 + uTime * 9.0), cos(uv.x * 55.0 + uTime * 7.0));
      vec2 dir = uv - uCenter;
      vec3 col;
      if (uRadial > 0.001) {
        col = vec3(0.0);
        for (int i = 0; i < 10; i++) { float s = 1.0 - uRadial * 0.09 * float(i) / 9.0; col += texture2D(tDiffuse, uCenter + dir * s).rgb; }
        col /= 10.0;
      } else col = texture2D(tDiffuse, uv).rgb;
      if (uCA > 0.001) {
        vec2 o = dir * uCA * 0.014;
        col.r = texture2D(tDiffuse, uv + o).r;
        col.b = texture2D(tDiffuse, uv - o).b;
      }
      if (uGod > 0.001) {
        vec2 d = (uSun - uv) * (0.92 / float(GR));
        vec2 s = uv; float decay = 1.0; vec3 acc = vec3(0.0);
        for (int i = 0; i < GR; i++) {
          s += d;
          vec3 c = texture2D(tDiffuse, clamp(s, 0.0, 1.0)).rgb;
          float l = max(dot(c, vec3(0.3, 0.59, 0.11)) - 1.8, 0.0);
          acc += c * l * decay; decay *= 0.955;
        }
        float centerMask = smoothstep(0.12, 0.42, length((vUv - 0.5) * vec2(1.6, 1.0)));
        float near = exp(-length((vUv - uSun) * vec2(1.6, 1.0)) * 2.2);
        col += min(acc * uGodColor * uGod * (2.2 / float(GR)) * centerMask * near, vec3(0.6));
      }
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// Display-space grade: lift/gamma/gain, saturation, contrast, vignette, grain, flash, colorblind matrix.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uLift: { value: new THREE.Vector3() }, uGamma: { value: new THREE.Vector3(1, 1, 1) },
    uGain: { value: new THREE.Vector3(1, 1, 1) }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uSat: { value: 1 },
    uContrast: { value: 1 }, uVignette: { value: 0.3 }, uVigColor: { value: new THREE.Color(0, 0, 0) }, uGrain: { value: 0.03 },
    uTime: { value: 0 }, uFlash: { value: 0 }, uFlashColor: { value: new THREE.Color(1, 1, 1) }, uExposure: { value: 1 },
    uEdgeBlur: { value: 0 }, uCB: { value: new THREE.Matrix3() }, uRes: { value: new THREE.Vector2(1920, 1080) }, uSharpen: { value: 0.25 },
  },
  vertexShader: VERT,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec3 uLift, uGamma, uGain, uTint, uVigColor, uFlashColor;
    uniform float uSat, uContrast, uVignette, uGrain, uTime, uFlash, uExposure, uEdgeBlur, uSharpen; uniform mat3 uCB; uniform vec2 uRes;
    varying vec2 vUv;
    float rnd(vec2 c){ return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      if (uSharpen > 0.001) {
        vec2 px = 1.0 / uRes;
        vec3 n = texture2D(tDiffuse, vUv + vec2(px.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(px.x, 0.0)).rgb + texture2D(tDiffuse, vUv + vec2(0.0, px.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, px.y)).rgb;
        c = max(c + (c - n * 0.25) * uSharpen, 0.0);
      }
      if (uEdgeBlur > 0.001) {
        float e = smoothstep(0.2, 0.75, length(vUv - 0.5) * 1.4) * uEdgeBlur;
        vec2 px = 6.0 / uRes * e;
        vec3 b = texture2D(tDiffuse, vUv + vec2(px.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(px.x, 0.0)).rgb
               + texture2D(tDiffuse, vUv + vec2(0.0, px.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, px.y)).rgb;
        c = mix(c, b * 0.25, clamp(e * 2.0, 0.0, 1.0));
      }
      c *= uExposure;
      c = uGain * (c + uLift * (1.0 - c));
      c = pow(max(c, 0.0), 1.0 / uGamma);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);
      c = (c - 0.5) * uContrast + 0.5;
      c *= uTint;
      vec2 q = vUv - 0.5;
      float v = 1.0 - smoothstep(0.25, 0.9, length(q * vec2(1.0, 0.8)) * 1.3);
      c = mix(uVigColor, c, mix(1.0, v, uVignette));
      c = uCB * c;
      c += (rnd(vUv * uRes + fract(uTime) * 91.0) - 0.5) * uGrain;
      c = mix(c, uFlashColor, clamp(uFlash, 0.0, 1.0));
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

// Daltonization: C = I + E (I - S). Simulation matrices after Machado et al. (severity 1).
const SIM = {
  protanopia:   [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia:   [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};
function daltonize(type) {
  const m = new THREE.Matrix3();
  const s = SIM[type];
  if (!s) return m.identity();
  const S = new THREE.Matrix3().set(...s);
  const I = new THREE.Matrix3();
  const diff = I.clone();
  for (let i = 0; i < 9; i++) diff.elements[i] = I.elements[i] - S.elements[i];
  const E = type === 'tritanopia' ? new THREE.Matrix3().set(1, 0, 0.7, 0, 1, 0.7, 0, 0, 0) : new THREE.Matrix3().set(0, 0, 0, 0.7, 1, 0, 0.7, 0, 1);
  const ed = E.multiply(diff);
  for (let i = 0; i < 9; i++) m.elements[i] = I.elements[i] + ed.elements[i];
  return m;
}

const GRADE_KEYS = ['lift', 'gamma', 'gain', 'tint'];
function cloneGrade(g) { return JSON.parse(JSON.stringify(g)); }

export class PostFX {
  constructor(renderer, camera, quality) {
    this.renderer = renderer;
    this.camera = camera;
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(new THREE.Scene(), camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.5, 0.5, 0.88);
    this.gtao = null;
    try { this.gtao = new GTAOPass(new THREE.Scene(), camera, innerWidth, innerHeight); this.gtao.blendIntensity = 0.85; this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1.1 }); } catch (e) { console.warn('GTAO unavailable', e); }
    this.smaa = new SMAAPass(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio());
    this.lens = new ShaderPass(LensShader);
    this.output = new OutputPass();
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.renderPass);
    if (this.gtao) this.composer.addPass(this.gtao);
    this.clamp = new ShaderPass(ClampShader);
    this.composer.addPass(this.clamp);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.lens);
    this.composer.addPass(this.output);
    this.composer.addPass(this.grade);
    this.composer.addPass(this.smaa);

    this.cur = cloneGrade(GRADES.neutral);
    this.from = cloneGrade(GRADES.neutral);
    this.to = cloneGrade(GRADES.neutral);
    this.gradeT = 1; this.gradeDur = 1;
    this.imp = { ca: 0, radial: 0, flash: 0, hurt: 0 };
    this.base = { bloom: 0.55, god: 0, dream: 0, heat: 0, edgeBlur: 0, exposure: 1, ca: 0, vignetteAdd: 0, satMul: 1 };
    // Glare control: eye adaptation when looking into the sun.
    this.outdoor = false; this.adapt = 1; this.backlit = 0; this.skyExposure = 1; this.lowHealth = 0;
    this.sunDir = new THREE.Vector3(0, 0.2, -1);
    this.radialCenter = new THREE.Vector2(0.5, 0.5);
    this.time = 0;
    this.applyQuality(quality);
    this.setColorblind(G.settings?.colorblind || 'none');
  }

  applyQuality(q) {
    this.quality = q;
    this.bloom.enabled = q.bloom;
    this.godEnabled = q.godRays;
    if (this.gtao) this.gtao.enabled = !!q.ao;
    this.smaa.enabled = !!q.smaa;
    this.grade.uniforms.uSharpen.value = q.name === 'Low' ? 0 : 0.22;
  }
  setColorblind(type) { this.grade.uniforms.uCB.value.copy(daltonize(type)); }
  setScene(scene) { this.renderPass.scene = scene; if (this.gtao) this.gtao.scene = scene; }

  setGrade(name, seconds = 2) {
    const g = typeof name === 'string' ? GRADES[name] : name;
    if (!g) return;
    this.from = cloneGrade(this.cur);
    this.to = cloneGrade(g);
    this.gradeT = 0;
    this.gradeDur = Math.max(0.001, seconds);
  }

  // Impulses that decay on their own: chromatic aberration, radial blur, screen flash.
  kick({ ca = 0, radial = 0, flash = 0, color = null, center = null } = {}) {
    const motion = G.settings?.reduceMotion ? 0.25 : 1;
    const flashK = G.settings?.reduceFlashing ? 0.2 : 1;
    this.imp.ca = Math.max(this.imp.ca, ca * motion);
    this.imp.radial = Math.max(this.imp.radial, radial * motion);
    if (flash > 0) { this.imp.flash = Math.max(this.imp.flash, flash * flashK); this.grade.uniforms.uFlashColor.value.set(color || 0xffffff); }
    if (center) this.radialCenter.copy(center); else this.radialCenter.set(0.5, 0.5);
  }
  hurt(amount) { this.imp.hurt = Math.min(1, this.imp.hurt + amount); }

  resize(w, h) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    if (this.gtao) this.gtao.setSize(w * this.renderer.getPixelRatio(), h * this.renderer.getPixelRatio());
    this.bloom.resolution.set(w / 2, h / 2);
    this.grade.uniforms.uRes.value.set(w, h);
  }

  render(realDt) {
    this.time += realDt;
    if (this.gradeT < 1) {
      this.gradeT = Math.min(1, this.gradeT + realDt / this.gradeDur);
      const t = this.gradeT * this.gradeT * (3 - 2 * this.gradeT);
      for (const k of GRADE_KEYS) for (let i = 0; i < 3; i++) this.cur[k][i] = this.from[k][i] + (this.to[k][i] - this.from[k][i]) * t;
      for (const k of ['sat', 'contrast', 'vignette', 'grain', 'exposure']) this.cur[k] = this.from[k] + (this.to[k] - this.from[k]) * t;
    }
    const decay = (v, r) => Math.max(0, v - realDt * r);
    this.imp.ca = decay(this.imp.ca, 2.2);
    this.imp.radial = decay(this.imp.radial, 2.5);
    this.imp.flash = decay(this.imp.flash, 1.8);
    this.imp.hurt = decay(this.imp.hurt, 0.9);

    const gu = this.grade.uniforms, c = this.cur;
    gu.uLift.value.fromArray(c.lift); gu.uGamma.value.fromArray(c.gamma); gu.uGain.value.fromArray(c.gain); gu.uTint.value.fromArray(c.tint);
    gu.uSat.value = c.sat * this.base.satMul;
    gu.uContrast.value = c.contrast;
    gu.uVignette.value = Math.min(1, c.vignette + this.base.vignetteAdd + this.imp.hurt * 0.6);
    gu.uVigColor.value.setRGB(0.25 * this.imp.hurt, 0, 0);
    gu.uGrain.value = c.grain;
    // Glare-aware exposure: facing the sun smoothly lowers exposure by up to ~30% (never snaps).
    const camDir = this.camera.getWorldDirection(_v);
    const sunUp = smoothstepJS(-0.05, 0.08, this.sunDir.y);
    const facing = camDir.dot(this.sunDir);
    const glare = G.settings?.glare ?? 1;
    const back = this.outdoor ? smoothstepJS(0.4, 0.92, facing) * sunUp : 0;
    this.backlit += (back - this.backlit) * Math.min(1, realDt * 3);
    const targetAdapt = 1 - 0.28 * this.backlit * Math.min(1.3, 0.5 + glare * 0.5);
    this.adapt += (targetAdapt - this.adapt) * Math.min(1, realDt / 0.75);
    gu.uExposure.value = c.exposure * this.base.exposure * this.adapt * this.skyExposure;
    if (this.lowHealth > 0) gu.uSat.value *= 1 - 0.55 * this.lowHealth;
    gu.uFlash.value = this.imp.flash;
    gu.uEdgeBlur.value = this.base.edgeBlur;
    gu.uTime.value = this.time;

    const lu = this.lens.uniforms;
    lu.uCA.value = this.base.ca + this.imp.ca;
    lu.uRadial.value = this.imp.radial;
    lu.uCenter.value.copy(this.radialCenter);
    lu.uDream.value = this.base.dream;
    lu.uHeat.value = this.base.heat;
    lu.uTime.value = this.time;

    // God rays: project the sun into screen space, fade as it leaves the frame.
    let god = 0;
    if (this.godEnabled && this.base.god > 0) {
      const p = this.camera.position.clone().addScaledVector(this.sunDir, 1000).project(this.camera);
      const facing = this.sunDir.dot(this.camera.getWorldDirection(_v));
      if (facing > 0 && p.z < 1) {
        lu.uSun.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
        const off = Math.max(Math.abs(p.x), Math.abs(p.y));
        god = this.base.god * Math.max(0, 1 - Math.max(0, off - 0.9) / 0.9) * Math.min(1, facing * 2) * (1 - 0.6 * this.backlit) * glare;
      }
    }
    lu.uGod.value = god;
    this.lens.enabled = god > 0.001 || lu.uCA.value > 0.001 || lu.uRadial.value > 0.001 || lu.uDream.value > 0.001 || lu.uHeat.value > 0.001;
    this.bloom.strength = Math.min(0.8, this.base.bloom * (1 - 0.45 * this.backlit) * (0.6 + 0.4 * glare));
    this.composer.render(realDt);
  }
}
const _v = new THREE.Vector3();
const smoothstepJS = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
