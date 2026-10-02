// The phone's controls (web/js/touchpad.js, web/js/phoneprefs.js) and the way out of a
// keeper's conversation on a pad (web/js/input.js `parley`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { stickOut, REACH, DEAD } from '../web/js/touchpad.js';
import { MAPS, padKey } from '../web/js/input.js';
import { BTN } from '../web/js/gamepad.js';

test('the stick does nothing inside the dead zone, and all of it at the rim', () => {
  assert.deepEqual(stickOut(0, 0), { x: 0, y: 0 });
  assert.deepEqual(stickOut(REACH * DEAD * 0.9, 0), { x: 0, y: 0 }, 'a resting thumb walked');
  const full = stickOut(0, -REACH);
  assert.ok(Math.abs(full.y + 1) < 1e-9 && Math.abs(full.x) < 1e-9, 'straight up at the rim is not full ahead');
  // Past the rim is still full, never more.
  const past = stickOut(REACH * 3, 0);
  assert.ok(Math.abs(past.x - 1) < 1e-9);
});

test('the stick is gentle near the middle and round, not square', () => {
  const half = stickOut(REACH / 2, 0).x;
  assert.ok(half > 0 && half < 0.5, `half a push gave ${half}, not less than half the speed`);
  // A diagonal at the rim is as far as straight ahead: no 1.41 in the corners.
  const d = stickOut(REACH, REACH);
  assert.ok(Math.abs(Math.hypot(d.x, d.y) - 1) < 1e-9, 'a diagonal is faster than straight');
  // Monotonic: more push, more speed.
  let last = -1;
  for (let px = 0; px <= REACH; px += 4) {
    const v = stickOut(px, 0).x;
    assert.ok(v >= last, `the curve went back down at ${px}px`);
    last = v;
  }
});

test('a pad or a phone can end a keeper\'s conversation: X, B and BACK', () => {
  assert.equal(MAPS.parley.leave.hit, BTN.X);
  assert.equal(MAPS.parley.back.hit, BTN.B);
  assert.equal(MAPS.parley.exit.hit, BTN.BACK);
  assert.equal(padKey('parley', 'leave'), 'X');
});

test('the phone\'s settings come back inside their ranges, whatever was saved', async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  const { prefs, setPref, resetPrefsCache, PHONE_DEFAULTS } = await import('../web/js/phoneprefs.js');
  resetPrefsCache();
  assert.deepEqual(prefs(), { ...PHONE_DEFAULTS });
  assert.equal(PHONE_DEFAULTS.quality, 'light', 'a phone should start on the lighter drawing');

  setPref('look', 9);
  assert.equal(prefs().look, 2);
  setPref('look', 0.1);
  assert.equal(prefs().look, 0.5);
  setPref('invert', 'yes');
  assert.equal(prefs().invert, false, 'only a real true inverts');
  setPref('lefty', true);
  setPref('quality', 'ultra');
  assert.equal(prefs().quality, 'light');
  setPref('nonsense', 1);
  assert.equal('nonsense' in prefs(), false);

  // Kept for the next start, and read back through the same ranges.
  resetPrefsCache();
  assert.equal(prefs().lefty, true);
  store.set('promptholm.phone', '{"look":"fast","quality":"full"');   // broken JSON
  resetPrefsCache();
  assert.deepEqual(prefs(), { ...PHONE_DEFAULTS });
  delete globalThis.localStorage;
});

// On the saddle walk.js's onFoot() is false, and the Y button is a .tp-foot one: hidden with
// the hands it left a rider on the phone with no way off the bicycle.
test('the phone keeps Y on screen while riding, the one way off the bike', async () => {
  const { readFileSync } = await import('node:fs');
  const PAD = readFileSync(new URL('../web/js/touchpad.js', import.meta.url), 'utf8');
  const MAIN = readFileSync(new URL('../web/js/main.js', import.meta.url), 'utf8');
  assert.match(PAD, /function setHands\(what, swimming = false, riding = false\)/);
  assert.match(PAD, /riding && b\.dataset\.b === 'Y'/, 'setHands hides Y on the bike');
  assert.match(MAIN, /setHands\([^\n]*walk\.riding\(\)\)/, 'touchHud does not tell the pad it is riding');
});
