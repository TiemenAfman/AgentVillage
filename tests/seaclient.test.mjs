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

// Every sea raises the volcano at [0, 0] before anybody joins (lib/fleet.mjs raiseVolcano),
// so "the world" is always one island more than anybody published. These are the ones that
// belong to somebody, and FIRST_BERTH is where the first of them anchors: on the ring round
// the volcano, its half (96, a 192-grid) + SEA_GAP (48) + a 64-grid's half (32) due east.
const owned = (world) => world.islands.filter((i) => !i.volcano);
const FIRST_BERTH = [176, 0];

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
  const sea = createSea({ port: 0, name: 'test sea', starters: false, ...opts });
  const addr = await sea.listen();
  try {
    return await fn({ sea, url: `http://127.0.0.1:${addr.port}/` });
  } finally {
    await sea.close();
  }
}

// Wait for the thing to be true rather than for a number of milliseconds. The runner runs
// test files in parallel, so a fixed pause that is generous on an idle machine is not
// generous on a busy one - and a flaky test about a socket is worse than no test, because
// it teaches you to re-run instead of to look.
async function until(what, why = 'it never happened', ms = 5000) {
  const stop = Date.now() + ms;
  for (;;) {
    const v = await what();
    if (v) return v;
    if (Date.now() > stop) throw new Error(why);
    await new Promise((r) => setTimeout(r, 20));
  }
}
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));

test('an islander joins, publishes itself, and turns up in the world', () => afloat(async ({ sea, url }) => {
  const a = island({ houses: 3 });
  const client = createSeaClient({ url, islandId: a.id, bundle: () => a.bundle });
  try {
    await until(() => client.connected(), 'the socket never came up');
    await until(() => sea.fleet.players() === 1, 'the island never arrived');
    const row = owned(sea.fleet.manifest())[0];
    assert.equal(row.name, 'Promptholm');
    assert.equal(row.buildings, 3);
    assert.deepEqual(row.origin, FIRST_BERTH);
  } finally {
    client.close();
  }
}));

test('an island that has not changed is not sent again', () => afloat(async ({ sea, url }) => {
  const a = island();
  const client = createSeaClient({ url, islandId: a.id, bundle: () => a.bundle });
  try {
    // Wait for the client's *own* first publish to have landed and stopped moving. Not
    // merely for the island to exist: the welcome kicks off a forced publish of its own,
    // and one still in flight would bump the revision after it had been written down here,
    // which reads as "an unchanged island was sent again" and is nothing of the kind.
    await until(async () => (await client.publish()).why === 'unchanged', 'the first publish never settled');
    const after = await until(async () => {
      const a1 = sea.fleet.get(a.id).rev;
      await settle(80);
      return sea.fleet.get(a.id).rev === a1 ? a1 : 0;
    }, 'the revision never settled');
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
    await until(async () => (await client.publish()).why === 'unchanged', 'the first publish never settled');
    assert.equal(owned(sea.fleet.manifest())[0].buildings, 1);

    // The scan ran and found another house. Same island, same id, new contents.
    const grown = island({ houses: 2, port: 4747 });
    current = { id: current.id, bundle: grown.bundle };
    const r = await client.publish();
    assert.equal(r.sent, true);
    assert.equal(owned(sea.fleet.manifest())[0].buildings, 2);
  } finally {
    client.close();
  }
}));

test('the islander keeps its berth across a reconnect, and the sea keeps its island', () => afloat(async ({ sea, url }) => {
  const a = island();
  const token = mintToken();
  const first = createSeaClient({ url, islandId: a.id, token, bundle: () => a.bundle });
  await until(() => sea.fleet.has(a.id), 'the island never arrived');
  const berth = sea.fleet.get(a.id).origin;
  first.close();
  await until(() => sea.fleet.get(a.id).live === false, 'the sea never noticed the keeper leave');

  assert.equal(sea.fleet.players(), 1, 'the island stays while the keeper is away');

  const again = createSeaClient({ url, islandId: a.id, token, bundle: () => a.bundle });
  try {
    await until(() => sea.fleet.get(a.id).live === true, 'it never came back');
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
  await until(() => client.connected(), 'the socket never came up');
  client.close();

  const fresh = createSea({ port: 0, name: 'a fresh sea', starters: false });
  const addr = await fresh.listen();
  const again = createSeaClient({ url: `http://127.0.0.1:${addr.port}/`, islandId: a.id, bundle: () => a.bundle });
  try {
    await until(() => fresh.fleet.players() === 1, 'the world never reassembled itself');
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
    await until(() => said.some((m) => /turned this island away/.test(m)), 'it was never turned away');
    await settle(300);                            // long enough for a retry to have happened
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
  await until(() => sea.fleet.has(a.id), 'the island never arrived');
  const said = [];
  const thief = createSeaClient({ url, islandId: a.id, token: 'not-it', bundle: () => a.bundle, log: (m) => said.push(m) });
  try {
    await until(() => said.some((m) => /claimed/.test(m)), 'the thief was never refused');
    assert.equal(thief.connected(), false);
    assert.equal(sea.fleet.get(a.id).token, 'the-real-one');
  } finally {
    thief.close();
    real.close();
  }
}));

// The restart case. The islander before this one left a claim behind that the sea holds
// for its grace period; giving up on `claimed` left the new islander with no socket for
// as long as it ran, and its island blinking in and out as "keeper away".
test('an islander refused because its predecessor still holds the claim gets in once it lapses', () => afloat(async ({ sea, url }) => {
  const a = island();
  const before = createSeaClient({ url, islandId: a.id, token: 'the-old-process', bundle: () => a.bundle });
  await until(() => sea.fleet.has(a.id), 'the island never arrived');
  before.close();
  const said = [];
  const after = createSeaClient({ url, islandId: a.id, token: 'the-new-process', bundle: () => a.bundle, log: (m) => said.push(m) });
  try {
    await until(() => said.some((m) => /claimed/.test(m)), 'the old claim was never in the way');
    sea.fleet.drop(a.id);                          // what the sweep does once the grace runs out
    await until(() => after.connected(), 'it gave up instead of waiting the claim out', 10000);
    await until(() => sea.fleet.get(a.id)?.token === 'the-new-process' && sea.fleet.get(a.id).live,
      'joined, but the island is not live under the new claim');
    assert.equal(said.filter((m) => /turned this island away/.test(m)).length, 1, 'said once, not per retry');
  } finally {
    after.close();
  }
}));

// The tray restarting, with the token kept on disk: the same claimant, back at once - and
// the old line dying *after* the new one is in must not mark the island quiet, or the
// sweep takes it 45 s later with its islander connected.
test('a restarted islander with its kept token stays live, whichever socket closes last', () => afloat(async ({ sea, url }) => {
  const a = island();
  const token = mintToken();
  const before = createSeaClient({ url, islandId: a.id, token, bundle: () => a.bundle });
  await until(() => before.connected() && sea.fleet.has(a.id), 'the island never arrived');
  const said = [];
  const after = createSeaClient({ url, islandId: a.id, token, bundle: () => a.bundle, log: (m) => said.push(m) });
  try {
    await until(() => after.connected(), 'the same token was not let back in');
    before.close();
    await settle(200);
    assert.equal(sea.fleet.get(a.id).live, true, 'the old socket closing made a held island quiet');
    assert.ok(!said.some((m) => /turned this island away/.test(m)), `refused: ${said.join(' / ')}`);
  } finally {
    after.close();
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
