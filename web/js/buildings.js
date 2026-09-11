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

export const C = {
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

// ---------------------------------------------------------------- provenance
// A merged mesh can no longer say that one of its faces used to be
// `box(0.16, 0.26, 0.05, pal.accent, { z: 0.51 })`, and that is precisely what the model
// editor needs in order to show you a door, let you nudge it, and hand back the line to
// paste. So every primitive notes its own call on the geometry it returns. It costs one
// small object per part, nothing on the island reads it, and the merge drops it again.
let groupSeq = 0;
let openGroup = null;

// Some primitives only mean anything together: one box is a window, six are a bench.
// Wrapping them marks every part inside as a single pickable thing, so the editor moves
// the window and not the pane it happens to be made of.
export function group(kind, fn, args = null) {
  const outer = openGroup;
  openGroup = { kind, id: ++groupSeq, args };
  try { return fn(); } finally { openGroup = outer; }
}
function note(g, fn, args, hex, o) {
  // `o` is copied: the editor writes to it, and the call sites hand in literals they
  // reuse across a loop.
  g.userData.part = { fn, args, hex, o: { ...o }, group: openGroup };
  return g;
}
// Moves a finished part and keeps its note honest, for the one or two places that build
// a piece around the origin and hoist it afterwards.
function lift(g, dy) {
  g.translate(0, dy, 0);
  const p = g.userData.part;
  if (p) p.o = { ...p.o, y: (p.o.y || 0) + dy };
  return g;
}

// a box whose base sits at y = o.y
// Water and soil are modelled flush with the rim that holds them, which puts two faces
// on exactly the same plane and leaves the depth buffer to guess - the hatched surfaces
// on the well, the fountain and the flower beds. Lifting the inner surface by a hair
// settles it: far below anything the eye can see at this scale, far above the precision
// the depth buffer has to work with. Filled to the brim rather than a hair short of it,
// which is also the way a fountain should look.
const BRIM = 0.004;

export function box(w, h, d, hex, o = {}) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  return note(place(finish(g, hex, o.emissive || 0), o), 'box', [w, h, d], hex, o);
}
export function cylinder(rt, rb, h, seg, hex, o = {}) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  g.translate(0, h / 2, 0);
  return note(place(finish(g, hex, o.emissive || 0), o), 'cylinder', [rt, rb, h, seg], hex, o);
}
export function cone(r, h, seg, hex, o = {}) {
  const g = new THREE.ConeGeometry(r, h, seg);
  g.translate(0, h / 2, 0);
  return note(place(finish(g, hex, o.emissive || 0), o), 'cone', [r, h, seg], hex, o);
}
export function dome(r, hex, o = {}) {
  const g = new THREE.SphereGeometry(r, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  return note(place(finish(g, hex, o.emissive || 0), o), 'dome', [r], hex, o);
}
export function sphere(r, hex, o = {}) {
  const g = new THREE.SphereGeometry(r, 7, 5);
  return note(place(finish(g, hex, o.emissive || 0), o), 'sphere', [r], hex, o);
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
  return note(place(finish(g, hex, 0), o), 'prismRoof', [w, d, h], hex, o);
}
export function pyramidRoof(w, d, h, hex, o = {}) {
  const g = new THREE.ConeGeometry(0.7071, h, 4);
  g.rotateY(Math.PI / 4);
  g.scale(w, 1, d);
  g.translate(0, h / 2, 0);
  return note(place(finish(g, hex, 0), o), 'pyramidRoof', [w, d, h], hex, o);
}
// A flat triangle or quad, given 3 or 4 points. Used for sails, fins and pennants.
export function quad(pts, hex, o = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
  g.setIndex(pts.length === 3 ? [0, 1, 2, 0, 2, 1] : [0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]);
  return note(place(finish(g, hex, o.emissive || 0), o), 'quad', [pts], hex, o);
}

function merge(parts) {
  const g = mergeGeometries(parts.filter(Boolean), false);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------- the kit
// Places one piece inside a sub-assembly: its offset turns with the assembly, and so
// does the piece, which is what lets a bench stand against a wall at an angle without
// every number in it being rewritten by hand.
function inside(a, o = {}) {
  const c = Math.cos(a.ry || 0), s = Math.sin(a.ry || 0);
  const x = o.x || 0, z = o.z || 0;
  return {
    ...o,
    x: (a.x || 0) + x * c + z * s,
    y: (a.y || 0) + (o.y || 0),
    z: (a.z || 0) - x * s + z * c,
    ry: (o.ry || 0) + (a.ry || 0),
  };
}

// The pieces that keep coming back, each as one named thing rather than the boxes it
// happens to be: a window, a door, a bench. The builders below reach for them, and the
// model editor offers the same list when you want one more - which is the whole point
// of giving them names. `defaults` is what the editor puts in its number fields; every
// piece also takes the placement `{ x, y, z, ry }` that `inside` spreads over its parts.
export const KIT = {
  window: {
    label: 'Window',
    defaults: { w: 0.13, h: 0.17, d: 0.04, hex: C.glass },
    build: (parts, a) => group('window', () => {
      parts.push(box(a.w, a.h, a.d, a.hex, inside(a, { emissive: 1 })));
    }, a),
  },
  door: {
    label: 'Door',
    defaults: { w: 0.16, h: 0.26, d: 0.05, hex: C.darkWood },
    build: (parts, a) => group('door', () => {
      parts.push(box(a.w, a.h, a.d, a.hex, inside(a, {})));
    }, a),
  },
  bench: {
    label: 'Bench',
    defaults: { w: 0.46, hex: C.plank },
    build: (parts, a) => group('bench', () => {
      const lx = a.w / 2 - 0.05;
      for (const x of [-lx, lx]) {
        parts.push(box(0.04, 0.2, 0.04, C.iron, inside(a, { x, z: -0.05 })));
        parts.push(box(0.04, 0.2, 0.04, C.iron, inside(a, { x, z: 0.05 })));
      }
      parts.push(box(a.w, 0.035, 0.16, a.hex, inside(a, { y: 0.2 })));
      parts.push(box(a.w, 0.17, 0.03, a.hex, inside(a, { y: 0.22, z: -0.07, rx: -0.16 })));
    }, a),
  },
  table: {
    label: 'Table',
    defaults: { r: 0.13, h: 0.2, hex: C.plank },
    build: (parts, a) => group('table', () => {
      parts.push(cylinder(0.035, 0.045, a.h, 6, C.darkWood, inside(a, {})));
      parts.push(cylinder(a.r, a.r, 0.025, 8, a.hex, inside(a, { y: a.h })));
    }, a),
  },
  chair: {
    label: 'Chair',
    defaults: { w: 0.09, h: 0.12, hex: C.plank },
    build: (parts, a) => group('chair', () => {
      for (const [lx, lz] of [[-0.032, -0.032], [0.032, -0.032], [-0.032, 0.032], [0.032, 0.032]]) {
        parts.push(box(0.014, a.h, 0.014, C.darkWood, inside(a, { x: lx, z: lz })));
      }
      parts.push(box(a.w, 0.022, a.w, a.hex, inside(a, { y: a.h })));
      parts.push(box(a.w, 0.12, 0.018, C.darkWood, inside(a, { y: a.h + 0.022, z: -0.036 })));
    }, a),
  },
};

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
    KIT.window.build(parts, { ...KIT.window.defaults, hex: pal.glow, x: s.x, y: y0, z: s.z, ry: s.ry });
  }
  void h; void ry;
}
function door(parts, pal, w) {
  KIT.door.build(parts, { ...KIT.door.defaults, hex: pal.accent, z: w / 2 + 0.01 });
}
function foundation(parts, w, d) {
  group('foundation', () => parts.push(box(w + 0.12, 0.34, d + 0.12, C.foundation, { y: -0.3 })));
}

function timberFrame(parts, w, h, d, hex) {
  const t = 0.035;
  group('frame', () => {
    for (const [x, z, ry] of [[0, d / 2, 0], [0, -d / 2, 0], [w / 2, 0, Math.PI / 2], [-w / 2, 0, Math.PI / 2]]) {
      parts.push(box(t, h, t, hex, { x: x + (ry ? 0 : -w * 0.3), y: 0, z, ry }));
      parts.push(box(t, h, t, hex, { x: x + (ry ? 0 : w * 0.3), y: 0, z, ry }));
      parts.push(box(w * 0.9, t, t, hex, { x, y: h - t, z, ry }));
    }
  });
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
    parts.push(cylinder(0.028, 0.04, 0.3, 6, C.copper, { rz: -0.6, x: tx + 0.2, y: th + 0.12, z: tz + 0.06 }));
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
    parts.push(cylinder(0.028, 0.042, 0.28, 6, C.copper, { rz: -0.55, x: 0.3, y: 0.34, z: 0.02 }));
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
// Two boards stand on the square and they are the same piece of furniture in different
// paint: posts, a panel, a frame, a little roof and one pinned note per open card. The
// sprint board is cork under a plank roof; the island's own board is slate in an iron
// frame under copper, so which is which reads from across the green.
function noticeBoard(parts, spec, { panel, frame, roof, sign, note, pins }) {
  const W = 1.7, H = 1.0;
  parts.push(cylinder(0.06, 0.07, 1.05, 6, frame, { x: -W / 2 + 0.08, z: 0 }));
  parts.push(cylinder(0.06, 0.07, 1.05, 6, frame, { x: W / 2 - 0.08, z: 0 }));
  parts.push(box(W, H, 0.06, panel, { y: 0.62, z: 0.02 }));                     // the panel
  parts.push(box(W + 0.1, 0.07, 0.1, frame, { y: 0.58, z: 0.02 }));             // its frame
  parts.push(box(W + 0.1, 0.07, 0.1, frame, { y: 1.62, z: 0.02 }));
  parts.push(box(0.07, H + 0.14, 0.1, frame, { x: -W / 2 - 0.02, y: 0.58, z: 0.02 }));
  parts.push(box(0.07, H + 0.14, 0.1, frame, { x: W / 2 + 0.02, y: 0.58, z: 0.02 }));
  parts.push(prismRoof(W + 0.34, 0.44, 0.22, roof, { y: 1.69, z: 0.02 }));
  parts.push(box(0.62, 0.16, 0.03, sign, { y: 1.72, z: 0.2 }));                 // the sign
  // one pinned card per open issue, up to twelve, in three rows
  const cards = Math.max(1, Math.min(12, spec.cards == null ? 6 : spec.cards));
  for (let i = 0; i < cards; i++) {
    const col = i % 4, row = Math.floor(i / 4);
    const x = -0.6 + col * 0.4, y = 1.34 - row * 0.31;
    const tilt = ((i * 37) % 13 - 6) * 0.012;
    parts.push(box(0.3, 0.23, 0.012, note, { x, y, z: 0.06, rz: tilt }));
    parts.push(box(0.19, 0.018, 0.014, 0xb9b2a4, { x: x - 0.03, y: y + 0.06, z: 0.068, rz: tilt }));
    parts.push(box(0.13, 0.018, 0.014, 0xb9b2a4, { x: x - 0.06, y: y + 0.02, z: 0.068, rz: tilt }));
    parts.push(sphere(0.024, pins[i % pins.length], { x, y: y + 0.1, z: 0.078 }));
  }
  return 2.1;
}

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
      parts.push(cylinder(0.24, 0.24, 0.06, 9, 0x2a4a5a, { y: 0.3 + BRIM }));
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
    case 'statue': {
      // A founder on a plinth, one arm out over the square. Bronze, so it reads warm
      // against all the grey stone around it.
      let y = 0;
      parts.push(box(0.52, 0.09, 0.52, C.foundation, { y })); y += 0.09;
      parts.push(box(0.42, 0.10, 0.42, C.stone, { y })); y += 0.10;
      parts.push(box(0.32, 0.46, 0.32, C.stone, { y }));
      parts.push(box(0.18, 0.12, 0.02, 0xcfc4a8, { y: y + 0.16, z: 0.161 }));   // the plaque
      y += 0.46;
      parts.push(box(0.38, 0.06, 0.38, C.stone, { y })); y += 0.06;
      const bronze = 0x9c7a3c;
      parts.push(box(0.05, 0.16, 0.05, bronze, { x: -0.045, y }));
      parts.push(box(0.05, 0.16, 0.05, bronze, { x: 0.045, y }));
      const hip = y + 0.14;
      parts.push(box(0.15, 0.26, 0.11, bronze, { y: hip }));
      parts.push(box(0.19, 0.08, 0.13, bronze, { y: hip + 0.2 }));
      parts.push(box(0.045, 0.22, 0.045, bronze, { x: -0.11, y: hip + 0.06, rz: 0.55 }));
      parts.push(box(0.045, 0.2, 0.045, bronze, { x: 0.1, y: hip + 0.05, rz: -0.15 }));
      parts.push(sphere(0.072, bronze, { y: hip + 0.35 }));
      parts.push(cylinder(0.016, 0.02, 0.34, 5, bronze, { x: 0.13, y: hip - 0.02 }));
      return { anchors, animated, height: hip + 0.45 };
    }
    case 'lamp': {
      // The glass is emissive, so the square lights itself once the sun is down.
      let y = 0;
      parts.push(cylinder(0.11, 0.14, 0.07, 8, C.stone, { y })); y += 0.07;
      parts.push(cylinder(0.032, 0.045, 0.78, 6, C.iron, { y })); y += 0.78;
      parts.push(box(0.16, 0.02, 0.02, C.iron, { y: y - 0.14 }));
      parts.push(box(0.02, 0.02, 0.16, C.iron, { y: y - 0.14 }));
      parts.push(cylinder(0.085, 0.06, 0.03, 4, C.iron, { y, ry: Math.PI / 4 })); y += 0.03;
      parts.push(box(0.1, 0.14, 0.1, C.glass, { y, emissive: 1 })); y += 0.14;
      parts.push(cone(0.095, 0.1, 4, C.iron, { y, ry: Math.PI / 4 })); y += 0.1;
      parts.push(sphere(0.026, C.iron, { y: y + 0.02 }));
      return { anchors, animated, height: y + 0.05 };
    }
    case 'planter': {
      // A stone trough with something flowering in it. The colour is drawn per plant so
      // a row of them is not four copies of the same red.
      const beds = [0xd94f3d, 0xe8a13a, 0xd96fa8, 0xf2e04a, 0x9a6fd9];
      parts.push(box(0.42, 0.18, 0.28, C.stone));
      parts.push(box(0.34, 0.04, 0.2, 0x53402e, { y: 0.14 + BRIM }));
      for (let i = 0; i < 5; i++) {
        const x = -0.13 + i * 0.065, z = rng.range(-0.05, 0.05);
        const h = 0.07 + rng.range(0, 0.05);
        parts.push(cylinder(0.012, 0.014, h, 4, C.green, { x, y: 0.18, z }));
        parts.push(sphere(0.034, beds[rng.int(beds.length)], { x, y: 0.18 + h + 0.02, z }));
      }
      return { anchors, animated, height: 0.36 };
    }
    case 'bench':
      KIT.bench.build(parts, { ...KIT.bench.defaults });
      return { anchors, animated, height: 0.42 };
    case 'terrace': {
      // Two little tables with a chair either side, and one parasol between them. Three
      // things were wrong before. The pole stood on the first table's own centre, so it
      // was coaxial with that table's pedestal and came up through the top. The chairs
      // sat left and right of each table, which put the right-hand chair of one table
      // 0.06 from the left-hand chair of the other - close enough that the seats
      // intersected. And the two backs faced opposite ways.
      //
      // So the chairs now sit in front of and behind their own table, where the
      // neighbouring one cannot reach them, and the parasol stands on its own spot
      // between the two and shades both.
      for (const [tx, tz] of [[-0.24, -0.02], [0.26, 0.06]]) {
        parts.push(cylinder(0.035, 0.045, 0.2, 6, C.darkWood, { x: tx, z: tz }));
        parts.push(cylinder(0.13, 0.13, 0.025, 8, C.plank, { x: tx, y: 0.2, z: tz }));
        for (const cz of [-0.23, 0.23]) {
          for (const [lx, lz] of [[-0.032, -0.032], [0.032, -0.032], [-0.032, 0.032], [0.032, 0.032]]) {
            parts.push(box(0.014, 0.12, 0.014, C.darkWood, { x: tx + lx, z: tz + cz + lz }));
          }
          parts.push(box(0.09, 0.022, 0.09, C.plank, { x: tx, y: 0.12, z: tz + cz }));
          // the back on the outer side, so both chairs face their table
          parts.push(box(0.09, 0.12, 0.018, C.darkWood, { x: tx, y: 0.142, z: tz + cz + (cz < 0 ? -0.036 : 0.036) }));
        }
      }
      parts.push(cylinder(0.02, 0.022, 0.62, 6, C.darkWood, { x: 0.01, z: 0.02 }));
      parts.push(cone(0.32, 0.18, 8, C.red, { x: 0.01, y: 0.62, z: 0.02 }));
      parts.push(sphere(0.03, C.gold, { x: 0.01, y: 0.84, z: 0.02 }));
      return { anchors, animated, height: 0.88 };
    }
    case 'fountain': {
      // An eight sided basin with a tiered column standing in it. The water sits just
      // below the rim so it catches the light instead of hiding in the shadow.
      parts.push(cylinder(0.5, 0.54, 0.1, 8, C.foundation));                  // 0.00 - 0.10
      parts.push(cylinder(0.44, 0.46, 0.28, 8, C.stone, { y: 0.1 }));         // 0.10 - 0.38
      parts.push(cylinder(0.38, 0.38, 0.16, 8, 0x2f6f8f, { y: 0.14 + BRIM })); // the water
      parts.push(cylinder(0.48, 0.48, 0.05, 8, C.stone, { y: 0.36 }));        // the rim
      parts.push(box(0.26, 0.14, 0.26, C.stone, { y: 0.3 }));                 // 0.30 - 0.44
      parts.push(cylinder(0.09, 0.13, 0.4, 8, C.stone, { y: 0.44 }));         // 0.44 - 0.84
      parts.push(cylinder(0.26, 0.12, 0.1, 8, C.stone, { y: 0.8 }));          // the bowl
      parts.push(cylinder(0.22, 0.22, 0.03, 8, 0x2f6f8f, { y: 0.87 + BRIM }));
      parts.push(cylinder(0.05, 0.08, 0.2, 8, C.stone, { y: 0.9 }));
      parts.push(sphere(0.07, C.copper, { y: 1.15 }));
      // four jets leaning out of the bowl and back down into the basin
      for (const [ax, az, rx, rz] of [[1, 0, 0, -0.95], [-1, 0, 0, 0.95], [0, 1, 0.95, 0], [0, -1, -0.95, 0]]) {
        parts.push(cylinder(0.014, 0.022, 0.3, 5, 0x8fc4dc, { x: ax * 0.11, y: 0.84, z: az * 0.11, rx, rz }));
      }
      return { anchors, animated, height: 1.25 };
    }
    case 'tavern': {
      // Timber frame, a deep tiled roof, and a sign on a bracket over the door. The
      // windows are the warmest on the island once the sun goes down.
      const f = 0.28;
      parts.push(box(1.3, f, 0.98, C.stone));
      parts.push(box(1.22, 0.62, 0.9, 0xe8dcc0, { y: f }));
      for (const x of [-0.56, -0.19, 0.19, 0.56]) parts.push(box(0.055, 0.62, 0.055, C.darkWood, { x, y: f, z: 0.44 }));
      parts.push(box(1.2, 0.055, 0.055, C.darkWood, { y: f + 0.29, z: 0.44 }));
      parts.push(prismRoof(1.42, 1.06, 0.5, C.brick, { y: f + 0.62 }));
      parts.push(box(0.34, 0.5, 0.04, C.darkWood, { y: f, z: -0.46 }));
      for (const x of [-0.42, 0.42]) parts.push(box(0.2, 0.26, 0.03, C.glass, { x, y: f + 0.2, z: 0.46, emissive: 1 }));
      // the hanging sign
      parts.push(box(0.04, 0.04, 0.36, C.iron, { x: 0.64, y: 0.94, z: -0.3 }));
      parts.push(box(0.02, 0.06, 0.02, C.iron, { x: 0.64, y: 0.88, z: -0.46 }));
      parts.push(box(0.03, 0.22, 0.28, 0x6b4a2f, { x: 0.64, y: 0.66, z: -0.46 }));
      parts.push(sphere(0.05, C.gold, { x: 0.625, y: 0.77, z: -0.46 }));
      // barrels and a bench outside the door
      for (const bz of [-0.34, -0.06]) {
        parts.push(cylinder(0.11, 0.12, 0.24, 8, C.wood, { x: -0.68, z: bz }));
        parts.push(cylinder(0.115, 0.115, 0.03, 8, C.iron, { x: -0.68, y: 0.14, z: bz }));
      }
      for (const x of [0.02, 0.34]) parts.push(box(0.05, 0.17, 0.12, C.darkWood, { x, z: -0.64 }));
      parts.push(box(0.44, 0.04, 0.16, C.plank, { x: 0.18, y: 0.17, z: -0.64 }));
      parts.push(cylinder(0.06, 0.06, 0.46, 6, C.stone, { x: -0.5, y: f + 0.62, z: 0.2 }));
      return { anchors, animated, height: 1.5 };
    }
    case 'chapel': {
      // A small stone chapel: a nave running front to back, a round window over the
      // door, an apse behind, and a tower carrying the bell.
      const f = 0.1;
      parts.push(box(0.86, 0.16, 1.24, C.foundation, { y: -0.06 }));
      parts.push(box(0.78, 0.76, 1.16, C.stone, { y: f }));
      parts.push(prismRoof(1.28, 0.9, 0.44, C.slate, { y: 0.86, ry: Math.PI / 2 }));
      parts.push(cylinder(0.36, 0.36, 0.76, 9, C.stone, { y: f, z: 0.66 }));
      parts.push(dome(0.37, C.slate, { y: 0.86, z: 0.66 }));
      parts.push(cylinder(0.14, 0.14, 0.05, 12, C.glass, { y: 0.66, z: -0.62, rx: Math.PI / 2, emissive: 1 }));
      parts.push(box(0.28, 0.46, 0.04, C.darkWood, { y: f, z: -0.6 }));
      for (const z of [-0.2, 0.2]) {
        for (const x of [-0.4, 0.4]) parts.push(box(0.03, 0.36, 0.13, C.glass, { x, y: f + 0.24, z, emissive: 1 }));
      }
      // the tower
      const th = 1.5;
      parts.push(box(0.44, th, 0.44, C.stone, { y: f, z: -0.74 }));
      parts.push(box(0.1, 0.24, 0.05, C.glass, { y: f + 1.0, z: -0.96, emissive: 1 }));
      parts.push(box(0.52, 0.07, 0.52, 0x8f8a80, { y: f + th, z: -0.74 }));
      parts.push(cone(0.36, 0.8, 4, C.slate, { y: f + th + 0.07, z: -0.74, ry: Math.PI / 4 }));
      parts.push(sphere(0.05, C.gold, { y: f + th + 0.92, z: -0.74 }));
      parts.push(box(0.02, 0.2, 0.02, C.gold, { y: f + th + 0.96, z: -0.74 }));
      parts.push(box(0.13, 0.02, 0.02, C.gold, { y: f + th + 1.09, z: -0.74 }));
      return { anchors, animated, height: f + th + 1.2 };
    }
    case 'tables': {
      // Two trestle tables and their benches, on the corner of the square.
      for (const [tx, tz] of [[-0.16, -0.14], [0.2, 0.2]]) {
        for (const dx of [-0.16, 0.16]) {
          parts.push(box(0.03, 0.2, 0.03, C.darkWood, { x: tx + dx, z: tz - 0.08 }));
          parts.push(box(0.03, 0.2, 0.03, C.darkWood, { x: tx + dx, z: tz + 0.08 }));
        }
        parts.push(box(0.42, 0.035, 0.24, C.plank, { x: tx, y: 0.2, z: tz }));
        for (const dz of [-0.17, 0.17]) {
          parts.push(box(0.4, 0.03, 0.08, C.plank, { x: tx, y: 0.11, z: tz + dz }));
          for (const dx of [-0.14, 0.14]) parts.push(box(0.025, 0.11, 0.025, C.darkWood, { x: tx + dx, z: tz + dz }));
        }
      }
      parts.push(cylinder(0.035, 0.045, 0.34, 6, C.darkWood, { x: 0.42, z: -0.36 }));
      parts.push(sphere(0.09, C.green, { x: 0.42, y: 0.41, z: -0.36 }));
      return { anchors, animated, height: 0.52 };
    }
    case 'school': {
      // A long low schoolhouse with a bell over the ridge: brick to the sill, plaster
      // above, and a row of tall windows that light up when the apprentices work late.
      const f = 0.1;
      parts.push(box(1.44, 0.16, 0.96, C.foundation, { y: -0.06 }));
      parts.push(box(1.36, 0.3, 0.88, C.brick, { y: f }));
      parts.push(box(1.3, 0.46, 0.84, 0xf0e2c8, { y: f + 0.3 }));
      const eaves = f + 0.76;
      parts.push(prismRoof(1.46, 0.98, 0.42, C.slate, { y: eaves }));
      for (let i = 0; i < 4; i++) {
        const x = -0.48 + i * 0.32;
        parts.push(box(0.16, 0.4, 0.03, C.glass, { x, y: f + 0.32, z: 0.43, emissive: 1 }));
        parts.push(box(0.19, 0.035, 0.04, C.white, { x, y: f + 0.28, z: 0.435 }));
      }
      // the porch over the door
      parts.push(box(0.42, 0.56, 0.04, C.darkWood, { y: f, z: -0.44 }));
      parts.push(box(0.5, 0.05, 0.3, C.plank, { y: f + 0.6, z: -0.58 }));
      for (const x of [-0.21, 0.21]) parts.push(box(0.04, 0.6, 0.04, C.darkWood, { x, y: f, z: -0.68 }));
      // the bell cote, standing on the ridge
      for (const dx of [-0.53, -0.37]) parts.push(box(0.035, 0.24, 0.035, C.white, { x: dx, y: eaves + 0.42 }));
      parts.push(box(0.24, 0.04, 0.14, C.white, { x: -0.45, y: eaves + 0.66 }));
      parts.push(pyramidRoof(0.3, 0.2, 0.16, C.copper, { x: -0.45, y: eaves + 0.7 }));
      parts.push(dome(0.062, C.gold, { x: -0.45, y: eaves + 0.64, rx: Math.PI }));
      // a slate leaning by the door, and the yard flag
      parts.push(box(0.26, 0.2, 0.025, 0x3a4038, { x: 0.62, y: f, z: -0.34, rz: -0.12 }));
      anchors.flag = [-0.66, f + 0.8, -0.3];
      parts.push(box(0.025, 0.7, 0.025, C.darkWood, { x: -0.66, y: f, z: -0.3 }));
      return { anchors, animated, height: eaves + 0.9 };
    }
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
      const height = noticeBoard(parts, spec, {
        panel: 0x8a6a44, frame: C.darkWood, roof: C.plank, sign: C.paper, note: C.paper,
        pins: [0xd94f3d, 0x3d7ed9, 0xd9a33d, 0x6fb84a, 0x9a6fd9],
      });
      return { anchors, animated, height };
    }
    case 'issues': {
      // The island's own board: the same furniture in slate and iron under a copper
      // roof, with a lamp over it, because the work on the island itself never stops.
      const height = noticeBoard(parts, spec, {
        panel: C.slate, frame: C.iron, roof: C.copper, sign: C.white, note: C.white,
        pins: [0xd9a33d, 0xb87333, 0xf5efe0, 0xd9a33d, 0x8a8a8a],
      });
      parts.push(cylinder(0.018, 0.018, 0.16, 4, C.iron, { y: 1.95, z: 0.22 }));
      parts.push(sphere(0.05, C.glass, { y: 1.99, z: 0.22, emissive: 1 }));
      return { anchors, animated, height };
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
// A session that ran a dozen or more apprentices builds upward instead of filling its
// yard with sheds. One window per room, lit while that apprentice was working, and the
// session itself takes the penthouse: set back from the parapet, with a terrace on the
// roof and a light that stays on.
function tower(parts, spec, pal, rng) {
  const h = spec.hotel || { rooms: 10, floors: 2, busy: 0 };
  const floors = Math.max(2, Math.min(14, h.floors | 0));
  const FLOOR = 0.42;
  const W = 1.06;

  parts.push(box(W + 0.16, 0.14, W + 0.16, C.foundation));
  parts.push(box(W + 0.06, 0.2, W + 0.06, C.stone, { y: 0.14 }));       // the plinth
  parts.push(box(0.3, 0.34, 0.04, C.darkWood, { y: 0.34, z: W / 2 + 0.04 }));

  // The rooms: four to a floor, one window each, and they light up after dark like
  // every other window on the island. A finished run is not a dark building; what says
  // a session is running is the scaffolding and the hammering, the same as anywhere.
  // The top floor is short if the last apprentices do not fill it, which is the only
  // thing the room count changes about the shape.
  let room = 0;
  for (let f = 0; f < floors; f++) {
    const y = 0.34 + f * FLOOR;
    parts.push(box(W, FLOOR - 0.04, W, pal.wall, { y }));
    parts.push(box(W + 0.04, 0.045, W + 0.04, pal.trim, { y: y + FLOOR - 0.045 }));
    for (const [dx, dz, ry] of [[0, W / 2, 0], [0, -W / 2, 0], [W / 2, 0, 1], [-W / 2, 0, 1]]) {
      if (room++ >= h.rooms) continue;
      const w = ry ? 0.03 : 0.26, d = ry ? 0.26 : 0.03;
      parts.push(box(w, 0.2, d, C.glass, { x: dx * 1.02, y: y + 0.09, z: dz * 1.02, emissive: 1 }));
    }
  }

  // the penthouse, and the parapet it stands behind
  const top = 0.34 + floors * FLOOR;
  parts.push(box(W + 0.1, 0.07, W + 0.1, pal.trim, { y: top }));
  for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    parts.push(box(dx ? 0.05 : W, 0.1, dz ? 0.05 : W, pal.trim, { x: dx * W / 2, y: top + 0.07, z: dz * W / 2 }));
  }
  const pw = W - 0.34;
  parts.push(box(pw, 0.34, pw, pal.wall, { y: top + 0.07 }));
  for (const [dx, dz, ry] of [[0, 1, 0], [1, 0, 1], [-1, 0, 1]]) {
    parts.push(box(ry ? 0.03 : pw - 0.12, 0.19, ry ? pw - 0.12 : 0.03, C.glass, { x: dx * pw / 2, y: top + 0.14, z: dz * pw / 2, emissive: 1 }));
  }
  parts.push(pyramidRoof(pw + 0.22, pw + 0.22, 0.24, pal.roof, { y: top + 0.41 }));
  parts.push(cylinder(0.02, 0.02, 0.34, 5, C.iron, { y: top + 0.65 }));
  parts.push(sphere(0.05, C.gold, { y: top + 1.02 }));
  // a chair and a table out on the roof terrace, because someone lives up here
  parts.push(cylinder(0.02, 0.026, 0.1, 6, C.darkWood, { x: 0.3, y: top + 0.07, z: 0.28 }));
  parts.push(cylinder(0.08, 0.08, 0.02, 8, C.plank, { x: 0.3, y: top + 0.17, z: 0.28 }));

  const anchors = { flag: [0, top + 0.72, 0], roof: [0, top + 0.41, 0] };
  void rng;
  return { anchors, height: top + 1.0, w: W };
}

// ---------------------------------------------------------------- footprints
// What actually stops you walking. This used to be a circle around the widest part of
// the whole bounding box, which turned a row of market stalls into a fat bollard and
// left half the town square impassable. Instead: take every part low enough to bump
// into, keep its rectangle, and glue rectangles together when the gap between them is
// too narrow to walk through anyway. Anything above head height -- a roof overhang, a
// bell tower, a parasol -- does not block at all, because you walk under it.
export const WALK_CLEARANCE = 0.55;   // a settler stands about this tall
export const WALK_BODY_R = 0.16;      // and is about this wide, with a little skin
const WALK_GAP = 0.36;                // a gap narrower than this is not a gap

function partRect(g, clearance) {
  const p = g.attributes.position;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, n = 0;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > clearance) continue;
    const x = p.getX(i), z = p.getZ(i);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
    n++;
  }
  return n ? { x0, x1, z0, z1 } : null;
}

// Greedy: a rectangle swallows every rectangle it already touches, and keeps swallowing
// until nothing is close enough, so the order the parts were built in does not matter.
function mergeRects(rects, gap) {
  const out = [];
  for (const r of rects) {
    let cur = r;
    for (let again = true; again;) {
      again = false;
      for (let i = 0; i < out.length; i++) {
        const o = out[i];
        if (cur.x0 - gap > o.x1 || o.x0 - gap > cur.x1) continue;
        if (cur.z0 - gap > o.z1 || o.z0 - gap > cur.z1) continue;
        cur = {
          x0: Math.min(cur.x0, o.x0), x1: Math.max(cur.x1, o.x1),
          z0: Math.min(cur.z0, o.z0), z1: Math.max(cur.z1, o.z1),
        };
        out.splice(i, 1);
        again = true;
        break;
      }
    }
    out.push(cur);
  }
  return out;
}

// The solid rectangles of a shape, in its own frame, as centre plus half extents.
export function footprintOf(parts, clearance = WALK_CLEARANCE) {
  const rects = [];
  for (const g of parts) {
    if (!g) continue;
    const r = partRect(g, clearance);
    if (r) rects.push(r);
  }
  return mergeRects(rects, WALK_GAP).map((r) => ({
    x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2,
    hx: (r.x1 - r.x0) / 2, hz: (r.z1 - r.z0) / 2,
  }));
}

function scaleSolids(solids, s) {
  return solids.map((r) => ({ x: r.x * s, z: r.z * s, hx: r.hx * s, hz: r.hz * s }));
}

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
    for (const g of inner) parts.push(lift(g, deck));
    parts.push(cylinder(0.05, 0.05, 0.36, 6, C.darkWood, { x: 0.44, y: deck, z: 0.44 }));
    parts.push(box(0.1, 0.12, 0.1, 0xffb347, { x: 0.44, y: deck + 0.36, z: 0.44, emissive: 1 }));
    anchors = r.anchors; height = deck + r.height; w = r.w;
    for (const [k, v] of Object.entries(anchors)) anchors[k] = [v[0], v[1] + deck, v[2]];
    for (const o of spec.ornaments || []) ornament(parts, o, pal, { w, height, tier: TIER_INDEX[spec.tier] ?? 1 }, anchors);
  } else if (spec.hotel) {
    const r = tower(parts, spec, pal, rng);
    anchors = r.anchors; height = r.height; w = r.w;
    for (const o of spec.ornaments || []) ornament(parts, o, pal, { w, height, tier: TIER_INDEX[spec.tier] ?? 1 }, anchors);
  } else {
    const r = houseBody(parts, spec, pal, rng);
    anchors = r.anchors; height = r.height; w = r.w;
    for (const o of spec.ornaments || []) ornament(parts, o, pal, { w, height, tier: TIER_INDEX[spec.tier] ?? 1 }, anchors);
  }

  const geometry = merge(parts);
  // Both boards are built large for legibility and stand village sized; a house gets a
  // touch of variety so a street of identical sessions still looks hand-made.
  const boardish = spec.civicType === 'board' || spec.civicType === 'issues';
  const s = boardish ? 0.6
    : spec.kind !== 'civic' ? 0.96 + rng.next() * 0.08
      : 1;
  // The footprint is measured before the scale, so head height is measured there too.
  let solids = footprintOf(parts, WALK_CLEARANCE / s);
  if (s !== 1) {
    geometry.scale(s, s, s);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    solids = scaleSolids(solids, s);
  }
  if (boardish) {
    height *= s;
    for (const k of Object.keys(anchors)) anchors[k] = anchors[k].map((v) => v * s);
  }
  // The editor asks for the pieces rather than the loaf: one geometry per primitive,
  // still in the space the code was written in, each carrying the call that made it.
  // Behind a flag, because the island builds hundreds of these and would sooner see the
  // parts collected than held onto.
  return {
    geometry, anchors, animated, height, width: w,
    bbox: geometry.boundingBox.clone(), solids,
    ...(ctx.keepParts ? { parts, scale: s } : {}),
  };
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

// How high a rail stands over the deck, and how far a deck rides above the water when
// both its banks are at sea level. The settlers and the walk mode read the deck height
// so they cross a river rather than wade under it.
export const BRIDGE_RAIL = 0.3;
export const DECK_MIN = 0.26;

// Where a deck runs and how high it is along it. `cells` is the crossing the layout
// recorded, in order; the deck covers those cells and reaches a little way onto the bank
// at each end, so there is no seam where the road meets the planks. The height comes from
// the two banks alone - the ground between them is the riverbed - and ramps between them,
// which is what makes a deck meet the ground at both ends instead of standing proud of
// the lower one.
const DECK_LIP = 0.6;             // how far onto the bank each end reaches
function bridgeStops(cells, terrain, axis) {
  const n = cells.length;
  const k = axis === 'x' ? 0 : 1;                    // the coordinate the run moves along
  const dir = n > 1 ? Math.sign(cells[n - 1][k] - cells[0][k]) : 1;
  const abut = (end, sign) => { const c = [...end]; c[k] += sign * dir; return c; };
  const at = (c) => terrain.cellWorld(c[0], c[1]);
  const a = at(abut(cells[0], -1)), b = at(abut(cells[n - 1], 1));
  const y0 = terrain.worldHeight(a[0], a[1]) + 0.08, y1 = terrain.worldHeight(b[0], b[1]) + 0.08;

  const centres = cells.map(at);
  const first = [...centres[0]], last = [...centres[n - 1]];
  first[k] -= DECK_LIP * dir;
  last[k] += DECK_LIP * dir;
  const world = [first, ...centres, last];
  // Height by where a stop actually is between the two banks, not by its index: the two
  // lip stops are closer to their neighbours than the cell centres are to each other.
  const t = (p) => (b[k] === a[k] ? 0 : (p[k] - a[k]) / (b[k] - a[k]));
  const deckY = (i) => Math.max(DECK_MIN, y0 + (y1 - y0) * t(world[i]));
  return { world, centres, deckY, k };
}

// Which cell of the crossing carries its deck at what height, for standing figures on it.
export function bridgeDeckHeights(cells, terrain, axis) {
  if (!cells || !cells.length) return [];
  const { centres, deckY } = bridgeStops(cells, terrain, axis);
  return cells.map((c, i) => [c[0], c[1], deckY(i + 1)]);
}

// A plank bridge: a deck, a post-and-rail down each side, and a trestle in the water
// under every cell of the crossing. The rail is posts and a beam rather than a solid
// parapet - as a wall the right height for a settler to hold it hides the planking from
// every angle you would actually look at the island from.
export function buildBridgeGeometry(cells, terrain, from, axis) {
  if (!cells || !cells.length) return null;
  const { world, deckY, k } = bridgeStops(cells, terrain, axis);
  const at = world.map(([x, z]) => [x - from[0], z - from[1]]);
  const W = 0.44;                                    // half the deck's width
  const parts = [];
  const across = (p, s) => (k === 0 ? [p[0], p[1] + s] : [p[0] + s, p[1]]);

  for (let i = 0; i < at.length - 1; i++) {
    const p = at[i], q = at[i + 1];
    const yp = deckY(i), yq = deckY(i + 1);
    const pl = across(p, -W), pr = across(p, W), ql = across(q, -W), qr = across(q, W);
    parts.push(quad([[pl[0], yp, pl[1]], [pr[0], yp, pr[1]], [qr[0], yq, qr[1]], [ql[0], yq, ql[1]]], C.plank));
    // A beam along each side, hanging from the tops of the posts.
    for (const s of [-1, 1]) {
      const e0 = across(p, s * W), e1 = across(q, s * W);
      const t0 = yp + BRIDGE_RAIL, t1 = yq + BRIDGE_RAIL;
      parts.push(quad([
        [e0[0], t0 - 0.07, e0[1]], [e1[0], t1 - 0.07, e1[1]], [e1[0], t1, e1[1]], [e0[0], t0, e0[1]],
      ], C.darkWood));
    }
  }
  // Posts at every stop, trestles only where there is water under the deck.
  for (let i = 0; i < at.length; i++) {
    const y = deckY(i);
    const inWater = i > 0 && i < at.length - 1;
    for (const s of [-1, 1]) {
      const c = across(at[i], s * (W - 0.03));
      parts.push(box(0.075, BRIDGE_RAIL, 0.075, C.darkWood, { x: c[0], y, z: c[1] }));
      if (!inWater) continue;
      const t = across(at[i], s * (W - 0.09));
      parts.push(cylinder(0.05, 0.05, y + 0.8, 6, C.darkWood, { x: t[0], y: -0.8, z: t[1] }));
    }
  }
  return merge(parts);
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
