// The sea sends an island's people only to a socket that draws them
// (Plans/zee-stuurt-wat-je-ziet.md, `want` in lib/sea.mjs).
//
// Three kinds of socket, and what each is owed: a page that says which islands it draws is
// sent those and no others - and an island it starts to want arrives whole, at once, or its
// people would stand undrawn until their slice came round; a page from before `want` says
// nothing and is sent everything, exactly as it was; and an islander draws nothing and is
// sent none of it. Two islands throughout, so "only those" has something to leave out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

const { SEA_V, afloat, island, post, until } = await import('./support/sea.mjs');
const { decodeCrowd } = await import('../shared/settlerwire.mjs');

// A socket that keeps everything it is sent, in order.
function listen(wsUrl, join) {
  const ws = new WebSocket(wsUrl);
  const heard = [];
  ws.addEventListener('message', (e) => heard.push(JSON.parse(e.data)));
  const ready = new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); })
    .then(() => ws.send(JSON.stringify({ t: 'join', v: SEA_V, ...join })));
  return {
    ready,
    heard,
    say: (o) => ws.send(JSON.stringify(o)),
    rows: (id, from = 0) => heard.slice(from).filter((m) => m.t === 'f' && m.i === id),
    close: () => { ws.close(); return new Promise((res) => ws.addEventListener('close', res)); },
  };
}
const beats = (n = 12) => new Promise((r) => setTimeout(r, n * 66));

async function twoIslands(base) {
  const a = island({ port: 4747, name: 'Promptholm' });
  const b = island({ port: 4748, name: 'Buurholm' });
  assert.equal((await post(base, `/island/${a.id}`, a.bundle, 'tok-a')).status, 200);
  assert.equal((await post(base, `/island/${b.id}`, b.bundle, 'tok-b')).status, 200);
  return { a, b };
}

// Everybody on an island the sea would place: visible, ashore.
const placeable = (crowd) => [...crowd.figures.values()].filter((f) => f.visible && !f.aboard).length;

test('a page that says what it draws is sent only those islands, and one it starts to want whole', () => afloat(async ({ sea, base, wsUrl }) => {
  const { a, b } = await twoIslands(base);
  const page = listen(wsUrl, { as: 'client', want: [b.id] });
  await page.ready;
  await until(() => page.heard.some((m) => m.t === 'welcome'), 'no welcome');
  await beats();
  // Who the numbers mean goes to every page; where they are only for what it draws.
  assert.ok(page.heard.some((m) => m.t === 'fr' && m.i === a.id), 'the roster of an island it does not draw was kept back');
  assert.equal(page.rows(a.id).length, 0, 'sent the people of an island it never asked for');
  assert.ok(page.rows(b.id).length > 0, 'not sent the island it draws');

  // Walking towards the other island: everybody on it at once, in one message.
  const from = page.heard.length;
  page.say({ t: 'want', i: [a.id, b.id] });
  await until(() => page.rows(a.id, from).length > 0, 'the island it started to want never came');
  const first = page.rows(a.id, from)[0];
  const placed = decodeCrowd(first.k, 32, decodeCrowd(first.a, 32));
  assert.equal(placed.size, placeable(sea.crowds.get(a.id)), 'a newly wanted island arrived a slice at a time');
  assert.ok(page.heard.slice(from).some((m) => m.t === 'fh' && m.i === a.id), 'not told who is held there');

  // And letting go of it stops it.
  page.say({ t: 'want', i: [b.id] });
  await beats(3);
  const after = page.heard.length;
  await beats();
  assert.equal(page.rows(a.id, after).length, 0, 'still sent an island it let go of');
  await page.close();
}));

test('a page that has said nothing is sent everything, as it always was', () => afloat(async ({ base, wsUrl }) => {
  const { a, b } = await twoIslands(base);
  const old = listen(wsUrl, { as: 'client' });
  await old.ready;
  await until(() => old.rows(a.id).length > 0 && old.rows(b.id).length > 0, 'a page from before want lost an island');
  await old.close();
}));

test('wanting nothing on the handshake keeps the join dump to the rosters', () => afloat(async ({ base, wsUrl }) => {
  const { a, b } = await twoIslands(base);
  const page = listen(wsUrl, { as: 'client', want: [] });
  await page.ready;
  await until(() => page.heard.filter((m) => m.t === 'fr').length >= 2, 'the rosters never came');
  await beats();
  assert.equal(page.rows(a.id).length + page.rows(b.id).length, 0);
  assert.equal(page.heard.filter((m) => m.t === 'fh').length, 0);
  await page.close();
}));

test('an islander is sent nobody\'s people and nobody\'s pose beat', () => afloat(async ({ base, wsUrl }) => {
  const { a } = await twoIslands(base);
  const keeper = listen(wsUrl, { as: 'islander', island: a.id, token: 'tok-a' });
  // A walker somewhere, so there is a pose beat with somebody in it to be left out of.
  const walker = listen(wsUrl, { as: 'client', want: [] });
  await keeper.ready;
  await walker.ready;
  await until(() => keeper.heard.some((m) => m.t === 'welcome'), 'no welcome for the islander');
  walker.say({ t: 'p', x: 1, y: 0, z: 1, yaw: 0, f: 0 });
  await beats();
  assert.ok(walker.heard.some((m) => m.t === 's' && m.a.length), 'the walker never saw itself on the beat');
  const drawn = keeper.heard.filter((m) => ['f', 'fh', 'fr', 'af', 'herd', 's', 'roster'].includes(m.t));
  assert.deepEqual(drawn.map((m) => m.t), [], 'an islander was sent what only a page draws');
  // And saying it wants something changes nothing: it has nothing to draw it with.
  keeper.say({ t: 'want', i: [a.id] });
  await beats();
  assert.equal(keeper.rows(a.id).length, 0);
  await keeper.close();
  await walker.close();
}));

test('a want is cut to its shape: ids only, and at most MAX_WANT of them', async () => {
  const { MAX_WANT } = await import('../lib/sea.mjs');
  await afloat(async ({ base, wsUrl }) => {
    const { a } = await twoIslands(base);
    const junk = Array.from({ length: MAX_WANT }, (_, n) => (0x10000000 + n).toString(16));
    const page = listen(wsUrl, { as: 'client', want: ['../etc', 42, ...junk, a.id] });
    await page.ready;
    await until(() => page.heard.some((m) => m.t === 'welcome'), 'no welcome');
    await beats();
    // The real id came after MAX_WANT others, so it was cut, and the rubbish never counted.
    assert.equal(page.rows(a.id).length, 0, 'the list was not cut at MAX_WANT');
    await page.close();
  });
});

test('nobody walking is said once, not fifteen times a second', () => afloat(async ({ wsUrl }) => {
  const page = listen(wsUrl, { as: 'client' });
  await page.ready;
  await until(() => page.heard.some((m) => m.t === 'welcome'), 'no welcome');
  page.say({ t: 'p', x: 1, y: 0, z: 1, yaw: 0, f: 0 });
  await until(() => page.heard.some((m) => m.t === 's' && m.a.length), 'never on the beat');
  page.say({ t: 'w', on: false });
  await until(() => page.heard.some((m) => m.t === 's' && !m.a.length), 'the last walker was never taken off');
  const from = page.heard.length;
  await beats();
  assert.equal(page.heard.slice(from).filter((m) => m.t === 's').length, 0, 'an empty beat went out again');
  await page.close();
}));
