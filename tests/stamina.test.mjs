// Shift's two pools (web/js/stamina.js), drained and refilled under plain Node.
//
// The numbers are the design's (Plans/vulkaan-in-het-midden.md) and they are asserted as
// durations a player would feel - six seconds of sprint, a second's breath, five to fill -
// rather than as the per-frame arithmetic that produces them, because the arithmetic is
// exactly what a later tweak changes and the durations are what somebody chose.
//
// No loader and no document stub: stamina.js imports nothing, and the moment it needs
// either it has reached into the browser and walk.js can no longer lean on it for free.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPool, stepPool, canBoost, shownPool, BODY, BOAT, RECOVER_AT } from '../web/js/stamina.js';

const FRAME = 1 / 60;
const frames = (seconds, dt = FRAME) => Math.round(seconds / dt);

// Hold (or do not hold) Shift for `seconds`; how many of those frames were boosted.
function hold(pool, wants, seconds, dt = FRAME) {
  let boosted = 0;
  for (let i = 0; i < frames(seconds, dt); i++) if (stepPool(pool, wants, dt)) boosted++;
  return boosted;
}

// Hold Shift until the first frame it is refused - which leaves the pool one frame into its
// breath, the same as a player whose sprint has just given out under them.
function empty(pool, dt = FRAME) {
  let t = 0;
  while (stepPool(pool, true, dt) && t < 60) t += dt;
  return t;
}

// How long, held from full, before the first frame the boost is refused.
function lasts(spec, dt = FRAME) {
  return empty(createPool(spec), dt);
}

test('the body gives six seconds of sprint and the boat four', () => {
  assert.ok(Math.abs(lasts(BODY) - 6) < 2 * FRAME, `a full body ran for ${lasts(BODY).toFixed(3)} s`);
  assert.ok(Math.abs(lasts(BOAT) - 4) < 2 * FRAME, `a full boat boosted for ${lasts(BOAT).toFixed(3)} s`);
  // Frame rate is not stamina: a slow machine and a fast one get the same sprint.
  for (const dt of [1 / 30, 1 / 144]) {
    assert.ok(Math.abs(lasts(BODY, dt) - 6) < 2 * dt, `at ${Math.round(1 / dt)} fps it ran ${lasts(BODY, dt).toFixed(3)} s`);
  }
});

test('an empty pool stays shut until a quarter, however long Shift is held', () => {
  for (const spec of [BODY, BOAT]) {
    const pool = createPool(spec);
    empty(pool);
    assert.equal(pool.level, 0);
    assert.ok(pool.spent && !canBoost(pool));

    // Still holding it: nothing for the delay, then the refill up to RECOVER_AT, and the
    // first boosted frame comes only after both. Asserting it frame by frame is the flicker
    // test - one early frame of turbo is exactly the stutter the threshold exists to stop.
    const opensAt = spec.delay + RECOVER_AT * spec.refill;
    let t = 0;
    while (!stepPool(pool, true, FRAME) && t < 30) t += FRAME;
    assert.ok(Math.abs(t - opensAt) < 2 * FRAME, `it opened after ${t.toFixed(3)} s, not ${opensAt} s`);
    assert.ok(pool.level > RECOVER_AT - 0.02, `it opened at ${pool.level.toFixed(3)}`);
  }
});

test('a second after letting go it fills, empty to full in five seconds (six for the boat)', () => {
  for (const spec of [BODY, BOAT]) {
    const pool = createPool(spec);
    empty(pool);
    hold(pool, false, spec.delay - 0.05);
    assert.equal(pool.level, 0, 'it started filling before the breath was over');
    hold(pool, false, spec.refill);
    assert.ok(pool.level > 0.97 && pool.level < 1, `a refill of ${spec.refill} s took it to ${pool.level.toFixed(3)}`);
    hold(pool, false, 0.1);
    assert.equal(pool.level, 1);
    assert.ok(!pool.spent, 'a full pool was still locked');
  }
});

test('a short burst costs what it used and waits out the same breath', () => {
  const pool = createPool(BODY);
  assert.equal(hold(pool, true, 1.5), frames(1.5));
  assert.ok(Math.abs(pool.level - 0.75) < 1e-9, `a quarter of the sprint left ${pool.level}`);
  // Tapping Shift again resets the breath: the refill waits for the *last* use, or a
  // sprinter tapping every half second would never run dry.
  hold(pool, false, 0.8);
  stepPool(pool, true, FRAME);
  const tapped = pool.level;
  hold(pool, false, 0.8);
  assert.equal(pool.level, tapped, 'a tap did not start the breath over');
});

test('whichever pool is idle fills while the other is spent', () => {
  // walk.js steps both every frame, the idle one with false; this is that loop.
  const stamina = { body: createPool(BODY), boat: createPool(BOAT) };
  hold(stamina.body, true, 3);
  let boosted = 0;
  for (let i = 0; i < frames(4.1); i++) {
    if (stepPool(stamina.boat, true, FRAME)) boosted++;
    stepPool(stamina.body, false, FRAME);
  }
  assert.ok(boosted >= frames(4) - 1, 'the boat pool did not last its four seconds');
  assert.ok(stamina.body.level > 0.95, `four seconds at the tiller left the body at ${stamina.body.level.toFixed(3)}`);
  assert.ok(stamina.boat.spent);

  assert.equal(shownPool(stamina, true), stamina.boat);
  assert.equal(shownPool(stamina, false), stamina.body);
});

test('a frame of rubbish changes nothing, and one long frame fills only past the breath', () => {
  const pool = createPool(BODY);
  hold(pool, true, 3);
  const before = { ...pool };
  for (const dt of [0, -1, NaN, Infinity, undefined, '0.1']) stepPool(pool, false, dt);
  assert.deepEqual(pool, before, 'a bad dt moved the pool');

  // A tab coming back from the background: 1.5 s in one go, of which half a second is
  // past the delay. A whole-frame refill here would hand back 0.3 instead of 0.1.
  const level = pool.level;
  stepPool(pool, false, 1.5);
  assert.ok(Math.abs(pool.level - (level + 0.5 / BODY.refill)) < 1e-9, `one long frame filled to ${pool.level}`);
});
