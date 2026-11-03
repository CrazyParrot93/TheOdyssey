import * as THREE from 'three';

// A soft cloth cape: a Verlet particle grid pinned along the shoulders, held together by stretch,
// shear and bend constraints, pulled by gravity, drag and a gusting breeze, and pushed out of
// sphere colliders on the torso, hips and legs so it drapes over the body instead of through it.
const _v = new THREE.Vector3(), _a = new THREE.Vector3(), _inv = new THREE.Matrix4();

export class Cape {
  constructor(model, { width = 0.4, length = 0.95, cols = 9, rows = 13, material }) {
    this.model = model; this.cols = cols; this.rows = rows;
    const n = cols * rows;
    this.p = new Float32Array(n * 3); this.q = new Float32Array(n * 3);
    this.geo = new THREE.PlaneGeometry(width, length, cols - 1, rows - 1);
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false; this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    model.root.add(this.mesh);
    this.width = width; this.length = length;
    // Shoulder anchors in chest-bone space: a shallow arc over the shoulder blades.
    this.anchors = [];
    for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1) * 2 - 1;
      this.anchors.push(new THREE.Vector3(u * width * 0.5, 0.29 - u * u * 0.025, -0.112 + u * u * 0.03));
    }
    // Constraints: [i, j, rest, stiffness]
    const C = [], id = (r, c) => r * cols + c, dx = width / (cols - 1), dy = length / (rows - 1);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (c + 1 < cols) C.push([id(r, c), id(r, c + 1), dx, 1]);
      if (r + 1 < rows) C.push([id(r, c), id(r + 1, c), dy, 1]);
      if (r + 1 < rows && c + 1 < cols) { const d = Math.hypot(dx, dy); C.push([id(r, c), id(r + 1, c + 1), d, 0.6], [id(r, c + 1), id(r + 1, c), d, 0.6]); }
      if (c + 2 < cols) C.push([id(r, c), id(r, c + 2), dx * 2, 0.25]);
      if (r + 2 < rows) C.push([id(r, c), id(r + 2, c), dy * 2, 0.25]);
    }
    this.cons = C;
    this.spheres = [];
    this.time = 0; this.acc = 0;
    this.ready = false;
    this.last = new THREE.Vector3();
  }

  _anchor(c, out) { return out.copy(this.anchors[c]).applyMatrix4(this.model.chest.matrixWorld); }

  // Hang straight down from the anchors (first frame, or after a teleport).
  reset() {
    const { p, q, cols, rows } = this, sc = this.model.root.scale.x, dy = this.length / (rows - 1) * sc;
    const back = _v.set(0, 0, -1).transformDirection(this.model.chest.matrixWorld).setY(0).normalize();
    for (let c = 0; c < cols; c++) {
      this._anchor(c, _a);
      for (let r = 0; r < rows; r++) {
        const i = (r * cols + c) * 3;
        p[i] = q[i] = _a.x + back.x * r * 0.004; p[i + 1] = q[i + 1] = _a.y - r * dy; p[i + 2] = q[i + 2] = _a.z + back.z * r * 0.004;
      }
    }
    this.ready = true;
  }

  _colliders() {
    const m = this.model, sc = m.root.scale.x, S = this.spheres;
    S.length = 0;
    const at = (bone, x, y, z, r) => { const c = new THREE.Vector3(x, y, z).applyMatrix4(bone.matrixWorld); S.push([c.x, c.y, c.z, r * sc]); };
    const mid = (a, b, r) => { const c = a.getWorldPosition(new THREE.Vector3()).lerp(b.getWorldPosition(_v), 0.5); S.push([c.x, c.y, c.z, r * sc]); };
    at(m.chest, 0, 0.22, -0.01, 0.135);     // shoulder blades
    at(m.chest, 0, 0.08, -0.005, 0.14);     // ribs
    at(m.spine, 0, 0.0, 0.0, 0.135);        // waist
    at(m.hips, 0, -0.02, -0.01, 0.15);      // hips and seat
    at(m.lSh, 0, 0, 0, 0.065); at(m.rSh, 0, 0, 0, 0.065);
    mid(m.lHip, m.lKn, 0.085); mid(m.rHip, m.rKn, 0.085);
    mid(m.lKn, m.lFt, 0.062); mid(m.rKn, m.rFt, 0.062);
    at(m.lKn, 0, 0, 0, 0.065); at(m.rKn, 0, 0, 0, 0.065);
  }

  _step(h) {
    const { p, q, cols, rows } = this, sc = this.model.root.scale.x, n = cols * rows;
    const t = this.time;
    // Breeze: a slow gust plus flutter, mostly from behind and the side.
    const gust = 0.6 + 0.4 * Math.sin(t * 0.7) * Math.sin(t * 1.9 + 1);
    const wx = 0.6 * gust, wz = 0.35 * Math.sin(t * 0.43), drag = 0.985;
    for (let k = cols; k < n; k++) {
      const i = k * 3;
      const vx = (p[i] - q[i]) * drag, vy = (p[i + 1] - q[i + 1]) * drag, vz = (p[i + 2] - q[i + 2]) * drag;
      q[i] = p[i]; q[i + 1] = p[i + 1]; q[i + 2] = p[i + 2];
      const flutter = Math.sin(t * 7 + k * 0.9) * 0.25 * (k / n);
      p[i] += vx + (wx + flutter) * h * h * sc;
      p[i + 1] += vy - 9.8 * h * h;
      p[i + 2] += vz + wz * h * h * sc;
    }
    for (let c = 0; c < cols; c++) { this._anchor(c, _a); const i = c * 3; q[i] = p[i]; q[i + 1] = p[i + 1]; q[i + 2] = p[i + 2]; p[i] = _a.x; p[i + 1] = _a.y; p[i + 2] = _a.z; }
    const C = this.cons, S = this.spheres, thick = 0.018 * sc;
    for (let it = 0; it < 6; it++) {
      for (let k = 0; k < C.length; k++) {
        const [a, b, rest, stiff] = C[k];
        const ia = a * 3, ib = b * 3;
        const dx = p[ib] - p[ia], dy = p[ib + 1] - p[ia + 1], dz = p[ib + 2] - p[ia + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const r = rest * sc;
        // cloth resists stretching far more than compressing, so it folds instead of shrinking
        const diff = (d - r) / d * (d > r ? stiff : stiff * 0.15) * 0.5;
        const pa = a >= cols, pb = b >= cols;
        if (pa && pb) { p[ia] += dx * diff; p[ia + 1] += dy * diff; p[ia + 2] += dz * diff; p[ib] -= dx * diff; p[ib + 1] -= dy * diff; p[ib + 2] -= dz * diff; }
        else if (pa) { p[ia] += dx * diff * 2; p[ia + 1] += dy * diff * 2; p[ia + 2] += dz * diff * 2; }
        else if (pb) { p[ib] -= dx * diff * 2; p[ib + 1] -= dy * diff * 2; p[ib + 2] -= dz * diff * 2; }
      }
      for (let k = cols; k < n; k++) {
        const i = k * 3;
        for (const s of S) {
          const dx = p[i] - s[0], dy = p[i + 1] - s[1], dz = p[i + 2] - s[2], rr = s[3] + thick;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < rr * rr) { const d = Math.sqrt(d2) || 1e-6, f = rr / d; p[i] = s[0] + dx * f; p[i + 1] = s[1] + dy * f; p[i + 2] = s[2] + dz * f; }
        }
      }
    }
  }

  update(dt) {
    const m = this.model;
    if (!m.root.visible || dt <= 0) return;
    m.root.updateMatrixWorld(true);
    this._anchor((this.cols / 2) | 0, _a);
    if (!this.ready || _a.distanceTo(this.last) > 1.5 * m.root.scale.x) this.reset();
    this.last.copy(_a);
    this._colliders();
    const h = 1 / 90;
    this.acc = Math.min(this.acc + dt, h * 4);
    while (this.acc >= h) { this.time += h; this._step(h); this.acc -= h; }
    // write into the mesh, which lives in the character's root space
    _inv.copy(m.root.matrixWorld).invert();
    const pos = this.geo.attributes.position, p = this.p, cols = this.cols, rows = this.rows, sc = m.root.scale.x;
    // Soft pleats gathered at the shoulders and opening toward the hem, laid over the simulated drape.
    const back = _a.set(0, 0, -1).transformDirection(m.chest.matrixWorld);
    for (let k = 0; k < pos.count; k++) {
      const c = k % cols, r = (k / cols) | 0;
      const pleat = Math.sin((c / (cols - 1)) * Math.PI * 3.5 + 0.4) * 0.022 * sc * Math.min(1, r / (rows * 0.3)) * (r ? 1 : 0);
      _v.set(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]).addScaledVector(back, pleat).applyMatrix4(_inv); pos.setXYZ(k, _v.x, _v.y, _v.z);
    }
    pos.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
  }
}
