// The vegetable beds, drawn on top of the village like the props are.
//
// A bed carries two timestamps and nothing else, so this file works out for itself how
// far along it is and swaps the shape when it moves on: sown earth, then shoots, then
// leaves, then the vegetable showing. Nothing is fetched to make that happen, which is
// what lets a row of turnips be watched coming up.
//
// Adding a vegetable means an entry in shared/crops.mjs and a builder in PLANTS below.
// A crop with no builder of its own still grows: it comes up as turnips.
//
// A bed is not solid. You walk through your own turnips, which is worth the small
// untruth: a bed you cannot step over is a bed you can be fenced in by.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { box, cylinder, cone, sphere, quad } from './buildings.js';
import { CROPS, BED_SIZE, growthOf } from 'shared/crops.mjs';

const EARTH = 0x574232;
const RIDGE = 0x6a5340;
const WOOD = 0x6b4a2f;
const TWINE = 0xbba079;

function merge(parts) {
  const g = mergeGeometries(parts.filter(Boolean), false);
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

// ---------------------------------------------------------------- the ground
// Tilled earth with the furrows still in it, a little proud of the grass so the bed
// reads as dug rather than painted on.
function soil() {
  const s = BED_SIZE;
  const parts = [box(s, 0.09, s, EARTH, { y: -0.06 })];
  for (let i = 0; i < 4; i++) {
    parts.push(box(s - 0.08, 0.05, 0.17, RIDGE, { y: 0.02, z: -s * 0.375 + i * (s * 0.25) }));
  }
  return parts;
}

// A leaf: a flat triangle from the crown of the plant out and up. Two-sided, because
// quad indexes both windings, so it is a leaf from underneath as well.
function leaf(a, len, wide, lift, hex, o = {}) {
  const c = Math.cos(a), s = Math.sin(a);
  const hx = -s * wide * 0.5, hz = c * wide * 0.5;
  return quad([
    [0, 0, 0],
    [c * len + hx, lift, s * len + hz],
    [c * len - hx, lift, s * len - hz],
  ], hex, o);
}

// The shape almost every vegetable makes above ground: leaves round a crown.
function rosette(n, len, wide, lift, hex, o = {}, phase = 0.3) {
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(leaf(phase + (i / n) * Math.PI * 2, len, wide, lift, hex, o));
  return parts;
}

// What a bed looks like the moment it is sown: turned earth and two threads of green.
function shoots(hex, o) {
  return [
    cone(0.02, 0.06, 4, hex, { ...o, x: (o.x || 0) - 0.04 }),
    cone(0.017, 0.045, 4, hex, { ...o, x: (o.x || 0) + 0.05, z: (o.z || 0) + 0.03 }),
  ];
}

// ---------------------------------------------------------------- the vegetables
// Each builder is handed the stage and where in the bed this plant stands, and returns
// its parts. Four plants to a bed, unless the crop says otherwise.
const PLANTS = {
  turnip(stage, o, c) {
    if (stage === 'sown') return shoots(c.leaf, o);
    if (stage === 'sprout') return rosette(4, 0.1, 0.06, 0.08, c.leaf, o);
    if (stage === 'leafy') return rosette(6, 0.18, 0.11, 0.14, c.leaf, o);
    const bulb = sphere(0.115, c.flesh);
    bulb.scale(1, 0.82, 1);
    bulb.translate(o.x || 0, 0.05, o.z || 0);
    const cap = sphere(0.095, 0x9a6aa8);
    cap.scale(1, 0.42, 1);
    cap.translate(o.x || 0, 0.115, o.z || 0);
    return [bulb, cap, ...rosette(6, 0.19, 0.12, 0.17, c.leaf, { ...o, y: 0.11 })];
  },

  carrot(stage, o, c) {
    if (stage === 'sown') return shoots(c.leaf, o);
    if (stage === 'sprout') return rosette(5, 0.08, 0.03, 0.12, c.leaf, o);
    if (stage === 'leafy') return rosette(7, 0.14, 0.04, 0.22, c.leaf, o);
    return [
      cylinder(0.05, 0.058, 0.07, 7, c.flesh, { ...o, y: (o.y || 0) - 0.01 }),
      ...rosette(8, 0.17, 0.045, 0.3, c.leaf, { ...o, y: 0.06 }),
    ];
  },

  beetroot(stage, o, c) {
    if (stage === 'sown') return shoots(c.leaf, o);
    if (stage === 'sprout') return rosette(4, 0.09, 0.06, 0.1, c.leaf, o);
    if (stage === 'leafy') return rosette(5, 0.17, 0.13, 0.2, c.leaf, o);
    const root = sphere(0.115, c.flesh);
    root.scale(1, 0.95, 1);
    root.translate(o.x || 0, 0.06, o.z || 0);
    return [root, ...rosette(6, 0.2, 0.14, 0.26, c.leaf, { ...o, y: 0.1 })];
  },

  // Climbs, so it is drawn as a row of poles rather than a clump. Three to a bed.
  tidebean(stage, o, c) {
    if (stage === 'sown') return shoots(c.leaf, o);
    const h = stage === 'sprout' ? 0.28 : 0.62;
    const parts = [cylinder(0.013, 0.019, h, 5, WOOD, o)];
    // A length of twine along the row, so the three poles read as one line of canes.
    if (stage !== 'sprout') parts.push(box(0.012, 0.012, 0.42, TWINE, { ...o, y: (o.y || 0) + h - 0.06 }));
    const leaves = stage === 'sprout' ? 2 : 5;
    for (let i = 0; i < leaves; i++) {
      const y = 0.07 + (i / leaves) * (h - 0.1);
      parts.push(leaf(i * 2.4, 0.11, 0.09, 0.03, c.leaf, { ...o, y: (o.y || 0) + y }));
    }
    if (stage === 'ripe') {
      for (let i = 0; i < 4; i++) {
        const y = 0.16 + i * 0.11;
        parts.push(box(0.022, 0.13, 0.022, c.flesh, { ...o, x: (o.x || 0) + (i % 2 ? 0.05 : -0.05), y: (o.y || 0) + y, rz: i % 2 ? 0.25 : -0.25 }));
      }
    }
    return parts;
  },

  // Stands upright and lights up once it is ready, which is the whole reason to grow it:
  // a ripe row can be found on the island after dark.
  moonleek(stage, o, c) {
    if (stage === 'sown') return shoots(c.leaf, o);
    const h = stage === 'sprout' ? 0.12 : stage === 'leafy' ? 0.24 : 0.34;
    const lit = stage === 'ripe' ? { emissive: 1 } : {};
    const parts = [cylinder(0.035, 0.05, h * 0.55, 6, c.flesh, { ...o, ...lit })];
    for (let i = 0; i < 5; i++) {
      const a = 0.4 + (i / 5) * Math.PI * 2;
      parts.push(leaf(a, 0.09, 0.055, h, c.leaf, { ...o, y: (o.y || 0) + h * 0.4, ...lit }));
    }
    return parts;
  },

  // One fruit to a bed, so it gets the middle of the ground to sprawl over.
  pumpkin(stage, o, c) {
    if (stage === 'sown') return shoots(c.leaf, o);
    if (stage === 'sprout') return rosette(3, 0.16, 0.14, 0.07, c.leaf, o);
    const vines = rosette(5, 0.34, 0.22, 0.06, c.leaf, o, 0.7);
    if (stage === 'leafy') return [...vines, sphere(0.07, 0xf2c53d, { ...o, y: (o.y || 0) + 0.06 })];
    const fruit = sphere(0.27, c.flesh);
    fruit.scale(1, 0.68, 1);
    fruit.translate(o.x || 0, 0.19, o.z || 0);
    return [
      ...vines, fruit,
      cylinder(0.028, 0.038, 0.09, 5, WOOD, { ...o, y: (o.y || 0) + 0.34 }),
    ];
  },
};

// Where the plants stand in a bed. Most crops make a square of four; the climbers make
// a row and the pumpkin takes the whole bed to itself.
const SPOTS = {
  default: [[-0.28, -0.28], [0.28, -0.28], [-0.28, 0.28], [0.28, 0.28]],
  tidebean: [[0, -0.36], [0, 0], [0, 0.36]],
  pumpkin: [[0, 0]],
};

// One bed, at one stage of its growing. Exported so the model sheet can lay every
// vegetable out at every stage without a village or a garden behind it.
export function bedGeometry(kind, stage = 'ripe') {
  const c = CROPS[kind] || CROPS.turnip;
  const plant = PLANTS[kind] || PLANTS.turnip;
  const spots = SPOTS[kind] || SPOTS.default;
  const parts = soil();
  for (const [x, z] of spots) parts.push(...plant(stage, { x, z }, c));
  return merge(parts);
}

export function createCrops({ scene, terrain, material }) {
  const group = new THREE.Group();
  group.name = 'crops';
  scene.add(group);

  const records = new Map();     // id -> { spec, mesh, stage, pop }
  const cache = new Map();       // kind:stage -> geometry, shared by every bed like it

  function geometryFor(kind, stage) {
    const key = `${kind}:${stage}`;
    if (!cache.has(key)) cache.set(key, bedGeometry(kind, stage));
    return cache.get(key);
  }

  function add(spec, animate) {
    const stage = growthOf(spec).stage;
    const mesh = new THREE.Mesh(geometryFor(spec.kind, stage), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(spec.x, terrain.worldHeight(spec.x, spec.z) - 0.02, spec.z);
    mesh.rotation.y = spec.rot || 0;
    mesh.userData.id = spec.id;
    mesh.scale.setScalar(animate ? 0.001 : 1);
    group.add(mesh);
    const rec = { spec, mesh, stage, pop: animate ? 0 : 1 };
    records.set(spec.id, rec);
    return rec;
  }

  function remove(id) {
    const rec = records.get(id);
    if (!rec) return;
    group.remove(rec.mesh);
    records.delete(id);
    // the geometry belongs to the cache and is shared, so it is not disposed here
  }

  function apply(list, { animate = true } = {}) {
    const seen = new Set();
    for (const spec of list || []) {
      seen.add(spec.id);
      const rec = records.get(spec.id);
      if (!rec) { add(spec, animate); continue; }
      rec.spec = spec;
    }
    for (const id of [...records.keys()]) if (!seen.has(id)) remove(id);
  }

  // Growing happens here rather than over the wire: every bed knows when it was sown
  // and when it is due, so the stage is a subtraction. The little pop is what makes a
  // bed moving on visible from across the field.
  function update(dt) {
    const now = Date.now();
    for (const rec of records.values()) {
      const stage = growthOf(rec.spec, now).stage;
      if (stage !== rec.stage) {
        rec.stage = stage;
        rec.mesh.geometry = geometryFor(rec.spec.kind, stage);
        rec.pop = 0.55;                          // grown into, not swapped
      }
      if (rec.pop < 1) {
        rec.pop = Math.min(1, rec.pop + dt * 2.2);
        const e = 1 - Math.pow(1 - rec.pop, 3);
        rec.mesh.scale.setScalar(e * (1 + Math.sin(rec.pop * Math.PI) * 0.1));
      }
    }
  }

  // Every bed with its growing worked out, which is what the walking prompts and the
  // "N ready" count are built from.
  function list() {
    const now = Date.now();
    return [...records.values()].map((rec) => ({ ...rec.spec, ...growthOf(rec.spec, now) }));
  }

  function nearest(x, z, within = 2) {
    let best = null, bestD = within;
    for (const rec of records.values()) {
      const d = Math.hypot(rec.spec.x - x, rec.spec.z - z);
      if (d < bestD) { bestD = d; best = rec.spec; }
    }
    return best;
  }

  function dispose() {
    scene.remove(group);
    for (const g of cache.values()) g.dispose();
    cache.clear();
    records.clear();
  }

  return { group, apply, update, list, nearest, count: () => records.size, dispose };
}
