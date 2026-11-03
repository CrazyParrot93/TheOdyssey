import * as THREE from 'three';
import { Mat } from '../assets/Assets.js';
import { clamp, smoothstep, fbm2 } from '../core/math.js';

// Heightfield island mesh with slope/height vertex colors and a heightmap texture for the ocean shader.
export function buildIsland({ size = 300, res = 200, height, colors = {} }) {
  const g = new THREE.PlaneGeometry(size, size, res, res);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) p.setY(i, height(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  const nrm = g.attributes.normal;
  const sand = new THREE.Color(colors.sand || '#cdb084'), wetSand = new THREE.Color(colors.wet || '#8a7456');
  const grass = new THREE.Color(colors.grass || '#7d8448'), dry = new THREE.Color(colors.dry || '#a89a5c');
  const rock = new THREE.Color(colors.rock || '#7a7064'), dark = new THREE.Color(colors.dark || '#4a443e');
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const slope = 1 - nrm.getY(i);
    const n = fbm2(x * 0.05, z * 0.05, 3);
    if (y < 0.4) c.copy(wetSand).lerp(sand, smoothstep(-1.5, 0.4, y));
    else if (y < 2.2 + n * 1.5) c.copy(sand).lerp(dry, smoothstep(1.2, 2.6, y + n));
    else c.copy(dry).lerp(grass, clamp(n * 1.6 - 0.2));
    c.lerp(rock, smoothstep(0.28, 0.5, slope));
    c.lerp(dark, smoothstep(0.55, 0.8, slope) * 0.6);
    if (y > 30) c.lerp(rock, smoothstep(30, 45, y));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * size / 6, uv.getY(i) * size / 6);
  const mesh = new THREE.Mesh(g, Mat.terrain);
  mesh.receiveShadow = true;
  mesh.castShadow = true;

  // Heightmap for water depth: encoded height in [-20, 40] → [0, 255]
  const hn = 128;
  const data = new Uint8Array(hn * hn);
  for (let j = 0; j < hn; j++) for (let i = 0; i < hn; i++) {
    const x = -size / 2 + (i + 0.5) / hn * size, z = -size / 2 + (j + 0.5) / hn * size;
    data[j * hn + i] = clamp((height(x, z) + 20) / 60) * 255;
  }
  const tex = new THREE.DataTexture(data, hn, hn, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
  return { mesh, tex, size, minX: -size / 2, minZ: -size / 2 };
}
