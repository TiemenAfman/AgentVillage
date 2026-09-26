// The key on the HTTP side of the sea, and what "live" means for an island.
//
// Both halves come out of one afternoon. An islander was turned away at the handshake of
// a keyed sea and, on its next scan, published its island there anyway over HTTP - the key
// was checked on the socket and nowhere else. That copy then sat in the sea for ever: it
// was `live` from the moment it was published and no socket had ever been attached to it,
// so nothing could drop and start the grace running. The islander restarted, minted a new
// token, and was refused its own island as "somebody else's" until the sea was restarted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

import { createSea, SEA_V } from '../lib/sea.mjs';
import { createSeaClient } from '../lib/seaclient.mjs';
import { buildBundle, beaconId } from '../lib/islandbundle.mjs';
import { makeTerrain } from '../shared/terrain.mjs';

// Every sea raises the volcano at [0, 0] before anybody joins (lib/fleet.mjs raiseVolcano),
// so "the world" is always one island more than anybody published. These are the ones that
// belong to somebody.
const owned = (world) => world.islands.filter((i) => !i.volcano);

function island({ seed = 1337, size = 64, port = 4747, name = 'Promptholm' } = {}) {
  const terrain = makeTerrain(seed, { size });
  const id = beaconId(port, `host-${port}`);
  const village = {
    generatedAt: '2026-09-18T10:00:00.000Z',
    island: {
      name, seed, gridSize: size, terrainHash: terrain.hash,
      foundedAt: '2026-09-16T10:22:44.431Z',
      landing: [40, 50], town: { gx: 32, gz: 32, r: 8, paved: [] }, lattice: null,
    },
    grid: { size },
    districts: [], buildings: [], paths: [], bridges: [], cleared: [], polders: [],
    milestones: [], active: [], assignments: [], stats: {},
  };
  return { id, bundle: buildBundle({ config: { islandName: name, seed, port, gridSize: size }, village, id, keeper: 'Tiemen' }) };
}

async function afloat(fn, opts = {}) {
  const sea = createSea({ port: 0, name: 'test sea', starters: false, ...opts });
  const addr = await sea.listen();
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    return await fn({ sea, base, wsUrl: `ws://127.0.0.1:${addr.port}/ws` });
  } finally {
    await sea.close();
  }
}

const post = (base, path, body, headers = {}) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

function talk(url) {
  const ws = new WebSocket(url);
  const queue = [];
  const waiting = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (waiting.length) waiting.shift()(m);
    else queue.push(m);
  });
  const next = () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((res) => waiting.push(res)));
  return {
    ready: new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); }),
    say: (o) => ws.send(JSON.stringify(o)),
    until: async (pred, tries = 12) => {
      for (let i = 0; i < tries; i++) { const m = await next(); if (pred(m)) return m; }
      throw new Error('the sea never said it');
    },
    close: () => { try { ws.close(); } catch { /* gone */ } },
  };
}

test('a keyed sea wants its key on a publish, and on a parcel', () => afloat(async ({ base }) => {
  const a = island();
  const shut = await post(base, `/island/${a.id}`, a.bundle, { 'X-Island-Token': 'tok' });
  assert.equal(shut.status, 403);
  assert.equal((await shut.json()).error, 'key', 'the refusal should name the reason in the wire’s own word');
  assert.equal(owned(await (await fetch(`${base}/world`)).json()).length, 0, 'the island was parked anyway');

  const open = await post(base, `/island/${a.id}`, a.bundle, { 'X-Island-Token': 'tok', 'X-Sea-Key': 'sesame' });
  assert.equal(open.status, 200);

  const parcelShut = await post(base, `/island/${a.id}/parcel`, { props: [], crops: [] }, { 'X-Island-Token': 'tok' });
  assert.equal(parcelShut.status, 403);
  const parcelOpen = await post(base, `/island/${a.id}/parcel`, { props: [], crops: [] }, { 'X-Island-Token': 'tok', 'X-Sea-Key': 'sesame' });
  assert.equal(parcelOpen.status, 200);
}, { key: 'sesame' }));

test('an island published with nobody on the line for it is not live, and comes alive when they arrive', () => afloat(async ({ base, wsUrl }) => {
  const a = island();
  // Over HTTP alone, the way an islander whose socket was refused does it.
  assert.equal((await post(base, `/island/${a.id}`, a.bundle, { 'X-Island-Token': 'tok' })).status, 200);
  let world = await (await fetch(`${base}/world`)).json();
  assert.equal(owned(world).length, 1);
  assert.equal(owned(world)[0].live, false, 'an island with no islander behind it was called live');

  // Its islander turns up on the socket with the same token: that is the claim.
  const keeper = talk(wsUrl);
  await keeper.ready;
  keeper.say({ t: 'join', v: SEA_V, as: 'islander', island: a.id, token: 'tok' });
  await keeper.until((m) => m.t === 'welcome');
  world = await (await fetch(`${base}/world`)).json();
  assert.equal(owned(world)[0].live, true);

  // And a publish while the socket is up is live from the start, as it always was.
  const b = island({ port: 4748, name: 'Hoogezand' });
  const other = talk(wsUrl);
  await other.ready;
  other.say({ t: 'join', v: SEA_V, as: 'islander', island: b.id, token: 'tok-b' });
  await other.until((m) => m.t === 'welcome');
  assert.equal((await post(base, `/island/${b.id}`, b.bundle, { 'X-Island-Token': 'tok-b' })).status, 200);
  world = await (await fetch(`${base}/world`)).json();
  assert.equal(world.islands.find((i) => i.id === b.id).live, true);

  keeper.close(); other.close();
}));

test('the islander sends the key with its bundle', () => afloat(async ({ base }) => {
  const a = island();
  const client = createSeaClient({ url: `${base}/`, islandId: a.id, token: 'tok', key: 'sesame', bundle: () => a.bundle });
  try {
    const r = await client.publish({ force: true });
    assert.equal(r.sent, true, `the sea would not take it: ${r.why}`);
    const world = await (await fetch(`${base}/world`)).json();
    assert.equal(owned(world).length, 1);
  } finally {
    client.close();
  }
}, { key: 'sesame' }));
