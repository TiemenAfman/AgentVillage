// Walking up to a settler on an island that is not at the origin.
//
// tests/crowd-attend.test.mjs covers the bookkeeping; this covers the one thing only the
// wire can get wrong. A pose travels in WORLD coordinates and a crowd walks in its own
// island's frame, so an `attend` has the island's origin taken off it on the way in
// (lib/sea.mjs). Get that backwards and a settler on the second island turns to face
// somebody standing an island's width out to sea - which looks, from the one screen that
// would notice, like the settler simply ignoring you.
//
// So: two islands, deliberately, because with one the origin is [0, 0] and every sign
// error in this file passes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

import { createSea, SEA_V } from '../lib/sea.mjs';
import { buildBundle, beaconId } from '../lib/islandbundle.mjs';
import { makeTerrain } from '../shared/terrain.mjs';
import { decodeCrowd } from '../shared/settlerwire.mjs';

const SIZE = 64;
const SEED = 1337;

// A village with people in it, which the join test's fixture deliberately has not got.
function island({ port = 4747, name = 'Promptholm' } = {}) {
  const terrain = makeTerrain(SEED, { size: SIZE });
  const mid = Math.round(terrain.half);
  const lane = [];
  for (let gx = 8; gx < SIZE - 8; gx++) if (terrain.isLand(gx, mid)) lane.push([gx, mid]);
  const buildings = lane.slice(0, 6).map(([gx, gz], i) => ({
    id: `house:${String(i).padStart(4, '0')}`,
    kind: 'house', name: `House ${i}`, style: 'opus', sessionId: `s${i}`,
    plot: { gx, gz: gz + 1, w: 1, d: 1, rot: 0 },
  }));
  const id = beaconId(port, `host-${port}`);
  const village = {
    generatedAt: '2026-09-18T10:00:00.000Z',
    island: {
      name, seed: SEED, gridSize: SIZE, terrainHash: terrain.hash,
      foundedAt: '2026-09-16T10:22:44.431Z',
      landing: null, town: { gx: 32, gz: 32, r: 8, paved: lane.slice(0, 4) }, lattice: null,
    },
    grid: { size: SIZE },
    districts: [], buildings, paths: [{ id: 'lane', cells: lane }], bridges: [],
    cleared: [], polders: [], milestones: [], active: [], assignments: [], stats: {},
  };
  return { id, bundle: buildBundle({ config: { islandName: name, seed: SEED, port, gridSize: SIZE }, village, id, keeper: 'Martijn' }) };
}

const post = (base, id, body) => fetch(`${base}/island/${id}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
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
    until: async (pred, tries = 24) => {
      for (let i = 0; i < tries; i++) { const m = await next(); if (pred(m)) return m; }
      throw new Error('the sea never said it');
    },
    close: () => ws.close(),
    closed: new Promise((res) => ws.addEventListener('close', res)),
  };
}

// Conditions rather than sleeps: the sea's own beat runs while a test does.
async function until(pred, what, tries = 200) {
  for (let i = 0; i < tries; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`gave up waiting: ${what}`);
}

async function afloat(fn) {
  const sea = createSea({ port: 0, name: 'test sea' });
  const addr = await sea.listen();
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    return await fn({ sea, base, wsUrl: `ws://127.0.0.1:${addr.port}/ws` });
  } finally {
    await sea.close();
  }
}

test('an attend lands in the island’s own frame, wherever the island is moored', async () => {
  await afloat(async ({ sea, base, wsUrl }) => {
    const a = island({ port: 4747, name: 'Promptholm' });
    const b = island({ port: 4748, name: 'Buurholm' });
    await post(base, a.id, a.bundle);
    const moored = await (await post(base, b.id, b.bundle)).json();
    const [ox, oz] = moored.origin;
    assert.ok(ox !== 0 || oz !== 0, 'the second island moored at the origin; this test proves nothing');

    const me = talk(wsUrl);
    await me.ready;
    me.say({ t: 'join', v: SEA_V, as: 'client', island: b.id, name: 'Martijn' });
    await me.until((m) => m.t === 'welcome');

    const crowd = sea.crowds.get(b.id);
    const f = [...crowd.figures.values()][0];
    // Stand a stride to the east of them, said in world coordinates the way a pose is.
    const at = [f.pos[0] + 1.2, f.pos[1]];
    me.say({ t: 'attend', b: f.id, x: at[0] + ox, z: at[1] + oz });

    await until(() => f.attend, 'the settler was never held');
    assert.ok(Math.abs(f.attend[0] - at[0]) < 1e-6 && Math.abs(f.attend[1] - at[1]) < 1e-6,
      `held at ${f.attend} instead of ${at} - the origin went the wrong way`);

    // And the island that was not spoken to is untouched.
    for (const g of sea.crowds.get(a.id).figures.values()) assert.equal(g.attend, null);

    // Closing the laptop mid-sentence lets them go.
    me.close();
    await me.closed;
    await until(() => !f.attend, 'a settler is still waiting for somebody who left');
  });
});

test('a wanderer with no island of their own cannot hold anybody', async () => {
  await afloat(async ({ sea, base, wsUrl }) => {
    const a = island();
    await post(base, a.id, a.bundle);

    const me = talk(wsUrl);
    await me.ready;
    me.say({ t: 'join', v: SEA_V, as: 'client', island: null, name: 'Phone' });
    await me.until((m) => m.t === 'welcome');

    const f = [...sea.crowds.get(a.id).figures.values()][0];
    me.say({ t: 'attend', b: f.id, x: f.pos[0] + 1, z: f.pos[1] });
    // Nothing to wait for, so give the sea a few beats to have done the wrong thing.
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(f.attend, null);
    me.close();
    await me.closed;
  });
});

test('somebody who has just joined is handed the whole village at once', async () => {
  // The beat pins one slice of a crowd per tick and takes KEYFRAME_S to get round
  // everybody. That is right for keeping a crowd honest and quite wrong for somebody who
  // has just walked in: they would watch the village fill up over ten seconds, and until
  // a body has been placed once it is not drawn at all.
  await afloat(async ({ sea, base, wsUrl }) => {
    const a = island();
    await post(base, a.id, a.bundle);
    const lives = sea.crowds.get(a.id).figures.size;
    assert.ok(lives > 1, 'the fixture village is too small to tell a slice from a crowd');

    const me = talk(wsUrl);
    await me.ready;
    me.say({ t: 'join', v: SEA_V, as: 'client', island: a.id, name: 'Martijn' });
    await me.until((m) => m.t === 'welcome');

    const roster = await me.until((m) => m.t === 'fr' && m.i === a.id);
    assert.equal(roster.ids.length, lives);

    // The very next thing about this island is everybody in it, not a slice of two.
    const where = await me.until((m) => m.t === 'f' && m.i === a.id, 4);
    const rows = decodeCrowd(where.k, 32, decodeCrowd(where.a, 32));
    assert.equal(rows.size, lives, `placed ${rows.size} of ${lives} on the first message`);

    me.close();
    await me.closed;
  });
});
