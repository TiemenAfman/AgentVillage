// The timber run and the yard's crew (Plans/houtkar.md): the sawmill's draught horse takes a
// wagon of squared timber down the road to the shipyard every TIMBER_EVERY seconds and comes
// back empty, and three hands work the yard - a shipwright hammering along the hull, a tar
// boiler at his kettle, and a carrier bringing planks from the stack, who goes out to the gate
// to unload the wagon when it comes in.
//
// Everything here is a function of the sea's clock and of nothing else. There is no count of the
// keeper's in it, unlike the gold run (goldrun.js), so nothing is private and every page shows
// it, visitors' included; and with the sea's clock (`now` is Date.now() plus the sea's skew,
// main.js timeNow) every screen shows the wagon at the same place on the same trip without a
// message on the wire - a page loaded halfway through a trip finds it halfway down the road
// rather than at the sawmill. Which is why nothing below keeps a queue of steps the way the
// gold run does: where anybody is comes out of `tripAt` and `crewAt` for the moment asked.
//
// Figures are the player's rig as villagers (smithy.js's smith is the pattern): nobody's agent,
// not on the wire. The horse is fauna.js's own, posed from outside its brain as rave.js poses
// the stable's (applyPose), and it is the sawmill's own draught horse, not the stable's - that
// one stays in its paddock. The wagon is baked (scripts/build-wagon.py).
import * as THREE from 'three';
import { createClassicAvatar } from './classic-avatar.js';
import { normalizeAvatar } from './avatar.js';
import { createAnimal, stepPose, applyPose } from './fauna.js';
import { mesh, meshAsset, box, mergeParts } from './buildings.js';
import * as models from './models.js';
import { roadBetween } from 'shared/roads.mjs';
import { hash32 } from 'shared/rng.mjs';
import { yardStage } from './shipyard.js';
import { VILLAGER_SCALE } from './goldsmith.js';

// Seconds of sea time from one departure to the next at least (tripPlan makes it longer for a
// long road), and the island's own offset into that period (from its seed), so two islands'
// wagons do not all leave on the same second.
export const TIMBER_EVERY = 360;
// The horse at a walk, in units a second. A long road is driven faster rather than past the
// next departure (tripPlan).
export const HORSE_SPEED = 0.42;
export const LOAD_S = 9;          // at the sawmill, the load going on
export const UNLOAD_S = 15;       // at the yard's gate, the carrier taking it off
const TRANS_S = 2;                // the carter walking from the horse's head to the tail and back
const LANE = 0.2;                 // the wagon keeps this far right of the road's middle
const CORNER = 0.4;               // and starts a corner this far before it
const WALK = 0.5;                 // the crew and the carter on foot, units a second
const DUSK = 0.5;                 // no wagon leaves, and the crew is in the shed, past this much night

const nightOf = (material) => material?.userData?.uniforms?.uNight?.value ?? 0;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp2 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

// ---- the wagon's measurements, off the bake ---------------------------------------------------
// The axle is the wheels' origin; the shafts end at the horse's shoulders, HORSE_IN ahead of its
// middle (fauna_horse's body reaches 0.25 forward of it); and the load lies on the bed's floor,
// one floor board (build-wagon.py: 0.025) above the bed part's lowest point.
const HORSE_IN = 0.22;
let WAGON = null;
export function wagonMeasure() {
  if (WAGON) return WAGON;
  if (!models.hasAsset('prop_wagon')) return null;
  // The bake splits a part per material (`prop_wagon bed:0`, `:1`, ...), so each is asked for
  // by its prefix.
  const of = (prefix) => models.assetParts('prop_wagon').filter((n) => n === prefix || n.startsWith(`${prefix}:`)).map((n) => models.part(n));
  const [wheel] = of('prop_wagon wheel east');
  let tip = -Infinity, low = Infinity, tail = Infinity, r = 0;
  for (const p of of('prop_wagon shafts')) for (let i = 0; i < p.positions.length; i += 3) tip = Math.max(tip, p.positions[i + 2] + p.at[2]);
  for (const p of of('prop_wagon bed')) {
    for (let i = 0; i < p.positions.length; i += 3) {
      low = Math.min(low, p.positions[i + 1] + p.at[1]);
      tail = Math.min(tail, p.positions[i + 2] + p.at[2]);
    }
  }
  for (const p of of('prop_wagon wheel east')) for (let i = 0; i < p.positions.length; i += 3) r = Math.max(r, Math.hypot(p.positions[i + 1], p.positions[i + 2]));
  if (!wheel || !Number.isFinite(tip)) return null;
  WAGON = { axleZ: wheel.at[2], axle: wheel.at, hitch: tip - HORSE_IN - wheel.at[2], floorY: low + 0.025, tailZ: tail, wheelR: r };
  return WAGON;
}

// ---- the road, as the wagon drives it ---------------------------------------------------------
// A route off roadBetween is cell middles with right-angle corners. The wagon takes each corner
// as a curve starting CORNER before it, keeps LANE to the right of the middle, and at each end
// turns round in the road to come back on the other side - so the whole trip is one closed loop,
// out on one side and back on the other, and where the horse is is one number along it.
function rounded(pts, r) {
  if (pts.length < 3) return pts.slice();
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1], v = pts[i], n = pts[i + 1];
    const a = [v[0] - p[0], v[1] - p[1]], b = [n[0] - v[0], n[1] - v[1]];
    const la = Math.hypot(...a), lb = Math.hypot(...b);
    if (la < 1e-6 || lb < 1e-6) continue;
    const cross = a[0] * b[1] - a[1] * b[0];
    if (Math.abs(cross) < 1e-6 * la * lb) { out.push(v); continue; }
    const ra = Math.min(r, la / 2), rb = Math.min(r, lb / 2);
    const s = [v[0] - a[0] / la * ra, v[1] - a[1] / la * ra];
    const e = [v[0] + b[0] / lb * rb, v[1] + b[1] / lb * rb];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4, u = 1 - t;
      out.push([u * u * s[0] + 2 * u * t * v[0] + t * t * e[0], u * u * s[1] + 2 * u * t * v[1] + t * t * e[1]]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
// `w` to the right of travel: facing +z a figure's right hand is at -x (classic-avatar.js), so the
// right of a heading (dx, dz) is (-dz, dx). Each point moves along the mean of its two
// segments' normals, stretched so a straight stretch stays exactly `w` off.
function offset(pts, w) {
  const norm = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [-dz / l, dx / l]; };
  return pts.map((p, i) => {
    const n0 = i > 0 ? norm(pts[i - 1], p) : null, n1 = i < pts.length - 1 ? norm(p, pts[i + 1]) : null;
    const n = n0 && n1 ? [n0[0] + n1[0], n0[1] + n1[1]] : (n0 || n1);
    const l = Math.hypot(...n) || 1;
    // Two unit normals sum to 2cos(half the turn): 2 / l is the mitre, capped for a sharp one.
    const k = n0 && n1 ? Math.min(1.6, 2 / l) : 1;
    return [p[0] + n[0] / l * w * k, p[1] + n[1] / l * w * k];
  });
}
// From the end of one lane to the start of the other, round the far side of the road's end.
function uTurn(a, b, heading) {
  const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], r = [a[0] - c[0], a[1] - c[1]], len = Math.hypot(...r);
  const out = [];
  for (let k = 1; k < 6; k++) {
    const t = Math.PI * k / 6;
    out.push([c[0] + r[0] * Math.cos(t) + heading[0] * len * Math.sin(t), c[1] + r[1] * Math.cos(t) + heading[1] * len * Math.sin(t)]);
  }
  return out;
}
const headingOf = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };

// The closed loop for a route in world coordinates, and where along it the wagon stops at the
// yard (`atYard`, the end of the outward lane). Arc length 0 is the start of the outward lane,
// at the sawmill's door, which is also where the loop closes.
export function tripLoop(route) {
  if (!route || route.length < 2) return null;
  const mid = rounded(route, CORNER);
  const out = offset(mid, LANE);
  const back = offset([...mid].reverse(), LANE);
  const pts = [...out, ...uTurn(out[out.length - 1], back[0], headingOf(mid[mid.length - 2], mid[mid.length - 1])),
    ...back, ...uTurn(back[back.length - 1], out[0], headingOf(mid[1], mid[0]))];
  const at = [0];
  for (let i = 1; i < pts.length; i++) at.push(at[i - 1] + dist(pts[i - 1], pts[i]));
  const total = at[at.length - 1] + dist(pts[pts.length - 1], pts[0]);
  let atYard = 0;
  for (let i = 1; i < out.length; i++) atYard += dist(out[i - 1], out[i]);
  return { pts, at, total, atYard };
}
// Where on the loop arc length `s` is, and which way the loop goes there.
export function pointAt(loop, s) {
  const { pts, at, total } = loop;
  s = ((s % total) + total) % total;
  let lo = 0, hi = pts.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (at[m] <= s) lo = m; else hi = m - 1; }
  const a = pts[lo], b = pts[(lo + 1) % pts.length];
  const seg = (lo + 1 < pts.length ? at[lo + 1] : total) - at[lo];
  const k = seg > 1e-9 ? (s - at[lo]) / seg : 0;
  return { p: lerp2(a, b, k), dir: headingOf(a, b) };
}

// ---- the timetable ----------------------------------------------------------------------------
// One trip: parked, then LOAD_S at the sawmill, the outward lane, UNLOAD_S at the gate, the way
// back, parked until the next. The horse always walks: where the loop does not fit in
// TIMBER_EVERY with half a minute to spare, the period is made longer instead. Hurried to fit,
// the first island tried (208 cells of road between the two, a 380 grid) had the horse at over
// three times its walk, which reads as a bolting horse and not as a delivery.
export function tripPlan(loop) {
  if (!loop) return null;
  const speed = HORSE_SPEED;
  const out = loop.atYard / speed, back = (loop.total - loop.atYard) / speed;
  const length = LOAD_S + out + UNLOAD_S + back;
  return { loop, speed, out, back, length, period: Math.max(TIMBER_EVERY, Math.ceil(length + 30)) };
}
// What the trip is doing at sea time `now` (ms): `stage` is 'parked' | 'load' | 'out' | 'unload'
// | 'back', `s` the horse's arc length, `t` the seconds into that stage, `trip` which departure
// (so the unload knows which moment it started at). `phase` is the island's offset in seconds.
export function tripAt(plan, now, phase = 0) {
  const every = plan ? plan.period : TIMBER_EVERY;
  const t0 = now / 1000 - phase;
  const trip = Math.floor(t0 / every);
  let t = t0 - trip * every;
  const base = { trip, start: (trip * every + phase) * 1000 };
  if (!plan || t >= plan.length) return { ...base, stage: 'parked', s: 0, t: t - (plan ? plan.length : 0) };
  if (t < LOAD_S) return { ...base, stage: 'load', s: 0, t };
  t -= LOAD_S;
  if (t < plan.out) return { ...base, stage: 'out', s: t * plan.speed, t };
  t -= plan.out;
  if (t < UNLOAD_S) return { ...base, stage: 'unload', s: plan.loop.atYard, t };
  t -= UNLOAD_S;
  return { ...base, stage: 'back', s: plan.loop.atYard + t * plan.speed, t };
}

// ---- the crew's day ---------------------------------------------------------------------------
// Each hand has a round of places in the yard's own frame (the model's: the landward gate at
// z = -8, the sea at +8, scripts/build-shipyard.py) - where to stand, which way to face, how long
// to work there - walked in straight lines at WALK, round and round. Which round depends on how
// far the ship is (yardStage): with the stocks empty there is no hull to hammer at. The places
// are picked off the bake: the east side stays outboard of the ladder (x 1.31-1.67) and the
// shores (1.66), the west side is the tar kettle's (at x -2.08, z -4.55), and nobody crosses the
// landward end, where the sheerlegs, the stems and the stacks leave no way through.
const E = 1.72, W = -1.66;
const ROUNDS = {
  shipwright: (stage) => (stage === 0
    ? [[[0.42, -3.6], [0, -3.6], 9], [[0.42, -0.6], [0, -0.6], 9], [[0.42, 2.6], [0, 2.6], 9]]
    : [[[E, -4.2], [0, -4.2], 10], [[E, -1.8], [0, -1.8], 8], [[E, 1.4], [0, 1.4], 11], [[E, 3.8], [0, 3.8], 8]]),
  tar: (stage) => (stage === 0
    ? [[[-1.62, -4.55], [-2.08, -4.55], 16], [[W, -2.6], [-2.4, -2.6], 6]]
    : [[[-1.62, -4.55], [-2.08, -4.55], 14], [[W, -1.0], [0, -1.0], 9], [[W, 2.2], [0, 2.2], 9]]),
  carrier: (stage) => (stage === 0
    ? [[[1.0, -6.2], [1.0, -7], 4, 'pick'], [[1.72, -4.0], [0, -4.0], 3, 'drop']]
    : [[[1.0, -6.2], [1.0, -7], 4, 'pick'], [[1.72, 0.2], [1.4, 0.2], 3, 'drop']]),
};
const SWING = { shipwright: 0.9, tar: 1.8, carrier: 1.2 };
// Where the carrier goes out of the yard to meet the wagon: past the planks to the gate. He sets
// off CARRIER_LEAD before it comes in, and after the beam is on the stack takes CARRIER_BACK to
// walk back into his round.
const CARRIER_OUT = [[2.05, -6.2], [2.2, -8.3]];
const PILE = [1.0, -6.2];
const CARRIER_LEAD = 24;
const CARRIER_BACK = 14;

function roundOf(stops) {
  const legs = [];
  let t = 0;
  for (let i = 0; i < stops.length; i++) {
    const [at, face, work, act] = stops[i];
    const next = stops[(i + 1) % stops.length][0];
    legs.push({ at, face, from: t, work, walk: dist(at, next) / WALK, next, act });
    t += work + dist(at, next) / WALK;
  }
  return { legs, length: t };
}
// Where a hand is at `t` seconds into their day: `pos`, `face` (a point to face, or null while
// walking), `moving`, and `carrying` for the carrier between the stack and the hull.
export function crewAt(round, t) {
  const u = ((t % round.length) + round.length) % round.length;
  for (const leg of round.legs) {
    if (u < leg.from + leg.work) return { pos: leg.at, face: leg.face, moving: false, act: leg.act, carrying: leg.act === 'drop' };
    if (u < leg.from + leg.work + leg.walk) {
      const k = (u - leg.from - leg.work) / leg.walk;
      return { pos: lerp2(leg.at, leg.next, k), face: null, moving: true, carrying: leg.act === 'pick', dir: headingOf(leg.at, leg.next) };
    }
  }
  const last = round.legs[round.legs.length - 1];
  return { pos: last.next, face: null, moving: false };
}

// ---- looks ------------------------------------------------------------------------------------
const CARTER_LOOK = normalizeAvatar({ skin: 0xe0b08a, tunic: 0x6f7f4a, trim: 0x3e3a26, hat: 0x7a5a32, hatShape: 'wide', equip: { backpack: false } });
const SHIPWRIGHT_BASE = normalizeAvatar({ skin: 0xd9a47c, tunic: 0x3f5a78, trim: 0x2b2a28, hat: 0x3a3f4a, hatShape: 'cap', equip: { backpack: false } });
const SHIPWRIGHT_LOOK = { ...SHIPWRIGHT_BASE, equip: { ...SHIPWRIGHT_BASE.equip, rightHandItem: 'hammer' } };
const TAR_LOOK = normalizeAvatar({ skin: 0xc28e66, tunic: 0x4b4540, trim: 0x201c19, hat: 0x2c2926, hatShape: 'band', equip: { backpack: false } });
const CARRIER_LOOK = normalizeAvatar({ skin: 0xefc39c, tunic: 0xa0643a, trim: 0x4a3322, hat: 0xc9a75c, hatShape: 'cap', equip: { backpack: false } });

const TURN = 8;
function turnTowards(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

export function createTimberRun({ scene, material, groundAt }) {
  const W8 = wagonMeasure();
  const sites = { sawmill: null, yard: null, village: null, terrain: null, sig: '' };
  let plan = null, phase = 0, clock = 0, unloadPose = null;

  // ---- figures ---------------------------------------------------------------------------------
  function figureOf(look, parent) {
    const avatar = createClassicAvatar(look, material);
    avatar.object.scale.x = 1;
    const group = new THREE.Group();
    group.rotation.order = 'YXZ';
    group.scale.setScalar(VILLAGER_SCALE);
    group.add(avatar.object);
    group.visible = false;
    parent.add(group);
    return { avatar, group, pos: [0, 0], yaw: 0, phase: 0, swingAt: 0, carry: null };
  }
  const carter = figureOf(CARTER_LOOK, scene);
  const crew = { shipwright: null, tar: null, carrier: null };
  let crewParent = null;
  let rounds = null, stage = -1;

  // A plank on the carrier's shoulder: one beam of the load, in the figure's own frame (so at
  // the villager's scale), along the way he faces. box() leaves normals to the merge that a
  // building goes through, and unlit by them the beam drew black; and where the shoulder is is
  // read off the rig as it stands, not written down.
  const plankGeo = box(0.07, 0.07, 0.9, 0xcf9f68, { sheet: 'plankZ' });
  plankGeo.computeVertexNormals();
  function shoulderOf(f) {
    // Measured with the figure on its own at the origin, so the box is in its own frame.
    const parent = f.group.parent;
    parent.remove(f.group);
    f.group.position.set(0, 0, 0);
    f.group.updateMatrixWorld(true);
    f.avatar.update({ moving: false, grounded: true, phase: 0 }, 0);
    f.group.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(f.avatar.object);
    parent.add(f.group);
    const k = 1 / VILLAGER_SCALE;
    return { y: (b.min.y + (b.max.y - b.min.y) * 0.88) * k, x: b.max.x * 0.55 * k };
  }

  // ---- the horse and the wagon -----------------------------------------------------------------
  const horse = createAnimal('horse', material, { seed: 'sawmill:drafthorse' });
  if (horse) { horse.object.visible = false; scene.add(horse.object); }
  const wagon = { group: new THREE.Group(), wheels: [], load: null };
  const wagonGeos = [];
  if (W8) {
    const body = mergeParts(meshAsset('prop_wagon', 0xffffff, { skip: (n) => / wheel /.test(n) }));
    wagonGeos.push(body);
    const bodyMesh = new THREE.Mesh(body, material);
    bodyMesh.castShadow = true;
    wagon.group.add(bodyMesh);
    for (const side of ['east', 'west']) {
      const names = models.assetParts('prop_wagon').filter((n) => n.startsWith(`prop_wagon wheel ${side}`));
      const pieces = names.map((n) => mesh(n));
      const g = mergeParts(pieces);
      for (const p of pieces) p.dispose();
      wagonGeos.push(g);
      const w = new THREE.Mesh(g, material);
      w.castShadow = true;
      w.position.set(...models.part(names[0]).at);
      wagon.group.add(w);
      wagon.wheels.push(w);
    }
    const loadGeo = mergeParts(meshAsset('prop_timber', 0xffffff, { y: W8.floorY, z: W8.axleZ }));
    wagonGeos.push(loadGeo);
    wagon.load = new THREE.Mesh(loadGeo, material);
    wagon.load.castShadow = true;
    wagon.group.add(wagon.load);
  }
  wagon.group.rotation.order = 'YXZ';
  wagon.group.visible = false;
  scene.add(wagon.group);

  // ---- the yard's floor --------------------------------------------------------------------------
  // The crew stand on whatever of the yard is under their feet - the bed, the slipway going down
  // to the sea, the plinth - which the bake knows and nothing here should copy. Asked of the
  // yard's own meshes straight down, the highest surface below knee height in the yard's frame,
  // so a beam overhead or the hull beside is not stood on.
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const tmp = new THREE.Vector3();
  const floorCache = new Map();
  function yardFloor(x, z) {
    const key = `${Math.round(x * 20)},${Math.round(z * 20)}`;
    if (floorCache.has(key)) return floorCache.get(key);
    const g = sites.yard.group;
    g.updateMatrixWorld(true);
    const from = g.localToWorld(tmp.set(x, 0.6, z));
    ray.set(from, down);
    ray.far = 4;
    const targets = g.children.filter((c) => c.isMesh);
    let y = 0;
    const hit = ray.intersectObjects(targets, false)[0];
    if (hit) y = g.worldToLocal(hit.point.clone()).y;
    floorCache.set(key, y);
    return y;
  }

  // ---- sites -------------------------------------------------------------------------------------
  function takeDown() {
    for (const f of Object.values(crew)) if (f) { f.group.parent?.remove(f.group); f.avatar.dispose(); }
    crew.shipwright = crew.tar = crew.carrier = null;
    crewParent = null;
    rounds = null;
    stage = -1;
    floorCache.clear();
  }
  function setUp() {
    const { sawmill, yard, village, terrain } = sites;
    plan = null;
    unloadPose = null;
    if (yard) {
      crewParent = yard.group;
      crew.shipwright = figureOf(SHIPWRIGHT_LOOK, crewParent);
      crew.tar = figureOf(TAR_LOOK, crewParent);
      crew.carrier = figureOf(CARRIER_LOOK, crewParent);
      crew.carrier.carry = new THREE.Mesh(plankGeo, material);
      const sh = shoulderOf(crew.carrier);
      crew.carrier.carry.position.set(sh.x, sh.y, 0.05);
      crew.carrier.carry.castShadow = true;
      crew.carrier.carry.visible = false;
      crew.carrier.group.add(crew.carrier.carry);
    }
    if (sawmill && yard && village && terrain && W8 && horse) {
      const size = terrain.size;
      const cells = roadBetween(village, size, sawmill.spec.door, yard.spec.door);
      if (cells) plan = tripPlan(tripLoop(cells.map(([gx, gz]) => terrain.cellWorld(gx, gz))));
      unloadPose = plan ? poseAt(plan.loop.atYard) : null;
      phase = hash32(`timber:${terrain.seed}`) % (plan ? plan.period : TIMBER_EVERY);
    }
  }

  // ---- the frame ---------------------------------------------------------------------------------
  function drawFigure(f, pos, yawWant, moving, dt, y) {
    f.group.visible = true;
    const moved = dist(f.pos, pos);
    f.pos = pos;
    if (yawWant != null) f.yaw = turnTowards(f.yaw, yawWant, Math.min(1, dt * TURN));
    f.group.position.set(pos[0], y, pos[1]);
    f.group.rotation.y = f.yaw;
    f.phase += moved * 18;
    f.avatar.update({ moving, grounded: true, phase: f.phase }, dt);
  }
  const yawTo = (from, to) => Math.atan2(to[0] - from[0], to[1] - from[1]);

  // Where the horse, the axle and the wagon's tail are with the horse at arc length `s`, and
  // which way the wagon points.
  function poseAt(s) {
    const loop = plan.loop;
    const hp = pointAt(loop, s).p, axle = pointAt(loop, s - W8.hitch).p;
    const fwd = headingOf(axle, hp), left = [fwd[1], -fwd[0]];
    const tailZ = W8.tailZ - W8.axleZ - 0.14;
    return {
      hp, axle, fwd, left,
      tail: [axle[0] + fwd[0] * tailZ + left[0] * 0.08, axle[1] + fwd[1] * tailZ + left[1] * 0.08],
      head: [hp[0] + fwd[0] * 0.14 + left[0] * 0.21, hp[1] + fwd[1] * 0.14 + left[1] * 0.21],
    };
  }

  function drawTrip(now, dt, night) {
    if (!plan) { wagon.group.visible = false; if (horse) horse.object.visible = false; carter.group.visible = false; return null; }
    let at = tripAt(plan, now, phase);
    // Nobody sets out after dark; a trip already on the road comes home.
    if (night > DUSK && (at.stage === 'load' || at.stage === 'parked')) at = { ...at, stage: 'parked', s: 0, t: 0 };
    const h = pointAt(plan.loop, at.s + 0.02);
    const { hp, axle, fwd, tail, head } = poseAt(at.s);
    const moving = at.stage === 'out' || at.stage === 'back';

    // The horse.
    horse.object.visible = true;
    horse.yaw = Math.atan2(h.dir[0], h.dir[1]);
    stepPose('horse', horse.pose, { act: moving ? 'walk' : 'still', moving, speed: plan.speed }, dt);
    applyPose(horse, hp[0], groundAt(hp[0], hp[1]), hp[1]);

    // The wagon: its origin is the axle less the axle's own offset, and it leans from the
    // ground under its wheels up to the horse's.
    wagon.group.visible = true;
    const origin = [axle[0] - fwd[0] * W8.axleZ, axle[1] - fwd[1] * W8.axleZ];
    const ya = groundAt(axle[0], axle[1]), yh = groundAt(hp[0], hp[1]);
    wagon.group.position.set(origin[0], ya, origin[1]);
    wagon.group.rotation.set(-Math.atan2(yh - ya, W8.hitch), Math.atan2(fwd[0], fwd[1]), 0);
    const rolled = at.s - W8.hitch;
    for (const w of wagon.wheels) w.rotation.x = rolled / W8.wheelR;
    // Loaded from the end of the loading until the carrier lifts it off at the gate.
    const lifted = at.stage === 'unload' && at.t > 6;
    wagon.load.visible = (at.stage === 'load' && at.t > LOAD_S - TRANS_S) || at.stage === 'out' || (at.stage === 'unload' && !lifted);

    // The carter: at the horse's head on its left, or at the tail while loading and unloading.
    let pos = head, face = null, walking = moving;
    if (at.stage === 'load' || at.stage === 'unload') {
      const len = at.stage === 'load' ? LOAD_S : UNLOAD_S;
      const k = at.t < TRANS_S ? at.t / TRANS_S : at.t > len - TRANS_S ? (len - at.t) / TRANS_S : 1;
      pos = lerp2(head, tail, clamp01(k));
      walking = k > 0 && k < 1;
      face = k >= 1 ? yawTo(pos, axle) : null;
      if (k >= 1 && clock >= carter.swingAt) { carter.avatar.attack('rightArm'); carter.swingAt = clock + 1.3; }
    }
    const yaw = face ?? (walking && !moving ? yawTo(carter.pos, pos) : Math.atan2(fwd[0], fwd[1]));
    drawFigure(carter, pos, yaw, walking, dt, groundAt(pos[0], pos[1]));
    return { at };
  }

  function drawCrew(now, dt, night, trip) {
    const yard = sites.yard;
    if (!yard || !crew.shipwright) return;
    const s = yardStage(yard.spec);
    if (s !== stage) {
      stage = s;
      floorCache.clear();
      rounds = Object.fromEntries(Object.entries(ROUNDS).map(([k, f]) => [k, roundOf(f(s))]));
    }
    // In the shed after dark, like the smith in his house.
    if (night > DUSK) { for (const f of Object.values(crew)) f.group.visible = false; return; }
    const t = now / 1000 + phase;
    for (const [key, f] of Object.entries(crew)) {
      // Each hand's day is offset by its own, so the three do not walk in step.
      let w = crewAt(rounds[key], t + (hash32(`crew:${key}`) % 97));
      let carrying = !!w.carrying;
      if (key === 'carrier' && trip) { const u = unloading(now, trip.at, t); if (u) { w = u; carrying = !!u.carrying; } }
      const face = w.face ? yawTo(w.pos, w.face) : w.dir ? Math.atan2(w.dir[0], w.dir[1]) : (w.moving ? null : f.yaw);
      drawFigure(f, w.pos, face, w.moving, dt, yardFloor(w.pos[0], w.pos[1]));
      if (f.carry) f.carry.visible = carrying;
      if (!w.moving && w.face && (key !== 'carrier' || w.act) && clock >= f.swingAt) {
        f.avatar.attack('rightArm');
        f.swingAt = clock + SWING[key] * (0.8 + 0.4 * ((clock * 7.3) % 1));
      }
    }
  }
  // The carrier and the wagon's stop at the gate. He leaves his round early enough to walk out
  // past the planks to the gate before the wagon comes in (a round can have him at the far end
  // of the hull, ten units off), waits there, takes a beam off its tail, carries it to the
  // stack, and walks back to where his round has him by then - so he never jumps, and never
  // runs. `a` is seconds since the wagon came in.
  function unloading(now, at, t) {
    if (!plan || !unloadPose) return null;
    const arrive = at.start / 1000 + LOAD_S + plan.out;
    const a = now / 1000 - arrive;
    const lead = Math.min(CARRIER_LEAD, LOAD_S + plan.out);
    const end = UNLOAD_S + CARRIER_BACK;
    if (a < -lead || a >= end) return null;
    const g = sites.yard.group;
    const toLocal = (p) => { const v = g.worldToLocal(tmp.set(p[0], 0, p[1])); return [v.x, v.z]; };
    const tailL = toLocal(unloadPose.tail), axleL = toLocal(unloadPose.axle);
    const offsetT = hash32('crew:carrier') % 97;
    const from = crewAt(rounds.carrier, t - (a + lead) + offsetT).pos;
    const to = crewAt(rounds.carrier, t + (end - a) + offsetT).pos;
    const [past, gate] = CARRIER_OUT;
    const along = (pts, k) => {
      const lens = []; let total = 0;
      for (let i = 1; i < pts.length; i++) { lens.push(dist(pts[i - 1], pts[i])); total += lens[lens.length - 1]; }
      let s = clamp01(k) * total;
      for (let i = 0; i < lens.length; i++) { if (s <= lens[i]) return { pos: lerp2(pts[i], pts[i + 1], lens[i] ? s / lens[i] : 0), dir: headingOf(pts[i], pts[i + 1]) }; s -= lens[i]; }
      return { pos: pts[pts.length - 1], dir: headingOf(pts[pts.length - 2], pts[pts.length - 1]) };
    };
    const lengthOf = (pts) => pts.reduce((n, p, i) => (i ? n + dist(pts[i - 1], p) : 0), 0);
    if (a < 0) {
      const out = [from, past, gate];
      const walk = Math.min(lead, lengthOf(out) / WALK);
      const k = (a + lead) / walk;
      if (k < 1) return { ...along(out, k), moving: true };
      return { pos: gate, face: tailL, moving: false };
    }
    if (a < 3) return { ...along([gate, tailL], a / 3), moving: true };
    if (a < 6.5) return { pos: tailL, face: axleL, moving: false, act: 'pick' };
    if (a < 11.5) return { ...along([tailL, gate, past, PILE], (a - 6.5) / 5), moving: true, carrying: true };
    if (a < 12.5) return { pos: PILE, face: [PILE[0], PILE[1] - 1], moving: false, act: 'drop', carrying: true };
    return { ...along([PILE, to], (a - 12.5) / (end - 12.5)), moving: true };
  }

  return {
    // The sawmill and the yard as main.js has them standing, and the roads between them. A
    // layout that moved either takes everything down and puts it up again.
    setSites({ sawmill = null, yard = null, village = null, terrain = null } = {}) {
      const sig = JSON.stringify([sawmill?.spec?.plot, yard?.spec?.plot, yard?.group?.uuid, terrain?.size, village?.paths?.length]);
      Object.assign(sites, { sawmill, yard, village, terrain });
      if (sig === sites.sig) return;
      sites.sig = sig;
      takeDown();
      setUp();
    },
    // `now` is sea time in ms (main.js timeNow).
    update(dt, now) {
      const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
      clock += step;
      const night = nightOf(material);
      const trip = drawTrip(now, step, night);
      drawCrew(now, step, night, trip);
    },
    // One of the yard's hands in world [x, z], for the director (Plans/regisseur.md); null when
    // there is no yard or they are in the shed. Which one turns with the minute, so the camera
    // does not always look at the same man.
    handAt(now) {
      const hands = Object.values(crew).filter((f) => f && f.group.visible);
      if (!hands.length) return null;
      const f = hands[Math.floor(now / 60000) % hands.length];
      const v = f.group.getWorldPosition(new THREE.Vector3());
      return [v.x, v.z];
    },
    // For the dossier and ?timber: what the wagon is doing now.
    stageAt: (now) => (plan ? tripAt(plan, now, phase).stage : null),
    // Where the horse is at `now`, and the trip it is on: for the camera of whoever is looking
    // (and a test), never for drawing.
    where(now) {
      if (!plan) return null;
      const at = tripAt(plan, now, phase);
      return { ...at, horse: pointAt(plan.loop, at.s).p, period: plan.period, length: plan.length, phase };
    },
    // ?timber: the next departure's offset put on `now`, so one starts at once.
    playNow(now) { if (plan) phase = ((now / 1000) % plan.period + plan.period) % plan.period; },
    dispose() {
      takeDown();
      carter.group.parent?.remove(carter.group);
      carter.avatar.dispose();
      if (horse) horse.dispose();
      scene.remove(wagon.group);
      for (const g of wagonGeos) g.dispose();
      plankGeo.dispose();
    },
  };
}
