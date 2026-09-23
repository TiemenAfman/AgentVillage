// An islander's Codex settlers reaching the volcano over the wire: the door, who may use it,
// what everybody watching is told, and what happens when the islander goes home. The rules
// behind it are tests/codex-residents.test.mjs; this is the plumbing, against a real sea.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

const { SEA_V, afloat, island, post, talk, until } = await import('./support/sea.mjs');
const { createSeaClient } = await import('../lib/seaclient.mjs');
const { GRACE_MS } = await import('../lib/fleet.mjs');
const { VOLCANO, CODEX, codexId, isCodex } = await import('../shared/volcano.mjs');

const TOKEN = 'a'.repeat(48);
const list = (n, from = 0) => ({
  settlers: Array.from({ length: n }, (_, i) => ({ id: `house:s${from + i}`, style: 'unknown', tier: 'hut', kind: 'house', active: false })),
});
const codexOn = (base, id, body, { token = TOKEN, key = null } = {}) => fetch(`${base}/island/${id}/codex`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Island-Token': token, ...(key ? { 'X-Sea-Key': key } : {}) },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

test('a Codex list puts houses and residents on the volcano without moving its rev or rebuilding its crowd', () => afloat(async ({ sea, base, wsUrl }) => {
  const a = island();
  assert.equal((await post(base, `/island/${a.id}`, a.bundle, TOKEN)).status, 200);

  const watcher = talk(wsUrl);
  await watcher.ready;
  watcher.say({ t: 'join', v: SEA_V, as: 'client', island: null, name: 'Someone' });
  await watcher.until((m) => m.t === 'welcome');

  const crowd = sea.crowds.get(VOLCANO.id);
  const guards = new Map(crowd.guards().map((f) => [f.id, f]));
  const rev = sea.fleet.get(VOLCANO.id).rev;

  const r = await codexOn(base, a.id, list(4));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, residents: 4, houses: 4 });

  // The houses first, then who the numbers mean - in that order, so a page has the building
  // before it is asked to dress the person who lives in it.
  const said = await watcher.until((m) => m.t === 'island' && m.a === 'codex');
  assert.equal(said.i, VOLCANO.id);
  assert.equal(said.houses.length, 4);
  assert.ok(said.houses.every((h) => h.id.startsWith(`codex:${a.id}:`) && h.plot && h.kind === 'house'));
  const roster = await watcher.until((m) => m.t === 'fr' && m.i === VOLCANO.id);
  assert.ok(roster.ids.includes(codexId(a.id, 'house:s2')));

  assert.equal(sea.fleet.get(VOLCANO.id).rev, rev, 'a Codex list moved the volcano\'s rev');
  assert.equal(sea.crowds.get(VOLCANO.id), crowd, 'the volcano\'s crowd was rebuilt');
  for (const f of crowd.guards()) assert.equal(guards.get(f.id), f, `${f.id} is a different body`);

  // Somebody fetching the volcano later gets the houses with it.
  const late = await (await fetch(`${base}/island/${VOLCANO.id}`)).json();
  assert.equal(late.buildings.filter((b) => isCodex(b.id)).length, 4);
  // And the manifest counts them, like any island's buildings.
  const world = await (await fetch(`${base}/world`)).json();
  assert.equal(world.islands.find((i) => i.volcano).buildings, 5);

  watcher.close();
  await watcher.closed;
}));

test('the Codex door wants the island\'s own claim, and refuses rather than repairs', () => afloat(async ({ base }) => {
  const a = island();
  await post(base, `/island/${a.id}`, a.bundle, TOKEN);
  assert.equal((await codexOn(base, '0123456789abcdef', list(1))).status, 404, 'an island nobody has heard of');
  assert.equal((await codexOn(base, 'not-an-id', list(1))).status, 400);
  assert.equal((await codexOn(base, a.id, list(1), { token: 'b'.repeat(48) })).status, 409, 'somebody else\'s island');
  assert.equal((await codexOn(base, VOLCANO.id, list(1))).status, 409, 'the sea\'s own');
  // An island published with no claim on it cannot be spoken for by anybody.
  const b = island({ port: 4748, name: 'Buurholm' });
  await post(base, `/island/${b.id}`, b.bundle);
  assert.equal((await codexOn(base, b.id, list(1), { token: '' })).status, 409);

  for (const body of [list(CODEX.PER_ISLANDER + 1), { settlers: [{ id: 'house:s1', style: 1, tier: 'hut', kind: 'house', active: false }] },
    { settlers: [], note: 'hello' }, 'not json']) {
    assert.equal((await codexOn(base, a.id, body)).status, 400, `${JSON.stringify(body).slice(0, 60)} got in`);
  }
  // Too big to be a list at all is said as that, with the connection closed behind it.
  const huge = JSON.stringify({ settlers: [], pad: 'x'.repeat(70 * 1024) });
  assert.equal((await codexOn(base, a.id, huge)).status, 413);
}));

test('a keyed sea asks for its key at the Codex door before anything else', () => afloat(async ({ base }) => {
  const a = island();
  const keyed = (path, body, headers = {}) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sea-Key': 'the-key', 'X-Island-Token': TOKEN, ...headers },
    body: JSON.stringify(body),
  });
  assert.equal((await keyed(`/island/${a.id}`, a.bundle)).status, 200);
  // Without the key it is 403 whatever else is wrong: an unknown island, a wrong token.
  assert.equal((await codexOn(base, a.id, list(1))).status, 403);
  assert.equal((await codexOn(base, '0123456789abcdef', list(1))).status, 403);
  assert.equal((await codexOn(base, a.id, list(1), { token: 'b'.repeat(48) })).status, 403);
  assert.equal((await codexOn(base, a.id, list(1), { key: 'the-key' })).status, 200);
}, { key: 'the-key' }));

test('an islander swept after its grace takes its houses and residents with it; the volcano stays', async () => {
  let time = Date.now();
  await afloat(async ({ sea, base }) => {
    const a = island();
    const b = island({ port: 4748, name: 'Buurholm' });
    await post(base, `/island/${a.id}`, a.bundle, TOKEN);
    await post(base, `/island/${b.id}`, b.bundle, TOKEN.replace(/a/g, 'c'));
    await codexOn(base, a.id, list(3));
    await codexOn(base, b.id, list(2), { token: TOKEN.replace(/a/g, 'c') });
    assert.equal(sea.residents.housed(), 5);
    const guards = sea.guards.standing();

    // Published over HTTP with no islander on the line, so both are already in their grace.
    // Keep b fresh and let a's run out.
    time += GRACE_MS - 1000;
    await codexOn(base, b.id, list(2), { token: TOKEN.replace(/a/g, 'c') });
    sea.fleet.get(b.id).seenAt = time;
    time += 2000;
    sea.sweep();

    assert.equal(sea.fleet.get(a.id), null, 'a was not swept');
    assert.ok(sea.fleet.get(VOLCANO.id), 'the volcano went with it');
    assert.equal(sea.residents.housed(), 2);
    const houses = sea.fleet.get(VOLCANO.id).bundle.buildings.filter((h) => isCodex(h.id));
    assert.ok(houses.every((h) => h.id.startsWith(`codex:${b.id}:`)));
    for (const f of sea.crowds.get(VOLCANO.id).residents()) {
      assert.equal(f.dead, f.id.startsWith(`codex:${a.id}:`), `${f.id} is in the wrong state`);
    }
    assert.equal(sea.guards.standing(), guards, 'the guards went too');
  }, { now: () => time });
});

test('an older islander that still publishes a hostile Codex island is just another hostile island', () => afloat(async ({ sea, base }) => {
  const home = island();
  const old = island({ port: 4749, name: 'Codex' });
  old.bundle.island.hostile = true;
  assert.equal((await post(base, `/island/${home.id}`, home.bundle, TOKEN)).status, 200);
  assert.equal((await post(base, `/island/${old.id}`, old.bundle, TOKEN.replace(/a/g, 'd'))).status, 200);
  assert.equal(sea.fleet.get(old.id).bundle.island.hostile, true);
  assert.ok(sea.crowds.get(old.id), 'the old Codex island has no crowd');
  // And the new door beside it works as it does for anybody.
  assert.equal((await codexOn(base, home.id, list(2))).status, 200);
  assert.equal(sea.residents.housed(), 2);
}));

test('an islander sends its Codex settlers after joining, again only when they change, and on a restarted sea', () => afloat(async ({ sea, base }) => {
  const a = island();
  let settlers = list(3);
  const client = createSeaClient({
    url: `${base}/`, islandId: a.id, token: TOKEN, bundle: () => a.bundle, codex: () => settlers,
  });
  try {
    await until(() => sea.residents.housed() === 3, 'the Codex settlers never arrived');
    assert.deepEqual((await client.sendCodex()).why, 'unchanged');
    settlers = list(5);
    assert.equal((await client.sendCodex()).sent, true);
    assert.equal(sea.residents.housed(), 5);
    // A sea that has lost the island answers 404; the island goes first and the list after it.
    sea.fleet.drop(a.id);
    sea.residents.drop(a.id);
    settlers = list(2);
    const r = await client.sendCodex();
    assert.equal(r.sent, true);
    assert.ok(sea.fleet.get(a.id), 'the island was not published again');
    assert.equal(sea.residents.housed(), 2);
  } finally {
    client.close();
  }
}));

test('the islander publishes one island: its Codex settlers go through the door, not as a second island', async () => {
  const src = await (await import('node:fs/promises')).readFile(new URL('../serve.mjs', import.meta.url), 'utf8');
  assert.equal([...src.matchAll(/createSeaClient\(/g)].length, 1, 'serve.mjs makes more than one sea client');
  assert.ok(!/:codex`/.test(src), 'serve.mjs still derives a Codex island id');
  assert.ok(/codex:\s*codexSettlers/.test(src), 'the sea client is not handed the Codex list');
  assert.ok(/packCodex\(/.test(src), 'the Codex list is not packed by the redacting packer');
});
