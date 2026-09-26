// The story animals over the wire, against a real sea (lib/sea.mjs, lib/animal-crowd.mjs,
// docs/animals-wire.md): the door and who may use it, what everybody watching is told, the
// one message only the island's own islander hears, and what a republish and a sweep do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

const { SEA_V, afloat, island, post, talk } = await import('./support/sea.mjs');
const { GRACE_MS } = await import('../lib/fleet.mjs');
const { AF_STRIDE } = await import('../shared/animalwalk.mjs');
const { VOLCANO } = await import('../shared/volcano.mjs');

const TOKEN = 'a'.repeat(48);

// A hen on a small patch on the lane, and an errand right at its middle - so it is walked,
// done and reported inside a couple of seconds of real beat.
function herdOn(a, { gen = 3, seq = 42, action = true, name = 'Pip' } = {}) {
  const mid = Math.round(a.terrain.half);
  let cell = null;
  for (let gx = 20; gx < 44 && !cell; gx++) if (a.terrain.isLand(gx, mid)) cell = [gx, mid];
  const home = a.terrain.cellWorld(cell[0], cell[1]);
  return {
    v: 1, seq, gen,
    animals: [{ id: 'animal:1', species: 'chicken', name, traits: ['curious'], home, r: 0.3, about: 'A hen.', friends: [{ who: 'house:s1', label: 'bonded' }] }],
    actions: action ? [{ id: 'act:1:0', animal: 'animal:1', act: 'peck', dur: 1, to: home, look: null }] : [],
    traces: [{ id: 'trace:nest:animal:1', kind: 'nest', x: home[0], z: home[1], rot: 0, name: 'Pip\'s nest', at: 1790000000000 }],
  };
}

const animalsOn = (base, id, body, { token = TOKEN, key = null } = {}) => fetch(`${base}/island/${id}/animals`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Island-Token': token, ...(key ? { 'X-Sea-Key': key } : {}) },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

// Everything a socket is told, kept, so a test can ask what arrived as well as wait for it.
function listen(url) {
  const s = talk(url);
  const heard = [];
  const waiters = [];
  (async () => {
    await s.ready.catch(() => {});
    for (;;) {
      const m = await s.next();
      heard.push(m);
      for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
    }
  })();
  return {
    ...s,
    heard,
    wait: (pred, ms = 8000, what = 'the sea never said it') => {
      const had = heard.find(pred);
      if (had) return Promise.resolve(had);
      return new Promise((res, rej) => {
        const w = { pred, res };
        waiters.push(w);
        setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); rej(new Error(what)); } }, ms).unref?.();
      });
    },
  };
}

async function joined(wsUrl, join) {
  const s = listen(wsUrl);
  await s.ready;
  s.say({ t: 'join', v: SEA_V, name: 'Someone', ...join });
  await s.wait((m) => m.t === 'welcome', 4000, 'no welcome');
  return s;
}

test('a herd is walked, shown to everybody, and its errand reported to its own islander only', () => afloat(async ({ sea, base, wsUrl }) => {
  const a = island();
  assert.equal((await post(base, `/island/${a.id}`, a.bundle, TOKEN)).status, 200);
  const keeper = await joined(wsUrl, { as: 'islander', island: a.id, token: TOKEN });
  const watcher = await joined(wsUrl, { as: 'client', island: a.id });
  // A second islander socket for somebody else's island, and a client wearing the right token.
  const b = island({ port: 4748, name: 'Buurholm' });
  await post(base, `/island/${b.id}`, b.bundle, 'b'.repeat(48));
  const neighbour = await joined(wsUrl, { as: 'islander', island: b.id, token: 'b'.repeat(48) });
  const pretender = await joined(wsUrl, { as: 'client', island: a.id, token: TOKEN });
  const rev = sea.fleet.get(a.id).rev;

  const body = herdOn(a);
  const r = await animalsOn(base, a.id, body);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, animals: 1, actions: 1, traces: 1 });

  const herd = await watcher.wait((m) => m.t === 'herd' && m.i === a.id);
  assert.deepEqual(herd, { t: 'herd', i: a.id, seq: 42, animals: body.animals, traces: body.traces });
  assert.ok(!('actions' in herd), 'the errands went out to everybody');
  const af = await watcher.wait((m) => m.t === 'af' && m.i === a.id);
  assert.equal(af.r.length % AF_STRIDE, 0);
  assert.equal(af.r[0], 0, 'the one animal is not index 0');

  const done = await keeper.wait((m) => m.t === 'animal', 10000, 'the errand was never reported');
  assert.deepEqual(done, { t: 'animal', a: 'done', i: a.id, action: 'act:1:0', gen: 3 });
  await new Promise((res) => setTimeout(res, 300));
  for (const s of [watcher, neighbour, pretender]) {
    assert.equal(s.heard.filter((m) => m.t === 'animal').length, 0, 'a done reached somebody other than the islander');
  }
  assert.equal(keeper.heard.filter((m) => m.t === 'animal').length, 1, 'the done was said twice');
  assert.equal(sea.fleet.get(a.id).rev, rev, 'the animals moved the island\'s rev');

  // Posted again after a reconnect, under a new generation: answered, not walked again.
  const hen = sea.herds.get(a.id).walk.get('animal:1');
  const again = await animalsOn(base, a.id, herdOn(a, { gen: 4 }));
  assert.equal(again.status, 200);
  const twice = await keeper.wait((m) => m.t === 'animal' && m.gen === 4, 3000, 'a finished errand re-posted was not answered');
  assert.equal(twice.action, 'act:1:0');
  assert.equal(hen.errand, null, 'a finished errand was walked again');
  assert.equal(sea.herds.get(a.id).walk.get('animal:1'), hen, 'the hen was made again');

  // Anybody may ask what the herd is.
  const pub = await (await fetch(`${base}/island/${a.id}/animals`)).json();
  assert.deepEqual(pub, { seq: 42, animals: body.animals, traces: body.traces });
  assert.equal((await fetch(`${base}/island/0123456789abcdef/animals`)).status, 404);

  // And somebody arriving later is told all of it at once.
  const late = await joined(wsUrl, { as: 'client', island: null });
  const lateHerd = await late.wait((m) => m.t === 'herd' && m.i === a.id, 2000, 'the join dump had no herd');
  assert.equal(lateHerd.animals[0].name, 'Pip');
  const lateRows = await late.wait((m) => m.t === 'af' && m.i === a.id, 2000, 'the join dump had no rows');
  assert.equal(lateRows.r.length, AF_STRIDE);

  for (const s of [keeper, watcher, neighbour, pretender, late]) s.close();
}));

test('the animals door wants the key, then the island\'s own claim, then a body it can read', () => afloat(async ({ base }) => {
  const a = island();
  const keyed = (path, body) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sea-Key': 'the-key', 'X-Island-Token': TOKEN }, body: JSON.stringify(body),
  });
  assert.equal((await keyed(`/island/${a.id}`, a.bundle)).status, 200);
  assert.equal((await animalsOn(base, a.id, herdOn(a))).status, 403, 'a keyed sea took animals without its key');
  assert.equal((await animalsOn(base, '0123456789abcdef', herdOn(a))).status, 403, 'the key is not asked first');
  assert.equal((await animalsOn(base, a.id, herdOn(a), { key: 'the-key' })).status, 200);
}, { key: 'the-key' }));

test('the animals door refuses rather than repairs, and a refusal changes nothing', () => afloat(async ({ sea, base }) => {
  const a = island();
  await post(base, `/island/${a.id}`, a.bundle, TOKEN);
  assert.equal((await animalsOn(base, '0123456789abcdef', herdOn(a))).status, 404, 'an island nobody has heard of');
  assert.equal((await animalsOn(base, 'not-an-id', herdOn(a))).status, 400);
  assert.equal((await animalsOn(base, a.id, herdOn(a), { token: 'b'.repeat(48) })).status, 409, 'somebody else\'s island');
  assert.equal((await animalsOn(base, VOLCANO.id, herdOn(a))).status, 409, 'the sea\'s own');
  assert.equal((await animalsOn(base, a.id, herdOn(a, { action: false }))).status, 200);
  const before = JSON.stringify(sea.herds.publicOf(a.id));

  const off = herdOn(a);
  off.actions[0].to = [a.terrain.half + 1, 0];
  const stranger = herdOn(a);
  stranger.actions[0].animal = 'animal:2';
  for (const bad of [off, stranger, { ...herdOn(a), note: 'hello' }, { ...herdOn(a, { name: 'Somebody else' }), v: 2 }, 'not json']) {
    assert.equal((await animalsOn(base, a.id, bad)).status, 400, `${JSON.stringify(bad).slice(0, 60)} got in`);
  }
  assert.equal((await animalsOn(base, a.id, JSON.stringify({ ...herdOn(a), pad: 'x'.repeat(20 * 1024) }))).status, 413);
  assert.equal(JSON.stringify(sea.herds.publicOf(a.id)), before, 'a refused body changed the herd');
  // And a sea that has no such door says so in the words the islander looks for.
  const nothing = await (await fetch(`${base}/nothing`)).json();
  assert.match(nothing.error || '', /island\/:id\/animals/);
}));

test('a republish keeps every animal where it stands, on the new ground', () => afloat(async ({ sea, base }) => {
  const a = island();
  await post(base, `/island/${a.id}`, a.bundle, TOKEN);
  await animalsOn(base, a.id, herdOn(a, { action: false }));
  const herd = sea.herds.get(a.id);
  const hen = herd.walk.get('animal:1');
  await new Promise((res) => setTimeout(res, 300));
  const at = [hen.pos[0], hen.pos[1]];
  assert.equal((await post(base, `/island/${a.id}`, a.bundle, TOKEN)).status, 200);
  assert.equal(herd.terrain, sea.fleet.get(a.id).terrain, 'the herd still stands on the old island');
  assert.equal(sea.herds.get(a.id).walk.get('animal:1'), hen, 'the republish made a new hen');
  const moved = Math.sqrt((hen.pos[0] - at[0]) ** 2 + (hen.pos[1] - at[1]) ** 2);
  assert.ok(moved < 0.2, `she moved ${moved} in a republish`);
}));

test('an island swept after its grace takes its herd with it, and everybody is told', async () => {
  let time = Date.now();
  await afloat(async ({ sea, base, wsUrl }) => {
    const a = island();
    // Over HTTP with nobody on the line, so it is already in its grace.
    await post(base, `/island/${a.id}`, a.bundle, TOKEN);
    await animalsOn(base, a.id, herdOn(a));
    const watcher = await joined(wsUrl, { as: 'client', island: null });
    await watcher.wait((m) => m.t === 'herd' && m.i === a.id && m.animals.length === 1);
    time += GRACE_MS + 1000;
    sea.sweep();
    const gone = await watcher.wait((m) => m.t === 'herd' && m.i === a.id && m.animals.length === 0, 2000, 'nobody was told the herd went');
    assert.deepEqual(gone, { t: 'herd', i: a.id, seq: 0, animals: [], traces: [] });
    assert.equal(sea.herds.has(a.id), false);
    watcher.close();
  }, { now: () => time });
});
