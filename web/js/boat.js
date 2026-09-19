// A boat you steer, and the one rule that makes the crossing a voyage.
//
// The strip of sea between the two islands is a wall to feet: walk.js:440 refuses any step
// onto ground below 0.06 unless there is a shore within SWIM_REACH, which is what lets you
// wade a stream and what stops you leaving the island (tests/sea-gap.test.mjs holds that
// line over the whole channel). That refusal turned from a limitation into the reason a
// boat exists, so nothing here touches it. A boat is not feet: this file is the exact
// inverse of it. Land is the wall, and the open water is where the hull belongs.
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
import { clamp } from 'shared/rng.mjs';
import { DRAUGHT, DECK_Y } from 'shared/hull.mjs';
import { buildBoatGeometry, mesh } from './buildings.js';
import * as models from './models.js';

export const BOAT_TOP = 9.5;        // 1.44x running (RUN_SPEED 6.6), 5.0x swimming (SWIM_SPEED 1.9)
export const BOAT_REVERSE = 2.8;    // pushing off a beach, not a way to travel - slower than a walk
export const BOAT_ACCEL = 5.0;      // ~2 s to top speed: it is a hull, not a pedal
export const BOAT_DRAG = 0.9;       // let go and it coasts ~4 s to a stop
export const BOAT_TURN = 1.25;      // rad/s at speed
export const BOAT_TURN_MIN = 0.35;  // rad/s at rest - an oar, so you are never stuck
export const BOAT_TURN_BITE = 0.25; // a hard turn spends way: v *= 1 - BITE*|turn|*dt
// The baked hull's one part. One part, so one draw call.
const HULL = 'benchy hull';

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
export function stepBoat(b, { throttle = 0, turn = 0 } = {}, dt, heightAt) {
  if (typeof dt !== 'number' || !Number.isFinite(dt) || dt <= 0) return b;
  const step = Math.min(dt, MAX_STEP);
  const t = axis(throttle);
  const r = axis(turn);

  // ---- the tiller ---------------------------------------------------------------
  // The rudder works on water flowing past it, so the turn tightens with the way on. From
  // an oar's worth at rest up to the full rate by TURN_FULL, which is the speed a hull
  // this size is actually steering at rather than being shoved around at.
  const rate = BOAT_TURN_MIN + (BOAT_TURN - BOAT_TURN_MIN) * Math.min(1, Math.abs(b.v) / TURN_FULL);
  b.yaw -= r * rate * step;
  // Kept inside one turn so a long session cannot walk the yaw out to a number
  // lib/players.mjs clamps (it caps a pose's yaw at 1e4) instead of relaying. One step
  // cannot cover a whole turn, so a pair of ifs is the whole of it - and unlike a modulo
  // it leaves an untouched yaw bit-for-bit alone, which the determinism test cares about.
  if (b.yaw > Math.PI) b.yaw -= TAU;
  else if (b.yaw < -Math.PI) b.yaw += TAU;

  // A hard turn spends way. This is the thing that makes momentum readable: you cannot
  // take the mouth of a bay at nine and a half, and finding that out costs you a second
  // and not a ricochet.
  b.v *= 1 - BOAT_TURN_BITE * Math.abs(r) * step;

  // ---- thrust and drag ----------------------------------------------------------
  // What the throttle is asking for, less what the helm is spending. The second half is an
  // addition to the brief and it earns its place: thrust repays the loss above sixteen
  // times over in the same frame (5.0 u/s² against about 0.04 a frame at top speed), so
  // without a ceiling the tightest turn in the game would cost a boat under power exactly
  // nothing and the hull would corner on rails.
  const want = (t >= 0 ? t * BOAT_TOP : t * BOAT_REVERSE) * (1 - BOAT_TURN_BITE * Math.abs(r));
  const accel = want >= 0 ? BOAT_ACCEL : ASTERN_ACCEL;
  const sameWay = want !== 0 && (b.v === 0 || Math.sign(b.v) === Math.sign(want));
  if (want === 0) {
    // Hands off: the water takes it off, and only the water.
    b.v -= b.v * BOAT_DRAG * step;
  } else if (sameWay) {
    if (Math.abs(b.v) < Math.abs(want)) {
      b.v += Math.sign(want) * accel * step;
      if (Math.abs(b.v) > Math.abs(want)) b.v = want;
    } else {
      // Eased off, but not let go: the water brings you down to the speed being asked for
      // and no further. Running the drag alongside the thrust instead would put the real
      // top speed at BOAT_ACCEL / BOAT_DRAG = 5.6, under a run, and nothing would say so.
      b.v -= b.v * BOAT_DRAG * step;
      if (Math.abs(b.v) < Math.abs(want)) b.v = want;
    }
  } else {
    // Astern with way still on, or ahead while still falling back. The blade and the water
    // pull the same way here, which is why a full stop is a stop and not a long argument.
    b.v -= b.v * BOAT_DRAG * step;
    b.v += Math.sign(want) * accel * step;
  }
  b.v = clamp(b.v, -BOAT_REVERSE, BOAT_TOP);
  if (!t && Math.abs(b.v) < CREEP) b.v = 0;

  // ---- the crossing -------------------------------------------------------------
  if (b.v === 0) return b;   // aground stays as it was: a beached hull is still beached
  const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
  const run = b.v * step;
  const nx = b.x + fx * run, nz = b.z + fz * run;
  // The leading end, which is the stern when you are backing off a beach. Tested at where
  // the hull would be, not where it is, so the bow stops at the water's edge rather than
  // one frame inside it.
  const lead = b.v >= 0 ? BOW : -BOW;
  if (heightAt(nx + fx * lead, nz + fz * lead) < BOAT_FLOAT) {
    b.x = nx;
    b.z = nz;
    b.aground = false;
  } else {
    // Soft, and the way is thrown away with it: a grounding is somewhere you back out of.
    // Sliding along the coast the way walk.js:622 slides along a wall was the first thing
    // tried here, and a boat that follows a shoreline it is pressed against reads as
    // magnetised to the beach rather than stuck on it.
    b.v = 0;
    b.aground = true;
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
export function createBoat({ scene, material }) {
  // The Benchy, if it has been baked; the drawn hull otherwise. The same `models.has` guard
  // barrel() in props.js uses, and for the same reason: a set that is not there yet should
  // leave the island drawing something rather than throwing on the boot path.
  const geometry = models.has(HULL)
    ? mesh(HULL, 0xffffff, { y: -DRAUGHT })
    : buildBoatGeometry();
  const object = new THREE.Mesh(geometry, material);
  object.castShadow = true;   // sailIn's boat does; a hull with no shadow reads as a decal
  scene.add(object);
  let heading = 0;

  return {
    object,

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
      return object.position.y + DECK_Y;
    },

    dispose() {
      scene.remove(object);
      geometry.dispose();
    },
  };
}
