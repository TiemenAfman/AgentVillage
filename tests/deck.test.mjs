// Standing on a moving boat (shared/deck.mjs, shared/crafts.mjs - Plans/lopen-op-de-boot.md,
// the groundwork for fase 2 and 3). Nothing draws or sails a deck yet: every boat is still a
// Benchy with room for her pilot. What is held here is the arithmetic a bigger boat will
// stand on, so it is right before anybody is on it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toWorld, toLocal, dirToWorld, dirToLocal, hullVelocity, deckAt, clampToDeck, stepDeck, boardAt, leaveDeck } from '../shared/deck.mjs';
import { CRAFTS, craftOf, crewOf, kindOf } from '../shared/crafts.mjs';

const frameOf = (x, z, yaw) => ({ x, z, fx: Math.sin(yaw), fz: Math.cos(yaw) });
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

// A made-up deck for the walking tests: four by two across, a rail down the port side, open
// at the stern, and a raised stretch at the bow.
const SLOOP = {
  crew: 5, helm: [0, -1.5],
  deck: [{ x: 0, z: 0, hx: 1, hz: 2, y: 0 }, { x: 0, z: 1.6, hx: 0.6, hz: 0.4, y: 0.1 }],
  rails: [{ x: -1.05, z: 0, hx: 0.05, hz: 2 }],
};
const WALK = { speed: 2, radius: 0.2, jumpV: 3, gravity: 9 };

test('the hull frame goes there and back, and forward is where the boat points', () => {
  for (const yaw of [0, 0.7, -2.1, Math.PI, 5.5]) {
    const f = frameOf(12.5, -3, yaw);
    const w = toWorld(f, 0.4, -1.3);
    const l = toLocal(f, w[0], w[1]);
    near(l[0], 0.4, 1e-12, `x back at yaw ${yaw}`);
    near(l[1], -1.3, 1e-12, `z back at yaw ${yaw}`);
    // A step towards the bow is a step along the heading, the way walk.js faces.
    const ahead = toWorld(f, 0, 1);
    near(ahead[0] - f.x, Math.sin(yaw), 1e-12, 'bow x');
    near(ahead[1] - f.z, Math.cos(yaw), 1e-12, 'bow z');
    const d = dirToLocal(f, ...dirToWorld(f, 0.6, 0.8));
    near(d[0], 0.6, 1e-12, 'a direction there and back');
    near(d[1], 0.8, 1e-12, 'a direction there and back');
  }
  const v = hullVelocity(frameOf(0, 0, Math.PI / 2), 3);
  near(v.vx, 3, 1e-12, 'a hull heading +x at 3 moves the planks +x');
});

test('the deck is where the planking is, and a claimed spot off it is put back on it', () => {
  assert.equal(deckAt(SLOOP, 0, 0), 0);
  assert.equal(deckAt(SLOOP, 0, 1.8), 0.1, 'the raised bow');
  assert.equal(deckAt(SLOOP, 0, 2.5), null, 'past the bow');
  assert.deepEqual(clampToDeck(SLOOP, 0.3, -9), [0.3, -2], 'a metre off the stern is the stern');
  assert.deepEqual(clampToDeck(SLOOP, 0.3, 0.5), [0.3, 0.5], 'on the deck already');
});

test('walking on a deck: a rail stops you and you slide along it, an open edge lets you off', () => {
  // Diagonally forward and to port: into the rail after 0.8, then along it.
  const s = { x: 0, z: 0, y: 0, vy: 0, grounded: true };
  for (let i = 0; i < 30; i++) stepDeck(s, { x: -0.7071, z: 0.7071 }, SLOOP, 1 / 30, WALK);
  assert.ok(!s.off, 'walked into the rail and fell off');
  assert.ok(s.x >= -1.05 + 0.05 + WALK.radius - 1e-9, `through the rail to ${s.x}`);
  // Within a step of it: a step into the rail is refused whole, as walk.js refuses one into a wall.
  near(s.x, -1 + WALK.radius, WALK.speed / 30, 'up against the rail');
  assert.ok(s.z > 1.3, `stuck on the rail at z ${s.z} instead of sliding along it`);
  // Straight up the middle onto the raised bow, which is stood on at its own height.
  const b = { x: 0, z: 0, y: 0, vy: 0, grounded: true };
  for (let i = 0; i < 25; i++) stepDeck(b, { x: 0, z: 1 }, SLOOP, 1 / 30, WALK);
  assert.equal(b.y, 0.1, 'standing on the raised bow');
  const t = { x: 0, z: 0, y: 0, vy: 0, grounded: true };
  for (let i = 0; i < 90 && !t.off; i++) stepDeck(t, { x: 0, z: -1 }, SLOOP, 1 / 30, WALK);
  assert.equal(t.off, true, 'walked off the open stern and was still aboard');
});

test('a jump comes down on the same planks, whatever the hull is doing under it', () => {
  // The frame is the deck, so the hull's own speed is not an input at all: this is the test
  // that says a boat at full speed does not leave a jumper behind in the water.
  const s = { x: 0.2, z: -0.5, y: 0, vy: 0, grounded: true };
  stepDeck(s, { x: 0, z: 0, jump: true }, SLOOP, 1 / 30, WALK);
  assert.equal(s.grounded, false);
  let top = 0;
  for (let i = 0; i < 120 && !s.grounded; i++) { stepDeck(s, { x: 0, z: 0 }, SLOOP, 1 / 30, WALK); top = Math.max(top, s.y); }
  assert.ok(s.grounded && !s.off, 'came down somewhere other than the deck');
  assert.deepEqual([s.x, s.z, s.y], [0.2, -0.5, 0], 'came down where they went up');
  assert.ok(top > 0.3, `a jump of ${top.toFixed(2)}`);
  // Over the side in mid-air is off the boat at once.
  const o = { x: 0.9, z: 0, y: 0, vy: 0, grounded: true };
  stepDeck(o, { x: 0, z: 0, jump: true }, SLOOP, 1 / 30, WALK);
  for (let i = 0; i < 30 && !o.off; i++) stepDeck(o, { x: 1, z: 0 }, SLOOP, 1 / 30, WALK);
  assert.equal(o.off, true, 'jumped over the open side and stayed aboard');
});

test('getting on is worked out once, and getting off takes the boat\'s way with you', () => {
  const f = frameOf(100, 40, 1.1);
  const [wx, wz] = toWorld(f, 0.5, 1);
  const on = boardAt(f, SLOOP, wx, wz);
  near(on.x, 0.5, 1e-9, 'where on the deck');
  near(on.z, 1, 1e-9, 'where on the deck');
  assert.equal(boardAt(f, SLOOP, ...toWorld(f, 3, 0)), null, 'three units off the beam is the water');
  const off = leaveDeck(f, on, 4);
  near(off.x, wx, 1e-9, 'left from where they stood');
  near(off.vx, 4 * Math.sin(1.1), 1e-9, 'with the hull\'s speed');
});

test('every boat today is a Benchy, and a Benchy is her pilot and nobody else', () => {
  for (const id of ['boat:a1b2c3d4', 'boat:a1b2c3d4-n1', 'boat:w-0123456789ab']) {
    assert.equal(kindOf(id), 'benchy');
    assert.equal(crewOf(id), 1);
  }
  const b = craftOf('boat:a1b2c3d4');
  assert.equal(deckAt(b, ...b.helm), 0, 'the helm is on her deck');
  // Every craft's helm stands on its own deck and clear of its own rails, or its pilot is
  // put somewhere the deck walk would refuse.
  for (const [kind, c] of Object.entries(CRAFTS)) {
    assert.notEqual(deckAt(c, ...c.helm), null, `${kind}'s helm is off its deck`);
    assert.ok(c.crew >= 1, `${kind} has no room for a pilot`);
  }
});

test('shared/deck.mjs and shared/crafts.mjs are arithmetic, like the rest of shared/', () => {
  for (const f of ['deck.mjs', 'crafts.mjs']) {
    const src = readFileSync(new URL(`../shared/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /Math\.(sin|cos|tan|atan2?|pow|exp|log)\b/, `a transcendental in shared/${f}`);
    assert.doesNotMatch(src, /from 'three'|Date\.now|performance/, `a clock or three.js in shared/${f}`);
  }
});
