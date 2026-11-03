import * as THREE from 'three';
import { Mat, Tex, clothMat, cachedGeo, setShadows, patchMaterial } from './Assets.js';
import { EYE_Y, EYE_Z, giantFaceMaps } from './GiantFace.js';
import { Cape } from './Cape.js';
import { kindsFor, BONES, A_POSE, VARIANTS, MORPHS, joints, bodyGeometry, clothGeometry, headGeometry, handGeometry, eyeParts, hairGeometry, beardGeometry, skinMaterial, clothMaterial, armourMaterial, hairCardMaterial, scalpGeometry, scalpMaterial } from './Anatomy.js';
import { clamp, damp, lerp, ease, TAU } from '../core/math.js';

// Fraction of the stride cycle a foot spends planted: most of it when walking, under half when running.
const gaitDuty = (spd) => 0.62 - 0.24 * clamp((spd - 2.5) / 3.5);

// ---------- pose model ----------
const KEYS = ['bodyY', 'lean', 'side', 'twist', 'chestX', 'headX', 'headY', 'lArmX', 'lArmY', 'lArmZ', 'lElb', 'rArmX', 'rArmY', 'rArmZ', 'rElb', 'rWrist',
  'lLegX', 'lLegZ', 'lKnee', 'rLegX', 'rLegZ', 'rKnee', 'lFoot', 'rFoot', 'roll', 'shield', 'bow'];
export function P(o = {}) { const p = {}; for (const k of KEYS) p[k] = o[k] ?? 0; return p; }
function copyP(dst, src) { for (const k of KEYS) dst[k] = src[k]; return dst; }
function lerpP(dst, b, t) { for (const k in b) if (k in dst) dst[k] += (b[k] - dst[k]) * t; return dst; }

// Keyframed actions: [time 0..1, partial pose, easing]. Fields missing from a key fall back to the live base pose.
export const ACTIONS = {
  slash1: { dur: 0.5, active: [0.36, 0.56], cancel: 0.62, dmg: 14, reach: 2.4, arc: 1.4, step: 2.0, trail: true,
    keys: [[0, {}], [0.34, { twist: -0.75, lean: -0.05, rArmX: -0.9, rArmZ: -1.3, rArmY: 0.5, rElb: -1.4, rWrist: 1.3, lArmX: -0.6, lElb: -0.8, bodyY: -0.03, shield: 0.4 }, 'inQuad'],
      [0.56, { twist: 0.85, lean: 0.28, rArmX: -1.35, rArmZ: 0.2, rArmY: -1.1, rElb: -0.15, rWrist: 1.45, lArmX: -0.2, bodyY: -0.09, lLegX: -0.55, lKnee: 0.55, rLegX: 0.35, shield: 0.4 }, 'outExpo'],
      [1, {}, 'inOutSine']] },
  slash2: { dur: 0.5, active: [0.34, 0.54], cancel: 0.6, dmg: 14, reach: 2.4, arc: 1.4, step: 2.0, trail: true,
    keys: [[0, {}], [0.32, { twist: 0.8, lean: 0.05, rArmX: -1.4, rArmZ: 0.4, rArmY: -1.2, rElb: -0.6, rWrist: 1.4, bodyY: -0.05, shield: 0.4 }, 'inQuad'],
      [0.54, { twist: -0.8, lean: 0.25, rArmX: -0.8, rArmZ: -1.3, rArmY: 0.6, rElb: -0.2, rWrist: 1.4, bodyY: -0.1, rLegX: -0.5, rKnee: 0.5, lLegX: 0.3, shield: 0.4 }, 'outExpo'],
      [1, {}, 'inOutSine']] },
  heavy: { dur: 0.78, active: [0.48, 0.64], cancel: 0.72, dmg: 30, reach: 2.7, arc: 0.9, step: 3.2, heavy: true, trail: true,
    keys: [[0, {}], [0.44, { lean: -0.3, rArmX: -2.9, rArmZ: -0.3, rElb: -0.9, rWrist: 0.4, lArmX: -2.4, lElb: -0.9, bodyY: 0.05, chestX: -0.2, shield: 0.2 }, 'outCubic'],
      [0.64, { lean: 0.55, rArmX: -0.9, rArmZ: -0.1, rElb: -0.1, rWrist: 1.5, lArmX: -0.8, bodyY: -0.28, lLegX: -0.9, lKnee: 1.0, rLegX: 0.5, rKnee: 0.4, chestX: 0.25, shield: 0.2 }, 'outExpo'],
      [1, {}, 'inOutSine']] },
  riposte: { dur: 0.6, active: [0.3, 0.5], cancel: 0.7, dmg: 45, reach: 2.6, arc: 1.0, step: 2.6, heavy: true, crit: true, trail: true,
    keys: [[0, {}], [0.28, { twist: -0.4, lean: -0.1, rArmX: -0.3, rArmZ: -0.3, rElb: -2.0, rWrist: 0.1, bodyY: -0.1 }, 'outQuad'],
      [0.5, { twist: 0.3, lean: 0.6, rArmX: -1.55, rElb: 0, rWrist: 0.05, bodyY: -0.3, lLegX: -1.0, lKnee: 1.1, rLegX: 0.6 }, 'outExpo'],
      [1, {}, 'inOutSine']] },
  dodge: { dur: 0.56, rollSpan: [0.08, 0.82],
    keys: [[0, {}], [0.12, { bodyY: -0.5, lean: 0.8, lKnee: 1.6, rKnee: 1.6, lLegX: -1.3, rLegX: -1.3, lArmX: -1.2, rArmX: -1.2, lElb: -1.2, rElb: -1.2, headX: 0.5 }, 'outQuad'],
      [0.8, { bodyY: -0.45, lean: 0.6, lKnee: 1.5, rKnee: 1.5, lLegX: -1.1, rLegX: -1.1, lArmX: -1.0, rArmX: -1.0, lElb: -1.2, rElb: -1.2 }, 'linear'],
      [1, {}, 'outCubic']] },
  hit: { dur: 0.38, keys: [[0, {}], [0.22, { lean: -0.38, headX: -0.35, lArmZ: 0.6, rArmZ: -0.6, bodyY: -0.06, twist: 0.2 }, 'outExpo'], [1, {}, 'inOutSine']] },
  stagger: { dur: 0.9, keys: [[0, {}], [0.2, { lean: -0.6, headX: -0.4, lArmZ: 0.9, rArmZ: -0.9, bodyY: -0.15, lLegX: 0.4, rLegX: -0.3 }, 'outExpo'], [0.7, { lean: -0.3, bodyY: -0.1 }, 'linear'], [1, {}, 'inOutSine']] },
  death: { dur: 1.3, hold: true, keys: [[0, {}], [0.35, { lean: -0.3, lKnee: 1.6, rKnee: 1.6, lLegX: -0.6, rLegX: -0.6, bodyY: -0.5, headX: 0.4 }, 'outQuad'], [1, { lean: -1.45, bodyY: -0.82, lArmZ: 1.3, rArmZ: -1.3, lKnee: 0.4, rKnee: 0.6, headX: -0.2 }, 'outCubic']] },
  parry: { dur: 0.3, keys: [[0, {}], [0.25, { shield: 1, lArmX: -1.2, lElb: -1.3, lean: -0.15, bodyY: -0.08, twist: -0.3 }, 'outExpo'], [1, { shield: 1, lArmX: -1.0, lElb: -1.4 }, 'inOutSine']] },
  interact: { dur: 0.7, keys: [[0, {}], [0.4, { lean: 0.6, rArmX: -1.2, lArmX: -1.0, bodyY: -0.25, lKnee: 0.6, rKnee: 0.6, lLegX: -0.5, rLegX: -0.4 }, 'outCubic'], [1, {}, 'inOutSine']] },
  pull: { dur: 0.8, keys: [[0, {}], [0.3, { lean: 0.4, rArmX: -1.5, rElb: -0.1 }, 'outQuad'], [0.7, { lean: -0.3, rArmX: -0.6, rElb: -1.8, twist: 0.4, bodyY: -0.08 }, 'outCubic'], [1, {}, 'inOutSine']] },
  stab: { dur: 1.4, hold: true, keys: [[0, {}], [0.25, { lean: -0.25, lArmX: 0.2, rArmX: 0.2, lElb: -1.8, rElb: -1.8, bodyY: 0.04, chestX: -0.2 }, 'outCubic'],
    [0.42, { lean: 0.65, lArmX: -1.4, rArmX: -1.4, lElb: -0.1, rElb: -0.1, bodyY: -0.25, lLegX: -0.9, lKnee: 1.0, rLegX: 0.6, chestX: 0.3 }, 'outExpo'], [1, { lean: 0.6, lArmX: -1.35, rArmX: -1.35, lElb: -0.15, rElb: -0.15, bodyY: -0.28, lLegX: -0.9, lKnee: 1.0, rLegX: 0.6 }, 'linear']] },
  shout: { dur: 3.0, keys: [[0, {}], [0.15, { lean: -0.2, chestX: -0.25, headX: -0.35, rArmX: -2.6, rArmZ: -0.3, rElb: -0.2, lArmZ: 0.5 }, 'outBack'], [0.85, { lean: -0.15, chestX: -0.2, headX: -0.3, rArmX: -2.5, rArmZ: -0.3, lArmZ: 0.5 }, 'linear'], [1, {}, 'inOutSine']] },
  cheer: { dur: 1.6, keys: [[0, {}], [0.2, { rArmX: -2.8, lArmX: -2.6, rArmZ: -0.3, lArmZ: 0.3, headX: -0.3, bodyY: 0.06 }, 'outBack'], [0.5, { rArmX: -2.5, lArmX: -2.9, bodyY: 0.0 }, 'inOutSine'], [0.75, { rArmX: -2.9, lArmX: -2.5, bodyY: 0.06 }, 'inOutSine'], [1, {}, 'inOutSine']] },
  mourn: { dur: 3.5, keys: [[0, {}], [0.25, { headX: 0.55, lean: 0.15, lArmX: -0.3, rArmX: -0.3, lElb: -1.2, rElb: -1.2, lArmY: -0.4, rArmY: 0.4 }, 'inOutSine'], [0.8, { headX: 0.6, lean: 0.18, lElb: -1.2, rElb: -1.2 }, 'linear'], [1, {}, 'inOutSine']] },
  drawBow: { dur: 0.4, hold: true, keys: [[0, {}], [1, { bow: 1 }, 'outCubic']] },
  throw: { dur: 1.2, keys: [[0, {}], [0.4, { lean: -0.4, rArmX: -3.0, lArmX: -3.0, rElb: -0.8, lElb: -0.8, bodyY: -0.1, chestX: -0.3 }, 'outCubic'], [0.6, { lean: 0.5, rArmX: -1.0, lArmX: -1.0, rElb: -0.1, lElb: -0.1, chestX: 0.3 }, 'outExpo'], [1, {}, 'inOutSine']] },
};
const EASE = (n) => ease[n || 'inOutSine'] || ease.inOutSine;

function evalAction(def, t, base, out) {
  const keys = def.keys;
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const k0 = keys[i], k1 = keys[i + 1];
  const span = Math.max(1e-4, k1[0] - k0[0]);
  const u = EASE(k1[2])(clamp((t - k0[0]) / span));
  for (const k of KEYS) {
    const a = k0[1][k] ?? base[k], b = k1[1][k] ?? base[k];
    out[k] = a + (b - a) * u;
  }
  return out;
}

// ---------- shared geometry ----------
function limb(r, len) {
  return cachedGeo(`limb${r.toFixed(3)}_${len.toFixed(3)}`, () => { const g = new THREE.CapsuleGeometry(r, len, 4, 10); g.translate(0, -len / 2, 0); return g; });
}
function sphere(r, w = 14, h = 10) { return cachedGeo(`sph${r}_${w}`, () => new THREE.SphereGeometry(r, w, h)); }

function swordGeo() {
  return cachedGeo('sword', () => {
    const blade = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.028, 0.04), new THREE.Vector2(0.04, 0.3), new THREE.Vector2(0.03, 0.48), new THREE.Vector2(0, 0.6)], 4);
    blade.scale(1, 1, 0.25); blade.rotateX(Math.PI / 2); blade.translate(0, 0, 0.1);
    return blade;
  });
}

// ---------- humanoid ----------
const EXPRESSIONS = {
  anger: { browDown: 1, frown: 0.6, squint: 0.4 },
  fear: { browUp: 1, jawOpen: 0.25 },
  roar: { jawOpen: 1, browDown: 1, squint: 0.7, frown: 0.6 },
  pain: { browDown: 0.6, squint: 1, jawOpen: 0.3, frown: 0.4 },
  relief: { browUp: 0.4, smile: 0.6 },
  grief: { browUp: 0.9, frown: 1 },
  determination: { browDown: 0.6, frown: 0.2, squint: 0.3 },
};
let _gfm = null, _rim = null;
function giantFaceMaterial(hex) {
  if (_gfm) return _gfm;
  const M = giantFaceMaps();
  _gfm = patchMaterial(new THREE.MeshPhysicalMaterial({ color: hex, map: M.albedo, normalMap: M.normal, normalScale: new THREE.Vector2(0.85, 0.85), roughness: 0.58, envMapIntensity: 0.25, sheen: 0.08, sheenColor: new THREE.Color(0xff9070), sheenRoughness: 0.6 }), { rim: true, wrap: true });
  return _gfm;
}
function rimMaterial() { return _rim || (_rim = new THREE.MeshPhysicalMaterial({ color: 0xa8443a, roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.1 })); }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

export class Humanoid {
  static registry = new Map();
  static speak(id, seconds = 0) { const m = Humanoid.registry.get(id); if (!m) return; if (seconds) m.talkFor(seconds); else m.blip(); }

  constructor(o = {}) {
    const look = o.look || {};
    const cyc = !!look.cyclops, hero = look.cap === 'helmet', grey = look.grey || 0;
    this.o = o;
    this.cyclops = cyc;
    const { variant, face } = kindsFor(look);
    this.variant = variant;
    const v = VARIANTS[variant], J = joints(v);
    const seed = hashStr((o.id || '') + (look.skin || '') + (look.hair || '') + variant);
    this.seed = (seed % 100) / 10;

    // Skeleton (bind pose = A-pose arms). Bone names match the pose layer below.
    this.root = new THREE.Group();
    this.body = new THREE.Group(); this.root.add(this.body);
    this.rollPivot = new THREE.Group(); this.rollPivot.position.y = 0.6; this.body.add(this.rollPivot);
    const bone = (parent, x, y, z) => { const b = new THREE.Bone(); b.position.set(x, y, z); parent.add(b); return b; };
    this.hipH = 0.35;
    this.hips = bone(this.rollPivot, 0, this.hipH, 0);
    this.spine = bone(this.hips, 0, 0, 0);
    this.chest = bone(this.spine, 0, 0.2, 0);
    this.neck = bone(this.chest, 0, 0.33, 0);
    this.head = bone(this.neck, 0, 0.1, 0);
    for (const s of [1, -1]) {
      const p = s > 0 ? 'l' : 'r';
      this[p + 'Sh'] = bone(this.chest, s * J.sh[0], J.sh[1] - 1.15, 0);
      this[p + 'El'] = bone(this[p + 'Sh'], 0, -v.arm[0], 0);
      this[p + 'Hand'] = bone(this[p + 'El'], 0, -v.arm[1], 0);
      this[p + 'Hip'] = bone(this.hips, s * J.hip[0], J.hip[1] - 0.95, 0);
      this[p + 'Kn'] = bone(this[p + 'Hip'], 0, J.kn[1] - J.hip[1], 0);
      this[p + 'Ft'] = bone(this[p + 'Kn'], 0, J.an[1] - J.kn[1], 0);
    }
    // Aliases used by the rest of the game
    this.lEl.isElbow = this.rEl.isElbow = true;
    this.lSh.rotation.z = A_POSE; this.rSh.rotation.z = -A_POSE;
    this.root.updateMatrixWorld(true);
    this.skeleton = new THREE.Skeleton(BONES.map((n) => this[n]));

    // Materials
    this.skinMat = skinMaterial(look.skin || '#b07a52', seed, { old: grey > 0.6, giant: cyc, dirt: cyc ? 0.55 : 0.4, scars: hero ? 6 : cyc ? 5 : seed % 3, burn: cyc ? 0.1 : 0.3, grey: cyc ? 0.3 : grey });
    const addSkinned = (geo, mat, shadow = true) => {
      const m = new THREE.SkinnedMesh(geo, mat);
      m.castShadow = shadow; m.receiveShadow = true;
      this.root.add(m);
      m.bind(this.skeleton);
      return m;
    };
    if (cyc) { this.skinMat.envMapIntensity = 0.3; this.skinMat.sheen = 0.12; this.skinMat.roughness = 0.52; }
    this.bodyMesh = addSkinned(bodyGeometry(variant).geo, this.skinMat);
    if (cyc) {
      const fleece = patchMaterial(new THREE.MeshStandardMaterial({ color: 0x6a5a48, normalMap: Tex.woolN, normalScale: new THREE.Vector2(2, 2), roughness: 1, side: THREE.DoubleSide }));
      addSkinned(clothGeometry(variant, 'loincloth'), fleece);
    } else {
      addSkinned(clothGeometry(variant, 'tunic'), clothMaterial(look.tunic || '#d8cfb8'));
      // a leather girdle cinches the chiton at the waist
      if (!hero) { const girdle = new THREE.Mesh(cachedGeo('girdle' + variant, () => new THREE.TorusGeometry(0.19 * v.g, 0.016, 6, 32)), Mat.leather); girdle.rotation.x = Math.PI / 2; girdle.position.y = 0.1; girdle.scale.set(1, 0.86, 1); this.hips.add(girdle); }
    }
    if (hero) {
      const arm = armourMaterial();
      addSkinned(clothGeometry(variant, 'cuirass'), arm);
      addSkinned(clothGeometry(variant, 'greaves'), arm);
      addSkinned(clothGeometry(variant, 'bracers'), arm);
      const belt = new THREE.Mesh(cachedGeo('belt2', () => new THREE.TorusGeometry(0.155, 0.018, 6, 24)), Mat.leather);
      belt.rotation.x = Math.PI / 2; belt.position.y = 0.06; belt.scale.set(1, 0.75, 1); this.hips.add(belt);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        const s = new THREE.Mesh(cachedGeo('pter2', () => { const g = new THREE.BoxGeometry(0.06, 0.2, 0.012); g.translate(0, -0.1, 0); return g; }), Mat.leather);
        s.position.set(Math.sin(a) * 0.17, 0.07, Math.cos(a) * 0.125); s.rotation.y = a; s.rotation.x = Math.cos(a) * 0.12; this.hips.add(s);
      }
    }
    if (cyc) {
      const rope = new THREE.Mesh(cachedGeo('rope', () => new THREE.TorusGeometry(0.16, 0.012, 5, 24)), Mat.rope);
      rope.rotation.x = Math.PI / 2; rope.position.y = 0.07; rope.scale.set(v.g * 1.1, v.g * 0.85, v.g); this.hips.add(rope);
    }

    // Head: sculpted face with expression morphs, wet eyes, blinking lids, hair and beard cards.
    // The giant gets a face-specific painted wrinkle/cavity map; everyone else shares the body skin.
    this.faceMat = cyc ? giantFaceMaterial(look.skin) : skinMaterial(look.skin || '#b07a52', seed, { old: grey > 0.6, dirt: 0.25, scars: hero ? 2 : 0, burn: 0.3, grey, face: true });
    this.faceMesh = new THREE.Mesh(headGeometry(face, variant), this.faceMat);
    this.faceMesh.castShadow = true;
    this.head.add(this.faceMesh);
    if (cyc) this.head.scale.setScalar(1.12);   // a full-sized skull on the broad brute's frame
    const irisCol = cyc ? '#c07a2a' : ['#3a2414', '#4a3a24', '#2e3a2a', '#24180e'][seed % 4];
    const E = eyeParts(irisCol, cyc);
    this.eyes = []; this.lids = [];
    const eyeAt = cyc ? [[0, EYE_Y - 1.58, EYE_Z]] : [[0.033, 0.1075, 0.0755], [-0.033, 0.1075, 0.0755]];
    for (const p of eyeAt) {
      const ball = new THREE.Mesh(E.ball, E.mat); ball.position.set(...p); this.head.add(ball); this.eyes.push(ball);
      const cornea = new THREE.Mesh(E.cornea, E.corneaMat); cornea.renderOrder = 2; ball.add(cornea);
      const lid = new THREE.Mesh(E.lid, this.skinMat); lid.position.set(...p); lid.rotation.x = cyc ? -1.25 : -0.2; this.head.add(lid); this.lids.push(lid);
      const low = new THREE.Mesh(E.lower, cyc ? rimMaterial() : this.skinMat); low.position.set(...p); this.head.add(low);
      // giant: the deep half-moon socket would expose this cup, so it becomes a thin wet waterline tucked under the iris
      if (cyc) { low.scale.set(1.0, 0.45, 0.97); low.position.y -= E.r * 0.42; }
      if (cyc) lid.material = this.faceMat;
    }
    this.eye = this.eyes[0];
    if (cyc) {
      this.pupil = new THREE.Mesh(E.pupil, new THREE.MeshBasicMaterial({ color: 0x050302 }));
      this.pupil.position.set(0, 0, E.r * 1.003); this.eye.add(this.pupil);
      this.iris = this.pupil;
      this.lid = this.lids[0];
    }
    const hairCol = grey > 0.6 ? '#8a8478' : look.hair || '#2a1c12';
    const style = cyc ? { bald: true } : hero ? { beard: look.beard || 'full', helmet: true } : { long: seed % 3 === 0, beard: look.beard };
    if (!style.bald && (!style.helmet || style.beard)) {
      const hg = style.helmet ? hairGeometry({ ...style, sparse: true }, seed) : hairGeometry(style, seed);
      this.hairMesh = new THREE.Mesh(hg, hairCardMaterial(hairCol));
      this.head.add(this.hairMesh);
      if (!style.sparse && !style.helmet) { this.scalp = new THREE.Mesh(scalpGeometry(style.beard), scalpMaterial(hairCol)); this.head.add(this.scalp); }
    }
    if (!cyc && style.beard && style.beard !== 'none') { this.beardMesh = new THREE.Mesh(beardGeometry(face, variant, style.beard), scalpMaterial(hairCol)); this.head.add(this.beardMesh); }
    if (look.cap === 'band') { const b = new THREE.Mesh(cachedGeo('band2', () => new THREE.TorusGeometry(0.079, 0.0065, 5, 24)), clothMat('#a8402a')); b.rotation.x = Math.PI / 2 - 0.22; b.position.set(0, 0.155, -0.008); b.scale.set(1, 1.27, 1); this.head.add(b); }
    if (look.cap === 'bronze') { const c = new THREE.Mesh(cachedGeo('pilos2', () => new THREE.ConeGeometry(0.088, 0.14, 16)), Mat.bronze); c.position.set(0, 0.215, -0.012); this.head.add(c); }
    if (hero) {
      // Corinthian helmet: a domed bowl over the brow, cheek guards and a nasal that leave the eyes and
      // mouth showing, a flared neck guard, and a tall horsehair crest on a bronze holder.
      const helm = new THREE.Group(); helm.position.set(0, 0, -0.012); helm.scale.set(1, 1, 1.1); this.head.add(helm);
      const lathe = (pts, a0, a1, key) => cachedGeo(key, () => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 28, a0, a1 - a0));
      const helmMat = Mat.helm || (Mat.helm = Object.assign(Mat.bronzeDark.clone(), { side: THREE.DoubleSide, map: Tex.bronze }));
      helm.add(new THREE.Mesh(lathe([[0.108, 0.128], [0.107, 0.16], [0.099, 0.198], [0.08, 0.232], [0.048, 0.254], [0, 0.262]], 0, TAU, 'helmDome'), helmMat));
      helm.add(new THREE.Mesh(lathe([[0.121, -0.005], [0.112, 0.03], [0.107, 0.08], [0.108, 0.13]], 1.0, TAU - 1.0, 'helmNape'), helmMat));
      for (const sd of [1, -1]) {
        const a0 = sd > 0 ? 0.22 : TAU - 1.05, a1 = sd > 0 ? 1.05 : TAU - 0.22;
        helm.add(new THREE.Mesh(lathe([[0.1, -0.03], [0.104, 0.02], [0.107, 0.075]], a0, a1, 'helmCheek' + sd), helmMat));      // cheek guard
        const b0 = sd > 0 ? 0.55 : TAU - 1.05, b1 = sd > 0 ? 1.05 : TAU - 0.55;
        helm.add(new THREE.Mesh(lathe([[0.107, 0.075], [0.108, 0.13]], b0, b1, 'helmTemple' + sd), helmMat));                   // beside the eye
      }
      const nasal = new THREE.Mesh(cachedGeo('helmNasal', () => new THREE.BoxGeometry(0.018, 0.06, 0.008)), helmMat); nasal.position.set(0, 0.105, 0.112); nasal.rotation.x = -0.12; helm.add(nasal);
      const rim = new THREE.Mesh(cachedGeo('helmRim', () => new THREE.TorusGeometry(0.109, 0.004, 5, 32)), helmMat); rim.rotation.x = Math.PI / 2; rim.position.y = 0.128; helm.add(rim);
      // crest: a fan of strand cards along an arc from brow to nape, with a second crossed layer for body
      const crestGeo = cachedGeo('crestHair', () => {
        const pos = [], uv = [], R = (k) => Math.abs(Math.sin(k * 12.9898) * 43758.5453) % 1;
        for (let i = 0; i < 90; i++) {
          const t = i / 89, a = -1.15 + t * 2.75 + (R(i * 3.1) - 0.5) * 0.05, len = 0.11 + Math.sin(t * Math.PI) * 0.07 + (R(i) - 0.5) * 0.06;
          for (const tw of [0, 0.5, -0.5]) {
            const dir = new THREE.Vector3(0, Math.cos(a), -Math.sin(a)), base = dir.clone().multiplyScalar(0.27).add(new THREE.Vector3(0, -0.02, 0));
            const side = new THREE.Vector3(Math.cos(tw) * 0.009, 0, 0).add(new THREE.Vector3(0, -Math.sin(a), -Math.cos(a)).multiplyScalar(Math.sin(tw) * 0.009));
            const tip = base.clone().addScaledVector(dir, len).add(new THREE.Vector3((R(i + tw * 7) - 0.5) * 0.03, -0.015 * t - R(i * 1.7) * 0.012, -0.03 * t));
            const q = [base.clone().sub(side), base.clone().add(side), tip.clone().add(side.clone().multiplyScalar(2.2)), tip.clone().sub(side.clone().multiplyScalar(2.2))];
            for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(q[k].x, q[k].y, q[k].z); uv.push(k === 0 || k === 3 ? 0.2 + R(i + tw) * 0.5 : 0.25 + R(i + tw) * 0.5, k < 2 ? 1 : 0); }
          }
        }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); return g;
      });
      const crest = new THREE.Mesh(crestGeo, hairCardMaterial('#a01810')); helm.add(crest);
      const holder = new THREE.Mesh(cachedGeo('crestHolder', () => new THREE.TorusGeometry(0.255, 0.008, 5, 24, 2.6)), helmMat); holder.rotation.set(0, Math.PI / 2, Math.PI / 2 - 1.3); holder.position.y = -0.005; helm.add(holder);
      this.crest = crest;
    }

    // Hands with articulated fingers in a loose grip
    this.lHand.add(new THREE.Mesh(handGeometry(variant, true), this.skinMat));
    this.rHand.add(new THREE.Mesh(handGeometry(variant, false), this.skinMat));
    this.gripOffset = new THREE.Vector3(0.03 * v.hand, -0.112 * v.hand, -0.03);
    for (const h of [this.lHand, this.rHand]) h.children.forEach((c) => { c.castShadow = true; });

    // face state
    this.face = { blinkT: 1 + Math.random() * 3, blink: 0, mouth: 0, talkT: 0, infl: new Float32Array(MORPHS.length), target: new Float32Array(MORPHS.length), eyeYaw: 0, eyePitch: 0 };
    this.lidClose = null;
    this.lyingK = 0;
    this.expression = null; this.expressionAmt = 0;
    if (o.id) Humanoid.registry.set(o.id, this);

    // Equipment
    if (o.sword) {
      this.sword = new THREE.Group();
      const blade = new THREE.Mesh(swordGeo(), Mat.blade); this.sword.add(blade);
      const guard = new THREE.Mesh(cachedGeo('guard', () => new THREE.BoxGeometry(0.16, 0.025, 0.03)), Mat.bronze); guard.position.z = 0.09; this.sword.add(guard);
      const grip = new THREE.Mesh(cachedGeo('grip', () => { const g = new THREE.CylinderGeometry(0.018, 0.018, 0.12, 6); g.rotateX(Math.PI / 2); return g; }), Mat.leather); grip.position.z = 0.03; this.sword.add(grip);
      this.sword.position.copy(this.gripOffset);
      this.rHand.add(this.sword);
      this.swordTip = new THREE.Object3D(); this.swordTip.position.z = 0.68; this.sword.add(this.swordTip);
      this.swordBase = new THREE.Object3D(); this.swordBase.position.z = 0.16; this.sword.add(this.swordBase);
    }
    if (o.shield) {
      this.shieldPivot = new THREE.Group(); this.chest.add(this.shieldPivot);
      const sg = cachedGeo('aspis', () => { const g = new THREE.CylinderGeometry(0.44, 0.44, 0.05, 28); g.rotateX(Math.PI / 2); return g; });
      const sh = new THREE.Mesh(sg, Mat.bronze); this.shieldPivot.add(sh);
      const rim = new THREE.Mesh(cachedGeo('rim', () => new THREE.TorusGeometry(0.44, 0.03, 6, 28)), Mat.bronzeDark); this.shieldPivot.add(rim);
      const emblem = new THREE.Mesh(cachedGeo('emb', () => new THREE.CircleGeometry(0.3, 24)), shieldEmblemMat()); emblem.position.z = 0.028; this.shieldPivot.add(emblem);
      this.shieldMesh = sh;
    }
    if (o.bow) {
      this.bowPivot = new THREE.Group(); this.chest.add(this.bowPivot);
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.6, -0.05), new THREE.Vector3(0, -0.3, 0.06), new THREE.Vector3(0, 0, 0.0), new THREE.Vector3(0, 0.3, 0.06), new THREE.Vector3(0, 0.6, -0.05)]);
      const bow = new THREE.Mesh(cachedGeo('bow', () => new THREE.TubeGeometry(curve, 16, 0.018, 5)), Mat.darkWood); this.bowPivot.add(bow);
      this.bowString = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -0.6, -0.05), new THREE.Vector3(0, 0, -0.05), new THREE.Vector3(0, 0.6, -0.05)]), new THREE.LineBasicMaterial({ color: 0xd8ccb0 }));
      this.bowPivot.add(this.bowString);
      this.quiver = new THREE.Mesh(cachedGeo('quiver', () => new THREE.CylinderGeometry(0.06, 0.05, 0.55, 8)), Mat.leather);
      this.quiver.position.set(-0.08, 0.16, -0.14); this.quiver.rotation.z = 0.4; this.chest.add(this.quiver);
    }
    if (o.spear) {
      const sp = new THREE.Group();
      const shaft = new THREE.Mesh(cachedGeo('spearShaft', () => { const g = new THREE.CylinderGeometry(0.02, 0.022, 2.4, 6); g.rotateX(Math.PI / 2); return g; }), Mat.darkWood);
      const tip = new THREE.Mesh(cachedGeo('spearTip', () => { const g = new THREE.ConeGeometry(0.04, 0.25, 4); g.rotateX(Math.PI / 2); return g; }), Mat.bronze);
      tip.position.z = 1.3; sp.add(shaft, tip); sp.position.copy(this.gripOffset); sp.position.z += 0.2;
      this.rHand.add(sp);
      this.spear = sp;
    }
    if (o.cloak) this.cape = new Cape(this, { width: 0.42, length: 0.92, material: Mat.cloak });

    // Only silhouettes cast shadows; small facial parts and alpha hair would multiply shadow draws.
    this.root.traverse((o) => { if (o.isMesh && (this.eyes.includes(o) || this.lids.includes(o) || o === this.hairMesh || o === this.scalp || o.geometry?.type === 'SphereGeometry')) o.castShadow = false; });
    this.root.scale.setScalar((o.scale || 1) * (look.h || 1));

    this.pose = P(); this.base = P(); this.tmp = P();
    this.anim = { t: Math.random() * 10, phase: 0, spd: 0, crouch: 0, carry: 0, block: 0, aim: 0, action: null, actionT: 0, w: 0, lookYaw: 0, lookPitch: 0, custom: 0, sit: 0 };
    this.onStep = null;
    this._v = new THREE.Vector3();
  }

  play(name, opts = {}) {
    const def = typeof name === 'string' ? ACTIONS[name] : name;
    if (!def) return;
    this.anim.action = def; this.anim.actionName = typeof name === 'string' ? name : 'custom';
    this.anim.actionT = 0; this.anim.speedMul = opts.speed || 1;
  }
  stop() { this.anim.action = null; }
  get actionT() { return this.anim.action ? this.anim.actionT : 1; }
  get actionDone() { return !this.anim.action || (this.anim.actionT >= 1 && !this.anim.action.hold); }

  update(dt, st = {}) {
    const a = this.anim, b = this.base;
    a.t += dt;
    const sp = st.speed || 0;
    a.spd = damp(a.spd, sp, 10, dt);
    const cad = st.cadence || 1;
    if (a.spd > 0.15) {
      const prev = a.phase;
      if (st.groundSpeed !== undefined) {
        // Step rate from the stride: the planted foot travels back exactly as fast as the body moves, so it never slides.
        const amp = 0.26 * clamp(a.spd / 2) + 0.32 * clamp((a.spd - 2.5) / 3.5) + 0.18 * clamp((a.spd - 6) / 2);
        const leg = 0.8 * (1 - 0.25 * a.crouch);
        const stride = 2 * leg * Math.sin(Math.max(0.08, amp * 1.7)) * this.root.scale.x;
        a.phase += (dt * st.groundSpeed / stride) * gaitDuty(a.spd) * TAU;   // one stride per planted (stance) span
      } else a.phase += dt * (3.2 + a.spd * 1.15) * cad;
      if (Math.floor(prev / Math.PI) !== Math.floor(a.phase / Math.PI) && this.onStep) this.onStep(Math.floor(a.phase / Math.PI) & 1);
    }
    a.crouch = damp(a.crouch, st.crouch ? 1 : 0, 10, dt);
    a.carry = damp(a.carry, st.carry ? 1 : 0, 8, dt);
    a.block = damp(a.block, st.block ? 1 : 0, 18, dt);
    a.aim = damp(a.aim, st.aim ? 1 : 0, 12, dt);
    a.custom = damp(a.custom, st.custom ? 1 : 0, st.customRate || 5, dt);

    // --- base: idle + locomotion
    const s = a.spd, walk = clamp(s / 2.0), run = clamp((s - 2.5) / 3.5), sprint = clamp((s - 6) / 2);
    const amp = 0.26 * walk + 0.32 * run + 0.18 * sprint;
    const sn = Math.sin(a.phase), cs = Math.cos(a.phase);
    const breathe = Math.sin(a.t * 1.7);
    for (const k of KEYS) b[k] = 0;
    b.bodyY = breathe * 0.008 - Math.abs(cs) * 0.035 * walk - 0.04 * run;
    b.chestX = breathe * 0.02;
    b.lean = 0.08 * run + 0.18 * sprint;
    b.twist = sn * 0.14 * amp;
    b.lLegX = -sn * amp * 1.7; b.rLegX = sn * amp * 1.7;
    b.lKnee = (0.12 + 0.95 * run) * Math.max(0, -cs) * walk + 0.08 * walk;
    b.rKnee = (0.12 + 0.95 * run) * Math.max(0, cs) * walk + 0.08 * walk;
    b.lFoot = b.lKnee * -0.3; b.rFoot = b.rKnee * -0.3;
    if (st.groundSpeed !== undefined && walk > 0.02) {
      // Planted gait: each foot sweeps back at a constant rate while on the ground (60% of the cycle),
      // then swings forward with a knee lift, so the stance foot stays put instead of skating.
      const A = amp * 1.7, D = gaitDuty(s), lift = 0.85 + 0.7 * run;
      const leg = (ph) => { const u = (((ph % TAU) + TAU) % TAU) / TAU; if (u < D) return [-A + 2 * A * (u / D), 0]; const k = (u - D) / (1 - D); return [A - 2 * A * k * k * (3 - 2 * k), Math.sin(k * Math.PI)]; };
      const [la, ll] = leg(a.phase), [ra, rl] = leg(a.phase + Math.PI);
      b.lLegX = la; b.rLegX = ra;
      b.lKnee = (0.08 + 0.3 * run) * walk + lift * ll * walk; b.rKnee = (0.08 + 0.3 * run) * walk + lift * rl * walk;
      b.lFoot = -0.3 * b.lKnee; b.rFoot = -0.3 * b.rKnee;
    }
    b.lArmX = sn * amp * 1.25; b.rArmX = -sn * amp * 1.25;
    b.lElb = -(0.15 + 1.0 * run); b.rElb = -(0.15 + 1.0 * run);
    b.lArmZ = 0.1; b.rArmZ = -0.1; b.rWrist = 0.25;
    // People at rest stand in a loose contrapposto instead of a mannequin's T: weight on one leg, the
    // other knee soft, elbows slightly bent, a slow sway.
    if (!this.cyclops) {
      const idle = 1 - clamp(s / 0.6);
      const sw = Math.sin(a.t * 0.4 + (this.seed || 0)) * 0.015;
      b.side += (0.03 + sw) * idle; b.twist += 0.04 * idle; b.lKnee += 0.14 * idle; b.lLegX -= 0.06 * idle; b.rLegX += 0.03 * idle; b.lFoot -= 0.06 * idle;
      b.lElb -= 0.1 * idle; b.rElb -= 0.15 * idle; b.lArmZ += 0.16 * idle; b.rArmZ -= 0.19 * idle; b.headY += 0.06 * idle; b.headX += 0.05 * idle;
    }
    // The giant: a heavy, menacing stance. Chest forward, arms held off the flanks by the lats, knees soft,
    // and a slow side-to-side weight shift onto each planted leg as he walks.
    if (this.cyclops) { b.lean += 0.12; b.chestX += 0.1; b.headX -= 0.06; b.lArmZ = 0.3; b.rArmZ = -0.3; b.lElb -= 0.3; b.rElb -= 0.3; b.bodyY -= 0.03 + Math.abs(cs) * 0.03 * walk; b.side = sn * 0.05 * walk; b.lLegX -= 0.1; b.rLegX -= 0.1; b.lKnee += 0.16; b.rKnee += 0.16; b.lFoot -= 0.06; b.rFoot -= 0.06; }
    // crouch / sneak
    const c = a.crouch;
    if (c > 0.01) {
      b.bodyY -= 0.28 * c; b.lean += 0.38 * c;
      b.lLegX -= 0.75 * c; b.rLegX -= 0.75 * c; b.lKnee += 1.15 * c; b.rKnee += 1.15 * c; b.lFoot -= 0.4 * c; b.rFoot -= 0.4 * c;
      b.lArmX -= 0.35 * c; b.rArmX -= 0.35 * c;
    }
    // carrying the stake: both arms forward
    // carrying the stake ram-style: right hand on the butt at the hip, left hand forward along the shaft
    if (a.carry > 0.01) { const k = a.carry; b.rArmX = lerp(b.rArmX, -0.3, k); b.rArmZ = lerp(b.rArmZ, -0.05, k); b.rElb = lerp(b.rElb, -1.05, k); b.lArmX = lerp(b.lArmX, -1.05, k); b.lArmY = lerp(b.lArmY, -0.35, k); b.lElb = lerp(b.lElb, -0.45, k); b.lean += 0.12 * k; b.twist += -0.12 * k; }
    if (a.block > 0.01) { b.shield = Math.max(b.shield, a.block); b.lArmX = lerp(b.lArmX, -1.0, a.block); b.lElb = lerp(b.lElb, -1.4, a.block); b.lean += 0.08 * a.block; b.bodyY -= 0.06 * a.block; }
    if (a.aim > 0.01) { b.bow = Math.max(b.bow, a.aim); b.lArmX = lerp(b.lArmX, -1.5, a.aim); b.lArmZ = lerp(b.lArmZ, 0.15, a.aim); b.lElb = lerp(b.lElb, -0.05, a.aim);
      const draw = st.draw || 0; b.rArmX = lerp(b.rArmX, -1.45, a.aim); b.rArmY = lerp(b.rArmY, 0.5 * draw, a.aim); b.rElb = lerp(b.rElb, -2.2 * draw - 0.3, a.aim); b.twist += -0.5 * a.aim; }
    if (st.custom && a.custom > 0.001) lerpP(b, st.custom, a.custom);
    else if (a.custom > 0.001 && this._lastCustom) lerpP(b, this._lastCustom, a.custom);
    if (st.custom) this._lastCustom = st.custom;

    // --- action layer
    const out = copyP(this.pose, b);
    let roll = 0;
    if (a.action) {
      a.actionT = Math.min(1, a.actionT + (dt * (a.speedMul || 1)) / a.action.dur);
      evalAction(a.action, a.actionT, b, this.tmp);
      copyP(out, this.tmp);
      if (a.action.rollSpan) { const [r0, r1] = a.action.rollSpan; roll = ease.inOutSine(clamp((a.actionT - r0) / (r1 - r0))) * TAU; }
      if (a.actionT >= 1 && !a.action.hold) a.action = null;
    }

    // --- head tracking toward a world point
    if (st.lookAt) {
      this.root.updateWorldMatrix(true, false);
      const lp = this._v.copy(st.lookAt);
      this.root.worldToLocal(lp);
      const yaw = clamp(Math.atan2(lp.x, lp.z), -1.1, 1.1);
      const pitch = clamp(-Math.atan2(lp.y - 1.65, Math.hypot(lp.x, lp.z)), -0.6, 0.5);
      a.lookYaw = damp(a.lookYaw, yaw, 6, dt); a.lookPitch = damp(a.lookPitch, pitch, 6, dt);
    } else { a.lookYaw = damp(a.lookYaw, 0, 4, dt); a.lookPitch = damp(a.lookPitch, 0, 4, dt); }

    // --- foot IK on uneven ground (strongest when standing still)
    let pelvisDrop = 0;
    if (st.ground && walk < 0.9) {
      const r = this.root, cosY = Math.cos(r.rotation.y), sinY = Math.sin(r.rotation.y), sc = r.scale.x;
      const g0 = st.ground(r.position.x, r.position.z);
      const off = 0.1 * sc;
      const gl = st.ground(r.position.x + cosY * off, r.position.z - sinY * off) - g0;
      const gr = st.ground(r.position.x - cosY * off, r.position.z + sinY * off) - g0;
      const k = 1 - walk;
      const low = Math.min(gl, gr, 0);
      pelvisDrop = Math.max(low, -0.25 * sc) * k;
      const el = (gl - low) / sc * k, er = (gr - low) / sc * k;
      out.lLegX -= el * 1.6; out.lKnee += el * 3.2; out.lFoot -= el * 1.6;
      out.rLegX -= er * 1.6; out.rKnee += er * 3.2; out.rFoot -= er * 1.6;
    }

    // --- apply
    this.body.position.y = pelvisDrop / (this.root.scale.x || 1);
    this.hips.position.y = this.hipH + out.bodyY;
    this.rollPivot.rotation.x = roll;
    this.spine.rotation.set(out.lean, out.twist, out.side);
    this.chest.rotation.x = out.chestX;
    this.head.rotation.set(out.headX + a.lookPitch, out.headY + a.lookYaw * 0.7, 0);
    this.neck.rotation.y = a.lookYaw * 0.3;
    // The giant carries his head low and forward like a bull, glaring up from under the brow.
    if (this.cyclops) { this.neck.rotation.x = 0.2 * (1 - this.lyingK); this.head.rotation.x -= 0.12 * (1 - this.lyingK); }
    this.lSh.rotation.set(out.lArmX, out.lArmY, out.lArmZ); this.lEl.rotation.x = out.lElb;
    this.rSh.rotation.set(out.rArmX, out.rArmY, out.rArmZ); this.rEl.rotation.x = out.rElb;
    this.rHand.rotation.x = out.rWrist;
    this.lHip.rotation.set(out.lLegX, 0, out.lLegZ); this.lKn.rotation.x = out.lKnee; this.lFt.rotation.x = out.lFoot;
    this.rHip.rotation.set(out.rLegX, 0, out.rLegZ); this.rKn.rotation.x = out.rKnee; this.rFt.rotation.x = out.rFoot;

    if (this.shieldPivot) {
      const k = clamp(out.shield);
      this.shieldPivot.position.set(lerp(0.36, 0.12, k), lerp(0.22, 0.38, k), lerp(0.02, 0.4, k));
      this.shieldPivot.rotation.set(lerp(0.05, -0.05, k), lerp(1.35, 0.15, k), 0);
    }
    if (this.bowPivot) {
      const k = clamp(out.bow);
      this.bowPivot.visible = k > 0.05;
      this.bowPivot.position.set(lerp(0.1, 0.02, k), lerp(0.2, 0.42, k), lerp(-0.18, 0.55, k));
      this.bowPivot.rotation.set(0, lerp(0, 0.5, k), lerp(0.6, 0.1, k));
      if (this.quiver) this.quiver.visible = true;
      const d = (st.draw || 0) * k;
      const p = this.bowString.geometry.attributes.position;
      p.setZ(1, -0.05 - d * 0.42); p.needsUpdate = true;
    }
    if (this.sword) this.sword.visible = !st.hideSword && clamp(out.bow) < 0.5;

    // Squash & stretch: compress on anticipation/landing, stretch when lunging.
    const stretch = clamp(-out.bodyY * 0.25, -0.05, 0.08);
    this.body.scale.set(1 + stretch * 0.5, 1 - stretch, 1 + stretch * 0.5);

    if (this.cape) this.cape.update(dt);
    this._face(dt, st);
  }

  // Blinks, eye tracking, speech and expressions (morph targets on the sculpted head).
  _face(dt, st) {
    const f = this.face;
    f.blinkT -= dt;
    if (f.blinkT <= 0) { f.blink = 0.13; f.blinkT = 2 + Math.random() * 4.5; }
    if (f.blink > 0) f.blink -= dt;
    const close = this.lidClose ?? (f.blink > 0 ? 1 : 0);
    // The giant's lid hides inside his sculpted hood until it blinks or he sleeps.
    const lidAng = this.cyclops ? -1.25 + 2.2 * close : -0.2 + 1.18 * close;
    for (const l of this.lids) l.rotation.x = damp(l.rotation.x, lidAng, close > 0.5 ? 40 : 18, dt);
    // eyes follow the look target
    if (st.lookAt && this.eyes.length) {
      this.head.updateWorldMatrix(true, false);
      const lp = this._v.copy(st.lookAt); this.head.worldToLocal(lp);
      f.eyeYaw = damp(f.eyeYaw, clamp(Math.atan2(lp.x, lp.z), -0.45, 0.45), 14, dt);
      f.eyePitch = damp(f.eyePitch, clamp(-Math.atan2(lp.y - 0.1, Math.hypot(lp.x, lp.z)), -0.35, 0.35), 14, dt);
    } else { f.eyeYaw = damp(f.eyeYaw, Math.sin(this.anim.t * 0.37) * 0.15, 3, dt); f.eyePitch = damp(f.eyePitch, 0, 3, dt); }
    // the giant's iris rides high, tucked under the heavy lid, with white showing below it
    for (const e of this.eyes) e.rotation.set(f.eyePitch - (this.cyclops ? 0.1 : 0), f.eyeYaw, 0);
    // speech: syllable-rate jaw while talking
    if (f.talkT > 0) { f.talkT -= dt; if (Math.random() < dt * 9) f.mouth = 0.45 + Math.random() * 0.55; }
    f.mouth = Math.max(0, f.mouth - dt * 6);
    const ex = EXPRESSIONS[this.expression] || {};
    MORPHS.forEach((k, i) => { f.target[i] = (ex[k] || 0) * this.expressionAmt; });
    f.target[0] = Math.max(f.target[0], f.mouth * 0.7);
    const infl = this.faceMesh.morphTargetInfluences;
    if (infl) for (let i = 0; i < MORPHS.length; i++) { f.infl[i] = damp(f.infl[i], f.target[i], i === 0 ? 22 : 6, dt); infl[i] = f.infl[i]; }
    // weight shift and breathing sway when idle
    if (this.anim.spd < 0.3 && !this.anim.action) this.hips.position.x = Math.sin(this.anim.t * 0.45) * 0.012;
    else this.hips.position.x = damp(this.hips.position.x, 0, 6, dt);
  }
  setExpression(name, amount = 1) { this.expression = name; this.expressionAmt = amount; }
  talkFor(seconds) { this.face.talkT = Math.max(this.face.talkT, seconds); }
  blip() { this.face.mouth = 0.6 + Math.random() * 0.4; }
  setBlind() {
    this.blind = true;
    if (this.eye) this.eye.material = Mat.wound;
    if (this.pupil) this.pupil.visible = false;
    this.lidClose = 0.8;
  }

  worldOf(obj, out) { return obj.getWorldPosition(out); }
}

let _emblem = null;
function shieldEmblemMat() {
  if (_emblem) return _emblem;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#1a1410'; g.beginPath(); g.arc(128, 128, 128, 0, 7); g.fill();
  g.fillStyle = '#c8873a'; g.beginPath(); g.arc(128, 128, 112, 0, 7); g.fill();
  // An owl for Athena, in black-figure style.
  g.fillStyle = '#1a1410';
  g.beginPath(); g.ellipse(128, 140, 46, 62, 0, 0, 7); g.fill();
  g.beginPath(); g.moveTo(88, 92); g.lineTo(100, 62); g.lineTo(116, 88); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(168, 92); g.lineTo(156, 62); g.lineTo(140, 88); g.closePath(); g.fill();
  g.fillStyle = '#c8873a';
  g.beginPath(); g.arc(110, 112, 14, 0, 7); g.fill(); g.beginPath(); g.arc(146, 112, 14, 0, 7); g.fill();
  g.fillStyle = '#1a1410'; g.beginPath(); g.arc(110, 112, 6, 0, 7); g.fill(); g.beginPath(); g.arc(146, 112, 6, 0, 7); g.fill();
  g.strokeStyle = '#c8873a'; g.lineWidth = 4;
  for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(128, 150 + i * 12, 18, 0.3, Math.PI - 0.3); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  _emblem = new THREE.MeshStandardMaterial({ map: t, metalness: 0.5, roughness: 0.5 });
  return _emblem;
}

// ---------- quadrupeds: sheep, ram, boar ----------
export class Quadruped {
  constructor(type = 'sheep', scale = 1) {
    this.type = type;
    this.root = new THREE.Group();
    this.body = new THREE.Group(); this.root.add(this.body);
    const boar = type === 'boar', ram = type === 'ram';
    const bodyMat = boar ? Mat.boar : (type === 'blackSheep' ? Mat.woolDark : Mat.wool);
    const bl = boar ? 0.75 : ram ? 0.72 : 0.6, bh = boar ? 0.42 : ram ? 0.52 : 0.45;
    const torso = new THREE.Mesh(cachedGeo('qbody' + type, () => {
      const g = new THREE.IcosahedronGeometry(1, 2);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const n = boar ? 1 : 0.88 + Math.sin(p.getX(i) * 9) * Math.cos(p.getY(i) * 8 + p.getZ(i) * 7) * 0.08; p.setXYZ(i, p.getX(i) * n, p.getY(i) * n, p.getZ(i) * n); }
      g.computeVertexNormals();
      return g;
    }), bodyMat);
    torso.scale.set(boar ? 0.42 : 0.45, bh * 0.85, bl);
    torso.position.y = boar ? 0.62 : 0.72;
    if (boar) torso.rotation.x = -0.1;
    this.body.add(torso);
    this.torso = torso;
    this.head = new THREE.Group(); this.head.position.set(0, boar ? 0.66 : 0.9, bl * 0.95); this.body.add(this.head);
    const hm = new THREE.Mesh(cachedGeo('qhead' + boar, () => { const g = new THREE.ConeGeometry(boar ? 0.22 : 0.14, boar ? 0.55 : 0.36, 8); g.rotateX(Math.PI / 2); g.translate(0, 0, boar ? 0.22 : 0.12); return g; }), boar ? Mat.boar : Mat.sheepFace);
    this.head.add(hm);
    if (!boar) { const fluff = new THREE.Mesh(sphere(0.16, 8, 6), bodyMat); fluff.position.set(0, 0.08, -0.02); this.head.add(fluff); }
    if (boar) {
      for (const sx of [-1, 1]) { const t = new THREE.Mesh(cachedGeo('tusk', () => new THREE.ConeGeometry(0.025, 0.16, 5)), Mat.tusk); t.position.set(sx * 0.09, -0.03, 0.38); t.rotation.set(-0.6, 0, sx * 0.4); this.head.add(t); }
      const mane = new THREE.Mesh(cachedGeo('mane', () => new THREE.BoxGeometry(0.06, 0.12, 0.9)), Mat.boar); mane.position.set(0, 0.95, 0.05); this.body.add(mane);
      for (const sx of [-1, 1]) { const e = new THREE.Mesh(sphere(0.022, 6, 5), new THREE.MeshStandardMaterial({ color: 0x2a0a04, emissive: 0x3a0800, roughness: 0.2 })); e.position.set(sx * 0.1, 0.07, 0.15); this.head.add(e); }
    }
    if (ram) {
      for (const sx of [-1, 1]) {
        const horn = new THREE.Mesh(cachedGeo('horn', () => new THREE.TorusGeometry(0.12, 0.045, 6, 12, Math.PI * 1.5)), Mat.horn);
        horn.position.set(sx * 0.12, 0.08, -0.02); horn.rotation.set(0, sx * Math.PI / 2, 0.6); this.head.add(horn);
      }
    }
    this.legs = [];
    const lx = boar ? 0.2 : 0.2, lz = bl * 0.62, legLen = boar ? 0.42 : 0.5;
    for (const [x, z] of [[lx, lz], [-lx, lz], [lx, -lz], [-lx, -lz]]) {
      const hip = new THREE.Group(); hip.position.set(x, legLen + 0.05, z); this.body.add(hip);
      const leg = new THREE.Mesh(limb(boar ? 0.05 : 0.04, legLen - 0.08), boar ? Mat.boar : Mat.sheepFace);
      hip.add(leg);
      this.legs.push(hip);
    }
    setShadows(this.root, true, false);
    this.root.scale.setScalar(scale);
    this.phase = Math.random() * 10; this.t = Math.random() * 10; this.spd = 0;
    this.headDown = 0; this.paw = 0;
  }
  update(dt, speed = 0, opts = {}) {
    this.t += dt;
    this.spd = damp(this.spd, speed, 8, dt);
    this.phase += dt * (2 + this.spd * 3.2);
    const a = clamp(this.spd / 3) * 0.55;
    const s = Math.sin(this.phase);
    this.legs[0].rotation.x = s * a; this.legs[3].rotation.x = s * a;
    this.legs[1].rotation.x = -s * a; this.legs[2].rotation.x = -s * a;
    if (this.paw > 0) { this.legs[0].rotation.x = Math.sin(this.t * 18) * 0.6 * this.paw - 0.3 * this.paw; }
    this.body.position.y = Math.abs(Math.cos(this.phase)) * 0.05 * clamp(this.spd / 2);
    this.headDown = damp(this.headDown, opts.headDown ? 1 : 0, 6, dt);
    this.head.rotation.x = 0.15 + Math.sin(this.t * 0.7) * 0.06 + this.headDown * 0.7;
    this.head.rotation.y = Math.sin(this.t * 0.4) * 0.2 * (1 - this.headDown);
    this.torso.scale.x = (this.type === 'boar' ? 0.42 : 0.45) * (1 + Math.sin(this.t * 2) * 0.015);
  }
}
