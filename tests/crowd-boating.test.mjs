// The sea takes somebody out on the water.
//
// lib/crowd.mjs is the translation layer between a published bundle and a walking crowd,
// and this is the half of it that has nothing to do with walking: the quay it derives, the
// dinghy it lends, and the row that comes out the other end. It is asserted end to end
// rather than in pieces because the failure it is here for was an end-to-end one - every
// part worked and the outing still never happened, because a callback was landing in the
// wrong field two modules away (see tests/settler-walk.test.mjs).
//
// No loader and no document, like every test of shared/: the sea steps a crowd in Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCrowd } from '../lib/crowd.mjs';
import { makeTerrain } from '../shared/terrain.mjs';
import { quayFor } from '../shared/quay.mjs';
import { encodeRides, decodeRides } from '../shared/settlerwire.mjs';

const SIZE = 64;
const SEED = 1337;

// A bundle of the shape lib/fleet.mjs hands over: an island with a landing, a lane, and
// houses beside it. The landing is a real coast cell, because quaySite will not run planks
// out from anywhere else and a quay that cannot be built is the one way an island has of
// having no boats at all.
function bundle(terrain) {
  const mid = Math.round(terrain.half);
  const lane = [];
  for (let gx = 8; gx < SIZE - 8; gx++) if (terrain.isLand(gx, mid)) lane.push([gx, mid]);
  const landing = lane[lane.length - 1];
  const buildings = lane.slice(0, 10).map(([gx, gz], i) => ({
    id: `house:${String(i).padStart(4, '0')}`,
    kind: 'house', name: `House ${i}`, style: 'opus',
    plot: { gx, gz: gz + 1, w: 1, d: 1, rot: 0 },
  }));
  return {
    island: { name: 'Testholm', seed: SEED, gridSize: SIZE, landing },
    buildings,
    paths: [{ id: 'lane', cells: lane }],
    town: { paved: lane.slice(0, 4) },
  };
}

function island() {
  const terrain = makeTerrain(SEED, { size: SIZE });
  const b = bundle(terrain);
  assert.ok(quayFor(terrain, b.island.landing), 'the fixture has no quay to sail from');
  return { id: 'testholm', bundle: b, terrain };
}

test('somebody goes out on the water, and comes back', () => {
  const crowd = createCrowd(island());
  assert.ok(crowd.figures.size > 0, 'nobody lives here');

  let afloat = 0;
  let sample = null;
  let ashoreAgain = false;
  for (let i = 0; i < 30000; i++) {
    crowd.advance(1, 0);
    const rides = crowd.rides();
    if (rides.length) { afloat++; sample = sample || rides[0]; }
    else if (afloat) { ashoreAgain = true; break; }
  }
  assert.ok(afloat > 0, 'nobody ever left the quay in half an hour of village time');
  assert.ok(ashoreAgain, 'somebody went out and never came back');

  // A row has to name a settler the roster already knows, or the far end has a hull with
  // nobody in it and no way to find out whose it is.
  assert.equal(typeof sample.idx, 'number');
  assert.ok(sample.idx >= 0 && sample.idx < crowd.figures.size);
  assert.equal([...crowd.figures.values()][sample.idx].id, sample.id);

  // And it has to survive the wire, in the island's own frame.
  const back = decodeRides(encodeRides([sample], 32), 32).get(sample.idx);
  assert.ok(Math.abs(back.x - sample.x) < 0.05 && Math.abs(back.z - sample.z) < 0.05);
});

test('an island with nowhere to land simply never sails', () => {
  const it = island();
  // No landing at all, which is what an island whose scan has not found one looks like.
  it.bundle = { ...it.bundle, island: { ...it.bundle.island, landing: null } };
  const crowd = createCrowd(it);
  for (let i = 0; i < 4000; i++) crowd.advance(1, 0);
  // Not an error and not an empty crowd: the village walks, it just has no quay.
  assert.deepEqual(crowd.rides(), []);
  assert.ok(crowd.figures.size > 0);
});
