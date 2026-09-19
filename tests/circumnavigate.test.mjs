// You can get round your own island.
//
// Not an obvious promise: web/js/boat.js refuses any step whose *bow* would touch ground
// above BOAT_FLOAT, and it refuses it hard - a grounding throws the way away rather than
// sliding along the coast - so a shoal, a spit or a strait one cell too narrow is a wall
// and not a scrape. Whether a whole coast has a way round it is therefore a question about
// the terrain and the hull together, and neither half answers it alone.
//
// Sailed rather than reasoned about, and sailed with the same pure stepBoat the browser
// uses (tests/boat.test.mjs makes the same argument for the crossing): a helm that only
// ever pushes ahead, aiming a fixed step further round a circle, at a fixed 60 Hz. If that
// gets round, a person with a reverse gear certainly can.
//
// It is also the answer to what a grounding *is*. Sailing due west out of Promptholm's
// quay stops dead on a bar a dozen units out, and the right conclusion is not that the sea
// is broken - it is that you have to stand off. STANDOFF is how far off, and it is asserted
// to be inside the island's own half: a ring you have to leave the grid to reach would be
// no answer at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { makeTerrain } from '../shared/terrain.mjs';
register('./support/shared-loader.mjs', import.meta.url);

globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { stepBoat, BOAT_FLOAT } = await import('../web/js/boat.js');
delete globalThis.document;

const SIZE = 256;
const SEEDS = [1337, 7, 90210];
const DT = 1 / 60;
const norm = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

// How wide a lane of open water counts as sea room, and how far off the island one starts.
//
// Not the smallest circle on which every bearing happens to float. That circle exists on
// every seed and is useless: on 90210 it is 119, one bearing is still foul at 118, and a
// hull that loses a single unit of offing rounding a headland is on the headland. A boat
// needs a lane, so this measures one and sails down the middle of it - which is also what
// standing off means to anybody who has done it.
const BAND = 4;

// The innermost lane BAND wide with open water all the way round it, given as the radius
// of its middle. Stepped a whole cell at a time, because half a cell is below the
// resolution of what is being measured, and it has to fit inside the grid: a lane you
// would have to leave the heightfield to reach is no answer.
function standoff(terrain) {
  for (let r = 8; r + BAND <= terrain.half; r += 1) {
    let clear = true;
    for (let d = 0; d <= BAND && clear; d += 1) {
      for (let i = 0; i < 360 && clear; i += 1) {
        const a = (i * Math.PI) / 180;
        if (terrain.worldHeight(Math.cos(a) * (r + d), Math.sin(a) * (r + d)) >= BOAT_FLOAT) clear = false;
      }
    }
    if (clear) return r + BAND / 2;
  }
  return null;
}

for (const seed of SEEDS) {
  test(`a boat can sail right round the island (seed ${seed})`, () => {
    const terrain = makeTerrain(seed, { size: SIZE });
    const R = standoff(terrain);
    assert.ok(R, 'there is a lane of open water round the island');
    assert.ok(R < terrain.half, `standing off ${R} is still inside the grid (half ${terrain.half})`);

    const height = (x, z) => terrain.worldHeight(x, z);
    const b = { x: R, z: 0, yaw: 0, v: 0 };
    // Pointed along the ring to start with, so the first second is not spent turning.
    b.yaw = Math.atan2(Math.cos(0.35) * R - b.x, Math.sin(0.35) * R - b.z);

    let turned = 0, prev = 0, aground = 0;
    // Four minutes of sailing at 60 Hz. A lap of this ring is about ninety seconds at the
    // hull's top speed, so the ceiling is loose enough to allow a clumsy helm and tight
    // enough that a boat going nowhere fails rather than hangs.
    for (let i = 0; i < 4 * 60 * 60 && Math.abs(turned) < 2 * Math.PI; i++) {
      const a = Math.atan2(b.z, b.x);
      const r = Math.hypot(b.x, b.z);
      // Hold the ring, rather than aim along it. Steering at a point a fixed step further
      // round is steering along a chord, and a chord falls inside its own circle: the first
      // helm written here lost three units of offing a quarter of the way round and put the
      // bow on the coast it was supposed to be clearing. So the bearing is the tangent -
      // anticlockwise, which is (-sin a, cos a) where yaw's forward is (sin yaw, cos yaw) -
      // with a nudge outwards worth however much offing has been lost.
      const k = 0.15 * (R - r);
      const fx = -Math.sin(a) + k * Math.cos(a);
      const fz = Math.cos(a) + k * Math.sin(a);
      const err = norm(Math.atan2(fx, fz) - b.yaw);
      // The tiller is an axis, and yaw falls to starboard - see the note at the top of
      // web/js/boat.js. Full over until the bow is within a few degrees.
      const turn = Math.abs(err) < 0.02 ? 0 : (err > 0 ? -1 : 1);
      stepBoat(b, { throttle: 1, turn }, DT, height);
      if (b.aground) aground++;
      turned += norm(a - prev);
      prev = a;
    }
    assert.equal(aground, 0, `the hull touched ground ${aground} times on the way round`);
    assert.ok(Math.abs(turned) >= 2 * Math.PI, `only got ${(turned / (2 * Math.PI)).toFixed(2)} of the way round`);
  });
}

test('and Promptholm asks you to stand off, rather than letting you out of the quay due west', () => {
  const terrain = makeTerrain(1337, { size: SIZE });
  // The bar off the kade, which is what a straight run out of the harbour finds. Recorded
  // so that a change in the coast that quietly opens or closes it is visible here.
  const b = { x: -57.5, z: 69.2, yaw: -Math.PI / 2, v: 0 };
  for (let i = 0; i < 60 * 60 && !b.aground; i++) stepBoat(b, { throttle: 1, turn: 0 }, DT, (x, z) => terrain.worldHeight(x, z));
  assert.ok(b.aground, 'due west out of the kade runs onto something');
  assert.ok(standoff(terrain) < terrain.half, 'and there is a lane round it that stays on the grid');
});
