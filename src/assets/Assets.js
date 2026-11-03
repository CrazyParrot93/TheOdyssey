import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { tfbm, tnoise, fbm2, noise2, rng, clamp, hash2 } from '../core/math.js';
import { G } from '../core/context.js';

// Procedural asset factory: every texture, material, and model is generated here and cached.
export const shaderTime = { value: 0 };
// Silhouette protection: a sun-coloured rim that strengthens when the camera looks into the light.
export const RIM = { color: { value: new THREE.Color(1, 0.85, 0.6) }, strength: { value: 0.1 } };
const WRAP = 'float wrapNL = saturate((dot(geometryNormal, directLight.direction) + 0.45) / 1.45); vec3 irradiance = mix(vec3(dotNL), vec3(wrapNL), vec3(0.28, 0.11, 0.06)) * directLight.color; irradiance += directLight.color * pow(saturate(dot(geometryViewDir, -directLight.direction)), 5.0) * (1.0 - dotNL) * vec3(0.085, 0.016, 0.006);';
export function patchMaterial(m, { rim = true, wrap = false } = {}) {
  const prev = m.onBeforeCompile;
  const prevKey = prev && prev !== THREE.Material.prototype.onBeforeCompile ? prev.toString().length : 0;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    if (rim) {
      sh.uniforms.uRimColor = RIM.color; sh.uniforms.uRimStrength = RIM.strength;
      sh.fragmentShader = 'uniform vec3 uRimColor;\nuniform float uRimStrength;\n' + sh.fragmentShader.replace('#include <dithering_fragment>',
        '#include <dithering_fragment>\n  { float rimF = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0); gl_FragColor.rgb += uRimColor * rimF * uRimStrength; }');
    }
    if (wrap) sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_pars_fragment>', THREE.ShaderChunk.lights_physical_pars_fragment.replace('vec3 irradiance = dotNL * directLight.color;', WRAP));
  };
  m.customProgramCacheKey = () => `nostos-r${+rim}w${+wrap}-${prevKey}`;
  return m;
}
export const Tex = {};
export const Mat = {};
const geoCache = new Map();
export function cachedGeo(key, make) { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); }

// ---------- texture helpers ----------
function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function toTex(c, srgb = true, rep = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rep, rep);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function field(n, fn) { const h = new Float32Array(n * n); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) h[y * n + x] = fn(x / n, y / n); return h; }
function paint(n, fn) {
  const c = canvas(n), g = c.getContext('2d'), img = g.createImageData(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, col = fn(x, y, i);
    img.data[i * 4] = col[0]; img.data[i * 4 + 1] = col[1]; img.data[i * 4 + 2] = col[2]; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
function normalTex(h, n, str, rep = 1) {
  return toTex(paint(n, (x, y) => {
    const l = h[y * n + ((x - 1 + n) % n)], r = h[y * n + ((x + 1) % n)], u = h[((y - 1 + n) % n) * n + x], d = h[((y + 1) % n) * n + x];
    const nx = (l - r) * str, ny = (d - u) * str, L = Math.hypot(nx, ny, 1);
    return [(nx / L * 0.5 + 0.5) * 255, (ny / L * 0.5 + 0.5) * 255, (1 / L * 0.5 + 0.5) * 255];
  }), false, rep);
}
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function buildTextures() {
  // Stone: fbm + crack ridges, lichen blotches.
  const SN = 512;
  const stoneH = field(SN, (u, v) => {
    const base = tfbm(u, v, 4, 6);
    const ridge = 1 - Math.abs(tfbm(u + 0.31, v + 0.17, 8, 3) * 2 - 1);
    return base - Math.pow(ridge, 10) * 0.35;
  });
  Tex.stone = toTex(paint(SN, (x, y, i) => {
    const h = stoneH[i], blot = tfbm(x / SN + 0.5, y / SN, 2, 3);
    let c = mix3([62, 57, 52], [152, 142, 126], clamp(h * 1.4 - 0.2));
    if (blot > 0.6) c = mix3(c, [128, 112, 70], (blot - 0.6) * 1.6);
    return c;
  }));
  Tex.stoneN = normalTex(stoneH, SN, 6);
  Tex.stoneR = toTex(paint(SN, (x, y, i) => { const r = 200 - stoneH[i] * 70; return [r, r, r]; }), false);

  // Sand
  const N = 256;
  const sandH = field(N, (u, v) => tfbm(u, v, 16, 3) * 0.6 + hash2(u * N, v * N) * 0.4);
  Tex.sand = toTex(paint(N, (x, y, i) => mix3([188, 160, 118], [226, 204, 160], sandH[i])));
  Tex.sandN = normalTex(sandH, N, 2.5);

  // Weathered wood
  const woodH = field(N, (u, v) => { const g = Math.sin((u * 26 + tfbm(u, v, 4, 4) * 5) * Math.PI); return 0.5 + 0.35 * g + 0.15 * tnoise(u * 64, v * 4, 64); });
  Tex.wood = toTex(paint(N, (x, y, i) => mix3([120, 96, 70], [196, 178, 150], woodH[i])));
  Tex.woodN = normalTex(woodH, N, 2.2);

  // Bronze with verdigris patina
  const bronzeH = field(N, (u, v) => tfbm(u, v, 4, 5));
  Tex.bronze = toTex(paint(N, (x, y, i) => {
    const h = bronzeH[i];
    let c = mix3([168, 118, 58], [222, 172, 96], tnoise(x / 8, y / 8, N / 8) * 0.5 + 0.3);
    if (h > 0.6) c = mix3(c, [86, 142, 118], clamp((h - 0.6) * 3));
    return c;
  }));
  Tex.bronzeR = toTex(paint(N, (x, y, i) => { const h = bronzeH[i]; const r = h > 0.6 ? 220 : 80 + h * 60; return [r, r, r]; }), false);

  // Linen weave
  const linenH = field(N, (u, v) => 0.5 + 0.25 * Math.sin(u * N * Math.PI * 0.5) * Math.sin(v * N * Math.PI * 0.5) + 0.25 * tfbm(u, v, 8, 3));
  Tex.linen = toTex(paint(N, (x, y, i) => mix3([206, 194, 168], [240, 232, 212], linenH[i])));
  Tex.linenN = normalTex(linenH, N, 1.2);

  // Sail: linen with ochre-red bands and a meander strip
  {
    const c = canvas(512), g = c.getContext('2d');
    g.drawImage(Tex.linen.image, 0, 0, 512, 512);
    g.fillStyle = 'rgba(160,52,30,0.85)'; g.fillRect(0, 300, 512, 70);
    g.fillStyle = 'rgba(190,120,50,0.8)'; g.fillRect(0, 388, 512, 18); g.fillRect(0, 282, 512, 10);
    g.strokeStyle = 'rgba(70,30,20,0.85)'; g.lineWidth = 5;
    for (let x = 0; x < 512; x += 36) { g.beginPath(); g.moveTo(x, 360); g.lineTo(x, 310); g.lineTo(x + 26, 310); g.lineTo(x + 26, 345); g.lineTo(x + 12, 345); g.lineTo(x + 12, 328); g.stroke(); }
    g.fillStyle = 'rgba(60,30,20,0.12)';
    for (let i = 0; i < 40; i++) { g.beginPath(); g.arc(Math.random() * 512, Math.random() * 512, Math.random() * 30, 0, 7); g.fill(); }
    Tex.sail = toTex(c);
  }

  // Wool lumps (normal)
  const woolH = field(N, (u, v) => tfbm(u, v, 12, 3));
  Tex.woolN = normalTex(woolH, N, 5);
  // Skin micro detail
  Tex.skin = toTex(paint(N, (x, y) => { const v = 225 + tfbm(x / N, y / N, 16, 3) * 30; return [v, v, v]; }));
  // Terrain detail (multiplies vertex colors)
  const terH = field(N, (u, v) => tfbm(u, v, 8, 5));
  Tex.terrain = toTex(paint(N, (x, y, i) => { const v = 175 + terH[i] * 80; return [v, v * 0.98, v * 0.95]; }), true, 1);
  Tex.terrainN = normalTex(terH, N, 3);
  // Fur / bristle
  const furH = field(N, (u, v) => tnoise(u * 128, v * 12, 128) * 0.7 + tfbm(u, v, 8, 2) * 0.3);
  Tex.furN = normalTex(furH, N, 3);
  // Bark
  const barkH = field(N, (u, v) => { const r = 1 - Math.abs(tfbm(u * 1, v * 0.25, 8, 4) * 2 - 1); return r; });
  Tex.barkN = normalTex(barkH, N, 4);
  Tex.bark = toTex(paint(N, (x, y, i) => mix3([70, 58, 44], [140, 124, 100], barkH[i])));
}

function std(o) { return new THREE.MeshStandardMaterial(o); }

function buildMaterials() {
  Mat.bronze = std({ color: 0xffffff, map: Tex.bronze, metalness: 0.92, roughness: 1, roughnessMap: Tex.bronzeR, envMapIntensity: 1 });
  Mat.bronzeDark = std({ color: 0x8a6a40, metalness: 0.85, roughness: 0.5, roughnessMap: Tex.bronzeR });
  Mat.blade = std({ color: 0xe8dcc0, metalness: 1, roughness: 0.22 });
  Mat.stone = std({ map: Tex.stone, normalMap: Tex.stoneN, roughnessMap: Tex.stoneR, roughness: 1, color: 0xd8d0c4 });
  Mat.caveRock = std({ map: Tex.stone, normalMap: Tex.stoneN, normalScale: new THREE.Vector2(1.6, 1.6), roughnessMap: Tex.stoneR, roughness: 0.95, color: 0x8a7a68, side: THREE.BackSide });
  Mat.wetStone = std({ map: Tex.stone, normalMap: Tex.stoneN, roughness: 0.38, color: 0x6a645c });
  Mat.wood = std({ map: Tex.wood, normalMap: Tex.woodN, roughness: 0.85, color: 0xe6dccb });
  Mat.darkWood = std({ map: Tex.wood, normalMap: Tex.woodN, roughness: 0.8, color: 0x5a4532 });
  Mat.hull = std({ map: Tex.wood, normalMap: Tex.woodN, roughness: 0.7, vertexColors: true, side: THREE.DoubleSide });
  Mat.sail = std({ map: Tex.sail, normalMap: Tex.linenN, roughness: 0.95, side: THREE.DoubleSide });
  Mat.rope = std({ color: 0x8a7458, roughness: 1 });
  Mat.leather = std({ color: 0x5a3a22, roughness: 0.8 });
  Mat.cloak = std({ color: 0x7a1f1a, map: Tex.linen, normalMap: Tex.linenN, roughness: 0.9, side: THREE.DoubleSide });
  Mat.wool = std({ color: 0xe8e0cc, normalMap: Tex.woolN, normalScale: new THREE.Vector2(1.5, 1.5), roughness: 1 });
  Mat.woolDark = std({ color: 0x4a3e34, normalMap: Tex.woolN, roughness: 1 });
  Mat.sheepFace = std({ color: 0x2a221c, roughness: 0.8 });
  Mat.horn = std({ color: 0xb8a684, roughness: 0.55, normalMap: Tex.barkN });
  Mat.boar = std({ color: 0x3a2c22, normalMap: Tex.furN, normalScale: new THREE.Vector2(2, 2), roughness: 0.95 });
  Mat.tusk = std({ color: 0xf0e6cc, roughness: 0.35 });
  Mat.cheese = std({ color: 0xe8c878, roughness: 0.55 });
  Mat.wicker = std({ color: 0x9a7a4a, map: Tex.wood, roughness: 0.9 });
  Mat.bark = std({ map: Tex.bark, normalMap: Tex.barkN, roughness: 1, color: 0xc0b0a0 });
  Mat.olive = std({ map: leafTexture('olive'), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 });
  Mat.cypress = std({ map: leafTexture('cypress'), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });
  Mat.eye = std({ color: 0xf2ece0, roughness: 0.15 });
  Mat.iris = std({ color: 0x1a120c, roughness: 0.1 });
  Mat.wound = std({ color: 0x1a0c08, emissive: 0x5a1a08, emissiveIntensity: 0.6, roughness: 0.6 });
  Mat.black = new THREE.MeshBasicMaterial({ color: 0x000000 });
  Mat.terrain = std({ vertexColors: true, map: Tex.terrain, normalMap: Tex.terrainN, roughness: 0.95 });
  Mat.grass = std({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
  Mat.grass.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shaderTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 iw = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float h = position.y;
      float w = sin(uTime * 1.7 + iw.x * 0.25 + iw.z * 0.18) * 0.6 + sin(uTime * 3.1 + iw.x * 0.9) * 0.2;
      transformed.x += w * h * h * 0.5; transformed.z += w * h * h * 0.25;`);
  };
  Mat.staffTip = std({ color: 0x6a5238, emissive: 0xff5a10, emissiveIntensity: 0, roughness: 0.8 });
  for (const k of ['bronze', 'bronzeDark', 'blade', 'wood', 'darkWood', 'hull', 'sail', 'rope', 'leather', 'cloak', 'wool', 'woolDark', 'boar', 'horn']) patchMaterial(Mat[k]);
}

const skinCache = new Map();
export function skinMat(hex) {
  if (!skinCache.has(hex)) skinCache.set(hex, patchMaterial(std({ color: hex, map: Tex.skin, roughness: 0.7 }), { wrap: false }));
  return skinCache.get(hex);
}
const clothCache = new Map();
export function clothMat(hex, double = false) {
  const k = hex + (double ? 'd' : '');
  if (!clothCache.has(k)) clothCache.set(k, patchMaterial(std({ color: hex, map: Tex.linen, normalMap: Tex.linenN, roughness: 0.92, side: double ? THREE.DoubleSide : THREE.FrontSide })));
  return clothCache.get(k);
}
const hairCache = new Map();
export function hairMat(hex) {
  if (!hairCache.has(hex)) hairCache.set(hex, std({ color: hex, roughness: 0.85, normalMap: Tex.furN }));
  return hairCache.get(hex);
}

export function initAssets() {
  buildTextures();
  buildMaterials();
}

export function setShadows(obj, cast = true, receive = true) {
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; } });
  return obj;
}

// ---------- geometry ----------
// Leaf atlas: sprigs of leaves on transparency, plus a solid patch in the top-right corner that the
// opaque canopy cores sample, so cards and core share one material and one draw call.
const leafTexCache = {};
export function leafTexture(kind) {
  if (leafTexCache[kind]) return leafTexCache[kind];
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), R = rng(kind === 'olive' ? 11 : 23);
  const olive = kind === 'olive';
  for (let i = 0; i < (olive ? 150 : 260); i++) {
    const x = 20 + R() * 200, y = 20 + R() * 200, a = R() * Math.PI * 2;
    const l = olive ? 14 + R() * 10 : 7 + R() * 6, w = olive ? 2.6 + R() * 1.4 : 2.2 + R() * 1.6;
    const t = R();
    g.fillStyle = olive ? `rgb(${88 + t * 60 | 0},${104 + t * 52 | 0},${66 + t * 34 | 0})` : `rgb(${30 + t * 26 | 0},${54 + t * 34 | 0},${30 + t * 18 | 0})`;
    g.save(); g.translate(x, y); g.rotate(a); g.beginPath(); g.ellipse(0, 0, l, w, 0, 0, Math.PI * 2); g.fill(); g.restore();
  }
  g.fillStyle = olive ? '#4e5a34' : '#22361f'; g.fillRect(232, 0, 24, 24);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return (leafTexCache[kind] = t);
}
// A canopy blob: an opaque, softly lumpy core plus leaf cards scattered over its surface, with normals
// bent outward from the centre so the clump lights like a volume instead of a set of flat planes.
function foliageBlob(out, cx, cy, cz, rx, ry, rz, r, cards = 36, cardSize = 0.9) {
  const core = new THREE.IcosahedronGeometry(1, 2); const cp = core.attributes.position;
  for (let i = 0; i < cp.count; i++) { const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i), k = 0.72 + noise2(x * 2 + cx, y * 2 + z + cz) * 0.25; cp.setXYZ(i, cx + x * rx * k, cy + y * ry * k, cz + z * rz * k); }
  core.deleteAttribute('uv'); core.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(cp.count * 2).fill(0.95), 2));
  core.computeVertexNormals(); out.push(core.index ? core.toNonIndexed() : core);
  const pos = [], nrm = [], uv = [], v = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let i = 0; i < cards; i++) {
    v.set(r() * 2 - 1, r() * 1.6 - 0.5, r() * 2 - 1).normalize();
    const px = cx + v.x * rx * 0.95, py = cy + v.y * ry * 0.95, pz = cz + v.z * rz * 0.95;
    e.set(r() * Math.PI, r() * Math.PI * 2, r() * Math.PI); q.setFromEuler(e);
    const hs = cardSize * (0.7 + r() * 0.6) * 0.5;
    const corners = [[-hs, -hs], [hs, -hs], [hs, hs], [-hs, hs]].map(([a, b]) => new THREE.Vector3(a, b, 0).applyQuaternion(q).add(new THREE.Vector3(px, py, pz)));
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const c = corners[k]; pos.push(c.x, c.y, c.z);
      const n = new THREE.Vector3(c.x - cx, (c.y - cy) * 0.8 + 0.3, c.z - cz).normalize(); nrm.push(n.x, n.y, n.z);
      uv.push(...[[0, 0], [0.9, 0], [0.9, 0.9], [0, 0.9]][k]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.push(g);
}

export function rockGeo(seed = 1, detail = 3) {
  return cachedGeo('rock' + seed + '_' + detail, () => {
    let g = new THREE.IcosahedronGeometry(1, detail);
    g.deleteAttribute('normal'); g.deleteAttribute('uv');
    g = mergeVertices(g);
    const p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = fbm2(v.x * 1.4 + seed * 7.1, v.y * 1.4 + v.z * 1.1 + seed * 3.3, 4);
      const n2 = noise2(v.x * 4 + seed, v.z * 4 - v.y * 3);
      let s = 0.75 + n * 0.55 + n2 * 0.08;
      if (v.y < -0.2) s *= 0.85;
      v.multiplyScalar(s);
      v.y *= 0.8;
      p.setXYZ(i, v.x, v.y, v.z);
    }
    // planar uvs for the normal map
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) * 0.5 + p.getZ(i) * 0.3; uv[i * 2 + 1] = p.getY(i) * 0.5 + p.getZ(i) * 0.2; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  });
}

export function oliveTreeGeos(seed = 1) {
  return cachedGeo('olive' + seed, () => {
    const r = rng(seed * 977);
    const trunkParts = [], leafParts = [];
    const pts = [];
    let x = 0, z = 0;
    for (let i = 0; i <= 5; i++) { pts.push(new THREE.Vector3(x, i * 0.55, z)); x += (r() - 0.5) * 0.5; z += (r() - 0.5) * 0.5; }
    const curve = new THREE.CatmullRomCurve3(pts);
    const trunk = new THREE.TubeGeometry(curve, 10, 0.26, 7, false);
    // taper
    const tp = trunk.attributes.position;
    for (let i = 0; i < tp.count; i++) { const y = tp.getY(i); const k = 1 - y / 4.5 * 0.45; const c = curve.getPointAt(clamp(y / 2.75)); tp.setX(i, c.x + (tp.getX(i) - c.x) * k); tp.setZ(i, c.z + (tp.getZ(i) - c.z) * k); }
    trunk.computeVertexNormals();
    trunkParts.push(trunk);
    const top = pts[pts.length - 1];
    for (let b = 0; b < 4; b++) {
      const a = (b / 4) * Math.PI * 2 + r();
      const end = top.clone().add(new THREE.Vector3(Math.cos(a) * 1.6, 0.6 + r() * 0.8, Math.sin(a) * 1.6));
      const bc = new THREE.CatmullRomCurve3([top.clone().add(new THREE.Vector3(0, -0.6, 0)), top.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 0.3, 0)), end]);
      trunkParts.push(new THREE.TubeGeometry(bc, 5, 0.1, 5, false));
      for (let k = 0; k < 2; k++) {
        const rad = 1.1 + r() * 0.5;
        foliageBlob(leafParts, end.x + (r() - 0.5) * 0.8, end.y + 0.2 + k * 0.3, end.z + (r() - 0.5) * 0.8, rad, rad * 0.65, rad, r, 34, 1.0);
      }
    }
    const leaves = mergeGeometries(leafParts);
    const tr = mergeGeometries(trunkParts.map((g) => { const n = g.index ? g.toNonIndexed() : g; return n; }));
    return { trunk: tr, leaves };
  });
}

export function cypressGeo() {
  return cachedGeo('cypress', () => {
    // a narrow flame of foliage: stacked leaf-card blobs tapering to a point, over a short trunk
    const parts = [], r = rng(5);
    const trunk = new THREE.CylinderGeometry(0.12, 0.2, 1.4, 6); trunk.translate(0, 0.7, 0); trunk.deleteAttribute('uv'); trunk.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(trunk.attributes.position.count * 2).fill(0.95), 2));
    parts.push(trunk.toNonIndexed());
    for (let i = 0; i < 7; i++) { const t = i / 6, w = 0.95 * (1 - t * 0.85) + 0.12; foliageBlob(parts, (r() - 0.5) * 0.15, 1.6 + t * 6.6, (r() - 0.5) * 0.15, w, 0.8, w, r, 22, 0.7); }
    return mergeGeometries(parts);
  });
}

export function grassBladeGeo() {
  return cachedGeo('tuft', () => {
    const parts = [];
    for (let i = 0; i < 6; i++) {
      const b = singleBlade(0.035 + Math.random() * 0.02, 0.35 + Math.random() * 0.3);
      b.rotateZ((Math.random() - 0.5) * 0.5); b.rotateY(Math.random() * Math.PI * 2);
      b.translate((Math.random() - 0.5) * 0.25, 0, (Math.random() - 0.5) * 0.25);
      parts.push(b);
    }
    return mergeGeometries(parts);
  });
}
function singleBlade(w, h) {
  {
    const pos = [-w, 0, 0, w, 0, 0, -w * 0.6, h * 0.5, 0.02, w * 0.6, h * 0.5, 0.02, 0, h, 0.06];
    const col = [0.16, 0.2, 0.08, 0.16, 0.2, 0.08, 0.3, 0.34, 0.14, 0.3, 0.34, 0.14, 0.46, 0.46, 0.22];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(15).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    return g;
  }
}

// Instanced scatter helper: positions = [{x,y,z,s,ry}]
export function instanced(geo, mat, items, { cast = true, receive = true, tilt = 0 } = {}) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  const o = new THREE.Object3D();
  items.forEach((it, i) => {
    o.position.set(it.x, it.y, it.z);
    if (it.q) o.quaternion.copy(it.q); else o.rotation.set((Math.random() - 0.5) * tilt, it.ry ?? Math.random() * Math.PI * 2, (Math.random() - 0.5) * tilt);
    if (it.sv) o.scale.copy(it.sv); else o.scale.setScalar(it.s ?? 1);
    o.updateMatrix();
    m.setMatrixAt(i, o.matrix);
  });
  m.count = items.length;
  m.castShadow = cast; m.receiveShadow = receive;
  m.instanceMatrix.needsUpdate = true;
  m.computeBoundingSphere();
  return m;
}

// ---------- the ship: a lofted Greek penteconter ----------
export function buildShip({ rowers = true } = {}) {
  const group = new THREE.Group();
  group.rotation.order = 'YXZ';
  const L = 24, B = 3.8, sections = 36, K = 14;
  const pos = [], col = [], uv = [], idx = [];
  for (let i = 0; i <= sections; i++) {
    const t = i / sections;
    const z = (t - 0.5) * L;
    const w = (B / 2) * Math.pow(Math.sin(Math.PI * clamp(t * 1.02 - 0.01, 0.001, 0.999)), 0.62);
    const sheer = 1.25 + 2.2 * Math.pow(Math.abs(2 * t - 1), 3.5) * (t < 0.5 ? 1.25 : 0.85);
    const keel = -0.75 + 0.5 * Math.pow(Math.abs(2 * t - 1), 6);
    for (let j = 0; j <= K; j++) {
      const s = j / K;
      const phi = (s - 0.5) * Math.PI;
      const x = w * Math.sin(phi);
      const y = sheer - (sheer - keel) * Math.pow(Math.cos(phi), 0.55);
      pos.push(x, y, z);
      uv.push(t * 6, s * 2);
      let c;
      if (y < 0.15) c = [0.16, 0.13, 0.11];
      else if (y > sheer - 0.3) c = [0.62, 0.5, 0.36];
      else if (y > sheer - 0.75) c = [0.52, 0.17, 0.1];
      else c = [0.3, 0.24, 0.19];
      col.push(...c);
    }
  }
  for (let i = 0; i < sections; i++) for (let j = 0; j < K; j++) {
    const a = i * (K + 1) + j, b = a + K + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const hg = new THREE.BufferGeometry();
  hg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  hg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  hg.setIndex(idx);
  hg.computeVertexNormals();
  const hull = new THREE.Mesh(hg, Mat.hull);
  group.add(hull);

  // Deck planks
  const deck = new THREE.Mesh(new THREE.BoxGeometry(B * 0.8, 0.08, L * 0.78), Mat.wood);
  deck.position.y = 0.55; group.add(deck);
  // Rowing benches
  for (let i = 0; i < 9; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(B * 0.85, 0.08, 0.3), Mat.darkWood); b.position.set(0, 0.95, -7 + i * 1.6); group.add(b); }
  // Bronze ram
  const ram = new THREE.Mesh(new THREE.ConeGeometry(0.32, 2.2, 6), Mat.bronze);
  ram.rotation.x = Math.PI / 2; ram.position.set(0, -0.15, L / 2 + 0.6); group.add(ram);
  // Stern ornament (aphlaston) and bow post
  const sternCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 2.6, -L / 2 + 0.6), new THREE.Vector3(0, 3.9, -L / 2 - 0.4), new THREE.Vector3(0, 4.6, -L / 2 + 0.5), new THREE.Vector3(0, 4.3, -L / 2 + 1.1)]);
  group.add(new THREE.Mesh(new THREE.TubeGeometry(sternCurve, 16, 0.14, 6), Mat.darkWood));
  const bowCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 2.3, L / 2 - 0.8), new THREE.Vector3(0, 3.2, L / 2 - 0.2), new THREE.Vector3(0, 3.5, L / 2 - 0.7)]);
  group.add(new THREE.Mesh(new THREE.TubeGeometry(bowCurve, 10, 0.12, 6), Mat.darkWood));
  // Painted eyes
  const eyeTex = (() => {
    const c = canvas(128, 64), g = c.getContext('2d');
    g.fillStyle = '#f0e6d0'; g.beginPath(); g.ellipse(64, 32, 56, 22, 0, 0, 7); g.fill();
    g.fillStyle = '#a8301c'; g.beginPath(); g.arc(64, 32, 16, 0, 7); g.fill();
    g.fillStyle = '#111'; g.beginPath(); g.arc(64, 32, 9, 0, 7); g.fill();
    g.strokeStyle = '#111'; g.lineWidth = 5; g.beginPath(); g.ellipse(64, 32, 56, 22, 0, 0, 7); g.stroke();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const eyeMat = new THREE.MeshStandardMaterial({ map: eyeTex, transparent: true, roughness: 0.6, alphaTest: 0.1 });
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.55), eyeMat);
    e.position.set(sx * 0.72, 1.35, L / 2 - 2.1);
    e.rotation.y = sx * (Math.PI / 2 - 0.35);
    group.add(e);
  }
  // Shields along the rails
  const shieldGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.05, 18); shieldGeo.rotateZ(Math.PI / 2);
  for (let i = 0; i < 7; i++) for (const sx of [-1, 1]) {
    const z = -6 + i * 1.9;
    const t = z / L + 0.5;
    const w = (B / 2) * Math.pow(Math.sin(Math.PI * t), 0.62);
    const s = new THREE.Mesh(shieldGeo, i % 2 ? Mat.bronze : clothMat(i % 3 ? '#8c2a1a' : '#d8c8a0'));
    s.position.set(sx * (w + 0.04), 1.55, z); group.add(s);
  }
  // Mast, yard, sail
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 11, 8), Mat.darkWood);
  mast.position.set(0, 6, 1); group.add(mast);
  const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 10, 6), Mat.darkWood);
  yard.rotation.z = Math.PI / 2; yard.position.set(0, 10.6, 1.15); group.add(yard);
  const sailGeo = new THREE.PlaneGeometry(9.4, 6.8, 14, 10);
  const sail = new THREE.Mesh(sailGeo, Mat.sail);
  sail.position.set(0, 7.15, 1.3);
  group.add(sail);
  const sailBase = Float32Array.from(sailGeo.attributes.position.array);
  // Rigging
  const rig = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 11.4, 1), new THREE.Vector3(0, 3.2, L / 2 - 0.5), new THREE.Vector3(0, 11.4, 1), new THREE.Vector3(0, 4.2, -L / 2 + 1),
    new THREE.Vector3(-4.6, 10.6, 1.15), new THREE.Vector3(-1.6, 1.5, -2), new THREE.Vector3(4.6, 10.6, 1.15), new THREE.Vector3(1.6, 1.5, -2),
    new THREE.Vector3(0, 11.4, 1), new THREE.Vector3(-1.8, 1.4, 1), new THREE.Vector3(0, 11.4, 1), new THREE.Vector3(1.8, 1.4, 1),
  ]);
  group.add(new THREE.LineSegments(rig, new THREE.LineBasicMaterial({ color: 0x3a2e22 })));
  // Oars
  const oarGeo = (() => {
    const shaft = new THREE.CylinderGeometry(0.04, 0.05, 5.2, 5); shaft.translate(0, -2.6, 0);
    const blade = new THREE.BoxGeometry(0.28, 1.0, 0.04); blade.translate(0, -4.9, 0);
    return mergeGeometries([shaft.toNonIndexed(), blade.toNonIndexed()]);
  })();
  const oars = [];
  for (let i = 0; i < 9; i++) for (const sx of [-1, 1]) {
    const z = -6.6 + i * 1.6;
    const t = z / L + 0.5;
    const w = (B / 2) * Math.pow(Math.sin(Math.PI * t), 0.62);
    const pivot = new THREE.Group();
    pivot.position.set(sx * w, 1.35, z);
    const oar = new THREE.Mesh(oarGeo, Mat.wood);
    oar.rotation.z = sx * 1.05;
    pivot.add(oar);
    group.add(pivot);
    oars.push({ pivot, side: sx, phase: i * 0.0 });
  }
  setShadows(group, true, true);
  sail.castShadow = true;

  const api = {
    group, hull, sail, oars,
    sailFurl: 0, billow: 1, rowing: 0,
    update(t, wind = 1, rowing = 0) {
      const p = sailGeo.attributes.position.array;
      const furl = this.sailFurl;
      for (let i = 0; i < p.length; i += 3) {
        const bx = sailBase[i], by = sailBase[i + 1];
        const u = bx / 9.4 + 0.5, v = by / 6.8 + 0.5;
        const belly = Math.sin(Math.PI * u) * Math.sin(Math.PI * (0.15 + v * 0.85));
        const flutter = Math.sin(t * 3.1 + u * 5 + v * 3) * 0.08 + Math.sin(t * 5.3 + u * 9) * 0.04;
        p[i] = bx;
        p[i + 1] = by + furl * (3.4 - by) * 0.85;
        p[i + 2] = belly * (1.3 * wind * (1 - furl)) + flutter * (0.5 + wind);
      }
      sailGeo.attributes.position.needsUpdate = true;
      sailGeo.computeVertexNormals();
      this.rowing += (rowing - this.rowing) * 0.05;
      for (const o of oars) {
        const ph = t * 2.4;
        o.pivot.rotation.y = o.side * Math.sin(ph) * 0.45 * this.rowing;
        o.pivot.rotation.x = -Math.cos(ph) * 0.12 * this.rowing;
      }
    },
  };
  return api;
}

// ---------- fire ----------
const flameVert = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const flameFrag = `
uniform float uTime, uIntensity, uSeed; varying vec2 vUv;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
void main(){
  vec2 uv = vUv;
  float n = vn(vec2(uv.x * 5.0 + uSeed, uv.y * 4.0 - uTime * 3.2)) * 0.6 + vn(vec2(uv.x * 11.0 - uSeed, uv.y * 8.0 - uTime * 5.0)) * 0.4;
  float w = abs(uv.x - 0.5) * 2.0;
  float shape = 1.0 - smoothstep(0.0, 1.0, w * (1.0 + uv.y * 1.8) + (n - 0.5) * 0.6);
  float f = shape * (1.0 - smoothstep(0.15, 1.0, uv.y + (n - 0.5) * 0.45)) * smoothstep(0.0, 0.08, uv.y);
  f = clamp(f * 1.6, 0.0, 1.0);
  vec3 col = mix(vec3(1.0, 0.28, 0.04), vec3(1.0, 0.85, 0.45), f * f);
  gl_FragColor = vec4(col * f * 2.2 * uIntensity, f * uIntensity);
}`;

export class Fire {
  constructor({ scale = 1, intensity = 60, distance = 0, shadow = false, color = 0xff8a3a } = {}) {
    this.group = new THREE.Group();
    this.scale = scale;
    this.base = intensity;
    this.level = 1;
    this.flames = [];
    for (let i = 0; i < 3; i++) {
      const m = new THREE.ShaderMaterial({ uniforms: { uTime: shaderTime, uIntensity: { value: 1 }, uSeed: { value: i * 3.7 } }, vertexShader: flameVert, fragmentShader: flameFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const f = new THREE.Mesh(new THREE.PlaneGeometry(1.2 * scale, 2.0 * scale), m);
      f.position.y = 0.9 * scale;
      f.rotation.y = (i / 3) * Math.PI;
      this.group.add(f);
      this.flames.push(f);
    }
    this.light = new THREE.PointLight(color, intensity, distance, 2);
    this.light.position.y = 1.4 * scale;
    this.light.castShadow = shadow;
    if (shadow) { this.light.shadow.mapSize.set(1024, 1024); this.light.shadow.bias = -0.003; this.light.shadow.camera.near = 0.5; this.light.shadow.camera.far = 60; this.light.shadow.radius = 4; }
    this.group.add(this.light);
    this.emitT = 0;
  }
  update(t, dt, fx, camera) {
    const flick = 0.82 + 0.18 * (Math.sin(t * 11.3) * 0.5 + Math.sin(t * 7.1 + 1.3) * 0.3 + Math.sin(t * 23.7) * 0.2);
    this.flare = Math.max(0, (this.flare || 0) - dt * 1.4);
    // The flame's centre wanders, so shadows breathe; a slow gutter under the fast flicker.
    this.light.position.set(Math.sin(t * 3.7) * 0.1 * this.scale + Math.sin(t * 9.1) * 0.03, 1.4 * this.scale + Math.sin(t * 5.3) * 0.08 * this.scale, Math.cos(t * 4.1) * 0.1 * this.scale);
    this.gutter = (this.gutter ?? 1) + ((0.82 + Math.random() * 0.3) - (this.gutter ?? 1)) * Math.min(1, dt * 2);
    this.light.intensity = this.base * (this.level + this.flare) * flick * this.gutter;
    for (const f of this.flames) {
      f.material.uniforms.uIntensity.value = Math.min(1.4, this.level + (this.flare || 0));
      f.scale.y = 0.4 + 0.6 * Math.min(1.8, this.level + (this.flare || 0));
      f.visible = this.level > 0.02;
    }
    if (camera) { const p = this.group.getWorldPosition(_fp); this.flames[0].rotation.y = Math.atan2(camera.position.x - p.x, camera.position.z - p.z); }
    if (fx && this.level > 0.05) {
      this.emitT -= dt;
      if (this.emitT <= 0) {
        this.emitT = 0.12 / Math.max(0.3, this.level);
        const p = this.group.getWorldPosition(_fp);
        fx.emit('ember', _fp2.set(p.x, p.y + 0.8 * this.scale, p.z), 2, { spread: 0.6 * this.scale });
        if (Math.random() < 0.3) fx.emit('smoke', _fp2.set(p.x, p.y + 2 * this.scale, p.z), 1, { scale: this.scale });
      }
    }
  }
}
const _fp = new THREE.Vector3(), _fp2 = new THREE.Vector3();

// ---------- props ----------
export function cheeseWheel() { return cachedGeo('cheese', () => new THREE.CylinderGeometry(0.55, 0.55, 0.32, 20)); }
export function boulderMesh(r = 5) {
  const m = new THREE.Mesh(rockGeo(42, 4), Mat.stone);
  m.scale.set(r, r * 1.05, r * 0.85);
  return setShadows(m);
}

export function buildStaff() {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.17, 7, 8, 6), Mat.bark);
  shaft.rotation.z = Math.PI / 2;
  g.add(shaft);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.7, 8), Mat.staffTip.clone());
  tip.rotation.z = -Math.PI / 2;
  tip.position.x = 3.85;
  g.add(tip);
  tip.visible = false;
  setShadows(g);
  return { group: g, tip, shaft };
}

export function wineskin() {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), Mat.leather);
  b.scale.set(1, 0.8, 1.3); g.add(b);
  const n = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.18, 6), Mat.leather);
  n.position.set(0, 0.1, 0.26); n.rotation.x = 1.0; g.add(n);
  return g;
}

// Fresco panel: a painted side story (original imagery).
export function frescoTexture(kind = 'ship') {
  const c = canvas(512, 256), g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256); grd.addColorStop(0, '#d8b98a'); grd.addColorStop(1, '#c49a68');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(${90 + Math.random() * 60},${60 + Math.random() * 40},40,${Math.random() * 0.08})`; g.fillRect(Math.random() * 512, Math.random() * 256, Math.random() * 30, Math.random() * 6); }
  g.fillStyle = '#2a4a6a'; g.fillRect(0, 170, 512, 86);
  g.strokeStyle = '#e8dcc0'; g.lineWidth = 3;
  for (let x = 0; x < 512; x += 24) { g.beginPath(); g.arc(x + 12, 190, 10, Math.PI, 0); g.stroke(); }
  g.fillStyle = '#7a2a1a';
  if (kind === 'ship') {
    g.beginPath(); g.moveTo(150, 170); g.quadraticCurveTo(250, 200, 360, 170); g.lineTo(380, 140); g.lineTo(350, 165); g.lineTo(160, 165); g.lineTo(140, 130); g.closePath(); g.fill();
    g.fillStyle = '#1a1410'; g.fillRect(252, 60, 5, 105);
    g.fillStyle = '#e8dcc0'; g.fillRect(210, 70, 90, 60);
    g.fillStyle = '#1a1410'; for (let i = 0; i < 7; i++) { g.beginPath(); g.arc(180 + i * 25, 155, 7, 0, 7); g.fill(); }
  } else {
    g.fillStyle = '#1a1410';
    g.beginPath(); g.ellipse(256, 110, 40, 60, 0, 0, 7); g.fill();
    g.beginPath(); g.arc(256, 40, 26, 0, 7); g.fill();
    g.fillStyle = '#e8dcc0'; g.beginPath(); g.arc(256, 38, 9, 0, 7); g.fill();
    g.fillStyle = '#7a2a1a'; for (let i = 0; i < 5; i++) { g.beginPath(); g.ellipse(120 + i * 70 - (i > 1 ? -20 : 0), 160, 22, 12, 0, 0, 7); g.fill(); }
  }
  g.strokeStyle = '#5a2a14'; g.lineWidth = 10; g.strokeRect(5, 5, 502, 246);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
