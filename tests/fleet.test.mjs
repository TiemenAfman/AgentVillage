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
function island({ seed = 1337, size = 64, port = 4747, name = 'Promptholm', polders = [] } = {}) {
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
    districts: [], buildings: [], paths: [], bridges: [], cleared: [], polders,
    milestones: [], active: [], assignments: [], stats: {},
  };
  const bundle = buildBundle({ config: { islandName: name, seed, port, gridSize: size }, village, id, keeper: 'Martijn' });
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

test('the manifest is small enough to ride a socket message', () => {
  const f = createFleet();
  for (const port of [4747, 4748, 4749, 4750]) {
    const i = island({ port, seed: port });
    f.publish(i.id, i.bundle, { token: String(port) });
  }
  const bytes = Buffer.byteLength(JSON.stringify(f.manifest()));
  assert.ok(bytes < 2048, `a four-island manifest is ${bytes} bytes; lib/ws.mjs caps a frame at 2048`);
});
