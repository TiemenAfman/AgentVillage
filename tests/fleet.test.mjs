// The sea's idea of who is here.
//
// Three things are worth asserting and they are all about *not* changing: an island keeps
// its berth, an island keeps its claim, and an island whose code disagrees with ours is
// refused outright rather than drawn in the wrong shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

import { createFleet, GRACE_MS } from '../lib/fleet.mjs';
import { buildBundle, beaconId } from '../lib/islandbundle.mjs';
import { makeTerrain } from '../shared/terrain.mjs';
import { clearOf } from '../shared/regions.mjs';

// The smallest island that is still a real one: a seed, a grid, a true terrain hash and
// one house, packed by the same buildBundle an islander would use.
function island({ seed = 1337, size = 64, port = 4747, name = 'Promptholm', polders = [], buildings = [], placements = null } = {}) {
  const terrain = makeTerrain(seed, { size, polders });
  const id = beaconId(port, `host-${port}`);
  const village = {
    generatedAt: '2026-09-18T10:00:00.000Z',
    island: {
      name, seed, gridSize: size, terrainHash: terrain.hash,
      foundedAt: '2026-09-16T10:22:44.431Z',
      landing: [40, 50], town: { gx: 32, gz: 32, r: 8, paved: [] }, lattice: null,
    },
    grid: { size },
    districts: [], buildings, paths: [], bridges: [], cleared: [], polders,
    milestones: [], active: [], assignments: [], stats: {},
  };
  const bundle = buildBundle({ config: { islandName: name, seed, port, gridSize: size }, village, id, keeper: 'Martijn', placements });
  return { id, bundle: JSON.parse(JSON.stringify(bundle)), terrain };
}

test('the first island to publish is at the middle of the world', () => {
  const f = createFleet();
  const a = island();
  const put = f.publish(a.id, a.bundle, { token: 'tok-a' });
  assert.deepEqual(put.origin, [0, 0]);
  assert.equal(f.count(), 1);
  assert.equal(f.manifest().islands[0].name, 'Promptholm');
});

test('a second island gets water between it and the first', () => {
  const f = createFleet();
  const a = island({ port: 4747 });
  const b = island({ port: 4748, seed: 99, name: 'Tiemenholm' });
  f.publish(a.id, a.bundle, { token: 'a' });
  f.publish(b.id, b.bundle, { token: 'b' });
  const [ra, rb] = f.manifest().islands;
  assert.ok(clearOf({ half: 32, origin: ra.origin }, { half: 32, origin: rb.origin }));
});

test('publishing again keeps the berth and moves the revision on', () => {
  const f = createFleet();
  const a = island();
  const first = f.publish(a.id, a.bundle, { token: 'a' });
  const again = f.publish(a.id, a.bundle, { token: 'a' });
  assert.deepEqual(again.origin, first.origin, 'an island never moves');
  assert.equal(again.rev, first.rev + 1);
});

test('a second machine cannot publish to somebody else\'s island', () => {
  const f = createFleet();
  const a = island();
  f.publish(a.id, a.bundle, { token: 'mine' });
  assert.throws(() => f.publish(a.id, a.bundle, { token: 'theirs' }), /somebody else/);
  // The id alone is not enough either: it is derived from a port and a hostname, so it is
  // guessable by design and the token is what actually holds the claim.
  assert.throws(() => f.publish(a.id, a.bundle, {}), /somebody else/);
});

// parseBundle owns this check; the fleet only has to not swallow it. A mismatch means the
// two machines are running a different shared/terrain.mjs, and every house on the island
// would stand in the wrong place, or in the sea.
test('an island whose terrain hash disagrees is refused, not drawn', () => {
  const f = createFleet();
  const a = island();
  const lying = JSON.parse(JSON.stringify(a.bundle));
  lying.island.terrainHash = 'f'.repeat(lying.island.terrainHash.length);
  assert.throws(() => f.publish(a.id, lying, { token: 'a' }), /not running the same terrain/);
  assert.equal(f.count(), 0, 'and nothing of it is kept');
});

test('an island that does not answer to its own name is refused', () => {
  const f = createFleet();
  const a = island({ port: 4747 });
  const b = island({ port: 4748 });
  assert.throws(() => f.publish(b.id, a.bundle, { token: 'x' }), /does not answer to that name/);
});

test('a quiet islander keeps its island in the world until the grace runs out', () => {
  let clock = 1000;
  const f = createFleet({ now: () => clock });
  const a = island();
  f.publish(a.id, a.bundle, { token: 'a' });

  f.goneQuiet(a.id);
  assert.equal(f.manifest().islands[0].live, false, 'the keeper is away, the island is not');
  assert.equal(f.count(), 1);

  clock += GRACE_MS - 1;
  assert.deepEqual(f.expired(), [], 'still inside the grace');

  clock += 2;
  assert.deepEqual(f.expired(), [a.id]);
  f.drop(a.id);
  assert.equal(f.count(), 0);
});

test('coming back inside the grace takes the same berth, with the same token', () => {
  let clock = 1000;
  const f = createFleet({ now: () => clock });
  const a = island();
  const before = f.publish(a.id, a.bundle, { token: 'a' }).origin;
  f.goneQuiet(a.id);
  clock += 1000;
  const back = f.claim(a.id, 'a');
  assert.ok(back, 'the same token gets it back');
  assert.equal(back.live, true);
  assert.deepEqual(back.origin, before);
  assert.equal(f.claim(a.id, 'somebody-else'), null);
});

test('the sea fills up and says so rather than piling islands on top of each other', () => {
  const f = createFleet({ max: 3 });
  for (const port of [4747, 4748, 4749]) {
    const i = island({ port, seed: port });
    f.publish(i.id, i.bundle, { token: String(port) });
  }
  const extra = island({ port: 4750, seed: 4750 });
  assert.throws(() => f.publish(extra.id, extra.bundle, { token: 'x' }), /full/);
  assert.equal(f.count(), 3);
});

test('every island brings one boat, and no two share a mooring', () => {
  const f = createFleet();
  for (const port of [4747, 4748, 4749]) {
    const i = island({ port, seed: port });
    f.publish(i.id, i.bundle, { token: String(port) });
  }
  const m = f.moorings();
  assert.equal(m.length, 3);
  assert.equal(new Set(m.map((b) => b.id)).size, 3, 'one boat per island, named after it');
  assert.equal(new Set(m.map((b) => `${Math.round(b.x)},${Math.round(b.z)}`)).size, 3,
    'and each lies off its own coast, not on top of the next island\'s');
});

// The horizon draws a neighbour out of a seed and a grid size and invents nothing, so a
// lighthouse is the one thing on a far island it cannot work out for itself. It comes off
// the manifest row - derived here from the bundle, which has carried the building and its
// plot since bundles existed, so there was nothing to add at either end of
// lib/islandbundle.mjs and no forgiving/strict pair to get out of step.
test('a lighthouse rides the manifest so a far island can be seen to have one', () => {
  const f = createFleet();
  const lit = island({
    port: 4747,
    buildings: [{ id: 'civic:lighthouse', kind: 'civic', civicType: 'lighthouse', plot: { gx: 52, gz: 9, w: 1, d: 1, rot: 2 } }],
  });
  const dark = island({ port: 4748, seed: 99, name: 'Tiemenholm' });
  f.publish(lit.id, lit.bundle, { token: 'a' });
  f.publish(dark.id, dark.bundle, { token: 'b' });
  const [ra, rb] = f.manifest().islands;
  // LOCAL coordinates, the island's own -half..+half, like every other position a bundle
  // carries: 52 + 0.5 - 32 and 9 + 0.5 - 32 on a 64-cell island.
  assert.deepEqual(ra.beacons, [[20.5, -22.5]]);
  assert.deepEqual(rb.beacons, [], 'an island without one says so rather than saying nothing');
});

test('a lighthouse stands where the keeper own page put it, once a page has looked', () => {
  const f = createFleet();
  const a = island({
    buildings: [{ id: 'civic:lighthouse', kind: 'civic', civicType: 'lighthouse', plot: { gx: 52, gz: 9, w: 1, d: 1, rot: 2 } }],
    // What reportPlacements sends back: where the renderer actually put it. It agrees with
    // the surveyed centre for this one building, so the test nudges it to prove which of
    // the two is being read.
    placements: { at: { 'civic:lighthouse': [20.75, -22.25] } },
  });
  f.publish(a.id, a.bundle, { token: 'a' });
  assert.deepEqual(f.manifest().islands[0].beacons, [[20.75, -22.25]]);
});

test('the manifest is small enough to ride a socket message', () => {
  const f = createFleet();
  for (const port of [4747, 4748, 4749, 4750]) {
    const i = island({ port, seed: port });
    f.publish(i.id, i.bundle, { token: String(port) });
  }
  const bytes = Buffer.byteLength(JSON.stringify(f.manifest()));
  assert.ok(bytes < 2048, `a four-island manifest is ${bytes} bytes; lib/ws.mjs caps a frame at 2048`);
});

// An island that may grow keeps room for it round its berth (Plans/eiland-laten-groeien.md):
// the berths are laid out on `island.room`, so the island growing into that room never
// reaches a neighbour and keeps its berth - an island never moves, also while it grows.
test('an island that may grow is given room for it, and keeps its berth while it grows', () => {
  const withRoom = (b, room) => { const c = JSON.parse(JSON.stringify(b)); c.island.room = room; return c; };
  const f = createFleet();
  const a = island({ port: 4747 });
  const b = island({ port: 4748, seed: 99, name: 'Tiemenholm' });
  f.publish(a.id, withRoom(a.bundle, 256), { token: 'a' });
  const putB = f.publish(b.id, withRoom(b.bundle, 256), { token: 'b' });
  // Room for two 256-grids between them, though each is 64 across today.
  const apart = Math.max(Math.abs(putB.origin[0]), Math.abs(putB.origin[1]));
  assert.ok(apart >= 128 + 128, `the second island is only ${apart} out`);

  // A grows to 192 - inside its room - and stays exactly where it was.
  const grown = island({ port: 4747, size: 192 });
  const again = f.publish(grown.id, withRoom(grown.bundle, 256), { token: 'a' });
  assert.deepEqual(again.origin, [0, 0]);
  assert.equal(f.manifest().islands.find((i) => i.id === b.id).origin.join(','), putB.origin.join(','));

  // A bundle from before islands grew asks for no more than it takes up.
  assert.equal(a.bundle.island.room, 64);
});
