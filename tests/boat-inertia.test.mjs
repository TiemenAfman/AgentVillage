// The galleon is mass: slow to get going, slow to turn, and when the helm is let go she runs
// out for most of a minute rather than four seconds - and the sea keeps taking her position
// for as long as she does. Every number is CRAFTS.galleon.sail's (shared/crafts.mjs); the
// Benchy's handling is tests/boat.test.mjs's and must not have moved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createBoats, COAST_MS } from '../lib/boats.mjs';
import { CRAFTS } from '../shared/crafts.mjs';
register('./support/shared-loader.mjs', import.meta.url);

globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { stepBoat, BOAT_TURBO } = await import('../web/js/boat.js');
delete globalThis.document;

const FRAME = 1 / 60;
const OPEN_SEA = () => -2.5;
const SAIL = CRAFTS.galleon.sail;
const ship = (over = {}) => ({ x: 0, z: 0, yaw: 0, v: 0, craft: { spec: CRAFTS.galleon }, ...over });
const run = (b, input, seconds, heightAt = OPEN_SEA) => {
  for (let i = 0; i < Math.round(seconds / FRAME); i++) stepBoat(b, input, FRAME, heightAt);
  return b;
};
// Seconds and distance a hull runs with hands off, from whatever way it has on.
function runOut(b, limit = 200) {
  let t = 0;
  const z0 = b.z;
  while (b.v !== 0 && t < limit) { stepBoat(b, { throttle: 0, turn: 0 }, FRAME, OPEN_SEA); t += FRAME; }
  return { t, dist: b.z - z0 };
}

test('a ship takes her time to get going, but not for ever: five to eight seconds to her top speed', () => {
  const b = ship();
  let t = 0;
  while (b.v < SAIL.top - 1e-9 && t < 60) { stepBoat(b, { throttle: 1, turn: 0 }, FRAME, OPEN_SEA); t += FRAME; }
  assert.ok(t > 5 && t < 8, `she reached ${SAIL.top} in ${t.toFixed(1)} s`);
  // Still much heavier than the Benchy's two seconds.
  assert.ok(t > 2.5 * 2, 'a ship is no more lively than a boat');
});

test('let go of the helm and she just keeps going, for most of a minute', () => {
  const b = run(ship(), { throttle: 1, turn: 0 }, 20);
  assert.ok(b.v > SAIL.top - 1e-9, 'she did not get to speed first');
  // Hands off. Half a minute later she is still under way, and never speeds up on the way.
  let last = b.v;
  for (let i = 0; i < 30 / FRAME; i++) {
    stepBoat(b, { throttle: 0, turn: 0 }, FRAME, OPEN_SEA);
    assert.ok(b.v <= last, `a coasting ship sped up: ${last} -> ${b.v}`);
    last = b.v;
  }
  assert.ok(b.v > 0.5, `after half a minute of coasting she is down to ${b.v.toFixed(2)}`);
  const rest = runOut(b);
  assert.equal(b.v, 0, 'a coasting ship never came to rest');
  assert.ok(30 + rest.t > 30 && 30 + rest.t < 60, `she ran out for ${(30 + rest.t).toFixed(0)} s`);
});

test('she carries on for well over a hundred units, straight, with nobody at the helm', () => {
  const b = run(ship(), { throttle: 1, turn: 0 }, 20);
  const { dist } = runOut(b);
  assert.ok(dist > 100, `she ran only ${dist.toFixed(0)} units out`);
  assert.ok(Math.abs(b.x) < 1e-6 && Math.abs(b.yaw) < 1e-9, 'a rudder amidships put her off her course');
});

test('the sea takes her position for as long as she runs out, from full turbo too', () => {
  // The worst case: turbo open the moment the helm is let go. Turbo speed is the ceiling, and the
  // pool behind it is four seconds, so the way she carries is at most that.
  const b = run(ship(), { throttle: 1, turn: 0, turbo: true }, 30);
  assert.ok(b.v > SAIL.top * BOAT_TURBO - 1e-9, 'she did not reach turbo speed');
  const { t } = runOut(b);
  assert.ok(t < SAIL.runOut, `she ran ${t.toFixed(0)} s out from turbo speed, past her ${SAIL.runOut} s`);

  const ID = 'boat:abcd1234';
  const ANN = 'a0'.padEnd(12, '0');
  const boats = createBoats({ moorings: [{ id: ID, x: 0, z: 0, yaw: 0 }] });
  assert.ok(boats.board(ID, ANN, [0, 0]));
  assert.equal(boats.take(ID, ANN).pilot, ANN);
  const t0 = 1_000_000;
  boats.letGo(ID, ANN, t0);
  assert.ok(boats.moved(ID, ANN, 0, 20, 0, t0 + 40_000), 'the sea stopped her halfway through her run-out');
  // Jumped over the side: off the crew, and the hull is still theirs to run out (tests/ship-runout.test.mjs).
  assert.ok(boats.leave(ID, ANN));
  assert.ok(!boats.aboard(ID, ANN));
  assert.ok(boats.moved(ID, ANN, 0, 25, 0, t0 + 41_000), 'the sea stopped her when the last of the crew jumped');
  assert.ok(boats.moved(ID, ANN, 0, 30, 0, t0 + SAIL.runOut * 1000 - 1));
  assert.equal(boats.moved(ID, ANN, 0, 40, 0, t0 + SAIL.runOut * 1000 + 1), null, 'still steering long after');
  assert.ok(SAIL.runOut * 1000 > COAST_MS, 'a ship is no lighter than a Benchy');
});

test('a boat with no runOut of her own keeps the short coast', () => {
  const ID = 'boat:abcd1234';
  const ANN = 'a0'.padEnd(12, '0');
  const boats = createBoats({
    moorings: [{ id: ID, x: 0, z: 0, yaw: 0 }],
    craftOf: () => ({ crew: 2, helm: [0, 0], deck: [], rails: [], ladders: [] }),
  });
  assert.ok(boats.board(ID, ANN, [0, 0]));
  boats.take(ID, ANN);
  const t0 = 1_000_000;
  boats.letGo(ID, ANN, t0);
  assert.ok(boats.moved(ID, ANN, 0, 5, 0, t0 + COAST_MS - 1));
  assert.equal(boats.moved(ID, ANN, 0, 6, 0, t0 + COAST_MS + 1), null);
});

test('the helm is felt late, and a swing carries on after the rudder is centred', () => {
  const b = run(ship(), { throttle: 1, turn: 0 }, 20);
  const yaw0 = b.yaw;
  run(b, { throttle: 1, turn: 1 }, 0.2);
  const early = Math.abs(b.w);
  run(b, { throttle: 1, turn: 1 }, 4);
  const full = Math.abs(b.w);
  assert.ok(early < full * 0.3, `after a fifth of a second she was already turning at ${early.toFixed(2)} of ${full.toFixed(2)}`);
  assert.ok(Math.abs(full - SAIL.turn) < 0.02, `she settled at ${full.toFixed(2)} rad/s, not ${SAIL.turn}`);
  // Rudder amidships: she swings on, and settles.
  const at = b.yaw;
  run(b, { throttle: 1, turn: 0 }, 0.5);
  assert.ok(Math.abs(b.yaw - at) > 0.1, 'the swing stopped with the rudder');
  run(b, { throttle: 1, turn: 0 }, 10);
  assert.ok(Math.abs(b.w) < 0.01, `she is still turning at ${b.w}`);
  assert.notEqual(b.yaw, yaw0);
});

test('a hard turn costs a ship little way, and S is a brake she feels for seconds', () => {
  const carving = run(ship({ v: SAIL.top }), { throttle: 1, turn: 1 }, 3);
  assert.ok(carving.v > SAIL.top * 0.6, `a hard turn cost her ${(SAIL.top - carving.v).toFixed(1)} u/s in three seconds`);
  const braking = ship({ v: SAIL.top });
  let t = 0;
  while (braking.v > 0 && t < 60) { stepBoat(braking, { throttle: -1, turn: 0 }, FRAME, OPEN_SEA); t += FRAME; }
  assert.ok(braking.v <= 0, 'full astern never stopped her');
  assert.ok(t > 4 && t < 12, `she stopped in ${t.toFixed(1)} s`);
});

test('the Benchy is what she always was: no yaw rate on her record, the same four seconds', () => {
  const b = { x: 0, z: 0, yaw: 0, v: 0 };
  run(b, { throttle: 1, turn: 1 }, 2);
  assert.equal(b.w, undefined, 'a Benchy grew a turn rate');
  const c = run({ x: 0, z: 0, yaw: 0, v: 0 }, { throttle: 1, turn: 0 }, 5);
  const { t } = runOut(c);
  assert.ok(t > 3 && t < 5, `a Benchy drifted for ${t.toFixed(1)} s`);
});
