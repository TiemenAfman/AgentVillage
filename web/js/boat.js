// A boat you steer, and what makes the crossing a voyage.
//
// The strip of sea between two islands used to be a wall to feet: walk.js refused any step
// into water with no shore within SWIM_REACH. That trapped anybody who reached open water
// some other way, so a swimmer may now go anywhere - at SWIM_SPEED, a fifth of this hull's
// (tests/boat.test.mjs holds the ratio), which is what leaves a boat worth taking. A boat is
// not feet: land is its wall, and the open water is where the hull belongs.
//
// The two halves of the file share nothing on purpose. `stepBoat` is a pure function of
// the hull, the tiller and the ground under one point - no THREE, no document, no clock -
// which is what lets tests/boat.test.mjs sail a whole crossing under plain Node and check
// that the bow really cannot climb a beach. `createBoat` is the mesh, and knows nothing
// about how it moves.
//
// Yaw is the island's own convention (walk.js:615-617): forward is (sin yaw, cos yaw) and
// the camera's right hand is (-cos yaw, sin yaw), so turning to starboard *lowers* yaw.
// Worth writing down once: getting it backwards steers like a mirror and reads as a bug
// in the keyboard rather than in the sign.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp } from 'shared/rng.mjs';
import { BEACH_MAX } from 'shared/terrain.mjs';
import { DRAUGHT, DECK_Y } from 'shared/hull.mjs';
import { CRAFTS, SHIP_TALL, SHIP_DRAUGHT } from 'shared/crafts.mjs';
import { createSurface } from 'shared/hullwalk.mjs';
import { SHIPWALK } from './shipwalk-map.js';
import { buildBoatGeometry, mesh, box } from './buildings.js';
import * as models from './models.js';

export const BOAT_TOP = 9.5;        // 1.44x running (RUN_SPEED 6.6), 5.0x swimming (SWIM_SPEED 1.9)
export const BOAT_REVERSE = 2.8;    // pushing off a beach, not a way to travel - well below cruising speed
export const BOAT_ACCEL = 5.0;      // ~2 s to top speed: it is a hull, not a pedal
export const BOAT_DRAG = 0.9;       // let go and it coasts ~4 s to a stop
export const BOAT_TURN = 1.25;      // rad/s at speed
export const BOAT_TURN_MIN = 0.35;  // rad/s at rest - an oar, so you are never stuck
export const BOAT_TURN_BITE = 0.25; // a hard turn spends way: v *= 1 - BITE*|turn|*dt
// Shift at the tiller: the top speed and the push to reach it, both times this, for as long
// as the boat's own stamina pool lasts (web/js/stamina.js - four seconds of it). 15.2 at
// full turbo, and the same ~2 s to get there, so it reads as the engine opening up rather
// than a second, twitchier boat. Let go and the water brings you back to BOAT_TOP by the
// ordinary drag, about half a second - the eased-off branch in stepBoat, not a snap.
export const BOAT_TURBO = 1.6;
// The baked hull's one part. One part, so one draw call.
const HULL = 'benchy hull';

// A hull is a reference plane, and whoever stands on it stands on *that*: the transform the hull
// is drawn with this frame, swell and all (pitch and roll about the waterline, not only a rise),
// applied to where they are in the hull's own frame. Anything less puts them beside the planks:
// a hull pitching 0.04 over a deck 1.2 above its pivot moves that deck 0.05 sideways, which the
// walker's own `toWorld` knows nothing of, and on a settler half a unit tall that is feet
// sliding over the boards. The caller poses the hull first (place and bob at this frame's clock)
// so that what it reads here is the very matrix that is drawn.
//
// `hullPointOf` is a point of the hull's frame in the world - `y` above DECK_Y like everything in
// a craft; `hullTiltOf` is the plane's own tilt, the hull's rotation less her heading, so that a
// body's own yaw can be turned about the world's vertical first and tilted with the plane after.
const PLANE_Y = new THREE.Vector3(0, 1, 0);
const planeYaw = new THREE.Quaternion();
export function hullPointOf(b, lx, y, lz, out = new THREE.Vector3()) {
  const o = b.craft && b.craft.object;
  if (!o) {
    // No mesh to read (a test's stand-in): the flat frame, which is what there was before.
    const s = Math.sin(b.yaw), c = Math.cos(b.yaw);
    return out.set(b.x + lx * c + lz * s, DECK_Y + y, b.z - lx * s + lz * c);
  }
  o.updateMatrixWorld();
  return o.localToWorld(out.set(lx, DECK_Y + y, lz));
}
export function hullTiltOf(b, out = new THREE.Quaternion()) {
  const o = b.craft && b.craft.object;
  if (!o) return out.identity();
  o.updateMatrixWorld();
  o.getWorldQuaternion(out);
  return out.multiply(planeYaw.setFromAxisAngle(PLANE_Y, -b.yaw));
}

// How deep she sits, and where a body stands once she is sitting there. In shared/hull.mjs
// because the sea seats a rider without ever drawing one; re-exported here so the call
// sites that think of it as the boat's business can carry on saying so.
export { DRAUGHT, DECK_Y };

// Half the hull, and the whole reason grounding looks right: buildBoatGeometry's hull is a
// 0.8-long cylinder centred on the origin, so this is its tip. Testing the middle instead
// beaches the stern on the way in and the bow on the way out, and you end up halfway up a
// dune with the water still under your waist.
// Half the hull, read off the hull rather than written down beside it. It is the bow that
// is tested against the ground, not the middle, or you beach the stern on the way in and
// the bow on the way out and end up halfway up a dune with the water still round your
// waist - so this number has to follow the model, and a model is re-baked by a script that
// has no idea this file exists.
//
// Measured from the baked positions, which are plain numbers: no THREE, so `stepBoat` stays
// the pure function tests/boat.test.mjs can sail under bare Node. 0.4 is the drawn hull's
// half-length, for an island whose benchy set has not been baked.
function hullReach() {
  const part = models.has(HULL) ? models.part(HULL) : null;
  if (!part) return 0.4;
  let far = 0;
  for (let i = 2; i < part.positions.length; i += 3) far = Math.max(far, Math.abs(part.positions[i]));
  return far;
}
export const BOW = hullReach();

// Where the hull stops floating. The same 0.06 walk.js:440 calls the water's edge, kept
// deliberately identical and pointed the other way: feet refuse everything below it, the
// hull refuses everything above it. The two rules meet in the surf, which is the only
// place you can get into or out of a boat at all - so this number is the gangplank, not
// an incidental threshold.
export const BOAT_FLOAT = 0.06;

// Where the hull stops floating and where it stops *moving* are two different questions,
// and for a long time this file only had the one answer. A grounding threw the way away
// and left you reversing, which is right on a coast you should have stood off from and
// wrong everywhere the water is narrow: the island's own river is a channel between 1.6
// and 3.0 units wide with fifty-six bends in it, and a hull whose bow is tested 0.66 ahead
// of its middle touches a bank on most of them. Fifty-six dead stops is not a voyage.
//
// So a *shoal* - sand, the bank of a stream, the lip of a bar, anything the island itself
// would call beach - is now something the bow shoulders aside: the step is taken one axis
// at a time, the way walk.js:693 slides a settler along a wall, and the way is bled off
// hard while it lasts. Real ground above BEACH_MAX is still the wall it always was, which
// is what keeps the rejected version of this out: a boat that follows *any* shoreline it
// is pressed against reads as magnetised to the beach, and the thing that stopped it being
// that is the ceiling, not the drag.
//
// BEACH_MAX rather than a number of its own, because the island already decides there what
// is sand and what is land, and a second threshold a tenth away from it would be two
// truths about one waterline.
export const BOAT_SCRAPE = BEACH_MAX;

// A ship's side, to a boat. The ground stepBoat is handed knows nothing of a Batavia lying at
// anchor - under her is sea bed - so her hull arrives as blockers that carry `hull`, the height
// of her main deck over the water (shipSolids in buildings.js), and a point inside one of
// those reads that height instead. It is well above BOAT_SCRAPE, so a bow or a probe that
// meets her side stops as it would at a bank, and backs off the same way. No padding: a probe
// is already a point on the boat's own hull, and the Benchy's bow is her tip.
export function hullOver(hulls, x, z, ground) {
  let h = ground;
  for (const b of hulls) {
    if (b.hull > h && Math.abs(x - b.x) < b.hx && Math.abs(z - b.z) < b.hz) h = b.hull;
  }
  return h;
}

// What a scrape costs, per second of it, and the one number here that is not a matter of
// taste. It has to beat the throttle: BOAT_ACCEL against this settles at
// 5.0 / (30 + BOAT_DRAG) = 0.16 u/s, which is under CREEP, so a hull held against a bank
// snaps to a stop inside a tenth of a second and `aground` comes true after all. Anything
// gentler and full ahead into the sand is a sustainable speed - you would grind along the
// whole coast at a walking pace, which is the magnetised boat the paragraph above exists
// to refuse, and tests/circumnavigate.test.mjs would stop being able to find the bar off
// the quay at all. What survives is the glance: half the way per frame of contact, so
// clipping a bend costs you speed and a moment, not the trip.
const SCRAPE_DRAG = 30.0;

// How much way the rudder needs to have its full say. Below this the blade is barely
// biting and you are turning on the oar instead, which is what BOAT_TURN_MIN is.
const TURN_FULL = 4.0;

// Astern thrust. Not a number of its own: the same engine over the same ~2 s, scaled to
// the speed astern is allowed to reach, so backing off a beach pushes weakly (1.47 u/s²)
// rather than merely ending slowly.
const ASTERN_ACCEL = BOAT_ACCEL * (BOAT_REVERSE / BOAT_TOP);

// Below this, way is drift rather than movement - 0.25 u/s is four millimetres a frame -
// and an exponential drag never actually reaches zero. Snapping it shut is what makes
// "let go and it stops" true, and it is the number that makes BOAT_DRAG's ~4 s honest:
// ln(BOAT_TOP / CREEP) / BOAT_DRAG is 4.0 s from full speed.
const CREEP = 0.25;

// The longest slice of time this will integrate in one go. A tab coming back from the
// background hands over a dt of several seconds, and swallowing it whole puts the bow a
// boat's length inside an island before anything is tested. It also keeps a single step
// under half a ground cell at top speed, so the bow can never jump a coastline.
const MAX_STEP = 0.05;
// The same promise at turbo, which is what makes it a distance and not a time: 15.2 u/s
// over 0.05 s is 0.76, past half a cell, so above BOAT_TOP the slice shrinks by the same
// factor the speed grew. At 60 fps (a 0.017 s frame) neither cap is ever reached.
const TURBO_STEP = MAX_STEP / BOAT_TURBO;

const TAU = Math.PI * 2;

// A number from the tiller, or nothing. A key arrives as 1 or 0 and a gamepad axis as a
// float somewhere between; anything else is a caller with a bug, and is taken as hands off
// rather than allowed to put a NaN into the hull's position, which nothing recovers from.
function axis(v) {
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, -1, 1) : 0;
}

// One step of the hull. `b` is { x, z, yaw, v } and is mutated and returned; `heightAt(x, z)`
// is the ground under a world point - terrain.worldHeight, or the archipelago's own height,
// which is OPEN_SEA between the islands. Deterministic for a fixed sequence of dt: no clock,
// no random, and every branch below is arithmetic on what it was handed.
//
// It also sets `b.aground` on every step that tries to move, so the page can say why the
// tiller has gone dead instead of leaving somebody pushing a beached hull at a hill.
//
// `turbo` is whether the pool behind it is open this frame, decided by the caller: the pool
// is page state with a clock in it, and this function stays a function of what it is handed.
// It only lifts the ceiling ahead - astern is for pushing off a beach, at any stamina.
export function stepBoat(b, { throttle = 0, turn = 0, turbo = false } = {}, dt, heightAt) {
  if (typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0) return b;
  const boost = turbo === true;
  const step = Math.min(dt, boost || b.v > BOAT_TOP ? TURBO_STEP : MAX_STEP);
  const t = axis(throttle);
  const r = axis(turn);
  // How this hull handles (shared/crafts.mjs sail); a boat with none is the Benchy.
  const sail = (b.craft && b.craft.spec && b.craft.spec.sail) || null;
  const TOP = sail ? sail.top : BOAT_TOP;
  const top = boost ? TOP * BOAT_TURBO : TOP;
  // What only a heavy hull changes: how hard the water takes the way off, the speed under which
  // it is drift, how much a hard turn costs, the strength of the astern brake. Each falls back to
  // the Benchy's own number, which is what keeps her bit-for-bit what tests/boat.test.mjs sails.
  const DRAG = sail && typeof sail.drag === 'number' ? sail.drag : BOAT_DRAG;
  const creep = sail && typeof sail.creep === 'number' ? sail.creep : CREEP;
  const BITE = sail && typeof sail.bite === 'number' ? sail.bite : BOAT_TURN_BITE;
  const ASTERN = sail && typeof sail.astern === 'number' ? sail.astern : ASTERN_ACCEL;

  // ---- the tiller ---------------------------------------------------------------
  // The rudder works on water flowing past it, so the turn tightens with the way on. From
  // an oar's worth at rest up to the full rate by TURN_FULL, which is the speed a hull
  // this size is actually steering at rather than being shoved around at.
  const TURN = sail ? sail.turn : BOAT_TURN, TURN_MIN = sail ? sail.turnMin : BOAT_TURN_MIN;
  const rate = TURN_MIN + (TURN - TURN_MIN) * Math.min(1, Math.abs(b.v) / TURN_FULL);
  if (sail && sail.yawLag > 0) {
    // A ship does not start turning when the rudder does, and does not stop when it is amidships:
    // the turn rate `b.w` (rad/s, positive is to port like the yaw) is eased towards what the
    // rudder asks for over `yawLag`. Kept on the hull record, which is this page's own.
    const w = b.w || 0;
    b.w = w + (-r * rate - w) * Math.min(1, step / sail.yawLag);
    b.yaw += b.w * step;
  } else b.yaw -= r * rate * step;
  // Kept inside one turn so a long session cannot walk the yaw out to a number
  // lib/players.mjs clamps (it caps a pose's yaw at 1e4) instead of relaying. One step
  // cannot cover a whole turn, so a pair of ifs is the whole of it - and unlike a modulo
  // it leaves an untouched yaw bit-for-bit alone, which the determinism test cares about.
  if (b.yaw > Math.PI) b.yaw -= TAU;
  else if (b.yaw < -Math.PI) b.yaw += TAU;

  // A hard turn spends way. This is the thing that makes momentum readable: you cannot
  // take the mouth of a bay at nine and a half, and finding that out costs you a second
  // and not a ricochet.
  b.v *= 1 - BITE * Math.abs(r) * step;

  // ---- thrust and drag ----------------------------------------------------------
  // What the throttle is asking for, less what the helm is spending. The second half is an
  // addition to the brief and it earns its place: thrust repays the loss above sixteen
  // times over in the same frame (5.0 u/s² against about 0.04 a frame at top speed), so
  // without a ceiling the tightest turn in the game would cost a boat under power exactly
  // nothing and the hull would corner on rails.
  const want = (t >= 0 ? t * top : t * BOAT_REVERSE) * (1 - BITE * Math.abs(r));
  const accel = want >= 0 ? (sail ? sail.accel : BOAT_ACCEL) * (top / TOP) : ASTERN;
  const sameWay = want !== 0 && (b.v === 0 || Math.sign(b.v) === Math.sign(want));
  if (want === 0) {
    // Hands off: the water takes it off, and only the water.
    b.v -= b.v * DRAG * step;
  } else if (sameWay) {
    if (Math.abs(b.v) < Math.abs(want)) {
      b.v += Math.sign(want) * accel * step;
      if (Math.abs(b.v) > Math.abs(want)) b.v = want;
    } else {
      // Eased off, but not let go: the water brings you down to the speed being asked for
      // and no further. Running the drag alongside the thrust instead would put the real
      // top speed at BOAT_ACCEL / BOAT_DRAG = 5.6, under a run, and nothing would say so.
      b.v -= b.v * DRAG * step;
      if (Math.abs(b.v) < Math.abs(want)) b.v = want;
    }
  } else {
    // Astern with way still on, or ahead while still falling back. The blade and the water
    // pull the same way here, which is why a full stop is a stop and not a long argument.
    b.v -= b.v * DRAG * step;
    b.v += Math.sign(want) * accel * step;
  }
  // The turbo ceiling whether or not the turbo is on this frame: the frame it runs out, the
  // hull is still doing fifteen, and clamping to BOAT_TOP here would stop it dead at 9.5 in
  // one step instead of letting the drag above ease it down.
  b.v = clamp(b.v, -BOAT_REVERSE, TOP * BOAT_TURBO);
  if (!t && Math.abs(b.v) < creep) b.v = 0;

  // ---- the crossing -------------------------------------------------------------
  if (b.v === 0) return b;   // aground stays as it was: a beached hull is still beached
  const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
  const run = b.v * step;
  const nx = b.x + fx * run, nz = b.z + fz * run;
  // The leading end, which is the stern when you are backing off a beach. Tested at where
  // the hull would be, not where it is, so the bow stops at the water's edge rather than
  // one frame inside it.
  const lead = b.v >= 0 ? BOW : -BOW;
  // Where the bow would be if the hull stood at (x, z). The heading does not change below
  // this line, so the offset is fixed and the whole of the test is this one point.
  // A big hull is tested at its bow and shoulders (sail.probes, mirrored astern when backing),
  // the highest ground under any of them - a bow point alone let a galleon lie half in the dunes.
  const probes = sail && sail.probes;
  const bow = probes
    ? (x, z) => {
      let high = -Infinity;
      for (const [px, pz0] of probes) {
        const pz = b.v >= 0 ? pz0 : -pz0;
        high = Math.max(high, heightAt(x + px * fz + pz * fx, z - px * fx + pz * fz));
      }
      return high;
    }
    : (x, z) => heightAt(x + fx * lead, z + fz * lead);
  const touched = bow(nx, nz);
  if (touched < BOAT_FLOAT) {
    b.x = nx;
    b.z = nz;
    b.aground = false;
    b.scraping = false;
  } else if (touched < BOAT_SCRAPE) {
    // A shoal. Take what is left of the step one axis at a time, so the hull shoulders
    // along the bank instead of stopping on it - and test each half at the bow as well,
    // or the slide is a licence to walk the boat up a beach sideways. Diagonally is
    // deliberately not tried again: if neither axis is clear the bow is in a corner, and
    // a corner is a stop.
    if (bow(nx, b.z) < BOAT_FLOAT) b.x = nx;
    else if (bow(b.x, nz) < BOAT_FLOAT) b.z = nz;
    // The way goes whether the hull moved or not. Scraping is expensive by the second and
    // not by the metre: sitting in the sand with the throttle open is the same crawl as
    // grinding along it, which is what makes "back off and come round again" the quick way
    // out of both.
    b.v -= b.v * SCRAPE_DRAG * step;
    if (Math.abs(b.v) < creep) b.v = 0;
    b.aground = b.v === 0;
    b.scraping = true;
  } else {
    // Land. Hard, and the way is thrown away with it: a grounding is somewhere you back
    // out of. This is the wall the shoal above is deliberately not, and the two are told
    // apart by the height of what the bow found and nothing else.
    b.v = 0;
    b.aground = true;
    b.scraping = false;
  }
  return b;
}

// ---------------------------------------------------------------------------------
// The mesh. buildBoatGeometry is the hull sailIn already brings a settler ashore in, drawn
// with the shared building material, so a boat on the water is one more draw call and no
// new art, no loader and nothing fetched at boot.
//
// The hull rides with its middle on the water plane - y = 0, the sea in world.js, which is
// what sailIn does - so the bottom half is under the surface where it belongs. DECK_Y is
// where a body stands above that, and because the hull bobs, a rider's feet are `deck()`
// and not DECK_Y.
const BOB_RISE = 0.03;    // sailIn's own numbers, for the same feel: a hull at anchor is
const BOB_PITCH = 0.04;   // never quite still, and a boat that is reads as a prop
const BOB_ROLL = 0.03;
// The pirate ship (scripts/build-pirateship.py, Greggory_Fisher's model, CC-BY-4.0): baked keel
// on y = 0 like the Benchy, its waterline and main deck read off the source's own proportions
// (7 and 12.55 of 58.56 up, the bake's SHIP_TALL). Every island's first boat is one
// (shared/crafts.mjs kindOf), laid in deep water off its berth (main.js shipBerth).
const SHIP = 'pirateship hull';
// SHIP_TALL and SHIP_DRAUGHT are shared/crafts.mjs's, because the walk map is cut from the hull where
// she floats and has to agree.
// The wheel, on the quarterdeck two units abaft the middle: measured by the bake's own
// downward rays (build-pirateship.py prints the deck heights, 1.631 above the keel there).
// In the hull's frame, +z forward. The pilot stands here rather than on the middle of the
// hull, which on a ship this size is the foot of the main mast.
// The ship's walking surface, cut from her model (scripts/build-shipwalk.mjs): what a body on her deck
// stands on and walks into. One for every ship, since every ship is the same hull.
export const SHIP_SURFACE = createSurface(SHIPWALK);
// The wheel stands on a round plinth of three tiers that the model has 0.2 over the quarterdeck, and the
// pilot stands on top of it, not in it: asked of the model, since it is the model that has the plinth.
const HELM_AT = [0, -3.2];
const SHIP_HELM = { x: HELM_AT[0], y: (SHIP_SURFACE.floorIn(HELM_AT[0], HELM_AT[1], 1.9) ?? 1.738) + DECK_Y, z: HELM_AT[1] };

// The rope ladders (craft.ladders, shared/crafts.mjs) as boxes, from the same numbers the
// climb follows: two ropes from the bulwark to under the water, rungs across them, and the
// ropes taken in over the rail to where they are made fast. Made of boxes rather than baked:
// there is nothing to model in a rope, and drawn from the craft's own numbers a ladder cannot
// drift from the one you climb. Merged into the hull's geometry, so a ship with two of them is
// still one draw call. `y` is above DECK_Y, like everything in the craft.
const ROPE = 0x9c7f52, RUNG = 0x6e4d2b;
const ROPE_W = 0.05, RUNG_H = 0.045, RUNG_STEP = 0.2;
function ladderBoxes(spec) {
  const out = [];
  for (const l of spec.ladders || []) {
    const s = l.x < 0 ? -1 : 1;
    const foot = DECK_Y + l.foot, top = DECK_Y + l.top;
    const inward = Math.abs(l.x) - 0.6;
    for (const side of [-1, 1]) {
      const z = l.z + side * l.hw;
      out.push(box(ROPE_W, top - foot, ROPE_W, ROPE, { x: l.x, y: foot, z }));
      // Over the bulwark and down its inside face a little, where the ropes are belayed.
      out.push(box(Math.abs(l.x) - inward, ROPE_W, ROPE_W, ROPE, { x: s * (inward + Math.abs(l.x)) / 2, y: top, z }));
    }
    for (let y = foot + 0.15; y < top - 0.1; y += RUNG_STEP) {
      out.push(box(ROPE_W + 0.02, RUNG_H, 2 * l.hw + ROPE_W, RUNG, { x: l.x, y, z: l.z }));
    }
  }
  return out;
}

// The hull with its ladders hung on it. Both are the same attribute layout (position, colour,
// emissive - no sheet, no normals), which is what lets them weld into one geometry.
function withLadders(hull, spec) {
  const boxes = ladderBoxes(spec);
  if (!boxes.length) return hull;
  const merged = mergeGeometries([hull, ...boxes], false);
  hull.dispose();
  for (const b of boxes) b.dispose();
  return merged;
}

export function createBoat({ scene, material, kind = 'benchy' }) {
  const ship = kind === 'ship' && models.has(SHIP);
  // The Benchy, if it has been baked; the drawn hull otherwise. The same `models.has` guard
  // barrel() in props.js uses, and for the same reason: a set that is not there yet should
  // leave the island drawing something rather than throwing on the boot path.
  const geometry = ship ? withLadders(mesh(SHIP, 0xffffff, { y: -SHIP_DRAUGHT }), CRAFTS.galleon) : models.has(HULL)
    ? mesh(HULL, 0xffffff, { y: -DRAUGHT })
    : buildBoatGeometry();
  const object = new THREE.Mesh(geometry, material);
  object.castShadow = true;   // sailIn's boat does; a hull with no shadow reads as a decal
  scene.add(object);
  let heading = 0;

  return {
    object,
    // Where the pilot stands in the hull's frame (null: the middle), how far back the camera
    // sits aboard, as a multiple of walk mode's own, and half the beam, for going over the side.
    helm: ship ? SHIP_HELM : null,
    spec: ship ? CRAFTS.galleon : CRAFTS.benchy,
    // What a body on her deck walks on and into (shared/hullwalk.mjs); the Benchy has none, since her
    // whole deck is her helm.
    walk: ship ? SHIP_SURFACE : null,
    camScale: ship ? 10 : 2.2,
    beam: ship ? 3.5 : 0.35,

    // Where it floats and which way it is pointed. The y is left to `bob`, so placing a
    // boat never fights the swell it is sitting on.
    place(x, z, yaw = heading) {
      heading = yaw;
      object.position.x = x;
      object.position.z = z;
      object.rotation.y = yaw;
    },

    // The swell, from the island's own clock. Nothing here is per-boat: two boats at one
    // jetty rising together is what a jetty looks like.
    bob(time) {
      const t = Number.isFinite(time) ? time : 0;
      // The hull is baked with its keel on y = 0 and dropped by DRAUGHT in the geometry, so
      // the swell rides on top of that rather than replacing it.
      object.position.y = BOB_RISE * Math.sin(t * 2);
      object.rotation.set(BOB_PITCH * Math.sin(t * 1.7), heading, BOB_ROLL * Math.sin(t * 1.3));
    },

    // Where a body standing in it has its feet, swell and all.
    deck() {
      return object.position.y + (ship ? SHIP_HELM.y : DECK_Y);
    },

    dispose() {
      scene.remove(object);
      geometry.dispose();
    },
  };
}
