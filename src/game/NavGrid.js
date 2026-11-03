import * as THREE from 'three';

// Grid A* for crew companions. blocked(x, z) -> bool decides walkability.
export class NavGrid {
  constructor(minX, minZ, size, cell, blocked) {
    this.minX = minX; this.minZ = minZ; this.cell = cell;
    this.n = Math.ceil(size / cell);
    this.grid = new Uint8Array(this.n * this.n);
    this.rebuild(blocked);
  }
  rebuild(blocked) {
    const n = this.n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = this.minX + (i + 0.5) * this.cell, z = this.minZ + (j + 0.5) * this.cell;
      this.grid[j * n + i] = blocked(x, z) ? 1 : 0;
    }
  }
  cellOf(x, z) { return [Math.floor((x - this.minX) / this.cell), Math.floor((z - this.minZ) / this.cell)]; }
  ok(i, j) { return i >= 0 && j >= 0 && i < this.n && j < this.n && this.grid[j * this.n + i] === 0; }
  walkable(x, z) { const [i, j] = this.cellOf(x, z); return this.ok(i, j); }

  lineClear(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az), steps = Math.ceil(d / (this.cell * 0.5));
    for (let s = 1; s < steps; s++) { const t = s / steps; if (!this.walkable(ax + (bx - ax) * t, az + (bz - az) * t)) return false; }
    return true;
  }

  nearestOpen(i, j) {
    if (this.ok(i, j)) return [i, j];
    for (let r = 1; r < 8; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (this.ok(i + di, j + dj)) return [i + di, j + dj];
    return null;
  }

  findPath(sx, sz, tx, tz) {
    const n = this.n;
    const s = this.nearestOpen(...this.cellOf(sx, sz)), t = this.nearestOpen(...this.cellOf(tx, tz));
    if (!s || !t) return null;
    const start = s[1] * n + s[0], goal = t[1] * n + t[0];
    const g = new Float32Array(n * n).fill(Infinity), from = new Int32Array(n * n).fill(-1), closed = new Uint8Array(n * n);
    const heap = [];
    const push = (id, f) => { heap.push([f, id]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const h = (id) => { const dx = Math.abs((id % n) - t[0]), dz = Math.abs(((id / n) | 0) - t[1]); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    g[start] = 0; push(start, h(start));
    let iter = 0;
    while (heap.length && iter++ < 6000) {
      const [, cur] = pop();
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const ci = cur % n, cj = (cur / n) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (!this.ok(ni, nj)) continue;
        if (di && dj && (!this.ok(ci + di, cj) || !this.ok(ci, cj + dj))) continue;
        const nid = nj * n + ni, cost = g[cur] + (di && dj ? 1.414 : 1);
        if (cost < g[nid]) { g[nid] = cost; from[nid] = cur; push(nid, cost + h(nid)); }
      }
    }
    if (from[goal] === -1 && goal !== start) return null;
    const cells = [];
    for (let c = goal; c !== -1; c = from[c]) { cells.push(c); if (c === start) break; }
    cells.reverse();
    const pts = cells.map((c) => new THREE.Vector3(this.minX + ((c % n) + 0.5) * this.cell, 0, this.minZ + (((c / n) | 0) + 0.5) * this.cell));
    pts.push(new THREE.Vector3(tx, 0, tz));
    // String-pull smoothing
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !this.lineClear(pts[i].x, pts[i].z, pts[j].x, pts[j].z)) j--;
      out.push(pts[j]); i = j;
    }
    return out;
  }
}
