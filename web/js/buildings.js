// Everything that stands on a plot. Each building is composed from a handful of
// vertex-coloured primitives and merged into a single geometry, so 300 houses cost
// 300 draw calls rather than 6000. Windows glow at night through a per-vertex
// emissive mask on the one shared material.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng, hash32 } from 'shared/rng.mjs';

export const PALETTE = {
  fable: { wall: 0xcfc4e6, trim: 0x6e5aa8, roof: 0xb87333, accent: 0x7a4fb0, glow: 0xffd27f, name: 'Fable' },
  opus: { wall: 0xa8a59e, trim: 0x6f6b64, roof: 0x4c5566, accent: 0x5a3a24, glow: 0xffcf7a, name: 'Opus' },
  sonnet: { wall: 0xf0e2c8, trim: 0x6b4a2f, roof: 0x5c8a4a, accent: 0x8a4b2a, glow: 0xffd88a, name: 'Sonnet' },
  haiku: { wall: 0xd9b98c, trim: 0x7d5a3a, roof: 0xc9a75c, accent: 0x5a3c28, glow: 0xffe0a0, name: 'Haiku' },
  unknown: { wall: 0x9a9a9a, trim: 0x6f6f6f, roof: 0x6f6f6f, accent: 0x555555, glow: 0xffffff, name: 'Unknown' },
};

const C = {
  foundation: 0x8d8577, wood: 0x8b5e3c, darkWood: 0x5a3c28, canvas: 0xe9d8b4,
  stripe: 0xc86b4a, anvil: 0x3a3a3f, copper: 0xb87333, stone: 0xa8a59e,
  slate: 0x4c5566, plank: 0xb07a4a, blueprint: 0x4d7ec9, paper: 0xf5efe0,
  thatch: 0xc9a75c, brick: 0x9c5a44, glass: 0xffd27f, white: 0xf5efe0,
  green: 0x6fb84a, red: 0xd94f3d, blue: 0x3d7ed9, gold: 0xd9a33d, iron: 0x3a3a3f,
};

export const TIER_INDEX = { tent: 0, hut: 1, cottage: 2, house: 3, manor: 4, keep: 5, shed: -1, civic: -2 };
export const TIER_LABEL = { tent: 'Tent', hut: 'Hut', cottage: 'Cottage', house: 'House', manor: 'Manor', keep: 'Keep' };

// ---------------------------------------------------------------- material
export function createBuildingMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0.0 });
  mat.userData.uniforms = { uNight: { value: 0 } };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = mat.userData.uniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aEmissive;\nvarying float vEmi;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEmi = aEmissive;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vEmi;\nuniform float uNight;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vEmi * (0.25 + uNight * 1.7);');
  };
  mat.customProgramCacheKey = () => 'settlers-emissive';
  return mat;
}

// ---------------------------------------------------------------- primitives
function finish(g, hex, emissive = 0) {
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const flat = g.index ? g.toNonIndexed() : g;
  const n = flat.attributes.position.count;
  const c = new THREE.Color(hex);
  const col = new Float32Array(n * 3), emi = new Float32Array(n);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; emi[i] = emissive; }
  flat.setAttribute('color', new THREE.BufferAttribute(col, 3));
  flat.setAttribute('aEmissive', new THREE.BufferAttribute(emi, 1));
  return flat;
}
function place(g, o = {}) {
  if (o.ry) g.rotateY(o.ry);
  if (o.rx) g.rotateX(o.rx);
  if (o.rz) g.rotateZ(o.rz);
  g.translate(o.x || 0, o.y || 0, o.z || 0);
  return g;
}
// a box whose base sits at y = o.y
export function box(w, h, d, hex, o = {}) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  return place(finish(g, hex, o.emissive || 0), o);
}
export function cylinder(rt, rb, h, seg, hex, o = {}) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  g.translate(0, h / 2, 0);
  return place(finish(g, hex, o.emissive || 0), o);
}
export function cone(r, h, seg, hex, o = {}) {
  const g = new THREE.ConeGeometry(r, h, seg);
  g.translate(0, h / 2, 0);
  return place(finish(g, hex, o.emissive || 0), o);
}
export function dome(r, hex, o = {}) {
  const g = new THREE.SphereGeometry(r, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  return place(finish(g, hex, o.emissive || 0), o);
}
export function sphere(r, hex, o = {}) {
  const g = new THREE.SphereGeometry(r, 7, 5);
  return place(finish(g, hex, o.emissive || 0), o);
}
// gable roof: a triangular prism, base at y = o.y, ridge running along x
export function prismRoof(w, d, h, hex, o = {}) {
  const hw = w / 2, hd = d / 2;
  const v = [
    -hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd,   // 0..3 base
    -hw, h, 0, hw, h, 0,                               // 4,5 ridge
  ];
  // Wound counter-clockwise seen from outside, or the whole roof is back-face culled
  // and you look straight through the house.
  const f = [
    0, 5, 1, 0, 4, 5,   // the slope facing -z
    2, 4, 3, 2, 5, 4,   // the slope facing +z
    0, 3, 4, 1, 5, 2,   // the two gable ends
    0, 2, 3, 0, 1, 2,   // the underside
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(f);
  return place(finish(g, hex, 0), o);
}
export function pyramidRoof(w, d, h, hex, o = {}) {
  const g = new THREE.ConeGeometry(0.7071, h, 4);
  g.rotateY(Math.PI / 4);
  g.scale(w, 1, d);
  g.translate(0, h / 2, 0);
  return place(finish(g, hex, 0), o);
}
// A flat triangle or quad, given 3 or 4 points. Used for sails, fins and pennants.
export function quad(pts, hex, o = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
  g.setIndex(pts.length === 3 ? [0, 1, 2, 0, 2, 1] : [0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]);
  return place(finish(g, hex, o.emissive || 0), o);
}

function merge(parts) {
  const g = mergeGeometries(parts.filter(Boolean), false);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------- pieces
function windowsOn(parts, pal, { w, h, y0, count, ry = 0 }) {
  const hw = w / 2 + 0.005;
  const spots = [
    { x: -w * 0.22, z: hw, ry: 0 }, { x: w * 0.22, z: hw, ry: 0 },
    { x: hw, z: 0, ry: Math.PI / 2 }, { x: -hw, z: 0, ry: Math.PI / 2 },
    { x: -w * 0.22, z: -hw, ry: 0 }, { x: w * 0.22, z: -hw, ry: 0 },
  ];
  for (let i = 0; i < Math.min(count, spots.length); i++) {
    const s = spots[i];
    parts.push(box(0.13, 0.17, 0.04, pal.glow, { x: s.x, y: y0, z: s.z, ry: s.ry, emissive: 1 }));
  }
  void h; void ry;
}
function door(parts, pal, w) {
  parts.push(box(0.16, 0.26, 0.05, pal.accent, { x: 0, y: 0, z: w / 2 + 0.01 }));
}
function foundation(parts, w, d) {
  parts.push(box(w + 0.12, 0.34, d + 0.12, C.foundation, { y: -0.3 }));
}

function timberFrame(parts, w, h, d, hex) {
  const t = 0.035;
  for (const [x, z, ry] of [[0, d / 2, 0], [0, -d / 2, 0], [w / 2, 0, Math.PI / 2], [-w / 2, 0, Math.PI / 2]]) {
    parts.push(box(t, h, t, hex, { x: x + (ry ? 0 : -w * 0.3), y: 0, z, ry }));
    parts.push(box(t, h, t, hex, { x: x + (ry ? 0 : w * 0.3), y: 0, z, ry }));
    parts.push(box(w * 0.9, t, t, hex, { x, y: h - t, z, ry }));
  }
}

// ---------------------------------------------------------------- houses
function houseBody(parts, spec, pal, rng) {
  const tier = TIER_INDEX[spec.tier] ?? 1;
  const anchors = {};
  const style = spec.style || 'unknown';

  if (tier === 0) {                                   // tent
    parts.push(prismRoof(0.8, 0.86, 0.58, C.canvas));
    parts.push(box(0.045, 0.64, 0.045, C.darkWood, { z: -0.41 }));
    parts.push(box(0.3, 0.025, 0.035, pal.trim, { y: 0.24, z: 0.44 }));
    return { anchors, height: 0.62, w: 0.84 };
  }

  const dims = [
    null,
    { w: 0.88, h: 0.56, roof: 0.4, win: 2 },
    { w: 1.0, h: 0.68, roof: 0.46, win: 3 },
    { w: 1.08, h: 0.98, roof: 0.5, win: 4 },
    { w: 1.14, h: 1.12, roof: 0.52, win: 5 },
    { w: 1.18, h: 1.42, roof: 0.44, win: 6 },
  ][tier];

  parts.push(box(dims.w, dims.h, dims.w, pal.wall));
  foundation(parts, dims.w, dims.w);
  door(parts, pal, dims.w);
  windowsOn(parts, pal, { w: dims.w, h: dims.h, y0: dims.h * 0.42, count: dims.win });
  if (tier >= 3) windowsOn(parts, pal, { w: dims.w, h: dims.h, y0: dims.h * 0.12, count: 2 });

  let top = dims.h;
  if (style === 'opus') {
    parts.push(box(dims.w + 0.06, 0.13, dims.w + 0.06, C.stone, { y: 0 }));
    parts.push(pyramidRoof(dims.w + 0.14, dims.w + 0.14, dims.roof + 0.06, pal.roof, { y: top }));
    top += dims.roof + 0.06;
  } else if (style === 'haiku') {
    parts.push(cone(dims.w * 0.82, dims.roof + 0.16, 8, pal.roof, { y: top - 0.02 }));
    top += dims.roof + 0.14;
  } else if (style === 'sonnet') {
    timberFrame(parts, dims.w, dims.h, dims.w, pal.trim);
    parts.push(prismRoof(dims.w + 0.14, dims.w + 0.14, dims.roof, pal.roof, { y: top }));
    top += dims.roof;
  } else {
    parts.push(prismRoof(dims.w + 0.12, dims.w + 0.12, dims.roof, pal.roof, { y: top }));
    top += dims.roof;
  }

  if (tier >= 2) parts.push(box(0.12, 0.3, 0.12, C.brick, { x: dims.w * 0.3, y: dims.h, z: -dims.w * 0.3 }));
  if (tier === 3) {                                    // dormer
    parts.push(box(0.24, 0.2, 0.22, pal.wall, { y: dims.h + 0.04, z: dims.w * 0.25 }));
    parts.push(prismRoof(0.28, 0.26, 0.14, pal.roof, { y: dims.h + 0.24, z: dims.w * 0.25 }));
    parts.push(box(0.1, 0.1, 0.03, pal.glow, { y: dims.h + 0.1, z: dims.w * 0.25 + 0.12, emissive: 1 }));
  }
  if (tier >= 4) {                                     // wing
    parts.push(box(0.44, dims.h * 0.72, 0.5, pal.wall, { x: dims.w * 0.62, z: -0.1 }));
    parts.push(prismRoof(0.52, 0.58, 0.28, pal.roof, { x: dims.w * 0.62, y: dims.h * 0.72, z: -0.1, ry: Math.PI / 2 }));
    for (let i = 0; i < 4; i++) {                      // garden fence
      parts.push(box(0.04, 0.18, 0.04, C.darkWood, { x: -0.42 + i * 0.28, z: 0.62 }));
    }
    parts.push(box(0.92, 0.03, 0.03, C.darkWood, { x: -0.28, y: 0.13, z: 0.62 }));
  }
  if (tier === 5) {                                    // keep: corner tower + battlements
    parts.push(cylinder(0.2, 0.22, dims.h + 0.4, 8, pal.wall, { x: -dims.w * 0.42, z: -dims.w * 0.42 }));
    parts.push(cone(0.26, 0.32, 8, pal.roof, { x: -dims.w * 0.42, y: dims.h + 0.4, z: -dims.w * 0.42 }));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      parts.push(box(0.1, 0.1, 0.1, pal.wall, { x: Math.cos(a) * dims.w * 0.42, y: dims.h, z: Math.sin(a) * dims.w * 0.42 }));
    }
    anchors.flag = [0, top + 0.34, 0];
    parts.push(box(0.025, 0.4, 0.025, C.darkWood, { y: top }));
  }

  // Fable builds upward: an observatory tower with a copper dome and a telescope.
  if (style === 'fable' && tier >= 2) {
    const tx = -dims.w * 0.36, tz = -dims.w * 0.36, th = dims.h + 0.45 + tier * 0.06;
    parts.push(cylinder(0.21, 0.23, th, 9, pal.wall, { x: tx, z: tz }));
    parts.push(dome(0.25, pal.accent, { x: tx, y: th, z: tz }));
    parts.push(cone(0.05, 0.24, 6, C.copper, { x: tx, y: th + 0.2, z: tz }));
    parts.push(box(0.09, 0.12, 0.03, pal.glow, { x: tx, y: th - 0.28, z: tz + 0.22, emissive: 1 }));
    const tel = cylinder(0.028, 0.04, 0.3, 6, C.copper, {});
    tel.rotateZ(-0.6);
    tel.translate(tx + 0.2, th + 0.12, tz + 0.06);
    parts.push(tel);
    top = Math.max(top, th + 0.42);
  }
  return { anchors, height: top, w: dims.w };
}

function ornament(parts, name, pal, dims, anchors) {
  const w = dims.w;
  const tent = dims.tier === 0;
  switch (name) {
    case 'forge':
      if (tent) {   // no chimney on a tent: a brazier on the ground instead
        parts.push(cylinder(0.1, 0.13, 0.14, 7, C.brick, { x: -0.46, z: -0.4 }));
        parts.push(cylinder(0.09, 0.09, 0.03, 7, 0x3a2a22, { x: -0.46, y: 0.14, z: -0.4 }));
        anchors.smoke = [-0.46, 0.2, -0.4];
      } else {
        parts.push(box(0.15, 0.5, 0.15, C.brick, { x: -w * 0.34, y: dims.height * 0.55, z: -w * 0.34 }));
        anchors.smoke = [-w * 0.34, dims.height * 0.55 + 0.5, -w * 0.34];
      }
      break;
    case 'lumber': {
      const s = tent ? 0.72 : 1;
      for (let i = 0; i < 3; i++) parts.push(box(0.3 * s, 0.055, 0.1 * s, C.plank, { x: 0.44, y: 0.02 + i * 0.06, z: 0.42 - i * 0.02, ry: 0.2 }));
      parts.push(box(0.028, 0.17, 0.028, C.darkWood, { x: 0.34, z: 0.62, rz: 0.32 }));
      parts.push(box(0.028, 0.17, 0.028, C.darkWood, { x: 0.55, z: 0.62, rz: -0.32 }));
      parts.push(box(0.24, 0.025, 0.025, C.darkWood, { x: 0.445, y: 0.16, z: 0.62 }));
      break;
    }
    case 'lantern':
      parts.push(cylinder(0.02, 0.025, 0.5, 5, C.darkWood, { x: -0.46, z: 0.46 }));
      parts.push(box(0.1, 0.12, 0.1, 0xffb347, { x: -0.46, y: 0.5, z: 0.46, emissive: 1 }));
      parts.push(box(0.13, 0.02, 0.13, C.iron, { x: -0.46, y: 0.62, z: 0.46 }));
      break;
    case 'weathervane': {
      if (tent) {   // a pennant on the tent pole
        parts.push(quad([[0, 0.5, -0.34], [0, 0.62, -0.34], [0.26, 0.55, -0.34]], pal.trim, {}));
        break;
      }
      const y = dims.height + 0.04;
      parts.push(cylinder(0.012, 0.012, 0.26, 4, C.iron, { y }));
      parts.push(box(0.2, 0.02, 0.02, C.iron, { y: y + 0.24 }));
      parts.push(quad([[0.02, y + 0.16, 0], [0.02, y + 0.31, 0], [0.13, y + 0.235, 0]], C.copper, {}));
      break;
    }
    case 'pigeons': {
      const base = tent ? 0.0 : dims.height - 0.05;
      const px = tent ? 0.46 : w * 0.26, pz = tent ? 0.3 : w * 0.2;
      parts.push(cylinder(0.02, 0.024, tent ? 0.6 : 0.3, 4, C.darkWood, { x: px, y: base, z: pz }));
      const loftY = base + (tent ? 0.6 : 0.3);
      parts.push(box(0.19, 0.15, 0.15, C.wood, { x: px, y: loftY, z: pz }));
      parts.push(box(0.05, 0.05, 0.02, 0x2b2b2b, { x: px, y: loftY + 0.05, z: pz + 0.08 }));
      parts.push(sphere(0.035, 0xf4f4f4, { x: px + 0.11, y: loftY + 0.19, z: pz }));
      break;
    }
    case 'banner': {
      const y = tent ? 0.42 : dims.height - 0.04;
      parts.push(box(0.022, 0.34, 0.022, C.darkWood, { x: w * 0.36, y, z: w * 0.3 }));
      anchors.flag = [w * 0.36, y + 0.34, w * 0.3];
      break;
    }
    case 'lightningrod': {
      const y = tent ? 0.4 : dims.height;
      parts.push(cylinder(0.012, 0.012, 0.42, 4, C.iron, { x: -w * 0.3, y }));
      parts.push(sphere(0.028, C.copper, { x: -w * 0.3, y: y + 0.44 }));
      break;
    }
    default: break;
  }
}

// ---------------------------------------------------------------- sheds
function shed(parts, spec, pal) {
  const t = spec.shedType || 'other';
  const anchors = {};
  if (t === 'explore') {
    parts.push(cone(0.3, 0.5, 6, C.canvas, {}));
    parts.push(box(0.03, 0.3, 0.03, C.darkWood, { x: 0.24, z: 0.1, rz: 0.28 }));
    parts.push(box(0.03, 0.3, 0.03, C.darkWood, { x: 0.32, z: -0.06, rz: -0.18 }));
    const tel = cylinder(0.028, 0.042, 0.28, 6, C.copper, {});
    tel.rotateZ(-0.55);
    tel.translate(0.3, 0.34, 0.02);
    parts.push(tel);
    return { anchors, height: 0.55 };
  }
  if (t === 'plan') {
    parts.push(box(0.44, 0.3, 0.42, pal.wall));
    parts.push(box(0.1, 0.2, 0.03, pal.accent, { y: 0, z: 0.21 }));
    // a single pitch roof, clearly slanted
    const roof = prismRoof(0.54, 0.5, 0.22, pal.roof, { y: 0.3 });
    parts.push(roof);
    parts.push(box(0.5, 0.03, 0.03, pal.trim, { y: 0.3, z: 0.24 }));
    // the drawing board leaning against the wall
    const board = box(0.34, 0.32, 0.025, C.blueprint, { x: 0.28, y: 0.02, z: 0.1, ry: Math.PI / 2 });
    board.rotateZ(0);
    parts.push(board);
    parts.push(box(0.02, 0.02, 0.22, C.paper, { x: 0.295, y: 0.24, z: 0.1 }));
    parts.push(box(0.02, 0.02, 0.15, C.paper, { x: 0.295, y: 0.18, z: 0.13 }));
    parts.push(box(0.02, 0.02, 0.19, C.paper, { x: 0.295, y: 0.12, z: 0.09 }));
    return { anchors, height: 0.54 };
  }
  if (t === 'general') {
    parts.push(box(0.46, 0.32, 0.46, pal.wall));
    parts.push(prismRoof(0.54, 0.54, 0.2, pal.roof, { y: 0.32 }));
    parts.push(box(0.09, 0.1, 0.09, C.brick, { x: -0.15, y: 0.32, z: -0.15 }));
    parts.push(cylinder(0.07, 0.08, 0.12, 7, C.darkWood, { x: 0.3, z: 0.22 }));
    parts.push(box(0.17, 0.055, 0.07, C.anvil, { x: 0.3, y: 0.12, z: 0.22 }));
    return { anchors, height: 0.52 };
  }
  if (t === 'guide') {
    parts.push(box(0.44, 0.3, 0.4, pal.wall));
    parts.push(box(0.44, 0.05, 0.1, C.wood, { y: 0.3, z: 0.2 }));
    const awn = box(0.5, 0.04, 0.3, C.stripe, { y: 0.32, z: 0.28 });
    awn.rotateX(-0.3);
    parts.push(awn);
    parts.push(box(0.11, 0.03, 0.08, C.red, { y: 0.32, z: 0.16 }));
    parts.push(box(0.11, 0.03, 0.08, C.blue, { y: 0.355, z: 0.14 }));
    parts.push(box(0.11, 0.03, 0.08, C.gold, { y: 0.39, z: 0.17 }));
    return { anchors, height: 0.44 };
  }
  parts.push(box(0.42, 0.3, 0.42, C.wood));
  parts.push(prismRoof(0.5, 0.5, 0.18, C.darkWood, { y: 0.3 }));
  return { anchors, height: 0.48 };
}

// ---------------------------------------------------------------- civic
function civic(parts, spec, rng) {
  const anchors = {};
  const animated = {};
  switch (spec.civicType) {
    case 'townhall': {
      parts.push(box(1.5, 0.75, 1.15, C.stone));
      parts.push(box(1.34, 0.5, 1.02, 0xf0e2c8, { y: 0.75 }));
      timberFrame(parts, 1.34, 0.5, 1.02, 0x6b4a2f);
      parts.push(prismRoof(1.55, 1.2, 0.5, C.slate, { y: 1.25 }));
      for (let i = 0; i < 4; i++) parts.push(box(0.14, 0.2, 0.04, C.glass, { x: -0.5 + i * 0.34, y: 0.32, z: 0.58, emissive: 1 }));
      parts.push(box(0.3, 0.45, 0.06, 0x5a3a24, { z: 0.58 }));
      for (let i = 0; i < 3; i++) parts.push(box(0.5 - i * 0.06, 0.07, 0.14, C.stone, { y: -0.21 + i * 0.07, z: 0.66 + (2 - i) * 0.07 }));
      // bell tower
      parts.push(cylinder(0.19, 0.21, 1.5, 6, 0xf0e2c8, { x: -0.52, y: 1.05, z: -0.28 }));
      parts.push(pyramidRoof(0.5, 0.5, 0.42, C.copper, { x: -0.52, y: 2.55, z: -0.28 }));
      parts.push(sphere(0.07, C.gold, { x: -0.52, y: 3.02, z: -0.28 }));
      parts.push(dome(0.09, 0xcfa14a, { x: -0.52, y: 2.5, z: -0.28, rx: Math.PI }));
      anchors.flag = [0.55, 1.9, 0];
      parts.push(box(0.025, 0.62, 0.025, C.darkWood, { x: 0.55, y: 1.28 }));
      // the founding stone
      parts.push(box(0.34, 0.1, 0.3, C.stone, { x: 0.75, y: -0.24, z: 0.72 }));
      const st = box(0.22, 0.42, 0.13, 0x4a4a52, { x: 0.75, y: -0.14, z: 0.72, rz: 0.05 });
      parts.push(st);
      parts.push(box(0.15, 0.16, 0.02, 0xe6e6e0, { x: 0.75, y: 0.05, z: 0.79 }));
      return { anchors, animated, height: 3.1 };
    }
    case 'well':
      parts.push(cylinder(0.3, 0.32, 0.36, 9, C.stone));
      parts.push(cylinder(0.24, 0.24, 0.06, 9, 0x2a4a5a, { y: 0.3 }));
      parts.push(box(0.04, 0.5, 0.04, C.darkWood, { x: -0.24, y: 0.36 }));
      parts.push(box(0.04, 0.5, 0.04, C.darkWood, { x: 0.24, y: 0.36 }));
      parts.push(prismRoof(0.62, 0.5, 0.2, C.plank, { y: 0.86, ry: Math.PI / 2 }));
      parts.push(cylinder(0.05, 0.045, 0.09, 7, C.wood, { y: 0.62 }));
      return { anchors, animated, height: 1.1 };
    case 'market': {
      const cols = [[C.red, C.white], [C.blue, C.white], [C.gold, C.white]];
      for (let s = 0; s < 3; s++) {
        const x = -0.7 + s * 0.7;
        for (const [dx, dz] of [[-0.26, -0.22], [0.26, -0.22], [-0.26, 0.22], [0.26, 0.22]]) {
          parts.push(box(0.035, 0.42, 0.035, C.darkWood, { x: x + dx, z: dz }));
        }
        parts.push(prismRoof(0.62, 0.56, 0.14, cols[s][0], { x, y: 0.42 }));
        parts.push(box(0.56, 0.05, 0.16, C.plank, { x, y: 0.24, z: 0.16 }));
        parts.push(sphere(0.05, [0xe04a3a, 0xf2c53d, 0x6fb84a][s], { x: x - 0.1, y: 0.32, z: 0.16 }));
        parts.push(sphere(0.05, [0x6fb84a, 0xe04a3a, 0xf2c53d][s], { x: x + 0.06, y: 0.32, z: 0.14 }));
      }
      return { anchors, animated, height: 0.6 };
    }
    case 'clocktower':
      parts.push(box(0.56, 2.3, 0.56, C.stone));
      parts.push(box(0.6, 0.1, 0.6, 0x8f8a80, { y: 1.5 }));
      parts.push(cylinder(0.17, 0.17, 0.04, 14, C.white, { y: 1.85, z: 0.29, rx: Math.PI / 2 }));
      parts.push(pyramidRoof(0.68, 0.68, 0.44, C.copper, { y: 2.3 }));
      parts.push(sphere(0.06, C.gold, { y: 2.78 }));
      for (let i = 0; i < 3; i++) parts.push(box(0.1, 0.16, 0.03, C.glass, { y: 0.5 + i * 0.45, z: 0.29, emissive: 1 }));
      animated.clock = { at: [0, 1.85, 0.32] };
      return { anchors, animated, height: 2.9 };
    case 'windmill':
      parts.push(cylinder(0.34, 0.48, 1.5, 9, 0xd9b98c));
      parts.push(box(0.22, 0.36, 0.05, C.darkWood, { y: 0, z: 0.44 }));
      parts.push(cylinder(0.4, 0.4, 0.05, 9, C.plank, { y: 1.12 }));
      parts.push(dome(0.38, 0x5a3c28, { y: 1.5 }));
      animated.blades = { at: [0, 1.62, 0.42], r: 0.6 };
      return { anchors, animated, height: 2.1 };
    case 'lighthouse': {
      const bands = 4;
      for (let i = 0; i < bands; i++) {
        parts.push(cylinder(0.24 - i * 0.02, 0.3 - i * 0.02, 0.55, 11, i % 2 ? C.white : C.red, { y: i * 0.55 }));
      }
      const top = bands * 0.55;
      parts.push(cylinder(0.3, 0.3, 0.06, 12, C.iron, { y: top }));
      parts.push(cylinder(0.19, 0.19, 0.3, 8, 0xfff2b0, { y: top + 0.06, emissive: 1 }));
      parts.push(cone(0.26, 0.28, 8, C.red, { y: top + 0.36 }));
      animated.beacon = { at: [0, top + 0.2, 0] };
      return { anchors, animated, height: top + 0.7 };
    }
    case 'castle': {
      parts.push(box(1.3, 1.5, 1.3, C.stone));
      for (const [x, z] of [[-0.72, -0.72], [0.72, -0.72], [-0.72, 0.72], [0.72, 0.72]]) {
        parts.push(cylinder(0.22, 0.25, 2.1, 8, C.stone, { x, z }));
        parts.push(cone(0.3, 0.4, 8, C.slate, { x, y: 2.1, z }));
      }
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        parts.push(box(0.14, 0.14, 0.14, C.stone, { x: Math.cos(a) * 0.62, y: 1.5, z: Math.sin(a) * 0.62 }));
      }
      parts.push(box(0.4, 0.6, 0.1, 0x3a2a20, { z: 0.66 }));
      anchors.flag = [0.72, 2.75, -0.72];
      parts.push(box(0.025, 0.5, 0.025, C.darkWood, { x: 0.72, y: 2.5, z: -0.72 }));
      return { anchors, animated, height: 2.9 };
    }
    case 'board': {
      // The sprint board: a cork panel under a little roof, with cards pinned to it.
      const W = 1.7, H = 1.0;
      parts.push(cylinder(0.06, 0.07, 1.05, 6, C.darkWood, { x: -W / 2 + 0.08, z: 0 }));
      parts.push(cylinder(0.06, 0.07, 1.05, 6, C.darkWood, { x: W / 2 - 0.08, z: 0 }));
      parts.push(box(W, H, 0.06, 0x8a6a44, { y: 0.62, z: 0.02 }));                 // cork
      parts.push(box(W + 0.1, 0.07, 0.1, C.darkWood, { y: 0.58, z: 0.02 }));       // frame
      parts.push(box(W + 0.1, 0.07, 0.1, C.darkWood, { y: 1.62, z: 0.02 }));
      parts.push(box(0.07, H + 0.14, 0.1, C.darkWood, { x: -W / 2 - 0.02, y: 0.58, z: 0.02 }));
      parts.push(box(0.07, H + 0.14, 0.1, C.darkWood, { x: W / 2 + 0.02, y: 0.58, z: 0.02 }));
      parts.push(prismRoof(W + 0.34, 0.44, 0.22, C.plank, { y: 1.69, z: 0.02 }));
      parts.push(box(0.62, 0.16, 0.03, C.paper, { y: 1.72, z: 0.2 }));             // "sprint" sign
      // one pinned card per open issue, up to twelve, in three rows
      const cards = Math.max(1, Math.min(12, spec.cards == null ? 6 : spec.cards));
      const pinCols = [0xd94f3d, 0x3d7ed9, 0xd9a33d, 0x6fb84a, 0x9a6fd9];
      for (let i = 0; i < cards; i++) {
        const col = i % 4, row = Math.floor(i / 4);
        const x = -0.6 + col * 0.4, y = 1.34 - row * 0.31;
        const tilt = ((i * 37) % 13 - 6) * 0.012;
        parts.push(box(0.3, 0.23, 0.012, C.paper, { x, y, z: 0.06, rz: tilt }));
        parts.push(box(0.19, 0.018, 0.014, 0xb9b2a4, { x: x - 0.03, y: y + 0.06, z: 0.068, rz: tilt }));
        parts.push(box(0.13, 0.018, 0.014, 0xb9b2a4, { x: x - 0.06, y: y + 0.02, z: 0.068, rz: tilt }));
        parts.push(sphere(0.024, pinCols[i % pinCols.length], { x, y: y + 0.1, z: 0.078 }));
      }
      return { anchors, animated, height: 2.1 };
    }
    case 'office': {
      // A clerk's office: brick, a tiled roof, a lamp by the door and a board with the
      // branch chalked on it. Small, because it is a village.
      parts.push(box(0.62, 0.44, 0.5, C.brick, { y: 0 }));
      parts.push(box(0.64, 0.06, 0.52, C.stone, { y: 0.44 }));
      parts.push(prismRoof(0.72, 0.6, 0.26, C.slate, { y: 0.5 }));
      parts.push(box(0.09, 0.2, 0.03, C.darkWood, { z: 0.26 }));                       // door
      parts.push(box(0.12, 0.13, 0.03, C.glass, { x: -0.17, y: 0.2, z: 0.26, emissive: 1 }));
      parts.push(box(0.12, 0.13, 0.03, C.glass, { x: 0.17, y: 0.2, z: 0.26, emissive: 1 }));
      parts.push(cylinder(0.02, 0.02, 0.16, 4, C.iron, { x: 0.24, y: 0.3, z: 0.28 }));  // lamp bracket
      parts.push(sphere(0.045, C.glass, { x: 0.24, y: 0.44, z: 0.28, emissive: 1 }));
      parts.push(box(0.3, 0.16, 0.02, 0x2f3a33, { x: -0.02, y: 0.24, z: 0.28 }));       // the chalk board
      parts.push(box(0.2, 0.02, 0.014, C.white, { x: -0.05, y: 0.32, z: 0.292 }));
      parts.push(box(0.12, 0.02, 0.014, C.white, { x: -0.09, y: 0.28, z: 0.292 }));
      parts.push(box(0.07, 0.24, 0.07, C.brick, { x: 0.2, y: 0.5, z: -0.12 }));         // chimney
      anchors.smoke = [0.2, 0.78, -0.12];
      return { anchors, animated, height: 0.82 };
    }
    case 'poldermill':
      parts.push(cylinder(0.3, 0.42, 1.2, 8, 0xd9b98c));
      parts.push(dome(0.34, 0x5a3c28, { y: 1.2 }));
      animated.blades = { at: [0, 1.3, 0.38], r: 0.5 };
      return { anchors, animated, height: 1.8 };
    default:
      parts.push(box(0.5, 0.4, 0.5, C.stone));
      return { anchors, animated, height: 0.5 };
  }
  void rng;
}

// ---------------------------------------------------------------- entry point
export function buildBuilding(spec, ctx = {}) {
  const pal = PALETTE[spec.style] || PALETTE.unknown;
  const rng = makeRng(hash32(spec.id));
  const parts = [];
  let anchors = {}, animated = {}, height = 1, w = 0.9;

  if (spec.kind === 'civic') {
    const r = civic(parts, spec, rng);
    anchors = r.anchors; animated = r.animated; height = r.height; w = 1.4;
  } else if (spec.kind === 'shed') {
    const r = shed(parts, spec, pal);
    anchors = r.anchors; height = r.height; w = 0.55;
  } else if (spec.harbour) {
    // a house on stilts over the shoreline
    const deck = 0.62;
    for (const [x, z] of [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]]) {
      parts.push(cylinder(0.05, 0.055, deck + 0.7, 6, C.darkWood, { x, y: -0.7, z }));
    }
    parts.push(box(1.0, 0.08, 1.0, C.plank, { y: deck - 0.08 }));
    const inner = [];
    const r = houseBody(inner, { ...spec, tier: spec.tier === 'tent' ? 'hut' : spec.tier }, pal, rng);
    for (const g of inner) { g.translate(0, deck, 0); parts.push(g); }
    parts.push(cylinder(0.05, 0.05, 0.36, 6, C.darkWood, { x: 0.44, y: deck, z: 0.44 }));
    parts.push(box(0.1, 0.12, 0.1, 0xffb347, { x: 0.44, y: deck + 0.36, z: 0.44, emissive: 1 }));
    anchors = r.anchors; height = deck + r.height; w = r.w;
    for (const [k, v] of Object.entries(anchors)) anchors[k] = [v[0], v[1] + deck, v[2]];
    for (const o of spec.ornaments || []) ornament(parts, o, pal, { w, height, tier: TIER_INDEX[spec.tier] ?? 1 }, anchors);
  } else {
    const r = houseBody(parts, spec, pal, rng);
    anchors = r.anchors; height = r.height; w = r.w;
    for (const o of spec.ornaments || []) ornament(parts, o, pal, { w, height, tier: TIER_INDEX[spec.tier] ?? 1 }, anchors);
  }

  const geometry = merge(parts);
  if (spec.civicType === 'board') {
    const s = 0.6;                       // built large for legibility, stands village sized
    geometry.scale(s, s, s);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    height *= s;
    for (const k of Object.keys(anchors)) anchors[k] = anchors[k].map((v) => v * s);
  }
  // a touch of variety so a street of identical sessions still looks hand-made
  if (spec.kind !== 'civic') {
    const s = 0.96 + rng.next() * 0.08;
    geometry.scale(s, s, s);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
  return { geometry, anchors, animated, height, width: w, bbox: geometry.boundingBox.clone() };
}

// ---------------------------------------------------------------- extras
export function buildScaffoldGeometry() {
  const parts = [];
  const h = 1;
  for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
    parts.push(box(0.045, h, 0.045, C.plank, { x, z }));
  }
  for (const y of [h * 0.34, h * 0.72]) {
    parts.push(box(1.045, 0.035, 0.035, C.plank, { y, z: -0.5 }));
    parts.push(box(1.045, 0.035, 0.035, C.plank, { y, z: 0.5 }));
    parts.push(box(0.035, 0.035, 1.045, C.plank, { y, x: -0.5 }));
    parts.push(box(0.035, 0.035, 1.045, C.plank, { y, x: 0.5 }));
  }
  const d1 = box(0.03, 1.2, 0.03, C.plank, { x: 0, z: -0.5, rz: 0.7 });
  const d2 = box(0.03, 1.2, 0.03, C.plank, { x: 0, z: 0.5, rz: -0.7 });
  parts.push(d1, d2);
  parts.push(box(0.9, 0.03, 0.34, C.plank, { y: h * 0.56, z: 0.2 }));
  return merge(parts);
}

export function buildBoatGeometry() {
  const parts = [];
  const hull = new THREE.CylinderGeometry(0.19, 0.12, 0.8, 5);
  hull.rotateZ(Math.PI / 2);
  hull.rotateY(Math.PI / 2);
  parts.push(finish(hull, C.wood));
  parts.push(box(0.72, 0.035, 0.03, C.stripe, { y: 0.09, z: 0.15 }));
  parts.push(box(0.72, 0.035, 0.03, C.stripe, { y: 0.09, z: -0.15 }));
  parts.push(box(0.022, 0.62, 0.022, C.darkWood, { y: 0.08 }));
  parts.push(quad([[0.01, 0.16, 0], [0.01, 0.66, 0], [0.34, 0.24, 0]], C.paper, {}));
  return merge(parts);
}

export function buildCampfireGeometry() {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    parts.push(sphere(0.045, 0x7f7a72, { x: Math.cos(a) * 0.17, y: 0.02, z: Math.sin(a) * 0.17 }));
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const log = box(0.05, 0.26, 0.05, C.darkWood, { x: Math.cos(a) * 0.06, z: Math.sin(a) * 0.06, rz: 0.5, ry: a });
    parts.push(log);
  }
  return merge(parts);
}
export function buildFlameGeometry() {
  return merge([
    cone(0.085, 0.26, 5, 0xff8c3a, { y: 0.03, emissive: 1 }),
    cone(0.05, 0.16, 5, 0xffd23a, { y: 0.07, emissive: 1 }),
  ]);
}

export function buildBladesGeometry() {
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const arm = box(0.07, 1.05, 0.02, 0xd9c7a3, { y: 0.52 });
    arm.rotateZ(a);
    parts.push(arm);
    const spar = box(0.02, 1.05, 0.03, C.darkWood, { y: 0.52 });
    spar.rotateZ(a);
    parts.push(spar);
  }
  parts.push(cylinder(0.06, 0.06, 0.1, 8, C.darkWood, { rx: Math.PI / 2, y: 0 }));
  return merge(parts);
}

export function buildPierGeometry(cells, terrain, from) {
  const parts = [];
  for (const [gx, gz] of cells) {
    const [x, z] = terrain.cellWorld(gx, gz);
    parts.push(box(0.62, 0.07, 0.62, C.plank, { x: x - from[0], y: 0.16, z: z - from[1] }));
    parts.push(cylinder(0.04, 0.04, 0.7, 5, C.darkWood, { x: x - from[0] - 0.24, y: -0.55, z: z - from[1] - 0.24 }));
    parts.push(cylinder(0.04, 0.04, 0.7, 5, C.darkWood, { x: x - from[0] + 0.24, y: -0.55, z: z - from[1] + 0.24 }));
  }
  return parts.length ? merge(parts) : null;
}

export function buildPlaqueGeometry(hue) {
  const col = new THREE.Color().setHSL(hue / 360, 0.55, 0.55).getHex();
  return merge([
    box(0.05, 0.42, 0.05, C.darkWood, { x: -0.2 }),
    box(0.05, 0.42, 0.05, C.darkWood, { x: 0.2 }),
    box(0.52, 0.26, 0.035, 0xe6dcc2, { y: 0.26 }),
    box(0.52, 0.055, 0.045, col, { y: 0.24 }),
  ]);
}

// A flag cloth, waved in the vertex shader; one instanced mesh serves every flag.
export function createFlagMesh(count) {
  const geo = new THREE.PlaneGeometry(0.3, 0.19, 5, 2);
  geo.translate(0.15, 0, 0);
  const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, flatShading: true, roughness: 0.9 });
  mat.userData.uniforms = { uTime: { value: 0 } };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = mat.userData.uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.z += sin(uTime * 6.0 + transformed.x * 9.0) * transformed.x * 0.6;');
  };
  mat.customProgramCacheKey = () => 'settlers-flag';
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  mesh.count = 0;
  return mesh;
}
