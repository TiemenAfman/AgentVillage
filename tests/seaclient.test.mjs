// An islander reaching a sea, against a real one.
//
// The direction is the thing being asserted as much as the behaviour: the islander opens
// the socket and posts the bundle, and nothing in lib/seaclient.mjs listens for anything
// the sea might ask it to do. That is what keeps lib/access.mjs strict - the island needs
// no route open to anybody - so a future inbound half would be a real change of posture
// and not a convenience.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

import { createSea, SEA_V } from '../lib/sea.mjs';
import { createSeaClient, mintToken } from '../lib/seaclient.mjs';
import { buildBundle, beaconId } from '../lib/islandbundle.mjs';
import { makeTerrain } from '../shared/terrain.mjs';

function island({ seed = 1337, size = 64, port = 4747, name = 'Promptholm', houses = 0 } = {}) {
  const terrain = makeTerrain(seed, { size });
  const id = beaconId(port, `host-${port}`);
  const buildings = [];
  for (let n = 0; n < houses; n++) {
    buildings.push({
      id: `house:0000000${n}`, kind: 'house', sessionId: null, district: null,
      name: `House ${n}`, startedAt: '2026-09-17T08:00:00.000Z', lastAt: null,
      active: false, archived: false, style: 'opus', model: null, tier: 'house',
      ornaments: [], harbour: false, outpost: null, sheds: [],
      plot: { gx: 30 + n, gz: 30, w: 2, d: 2, rot: 0 }, door: null,
    });
  }
  const village = {
    generatedAt: '2026-09-18T10:00:00.000Z',
    island: {
      name, seed, gridSize: size, terrainHash: terrain.hash,
      foundedAt: '2026-09-16T10:22:44.431Z',
      landing: [40, 50], town: { gx: 32, gz: 32, r: 8, paved: [] }, lattice: null,
    },
    grid: { size },
    districts: [], buildings, paths: [], bridges: [], cleared: [], polders: [],
    milestones: [], active: [], assignments: [], stats: {},
  };
  return { id, bundle: buildBundle({ config: { islandName: name, seed, port, gridSize: size }, village, id, keeper: 'Martijn' }) };
}

async function afloat(fn, opts = {}) {
  const sea = createSea({ port: 0, name: 'test sea', ...opts });
  const addr = await sea.listen();
  try {
    return await fn({ sea, url: `http://127.0.0.1:${addr.port}/` });
  } finally {
    await sea.close();
  }
}

const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));

test('an islander joins, publishes itself, and turns up in the world', () => afloat(async ({ sea, url }) => {
  const a = island({ houses: 3 });
  const client = createSeaClient({ url, islandId: a.id, bundle: () => a.bundle });
  try {
    await settle();
    assert.equal(client.connected(), true, 'the socket is up');
    assert.equal(sea.fleet.count(), 1);
    const row = sea.fleet.manifest().islands[0];
    assert.equal(row.name, 'Promptholm');
    assert.equal(row.buildings, 3);
    assert.deepEqual(row.origin, [0, 0]);
  } finally {
    client.close();
  }
}));

test('an island that has not changed is not sent again', () => afloat(async ({ sea, url }) => {
  const a = island();
  const client = createSeaClient({ url, islandId: a.id, bundle: () => a.bundle });
  try {
    await settle();
    const after = sea.fleet.get(a.id).rev;
    assert.equal((await client.publish()).sent, false, 'unchanged islands stay home');
    assert.equal((await client.publish()).why, 'unchanged');
    assert.equal(sea.fleet.get(a.id).rev, after, 'and the revision does not move');

    // Forcing it does send, which is what a reconnect does.
    assert.equal((await client.publish({ force: true })).sent, true);
    assert.equal(sea.fleet.get(a.id).rev, after + 1);
  } finally {
    client.close();
  }
}));

test('a house being built is what makes an island worth sending again', () => afloat(async ({ sea, url }) => {
  let current = island({ houses: 1 });
  const client = createSeaClient({ url, islandId: current.id, bundle: () => current.bundle });
  try {
    await settle();
    assert.equal(sea.fleet.manifest().islands[0].buildings, 1);

    // The scan ran and found another house. Same island, same id, new contents.
    const grown = island({ houses: 2, port: 4747 });
    current = { id: current.id, bundle: grown.bundle };
    const r = await client.publish();
    assert.equal(r.sent, true);
    assert.equal(sea.fleet.manifest().islands[0].buildings, 2);
  } finally {
    client.close();
  }
}));

test('the islander keeps its berth across a reconnect, and the sea keeps its island', () => afloat(async ({ sea, url }) => {
  const a = island();
  const token = mintToken();
  const first = createSeaClient({ url, islandId: a.id, token, bundle: () => a.bundle });
  await settle();
  const berth = sea.fleet.get(a.id).origin;
  first.close();
  await settle();

  assert.equal(sea.fleet.count(), 1, 'the island stays while the keeper is away');
  assert.equal(sea.fleet.get(a.id).live, false);

  const again = createSeaClient({ url, islandId: a.id, token, bundle: () => a.bundle });
  try {
    await settle();
    assert.equal(sea.fleet.get(a.id).live, true, 'and is live again the moment it is back');
    assert.deepEqual(sea.fleet.get(a.id).origin, berth, 'in the same place');
  } finally {
    again.close();
  }
}));

test('a sea that has restarted gets the island again without anybody editing a file', () => afloat(async ({ url }) => {
  // The second sea is a different object on the same port-less premise: it has never seen
  // this island, however recently the client sent it. The client forgets what it sent when
  // its socket drops, which is what makes the island reappear rather than stay invisible.
  const a = island();
  const client = createSeaClient({ url, islandId: a.id, bundle: () => a.bundle });
  await settle();
  client.close();

  const fresh = createSea({ port: 0, name: 'a fresh sea' });
  const addr = await fresh.listen();
  const again = createSeaClient({ url: `http://127.0.0.1:${addr.port}/`, islandId: a.id, bundle: () => a.bundle });
  try {
    await settle();
    assert.equal(fresh.fleet.count(), 1, 'the world reassembles itself');
  } finally {
    again.close();
    await fresh.close();
  }
}));

test('a sea that speaks another version is told once and not hammered', () => afloat(async ({ url }) => {
  const a = island();
  const said = [];
  const client = createSeaClient({
    url, islandId: a.id, bundle: () => a.bundle, v: SEA_V + 99, log: (m) => said.push(m),
  });
  try {
    await settle(400);
    assert.equal(client.connected(), false);
    assert.equal(said.filter((m) => /turned this island away/.test(m)).length, 1,
      'said once, then left alone');
  } finally {
    client.close();
  }
}));

test('two islanders cannot claim the same island', () => afloat(async ({ sea, url }) => {
  const a = island();
  const real = createSeaClient({ url, islandId: a.id, token: 'the-real-one', bundle: () => a.bundle });
  await settle();
  const said = [];
  const thief = createSeaClient({ url, islandId: a.id, token: 'not-it', bundle: () => a.bundle, log: (m) => said.push(m) });
  try {
    await settle();
    assert.equal(thief.connected(), false);
    assert.ok(said.some((m) => /claimed/.test(m)), said.join(' | '));
    assert.equal(sea.fleet.get(a.id).token, 'the-real-one');
  } finally {
    thief.close();
    real.close();
  }
}));

test('nothing in the line home listens for instructions', async () => {
  const src = await (await import('node:fs/promises')).readFile(new URL('../lib/seaclient.mjs', import.meta.url), 'utf8');
  for (const forbidden of ['node:fs', 'node:child_process', 'writeFile', 'exec(', 'spawn(']) {
    assert.ok(!src.includes(forbidden), `lib/seaclient.mjs reaches for ${forbidden}`);
  }
  // It handles exactly two things the sea can say, and neither of them is a command.
  const handled = [...src.matchAll(/m\.t === '([a-z]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(handled, ['refused', 'welcome']);
});
