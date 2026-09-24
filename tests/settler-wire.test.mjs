// A crowd on a wire: what it costs and what survives the trip.
//
// The budget is asserted as a number rather than described, because the failure it guards
// against is silent. Nobody notices a format that got four times more expensive; they
// notice a stutter on a laptop six months later and blame the graphics.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeCrowd, decodeCrowd, encodeRides, decodeRides, encodeHeld, decodeHeld, crowdRoster, sliceCount, walkerEvery, GRID, TURNS, KEYFRAME_S, WALKER_HZ, ANIMS } from '../shared/settlerwire.mjs';
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

// The step off the road. A walker's last word was a position on the lane with 'walk' on
// it, and without this the word that they had stopped came round with their slice - up to
// ten seconds later, during which the far end stood them a stride short of their own door
// treading in a walking gait. So the first beat on which somebody the sea has sent as a
// walker is no longer walking carries their row, whichever slice it is - and only that
// beat, or the saving on the slow rotation is spent again.
test('the step off the road is said on the beat it happens, and said once', () => {
  const c = crowd(120);
  c.walk.advance(600, 0);
  const slices = sliceCount(66);
  const every = walkerEvery(66);
  const figs = [...c.figures.values()];
  const walking = new Set();
  const sent = new Set();             // whom we have heard called a walker, and not yet heard stop
  let stops = 0, late = 0;
  for (let beat = 0; beat < 1500; beat++) {
    c.walk.advance(1, 0);
    const { a, k } = encodeCrowd(c, { half: HALF, slice: beat % slices, slices, movers: beat % every === 0, walking });
    const inA = new Set(), inK = new Set();
    for (let i = 0; i < a.length; i += 4) inA.add(a[i]);
    for (let i = 0; i < k.length; i += 4) inK.add(k[i]);
    for (const idx of sent) {
      const f = figs[idx];
      if (f.anim === 'walk' || f.aboard || !f.visible) continue;
      stops++;
      if (!inK.has(idx)) late++;
      sent.delete(idx);
    }
    // Nobody is pinned out of turn unless they had just been walking.
    for (const idx of inK) {
      if (idx % slices !== beat % slices) assert.ok(figs[idx].anim !== 'walk', `${idx} pinned out of turn while still walking`);
    }
    for (const idx of inA) sent.add(idx);
  }
  assert.ok(stops > 3, `only ${stops} errands ended in a hundred seconds; the village never got going`);
  assert.equal(late, 0, `${late} of ${stops} stops waited for their slice to come round`);
});

test('without a set to keep, the encoder says nothing out of turn', () => {
  const c = crowd(120);
  c.walk.advance(600, 0);
  const slices = sliceCount(66);
  for (let beat = 0; beat < 300; beat++) {
    c.walk.advance(1, 0);
    const { k } = encodeCrowd(c, { half: HALF, slice: beat % slices, slices, movers: beat % 3 === 0 });
    for (let i = 0; i < k.length; i += 4) assert.equal(k[i] % slices, beat % slices, `${k[i]} was pinned outside its slice`);
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

// ---- the dinghies -------------------------------------------------------------------

const TAU = Math.PI * 2;
const RIDE = {
  idx: 3, x: 7.25, z: -11.5, yaw: 2.1,
  rx: 7.1, rz: -11.4, ry: 0.049, ryaw: -1.4,
};

test('an outing survives the trip, hull and rider both', () => {
  const back = decodeRides(encodeRides([RIDE], HALF), HALF);
  const got = back.get(3);
  assert.ok(got, 'the outing did not travel');
  const step = 0.5 / GRID;
  for (const k of ['x', 'z', 'rx', 'rz', 'ry']) {
    assert.ok(Math.abs(got[k] - RIDE[k]) <= step, `${k} came back ${got[k]}, not ${RIDE[k]}`);
  }
  // A heading wraps, so the two have to be compared the long way round.
  for (const k of ['yaw', 'ryaw']) {
    let d = got[k] - RIDE[k];
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    assert.ok(Math.abs(d) <= TAU / TURNS, `${k} came back ${got[k]}, not ${RIDE[k]}`);
  }
});

test('an empty message takes the hull back out of the water', () => {
  const into = decodeRides(encodeRides([RIDE], HALF), HALF);
  assert.equal(into.size, 1);
  // The same map, handed the beat on which nobody is sailing. It has to come back empty:
  // the far end disposes a hull precisely because its row stopped arriving.
  decodeRides([], HALF, into);
  assert.equal(into.size, 0);
  decodeRides(null, HALF, into);
  assert.equal(into.size, 0, 'nonsense is an empty sea, not the last one kept');
});

test('somebody in a boat is left out of the crowd entirely', () => {
  const c = crowd(12);
  const first = [...c.figures.values()][0];
  // Chartered and carried, which is what an outing does to a settler.
  c.walk.charter(first.id);
  c.walk.carry(first.id, () => ({ x: 1, z: 2, yaw: 0, y: 0.05 }));
  c.walk.advance(2, 0);
  const { a, k } = encodeCrowd(c, { half: HALF, slices: 1 });
  const seen = decodeCrowd(k, HALF, decodeCrowd(a, HALF));
  assert.equal(seen.has(0), false, 'a rider was described twice, by the crowd and by its boat');
  assert.equal(seen.size, 11, 'and everybody else still travelled');
});

test('what an outing costs, as a number rather than a feeling', () => {
  const c = crowd(274);
  c.walk.advance(1200, 0);
  const { a, k } = encodeCrowd(c, { half: HALF, slices: sliceCount(66) });
  const crowdBytes = JSON.stringify({ a, k }).length;

  // Almost every beat: nobody is out, and the field is four bytes saying so. That is what
  // makes the shape affordable, so it is the half worth pinning.
  assert.ok(JSON.stringify({ b: encodeRides([], HALF) }).length <= 8,
    'an island with nobody on the water should cost nothing to say so');

  // And the worst beat there is: MAX_OUT in shared/boating.mjs is two, so this is the most
  // an island can ever have out at once. Not a rounding error - about a third again on top
  // of the crowd - which is the number the header's reasoning rests on.
  const b = encodeRides([RIDE, { ...RIDE, idx: 9 }], HALF);
  const rideBytes = JSON.stringify({ b }).length;
  assert.ok(rideBytes < crowdBytes / 2,
    `both boats out is ${rideBytes} B against the crowd's ${crowdBytes} B a beat`);
});

// ---- being spoken to ------------------------------------------------------------------
//
// A held settler is 'still', so no row says it has turned; this list is the only thing that
// does. Plans/aangesproken-settler-draait-zich-om.md has the reasoning for a separate list.

test('who is held travels with where the talker stands, and nobody else does', () => {
  const c = crowd(12);
  c.walk.advance(200, 0);
  assert.deepEqual(encodeHeld(c, HALF), [], 'nobody is talking, and the list says somebody is');
  const fs = [...c.figures.values()];
  const at = [fs[3].pos[0] + 1.2, fs[3].pos[1] - 0.4];
  c.walk.attend(fs[3].id, at);
  c.walk.attend(fs[7].id, null);   // held where they stand, the way an attend with no point is
  const h = encodeHeld(c, HALF);
  assert.equal(h.length, 6, 'two held, three numbers each');
  assert.ok(h.every(Number.isInteger), 'a held row is small integers, like every other row');
  const back = decodeHeld(h, HALF);
  assert.deepEqual([...back.keys()], [3, 7]);
  const got = back.get(3);
  const step = 0.5 / GRID;
  assert.ok(Math.abs(got.x - at[0]) <= step && Math.abs(got.z - at[1]) <= step,
    `the talker came back at ${got.x},${got.z} instead of ${at}`);

  // Let go of, and gone from the list; a body out of sight is never held on the wire.
  c.walk.unattend(fs[3].id);
  c.walk.setVisible(fs[7].id, false);
  assert.deepEqual(encodeHeld(c, HALF), []);
});

test('somebody standing in a boat is not held on the wire, whatever the slot says', () => {
  // The walk tests `aboard` before `attend`: a hull decides which way its rider faces.
  const c = crowd(4);
  const f = [...c.figures.values()][0];
  c.walk.attend(f.id, [0, 0]);
  c.walk.charter(f.id);
  c.walk.carry(f.id, () => ({ x: 1, z: 2, yaw: 0, y: 0.05 }));
  assert.deepEqual(encodeHeld(c, HALF), []);
});

test('the held list is the whole set: an empty one lets everybody go', () => {
  const into = decodeHeld([2, 1000, 1100, 5, 900, 900], HALF);
  assert.equal(into.size, 2);
  decodeHeld([5, 900, 900], HALF, into);
  assert.deepEqual([...into.keys()], [5], 'a list is the truth, not an addition to the last one');
  decodeHeld([], HALF, into);
  assert.equal(into.size, 0);
  decodeHeld(null, HALF, into);
  assert.equal(into.size, 0, 'nonsense is nobody held, not the last set kept');
  assert.equal(decodeHeld([1, 2], HALF).size, 0, 'a half row is no row');
  assert.equal(decodeHeld([1, 'x', 3], HALF).size, 0, 'a word where a number goes is no row');
});

test('what a conversation costs, as a number rather than a feeling', () => {
  // Said once when it starts and once when it ends, so it is the message that is priced,
  // not a rate. The island id is the sixteen hex characters a beacon id has.
  const c = crowd(274);
  const f = [...c.figures.values()].pop();   // the last index: the longest one to write
  c.walk.attend(f.id, [f.pos[0] + 1, f.pos[1]]);
  const said = JSON.stringify({ t: 'fh', i: '0123456789abcdef', h: encodeHeld(c, HALF) });
  assert.ok(said.length <= 60, `one conversation is ${said.length} B to say`);
  const done = JSON.stringify({ t: 'fh', i: '0123456789abcdef', h: [] });
  assert.ok(done.length <= 45, `letting go is ${done.length} B`);
});
