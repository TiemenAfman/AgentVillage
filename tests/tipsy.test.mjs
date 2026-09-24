// The purple bar (web/js/tipsy.js): what a drink adds, how long it stays, and how blurred it
// makes the view. Plain numbers, like tests/stamina.test.mjs - no loader, no document.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTipsy, drinkIn, stepTipsy, hazePx, TIPSY, HAZE_PX } from '../web/js/tipsy.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('a whole drink is one dose, however many frames it went down in, and the bar tops out', () => {
  const t = createTipsy();
  for (let i = 0; i < 48; i++) drinkIn(t, 1 / 48);
  assert.ok(near(t.level, TIPSY.dose), `one drink left ${t.level}`);
  for (let i = 0; i < 20; i++) drinkIn(t, 1);
  assert.equal(t.level, 1);
  drinkIn(t, -1);
  drinkIn(t, NaN);
  assert.equal(t.level, 1, 'nothing swallowed took something back');
});

test('the beer stays for the delay, then clears from full to sober in SOBER seconds', () => {
  const t = createTipsy();
  drinkIn(t, 1 / TIPSY.dose);
  assert.equal(t.level, 1);
  for (let s = 0; s < TIPSY.delay; s += 0.5) stepTipsy(t, 0.5);
  assert.equal(t.level, 1, 'it wore off before the delay was up');
  for (let s = 0; s < TIPSY.sober / 2; s += 0.25) stepTipsy(t, 0.25);
  assert.ok(near(t.level, 0.5, 1e-6), `halfway: ${t.level}`);
  // Another sip puts the clock back: the delay starts again from it.
  drinkIn(t, 0.01);
  const after = t.level;
  stepTipsy(t, TIPSY.delay - 0.1);
  assert.equal(t.level, after);
  for (let s = 0; s < TIPSY.sober + TIPSY.delay; s += 1) stepTipsy(t, 1);
  assert.equal(t.level, 0, 'never sober again');
});

test('a long frame straddling the delay clears only the part after it', () => {
  const t = createTipsy();
  drinkIn(t, 1 / TIPSY.dose);
  stepTipsy(t, TIPSY.delay - 1);
  stepTipsy(t, 3);                         // one second of delay, two of clearing
  assert.ok(near(t.level, 1 - 2 / TIPSY.sober, 1e-9), `${t.level}`);
  stepTipsy(t, 0);
  stepTipsy(t, -1);
  stepTipsy(t, NaN);
  assert.ok(near(t.level, 1 - 2 / TIPSY.sober, 1e-9), 'a nonsense dt moved the bar');
});

test('the view is sharp sober, swims when drunk, and never past HAZE_PX', () => {
  assert.equal(hazePx(0, 12), 0);
  assert.equal(hazePx(undefined, 12), 0);
  let lo = Infinity, hi = 0;
  for (let s = 0; s < 20; s += 0.05) {
    const px = hazePx(1, s);
    lo = Math.min(lo, px); hi = Math.max(hi, px);
  }
  assert.ok(hi <= HAZE_PX + 1e-9 && hi > HAZE_PX * 0.95, `peak ${hi}`);
  assert.ok(lo > 0 && lo < hi * 0.6, `it does not breathe: ${lo}..${hi}`);
  // Squared: one beer is barely a smear, and more is always more.
  assert.ok(hazePx(TIPSY.dose, 1) < HAZE_PX * 0.05);
  assert.ok(hazePx(0.5, 1) < hazePx(0.8, 1));
  assert.equal(hazePx(3, 1), hazePx(1, 1), 'past a full bar is a full bar');
});
