// The sawmill at work (Plans/zagerij.md): the blade turns, a log is fed along the bench and
// through it, the conveyor's rollers turn and carry split logs up into the barn, and sawdust
// flies off the blade for as long as there is wood under it.
//
// The parts are baked inside the yard asset with their origins on their own axes
// (scripts/build-sawmill.py), so every pivot below is a part's `at` and every distance - how
// far the log travels, how long the belt is, how big a roller is - is read off the bake rather
// than written down again. buildings.js leaves them out of the merged building
// (`isSawmillMoving`); this file is the only thing that draws them.
//
// Shaped like fountain.js: `attachSawmill` builds, `updateSawmill` moves. Everything runs off
// the sawmill's own clock and a seeded rng, so two runs of the same frames are the same mill -
// tests/sawmill.test.mjs relies on it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng } from 'shared/rng.mjs';
import { mesh, box } from './buildings.js';
import * as models from './models.js';

const YARD = 'civic_sawmill_yard';
export const PART = {
  blade: `${YARD} blade`,
  log: `${YARD} log`,
  billet: `${YARD} billet`,
  roller: (i) => `${YARD} roller ${i}`,
};

// A working speed rather than a true one: a real blade at 3000 rpm is a grey disc on a screen,
// and one you can count the teeth of is one you can see turning.
export const BLADE_SPIN = 16;        // rad/s
// One log through the blade, and the pause before the next is laid on the bench.
export const FEED_S = 5;
export const REST_S = 1.4;
// How long a log takes to be lifted on or off the bench: it grows in and shrinks out instead
// of appearing, which at this size reads as being put down.
const POP_S = 0.3;
// The belt, in units a second along its length.
export const BELT_SPEED = 0.16;
// Sawdust: how many chips there can be at once, how many a second while cutting, and how
// they fall. The chips are a fixed pool, so a mill costs one draw call however hard it works.
export const CHIPS = 28;
const CHIP_RATE = 46;
const CHIP_LIFE = 0.7;
const CHIP_FALL = 3.2;
const DUST = 0xe2c38d;

// Every baked slot of one part: a part with two colours bakes as `name:0` and `name:1`.
function slotsOf(name) {
  return models.assetParts(YARD).filter((n) => n === name || n.startsWith(name + ':'));
}
const atOf = (name) => models.part(slotsOf(name)[0]).at;

function geometryOf(name) {
  const names = slotsOf(name);
  return names.length === 1 ? mesh(names[0]) : mergeGeometries(names.map((n) => mesh(n)), false);
}

// The furthest a part's vertices reach from its own origin along one axis: a log's half
// length, a roller's radius.
function reach(name, axis) {
  let far = 0;
  for (const n of slotsOf(name)) {
    const p = models.part(n).positions;
    for (let i = axis; i < p.length; i += 3) far = Math.max(far, Math.abs(p[i]));
  }
  return far;
}

// The mill's own measurements, in the yard's frame, all off the bake.
function measure() {
  const blade = atOf(PART.blade), log = atOf(PART.log), billet = atOf(PART.billet);
  const rollers = [];
  for (let i = 0; slotsOf(PART.roller(i)).length; i++) rollers.push(atOf(PART.roller(i)));
  const first = rollers[0], last = rollers[rollers.length - 1];
  const belt = [last[0] - first[0], last[1] - first[1], last[2] - first[2]];
  const beltLength = Math.hypot(...belt);
  return {
    blade, log, billet, rollers,
    bladeR: Math.max(reach(PART.blade, 0), reach(PART.blade, 1)),
    // The log starts as far before the blade as it ends up past it.
    travel: 2 * (blade[0] - log[0]),
    logHalf: reach(PART.log, 0),
    logR: reach(PART.log, 1),
    rollerR: reach(PART.roller(0), 1),
    belt: belt.map((v) => v / beltLength),
    beltLength,
  };
}

export function sawmillGeometry() {
  return models.hasAsset(YARD) ? measure() : null;
}

// The pose of the feed at time t: where the log is along its travel (0 to 1) and how big it is
// drawn (0 while there is no log on the bench). A function of t alone.
export function feedAt(t) {
  const phase = ((t % (FEED_S + REST_S)) + FEED_S + REST_S) % (FEED_S + REST_S);
  if (phase >= FEED_S) return { k: 1, scale: 0 };
  const k = phase / FEED_S;
  const scale = Math.min(1, phase / POP_S, (FEED_S - phase) / POP_S);
  return { k, scale: Math.max(0, scale) };
}

export function attachSawmill(group, at, material, yaw = 0) {
  const G = sawmillGeometry();
  if (!G) return null;
  const root = new THREE.Group();
  root.position.set(...at);
  root.rotation.y = yaw;
  group.add(root);

  const geometries = [];
  const hang = (name, where) => {
    const geometry = geometryOf(name);
    geometries.push(geometry);
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = true;
    m.position.set(...where);
    root.add(m);
    return m;
  };
  const blade = hang(PART.blade, G.blade);
  const log = hang(PART.log, G.log);
  const rollers = G.rollers.map((p, i) => hang(PART.roller(i), p));
  // Two split logs on the belt, half a belt apart, off one baked billet.
  const billets = [hang(PART.billet, G.billet), hang(PART.billet, G.billet)];

  // The chips: one tiny box, instanced.
  const chipGeometry = box(0.012, 0.008, 0.012, DUST);
  geometries.push(chipGeometry);
  const chips = new THREE.InstancedMesh(chipGeometry, material, CHIPS);
  chips.frustumCulled = false;
  root.add(chips);
  const pool = Array.from({ length: CHIPS }, () => ({ life: 0, p: [0, 0, 0], v: [0, 0, 0] }));
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < CHIPS; i++) chips.setMatrixAt(i, hidden);

  const mill = { root, G, blade, log, rollers, billets, chips, pool, geometries, time: 0, owed: 0,
    cutting: false, rng: makeRng('sawmill'), hidden };
  updateSawmill(mill, 0);
  return mill;
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const s3 = new THREE.Vector3();
const p3 = new THREE.Vector3();

export function updateSawmill(mill, dt) {
  if (!mill) return;
  const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
  mill.time += step;
  const t = mill.time;
  const G = mill.G;

  // The blade: the teeth at the top run back towards the log coming at them (-x), which is a
  // positive turn about z.
  mill.blade.rotation.z = (t * BLADE_SPIN) % (Math.PI * 2);

  // The feed.
  const { k, scale } = feedAt(t);
  mill.log.position.x = G.log[0] + G.travel * k;
  mill.log.scale.setScalar(Math.max(scale, 1e-4));
  mill.log.visible = scale > 0;
  // Cutting while any of the log is at the blade.
  mill.cutting = scale > 0 && Math.abs(mill.log.position.x - G.blade[0]) < G.logHalf;

  // The belt: rollers turn so their tops run up the belt, and two billets ride it into the barn.
  const spin = (t * BELT_SPEED / G.rollerR) % (Math.PI * 2);
  for (const r of mill.rollers) r.rotation.z = -spin;
  mill.billets.forEach((b, i) => {
    const along = (t * BELT_SPEED + i * G.beltLength / 2) % G.beltLength;
    b.position.set(G.billet[0] + G.belt[0] * along, G.billet[1] + G.belt[1] * along, G.billet[2] + G.belt[2] * along);
    // Grows on at the foot and shrinks into the wall at the top.
    const ends = Math.min(1, along / 0.06, (G.beltLength - along) / 0.06);
    b.scale.setScalar(Math.max(1e-4, ends));
  });

  // Sawdust, thrown up and back off the top of the blade where it leaves the wood.
  if (mill.cutting) mill.owed += CHIP_RATE * step;
  const rng = mill.rng;
  for (const c of mill.pool) {
    if (c.life <= 0 && mill.owed >= 1) {
      mill.owed -= 1;
      c.life = CHIP_LIFE * rng.range(0.6, 1);
      c.p = [G.blade[0] - G.bladeR * 0.25, G.log[1] + G.logR * 0.6, G.blade[2] + rng.range(-0.01, 0.01)];
      c.v = [-rng.range(0.25, 0.7), rng.range(0.35, 0.9), rng.range(-0.3, 0.3)];
    }
  }
  mill.owed = Math.min(mill.owed, 1);
  mill.pool.forEach((c, i) => {
    if (c.life <= 0) { mill.chips.setMatrixAt(i, mill.hidden); return; }
    c.life -= step;
    c.v[1] -= CHIP_FALL * step;
    for (let a = 0; a < 3; a++) c.p[a] += c.v[a] * step;
    // Settled on the ground: gone, the drift already has it.
    if (c.p[1] <= 0.005) c.life = 0;
    const size = c.life > 0 ? Math.min(1, c.life / 0.15) : 0;
    q.setFromAxisAngle(p3.set(0.3, 1, 0.2).normalize(), c.life * 9 + i);
    m4.compose(p3.set(...c.p), q, s3.setScalar(size));
    mill.chips.setMatrixAt(i, m4);
  });
  mill.chips.instanceMatrix.needsUpdate = true;
}

export function disposeSawmill(mill) {
  if (!mill) return;
  mill.root.parent?.remove(mill.root);
  for (const g of mill.geometries) g.dispose();
  mill.chips.dispose();
}
