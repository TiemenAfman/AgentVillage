// A bicycle you ride, and what makes it a bicycle rather than fast feet.
//
// Laid out like boat.js, and for the same reason: `stepBike` is a pure function of the bike,
// the pedals and the ground - no THREE, no document, no clock - so tests/bicycle.test.mjs can
// ride it under plain Node and check that it really stops at the water; `createBicycle` is
// the mesh, and knows nothing about how it moves. Plans/fiets.md has the decisions.
//
// The feet's world, not the hull's: land is where it goes, the water's edge is its wall, and
// whatever walk.js's `blocked` calls solid (a wall, a stall, a person) is solid to it too.
// It is handed that test rather than learning it, the way the boat is handed the height.
//
// Yaw is the island's convention (see boat.js): forward is (sin yaw, cos yaw), and turning
// to the right *lowers* yaw.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp } from 'shared/rng.mjs';
import { mesh } from './buildings.js';
import * as models from './models.js';

// A little over a run (RUN_SPEED 6.6, tests/bicycle.test.mjs reads it out of walk.js) and
// under a boat (9.5): the island is small, and a bike that crosses it in four seconds turns
// every hamlet into a blur. Shift is standing on the pedals, paid for out of the body's own
// pool, exactly as a run is.
export const BIKE_TOP = 8.0;
export const BIKE_TURBO = 1.3;       // 10.4 standing up
export const BIKE_ACCEL = 4.5;       // ~1.8 s to cruising speed: legs, not an engine
export const BIKE_BRAKE = 14.0;      // S with way on is the brakes: ~0.6 s from top speed
export const BIKE_ROLL = 0.45;       // let go and it freewheels a few seconds before it stops
export const BIKE_REVERSE = 1.4;     // S at a standstill walks it backwards, slower than a walk
export const BIKE_TURN = 2.4;        // rad/s at speed
export const BIKE_TURN_MIN = 1.1;    // rad/s at rest: you shuffle it round with your feet down
// A hill does something. Downhill it runs away with you a little and uphill it slows you,
// by this much acceleration per unit of grade - a quarter of what gravity would, because
// the island's slopes are steep and a real one would stop you dead on the first dune.
const SLOPE_PULL = 2.5;
// The water's edge, the same 0.06 walk.js calls the shore: a tyre will run on wet sand and
// not into the sea. BOAT_FLOAT in boat.js is this same number pointed the other way.
export const BIKE_SHORE = 0.06;
// The highest ledge it rolls up without a jump: walk.js's STEP_UP, so a bridge you walk
// onto is a bridge you ride onto and a storey is still a wall.
const STEP_UP = 0.45;
// Space is a hop: walk.js's own jump (JUMP_V, GRAVITY - tests/bicycle.test.mjs reads both out
// of it), so the bike leaves the ground exactly as high as the feet do, about 0.38. In the air
// the pedals push nothing, the bars still turn, and a ledge is measured from where the tyres
// are rather than from the road - which is what lets a hop take you up a kerb a plain ride
// would stop at, or over a brook. Coming down in the water ends the ride (`splash`).
export const BIKE_HOP = 3.1;
export const BIKE_GRAVITY = 12.5;
// How far the frame tips nose up on the way up and nose down on the way down, per unit of
// vertical speed: a hop you can see, not a lift.
const HOP_PITCH = 0.07;
// How much way the handlebars need before they have their full say.
const TURN_FULL = 3.0;
// A hard turn spends way, less than a hull's (0.25) - a bicycle corners.
const TURN_BITE = 0.12;
// What riding into something costs: a glancing touch you slide along, per second of it,
// and a head-on stop, which throws the way away.
const SCRAPE_DRAG = 6.0;
const CREEP = 0.08;
// The same promise boat.js makes: a tab back from the background hands over seconds, and
// one slice never covers more than half a cell, so a wall can never be jumped.
const MAX_STEP = 0.04;
// How far the bars turn, at rest and at speed. A real bicycle at speed is steered by leaning
// and the bars barely move; drawn that way, you would not see the turn at all at this size.
const STEER_REST = 0.55;
const STEER_FAST = 0.22;
const STEER_RATE = 10;
// Into the corner, at most this far over.
const LEAN = 0.3;
// Wheel turns per crank turn. Only matters for how fast the legs go round, and it is high on
// purpose: the island's speeds are huge next to a figure this size (a cruise is 84 rad/s at
// the wheel), and a crank at a true gear would spin faster than a leg can be drawn.
const GEAR = 4.5;

const TAU = Math.PI * 2;

// The baked parts. bicycle.js hangs each on the pivot Blender gave it (scripts/build-bicycle.py
// puts every origin on its own axis), so nothing below says where an axle is.
const PART = {
  frame: 'bicycle frame',
  rear: 'bicycle wheel rear',
  front: 'bicycle wheel front',
  steer: 'bicycle steer',
  crank: 'bicycle crank',
  pedalL: 'bicycle pedal left',
  pedalR: 'bicycle pedal right',
};

// Every baked slot of one part: an object with three materials bakes as `name:0` .. `name:2`.
function slotsOf(name) {
  return models.assetParts('bicycle').filter((n) => n === name || n.startsWith(name + ':'));
}

// Plain numbers from the baked module, so `stepBike` and the rider's pose can use them under
// Node without a THREE in sight. The fallbacks are the builder's own numbers, for an island
// whose bicycle set has not been baked.
function measure() {
  const at = (name) => models.part(slotsOf(name)[0])?.at;
  if (!models.hasAsset('bicycle') || !at(PART.frame)) {
    return { tyre: 0.095, rear: [0, 0.095, -0.165], front: [0, 0.095, 0.152], steer: [0, 0.212, 0.109],
      crank: [0, 0.074, -0.018], pedalL: [-0.06, 0.11, -0.018], pedalR: [0.06, 0.038, -0.018],
      saddle: [0, 0.23, -0.07], grip: [0.1, 0.27, 0.12], baked: false };
  }
  // The tyre's radius is the rear wheel's farthest point from its own axle in y.
  let tyre = 0;
  for (const n of slotsOf(PART.rear)) {
    const p = models.part(n).positions;
    for (let i = 1; i < p.length; i += 3) tyre = Math.max(tyre, Math.abs(p[i]));
  }
  // The saddle is the highest point of the frame behind the bottom bracket, and a grip the
  // outermost point of the bars; both in the bike's own frame.
  const frame = at(PART.frame), crank = at(PART.crank);
  const saddle = [0, -Infinity, 0];
  for (const n of slotsOf(PART.frame)) {
    const p = models.part(n).positions;
    for (let i = 0; i < p.length; i += 3) {
      const z = p[i + 2] + frame[2];
      if (z < crank[2] && p[i + 1] + frame[1] > saddle[1]) { saddle[1] = p[i + 1] + frame[1]; saddle[2] = z; }
    }
  }
  const steer = at(PART.steer), grip = [0, 0, 0];
  for (const n of slotsOf(PART.steer)) {
    const p = models.part(n).positions;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i] > grip[0]) { grip[0] = p[i]; grip[1] = p[i + 1] + steer[1]; grip[2] = p[i + 2] + steer[2]; }
    }
  }
  return { tyre, rear: at(PART.rear), front: at(PART.front), steer, crank,
    pedalL: at(PART.pedalL), pedalR: at(PART.pedalR), saddle, grip, baked: true };
}
export const GEOMETRY = measure();

// A number from the pedals or the bars, or nothing: the same guard boat.js keeps, since a NaN
// in a position is something nothing recovers from.
function axis(v) {
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, -1, 1) : 0;
}

const damp = (from, to, rate, dt) => to + (from - to) * Math.exp(-rate * dt);

// A bike at (x, z) facing `yaw`, standing still. The rest is what `stepBike` keeps: the way
// on (`v`), and the three angles the mesh is drawn with.
export function bikeAt(x, z, yaw = 0, y = 0) {
  return { x, y, z, yaw, v: 0, steer: 0, lean: 0, wheel: 0, crank: 0, bumped: false,
    vy: 0, air: false, floor: y, pitch: 0, splash: false };
}

// One step of the bike. `b` is mutated and returned. `ground(x, z)` is the height underfoot
// at a world point, asked from the bike's own height (walk.js's groundAt, so decks and
// bridges carry it); `blocked(x, z)` is walk.js's own solid test. Deterministic for a fixed
// sequence of dt, and `turbo` is decided by the caller, whose pool has the clock in it.
// `hop` is a press, not a hold: taken once, and only with both tyres down. `ceiling(x, z)` is
// the highest the bike may rise there (a deck overhead, less the rider's head), or omitted for
// the open sky.
export function stepBike(b, { pedal = 0, turn = 0, turbo = false, hop = false } = {}, dt,
  { ground, blocked = () => false, ceiling = null } = {}) {
  if (typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0 || typeof ground !== 'function') return b;
  if (hop === true && !b.air && !b.splash) { b.vy = BIKE_HOP; b.air = true; b.floor = b.y; }
  let left = dt;
  while (left > 1e-9 && !b.splash) {
    const step = Math.min(left, MAX_STEP);
    left -= step;
    slice(b, axis(pedal), axis(turn), turbo === true, step, ground, blocked, ceiling);
  }
  return b;
}

function slice(b, p, r, boost, step, ground, blocked, ceiling) {
  const top = boost ? BIKE_TOP * BIKE_TURBO : BIKE_TOP;
  const speed = Math.abs(b.v);

  // ---- the bars ------------------------------------------------------------------
  const reach = STEER_REST + (STEER_FAST - STEER_REST) * Math.min(1, speed / BIKE_TOP);
  b.steer = damp(b.steer, r * reach, STEER_RATE, step);
  b.lean = damp(b.lean, r * LEAN * Math.min(1, speed / TURN_FULL), 6, step);
  const rate = BIKE_TURN_MIN + (BIKE_TURN - BIKE_TURN_MIN) * Math.min(1, speed / TURN_FULL);
  // Backwards, the bars steer the other way round, as they do on anything with a front wheel.
  b.yaw -= r * rate * step * (b.v < -CREEP ? -1 : 1);
  if (b.yaw > Math.PI) b.yaw -= TAU;
  else if (b.yaw < -Math.PI) b.yaw += TAU;
  b.v *= 1 - TURN_BITE * Math.abs(r) * step;

  // ---- the pedals and the brakes -------------------------------------------------
  // Only with the tyres on something: in the air the way is whatever it was at take-off.
  const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
  if (b.air) {
    // nothing to push against
  } else if (p > 0) {
    const want = p * top;
    if (b.v < want) b.v = Math.min(want, b.v + BIKE_ACCEL * (top / BIKE_TOP) * step);
    // Eased off, or the turbo ran out: freewheel down to what the legs are still asking for.
    else b.v = Math.max(want, b.v - b.v * BIKE_ROLL * 3 * step);
  } else if (p < 0) {
    // With way on, S is the brakes - to a stop and no further in that frame; held at a
    // standstill it walks the bike backwards.
    if (b.v > 0) b.v = Math.max(0, b.v - BIKE_BRAKE * -p * step);
    else b.v = Math.max(p * BIKE_REVERSE, b.v - BIKE_ACCEL * step);
  } else {
    b.v -= b.v * BIKE_ROLL * step;
  }
  // The hill, measured along the heading half a wheel ahead and behind.
  if (b.v !== 0 && !b.air) {
    const d = 0.1;
    const grade = (ground(b.x + fx * d, b.z + fz * d) - ground(b.x - fx * d, b.z - fz * d)) / (2 * d);
    b.v -= clamp(grade, -1.5, 1.5) * SLOPE_PULL * step;
  }
  b.v = clamp(b.v, -BIKE_REVERSE, BIKE_TOP * BIKE_TURBO);
  if (!p && !b.air && Math.abs(b.v) < CREEP) b.v = 0;

  // ---- the ride ------------------------------------------------------------------
  b.bumped = false;
  if (b.v !== 0) {
    const run = b.v * step;
    const nx = b.x + fx * run, nz = b.z + fz * run;
    const here = b.y;
    // Somewhere a tyre can be: dry, not solid, and not a wall of a ledge. In the air, water
    // is no wall - it is what a hop clears - and the ledge is measured from the tyres.
    const rideable = (x, z) => {
      const h = ground(x, z);
      return (b.air || h >= BIKE_SHORE) && h - here <= STEP_UP && !blocked(x, z);
    };
    if (rideable(nx, nz)) {
      b.x = nx; b.z = nz;
    } else {
      // Along the wall, one axis at a time, the way the feet slide; the way bleeds off while
      // it lasts. Neither axis clear is a head-on stop.
      // An axis the step does not move along is no slide: ridden square into the sea, "along
      // z alone" is simply standing still with the pedals going.
      b.bumped = true;
      if (Math.abs(nx - b.x) > 1e-4 && rideable(nx, b.z)) b.x = nx;
      else if (Math.abs(nz - b.z) > 1e-4 && rideable(b.x, nz)) b.z = nz;
      else b.v = 0;
      b.v -= b.v * SCRAPE_DRAG * step;
      if (Math.abs(b.v) < CREEP) b.v = 0;
    }
    if (!b.air) b.y = ground(b.x, b.z);
  }

  // ---- up and down ---------------------------------------------------------------
  if (b.air) {
    b.vy -= BIKE_GRAVITY * step;
    b.y += b.vy * step;
    // The rider's head against a deck overhead: the hop stops rising there, as a jump does.
    const lid = b.vy > 0 && ceiling ? ceiling(b.x, b.z) : Infinity;
    if (b.y > lid) { b.y = lid; b.vy = 0; }
    const under = ground(b.x, b.z);
    if (b.vy <= 0 && b.y <= under) {
      b.y = under;
      b.vy = 0;
      b.air = false;
      b.floor = under;
      // Landed in the water: there is no riding on from there. walk.js puts the bike away and
      // leaves a swimmer where it came down.
      if (under < BIKE_SHORE) { b.splash = true; b.v = 0; }
    }
  } else {
    b.floor = b.y;
  }
  b.pitch = b.air ? clamp(b.vy * HOP_PITCH, -0.3, 0.3) : damp(b.pitch, 0, 12, step);

  // ---- what turns ----------------------------------------------------------------
  const rolled = b.v * step / GEOMETRY.tyre;
  b.wheel = (b.wheel + rolled) % TAU;
  // Freewheeling leaves the crank where it is; pedalling turns it with the wheel.
  if (p > 0 && b.v > 0) b.crank = (b.crank + rolled / GEAR) % TAU;
}

// ---------------------------------------------------------------------------------
// The mesh: seven baked parts, each on its own pivot, drawn with the shared building
// material - one more draw call per part and no new art. `place` puts it on the ground and
// `pose` turns the wheels, the crank and the bars; neither knows anything about stepBike.
//
// The steering axis is the line through the steer part's origin and the front axle - the
// builder runs the fork legs down it - so the head angle is read off two baked origins here
// rather than written down a second time.
export function createBicycle({ scene, material }) {
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';        // yaw first, then the lean about the bike's own forward
  const meshes = [];
  const partMesh = (name, parent, at) => {
    const names = slotsOf(name);
    if (!names.length) return null;
    const geometry = names.length === 1 ? mesh(names[0]) : mergeGeometries(names.map((n) => mesh(n)), false);
    const m = new THREE.Mesh(geometry, material);
    m.castShadow = true;
    const pivot = new THREE.Group();
    pivot.position.set(...at);
    pivot.add(m);
    parent.add(pivot);
    meshes.push(m);
    return pivot;
  };
  const G = GEOMETRY;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  partMesh(PART.frame, root, [0, 0, 0]);
  const rear = partMesh(PART.rear, root, G.rear);
  const crank = partMesh(PART.crank, root, G.crank);
  const steer = partMesh(PART.steer, root, G.steer);
  const front = steer && partMesh(PART.front, steer, sub(G.front, G.steer));
  const pedalL = partMesh(PART.pedalL, root, G.pedalL);
  const pedalR = partMesh(PART.pedalR, root, G.pedalR);
  const steerAxis = new THREE.Vector3(...sub(G.front, G.steer)).normalize();
  // Each pedal's spindle as an offset from the crank axle, turned with the crank every frame.
  const armL = sub(G.pedalL, G.crank), armR = sub(G.pedalR, G.crank);
  scene.add(root);

  const turnArm = (pivot, arm, a) => {
    if (!pivot) return;
    const c = Math.cos(a), s = Math.sin(a);
    // About +x: y goes to z, the same sense the wheels roll forward in.
    pivot.position.set(G.crank[0] + arm[0], G.crank[1] + arm[1] * c - arm[2] * s, G.crank[2] + arm[1] * s + arm[2] * c);
  };

  return {
    object: root,
    place(x, y, z, yaw) {
      root.position.set(x, y, z);
      root.rotation.y = yaw;
    },
    pose({ wheel = 0, crank: turned = 0, steer: bars = 0, lean = 0, pitch = 0 } = {}) {
      root.rotation.z = lean;
      root.rotation.x = -pitch;        // positive pitch is nose up: +x rotation tips the front down
      if (rear) rear.rotation.x = wheel;
      if (front) front.rotation.x = wheel;
      if (crank) crank.rotation.x = turned;
      // The axis points down the steerer, so a positive turn about it turns the front wheel to
      // the right (-x), which is what a positive `steer` means.
      if (steer) steer.quaternion.setFromAxisAngle(steerAxis, bars);
      turnArm(pedalL, armL, turned);
      turnArm(pedalR, armR, turned);
    },
    set visible(on) { root.visible = on; },
    get visible() { return root.visible; },
    dispose() {
      scene.remove(root);
      for (const m of meshes) m.geometry.dispose();
    },
  };
}

// Where the rider goes, in the bike's own frame: the hips on the saddle, and how far the arms
// have to reach forward and down for the grips. classic-avatar.js poses the limbs from these.
export const RIDER = {
  saddle: GEOMETRY.saddle,
  grip: GEOMETRY.grip,
  crank: GEOMETRY.crank,
};
