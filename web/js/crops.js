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
import { makeRng, hash32 } from 'shared/rng.mjs';

const EARTH = 0x574232;
const RIDGE = 0x6a5340;
const WOOD = 0x6b4a2f;
const TWINE = 0xbba079;
const SHOULDER = 0x9a6aa8;      // where a turnip comes out of the ground and catches the light

function merge(parts) {
  const g = mergeGeometries(parts.filter(Boolean), false);
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

// ---------------------------------------------------------------- the ground
// What marks a sown bed is turned earth lying in the grass, not a tray standing on it.
//
// A bed is 1.2 across - near five metres - and it used to be a square slab nine
// centimetres thick hung from the highest of its four corners, so that the uphill corner
// could not be buried. On this island that is the wrong way round: the beds are sown on
// meadow and meadow is where the ground moves, so the slab cleared the grass everywhere
// else and stood there showing its sides. The earth is a low heap instead - a lens that
// crowns a couple of centimetres over the middle and slides in under the turf at the rim,
// over a plug that reaches deep enough to fill the gap where the meadow falls away
// beneath it. A heap has no vertical edge to catch the eye: where the ground cuts it you
// see a slope of soil, which is what a heap of soil looks like.
const SOIL_DEEP = 0.44;

function soil(rng) {
  const s = BED_SIZE;
  const parts = [
    cylinder(s * 0.36, s * 0.47, 0.065, 7, EARTH, { y: -0.02 }),
    cylinder(s * 0.44, s * 0.3, SOIL_DEEP, 7, EARTH, { y: -0.02 - SOIL_DEEP }),
  ];
  // The clods a spade leaves behind, which is what says this ground was turned over.
  // Thrown about rather than ruled into lines: two straight ridges read as boards laid
  // across the bed, and a board is the very thing a bed is getting away from here.
  for (let i = 0; i < 3; i++) {
    parts.push(box(rng.range(0.11, 0.2), 0.03, rng.range(0.08, 0.14), RIDGE, {
      x: rng.range(-0.28, 0.28), y: 0.028, z: rng.range(-0.26, 0.26), ry: rng.range(0, Math.PI),
    }));
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
function shoots(hex, o = {}) {
  return [
    cone(0.02, 0.06, 4, hex, { ...o, x: (o.x || 0) - 0.04 }),
    cone(0.017, 0.045, 4, hex, { ...o, x: (o.x || 0) + 0.05, z: (o.z || 0) + 0.03 }),
  ];
}

// ---------------------------------------------------------------- the vegetables
// Each builder is handed the stage and returns one plant, built around the origin with
// its foot on the earth. Where it ends up standing is the plot's business below, which
// is what lets a bed hold a handful of them at slightly different sizes and angles
// instead of one specimen in the middle.
const PLANTS = {
  // Cream with a purple shoulder where it comes out of the ground. Small on purpose: a
  // bed is a handful of turnips you could pull, not one prize vegetable.
  turnip(stage, c) {
    if (stage === 'sown') return shoots(c.leaf);
    if (stage === 'sprout') return rosette(4, 0.085, 0.05, 0.07, c.leaf);
    if (stage === 'leafy') return rosette(5, 0.13, 0.08, 0.11, c.leaf);
    const bulb = sphere(0.075, c.flesh);
    bulb.scale(1, 0.8, 1);
    bulb.translate(0, 0.05, 0);
    return [
      bulb,
      // A cap cut to the bulb's own silhouette, so the shoulder is purple and the rest
      // of it stays cream without a second ball of geometry to pay for.
      cylinder(0.036, 0.058, 0.026, 7, SHOULDER, { y: 0.088 }),
      ...rosette(5, 0.125, 0.085, 0.13, c.leaf, { y: 0.105 }),
    ];
  },

  // Feathery on top and nothing to look at until it is out of the ground, so what shows
  // is the shoulder of the root and a lot of leaf.
  carrot(stage, c) {
    if (stage === 'sown') return shoots(c.leaf);
    if (stage === 'sprout') return rosette(5, 0.07, 0.025, 0.1, c.leaf);
    if (stage === 'leafy') return rosette(6, 0.12, 0.035, 0.17, c.leaf);
    return [
      cylinder(0.036, 0.02, 0.085, 6, c.flesh, { y: -0.01 }),
      ...rosette(6, 0.13, 0.038, 0.2, c.leaf, { y: 0.06 }),
    ];
  },

  beetroot(stage, c) {
    if (stage === 'sown') return shoots(c.leaf);
    if (stage === 'sprout') return rosette(4, 0.08, 0.05, 0.09, c.leaf);
    if (stage === 'leafy') return rosette(5, 0.14, 0.1, 0.16, c.leaf);
    const root = sphere(0.072, c.flesh);
    root.scale(1, 0.92, 1);
    root.translate(0, 0.04, 0);
    return [root, ...rosette(5, 0.15, 0.11, 0.18, c.leaf, { y: 0.08 })];
  },

  // Climbs, so it is drawn as a row of poles rather than a clump. Three to a bed, and
  // the plot leaves them unturned so the row keeps its line.
  tidebean(stage, c) {
    if (stage === 'sown') return shoots(c.leaf);
    const h = stage === 'sprout' ? 0.28 : 0.62;
    const parts = [cylinder(0.013, 0.019, h, 5, WOOD)];
    // A length of twine along the row, so the three poles read as one line of canes.
    if (stage !== 'sprout') parts.push(box(0.44, 0.012, 0.012, TWINE, { y: h - 0.06 }));
    const leaves = stage === 'sprout' ? 2 : 5;
    for (let i = 0; i < leaves; i++) {
      parts.push(leaf(i * 2.4, 0.11, 0.09, 0.03, c.leaf, { y: 0.07 + (i / leaves) * (h - 0.1) }));
    }
    if (stage === 'ripe') {
      for (let i = 0; i < 4; i++) {
        parts.push(box(0.022, 0.13, 0.022, c.flesh, { x: i % 2 ? 0.05 : -0.05, y: 0.16 + i * 0.11, rz: i % 2 ? 0.25 : -0.25 }));
      }
    }
    return parts;
  },

  // Stands upright and lights up once it is ready, which is the whole reason to grow it:
  // a ripe row can be found on the island after dark.
  moonleek(stage, c) {
    if (stage === 'sown') return shoots(c.leaf);
    const h = stage === 'sprout' ? 0.12 : stage === 'leafy' ? 0.24 : 0.34;
    const lit = stage === 'ripe' ? { emissive: 1 } : {};
    const parts = [cylinder(0.032, 0.046, h * 0.55, 6, c.flesh, lit)];
    for (let i = 0; i < 5; i++) {
      const a = 0.4 + (i / 5) * Math.PI * 2;
      parts.push(leaf(a, 0.09, 0.055, h, c.leaf, { ...lit, y: h * 0.4 }));
    }
    return parts;
  },

  // Two fruits to a bed with the vine sprawling between them, which is also what the
  // stall pays for. They never set evenly, and the plot's sizing is what says so.
  pumpkin(stage, c) {
    if (stage === 'sown') return shoots(c.leaf);
    if (stage === 'sprout') return rosette(3, 0.14, 0.12, 0.06, c.leaf);
    const vines = rosette(4, 0.26, 0.18, 0.05, c.leaf, {}, 0.7);
    if (stage === 'leafy') return [...vines, sphere(0.05, 0xf2c53d, { y: 0.045 })];
    const fruit = sphere(0.145, c.flesh);
    fruit.scale(1, 0.7, 1);
    fruit.translate(0, 0.1, 0);
    return [...vines, fruit, cylinder(0.022, 0.03, 0.06, 5, WOOD, { y: 0.19 })];
  },
};

// ---------------------------------------------------------------- where they stand
// A bed is sown by hand: the rows wander, the spacing is uneven and no two plants come
// up the same size. That scatter is the whole difference between a crop and a pattern,
// so it lives here and the builders above know nothing about it.
//
// `spin` is off for the climbers, whose poles carry a line of twine between them and so
// have to keep facing along their row.
const PLOT = {
  default: { n: 5, rows: 2, reach: 0.3 },
  carrot: { n: 6, rows: 2, reach: 0.3 },
  tidebean: { n: 3, rows: 1, reach: 0.34, lean: 0.04, spin: false, vary: [0.97, 1.03] },
  pumpkin: { n: 2, rows: 1, reach: 0.22, lean: 0.06 },
};

// The spots in one bed. The sizes wander too, except for the climbers: their poles are
// tied together with a length of twine, and canes of three different heights would hang
// it like bunting.
function plot(kind, rng) {
  const p = PLOT[kind] || PLOT.default;
  const per = Math.ceil(p.n / p.rows);
  const lean = p.lean === undefined ? 0.1 : p.lean;
  const vary = p.vary || [0.84, 1.14];
  const out = [];
  for (let i = 0; i < p.n; i++) {
    const row = Math.floor(i / per);
    const cols = Math.min(per, p.n - row * per);
    const across = cols > 1 ? (i % per) / (cols - 1) - 0.5 : 0;
    const along = p.rows > 1 ? row / (p.rows - 1) - 0.5 : 0;
    out.push({
      x: across * p.reach * 2 + rng.range(-0.06, 0.06),
      z: along * p.reach * 1.6 + rng.range(-0.06, 0.06),
      spin: p.spin === false ? 0 : rng.range(0, Math.PI * 2),
      lean: rng.range(0, lean),
      size: rng.range(vary[0], vary[1]),
    });
  }
  return out;
}

// One plant, stood where the plot wants it: a size of its own, leaned a few degrees off
// upright, and turned so that no two neighbours show the same face.
function stand(parts, at) {
  for (const g of parts) {
    if (at.size !== 1) g.scale(at.size, at.size, at.size);
    if (at.lean) g.rotateZ(at.lean);
    if (at.spin) g.rotateY(at.spin);
    g.translate(at.x, 0, at.z);
  }
  return parts;
}

// One bed, at one stage of its growing. `variant` picks one of the scatters a bed can
// be sown in - see geometryFor() below. Exported so the model sheet can lay every
// vegetable out at every stage without a village or a garden behind it.
export function bedGeometry(kind, stage = 'ripe', variant = 0) {
  const c = CROPS[kind] || CROPS.turnip;
  const plant = PLANTS[kind] || PLANTS.turnip;
  // One thread of randomness for the whole bed, out of the crop and the bed's number and
  // nothing else. It has to come back the same every time: a bed is rebuilt each time it
  // moves on a stage, and turnips that shuffled about while they grew would not be the
  // bed anyone was watching.
  const rng = makeRng(`${kind}:${variant}`);
  const parts = soil(rng);
  const spots = plot(kind, rng);
  // The day it is sown the seed is still in the ground, so only every other spot has
  // anything through at all: a bed of fresh earth with a thread or two of green in it.
  const up = stage === 'sown' ? spots.filter((_, i) => i % 2 === 0) : spots;
  for (const at of up) parts.push(...stand(plant(stage, c), at));
  return merge(parts);
}

export function createCrops({ scene, terrain, material }) {
  const group = new THREE.Group();
  group.name = 'crops';
  scene.add(group);

  const records = new Map();     // id -> { spec, mesh, stage, variant, pop }
  const cache = new Map();       // kind:stage:variant -> geometry, shared by every bed like it

  // The ground under the bed's middle, sunk a hair, which is what every prop on this
  // island does. It used to be the highest of the bed's four corners so that a flat slab
  // could not bury its uphill end, and that lifted the whole bed clear of the grass on
  // any slope at all. The earth is a heap now and a heap needs no such favour: the few
  // centimetres the meadow falls across a bed are swallowed by its own slope.
  function bedY(x, z) {
    return terrain.worldHeight(x, z) - 0.015;
  }

  // Two beds of the same crop at the same stage can share one geometry, which is what
  // keeps a field of eighty beds to a couple of dozen merges. Sharing a single shape
  // between all of them would make a field a row of stamps, though, so a bed draws one
  // of a few scatters from its own id: a handful more geometries in the cache, and
  // nothing at all per frame.
  const VARIANTS = 3;
  const variantOf = (id) => hash32(String(id)) % VARIANTS;

  function geometryFor(kind, stage, variant) {
    const key = `${kind}:${stage}:${variant}`;
    if (!cache.has(key)) cache.set(key, bedGeometry(kind, stage, variant));
    return cache.get(key);
  }

  function add(spec, animate) {
    const stage = growthOf(spec).stage;
    const variant = variantOf(spec.id);
    const mesh = new THREE.Mesh(geometryFor(spec.kind, stage, variant), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(spec.x, bedY(spec.x, spec.z), spec.z);
    mesh.rotation.y = spec.rot || 0;
    mesh.userData.id = spec.id;
    mesh.scale.setScalar(animate ? 0.001 : 1);
    group.add(mesh);
    const rec = { spec, mesh, stage, variant, pop: animate ? 0 : 1 };
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
        rec.mesh.geometry = geometryFor(rec.spec.kind, stage, rec.variant);
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
