import * as THREE from 'three';
import { ell, cap, box, mirrorX } from './Sculpt.js';
import { tfbm, hash2, rng } from '../core/math.js';

// The Cyclops' head: a brutal, bald face with a heavy brow over a single bloodshot eye, a broad jaw and a bull neck.
// Large forms are sculpted (lid hoods, furrows, folds, jowls, neck cords); fine lines are painted
// into a face-specific height/cavity map that is projected frontally (see faceUV).

export const EYE_Y = 1.708, EYE_Z = 0.083, EYE_R = 0.028;

// Arc of capsules following a curve: pts are [x, y, z] samples, r radius.
function arc(pts, r, o) { const out = []; for (let i = 0; i < pts.length - 1; i++) out.push(cap(pts[i], pts[i + 1], r, r, o)); return out; }
// Points on the face surface around a centre, following an ellipse in x/y, pushed out to z by a dome.
function ring(cx, cy, rx, ry, a0, a1, n, zAt) {
  const p = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); const x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry; p.push([x, y, zAt(x, y)]); }
  return p;
}

export function giantHeadParts(v) {
  // Approximate front surface depth used to seat furrows on the skin.
  const foreZ = (x, y) => 0.104 - x * x * 7.5 - Math.max(0, y - 1.765) * 0.6;
  const faceZ = (x, y) => 0.1 - x * x * 9;
  const P = [
    ell([0, 1.716, -0.022], [0.08, 0.098, 0.1], { k: 0.03 }),                     // bald cranium
    ell([0, 1.748, 0.046], [0.066, 0.038, 0.056], { k: 0.03 }),                   // forehead
    ell([0, 1.655, 0.036], [0.064, 0.085, 0.066], { k: 0.03 }),                   // face mass
    ell([0, 1.601, 0.03], [0.059, 0.036, 0.061], { k: 0.026 }),                   // broad jaw
    ell([0, 1.586, 0.075], [0.024, 0.017, 0.017], { k: 0.016 }),                  // square chin
    // single eye: baggy lower lid (the heavy upper lid and brow are added after the socket is carved)
    ell([0, 1.673, 0.088], [0.037, 0.0095, 0.017], { k: 0.01 }),
    // nose: broad and heavy, flattened at the bridge
    cap([0, 1.688, 0.101], [0, 1.652, 0.118], 0.0105, 0.0125, { k: 0.014 }),
    ell([0, 1.643, 0.117], [0.0165, 0.0125, 0.0125], { k: 0.012 }),
    ell([0, 1.634, 0.11], [0.009, 0.006, 0.008], { k: 0.006 }),                   // columella
    // full, downturned lips
    ell([0, 1.6195, 0.1015], [0.0185, 0.0058, 0.0105], { k: 0.006 }),
    ell([0, 1.609, 0.0985], [0.0165, 0.0068, 0.0105], { k: 0.006 }),
    // thick bull neck
    cap([0, 1.48, -0.006], [0, 1.6, 0.014], 0.066, 0.058, { k: 0.03 }),
  ];
  const side = [
    ell([0.0155, 1.639, 0.108], [0.0115, 0.0095, 0.0098], { k: 0.01 }),         // alae
    ell([0.05, 1.672, 0.054], [0.024, 0.009, 0.015], { k: 0.03 }),             // heavy cheekbone
    ell([0.048, 1.618, 0.02], [0.012, 0.028, 0.026], { k: 0.03 }),             // masseter
    ell([0.049, 1.593, 0.002], [0.015, 0.016, 0.022], { k: 0.016 }),            // jaw angle
    ell([0.03, 1.598, 0.066], [0.012, 0.01, 0.012], { k: 0.022 }),             // jowl at the jawline
    ell([0.079, 1.686, -0.012], [0.0085, 0.031, 0.02], { k: 0.008 }),           // ear
    cap([0.016, 1.492, 0.052], [0.05, 1.598, -0.012], 0.0125, 0.0105, { k: 0.012 }), // neck cord (sternomastoid)
    ell([0.026, 1.682, 0.084], [0.012, 0.006, 0.007], { k: 0.016 }),            // soft bags under the eye line
  ];
  const parts = [...P, ...side, ...side.map(mirrorX)];

  const sub = { sub: true };
  const carve = [
    ell([0, EYE_Y - 0.006, 0.097], [0.034, 0.027, 0.019], { ...sub, k: 0.008 }), // eye socket: deep, round lower curve
    box([0, 1.6142, 0.107], [0.0155, 0.0007, 0.01], 0.0008, { ...sub, k: 0.0015 }), // mouth line
    ell([0.0078, 1.6345, 0.112], [0.0042, 0.003, 0.0045], { ...sub, k: 0.004 }),   // nostrils
    ell([-0.0078, 1.6345, 0.112], [0.0042, 0.003, 0.0045], { ...sub, k: 0.004 }),
    ell([0.072, 1.714, 0.032], [0.012, 0.02, 0.014], { ...sub, k: 0.02 }),       // slight temple hollows
    ell([-0.072, 1.714, 0.032], [0.012, 0.02, 0.014], { ...sub, k: 0.02 }),
    ell([0.078, 1.69, -0.004], [0.004, 0.025, 0.014], { ...sub, k: 0.004 }),     // ear bowls
    ell([-0.078, 1.69, -0.004], [0.004, 0.025, 0.014], { ...sub, k: 0.004 }),
  ];
  const G = { ...sub, k: 0.004 };
  // Three deep forehead furrows from a permanent scowl.
  for (const [y, w] of [[1.765, 0.046], [1.777, 0.05], [1.789, 0.044]]) {
    const pts = [];
    for (let i = 0; i <= 6; i++) { const x = -w + (2 * w * i) / 6; const yy = y + Math.sin(i * 1.3 + y * 400) * 0.0012 - x * x * 1.4; pts.push([x, yy, foreZ(x, yy) + 0.0022]); }
    carve.push(...arc(pts, 0.0024, G));
  }
  // Scowl lines angling down toward the eye from above the brow.
  for (const sx of [-1, 1]) carve.push(...arc([[sx * 0.012, 1.758, foreZ(0.012, 1.758) + 0.001], [sx * 0.02, 1.748, foreZ(0.02, 1.748) + 0.001]], 0.0022, G));
  // One fold under the eye, crow's feet at its corners.
  carve.push(...arc(ring(0, EYE_Y - 0.003, 0.039, 0.025, Math.PI + 0.35, Math.PI * 2 - 0.35, 6, (x, y) => faceZ(x, y) - 0.001), 0.0018, G));
  // Nasolabial folds and the corners of a down-turned mouth.
  for (const s of [-1, 1]) {
    carve.push(...arc([[s * 0.019, 1.645, 0.11], [s * 0.024, 1.632, 0.103], [s * 0.026, 1.619, 0.097], [s * 0.027, 1.607, 0.09]], 0.0024, { sub: true, k: 0.005 }));
    carve.push(...arc([[s * 0.0165, 1.6135, 0.103], [s * 0.021, 1.607, 0.097]], 0.0016, { sub: true, k: 0.003 }));
  }
  carve.push(...arc([[-0.013, 1.5985, 0.094], [0, 1.5965, 0.097], [0.013, 1.5985, 0.094]], 0.0022, G)); // chin crease
  // Upside-down half-moon eye under a heavy brow: a straight-edged upper lid hangs across the top of the
  // eyeball (the iris peers out just under it), a fleshy fold sits above, and a thick brow ridge over all.
  const hood = [
    box([0, EYE_Y + 0.0118, 0.1035], [0.026, 0.0035, 0.0055], 0.0068, { k: 0.009 }),
    ell([0, EYE_Y + 0.021, 0.099], [0.044, 0.012, 0.017], { k: 0.012 }),
    cap([-0.046, EYE_Y + 0.033, 0.087], [0.046, EYE_Y + 0.033, 0.087], 0.0118, 0.0118, { k: 0.02 }),   // brow ridge
    ell([0.042, EYE_Y + 0.026, 0.081], [0.017, 0.011, 0.014], { k: 0.018 }),
    ell([-0.042, EYE_Y + 0.026, 0.081], [0.017, 0.011, 0.014], { k: 0.018 }),
  ];
  return [...parts, ...carve, ...hood];
}

// Frontal planar UVs for the giant's head so the painted wrinkle map lands on the right features.
export const FACE_UV = (x, y) => [0.5 + x / 0.32, (y - 1.53) / 0.32];
export function faceUV(geo) {
  const p = geo.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { const [u, v] = FACE_UV(p.getX(i), p.getY(i)); uv[i * 2] = u; uv[i * 2 + 1] = v; }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

// Painted maps: a height map (grooves dark) turned into normals, and an albedo/cavity map
// (creases darker, redness around the eye, age spots).
let maps = null;
export function giantFaceMaps() {
  if (maps) return maps;
  const N = 1024;
  const px = (x, y) => { const [u, v] = FACE_UV(x, y); return [u * N, (1 - v) * N]; };
  const R = rng(4242);
  const H = document.createElement('canvas'); H.width = H.height = N;
  const h = H.getContext('2d');
  h.fillStyle = '#808080'; h.fillRect(0, 0, N, N);
  const stroke = (pts, w, dark = true, blur = 2) => {
    h.save(); h.strokeStyle = dark ? 'rgba(40,40,40,0.5)' : 'rgba(220,220,220,0.45)'; h.lineWidth = w; h.lineCap = 'round';
    h.shadowColor = h.strokeStyle; h.shadowBlur = blur * 2.2;
    h.beginPath(); pts.forEach(([x, y], i) => { const [a, b] = px(x, y); if (i) h.lineTo(a, b); else h.moveTo(a, b); }); h.stroke(); h.restore();
  };
  const wave = (x0, x1, y, amp, n = 14) => { const p = []; for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * (i / n); p.push([x, y + Math.sin(i * 1.7 + y * 900) * amp - x * x * 1.5]); } return p; };
  // forehead: many fine furrows between the sculpted deep ones
  for (const y of [1.771, 1.783]) { const x0 = -0.02 - R() * 0.035, x1 = 0.02 + R() * 0.035; stroke(wave(x0, x1, y + (R() - 0.5) * 0.003, 0.0018, 10), 1.5 + R() * 1.5, true, 4); }
  for (let i = 0; i < 5; i++) { const x = (R() - 0.5) * 0.08, y = 1.762 + R() * 0.03; stroke(wave(x - 0.008, x + 0.008, y, 0.0006, 4), 1, true, 2); }
  // around the eye: concentric creases and crow's feet
  for (let k = 0; k < 2; k++) {
    const rx = 0.036 + k * 0.006, ry = 0.021 + k * 0.005, pts = [];
    const a0 = 0.2 + R() * 0.3, a1 = Math.PI - 0.2 - R() * 0.3;
    for (let i = 0; i <= 16; i++) { const a = a0 + (a1 - a0) * (i / 16); pts.push([Math.cos(a) * rx, 1.706 + Math.sin(a) * ry]); }
    stroke(pts, 1.5 + R(), true, 3);
    const b = []; for (let i = 0; i <= 12; i++) { const a = Math.PI + 0.4 + (Math.PI - 0.8) * (i / 12); b.push([Math.cos(a) * rx * 0.95, 1.703 + Math.sin(a) * ry * 0.75]); }
    stroke(b, 1.2 + R(), true, 3);
  }
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) { const a = -0.5 + i * 0.5; const x0 = s * 0.034, y0 = 1.706 + a * 0.012; stroke([[x0, y0], [s * (0.05 + R() * 0.012), y0 + a * 0.02]], 1.5 + R()); }
  // under the absent human eyes, cheeks, nasolabial, mouth, chin
  for (const s of [-1, 1]) {
    for (let i = 0; i < 2; i++) stroke([[s * 0.018, 1.684 - i * 0.003], [s * 0.035, 1.68 - i * 0.004], [s * 0.05, 1.684 - i * 0.002]], 1.5);
    for (let i = 0; i < 4; i++) stroke([[s * (0.016 + i * 0.002), 1.646], [s * (0.022 + i * 0.002), 1.627], [s * (0.027 + i * 0.002), 1.603]], 3 - i * 0.5);
    
    for (let i = 0; i < 3; i++) stroke([[s * 0.02, 1.611 - i * 0.002], [s * 0.025, 1.596 - i * 0.003], [s * 0.027, 1.586]], 2);
  }
  for (let i = 0; i < 9; i++) { const x = -0.014 + i * 0.0035; stroke([[x, 1.6175], [x * 1.05, 1.626]], 1.2); }   // lip lines
  for (const y of [1.545, 1.565]) stroke(wave(-0.045, 0.045, y, 0.0008, 10), 1.5, true, 4);                       // two neck creases
  for (const s of [-1, 1]) stroke([[s * 0.017, 1.5], [s * 0.013, 1.588]], 5, false, 4);                   // neck cords (raised)
  for (const s of [-1, 1]) stroke([[s * 0.062, 1.74], [s * 0.07, 1.712], [s * 0.066, 1.69]], 2.5, false, 3); // temple vein
  // pores and fine skin grain everywhere
  const img = h.getImageData(0, 0, N, N), d = img.data;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4, n = (tfbm(x / N, y / N, 96, 3) - 0.5) * 12 + (hash2(x, y) - 0.5) * 7;
    d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, d[i] + n));
  }
  h.putImageData(img, 0, 0);
  // height → normal
  const NC = document.createElement('canvas'); NC.width = NC.height = N;
  const nc = NC.getContext('2d'), out = nc.createImageData(N, N), hd = h.getImageData(0, 0, N, N).data;
  const at = (x, y) => hd[(((y + N) % N) * N + ((x + N) % N)) * 4] / 255;
  const str = 2.6;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const nx = (at(x - 1, y) - at(x + 1, y)) * str, ny = (at(x, y + 1) - at(x, y - 1)) * str, L = Math.hypot(nx, ny, 1), i = (y * N + x) * 4;
    out.data[i] = (nx / L * 0.5 + 0.5) * 255; out.data[i + 1] = (ny / L * 0.5 + 0.5) * 255; out.data[i + 2] = (1 / L * 0.5 + 0.5) * 255; out.data[i + 3] = 255;
  }
  nc.putImageData(out, 0, 0);
  // albedo / cavity: grooves darker, warm-red eye rim, liver spots
  const AC = document.createElement('canvas'); AC.width = AC.height = N;
  const ac = AC.getContext('2d'), ai = ac.createImageData(N, N);
  for (let i = 0; i < N * N; i++) { const v = hd[i * 4] / 255, c = 0.72 + v * 0.38; ai.data[i * 4] = Math.min(255, 255 * c); ai.data[i * 4 + 1] = Math.min(255, 250 * c); ai.data[i * 4 + 2] = Math.min(255, 240 * c); ai.data[i * 4 + 3] = 255; }
  ac.putImageData(ai, 0, 0);
  const [ex, ey] = px(0, 1.706);
  const grd = ac.createRadialGradient(ex, ey, 6, ex, ey, 70); grd.addColorStop(0, 'rgba(200,40,30,0.55)'); grd.addColorStop(1, 'rgba(200,40,30,0)');
  ac.fillStyle = grd; ac.fillRect(ex - 80, ey - 80, 160, 160);
  // skin tone variation: flushed nose, cheeks and ears; stubble shadow over the scalp and jaw; a few spots
  const blush = (x, y, r, col) => { const [bx, by] = px(x, y); const gr = ac.createRadialGradient(bx, by, 2, bx, by, r); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); ac.fillStyle = gr; ac.fillRect(bx - r, by - r, r * 2, r * 2); };
  blush(0, 1.642, 60, 'rgba(190,70,55,0.35)');
  for (const sx of [-1, 1]) { blush(sx * 0.05, 1.655, 70, 'rgba(185,80,60,0.25)'); blush(sx * 0.08, 1.686, 70, 'rgba(190,70,60,0.35)'); }
  { const [sx0, sy0] = px(0, 1.84); const gr = ac.createLinearGradient(sx0, sy0, sx0, px(0, 1.75)[1]); gr.addColorStop(0, 'rgba(60,62,70,0.28)'); gr.addColorStop(1, 'rgba(60,62,70,0)'); ac.fillStyle = gr; ac.fillRect(0, 0, N, px(0, 1.75)[1]); }
  { const [jx, jy] = px(0, 1.585); const gr = ac.createRadialGradient(jx, jy, 20, jx, jy, 170); gr.addColorStop(0, 'rgba(70,66,70,0.3)'); gr.addColorStop(1, 'rgba(70,66,70,0)'); ac.fillStyle = gr; ac.fillRect(jx - 170, jy - 100, 340, 260); }
  for (let i = 0; i < 35; i++) { const x = (0.15 + R() * 0.7) * N, y = R() * N * 0.6; ac.fillStyle = `rgba(110,70,40,${0.05 + R() * 0.1})`; ac.beginPath(); ac.ellipse(x, y, 2 + R() * 9, 2 + R() * 7, R() * 3, 0, 7); ac.fill(); }
  const mk = (c, srgb) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  maps = { normal: mk(NC, false), albedo: mk(AC, true) };
  return maps;
}

// Tileable crepey skin for the giant's body: cell-edge cracks plus fine folds.
let crepe = null;
export function crepeyNormal() {
  if (crepe) return crepe;
  const N = 256, R = rng(77), pts = [];
  for (let i = 0; i < 110; i++) pts.push([R() * N, R() * N]);
  const hgt = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let f1 = 1e9, f2 = 1e9;
    for (const [px0, py0] of pts) {
      let dx = Math.abs(x - px0), dy = Math.abs(y - py0); if (dx > N / 2) dx = N - dx; if (dy > N / 2) dy = N - dy;
      const d = dx * dx + dy * dy; if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    const edge = Math.sqrt(f2) - Math.sqrt(f1);
    const fold = Math.pow(Math.max(0, Math.sin(y * 0.45 + tfbm(x / N, y / N, 4, 3) * 26 + x * 0.06)), 3) * Math.max(0, tfbm(x / N + 0.5, y / N, 4, 2) * 2.4 - 1.05);
    hgt[y * N + x] = Math.sqrt(Math.min(1, edge / 7)) * 0.3 - fold * 0.14 + tfbm(x / N, y / N, 32, 2) * 0.26;
  }
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const l = hgt[y * N + ((x - 1 + N) % N)], r = hgt[y * N + ((x + 1) % N)], u = hgt[((y - 1 + N) % N) * N + x], dd = hgt[((y + 1) % N) * N + x];
    const nx = (l - r) * 3, ny = (dd - u) * 3, L = Math.hypot(nx, ny, 1), i = (y * N + x) * 4;
    img.data[i] = (nx / L * 0.5 + 0.5) * 255; img.data[i + 1] = (ny / L * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / L * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  crepe = new THREE.CanvasTexture(c); crepe.wrapS = crepe.wrapT = THREE.RepeatWrapping; crepe.anisotropy = 8; crepe.repeat.set(9, 9);
  return crepe;
}
