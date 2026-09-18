// A crowd on a wire: what it costs and what survives the trip.
//
// The budget is asserted as a number rather than described, because the failure it guards
// against is silent. Nobody notices a format that got four times more expensive; they
// notice a stutter on a laptop six months later and blame the graphics.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeCrowd, decodeCrowd, crowdRoster, sliceCount, walkerEvery, GRID, KEYFRAME_S, WALKER_HZ, ANIMS } from '../shared/settlerwire.mjs';
import { createWalk, MAX_STROLL } from '../shared/settlerwalk.mjs';
import { makeTerrain } from '../shared/terrain.mjs';

const SIZE = 64;
const HALF = SIZE / 2;

// A village big enough to saturate the errand system, on a lane it can actually walk.
function crowd(n = 120) {
  const terrain = makeTerrain(1337, { size: SIZE });
  const mid = Math.round(terrain.half);
  const lane = [];
  for (let gx = 6; gx < SIZE - 6; gx++) if (terrain.isLand(gx, mid)) lane.push([gx, mid]);
  const walk = createWalk(terrain);
  walk.setRoads([{ id: 'lane', cells: lane }], lane.slice(0, 4));
  for (let i = 0; i < n && i < lane.length; i++) {
    const [gx, gz] = lane[i];
    const spec = { id: `house:${String(i).padStart(4, '0')}`, kind: 'house', name: `H${i}`, style: 'opus', plot: { gx, gz: gz + 1, w: 1, d: 1, rot: 0 } };
    const at = terrain.cellWorld(spec.plot.gx, spec.plot.gz);
    walk.spawn(spec.id, spec, [at[0], 0, at[1]], {}, 1);
  }
  return { terrain, walk, figures: walk.figures };
}

test('a position survives the trip to within the grid it was quantised on', () => {
  const c = crowd(20);
  c.walk.advance(600, 0);
  const { a, k } = encodeCrowd(c, { half: HALF, slices: 1 });
  const seen = decodeCrowd(k, HALF, decodeCrowd(a, HALF));
  let idx = -1, worst = 0;
  for (const f of c.figures.values()) {
    idx++;
    const got = seen.get(idx);
    assert.ok(got, `settler ${idx} did not travel`);
    worst = Math.max(worst, Math.abs(got.x - f.pos[0]), Math.abs(got.z - f.pos[1]));
    assert.equal(got.anim, f.anim);
  }
  // Half a quantisation step is the most a round trip can cost.
  assert.ok(worst <= 0.5 / GRID + 1e-9, `${worst} off, and the grid is 1/${GRID}`);
});

test('everybody is pinned exactly once per rotation, and nobody twice', () => {
  const c = crowd(120);
  c.walk.advance(600, 0);
  const slices = sliceCount(66);
  const heard = new Map();
  for (let beat = 0; beat < slices; beat++) {
    const { k } = encodeCrowd(c, { half: HALF, slice: beat, slices, movers: false });
    for (let i = 0; i < k.length; i += 4) heard.set(k[i], (heard.get(k[i]) || 0) + 1);
  }
  // Everybody standing still is in exactly one slice. A walker is not pinned at all - it
  // rides the faster stream instead - so the two sets together are the whole village.
  let idx = -1, still = 0;
  for (const f of c.figures.values()) {
    idx++;
    if (f.anim === 'walk' || f.aboard) continue;
    still++;
    assert.equal(heard.get(idx), 1, `settler ${idx} was pinned ${heard.get(idx)} times in one rotation`);
  }
  assert.ok(still > 0);
});

test('a walker is never also pinned', () => {
  const c = crowd(120);
  c.walk.advance(600, 0);
  const slices = sliceCount(66);
  for (let beat = 0; beat < slices; beat++) {
    const { a, k } = encodeCrowd(c, { half: HALF, slice: beat, slices, movers: true });
    const walkers = new Set();
    for (let i = 0; i < a.length; i += 4) walkers.add(a[i]);
    for (let i = 0; i < k.length; i += 4) assert.ok(!walkers.has(k[i]), `${k[i]} is in both halves`);
  }
});

test('a beat that carries no walkers leaves them out entirely', () => {
  const c = crowd(120);
  c.walk.advance(600, 0);
  const on = encodeCrowd(c, { half: HALF, slices: 200, slice: 0, movers: true });
  const off = encodeCrowd(c, { half: HALF, slices: 200, slice: 0, movers: false });
  assert.ok(on.a.length > 0, 'nobody was walking, so this proves nothing');
  assert.equal(off.a.length, 0);
  assert.deepEqual(off.k, on.k, 'and the pinned slice is the same either way');
});

// The budget. A number, so that a change which quadruples it fails here rather than in
// somebody's frame rate. Measured on this village at this tick: about 1.9 kB/s per island
// per viewer, with 35 settlers out on errands.
test('a saturated village costs less than the stated budget', () => {
  const c = crowd(274);
  c.walk.advance(3000, 0);            // long enough for the errand system to fill up
  const slices = sliceCount(66);
  const every = walkerEvery(66);
  const beats = 180;                  // twelve seconds at this tick
  let bytes = 0, walkers = 0;
  for (let beat = 0; beat < beats; beat++) {
    c.walk.advance(2, 0);
    const { a, k } = encodeCrowd(c, { half: HALF, slice: beat % slices, slices, movers: beat % every === 0 });
    if (a.length) walkers = Math.max(walkers, a.length / 4);
    if (a.length || k.length) bytes += Buffer.byteLength(JSON.stringify({ t: 'f', i: 'a84a82acc8646c6c', a, k }));
  }
  const perSecond = bytes / (beats * 66 / 1000);
  assert.ok(walkers > 5, `only ${walkers} were ever walking; the village never got busy`);
  assert.ok(perSecond < 3000, `${perSecond.toFixed(0)} B/s, and the budget is 3000`);
});

test('the two rates are what they say they are', () => {
  assert.equal(walkerEvery(66), 3, `${WALKER_HZ} Hz out of a 66 ms beat`);
  assert.equal(walkerEvery(1000), 1, 'a beat slower than the walker rate never skips anybody');
  assert.equal(sliceCount(66) * 66, 10032, `one rotation is about ${KEYFRAME_S} seconds`);
});

test('the roster carries ids and nothing else', () => {
  const c = crowd(8);
  const ids = crowdRoster(c);
  assert.equal(ids.length, 8);
  for (const id of ids) assert.equal(typeof id, 'string');
  // No colours. The far end hashes a face out of the id with the same shared/palette.mjs
  // this side uses, which is the whole reason a look is seeded off a building id.
  assert.equal(JSON.stringify(ids).includes('#'), false);
  assert.equal(JSON.stringify(ids).includes('tunic'), false);
});

test('nonsense off the wire is ignored rather than believed', () => {
  assert.equal(decodeCrowd(null, HALF).size, 0);
  assert.equal(decodeCrowd('nope', HALF).size, 0);
  assert.equal(decodeCrowd([1, 2], HALF).size, 0, 'a half row is no row');
  const one = decodeCrowd([0, 100, 200, 99], HALF);
  assert.equal(one.get(0).anim, 'still', 'an animation nobody has heard of is standing still');
  assert.deepEqual(ANIMS[0], 'still');
});
