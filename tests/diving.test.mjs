// Diving (web/js/diving.js + its place in walk.js, Plans/onderwater-zwemmen.md).
//
// Three promises. A body can go under and come back up: it sinks while asked to, hangs when
// not, stops on the sand, and is put back at the very height a swimmer floats at when it
// surfaces, so the two modes meet without a step. It keeps to the world: a deck over its head
// stops a rise, the shallows lift it out rather than snap it, and there has to be water to sink
// into. And the camera follows it under the surface without hanging over it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  stepDive, canDive, headUnder, divePitch, SWIM_PITCH,
  DIVE_SPEED, DIVE_TURBO, BOTTOM_SPEED, DIVE_DOWN, DIVE_UP, DIVE_HEAD, DIVE_MIN_WATER, BED_CLEAR, SHALLOW,
} from '../web/js/diving.js';
import { cameraFloor, applyCeiling, WATER_CAM_MIN, WATER_CAM_MAX, BED_CLEAR as CAM_BED_CLEAR } from '../web/js/camera-floor.js';

const FRAME = 1 / 60;
const SINK = 0.07;
const REST = -SINK;
const DEEP = { bed: -2.5, surface: 0, sink: SINK };

// The feet's numbers, read out of walk.js rather than copied (tests/boat.test.mjs says why).
const WALK = readFileSync(new URL('../web/js/walk.js', import.meta.url), 'utf8');
const feet = (name) => Number(WALK.match(new RegExp(`^const ${name} = ([0-9.]+);`, 'm'))[1]);
const SWIM_SPEED = feet('SWIM_SPEED');
const SWIM_TURBO = feet('SWIM_TURBO');
const WALK_SPEED = feet('WALK_SPEED');

function dive(d, rise, seconds, world = DEEP) {
  let r = { ...d, onBed: false, surfaced: false };
  for (let i = 0; i < Math.round(seconds / FRAME); i++) {
    r = stepDive({ y: r.y, vy: r.vy }, rise, FRAME, world);
    if (r.surfaced) break;
  }
  return r;
}
const start = () => ({ y: REST, vy: -0.3 });

// ---- going down and coming up -------------------------------------------------------------

test('asked to go down, a body sinks at DIVE_DOWN and stops on the sand', () => {
  const mid = dive(start(), -1, 0.6);
  assert.ok(mid.y < REST - 0.4, `after 0.6 s it is only at ${mid.y}`);
  assert.ok(mid.vy < 0 && mid.vy >= -DIVE_DOWN - 1e-9, `sinking at ${mid.vy}`);

  const bottom = dive(start(), -1, 5);
  assert.ok(Math.abs(bottom.y - (DEEP.bed + BED_CLEAR)) < 1e-9, `rests at ${bottom.y}, not on the bed`);
  assert.equal(bottom.onBed, true);
  assert.equal(bottom.vy, 0);
});

test('asked to go up, it climbs faster than it sinks, and surfaces at the swimmer\'s own height', () => {
  assert.ok(DIVE_UP > DIVE_DOWN);
  const down = dive(start(), -1, 5);
  const up = dive({ y: down.y, vy: 0 }, +1, 5);
  assert.equal(up.surfaced, true);
  // The very height walk.js floats a swimmer at, so ending dive mode is not a step.
  assert.equal(up.y, REST);
  assert.equal(up.vy, 0);
});

test('let go of both keys and it hangs in the water, coasting to a stop', () => {
  const sunk = dive(start(), -1, 0.5);
  const hang = dive(sunk, 0, 2);
  assert.ok(Math.abs(hang.vy) < 0.01, `still moving at ${hang.vy}`);
  // It stopped somewhere in the water, not on the bed and not at the top.
  assert.ok(hang.y < REST && hang.y > DEEP.bed + 0.3, `hangs at ${hang.y}`);
  assert.equal(hang.onBed, false);
});

test('a body asked to go down while resting on the sand stays there', () => {
  const on = dive(start(), -1, 5);
  const again = dive({ y: on.y, vy: 0 }, -1, 1);
  assert.equal(again.y, on.y);
  assert.equal(again.onBed, true);
});

// ---- the world ----------------------------------------------------------------------------

test('there has to be water to sink into', () => {
  assert.equal(canDive(-2.5), true);
  assert.equal(canDive(-(DIVE_MIN_WATER + 0.01)), true);
  assert.equal(canDive(-(DIVE_MIN_WATER - 0.01)), false, 'a puddle is not a dive');
  assert.equal(canDive(-0.2), false);
  assert.equal(canDive(0.4), false, 'dry land');
});

test('the shallows lift a diver out instead of leaving them on the beach', () => {
  // Bed just under the surface: even held down, the last stretch of water gives them back.
  const shallow = { bed: REST - SHALLOW + 0.05, surface: 0, sink: SINK };
  const r = dive({ y: shallow.bed + 0.05, vy: 0 }, 0, 3, shallow);
  assert.equal(r.surfaced, true, 'a body in the shallows never came up');
  assert.equal(r.y, REST);
});

test('a bed that climbs out of the water surfaces the diver at the swimmer\'s height, with no step', () => {
  const dry = { bed: 0.4, surface: 0, sink: SINK };
  const r = stepDive({ y: -1, vy: 0 }, 0, FRAME, dry);
  assert.equal(r.surfaced, true);
  assert.equal(r.y, REST);
});

test('a deck over the head stops a rise and never pushes a diver into the bed', () => {
  const under = { bed: -2.5, surface: 0, sink: SINK, lid: 0.34 };
  const r = dive({ y: -1.5, vy: 0 }, +1, 4, under);
  assert.ok(Math.abs(r.y + DIVE_HEAD - 0.34) < 1e-9, `head reached ${r.y + DIVE_HEAD}`);
  assert.equal(r.surfaced, false, 'a diver came up through a deck');
  // A lid lower than the bed allows still leaves the floor alone.
  const tight = stepDive({ y: -2.4, vy: 0 }, 0, FRAME, { bed: -2.5, surface: 0, sink: SINK, lid: -2.2 });
  assert.ok(tight.y >= -2.5 + BED_CLEAR - 1e-9);
});

test('the head is under when the feet are DIVE_HEAD below the surface', () => {
  assert.equal(headUnder(REST), false, 'a floating swimmer has their head out');
  assert.equal(headUnder(-DIVE_HEAD + 0.01), false);
  assert.equal(headUnder(-DIVE_HEAD - 0.01), true);
  assert.equal(headUnder(-1.5), true);
});

// ---- speeds and pose ----------------------------------------------------------------------

test('a stroke under water is a little slower than at the surface, and walking the bottom slower still', () => {
  assert.ok(DIVE_SPEED < SWIM_SPEED, `${DIVE_SPEED} vs ${SWIM_SPEED}`);
  assert.ok(DIVE_TURBO > DIVE_SPEED);
  assert.ok(DIVE_TURBO < WALK_SPEED, 'a dive turbo outruns a walk');
  assert.ok(DIVE_TURBO < SWIM_TURBO + 1e-9, 'a dive turbo outruns the surface turbo');
  assert.ok(BOTTOM_SPEED < DIVE_SPEED);
});

test('the pitch tips the head down on a descent and up on a climb, and is continuous', () => {
  assert.equal(divePitch(0), SWIM_PITCH);
  assert.ok(divePitch(-DIVE_DOWN) > SWIM_PITCH + 0.8, 'the head did not go down');
  assert.ok(divePitch(DIVE_UP) < SWIM_PITCH - 0.6, 'the head did not come up');
  // Saturates instead of spinning over.
  assert.equal(divePitch(-99), divePitch(-DIVE_DOWN));
  assert.equal(divePitch(99), divePitch(DIVE_UP));
  // No jump at rest, from either side.
  assert.ok(Math.abs(divePitch(-1e-6) - divePitch(1e-6)) < 1e-4);
});

test('the diver\'s head height is the same number the sea counts air by', () => {
  // shared/breath.mjs is written by the sea's half of this feature; while it does not exist
  // yet there is nothing to compare, so the test says nothing rather than failing on a file.
  let src;
  try { src = readFileSync(new URL('../shared/breath.mjs', import.meta.url), 'utf8'); } catch { return; }
  const m = src.match(/export const HEAD = ([0-9.]+);/);
  assert.ok(m, 'shared/breath.mjs has no `export const HEAD`');
  assert.equal(Number(m[1]), DIVE_HEAD);
});

test('walk.js holds the wiring: the dive branch, the flags, and no ceiling that is not eased', () => {
  assert.match(WALK, /import \{[^}]*stepDive[^}]*\} from '\.\/diving\.js'/);
  assert.match(WALK, /state\.swimming = state\.dive \|\|/, 'a diver must still be swimming (the sea\'s SWIMMING bit)');
  assert.match(WALK, /const blend = camDive \* camDive/, 'the camera blend has to come from the eased camDive');
  assert.match(WALK, /applyCeiling\(cy, \{[^}]*\bblend\b/, 'the camera ceiling has to be eased');
  assert.match(WALK, /inWater: \(\) =>/, 'touchpad.js needs inWater() to show B and A');
});

// ---- the camera ---------------------------------------------------------------------------

test('the camera floor: over water it is the surface, diving it is the bed, and the ends are exact', () => {
  assert.equal(cameraFloor({ ground: -2.5 }), WATER_CAM_MIN);
  assert.equal(cameraFloor({ ground: -2.5, diving: true }), -2.5 + 0.55);
  assert.equal(cameraFloor({ ground: -2.5, blend: 0 }), WATER_CAM_MIN);
  assert.equal(cameraFloor({ ground: -2.5, blend: 1 }), -2.5 + 0.55);
  const half = cameraFloor({ ground: -2.5, blend: 0.5 });
  assert.ok(half < WATER_CAM_MIN && half > -2.5 + 0.55, `half-way it is ${half}`);
  assert.equal(cameraFloor({ ground: 3 }), 3.55, 'over land nothing changed');
  assert.equal(cameraFloor({ ground: 3, blend: 1 }), 3.55);
});

test('the diver\'s camera is held under the surface, eased, and never below its floor', () => {
  const at = (cy, blend, ground = -2.5) => applyCeiling(cy, { ground, waterY: 0, blend, floor: ground + 0.55 });
  assert.equal(at(1.6, 0), 1.6, 'not diving: untouched');
  assert.equal(at(1.6, 1), -WATER_CAM_MAX, 'diving: held under the surface');
  const mid = at(1.6, 0.5);
  assert.ok(mid < 1.6 && mid > -WATER_CAM_MAX, `half-way it is ${mid}`);
  assert.equal(at(-1, 1), -1, 'already under: left alone');
  assert.equal(at(-2.4, 1), -2.5 + 0.55, 'a camera below the bed\'s floor is lifted to it');
  // At a beach there is no room under the surface to hang in.
  assert.equal(at(1.6, 1, -0.1), 1.6);
  assert.equal(at(1.6, 1, 0.5), 1.6);
});

test('over a shelf shallower than a hand and a half the diver\'s camera still hangs under the surface', () => {
  // Bed at -0.4: cameraFloor says bed + 0.55 = 0.15, over the surface, which put the camera up
  // in the air with the diver hidden behind an opaque sea. The ceiling wins, down to a hand's
  // width over the bed.
  const at = (ground, blend = 1) => applyCeiling(2.0, { ground, waterY: 0, blend, floor: ground + 0.55 });
  assert.equal(at(-0.4), -WATER_CAM_MAX, 'the camera is over the water at the foot of a shelf');
  assert.ok(at(-0.4) < 0);
  // Shallower still: as low as the bed allows, never in it, never over the surface.
  const shallow = at(-0.3);
  assert.ok(shallow < 0 && shallow >= -0.3 + CAM_BED_CLEAR - 1e-9, `at a bed of -0.3 the camera is at ${shallow}`);
  // Deep water is as it was: the ground floor is well under the ceiling.
  assert.equal(at(-2.5, 1), -WATER_CAM_MAX);
  // And with the eased-in blend the camera passes the surface smoothly, not in one step.
  const path = [0, 0.25, 0.5, 0.75, 1].map((b) => at(-0.4, b));
  for (let i = 1; i < path.length; i++) assert.ok(path[i] <= path[i - 1] + 1e-9, `the camera rose as it went under: ${path}`);
});
