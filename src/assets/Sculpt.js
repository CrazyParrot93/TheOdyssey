import * as THREE from 'three';

// Signed-distance sculpting: bodies are smooth unions of anatomical primitives,
// meshed with Naive Surface Nets, projected onto the surface, and skinned by SDF proximity.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export function smin(a, b, k) {
  if (k <= 0) return a < b ? a : b;
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
export const smax = (a, b, k) => -smin(-a, -b, k);

// Part helpers. Units: metres, bind pose. Optional: bone, k (blend radius), sub (carve), group.
export const ell = (c, r, o = {}) => ({ t: 'ell', c, r, ...o });
export const cap = (a, b, ra, rb = ra, o = {}) => ({ t: 'cap', a, b, ra, rb, ...o });
export const box = (c, e, rr, o = {}) => ({ t: 'box', c, e, rr, ...o });
export const mirrorX = (p) => {
  const m = { ...p };
  for (const k of ['c', 'a', 'b']) if (p[k]) m[k] = [-p[k][0], p[k][1], p[k][2]];
  if (p.bone) m.bone = p.bone.replace(/^l([A-Z])/, 'R$1').replace(/^r([A-Z])/, 'l$1').replace(/^R([A-Z])/, 'r$1');
  return m;
};

function partDist(p, x, y, z) {
  if (p.t === 'ell') {
    const dx = x - p.c[0], dy = y - p.c[1], dz = z - p.c[2];
    const rx = p.r[0], ry = p.r[1], rz = p.r[2];
    const k0 = Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2 + (dz / rz) ** 2);
    const k1 = Math.sqrt((dx / (rx * rx)) ** 2 + (dy / (ry * ry)) ** 2 + (dz / (rz * rz)) ** 2);
    return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
  }
  if (p.t === 'cap') {
    const ax = p.a[0], ay = p.a[1], az = p.a[2];
    const bx = p.b[0] - ax, by = p.b[1] - ay, bz = p.b[2] - az;
    const px = x - ax, py = y - ay, pz = z - az;
    const h = clamp01((px * bx + py * by + pz * bz) / (bx * bx + by * by + bz * bz));
    const qx = px - bx * h, qy = py - by * h, qz = pz - bz * h;
    return Math.sqrt(qx * qx + qy * qy + qz * qz) - (p.ra + (p.rb - p.ra) * h);
  }
  // rounded box
  const qx = Math.abs(x - p.c[0]) - p.e[0], qy = Math.abs(y - p.c[1]) - p.e[1], qz = Math.abs(z - p.c[2]) - p.e[2];
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - p.rr;
}

function aabb(p) {
  if (p.t === 'ell') return [p.c[0] - p.r[0], p.c[1] - p.r[1], p.c[2] - p.r[2], p.c[0] + p.r[0], p.c[1] + p.r[1], p.c[2] + p.r[2]];
  if (p.t === 'cap') { const r = Math.max(p.ra, p.rb); return [Math.min(p.a[0], p.b[0]) - r, Math.min(p.a[1], p.b[1]) - r, Math.min(p.a[2], p.b[2]) - r, Math.max(p.a[0], p.b[0]) + r, Math.max(p.a[1], p.b[1]) + r, Math.max(p.a[2], p.b[2]) + r]; }
  const e = p.e, r = p.rr; return [p.c[0] - e[0] - r, p.c[1] - e[1] - r, p.c[2] - e[2] - r, p.c[0] + e[0] + r, p.c[1] + e[1] + r, p.c[2] + e[2] + r];
}

export class SDF {
  constructor(parts, clip = null) {
    this.parts = parts;
    this.clip = clip;
    for (const p of parts) { p.bb = aabb(p); p.k = p.k ?? 0.02; }
    this.per = new Float32Array(parts.length);
  }
  // Spatial buckets: each cell lists only the parts whose bounds (plus blend radius) reach it.
  buildBuckets(bmin, bmax, size = 0.05) {
    const n = [0, 1, 2].map((a) => Math.max(1, Math.ceil((bmax[a] - bmin[a]) / size)));
    const cells = new Array(n[0] * n[1] * n[2]);
    for (let i = 0; i < cells.length; i++) cells[i] = [];
    this.parts.forEach((p, idx) => {
      const pad = p.k + size * 0.5 + 0.02;
      const lo = [0, 1, 2].map((a) => Math.max(0, Math.floor((p.bb[a] - pad - bmin[a]) / size)));
      const hi = [0, 1, 2].map((a) => Math.min(n[a] - 1, Math.floor((p.bb[a + 3] + pad - bmin[a]) / size)));
      for (let k = lo[2]; k <= hi[2]; k++) for (let j = lo[1]; j <= hi[1]; j++) for (let i = lo[0]; i <= hi[0]; i++) cells[i + n[0] * (j + n[1] * k)].push(idx);
    });
    this.buckets = { bmin, size, n, cells };
  }
  dropBuckets() { this.buckets = null; }
  // Union / carve in declaration order. Records per-part distances in this.per.
  eval(x, y, z) {
    let d = 1e9;
    const parts = this.parts, per = this.per;
    let list = null;
    if (this.buckets) {
      const B = this.buckets;
      const i = Math.floor((x - B.bmin[0]) / B.size), j = Math.floor((y - B.bmin[1]) / B.size), k = Math.floor((z - B.bmin[2]) / B.size);
      if (i >= 0 && j >= 0 && k >= 0 && i < B.n[0] && j < B.n[1] && k < B.n[2]) {
        list = B.cells[i + B.n[0] * (j + B.n[1] * k)];
        if (!list.length) return this.clip ? this.clip(x, y, z, B.size) : B.size;
      }
    }
    const count = list ? list.length : parts.length;
    for (let li = 0; li < count; li++) {
      const i = list ? list[li] : li;
      const p = parts[i], b = p.bb;
      let ex = b[0] - x; if (x - b[3] > ex) ex = x - b[3]; if (ex < 0) ex = 0;
      let ey = b[1] - y; if (y - b[4] > ey) ey = y - b[4]; if (ey < 0) ey = 0;
      let ez = b[2] - z; if (z - b[5] > ez) ez = z - b[5]; if (ez < 0) ez = 0;
      const db = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (db > p.k + 0.01 && (p.sub || db > d + p.k)) { per[i] = db; continue; }
      const dp = partDist(p, x, y, z);
      per[i] = dp;
      if (p.sub) d = smax(d, -dp, p.k);
      else d = smin(d, dp, p.k);
    }
    return this.clip ? this.clip(x, y, z, d) : d;
  }
  grad(x, y, z, e, out) {
    out[0] = this.eval(x + e, y, z) - this.eval(x - e, y, z);
    out[1] = this.eval(x, y + e, z) - this.eval(x, y - e, z);
    out[2] = this.eval(x, y, z + e) - this.eval(x, y, z - e);
    const l = Math.hypot(out[0], out[1], out[2]);
    if (!(l > 1e-9)) { out[0] = 0; out[1] = 1; out[2] = 0; return out; }
    out[0] /= l; out[1] /= l; out[2] /= l;
    return out;
  }
}

// Naive Surface Nets → indexed BufferGeometry with SDF-gradient normals.
export function meshSDF(sdf, bmin, bmax, step, opts = {}) {
  const nx = Math.ceil((bmax[0] - bmin[0]) / step) + 1, ny = Math.ceil((bmax[1] - bmin[1]) / step) + 1, nz = Math.ceil((bmax[2] - bmin[2]) / step) + 1;
  const F = new Float32Array(nx * ny * nz);
  sdf.buildBuckets([bmin[0] - step, bmin[1] - step, bmin[2] - step], [bmax[0] + step, bmax[1] + step, bmax[2] + step], 0.04);
  // Coarse-to-fine: sample at 2x spacing first, then only refine points near the surface.
  const mx = (nx + 2) >> 1, my = (ny + 2) >> 1, mz = (nz + 2) >> 1, s2 = step * 2;
  const Cf = new Float32Array(mx * my * mz);
  for (let k = 0; k < mz; k++) for (let j = 0; j < my; j++) for (let i = 0; i < mx; i++)
    Cf[i + mx * (j + my * k)] = sdf.eval(bmin[0] + i * s2, bmin[1] + j * s2, bmin[2] + k * s2);
  const band = step * 4;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const cv = Cf[(i >> 1) + mx * ((j >> 1) + my * (k >> 1))];
    F[i + nx * (j + ny * k)] = Math.abs(cv) > band ? cv : sdf.eval(bmin[0] + i * step, bmin[1] + j * step, bmin[2] + k * step);
  }
  const cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const cell = new Int32Array(cx * cy * cz).fill(-1);
  const pos = [];
  const C = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const v = new Float32Array(8);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) { v[c] = F[(i + C[c][0]) + nx * ((j + C[c][1]) + ny * (k + C[c][2]))]; if (v[c] < 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of E) {
      if ((v[a] < 0) === (v[b] < 0)) continue;
      const t = v[a] / (v[a] - v[b]);
      sx += C[a][0] + (C[b][0] - C[a][0]) * t; sy += C[a][1] + (C[b][1] - C[a][1]) * t; sz += C[a][2] + (C[b][2] - C[a][2]) * t; n++;
    }
    cell[i + cx * (j + cy * k)] = pos.length / 3;
    pos.push(bmin[0] + (i + sx / n) * step, bmin[1] + (j + sy / n) * step, bmin[2] + (k + sz / n) * step);
  }
  const idx = [];
  const dims = [nx, ny, nz], x = [0, 0, 0];
  const cid = (a, b, c) => cell[a + cx * (b + cy * c)];
  for (x[2] = 0; x[2] < nz; x[2]++) for (x[1] = 0; x[1] < ny; x[1]++) for (x[0] = 0; x[0] < nx; x[0]++) {
    const s0 = F[x[0] + nx * (x[1] + ny * x[2])] < 0;
    for (let d = 0; d < 3; d++) {
      const u = (d + 1) % 3, w = (d + 2) % 3;
      if (x[d] >= dims[d] - 1 || x[u] < 1 || x[w] < 1 || x[u] > dims[u] - 2 || x[w] > dims[w] - 2) continue;
      const y = [x[0], x[1], x[2]]; y[d]++;
      const s1 = F[y[0] + nx * (y[1] + ny * y[2])] < 0;
      if (s0 === s1) continue;
      const c0 = [x[0], x[1], x[2]], c1 = [x[0], x[1], x[2]], c2 = [x[0], x[1], x[2]], c3 = [x[0], x[1], x[2]];
      c1[u]--; c2[u]--; c2[w]--; c3[w]--;
      const a = cid(...c0), b = cid(...c1), c = cid(...c2), e = cid(...c3);
      if (a < 0 || b < 0 || c < 0 || e < 0) continue;
      if (s0) idx.push(a, b, c, a, c, e); else idx.push(a, c, b, a, e, c);
    }
  }
  // Project vertices onto the surface and take normals from the field gradient.
  const g = [0, 0, 0], N = new Float32Array(pos.length);
  const eps = step * 0.35;
  for (let i = 0; i < pos.length; i += 3) {
    for (let it = 0; it < (opts.project ?? 2); it++) {
      const d = sdf.eval(pos[i], pos[i + 1], pos[i + 2]);
      sdf.grad(pos[i], pos[i + 1], pos[i + 2], eps, g);
      pos[i] -= g[0] * d; pos[i + 1] -= g[1] * d; pos[i + 2] -= g[2] * d;
    }
    sdf.grad(pos[i], pos[i + 1], pos[i + 2], eps, g);
    N[i] = g[0]; N[i + 1] = g[1]; N[i + 2] = g[2];
    if (!Number.isFinite(pos[i] + pos[i + 1] + pos[i + 2] + N[i] + N[i + 1] + N[i + 2])) { N[i] = 0; N[i + 1] = 1; N[i + 2] = 0; }
  }
  // Winding check against the gradient; flip if the mesher wound inward.
  let score = 0;
  for (let t = 0; t < idx.length; t += 3 * Math.max(1, Math.floor(idx.length / 3 / 200))) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    score += Math.sign(fx * N[a] + fy * N[a + 1] + fz * N[a + 2]);
  }
  if (score < 0) for (let t = 0; t < idx.length; t += 3) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
  sdf.dropBuckets();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  geo.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  return geo;
}

// Cylindrical UVs (fine for tileable detail maps: pores, weave, dirt).
export function cylUV(geo, vScale = 2, center = [0, 0]) {
  const p = geo.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = Math.atan2(p.getX(i) - center[0], p.getZ(i) - center[1]) / (Math.PI * 2) + 0.5;
    uv[i * 2 + 1] = p.getY(i) * vScale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

// Skin weights: each part votes for its bone by surface proximity; keep the top four.
export function skinBySDF(geo, sdf, boneIndex, { sigma = 0.012, bias = null } = {}) {
  const p = geo.attributes.position, n = p.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  const acc = new Float32Array(Object.keys(boneIndex).length);
  for (let i = 0; i < n; i++) {
    acc.fill(0);
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    sdf.eval(x, y, z);
    for (let k = 0; k < sdf.parts.length; k++) {
      const part = sdf.parts[k];
      if (part.sub || !part.bone) continue;
      const b = boneIndex[part.bone];
      if (b === undefined) continue;
      acc[b] += Math.exp(-Math.max(sdf.per[k], 0) / sigma);
    }
    if (bias) bias(x, y, z, acc, boneIndex);
    const top = [-1, -1, -1, -1];
    for (let b = 0; b < acc.length; b++) { const w = acc[b]; for (let j = 0; j < 4; j++) { if (top[j] < 0 || w > acc[top[j]]) { for (let q = 3; q > j; q--) top[q] = top[q - 1]; top[j] = b; break; } } }
    let sum = 0;
    for (const t of top) sum += acc[t];
    for (let j = 0; j < 4; j++) { si[i * 4 + j] = top[j]; sw[i * 4 + j] = sum > 0 ? acc[top[j]] / sum : j === 0 ? 1 : 0; }
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  return geo;
}

// Remove faces matching a predicate (e.g. an open hem). Expects an indexed geometry.
export function cullFaces(geo, pred) {
  const idx = geo.index.array, p = geo.attributes.position, nrm = geo.attributes.normal, keep = [];
  for (let t = 0; t < idx.length; t += 3) {
    let cx = 0, cy = 0, cz = 0, ny = 0;
    for (let k = 0; k < 3; k++) { cx += p.getX(idx[t + k]); cy += p.getY(idx[t + k]); cz += p.getZ(idx[t + k]); ny += nrm.getY(idx[t + k]); }
    if (!pred(cx / 3, cy / 3, cz / 3, ny / 3)) keep.push(idx[t], idx[t + 1], idx[t + 2]);
  }
  geo.setIndex(keep);
  return geo;
}
