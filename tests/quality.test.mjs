// The quality governor (web/js/quality.js) on a clock of its own: a fake machine whose frame
// time depends on the rung it is on, stepped frame by frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createQualityGovernor, RUNGS, SLOW_MS, FAST_MS, GRACE_S, SETTLE_S, WINDOW_S, UP_AFTER_S, MAX_UP_S,
} from '../web/js/quality.js';

// Run `seconds` of frames; `ms(level, t)` is how long the next frame takes on that rung.
function run(gov, seconds, ms, { from = 0, visible = () => true } = {}) {
  const changes = [];
  let t = from;
  while (t < from + seconds * 1000) {
    t += ms(gov.level(), t);
    const r = gov.frame(t, visible(t));
    if (r) changes.push({ t, level: gov.level(), name: r.name });
  }
  return { changes, t };
}

test('a machine that keeps up is never touched', () => {
  const gov = createQualityGovernor();
  const { changes } = run(gov, 600, () => 16.7);
  assert.deepEqual(changes, []);
  assert.equal(gov.level(), 0);
});

test('a slow machine steps down one rung at a time, not before the grace and a full window', () => {
  const gov = createQualityGovernor();
  const { changes } = run(gov, 120, () => 50);
  assert.ok(changes.length >= 1);
  // Not while shaders compile, and not before one window has been seen after that.
  assert.ok(changes[0].t >= (GRACE_S + WINDOW_S * 0.9) * 1000, `first change at ${changes[0].t}`);
  for (let i = 0; i < changes.length; i++) assert.equal(changes[i].level, i + 1);
  // Each later step waits for the new rung to settle and a new window to fill.
  for (let i = 1; i < changes.length; i++) {
    assert.ok(changes[i].t - changes[i - 1].t >= Math.max(SETTLE_S, WINDOW_S * 0.9) * 1000);
  }
  assert.equal(gov.level(), RUNGS.length - 1, 'always slow ends on the lightest rung and stays');
});

test('it stops going down as soon as the rung is fast enough', () => {
  const gov = createQualityGovernor();
  // 40 ms on the two best rungs, 25 from rung 2 on: slow is gone, fast is not reached.
  run(gov, 300, (lv) => (lv < 2 ? 40 : 25));
  assert.equal(gov.level(), 2);
});

test('a one-off stall is not a speed, a pause is not a frame, a hidden tab is not this machine', () => {
  const gov = createQualityGovernor();
  // Fast, with a 900 ms stall every ten seconds (an island being raised).
  let r = run(gov, 120, (lv, t) => (Math.floor(t / 10000) !== Math.floor((t + 16.7) / 10000) ? 900 : 16.7));
  assert.deepEqual(r.changes, []);
  // A breakpoint or a laptop lid between fast frames.
  r = run(gov, 60, (lv, t) => (Math.floor(t / 20000) !== Math.floor((t + 16.7) / 20000) ? 60000 : 16.7), { from: r.t });
  assert.deepEqual(r.changes, []);
  // Slow frames while hidden: rAF in a background tab, not this machine's speed.
  r = run(gov, 120, () => 60, { from: r.t, visible: () => false });
  assert.deepEqual(r.changes, []);
});

test('a machine that takes seconds for every frame is still stepped down', () => {
  // What headless Chromium on SwiftShader does: two seconds a frame, every frame.
  const gov = createQualityGovernor();
  run(gov, 600, () => 2000);
  assert.equal(gov.level(), RUNGS.length - 1);
});

test('back up after a long enough fast stretch', () => {
  const gov = createQualityGovernor();
  let r = run(gov, 60, () => 60);
  assert.ok(gov.level() > 0);
  const low = gov.level();
  r = run(gov, UP_AFTER_S - 1, () => 10, { from: r.t });
  assert.equal(gov.level(), low, 'not before UP_AFTER_S');
  run(gov, 600, () => 10, { from: r.t });
  assert.equal(gov.level(), 0, 'all the way back');
});

test('a machine on the edge between two rungs does not flap', () => {
  const gov = createQualityGovernor();
  // Too slow on rung 0, comfortably fast on rung 1: the worst case for a governor.
  const { changes } = run(gov, 3600, (lv) => (lv === 0 ? 40 : 12));
  // The first step down, then every retry of rung 0 doubles the wait (20, 40, 80, 160, 320
  // s, then 320 s for ever): in an hour, well under twenty changes rather than a hundred.
  assert.ok(changes.length <= 30, `${changes.length} changes in an hour`);
  const ups = changes.filter((c, i) => i > 0 && c.level < changes[i - 1].level);
  for (let i = 1; i < ups.length; i++) {
    assert.ok(ups[i].t - ups[i - 1].t <= (MAX_UP_S + 30) * 1000, 'the wait is capped');
  }
});

test('pin and automatic off', () => {
  const gov = createQualityGovernor();
  assert.equal(gov.pin(3).name, RUNGS[3].name);
  assert.equal(gov.auto(), false);
  run(gov, 120, () => 10);
  assert.equal(gov.level(), 3, 'a pinned rung is not judged');
  const r = gov.setAuto(false);
  assert.equal(r.name, 'full', 'automatic off is the rung the page booted with');
  assert.equal(gov.setAuto(true), null);
  assert.equal(gov.auto(), true);
});

test('the rungs only ever get lighter, and every knob is one that costs no shader', () => {
  for (let i = 1; i < RUNGS.length; i++) {
    const a = RUNGS[i - 1], b = RUNGS[i];
    assert.ok(b.pixel <= a.pixel && b.shadowEvery >= a.shadowEvery && b.imps <= a.imps, b.name);
    assert.ok(b.pixel < a.pixel || b.shadowEvery > a.shadowEvery || b.imps < a.imps, `${b.name} changes something`);
  }
  for (const r of RUNGS) assert.deepEqual(Object.keys(r).sort(), ['imps', 'name', 'pixel', 'shadowEvery']);
  assert.ok(FAST_MS < SLOW_MS);
  // No DOM, no three.js: the same kind of module as director.js.
  const src = fs.readFileSync(new URL('../web/js/quality.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^import /m);
  assert.doesNotMatch(src, /\b(document|window|localStorage)\./);
});
