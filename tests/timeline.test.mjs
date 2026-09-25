// The one timeline everything another machine moves is drawn on (web/js/timeline.js), and
// the two things it is for (Plans/lopen-op-de-boot.md, fase 0 and 1): a boat somebody else
// is steering sails instead of jumping, and its pilot is drawn standing on it.
//
// peers.js and main.js cannot be loaded here - both reach walk.js, which pulls in three's
// addons - so what they have to agree on is read out of their source, as tests/boat.test.mjs
// reads walk.js's speeds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('./support/shared-loader.mjs', import.meta.url);
const { LAG_MS, MAX_EXTRAPOLATE_MS, progress, sampleAt, pushSample, trackAt } = await import('../web/js/timeline.js');

const read = (rel) => readFileSync(new URL(`../web/js/${rel}`, import.meta.url), 'utf8');
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

test('between two samples it is the line between them, and before the first it waits', () => {
  const a = { x: 0, z: 0, yaw: 0, at: 1000 }, b = { x: 10, z: -4, yaw: 1, at: 1100 };
  const mid = sampleAt(a, b, 1050);
  near(mid.x, 5, 1e-9, 'x halfway');
  near(mid.z, -2, 1e-9, 'z halfway');
  near(mid.yaw, 0.5, 1e-9, 'heading halfway');
  assert.equal(progress(a, b, 900), 0, 'a render time before the pair is the first sample');
});

test('past the newest sample it carries on for a moment and then holds', () => {
  const a = { x: 0, z: 0, yaw: 0, at: 0 }, b = { x: 1, z: 0, yaw: 0, at: 100 };
  near(sampleAt(a, b, 150).x, 1.5, 1e-9, 'half a span late');
  const cap = 1 + MAX_EXTRAPOLATE_MS / 100;
  near(sampleAt(a, b, 100 + MAX_EXTRAPOLATE_MS).x, cap, 1e-9, 'at the limit');
  near(sampleAt(a, b, 100 + 10 * MAX_EXTRAPOLATE_MS).x, cap, 1e-9, 'and no further, however late');
});

test('a hull let go of glides to where it was left and stops there, with no overshoot', () => {
  // Full speed, then the drop: the last pair still says 9.5 a second, the release says stop.
  const a = { x: 0, z: 0, yaw: 0, at: 0 }, b = { x: 0.95, z: 0, yaw: 0, at: 100 };
  for (const render of [100, 150, 300, 5000]) {
    assert.ok(sampleAt(a, b, render, {}, true).x <= 0.95 + 1e-9, `past where it was let go at ${render}`);
  }
  near(sampleAt(a, b, 5000, {}, true).x, 0.95, 1e-9, 'where it was let go');
});

test('the heading turns the short way round and is never carried on past the last sample', () => {
  const a = { x: 0, z: 0, yaw: 3.0, at: 0 }, b = { x: 0, z: 0, yaw: -3.0, at: 100 };
  const mid = sampleAt(a, b, 50).yaw;
  assert.ok(Math.abs(Math.abs(mid) - Math.PI) < 0.05, `half way from 3.0 to -3.0 is round the back, not through 0: ${mid}`);
  near(sampleAt(a, b, 250).yaw, sampleAt(a, b, 100).yaw, 1e-9, 'a late packet does not keep a hull swinging');
});

// A hull sailing straight at the top speed, reported on the pilot's pose beat (net.js
// POSE_MS, 100 ms), each report stamped when it arrives here. `delay` is how late each one
// is. Returns how far the drawn hull ever was from the true track LAG_MS ago, and the
// biggest step it made between two frames. Set down on every message instead - what
// main.js did before this - it stood still for a tenth of a second and then jumped 0.95.
const SPEED = 9.5, BEAT = 100, FRAME = 1000 / 60;
function sail(delay) {
  const track = [];
  let n = 0, last = null, off = 0, step = 0;
  for (let now = 0; now < 3000; now += FRAME) {
    while (n * BEAT + delay(n) <= now) {
      pushSample(track, { x: (SPEED * n * BEAT) / 1000, z: 0, yaw: 0, at: n * BEAT + delay(n) });
      n++;
    }
    if (now < LAG_MS + 2 * BEAT) continue;           // the first few are still arriving
    const drawn = trackAt(track, now - LAG_MS);
    off = Math.max(off, Math.abs(drawn.x - (SPEED * (now - LAG_MS)) / 1000));
    if (last !== null) step = Math.max(step, drawn.x - last);
    last = drawn.x;
  }
  return { off, step, kept: track.length };
}

test('a boat sailing past at full speed is drawn where it really was, without a single jump', () => {
  const steady = sail(() => 0);
  near(steady.off, 0, 1e-9, 'off the true track');
  near(steady.step, (SPEED * FRAME) / 1000, 1e-6, 'the biggest step between two frames');
  assert.ok(steady.kept <= 4, `the track keeps ${steady.kept} samples`);
  // A line that is late by anything up to 40 ms, differently every time: never a jump, and
  // never much more than a frame's worth of way from where the hull really was.
  const jitter = (n) => (n * 7919) % 41;
  const rough = sail(jitter);
  assert.ok(rough.step < 2 * (SPEED * FRAME) / 1000, `a step of ${rough.step.toFixed(3)} in one frame`);
  assert.ok(rough.off < 0.4, `${rough.off.toFixed(3)} off the true track`);
});

test('a track of one sample is that sample, and a released track stops at its last', () => {
  near(trackAt([{ x: 3, z: 4, yaw: 1, at: 0 }], 5000).x, 3, 1e-9, 'one sample');
  const track = [];
  for (let n = 0; n < 5; n++) pushSample(track, { x: n, z: 0, yaw: 0, at: n * 100, final: n === 4 });
  near(trackAt(track, 10000).x, 4, 1e-9, 'let go of at 4');
  near(trackAt(track, 250).x, 2.5, 1e-9, 'still drawn along the older stretch');
});

test('the people and the boats are drawn on one lag, and a pilot is not a room', () => {
  const peers = read('peers.js'), main = read('main.js');
  // One copy of the lag: a pilot drawn on a hull that is on a different lag from their own
  // pose would stand in the water beside it.
  assert.doesNotMatch(peers, /const (LAG_MS|MAX_EXTRAPOLATE_MS)\s*=/, 'peers.js keeps its own lag again');
  assert.doesNotMatch(main, /const (LAG_MS|MAX_EXTRAPOLATE_MS)\s*=/, 'main.js keeps its own lag');
  assert.match(peers, /from '\.\/timeline\.js'/);
  assert.match(main, /from '\.\/timeline\.js'/);
  // The word a pilot's pose carries, written in two places: main.js sends it and peers.js
  // must recognise it, or the pilot is hidden as somebody standing in a room this page never
  // built - which is what every other screen showed before: a boat with nobody in it.
  const sent = [...main.matchAll(/setRoom\('([a-z]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(sent)], ['boat'], 'main.js names the room aboard');
  assert.match(peers, /const BOAT_ROOM = 'boat';/, 'peers.js knows that room is a hull');
});
