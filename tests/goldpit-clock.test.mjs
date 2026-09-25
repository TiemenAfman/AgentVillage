// The clock over the gold pit's office door: its hands stand at the hour the pit is full
// again, and come off when there is no such hour to show.
//
// The thing that would break silently is the one the tower had for months (web/js/clock.js):
// a building that never publishes where its clock goes, and a clock that is therefore never
// hung. So the anchor is asked for off the real building, and the hands off the real clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';

register('./support/shared-loader.mjs', import.meta.url);
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { buildBuilding } = await import('../web/js/buildings.js');
const { attachResetClock, updateResetClock, refillHour, clockAngles } = await import('../web/js/clock.js');
delete globalThis.document;

const pit = () => buildBuilding({ id: 'civic:goldpit', kind: 'civic', civicType: 'goldpit', plot: { gx: 0, gz: 0, w: 3, d: 3, rot: 0 } });

test('the gold pit says where its clock hangs, in the gable over the office door', () => {
  const b = pit();
  const rc = b.animated && b.animated.resetclock;
  assert.ok(rc, 'the pit publishes no clock anchor');
  const [x, y, z] = rc.at;
  // The office is the left of the apron, its gable between the eaves (0.95) and the ridge
  // (1.20), its front at z 1.19 - build-goldpit.py's numbers.
  assert.ok(x > -1.18 && x < -0.40, `the clock is not over the office (x ${x})`);
  assert.ok(y - rc.r >= 0.95 && y + rc.r <= 1.20, `the dial runs off the gable (${y} ± ${rc.r})`);
  assert.ok(Math.abs(z - 1.19) < 0.01, `the clock is not on the gable's face (z ${z})`);
});

test('the hands stand at the refill hour, and come off when there is none', () => {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial();
  const b = pit();
  const clock = attachResetClock(group, b.animated.resetclock.at, material, b.animated.resetclock.r);
  const now = new Date(2026, 8, 25, 14, 0).getTime();
  const at = new Date(2026, 8, 25, 17, 40).getTime();

  updateResetClock(clock, { known: true, resetsAt: at }, now);
  assert.equal(clock.hourHand.visible, true);
  const want = clockAngles(17 + 40 / 60);
  assert.ok(Math.abs(clock.hourHand.rotation.z - want.hour) < 1e-9, 'the hour hand is not at twenty to six');
  assert.ok(Math.abs(clock.minuteHand.rotation.z - want.minute) < 1e-9, 'the minute hand is not at forty');

  for (const [why, g, t] of [
    ['no reading', null, now],
    ['nothing known', { known: false }, now],
    ['the window turned over', { known: true, reset: true, resetsAt: at }, now],
    ['the refill has passed', { known: true, resetsAt: at }, at + 1],
  ]) {
    updateResetClock(clock, g, t);
    assert.equal(clock.hourHand.visible, false, `hands still on with ${why}`);
    assert.equal(clock.minuteHand.visible, false, `hands still on with ${why}`);
    assert.equal(refillHour(g, t), null);
  }
  // And back on when a reading comes in again.
  updateResetClock(clock, { known: true, resetsAt: at }, now);
  assert.equal(clock.minuteHand.visible, true);
});
