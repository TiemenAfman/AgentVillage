// An island joining a sea, over a real socket and a real HTTP request.
//
// lib/fleet.test.mjs covers the model; this covers the wire. The two halves that only
// show up here: a bundle is too big for a frame and so must go over HTTP (lib/ws.mjs caps
// a frame at 2048 bytes and refuses to reassemble fragments, deliberately), and an
// islander's socket closing is what makes its island go quiet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

import { createSea, SEA_V, MAX_BUNDLE_BYTES } from '../lib/sea.mjs';
import { buildBundle, beaconId } from '../lib/islandbundle.mjs';
import { makeTerrain } from '../shared/terrain.mjs';

// Every sea raises the volcano at [0, 0] before anybody joins (lib/fleet.mjs raiseVolcano),
// so "the world" is always one island more than anybody published. These are the ones that
// belong to somebody, and FIRST_BERTH is where the first of them anchors: on the ring round
// the volcano, its half (96, a 192-grid) + SEA_GAP (48) + a 64-grid's half (32) due east.
const owned = (world) => world.islands.filter((i) => !i.volcano);
const FIRST_BERTH = [176, 0];

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
  return { id, bundle: buildBundle({ config: { islandName: name, seed, port, gridSize: size }, village, id, keeper: 'Martijn' }) };
}

// A sea on an ephemeral port, torn down after the body runs whatever happens.
async function afloat(fn, opts = {}) {
  const sea = createSea({ port: 0, name: 'test sea', ...opts });
  const addr = await sea.listen();
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    return await fn({ sea, base, wsUrl: `ws://127.0.0.1:${addr.port}/ws` });
  } finally {
    await sea.close();
  }
}

const post = (base, id, body, token) => fetch(`${base}/island/${id}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Island-Token': token } : {}) },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

// One socket, with a little queue, so a test can say "the next thing you say".
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
    next,
    // The sea says more than one kind of thing on one socket - the roster's joins and
    // leaves ride the same wire as the fleet's news - so a test that wants a particular
    // one has to say so rather than taking whatever arrives first.
    until: async (pred, tries = 12) => {
      for (let i = 0; i < tries; i++) {
        const m = await next();
        if (pred(m)) return m;
      }
      throw new Error('the sea never said it');
    },
    close: () => ws.close(),
    closed: new Promise((res) => ws.addEventListener('close', res)),
  };
}

test('an island published over HTTP turns up in the world', () => afloat(async ({ base }) => {
  const a = island();
  const r = await post(base, a.id, a.bundle, 'tok');
  assert.equal(r.status, 200);
  const put = await r.json();
  assert.deepEqual(put.origin, FIRST_BERTH);

  const world = await (await fetch(`${base}/world`)).json();
  assert.equal(owned(world).length, 1);
  assert.equal(owned(world)[0].name, 'Promptholm');
  // Published over HTTP with nobody on the socket for it, so it is in the world but not
  // live: it comes alive when its islander joins and claims it, and is swept after the
  // grace if nobody does. tests/sea-key.test.mjs has the why.
  assert.equal(owned(world)[0].live, false);

  // And the island itself is fetched separately, which is the whole reason the manifest
  // is small: 200 kB of island does not belong in a message everybody gets.
  const whole = await (await fetch(`${base}/island/${a.id}`)).json();
  assert.equal(whole.island.id, a.id);
  assert.equal(whole.island.terrainHash, a.bundle.island.terrainHash);
}));

test('a second machine cannot publish over somebody else\'s island', () => afloat(async ({ base }) => {
  const a = island();
  assert.equal((await post(base, a.id, a.bundle, 'mine')).status, 200);
  const r = await post(base, a.id, a.bundle, 'theirs');
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /somebody else/);
}));

test('nonsense and giants are refused by the door, not by the parser', () => afloat(async ({ base }) => {
  const a = island();
  assert.equal((await post(base, a.id, 'not json at all', 'x')).status, 400);
  const giant = 'x'.repeat(MAX_BUNDLE_BYTES + 1024);
  const r = await post(base, a.id, `{"v":1,"pad":"${giant}"}`, 'x');
  assert.ok(r.status === 413 || r.status === 400, `a giant got ${r.status}`);
  assert.equal(owned(await (await fetch(`${base}/world`)).json()).length, 0);
}));

test('a client that speaks another version is turned away with the number', () => afloat(async ({ wsUrl }) => {
  const c = talk(wsUrl);
  await c.ready;
  c.say({ t: 'join', v: SEA_V + 99, as: 'client' });
  const m = await c.next();
  assert.equal(m.t, 'refused');
  assert.equal(m.why, 'version');
  assert.equal(m.speaks, SEA_V);
  await c.closed;
}));

test('a sea with a key turns away anybody who does not have it', () => afloat(async ({ wsUrl }) => {
  const c = talk(wsUrl);
  await c.ready;
  c.say({ t: 'join', v: SEA_V, as: 'client' });
  const m = await c.next();
  assert.equal(m.t, 'refused');
  assert.equal(m.why, 'key');
  await c.closed;
}, { key: 'sesame' }));

test('joining answers with the fleet and one clock for everybody', () => afloat(async ({ base, wsUrl }) => {
  const a = island();
  await post(base, a.id, a.bundle, 'tok');

  const c = talk(wsUrl);
  await c.ready;
  c.say({ t: 'join', v: SEA_V, as: 'client' });
  const m = await c.next();
  assert.equal(m.t, 'welcome');
  assert.equal(m.v, SEA_V);
  assert.equal(owned(m.world).length, 1);
  assert.ok(Number.isFinite(m.now), 'the sea owns the time of day');
  assert.ok(Number.isFinite(m.tickMs));
  c.close();
}));

test('everybody already here is told when an island arrives', () => afloat(async ({ base, wsUrl }) => {
  const c = talk(wsUrl);
  await c.ready;
  c.say({ t: 'join', v: SEA_V, as: 'client' });
  await c.next();                                   // the welcome

  const a = island();
  await post(base, a.id, a.bundle, 'tok');
  const m = await c.until((x) => x.t === 'island');
  assert.equal(m.a, 'joined');
  assert.equal(m.name, 'Promptholm');
  assert.deepEqual(m.origin, FIRST_BERTH);
  c.close();
}));

test('an islander losing its socket leaves its island standing, and says so', () => afloat(async ({ base, wsUrl }) => {
  const a = island();
  await post(base, a.id, a.bundle, 'tok');

  const keeper = talk(wsUrl);
  await keeper.ready;
  keeper.say({ t: 'join', v: SEA_V, as: 'islander', island: a.id, token: 'tok' });
  await keeper.next();

  const watcher = talk(wsUrl);
  await watcher.ready;
  watcher.say({ t: 'join', v: SEA_V, as: 'client' });
  await watcher.next();

  keeper.close();
  const m = await watcher.until((x) => x.t === 'island' && x.a === 'rev');
  assert.equal(m.live, false, 'the keeper is away');

  // The island is still in the world. Losing a socket must not sink an island under the
  // feet of whoever is standing on it - a page reload does that every time.
  const world = await (await fetch(`${base}/world`)).json();
  assert.equal(owned(world).length, 1);
  watcher.close();
}));

test('an islander with the wrong token cannot take over a live island', () => afloat(async ({ base, wsUrl }) => {
  const a = island();
  await post(base, a.id, a.bundle, 'tok');
  const thief = talk(wsUrl);
  await thief.ready;
  thief.say({ t: 'join', v: SEA_V, as: 'islander', island: a.id, token: 'not-tok' });
  const m = await thief.next();
  assert.equal(m.t, 'refused');
  assert.equal(m.why, 'claimed');
  await thief.closed;
}));

// The property the whole design rests on, asserted structurally rather than promised.
//
// A sea holds a world and writes none of it down: no schema, no migration, no upgrade path,
// and a restart is a second of blank water while everybody reconnects. Checking the source
// of one file would not hold - the reach could come in through any of its imports - so this
// walks the whole graph from sea.mjs and asserts what it is allowed to touch.
test('nothing the sea imports can reach a disk or start a process', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = path.dirname(fileURLToPath(new URL('../sea.mjs', import.meta.url)));

  const seen = new Set();
  const builtins = new Set();
  const walk = (f) => {
    f = path.resolve(f);
    if (seen.has(f)) return;
    seen.add(f);
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/^import .*from '([^']+)'/gm)) {
      if (m[1].startsWith('node:')) { builtins.add(m[1]); continue; }
      walk(path.join(path.dirname(f), m[1]));
    }
  };
  walk(path.join(root, 'sea.mjs'));

  // Three, and each of them earns its place: http serves, crypto makes an id, os names the
  // machine. Anything that can open a file, spawn a process or reach the network on its own
  // behalf is not on this list and must not get on it.
  assert.deepEqual([...builtins].sort(), ['node:crypto', 'node:http', 'node:os']);
  assert.ok(seen.size > 10, 'the walk found almost nothing, so it is not walking');
});

test('an island the sea holds is held in memory and nowhere else', () => afloat(async ({ base, sea }) => {
  const a = island();
  await post(base, a.id, a.bundle, 'tok');
  assert.equal(sea.fleet.players(), 1, 'it is all in memory, and that is the point');
}));

test('two bodies from two islands see each other, and do not share a tavern', () => afloat(async ({ base, wsUrl }) => {
  const a = island({ port: 4747, seed: 1337, name: 'Promptholm' });
  const b = island({ port: 4748, seed: 99, name: 'Tiemenholm' });
  await post(base, a.id, a.bundle, 'a');
  await post(base, b.id, b.bundle, 'b');

  const mine = talk(wsUrl);
  await mine.ready;
  mine.say({ t: 'join', v: SEA_V, as: 'client', island: a.id });
  const hello = await mine.next();
  assert.equal(owned(hello.world).length, 2, 'both coasts are in the world');
  assert.equal(hello.you.island, a.id, 'my body belongs over my own coast');

  const theirs = talk(wsUrl);
  await theirs.ready;
  theirs.say({ t: 'join', v: SEA_V, as: 'client', island: b.id });
  await theirs.next();

  const join = await mine.until((m) => m.t === 'join');
  assert.equal(join.p.island, b.id, 'and I can tell whose coast they came from');

  // The room. Both islands have a tavern; a bare slug would put a visitor to theirs
  // inside ours on our screen, which is why a room may name its island.
  const { room } = await import('../lib/players.mjs');
  assert.equal(room('tavern'), 'tavern', 'one island on its own still works unchanged');
  assert.equal(room(`${a.id}:tavern`), `${a.id}:tavern`);
  assert.notEqual(room(`${a.id}:tavern`), room(`${b.id}:tavern`), 'two taverns, two rooms');
  assert.equal(room('../../etc:tavern'), null);
  assert.equal(room(`${a.id}:NOT A SLUG`), null);

  mine.close();
  theirs.close();
}));

// The volcano's guards over the wire: a joiner is sent their roster, an islander coming
// online brings three more out of the guardhouse on the next beat - appended, so the first
// four keep their numbers - and going home again takes nobody away.
test('the volcano\'s guards come out for each islander and stay when they leave', () => afloat(async ({ sea, base, wsUrl }) => {
  const VOLCANO_ID = '0000000000000000';
  const watcher = talk(wsUrl);
  await watcher.ready;
  watcher.say({ t: 'join', v: SEA_V, as: 'client' });
  const first = await watcher.until((m) => m.t === 'fr' && m.i === VOLCANO_ID);
  assert.deepEqual(first.ids, ['guard:0', 'guard:1', 'guard:2', 'guard:3']);

  const a = island();
  await post(base, a.id, a.bundle, 'tok');
  const keeper = talk(wsUrl);
  await keeper.ready;
  keeper.say({ t: 'join', v: SEA_V, as: 'islander', island: a.id, token: 'tok' });
  const grown = await watcher.until((m) => m.t === 'fr' && m.i === VOLCANO_ID && m.ids.length > 4, 40);
  assert.deepEqual(grown.ids.slice(0, 4), first.ids);
  assert.equal(grown.ids.length, 7);
  // And their positions right behind the roster, rather than a keyframe later.
  const placed = await watcher.until((m) => m.t === 'f' && m.i === VOLCANO_ID, 10);
  assert.ok((placed.k.length + placed.a.length) / 4 >= 7, 'not everybody was placed at once');

  keeper.close();
  await watcher.until((m) => m.t === 'island' && m.a === 'rev' && m.live === false, 40);
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(sea.guards.target(), 4);
  assert.equal(sea.guards.standing(), 7, 'guards vanished when their islander went home');
  watcher.close();
}));
