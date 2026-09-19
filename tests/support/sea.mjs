// A sea on an ephemeral port, a socket with a little queue, and an island with people in
// it. Three tests need all three; the fourth copy was the moment to put them somewhere.
//
// tests/sea-join.test.mjs deliberately keeps its own: its fixture village is empty on
// purpose - it is testing the handshake, not the crowd - and folding the two together
// would mean one of them carrying a flag for the other.
import assert from 'node:assert/strict';
import { createSea, SEA_V } from '../../lib/sea.mjs';
import { buildBundle, beaconId } from '../../lib/islandbundle.mjs';
import { makeTerrain } from '../../shared/terrain.mjs';

export { SEA_V };
export const SIZE = 64;
export const SEED = 1337;

// A lane of houses along the middle of the island. Real cells, because a village whose
// houses are not on land has no crowd and every assertion about one passes emptily.
export function island({ port = 4747, name = 'Promptholm', houses = 6 } = {}) {
  const terrain = makeTerrain(SEED, { size: SIZE });
  const mid = Math.round(terrain.half);
  const lane = [];
  for (let gx = 8; gx < SIZE - 8; gx++) if (terrain.isLand(gx, mid)) lane.push([gx, mid]);
  const buildings = lane.slice(0, houses).map(([gx, gz], i) => ({
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
  return { id, terrain, bundle: buildBundle({ config: { islandName: name, seed: SEED, port, gridSize: SIZE }, village, id, keeper: 'Martijn' }) };
}

export const post = (base, path, body, token) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Island-Token': token } : {}) },
  body: JSON.stringify(body),
});

export function talk(url) {
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
    // The sea says more than one kind of thing on one socket, so a test that wants a
    // particular one has to say so rather than taking whatever arrives first.
    until: async (pred, tries = 24) => {
      for (let i = 0; i < tries; i++) { const m = await next(); if (pred(m)) return m; }
      throw new Error('the sea never said it');
    },
    close: () => ws.close(),
    closed: new Promise((res) => ws.addEventListener('close', res)),
  };
}

// Conditions rather than sleeps: the sea's own beat runs while a test does.
export async function until(pred, what, tries = 200) {
  for (let i = 0; i < tries; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail(`gave up waiting: ${what}`);
}

export async function afloat(fn, opts = {}) {
  const sea = createSea({ port: 0, name: 'test sea', ...opts });
  const addr = await sea.listen();
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    return await fn({ sea, base, wsUrl: `ws://127.0.0.1:${addr.port}/ws` });
  } finally {
    await sea.close();
  }
}
