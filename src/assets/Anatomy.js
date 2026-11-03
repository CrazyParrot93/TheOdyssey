import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SDF, ell, cap, box, mirrorX, meshSDF, cylUV, skinBySDF, cullFaces, smax } from './Sculpt.js';
import { patchMaterial, shaderTime, Tex } from './Assets.js';
import { tfbm, tnoise, rng, hash2, noise2 } from '../core/math.js';
import { giantHeadParts, faceUV, EYE_R } from './GiantFace.js';

// Continuous, sculpted characters. One skinned body per build, a high-resolution head with
// expression morphs, articulated hands, layered cloth and armour, hair and beard cards.

export const BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'lSh', 'lEl', 'lHand', 'rSh', 'rEl', 'rHand', 'lHip', 'lKn', 'lFt', 'rHip', 'rKn', 'rFt'];
const BI = Object.fromEntries(BONES.map((b, i) => [b, i]));
export const A_POSE = 0.3;

export const VARIANTS = {
  hero:   { g: 1.04, mus: 1.0, fat: 0.05, age: 0.25, sh: 0.195, arm: [0.29, 0.26], neck: 0.058, hand: 1.0 },
  lean:   { g: 0.95, mus: 0.55, fat: 0.1, age: 0.15, sh: 0.185, arm: [0.29, 0.26], neck: 0.052, hand: 1.0 },
  stocky: { g: 1.13, mus: 0.75, fat: 0.7, age: 0.35, sh: 0.2, arm: [0.28, 0.25], neck: 0.064, hand: 1.05 },
  old:    { g: 0.94, mus: 0.25, fat: 0.25, age: 0.95, sh: 0.18, arm: [0.29, 0.26], neck: 0.05, hand: 1.0 },
  giant:  { g: 1.2, mus: 1.6, fat: 0.1, age: 0.55, sh: 0.245, arm: [0.31, 0.285], neck: 0.07, hand: 1.3, brute: 1, hiRes: 1 },
};
export const FACES = {
  hero:  { jaw: 1.05, nose: 1.0, brow: 1.1, cheek: 1.0, chin: 1.1, ears: 1.0, gaunt: 0.2 },
  young: { jaw: 0.95, nose: 0.95, brow: 0.9, cheek: 0.9, chin: 0.95, ears: 1.0, gaunt: 0 },
  mid:   { jaw: 1.08, nose: 1.1, brow: 1.05, cheek: 1.05, chin: 1.0, ears: 1.05, gaunt: 0.1 },
  old:   { jaw: 1.0, nose: 1.15, brow: 1.15, cheek: 1.1, chin: 0.95, ears: 1.15, gaunt: 0.7 },
  giant: { jaw: 1.2, nose: 1.4, brow: 1.6, cheek: 1.2, chin: 1.2, ears: 1.1, gaunt: 0, cyclops: true },
};

const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];

// Bind-pose joint layout (absolute metres, root at the feet, facing +Z, left = +X).
export function joints(v) {
  const dir = [Math.sin(A_POSE), -Math.cos(A_POSE), 0];
  const sh = [v.sh, v.shY || 1.44, 0], el = add(sh, dir, v.arm[0]), wr = add(el, dir, v.arm[1]);
  return { dir, sh, el, wr, hip: [0.095, 0.92, 0], kn: [0.095, 0.5, 0], an: [0.095, 0.085, 0], toe: [0.1, 0.025, 0.16], headJ: [0, 1.58, 0] };
}

// ---------- body ----------
function bodyParts(v) {
  const J = joints(v), g = v.g, m = v.mus, f = v.fat, d = J.dir;
  const left = [
    ell([0.07, 0.93, -0.07], [0.075 * g, 0.085, 0.07 * g], { bone: 'hips', k: 0.03 }),
    v.gaunt ? ell([0.07, 1.345, 0.075], [0.07, 0.04, 0.012], { bone: 'chest', k: 0.03 }) : ell([0.075, 1.335, 0.07], [0.08 * (0.75 + m * 0.35), 0.055, 0.03 + m * 0.018], { bone: 'chest', k: 0.03 }),
    cap([0.02, 1.49, -0.03], [v.sh * 0.78, v.gaunt ? 1.405 : 1.455, -0.02], 0.036 + m * 0.012, 0.028, { bone: 'chest', k: v.gaunt ? 0.05 : 0.03 }),
    cap([0.025, 1.445, 0.072], [v.sh - 0.02, J.sh[1] + 0.022, 0.03], v.brute ? 0.011 : 0.015, v.brute ? 0.01 : 0.013, { bone: 'chest', k: v.gaunt ? 0.025 : v.brute ? 0.03 : 0.012 }),
    ell([v.sh + 0.012, J.sh[1] - 0.015, 0], [0.05 + m * 0.014, 0.068, 0.054 + m * 0.012].map((r) => r * (v.gaunt ? 0.85 : 1)), { bone: 'lSh', k: 0.03 }),
    cap(J.sh, J.el, 0.047 * g * (0.85 + m * 0.2) * (v.gaunt ? 0.82 : 1), 0.039 * g * (v.gaunt ? 0.85 : 1), { bone: 'lSh', k: 0.025 }),
    ell(add(add(J.sh, d, 0.14), [0, 0, 0.02]), [0.032, 0.07, 0.034].map((r) => r * (0.7 + m * 0.5)), { bone: 'lSh', k: 0.02 }),
    ell(add(add(J.sh, d, 0.13), [0, 0, -0.022]), [0.032, 0.075, 0.032].map((r) => r * (0.7 + m * 0.4)), { bone: 'lSh', k: 0.02 }),
    cap(J.el, J.wr, 0.041 * g, 0.027 * g, { bone: 'lEl', k: 0.025 }),
    ell(add(add(J.el, d, 0.07), [0, 0, 0.008]), [0.036, 0.07, 0.034].map((r) => r * (0.8 + m * 0.3)), { bone: 'lEl', k: 0.02 }),
    cap(J.hip, J.kn, 0.084 * g, 0.051 * g, { bone: 'lHip', k: 0.03 }),
    ell([J.hip[0] + 0.006, 0.74, 0.028], [0.058, 0.15, 0.055].map((r) => r * (0.75 + m * 0.35)), { bone: 'lHip', k: 0.03 }),
    ell([J.hip[0] - 0.004, 0.76, -0.03], [0.05, 0.14, 0.048].map((r) => r * (0.75 + m * 0.3)), { bone: 'lHip', k: 0.03 }),
    ell([J.kn[0], 0.505, 0.035], [0.03, 0.034, 0.024], { bone: 'lKn', k: 0.02 }),
    cap(J.kn, J.an, 0.049 * g, 0.031 * g, { bone: 'lKn', k: 0.025 }),
    ell([J.kn[0] + 0.003, 0.37, -0.034], [0.048, 0.1, 0.049].map((r) => r * (0.75 + m * 0.35)), { bone: 'lKn', k: 0.03 }),
    cap([J.an[0], 0.06, -0.01], J.toe, 0.033, 0.025, { bone: 'lFt', k: 0.02 }),
    ell([J.an[0], 0.045, -0.035], [0.03, 0.03, 0.034], { bone: 'lFt', k: 0.02 }),
  ];
  if (v.gaunt) {
    const perp = [Math.cos(A_POSE), Math.sin(A_POSE), 0];
    left.push(ell(add(add(J.sh, d, 0.17), [0, 0, -0.03]), [0.026, 0.075, 0.024], { bone: 'lSh', k: 0.02 }));   // slack skin under the upper arm
    for (const o of [-0.022, -0.008, 0.008]) {
      const c = add(add(J.el, d, o), [0, 0, -0.03]);
      left.push(cap(add(c, perp, -0.02), add(c, perp, 0.02), 0.0028, 0.0028, { sub: true, k: 0.004 }));   // elbow creases
    }
    for (const o of [0.02, 0.05]) {
      const c = add(J.wr, d, -o);
      left.push(cap(add(add(c, perp, -0.022), [0, 0, 0.012]), add(add(c, perp, 0.022), [0, 0, 0.012]), 0.0022, 0.0022, { sub: true, k: 0.003 }));  // wrist folds
    }
  }
  if (v.brute) {
    // A brute's musculature: sloping traps, flared lats, serratus, capped deltoids and heavy forearms.
    left.push(
      cap([0.035, 1.535, -0.035], [v.sh * 0.82, J.sh[1] + 0.03, -0.025], 0.042, 0.03, { bone: 'chest', k: 0.04 }),
      ell([0.13, 1.25, -0.04], [0.05, 0.13, 0.07], { bone: 'chest', k: 0.045 }),
      ell(add(add(J.el, d, 0.08), [0, 0, 0.012]), [0.04, 0.085, 0.038], { bone: 'lEl', k: 0.025 }),
      ell(add(J.sh, [0.004, -0.03, 0.018]), [0.058, 0.062, 0.06], { bone: 'lSh', k: 0.03 }),
    );
    for (let i = 0; i < 3; i++) left.push(ell([0.132, 1.29 - i * 0.04, 0.062 - i * 0.004], [0.014, 0.012, 0.02], { bone: 'chest', k: 0.014 }));
    // Legs to carry it: quads, adductors, hamstrings, glutes, heavy calves and broad feet.
    left.push(
      ell([J.hip[0] + 0.012, 0.72, 0.026], [0.082, 0.2, 0.074], { bone: 'lHip', k: 0.04 }),
      ell([J.hip[0] - 0.035, 0.78, 0.0], [0.052, 0.14, 0.064], { bone: 'lHip', k: 0.04 }),
      ell([J.hip[0], 0.74, -0.042], [0.07, 0.17, 0.062], { bone: 'lHip', k: 0.04 }),
      ell([0.075, 0.9, -0.085], [0.088, 0.088, 0.07], { bone: 'hips', k: 0.04 }),
      cap(J.kn, J.an, 0.056, 0.037, { bone: 'lKn', k: 0.025 }),
      ell([J.kn[0] + 0.004, 0.375, -0.038], [0.058, 0.1, 0.056], { bone: 'lKn', k: 0.03 }),
      ell([J.an[0], 0.04, 0.03], [0.044, 0.034, 0.085], { bone: 'lFt', k: 0.025 }),
    );
  }
  if (v.age > 0.8) {
    left.push(ell(add(J.el, [0, 0, -0.02]), [0.028, 0.03, 0.026], { bone: 'lEl', k: 0.012 }));
    left.push(ell([J.kn[0], 0.5, 0.03], [0.034, 0.036, 0.028], { bone: 'lKn', k: 0.012 }));
  }
  const center = [
    ell([0, 0.97, -0.005], [0.15 * g, 0.1, 0.105 * g], { bone: 'hips', k: 0.03 }),
    ell([0, 1.09, 0.01 + f * 0.012], [0.128 * g + f * 0.035, 0.12, 0.092 * g + f * 0.045], { bone: 'spine', k: 0.05 }),
    ell([0, 1.29, -0.005], [0.152 * g, 0.17, 0.108 * g], { bone: 'chest', k: 0.05 }),
    ell([0, 1.28, -0.045], [0.16 * g * (1 + m * 0.08), 0.13, 0.072], { bone: 'chest', k: 0.04 }),
    cap([0, 1.4, -0.005], [0, 1.61, 0.01], v.neck, v.neck * 0.92, { bone: 'neck', k: 0.04 }),
  ];
  if (v.brute) {
    // Fill between the top of the barrel chest and the collarbones/neck, so there is no ledge across the chest.
    center.push(ell([0, 1.415, 0.012], [0.165, 0.075, 0.092], { bone: 'chest', k: 0.06 }), ell([0, 1.44, -0.05], [0.13, 0.07, 0.07], { bone: 'chest', k: 0.06 }));
  }
  if (v.gaunt) {
    center.push(ell([0, 1.37, -0.085], [0.11, 0.09, 0.06], { bone: 'chest', k: 0.05 })); // dowager's hump
    // Ribs that show through slack skin: raised bars curving round the front and sides of the cage.
    for (let i = 0; i < 6; i++) {
      const y = 1.36 - i * 0.034;
      for (const s of [-1, 1]) center.push(cap([s * 0.03, y + 0.01, 0.105 - i * 0.004], [s * 0.1, y - 0.012, 0.085], 0.009, 0.009, { bone: 'chest', k: 0.012 }), cap([s * 0.1, y - 0.012, 0.085], [s * 0.148, y - 0.035, 0.02], 0.009, 0.008, { bone: 'chest', k: 0.012 }));
    }
    center.push(cap([0, 1.42, 0.103], [0, 1.2, 0.106], 0.01, 0.012, { bone: 'chest', k: 0.015 }));       // sternum
    for (const s of [-1, 1]) center.push(cap([s * 0.026, 1.43, 0.036], [s * 0.014, 1.58, 0.05], 0.0095, 0.0075, { bone: 'neck', k: 0.012 })); // neck cords
    center.push(ell([0, 1.5, 0.052], [0.011, 0.015, 0.011], { bone: 'neck', k: 0.012 }));                  // Adam's apple
    for (const y of [1.47, 1.505, 1.54]) center.push(cap([-0.035, y, 0.045], [0.035, y + 0.004, 0.045], 0.0026, 0.0026, { sub: true, k: 0.004 })); // neck folds
    center.push(ell([0, 1.06, 0.07], [0.09, 0.05, 0.03], { sub: true, k: 0.03 }));                       // sunken belly
  }
  const parts = [...center, ...left, ...left.map(mirrorX)];
  if (v.brute) {
    // Carve abdominal and pectoral lines into the actual front surface (found by marching the field).
    const S = new SDF(parts.map((p) => ({ ...p })));
    const fz = (x, y) => { for (let z = 0.3; z > -0.1; z -= 0.0015) if (S.eval(x, y, z) < 0) return z; return 0.1; };
    const G = { sub: true, k: 0.007 };
    const groove = (pts, r) => { for (let i = 0; i < pts.length - 1; i++) parts.push(cap(pts[i], pts[i + 1], r, r, G)); };
    const on = (x, y, o = 0.0015) => [x, y, fz(x, y) + o];
    groove([on(0, 1.21), on(0, 1.13), on(0, 1.03)], 0.0055);                                   // linea alba
    for (const y of [1.165, 1.11, 1.055]) for (const sx of [-1, 1]) groove([on(sx * 0.008, y), on(sx * 0.03, y + 0.004), on(sx * 0.056, y + 0.008)], 0.0042);
    for (const sx of [-1, 1]) groove([on(sx * 0.012, 1.292), on(sx * 0.06, 1.276), on(sx * 0.11, 1.286), on(sx * 0.145, 1.31)], 0.0055); // under the pecs
    for (const sx of [-1, 1]) groove([on(sx * 0.062, 1.205, 0.001), on(sx * 0.07, 1.12, 0.001), on(sx * 0.064, 1.03, 0.001)], 0.005);   // edge of the abdominals
  }
  return parts;
}

const clipBody = (x, y, z, d) => smax(smax(d, -(y - 0.004), 0.008), y - 1.61, 0.008);

// ---------- head ----------
function headParts(F, v) {
  const s = F.cyclops ? 1 : 1;
  const P = [
    ell([0, 1.705, -0.012], [0.074, 0.094, 0.098], { k: 0.03 }),
    ell([0, 1.722, 0.04], [0.066, 0.05, 0.058], { k: 0.03 }),
    ell([0, 1.655, 0.035], [0.057 * F.jaw, 0.08, 0.068], { k: 0.03 }),
    ell([0, 1.606, 0.035], [0.056 * F.jaw, 0.034, 0.058], { k: 0.025 }),
    ell([0, 1.587, 0.08], [0.021 * F.chin, 0.02, 0.018], { k: 0.02 }),
    // nose: a narrow bony bridge running down to a defined tip
    ell([0, 1.657, 0.109], [0.0102 * F.nose, 0.0095 * F.nose, 0.0102 * F.nose], { k: 0.01 }),
    cap([0, 1.703, 0.094], [0, 1.664, 0.109 + 0.004 * (F.nose - 1)], 0.0062 * F.nose, 0.0088 * F.nose, { k: 0.01 }),
    // lips: a shaped upper lip with a philtrum above it, a fuller lower lip
    ell([0, 1.6295, 0.0985], [0.0205, 0.0056, 0.0105], { k: 0.006 }),
    ell([0, 1.6178, 0.0955], [0.0178, 0.0068, 0.0108], { k: 0.006 }),
    ell([0, 1.6395, 0.0985], [0.007, 0.006, 0.006], { k: 0.008 }),
    cap([0, 1.5, -0.005], [0, 1.62, 0.0], v.neck * 0.96, v.neck * 0.9, { k: 0.03 }),
  ];
  const side = [
    ell([0.048 * F.jaw, 1.626, -0.006], [0.018, 0.032, 0.028], { k: 0.025 }),
    ell([0.047, 1.672, 0.063], [0.024 * F.cheek, 0.014 * F.cheek, 0.021], { k: 0.02 }),
    ell([0.0105, 1.6545, 0.1025], [0.0075 * F.nose, 0.0068, 0.0078], { k: 0.007 }),
    cap([0.021, 1.583, 0.072], [0.056 * F.jaw, 1.612, 0.0], 0.0125, 0.014, { k: 0.016 }),           // mandible: a defined jaw line
    ell([0.054, 1.676, 0.052], [0.016, 0.009, 0.02], { k: 0.016 }),                                 // zygomatic arch
    ell([0.075, 1.672, -0.008], [0.008 * F.ears, 0.029 * F.ears, 0.017 * F.ears], { k: 0.008 }),
  ];
  if (!F.cyclops) side.push(cap([0.052, 1.707, 0.076], [0.008, 1.712, 0.09], 0.011 * F.brow, 0.0115 * F.brow, { k: 0.014 }));
  const all = [...P, ...side, ...side.map(mirrorX)];
  if (F.cyclops) all.push(cap([-0.05, 1.716, 0.083], [0.05, 1.716, 0.083], 0.016 * F.brow, 0.016 * F.brow, { k: 0.02 }));
  // carving
  const carve = [
    box([0, 1.6245, 0.104], [0.019, 0.0011, 0.012], 0.001, { sub: true, k: 0.002 }),
    ell([0.0075, 1.651, 0.111], [0.0038, 0.0028, 0.004], { sub: true, k: 0.004 }),
    ell([-0.0075, 1.651, 0.111], [0.0038, 0.0028, 0.004], { sub: true, k: 0.004 }),
    ell([0.074, 1.672, -0.006], [0.004 * F.ears, 0.018 * F.ears, 0.009 * F.ears], { sub: true, k: 0.004 }),
    ell([-0.074, 1.672, -0.006], [0.004 * F.ears, 0.018 * F.ears, 0.009 * F.ears], { sub: true, k: 0.004 }),
  ];
  if (F.cyclops) carve.push(ell([0, 1.688, 0.088], [0.03, 0.022, 0.02], { sub: true, k: 0.012 }));
  else for (const sx of [-1, 1]) {
    carve.push(ell([sx * 0.033, 1.6875, 0.092], [0.0165, 0.0115, 0.012], { sub: true, k: 0.01 }));
    carve.push(cap([sx * 0.02, 1.645, 0.103], [sx * 0.03, 1.622, 0.093], 0.0022, 0.0022, { sub: true, k: 0.006 }));   // nasolabial fold
    carve.push(ell([sx * 0.0215, 1.624, 0.095], [0.0025, 0.0022, 0.004], { sub: true, k: 0.003 }));                     // mouth corner
  }
  if (F.gaunt > 0.4) for (const sx of [-1, 1]) carve.push(ell([sx * 0.05, 1.637, 0.072], [0.018, 0.022, 0.014].map((r) => r * F.gaunt), { sub: true, k: 0.016 }));
  return [...all, ...carve];
}

// Regional skin colour baked into the head: red lips, flushed nose, cheeks and ears, a little shadow under
// the eyes, and feathered eyebrows, as multipliers on the skin tone.
function faceColors(geo) {
  const p = geo.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ax = Math.abs(x), front = smooth(0.04, 0.08, z);
    let r = 1, g = 1, b = 1;
    const lips = gauss(ax / 1.1, 0.02) * gauss(y - 1.6235, 0.0085) * smooth(0.085, 0.095, z);
    r *= 1 - 0.08 * lips; g *= 1 - 0.32 * lips; b *= 1 - 0.28 * lips;
    const flush = Math.max(gauss(ax - 0.042, 0.026) * gauss(y - 1.652, 0.026) * front * 0.7, gauss(ax, 0.012) * gauss(y - 1.657, 0.012) * smooth(0.1, 0.11, z), gauss(ax - 0.077, 0.012) * gauss(y - 1.672, 0.03));
    g *= 1 - 0.07 * flush; b *= 1 - 0.08 * flush;
    const under = gauss(ax - 0.033, 0.014) * gauss(y - 1.674, 0.006) * front;
    r *= 1 - 0.07 * under; g *= 1 - 0.09 * under; b *= 1 - 0.04 * under;
    // eyebrows: a tapering band over each eye, thicker toward the nose
    const t = clampN((ax - 0.012) / 0.044);
    const browY = 1.7105 + Math.sin(t * Math.PI) * 0.004 - t * 0.002, browW = 0.0045 * (1.2 - t * 0.6);
    const brow = (ax > 0.009 && ax < 0.06 ? 1 : 0) * gauss(y - browY, browW) * smooth(0.07, 0.085, z) * (0.55 + 0.45 * hash2(i * 7, 3));
    r *= 1 - 0.62 * brow; g *= 1 - 0.66 * brow; b *= 1 - 0.68 * brow;
    col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}
const clampN = (v) => Math.max(0, Math.min(1, v));
function smooth(e0, e1, x) { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }
const gauss = (d, w) => Math.exp(-(d * d) / (w * w));

// Expression morphs as relative deltas: jawOpen, browDown, browUp, frown, smile, squint.
export const MORPHS = ['jawOpen', 'browDown', 'browUp', 'frown', 'smile', 'squint'];
function addMorphs(geo, F) {
  const p = geo.attributes.position, n = p.count;
  const out = MORPHS.map(() => new Float32Array(n * 3));
  const hinge = [0, 1.652, 0.0], ang = 0.24, ca = Math.cos(ang), sa = Math.sin(ang);
  for (let i = 0; i < n; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const front = smooth(-0.02, 0.03, z);
    // jaw: lower face rotates about the hinge
    const wj = smooth(1.628, 1.616, y) * front * smooth(1.5, 1.56, y);
    const ry = y - hinge[1], rz = z - hinge[2];
    out[0][i * 3 + 1] = (ry * ca - rz * sa - ry) * wj; out[0][i * 3 + 2] = (ry * sa + rz * ca - rz) * wj;
    const ax = Math.abs(x), browW = gauss(y - 1.71, 0.012) * front * smooth(0.06, 0.08, z);
    out[1][i * 3 + 1] = -0.005 * browW * gauss(ax - 0.015, 0.025); out[1][i * 3 + 2] = 0.002 * browW * gauss(ax - 0.012, 0.02);
    out[2][i * 3 + 1] = 0.006 * browW * gauss(ax - 0.015, 0.03);
    const cornerW = gauss(ax - 0.022, 0.01) * gauss(y - 1.625, 0.008) * front;
    out[3][i * 3 + 1] = -0.0045 * cornerW;
    out[4][i * 3 + 1] = 0.003 * cornerW; out[4][i * 3] = 0.003 * cornerW * Math.sign(x);
    const lidW = gauss(ax - (F.cyclops ? 0 : 0.033), F.cyclops ? 0.03 : 0.016) * gauss(y - (F.cyclops ? 1.69 : 1.672), 0.01) * front;
    out[5][i * 3 + 1] = 0.0035 * lidW;
  }
  geo.morphAttributes.position = out.map((a) => new THREE.BufferAttribute(a, 3));
  geo.morphTargetsRelative = true;
}

// ---------- hands ----------
// The giant's hands: thin phalanges, swollen knuckles, raised tendons and nails on the back.
// Canonical right hand: hanging along -Y, palm facing +X, back of the hand toward -X.
function giantHandParts(v, mirror) {
  const hs = v.hand, L = hs * 1.3;
  const P = [
    cap([0, 0.025, 0], [0.002 * hs, -0.02 * hs, 0], 0.014 * hs, 0.0115 * hs, { k: 0.01 }),     // wrist, no wider than the forearm
    ell([0.004 * hs, -0.058 * hs, 0], [0.0075 * hs, 0.042 * hs, 0.031 * hs], { k: 0.008 }),    // flat, bony palm
    ell([0.01 * hs, -0.03 * hs, 0.026 * hs], [0.009 * hs, 0.018 * hs, 0.012 * hs], { k: 0.008 }), // thumb pad
    ell([-0.002 * hs, -0.012 * hs, 0], [0.0095 * hs, 0.008 * hs, 0.016 * hs], { k: 0.006 }),  // wrist bones
  ];
  const zs = [0.028, 0.0092, -0.0092, -0.027];
  const lens = [[0.044, 0.029, 0.021], [0.049, 0.032, 0.022], [0.046, 0.03, 0.021], [0.036, 0.024, 0.018]];
  zs.forEach((z, i) => {
    const kn = [-0.002 * hs, -0.094 * hs, z * hs];
    // tendon running over the back of the hand to each knuckle
    P.push(cap([-0.0065 * hs, -0.012 * hs, z * 0.45 * hs], [-0.007 * hs, -0.088 * hs, z * hs], 0.0026 * hs, 0.003 * hs, { k: 0.003 }));
    P.push(ell(kn, [0.0095 * hs, 0.009 * hs, 0.0088 * hs], { k: 0.006 }));
    let a = [0.003 * hs, -0.094 * hs, z * hs];
    const dirs = [[0.42, -0.9, 0], [0.96, -0.28, 0], [0.88, 0.47, 0]];
    for (let s = 0; s < 3; s++) {
      const r0 = (0.0068 - s * 0.0008) * hs;
      const d = dirs[s], b = add(a, d, lens[i][s] * L);
      // bony phalanx: thick at the joints, thin in the middle
      const mid = add(a, d, lens[i][s] * L * 0.5);
      P.push(cap(a, mid, r0 * 1.08, r0 * 0.78, { k: 0.003 }), cap(mid, b, r0 * 0.78, r0 * 1.02, { k: 0.003 }));
      P.push(ell(add(b, d, -0.001 * hs), [r0 * 1.12, r0 * 1.05, r0 * 1.12], { k: 0.003 }));      // knuckle
      if (s === 2) {
        const dorsal = [d[1], -d[0], 0];                                                   // side away from the palm
        P.push(ell(add(add(b, d, -0.006 * hs), dorsal, r0 * 0.75), [0.0055 * hs, 0.0055 * hs, 0.0055 * hs], { k: 0.002 }));  // nail
      }
      a = b;
    }
  });
  let t = [0.014 * hs, -0.028 * hs, 0.033 * hs];
  for (const [d, l, r] of [[[0.5, -0.5, 0.7], 0.036, 0.009], [[0.82, -0.12, 0.45], 0.03, 0.0078]]) {
    const b = add(t, d, l * L);
    P.push(cap(t, b, r * hs, r * hs * 0.88, { k: 0.005 }));
    P.push(ell(b, [r * hs * 1.3, r * hs * 1.3, r * hs * 1.3], { k: 0.004 }));
    t = b;
  }
  return mirror ? P.map(mirrorX) : P;
}

function handParts(v, mirror) {
  if (v.gaunt) return giantHandParts(v, mirror);
  const hs = v.hand, L = hs * (v.gaunt ? 1.12 : 1);
  const P = [
    cap([0, 0.025, 0], [0, -0.015, 0], 0.024 * hs, 0.026 * hs, { k: 0.015 }),
    ell([0.004 * hs, -0.052 * hs, 0], [0.016 * hs, 0.048 * hs, 0.041 * hs], { k: 0.018 }),
    ell([0.012 * hs, -0.03 * hs, 0.028 * hs], [0.014 * hs, 0.022 * hs, 0.016 * hs], { k: 0.012 }),
  ];
  const zs = [0.029, 0.0095, -0.0095, -0.028];
  const lens = [[0.042, 0.027, 0.02], [0.046, 0.03, 0.021], [0.044, 0.028, 0.02], [0.034, 0.022, 0.017]];
  zs.forEach((z, i) => {
    let a = [0.003 * hs, -0.094 * hs, z * hs];
    const dirs = [[0.42, -0.9, 0], [0.96, -0.28, 0], [0.88, 0.47, 0]];
    for (let s = 0; s < 3; s++) {
      const r0 = (0.0098 - s * 0.0009) * hs * (v.gaunt ? 0.85 : 1);
      const b = add(a, dirs[s], lens[i][s] * L);
      P.push(cap(a, b, r0, r0 * 0.93, { k: 0.006 }));
      if (v.gaunt) P.push(ell(b, [r0 * 1.15, r0 * 1.15, r0 * 1.15], { k: 0.004 }));
      a = b;
    }
  });
  let t = [0.015 * hs, -0.028 * hs, 0.034 * hs];
  for (const [d, l, r] of [[[0.5, -0.5, 0.7], 0.034, 0.011], [[0.82, -0.12, 0.45], 0.028, 0.0095]]) { const b = add(t, d, l * L); P.push(cap(t, b, r * hs, r * hs * 0.9, { k: 0.007 })); t = b; }
  return mirror ? P.map(mirrorX) : P;
}

// ---------- clothing / armour (inflated copies of body parts) ----------
function inflate(parts, t, filter) {
  return parts.filter(filter).map((p) => p.t === 'ell' ? { ...p, r: p.r.map((r) => r + t), k: p.k + 0.01 } : p.t === 'cap' ? { ...p, ra: p.ra + t, rb: p.rb + t, k: p.k + 0.01 } : p);
}
const isTorso = (p) => ['hips', 'spine', 'chest'].includes(p.bone) && !p.sub;

// ---------- textures ----------
const texCache = {};
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function heightToNormal(fn, n, str) {
  return canvasTex(n, n, (g) => {
    const img = g.createImageData(n, n), h = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) h[y * n + x] = fn(x / n, y / n, x, y);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const l = h[y * n + ((x - 1 + n) % n)], r = h[y * n + ((x + 1) % n)], u = h[((y - 1 + n) % n) * n + x], d = h[((y + 1) % n) * n + x];
      const nx = (l - r) * str, ny = (d - u) * str, L = Math.hypot(nx, ny, 1), i = (y * n + x) * 4;
      img.data[i] = (nx / L * 0.5 + 0.5) * 255; img.data[i + 1] = (ny / L * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / L * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, false);
}
function heightTex(fn, n) {
  return canvasTex(n, n, (g) => {
    const img = g.createImageData(n, n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const v = Math.max(0, Math.min(255, fn(x / n, y / n, x, y) * 255)), i = (y * n + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    g.putImageData(img, 0, 0);
  }, false);
}
export function anatomyTex() {
  if (texCache.ready) return texCache;
  texCache.poresH = heightTex((u, v, x, y) => tfbm(u, v, 32, 2) * 0.55 + hash2(x, y) * 0.3 + Math.max(0, tfbm(u + 0.4, v, 8, 3) - 0.55) * 0.6, 256);
  texCache.pores = heightToNormal((u, v, x, y) => tfbm(u, v, 32, 2) * 0.6 + hash2(x, y) * 0.4, 256, 2.2);
  texCache.wrinkles = heightToNormal((u, v) => Math.sin(v * 24 * Math.PI + tfbm(u, v, 4, 3) * 10) * 0.35 * tfbm(u + 0.3, v, 4, 2) + tfbm(u, v, 16, 3) * 0.6, 256, 2.2);
  texCache.folds = heightToNormal((u, v) => Math.sin(u * 60 + tfbm(u, v, 4, 3) * 4) * 0.7 + tfbm(u, v, 16, 2) * 0.3, 256, 2.4);
  texCache.engraved = heightToNormal((u, v, x, y) => {
    const band = Math.abs(((v * 6) % 1) - 0.5) < 0.08 ? 1 : 0;
    const mx = Math.floor(u * 48) % 4, my = Math.floor(v * 48) % 4;
    return band * 0.6 + ((mx === 0 || my === 0) && ((v * 6) % 1) > 0.6 && ((v * 6) % 1) < 0.9 ? 0.5 : 0) + hash2(x, y) * 0.08;
  }, 256, 4);
  texCache.strands = canvasTex(64, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * w, len = h * (0.55 + Math.random() * 0.45), a = 0.5 + Math.random() * 0.5;
      g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = 1 + Math.random() * 1.6;
      g.beginPath(); g.moveTo(x, 0); g.quadraticCurveTo(x + (Math.random() - 0.5) * 10, len * 0.5, x + (Math.random() - 0.5) * 16, len); g.stroke();
    }
  });
  texCache.ready = true;
  return texCache;
}
// A real iris for the giant: sharp pupil, radial fibres, crypts, collarette, dark limbal ring,
// yellowed sclera with red veins running in toward it. (Latitude mapping: row 0 = front pole.)
function giantIrisTex(color) {
  return canvasTex(512, 512, (g, w, h) => {
    const R = rng(907);
    const sc = g.createLinearGradient(0, 0, 0, h); sc.addColorStop(0, '#efe3cc'); sc.addColorStop(0.35, '#e2cfb0'); sc.addColorStop(1, '#c79a86');
    g.fillStyle = sc; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      let x = R() * w, y = h * (0.75 + R() * 0.2), lw = 1.2 + R() * 2.4;
      g.strokeStyle = `rgba(${150 + R() * 50},${20 + R() * 25},${20 + R() * 20},${0.35 + R() * 0.45})`;
      while (y > h * 0.165 && lw > 0.3) {
        const nx = x + (R() - 0.5) * 22, ny = y - (8 + R() * 18);
        g.lineWidth = lw; g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
        if (R() < 0.18) { g.lineWidth = lw * 0.6; g.beginPath(); g.moveTo(nx, ny); g.lineTo(nx + (R() - 0.5) * 30, ny - 12); g.stroke(); }
        x = nx; y = ny; lw *= 0.9;
      }
    }
    const top = h * 0.15, pup = h * 0.05;
    const ir = g.createLinearGradient(0, pup, 0, top);
    ir.addColorStop(0, '#3a1e0a'); ir.addColorStop(0.18, color); ir.addColorStop(0.45, '#d6923e'); ir.addColorStop(0.55, '#a8621f'); ir.addColorStop(0.85, '#6a3a14'); ir.addColorStop(1, '#2a1608');
    g.fillStyle = ir; g.fillRect(0, pup, w, top - pup);
    for (let i = 0; i < 420; i++) {
      const x = R() * w, a = R();
      g.strokeStyle = a < 0.5 ? `rgba(255,215,150,${0.12 + R() * 0.25})` : `rgba(40,18,6,${0.15 + R() * 0.3})`;
      g.lineWidth = 0.6 + R() * 1.4; g.beginPath(); g.moveTo(x, pup + R() * 6); g.lineTo(x + (R() - 0.5) * 3, top - R() * 10); g.stroke();
    }
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(30,12,4,${0.25 + R() * 0.3})`; g.beginPath(); g.ellipse(R() * w, pup + (top - pup) * (0.3 + R() * 0.5), 2 + R() * 5, 3 + R() * 6, 0, 0, 7); g.fill(); }
    const lim = g.createLinearGradient(0, top - h * 0.02, 0, top + h * 0.025); lim.addColorStop(0, 'rgba(25,12,5,0)'); lim.addColorStop(0.45, 'rgba(25,12,5,0.9)'); lim.addColorStop(1, 'rgba(25,12,5,0)');
    g.fillStyle = lim; g.fillRect(0, top - h * 0.02, w, h * 0.045);
    g.fillStyle = '#030201'; g.fillRect(0, 0, w, pup);
  });
}
function irisTex(color, giant) {
  if (giant) return giantIrisTex(color);
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = giant ? '#e9dcc8' : '#f1ebe0'; g.fillRect(0, 0, w, h);
    g.strokeStyle = giant ? 'rgba(160,30,20,0.55)' : 'rgba(170,60,50,0.18)'; g.lineWidth = giant ? 1.4 : 0.8;
    for (let i = 0; i < (giant ? 40 : 10); i++) { const x = Math.random() * w; g.beginPath(); g.moveTo(x, h); g.quadraticCurveTo(x + (Math.random() - 0.5) * 30, h * 0.55, x + (Math.random() - 0.5) * 20, h * 0.25); g.stroke(); }
    const top = h * (giant ? 0.16 : 0.3);
    const grd = g.createLinearGradient(0, 0, 0, top); grd.addColorStop(0, '#000'); grd.addColorStop(0.32, '#000'); grd.addColorStop(0.36, color); grd.addColorStop(1, '#1a120a');
    g.fillStyle = grd; g.fillRect(0, 0, w, top);
    g.strokeStyle = 'rgba(255,230,180,0.25)'; for (let i = 0; i < 60; i++) { const x = (i / 60) * w; g.beginPath(); g.moveTo(x, top * 0.36); g.lineTo(x + 2, top); g.stroke(); }
  });
}
function detailTex(seed, { dirt = 0.4, scars = 0, burn = 0.2, grey = 0 } = {}) {
  const R = rng(seed);
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260 * dirt; i++) { const y = h * (0.45 + R() * 0.55); g.fillStyle = `rgba(${90 + R() * 40},${70 + R() * 30},50,${R() * 0.12})`; g.beginPath(); g.ellipse(R() * w, y, 2 + R() * 14, 2 + R() * 8, R() * 3, 0, 7); g.fill(); }
    for (let i = 0; i < 160 * burn; i++) { g.fillStyle = `rgba(200,90,60,${R() * 0.07})`; g.beginPath(); g.arc(R() * w, R() * h * 0.45, 4 + R() * 20, 0, 7); g.fill(); }
    for (let i = 0; i < 700 * grey; i++) { g.fillStyle = `rgba(120,100,90,${R() * 0.12})`; g.fillRect(R() * w, R() * h, 1 + R() * 3, 1 + R() * 3); }
    g.strokeStyle = 'rgba(230,170,160,0.75)';
    for (let i = 0; i < scars; i++) { g.lineWidth = 1 + R() * 2; const x = R() * w, y = R() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 40, y + (R() - 0.5) * 18); g.stroke(); }
  });
}

// ---------- materials ----------
// Triplanar skin: the albedo detail and the pore bump are projected along three axes in bind-pose
// object space and blended by the normal, so nothing stretches over shoulders, scalps or the tops of
// feet the way the old cylindrical UVs did (most visible on the 4.4x-scale giant).
const TRI_FN = `vec4 triTex(sampler2D t, vec3 p, vec3 n) {
  vec3 w = pow(abs(normalize(n)), vec3(4.0)); w /= (w.x + w.y + w.z);
  return texture2D(t, p.zy) * w.x + texture2D(t, p.xz) * w.y + texture2D(t, p.xy) * w.z;
}
`;
function triplanar(m, detailScale, poreScale) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTriScale = { value: detailScale }; sh.uniforms.uTriPore = { value: poreScale };
    sh.vertexShader = 'varying vec3 vTriP;\nvarying vec3 vTriN;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vTriP = position; vTriN = normal;');
    sh.fragmentShader = 'uniform float uTriScale;\nuniform float uTriPore;\nvarying vec3 vTriP;\nvarying vec3 vTriN;\n' + TRI_FN + sh.fragmentShader
      .replace('#include <map_fragment>', '#ifdef USE_MAP\n  diffuseColor *= triTex(map, vTriP * uTriScale, vTriN);\n#endif')
      .replace('#include <bumpmap_pars_fragment>', THREE.ShaderChunk.bumpmap_pars_fragment.replace(/vec2 dHdxy_fwd\(\) \{[\s\S]*?return vec2\( dBx, dBy \);\s*\}/, 'vec2 dHdxy_fwd() { float H = bumpScale * triTex(bumpMap, vTriP * uTriPore, vTriN).x; return vec2(dFdx(H), dFdy(H)); }'));
  };
  return m;
}
export function skinMaterial(hex, seed, opts = {}) {
  const T = anatomyTex();
  const m = new THREE.MeshPhysicalMaterial({
    vertexColors: !!opts.face,
    color: hex, roughness: opts.old ? 0.6 : 0.44, map: detailTex(seed, opts),
    bumpMap: T.poresH, bumpScale: opts.giant ? 1.2 : 0.8,
    sheen: 0.18, sheenColor: new THREE.Color(0xff8f70), sheenRoughness: 0.6,
  });
  triplanar(m, 2.2, opts.giant ? 42 : 30);
  return patchMaterial(m, { rim: true, wrap: true });
}
export function clothMaterial(hex) {
  const T = anatomyTex();
  return patchMaterial(new THREE.MeshStandardMaterial({ color: hex, map: Tex.linen, normalMap: T.folds, normalScale: new THREE.Vector2(1.1, 1.1), roughness: 0.9, side: THREE.DoubleSide }));
}
export function armourMaterial() {
  const T = anatomyTex();
  // weathered, darkened bronze rather than a polished mirror
  return patchMaterial(new THREE.MeshStandardMaterial({ color: 0x9a7a5c, map: Tex.bronze, normalMap: T.engraved, normalScale: new THREE.Vector2(0.9, 0.9), metalness: 0.85, roughness: 0.5, roughnessMap: Tex.bronzeR }));
}
const hairMats = new Map();
const scalpMats = new Map();
export function scalpMaterial(hex) {
  if (!scalpMats.has(hex)) scalpMats.set(hex, patchMaterial(new THREE.MeshStandardMaterial({ color: new THREE.Color(hex).multiplyScalar(0.8), normalMap: Tex.furN, normalScale: new THREE.Vector2(1.4, 1.4), roughness: 0.75 })));
  return scalpMats.get(hex);
}
export function hairCardMaterial(hex) {
  if (hairMats.has(hex)) return hairMats.get(hex);
  const T = anatomyTex();
  const m = new THREE.MeshPhysicalMaterial({ color: hex, alphaMap: T.strands, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.55, anisotropy: 0.7, sheen: 0.3, sheenColor: new THREE.Color(hex).multiplyScalar(1.4) });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shaderTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float tip = 1.0 - uv.y;
      transformed.x += sin(uTime * 2.1 + position.y * 40.0) * 0.0025 * tip;
      transformed.z += sin(uTime * 1.7 + position.x * 30.0) * 0.002 * tip;`);
  };
  m.customProgramCacheKey = () => 'nostos-hair';
  hairMats.set(hex, m);
  return m;
}

// ---------- hair & beard cards ----------
// A strip of hair that flows along the surface: root just under the scalp, direction tangent to it,
// width lying in the tangent plane so the card hugs the head instead of sticking out.
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// Keep a point at least `off` outside an ellipsoid shell (hair lies on the skull, beards on the jaw).
function onShell(q, sh, off) {
  const dx = (q[0] - sh.c[0]) / (sh.r[0] + off), dy = (q[1] - sh.c[1]) / (sh.r[1] + off), dz = (q[2] - sh.c[2]) / (sh.r[2] + off), k = Math.hypot(dx, dy, dz);
  if (k >= 1 || k < 1e-4) return q;
  return [sh.c[0] + dx / k * (sh.r[0] + off), sh.c[1] + dy / k * (sh.r[1] + off), sh.c[2] + dz / k * (sh.r[2] + off)];
}
function cardStrip(root, dir, sag, len, width, out, side = null, shell = null) {
  const seg = 4, pts = [];
  let p = root.slice(), d = norm(dir);
  for (let i = 0; i <= seg; i++) {
    // each step is pushed back onto the shell, a little further out toward the tip so layers stack
    if (shell && i > 0) p = onShell(p, shell, 0.003 + (i / seg) * 0.006);
    pts.push(p.slice()); p = add(p, d, len / seg); d = norm([d[0], d[1] - sag, d[2]]);
  }
  const s0 = norm(side || [dir[2], 0, -dir[0]]).map((c) => c * width * 0.5);
  const base = out.pos.length / 3;
  pts.forEach((q, i) => {
    const w = 1 - (i / seg) * 0.45;
    out.pos.push(q[0] - s0[0] * w, q[1] - s0[1] * w, q[2] - s0[2] * w, q[0] + s0[0] * w, q[1] + s0[1] * w, q[2] + s0[2] * w);
    out.uv.push(0, 1 - i / seg, 1, 1 - i / seg);
  });
  for (let i = 0; i < seg; i++) { const a = base + i * 2; out.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
}
const CRANIUM = { c: [0, 1.705, -0.012], r: [0.078, 0.098, 0.102] };
export function hairGeometry(style, seed) {
  const R = rng(seed), out = { pos: [], uv: [], idx: [] };
  const { c, r } = CRANIUM;
  const n = style.sparse ? 40 : style.long ? 240 : 220;
  const skull = { c: CRANIUM.c, r: CRANIUM.r };
  for (let i = 0; i < n; i++) {
    // sample the scalp: angle around (th) and down from the crown (ph)
    const th = style.sparse ? (R() < 0.5 ? 1 : -1) * (1.3 + R() * 1.5) : (R() - 0.5) * Math.PI * 2;
    const ph = style.sparse ? 1.15 + R() * 0.55 : R() * 1.25;
    const front = Math.cos(th);
    if (!style.sparse && front > 0.35 && ph > 0.62 + (1 - front) * 0.5) continue; // hairline: keep the brow clear
    const nrm = norm([Math.sin(ph) * Math.sin(th) / r[0], Math.cos(ph) / r[1], Math.sin(ph) * Math.cos(th) / r[2]]);
    const surf = [c[0] + r[0] * Math.sin(ph) * Math.sin(th), c[1] + r[1] * Math.cos(ph), c[2] + r[2] * Math.sin(ph) * Math.cos(th)];
    const root = add(surf, nrm, 0.002);
    let flow = norm([Math.sin(th) * 0.4, -0.55, -0.8 + front * 0.3]);
    if (front > 0.2 && ph < 0.6) flow = norm([Math.sin(th) * 0.3, -0.2, 0.9]); // fringe combs forward a little
    const dot = flow[0] * nrm[0] + flow[1] * nrm[1] + flow[2] * nrm[2];
    const tang = norm(add(add(flow, nrm, -dot), nrm, 0.03));
    const len = (style.long ? 0.12 : style.sparse ? 0.09 : 0.055) * (0.7 + R() * 0.5);
    cardStrip(root, tang, style.long ? 0.3 : 0.12, len, style.sparse ? 0.012 : 0.03, out, cross(nrm, tang), skull);
  }
  if (style.beard && style.beard !== 'none') {
    const len = style.beard === 'long' ? 0.12 : style.beard === 'full' ? 0.075 : 0.035;
    const m = style.beard === 'short' ? 0 : style.beard === 'full' ? 50 : 90;
    const jaw = { c: [0, 1.62, 0.03], r: [0.06, 0.062, 0.07] };
    for (let i = 0; i < m; i++) {
      const a = (R() - 0.5) * 1.9;
      const y = 1.575 + R() * 0.02;
      if (Math.abs(a) < 0.32 && y > 1.612 && y < 1.64) continue; // keep the lips clear
      const nrm = norm([Math.sin(a), -0.25, Math.cos(a)]);
      const root = [Math.sin(a) * 0.058, y, 0.032 + Math.cos(a) * 0.056];
      const down = norm([Math.sin(a) * 0.15, -1, Math.cos(a) * 0.3]);
      cardStrip(root, down, 0.03, len * (0.6 + R() * 0.6), 0.018, out, cross(nrm, down), jaw);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
  g.setIndex(out.idx);
  g.computeVertexNormals();
  g.translate(0, -1.58, 0);
  return g;
}
// Opaque scalp cap under the cards so no skin shows through, and a beard mass for full beards.
export function scalpGeometry(beard) {
  const parts = [];
  const cap = new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.56);
  cap.rotateX(-0.42);
  cap.scale(CRANIUM.r[0] + 0.004, CRANIUM.r[1] + 0.004, CRANIUM.r[2] + 0.004);
  cap.translate(CRANIUM.c[0], CRANIUM.c[1], CRANIUM.c[2] - 0.004);
  parts.push(cap);
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  g.translate(0, -1.58, 0);
  return g;
}
// Sculpted beard: the jaw, chin and upper lip grown outward by the beard's thickness, cut along the
// cheek line (higher at the sideburns), open at the mouth, with a ragged lower edge for longer beards.
export function beardGeometry(face, variant, beard) {
  return memo(`beard:${face}:${variant}:${beard}`, () => {
    const F = FACES[face], v = VARIANTS[variant];
    const t = beard === 'long' ? 0.011 : beard === 'full' ? 0.0085 : 0.0045, drop = beard === 'long' ? 0.05 : beard === 'full' ? 0.022 : 0.004;
    const lower = headParts(F, v).filter((q) => !q.sub && (q.c ? q.c[1] < 1.66 : q.a[1] < 1.66) && !(q.c && q.c[1] < 1.52));
    const parts = inflate(lower, t, () => true);
    parts.push(ell([0, 1.592 - drop * 0.5, 0.07], [0.034, 0.02 + drop * 0.6, 0.03], { k: 0.02 }));   // chin mass
    parts.push(ell([0, 1.623, 0.105], [0.019, 0.0075, 0.012], { sub: true, k: 0.004 }));             // mouth stays open
    const sdf = new SDF(parts, (x, y, z, d) => {
      const cheek = 1.645 + Math.abs(x) * 0.55 - Math.max(0, z - 0.06) * 0.25;            // cheek line, rising to the sideburns
      const back = z + 0.028;                                                                    // nothing behind the ears
      const rag = (noise2(x * 140, z * 140) - 0.5) * drop * 0.8;
      return smax(smax(smax(d, y - cheek, 0.004), -back, 0.006), -(y - (1.555 - drop + rag)), 0.004);
    });
    const geo = meshSDF(sdf, [-0.1, 1.5, -0.06], [0.1, 1.68, 0.14], 0.0032, { project: 1 });
    cylUV(geo, 10);
    geo.translate(0, -1.58, 0);
    return geo;
  });
}

// ---------- builders (cached) ----------
const cache = new Map();
const memo = (k, f) => { if (!cache.has(k)) cache.set(k, f()); return cache.get(k); };

export function bodyGeometry(name) {
  return memo('body:' + name, () => {
    const v = VARIANTS[name], sdf = new SDF(bodyParts(v), clipBody);
    const J = joints(v), reach = J.wr[0] + 0.07;
    const geo = meshSDF(sdf, [-reach, -0.01, -0.22], [reach, 1.63, 0.26], v.hiRes ? 0.0085 : v.gaunt ? 0.0095 : 0.014, { project: v.hiRes ? 2 : 1 });
    cylUV(geo, 1.4);
    skinBySDF(geo, sdf, BI, { sigma: v.gaunt ? 0.024 : v.brute ? 0.017 : 0.012 });
    return { geo, sdf };
  });
}
export function clothGeometry(name, kind) {
  return memo(`cloth:${name}:${kind}`, () => {
    const v = VARIANTS[name], body = bodyGeometry(name), base = bodyParts(v), J = joints(v);
    let parts, clip, hemY = 0.6;
    if (kind === 'tunic') {
      // the pectorals stay inside the cloth but spread into one broad, soft chest instead of two bumps
      const pec = (p) => p.t === 'ell' && p.c[1] > 1.3 && p.c[2] > 0.05 && Math.abs(p.c[0]) > 0.03;
      parts = inflate(base, 0.014, (p) => isTorso(p)).map((p) => pec(p) ? { ...p, c: [p.c[0] * 0.6, p.c[1], p.c[2]], r: [p.r[0] + 0.03, p.r[1] + 0.03, p.r[2]], k: 0.07 } : p);
      // short sleeves: loose tubes down the top of each upper arm
      for (const s of [1, -1]) {
        const sh = [s * J.sh[0], J.sh[1], 0], dir = [s * J.dir[0], J.dir[1], 0];
        parts.push(cap(add(sh, dir, -0.03), add(sh, dir, v.arm[0] * 0.42), 0.076 * v.g * (0.9 + v.mus * 0.15), 0.06 * v.g * (0.9 + v.mus * 0.12), { bone: s > 0 ? 'lSh' : 'rSh', k: 0.035 }));
      }
      parts.push(cap([0, 1.02, 0], [0, 0.64, -0.01], 0.168 * v.g, 0.218 * v.g, { bone: 'hips', k: 0.06 }));
      parts.push(cap([0, 1.49, 0.012], [0, 1.7, 0.02], 0.064, 0.064, { sub: true, k: 0.015 }));
      hemY = 0.64;
      clip = (x, y, z, d) => smax(smax(d, -(y - hemY), 0.01), y - 1.5, 0.01);
    } else if (kind === 'cuirass') {
      parts = inflate(base, 0.028, (p) => ['spine', 'chest'].includes(p.bone) && !p.sub && p.t === 'ell');
      for (const s of [-1, 1]) parts.push(cap([s * v.sh, 1.44, 0], [s * (v.sh + 0.05), 1.3, 0], 0.075, 0.07, { sub: true, k: 0.02 }));
      parts.push(cap([0, 1.46, 0.02], [0, 1.7, 0.02], 0.07, 0.07, { sub: true, k: 0.02 }));
      hemY = 1.02; clip = (x, y, z, d) => smax(smax(d, -(y - hemY), 0.01), y - 1.49, 0.01);
    } else if (kind === 'greaves') {
      parts = inflate(base, 0.007, (p) => (p.bone === 'lKn' || p.bone === 'rKn') && p.t !== 'ell' || (p.bone === 'lKn' || p.bone === 'rKn') && p.c && p.c[1] < 0.45);
      hemY = 0.14; clip = (x, y, z, d) => smax(smax(d, -(y - hemY), 0.01), y - 0.46, 0.01);
    } else if (kind === 'bracers') {
      parts = inflate(base, 0.007, (p) => (p.bone === 'lEl' || p.bone === 'rEl') && p.t === 'cap');
      const lowY = J.wr[1] + 0.015, highY = J.el[1] - 0.08;
      hemY = lowY; clip = (x, y, z, d) => smax(smax(d, -(y - lowY), 0.008), y - highY, 0.008);
    } else if (kind === 'loincloth') {
      parts = inflate(base, 0.03, (p) => p.bone === 'hips' && !p.sub);
      parts.push(cap([0, 1.0, 0], [0, 0.74, -0.01], 0.16 * v.g, 0.24 * Math.max(1, v.g * 0.95), { bone: 'hips', k: 0.05 }));
      hemY = 0.7;
      // a ragged hide hem: longer at the front and back, torn short over the hips
      const hem = (x, z) => { const a = Math.atan2(x, z); return 0.76 - 0.04 * Math.cos(2 * a) + 0.016 * Math.sin(a * 7 + 1) + 0.01 * Math.sin(a * 13); };
      clip = (x, y, z, d) => smax(smax(d, -(y - hem(x, z)), 0.012), y - 1.06, 0.01);
    }
    const sdf = new SDF(parts, clip);
    const reach = J.wr[0] + 0.1;
    const geo = meshSDF(sdf, [-reach, hemY - 0.03, -0.24], [reach, 1.56, 0.26], kind === 'tunic' || kind === 'loincloth' ? 0.015 : 0.012, { project: 1 });
    cullFaces(geo, (x, y, z, ny) => (y < hemY + 0.02 && ny < -0.4) || (kind !== 'loincloth' && kind !== 'tunic' && y > 1.47 && ny > 0.4));
    cylUV(geo, 3);
    // Weights from the body underneath; skirts lean on the hips so they don't split between the legs.
    skinBySDF(geo, body.sdf, BI, {
      // only skirts lean on the hips; greaves and bracers must follow their own limb exactly
      bias: kind === 'tunic' || kind === 'loincloth' ? (x, y, z, acc, bi) => { if (y < 0.93) acc[bi.hips] += 0.25 * (0.93 - y) / 0.3; } : null,
      sigma: kind === 'tunic' || kind === 'loincloth' ? 0.02 : 0.008,
    });
    return geo;
  });
}
export function headGeometry(face, variant) {
  return memo(`head:${face}:${variant}`, () => {
    const F = FACES[face], v = VARIANTS[variant];
    if (F.cyclops) {
      const sdf = new SDF(giantHeadParts(v), (x, y, z, d) => smax(d, -(y - 1.555 + Math.max(0, z) * 0.35), 0.006));
      const geo = meshSDF(sdf, [-0.11, 1.54, -0.135], [0.11, 1.83, 0.145], 0.003, { project: 2 });
      faceUV(geo);
      addMorphs(geo, F);
      geo.translate(0, -1.58, 0);
      return geo;
    }
    const sdf = new SDF(headParts(F, v), (x, y, z, d) => smax(d, -(y - 1.53), 0.006));
    const geo = meshSDF(sdf, [-0.105, 1.52, -0.125], [0.105, 1.825, 0.135], 0.0046, { project: 1 });
    cylUV(geo, 6, [0, 0.0]);
    faceColors(geo);
    addMorphs(geo, F);
    geo.translate(0, -1.58, 0);
    return geo;
  });
}
export function handGeometry(variant, mirror) {
  return memo(`hand:${variant}:${mirror}`, () => {
    const v = VARIANTS[variant], hs = v.hand * (v.gaunt ? 1.12 : 1);
    const sdf = new SDF(handParts(v, mirror));
    const geo = meshSDF(sdf, [-0.085 * hs, -0.19 * hs, -0.07 * hs], [0.085 * hs, 0.035 * hs, 0.08 * hs], (v.gaunt ? 0.0024 : 0.0038) * Math.max(1, hs * 0.8), { project: v.gaunt ? 2 : 1 });
    cylUV(geo, 8);
    return geo;
  });
}
export function eyeParts(irisColor, giant) {
  const key = `eye:${irisColor}:${giant}`;
  return memo(key, () => {
    const r = giant ? EYE_R : 0.0112;
    const ball = new THREE.SphereGeometry(r, 24, 16); ball.rotateX(Math.PI / 2);
    const mat = new THREE.MeshPhysicalMaterial({ map: irisTex(irisColor, giant), roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.4 });
    // Wet cornea: a slightly larger shell that adds only reflections and the fire's catchlight.
    const cornea = new THREE.SphereGeometry(r * 1.03, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.42); cornea.rotateX(Math.PI / 2);
    const corneaMat = new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.02, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.0, specularIntensity: 1, envMapIntensity: 2.5, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const lid = new THREE.SphereGeometry(r * 1.12, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
    const lower = new THREE.SphereGeometry(r * 1.1, 20, 8, 0, Math.PI * 2, Math.PI * 0.68, Math.PI * 0.32);
    const pupil = new THREE.CircleGeometry(r * 0.2, 28);
    return { r, ball, mat, lid, lower, pupil, cornea, corneaMat };
  });
}
export const BONE_INDEX = BI;

// Which build and face a character look resolves to (mirrors Humanoid).
export function kindsFor(look = {}) {
  const cyc = !!look.cyclops, hero = look.cap === 'helmet', grey = look.grey || 0;
  const variant = cyc ? 'giant' : hero ? 'hero' : grey > 0.6 ? 'old' : (look.build || 1) > 1.1 ? 'stocky' : 'lean';
  const face = cyc ? 'giant' : hero ? 'hero' : grey > 0.6 ? 'old' : look.beard === 'none' ? 'young' : 'mid';
  return { variant, face, cyc, hero };
}
// Sculpt everything a scene needs ahead of time, yielding between pieces so the page stays responsive.
export async function prebuild(looks, onStep) {
  const jobs = [];
  const seen = new Set();
  const push = (k, f) => { if (!seen.has(k) && !cache.has(k)) { seen.add(k); jobs.push(f); } };
  for (const l of looks) {
    const { variant, face, cyc, hero } = kindsFor(l);
    push('body:' + variant, () => bodyGeometry(variant));
    push('cloth:' + variant + (cyc ? 'loin' : 'tunic'), () => clothGeometry(variant, cyc ? 'loincloth' : 'tunic'));
    if (hero) for (const k of ['cuirass', 'greaves', 'bracers']) push('cloth:' + variant + k, () => clothGeometry(variant, k));
    push('head:' + face + variant, () => headGeometry(face, variant));
    if (!cyc && l.beard && l.beard !== 'none') push('beard:' + face + variant + l.beard, () => beardGeometry(face, variant, l.beard));
    push('handL' + variant, () => handGeometry(variant, true));
    push('handR' + variant, () => handGeometry(variant, false));
  }
  for (let i = 0; i < jobs.length; i++) { jobs[i](); onStep?.(i + 1, jobs.length); await new Promise((r) => setTimeout(r, 0)); }
}
export { mergeGeometries };
