// Who the roster's idle sweep may close, and who it must leave alone.
//
// The sweep exists for statues: a walking body whose tab froze without closing the
// socket. It used to sweep every connection instead, and two kinds of connection never
// say a word after joining - an islander, whose socket *is* its presence, and a page in
// orbit over its own island, which has nothing to report. Both were closed every sixty
// seconds as "idle" and came straight back. For the islander that meant a forced republish
// and a rebuilt crowd once a minute - every settler on the island walking back to their
// own door, on every screen in the world - and it showed up in data/server.log as a
// "joined" line a minute, all day, with nothing to say why.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

import { createSea, SEA_V } from '../lib/sea.mjs';
import { buildBundle, beaconId } from '../lib/islandbundle.mjs';
import { makeTerrain } from '../shared/terrain.mjs';

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

// A socket that remembers whether and why it was closed.
function talk(url) {
  const ws = new WebSocket(url);
  const state = { closed: null };
  ws.addEventListener('close', (e) => { state.closed = { code: e.code, reason: e.reason }; });
  return {
    ready: new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); }),
    say: (o) => ws.send(JSON.stringify(o)),
    state,
    close: () => { try { ws.close(); } catch { /* already gone */ } },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('the idle sweep closes a frozen walker, and nobody else', async () => {
  // A short leash, so the test does not have to wait a minute; the beat is 20 ms so the
  // roster ticks often enough to notice.
  const sea = createSea({ port: 0, name: 'test sea', tickMs: 20, idleMs: 150 });
  const addr = await sea.listen();
  const base = `http://127.0.0.1:${addr.port}`;
  const wsUrl = `ws://127.0.0.1:${addr.port}/ws`;
  try {
    const a = island();
    const put = await fetch(`${base}/island/${a.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Island-Token': 'tok' },
      body: JSON.stringify(a.bundle),
    });
    assert.equal(put.status, 200);

    // The islander: one join, then silence. That is the whole of what lib/seaclient.mjs
    // ever says on its socket.
    const keeper = talk(wsUrl);
    await keeper.ready;
    keeper.say({ t: 'join', v: SEA_V, as: 'islander', island: a.id, token: 'tok' });

    // A page in orbit: joined, said it is not walking, and then watches.
    const watcher = talk(wsUrl);
    await watcher.ready;
    watcher.say({ t: 'join', v: SEA_V, as: 'client', island: a.id });
    watcher.say({ t: 'w', on: false });

    // And a walker whose tab froze: one pose, then nothing at all.
    const frozen = talk(wsUrl);
    await frozen.ready;
    frozen.say({ t: 'join', v: SEA_V, as: 'client', island: a.id });
    frozen.say({ t: 'p', x: 1, y: 0, z: 1, yaw: 0, f: 1 });

    // Well past the leash, several sweeps over.
    await sleep(700);

    assert.equal(keeper.state.closed, null, `the islander was closed: ${JSON.stringify(keeper.state.closed)}`);
    assert.equal(watcher.state.closed, null, `a watching page was closed: ${JSON.stringify(watcher.state.closed)}`);
    assert.ok(frozen.state.closed, 'a frozen walker was left standing');
    assert.equal(frozen.state.closed.reason, 'idle');

    // And the island is still live, because its islander was never kicked.
    const world = await (await fetch(`${base}/world`)).json();
    assert.equal(world.islands.length, 1);
    assert.equal(world.islands[0].live, true);

    keeper.close(); watcher.close();
  } finally {
    await sea.close();
  }
});
