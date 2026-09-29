// Standing on a moving boat (shared/deck.mjs, shared/crafts.mjs - Plans/DONE/lopen-op-de-boot.md,
// the groundwork for fase 2 and 3). Nothing draws or sails a deck yet: every boat is still a
// Benchy with room for her pilot. What is held here is the arithmetic a bigger boat will
// stand on, so it is right before anybody is on it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toWorld, toLocal, dirToWorld, dirToLocal, hullVelocity, deckAt, clampToDeck, stepDeck, boardAt, leaveDeck, ladderPath, pathLength, pathAt, ladderUp, ladderDown } from '../shared/deck.mjs';
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

test('an island\'s first boat is its galleon, every other boat a Benchy, and a Benchy is her pilot alone', () => {
  for (const id of ['boat:a1b2c3d4-n1', 'boat:a1b2c3d4-w2', 'boat:w-0123456789ab']) {
    assert.equal(kindOf(id), 'benchy');
    assert.equal(crewOf(id), 1);
  }
  assert.equal(kindOf('boat:a1b2c3d4'), 'galleon');
  assert.equal(crewOf('boat:a1b2c3d4'), 5);
  const b = craftOf('boat:a1b2c3d4-n1');
  assert.equal(deckAt(b, ...b.helm), 0, 'the helm is on her deck');
  // Every craft's helm stands on its own deck and clear of its own rails, or its pilot is
  // put somewhere the deck walk would refuse.
  for (const [kind, c] of Object.entries(CRAFTS)) {
    assert.notEqual(deckAt(c, ...c.helm), null, `${kind}'s helm is off its deck`);
    assert.ok(c.crew >= 1, `${kind} has no room for a pilot`);
  }
});

// walk.js's own numbers (WALK_SPEED, WALK_BODY_R, JUMP_V, GRAVITY), which tests/deck-walk.test.mjs
// would read off the source if it came to that: they are the ones the ship is a cage or not by.
const GO = { speed: 3.4, radius: 0.16, jumpV: 3.1, gravity: 12.5 };
const DT = 1 / 60;
const galleon = CRAFTS.galleon;

test('a bulwark stops a walker and a jump goes over it, which is how you leave a ship', () => {
  // Walking at the waist's starboard rail: stopped short of it, still aboard.
  const w = { x: 0.6, z: 1.2, y: 1.108, vy: 0, grounded: true };
  for (let i = 0; i < 120; i++) stepDeck(w, { x: 1, z: 0 }, galleon, DT, GO);
  assert.ok(!w.off, 'walked through the bulwark');
  assert.ok(w.x > 1.5 && w.x < 1.9, `stopped at ${w.x}`);
  // The same, jumping as they arrive: over the side, and off the boat.
  const j = { x: 0.6, z: 1.2, y: 1.108, vy: 0, grounded: true };
  let off = false;
  for (let i = 0; i < 240 && !off; i++) {
    stepDeck(j, { x: 1, z: 0, jump: i > 45 && j.grounded }, galleon, DT, GO);
    off = !!j.off;
  }
  assert.ok(off, 'jumped at the rail and stayed aboard');
  assert.ok(j.y > galleon.rails[0].top - 0.05, `left the planks at ${j.y}, under the bulwark`);
  // Standing against it and jumping is enough: no run-up is asked for.
  const st = { x: 1.65, z: 1.2, y: 1.108, vy: 0, grounded: true };
  let over = false;
  for (let i = 0; i < 120 && !over; i++) {
    stepDeck(st, { x: 1, z: 0, jump: st.grounded }, galleon, DT, GO);
    over = !!st.off;
  }
  assert.ok(over, 'a standing jump at the rail did not clear it');
});

test('a mast is not gone over, however high you jump', () => {
  const s = { x: 0.7, z: 0, y: 1.108, vy: 0, grounded: true };
  for (let i = 0; i < 120; i++) stepDeck(s, { x: -1, z: 0, jump: s.grounded }, galleon, DT, GO);
  assert.ok(!s.off && s.x > 0.15 + GO.radius - 1e-9, `through the mainmast to ${s.x}`);
});

test('every bulwark can be cleared by a jump from at least one side, or a corner of the ship is a cage', () => {
  const apex = (GO.jumpV * GO.jumpV) / (2 * GO.gravity);
  for (const r of galleon.rails) {
    if (r.top === undefined) continue;
    // The planking a body stands on beside it, on each of its four sides: the one it is a bulwark
    // to is the one where it stands lowest against it - and a wall between two decks (the
    // quarterdeck's front) is a bulwark from the upper one and a wall from the lower.
    const floors = [[r.hx + 0.3, 0], [-(r.hx + 0.3), 0], [0, r.hz + 0.3], [0, -(r.hz + 0.3)]]
      .map(([dx, dz]) => deckAt(galleon, r.x + dx, r.z + dz)).filter((f) => f !== null);
    assert.ok(floors.length, `the rail at ${r.x},${r.z} has no planking beside it`);
    const over = r.top - Math.max(...floors);
    assert.ok(over < apex - 0.08, `the rail at ${r.x},${r.z} stands ${over.toFixed(2)} over the highest planking beside it, a jump is ${apex.toFixed(2)}`);
  }
});

test('the aft stairs are walked up from their foot, and the wall beside them is not', () => {
  const walk = (x, z, dir, steps = 240) => {
    const s = { x, z, y: deckAt(galleon, x, z), vy: 0, grounded: true };
    const ys = [];
    for (let i = 0; i < steps && !s.off; i++) { stepDeck(s, dir, galleon, DT, GO); ys.push(s.y); }
    return { s, ys };
  };
  for (const side of [1, -1]) {
    // Aft up the flight: on the quarterdeck at the end, with the height never jumping by more than a
    // stride's rise (0.97 a unit at 3.4 a second is 0.055 a frame at 60 - a step of 0.6 is a wall).
    const up = walk(side * 1.5, -0.9, { x: 0, z: -1 }, 60);
    assert.ok(!up.s.off, 'fell off the stairs');
    assert.ok(up.s.z < -2.3 && Math.abs(up.s.y - 1.738) < 1e-9, `ended at z ${up.s.z.toFixed(2)}, y ${up.s.y.toFixed(3)}`);
    for (let i = 1; i < up.ys.length; i++) assert.ok(Math.abs(up.ys[i] - up.ys[i - 1]) < 0.08, `a step of ${(up.ys[i] - up.ys[i - 1]).toFixed(2)}`);
    // Straight at the bulkhead between the flights: stopped at its foot, on the waist, not on top of it.
    const wall = walk(side * 0.3, -1.0, { x: 0, z: -1 });
    assert.ok(wall.s.y === 1.108 && wall.s.z > -2.2, `climbed the wall to z ${wall.s.z.toFixed(2)}, y ${wall.s.y}`);
    // Along the foot of the stringer at the flight's side: no way up from there either.
    const side_ = walk(side * 1.0, -0.9, { x: 0, z: -1 });
    assert.ok(side_.s.y === 1.108, `up the side of the flight at y ${side_.s.y}`);
  }
  // Jumping the balustrade from the quarterdeck lands in the waist, which is a way down and not a way up.
  const j = { x: 0, z: -2.9, y: 1.738, vy: 0, grounded: true };
  let over = false;
  for (let i = 0; i < 240 && !over; i++) {
    stepDeck(j, { x: 0, z: 1, jump: j.grounded && j.z > -2.75 }, galleon, DT, GO);
    over = j.grounded && j.z > -2.2;
  }
  assert.ok(over && j.y === 1.108, `jumped the balustrade to z ${j.z.toFixed(2)}, y ${j.y}`);
});

test('the forecastle and the bow are climbed by ramps, and the whole ship is one connected deck', () => {
  // Along the centreline from the stern to the tip of the bow the planking never breaks off and no
  // step is bigger than a riser of the bake's (0.2 is the forecastle's, 0.21 the poop's).
  let last = null;
  for (let z = -6; z <= 5.8; z += 0.05) {
    const y = deckAt(galleon, 0.1, z);
    if (y === null) { assert.ok(z < -5.5 || z > 5.7, `a hole in the deck at z ${z.toFixed(2)}`); last = null; continue; }
    if (last !== null && Math.abs(z + 2.3) > 0.06) assert.ok(Math.abs(y - last) < 0.25, `a step of ${(y - last).toFixed(2)} at z ${z.toFixed(2)}`);
    last = y;
  }
  assert.ok(Math.abs(deckAt(galleon, 0.1, 5.5) - 1.9) < 0.05, 'the bow deck at 5.5');
});

test('a rope ladder is walked into at its foot and out onto at its head, on either side', () => {
  assert.equal(galleon.ladders.length, 2, 'one over each side');
  assert.deepEqual(galleon.ladders.map((l) => Math.sign(l.x)).sort(), [-1, 1]);
  for (const l of galleon.ladders) {
    const s = Math.sign(l.x);
    // Treading water just outside the ropes, pushing at the hull.
    assert.equal(ladderUp(galleon, s * (Math.abs(l.x) + 0.2), l.z, -0.13, -s), l, 'at the foot, pushing in');
    assert.equal(ladderUp(galleon, s * (Math.abs(l.x) + 0.2), l.z, -0.13, 0), null, 'at the foot but not pushing');
    assert.equal(ladderUp(galleon, s * (Math.abs(l.x) + 0.2), l.z, -0.13, s), null, 'at the foot, pushing away');
    assert.equal(ladderUp(galleon, s * (Math.abs(l.x) + 0.2), l.z + 1.5, -0.13, -s), null, 'a swimmer further along the hull');
    assert.equal(ladderUp(galleon, s * (Math.abs(l.x) + 2), l.z, -0.13, -s), null, 'two units out is not the foot');
    assert.equal(ladderUp(galleon, s * (Math.abs(l.x) + 0.2), l.z, 1.1, -s), null, 'not from the deck');
    // On the deck at its head, pushing over the side - and only squarely so.
    assert.equal(ladderDown(galleon, s * 1.5, l.z, s), l, 'at the head, pushing out');
    assert.equal(ladderDown(galleon, s * 1.5, l.z, s * 0.6), null, 'sliding along the rail with a little push');
    assert.equal(ladderDown(galleon, s * 0.5, l.z, s), null, 'in the middle of the deck');
    assert.equal(ladderDown(galleon, s * 1.5, l.z + 1.5, s), null, 'further along the rail');
  }
  // The Benchy has none, so none of it ever fires there.
  assert.equal(ladderUp(CRAFTS.benchy, 0.5, 0, -0.1, -1), null);
  assert.equal(ladderDown(CRAFTS.benchy, 0.05, 0, 1), null);
});

test('a ladder runs from the water over the bulwark to somewhere you can stand', () => {
  for (const l of galleon.ladders) {
    const path = ladderPath(galleon, l, -0.13);
    const first = path[0], last = path[path.length - 1];
    assert.equal(first.y, -0.13, 'starts where the swimmer is');
    assert.ok(Math.abs(first.x) > Math.abs(l.x), 'on the outside of the ropes');
    assert.equal(last.y, deckAt(galleon, last.x, last.z), 'ends on the planks');
    // Clear of every rail, or the first step after it is refused whole.
    for (const r of galleon.rails) {
      assert.ok(Math.abs(last.x - r.x) >= r.hx + GO.radius || Math.abs(last.z - r.z) >= r.hz + GO.radius,
        `the landing is inside the rail at ${r.x},${r.z}`);
    }
    // Over the bulwark, never through it: the path is above the wall the ladder hangs over
    // (`top` is the bake's, not the rail's - the rail is what a jump has to clear) wherever it
    // is over it, from the outside of the hull to the rail's inner face.
    const total = pathLength(path);
    for (let d = 0; d <= total; d += 0.02) {
      const p = pathAt(path, d);
      if (Math.abs(p.x) > 1.9 && Math.abs(p.x) < Math.abs(l.x)) assert.ok(p.y >= l.top - 0.001, `${p.y} through the bulwark at x ${p.x}`);
    }
    // Endpoints exactly, and clamped beyond.
    assert.deepEqual([pathAt(path, 0).x, pathAt(path, 0).y], [first.x, first.y]);
    assert.deepEqual([pathAt(path, total + 5).x, pathAt(path, total + 5).y], [last.x, last.y]);
    assert.ok(total > 2 && total < 4, `a climb of ${total.toFixed(2)}`);
  }
});

test('shared/deck.mjs and shared/crafts.mjs are arithmetic, like the rest of shared/', () => {
  for (const f of ['deck.mjs', 'crafts.mjs']) {
    const src = readFileSync(new URL(`../shared/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /Math\.(sin|cos|tan|atan2?|pow|exp|log)\b/, `a transcendental in shared/${f}`);
    assert.doesNotMatch(src, /from 'three'|Date\.now|performance/, `a clock or three.js in shared/${f}`);
  }
});
