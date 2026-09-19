// Somebody new walking up from the landing beach.
//
// This used to be the browser steering one body of its own simulation, which meant it
// happened on the keeper's screen and nowhere else. The sea walks every crowd now, so it
// is the sea that has to notice - and what it notices with is nothing more than the crowd
// that stood here before this one: no flag in the bundle, no timestamp to trust, just the
// difference between two sets of names.
//
// Three things have to hold, and the last two are the ones that would go wrong quietly:
// a newcomer walks, a village that was already here does not, and a scan that catches up
// after a week does not march fifty people up the beach at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCrowd, createCrowds } from '../lib/crowd.mjs';
import { makeTerrain } from '../shared/terrain.mjs';

const SIZE = 64;
const SEED = 1337;

// A lane of houses along the middle of the island, with the landing at the far end of it
// so there is a real path to walk. Anything less and walkIn gives up and the assertions
// below pass for the wrong reason.
function island(n, id = 'testholm') {
  const terrain = makeTerrain(SEED, { size: SIZE });
  const mid = Math.round(terrain.half);
  const lane = [];
  for (let gx = 8; gx < SIZE - 8; gx++) if (terrain.isLand(gx, mid)) lane.push([gx, mid]);
  const buildings = lane.slice(0, n).map(([gx, gz], i) => ({
    id: `house:${String(i).padStart(4, '0')}`,
    kind: 'house', name: `House ${i}`, style: 'opus',
    plot: { gx, gz: gz + 1, w: 1, d: 1, rot: 0 },
  }));
  return {
    id,
    terrain,
    bundle: {
      island: { name: 'Testholm', seed: SEED, gridSize: SIZE, landing: lane[lane.length - 1] },
      buildings,
      paths: [{ id: 'lane', cells: lane }],
      town: { paved: lane.slice(0, 4) },
    },
  };
}

const idsOf = (crowd) => new Set([...crowd.figures.values()].map((f) => f.id));
const far = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

test('a newcomer comes up the beach, and the neighbours do not', () => {
  const before = createCrowd(island(6));
  before.advance(200, 0);

  // One more house, and the crowd rebuilt the way a republish rebuilds it.
  const after = createCrowd(island(7), { known: idsOf(before) });
  const newcomer = [...after.figures.values()].find((f) => f.id === 'house:0006');
  assert.ok(newcomer, 'the seventh house has nobody in it');

  const landing = island(7).bundle.island.landing;
  const terrain = island(7).terrain;
  const beach = terrain.cellWorld(landing[0], landing[1]);
  assert.ok(far(newcomer.pos, beach) < 2, `started at ${newcomer.pos}, not at the landing ${beach}`);
  assert.equal(newcomer.mode, 'walk');

  // Everybody else starts at their own door, exactly as they always have.
  for (const f of after.figures.values()) {
    if (f.id === 'house:0006') continue;
    assert.notEqual(f.mode, 'walk', `${f.id} set off up the beach and lives here`);
  }

  // And they actually get somewhere: a path that cannot be walked is the failure this is
  // really guarding, and it looks identical to success for the first frame.
  const from = [...newcomer.pos];
  after.advance(400, 0);
  assert.ok(far(newcomer.pos, from) > 3, 'the newcomer stood on the beach');
});

test('the first crowd an island ever has is not a boatload of arrivals', () => {
  // `known` is null after the sea restarts, or the first time an island publishes. A whole
  // village coming ashore at once is not what anybody meant by "somebody arrived", and it
  // is also the most expensive thing this file can be asked to do.
  const crowd = createCrowd(island(6));
  for (const f of crowd.figures.values()) assert.notEqual(f.mode, 'walk');
});

test('a scan catching up after a week does not march everybody up the beach', () => {
  const before = createCrowd(island(2));
  const after = createCrowd(island(24), { known: idsOf(before) });
  const walking = [...after.figures.values()].filter((f) => f.mode === 'walk');
  assert.equal(walking.length, 0, `${walking.length} people came ashore in one go`);
});

test('the collection notices a newcomer without being told', () => {
  // The join path, which is what a republish actually calls: the previous crowd is still
  // in the map when the new one is built, and that is the whole mechanism.
  const crowds = createCrowds();
  crowds.join(island(6));
  crowds.get('testholm').advance(100, 0);

  const grown = crowds.join(island(7));
  const newcomer = [...grown.figures.values()].find((f) => f.id === 'house:0006');
  assert.ok(newcomer);
  assert.equal(newcomer.mode, 'walk', 'a republish did not notice the new house');

  // And republishing the same village again leaves everybody where they were.
  const same = crowds.join(island(7));
  assert.equal([...same.figures.values()].filter((f) => f.mode === 'walk').length, 0);
});
