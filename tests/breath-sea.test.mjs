// Drowning through the wire: a page that says it is swimming below the surface is told about
// its air, runs out of it on the sea's own beat, is hurt and sent back with the reason on the
// `evicted` - and a page that stays at the surface is never spoken to about any of it.
// The shortened lung (`breath` option of createSea) is what keeps this under a second.
//
// Wanderers, not islanders: the phone's kind of player has a skiff to be sent back to, which
// is a refuge health.mjs can name without publishing an island with a town in it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

const { SEA_V, afloat, until } = await import('./support/sea.mjs');

const LUNG = { airS: 0.3, refillS: 0.3, drownPerS: 400 };
const SEA = { tickMs: 20, breath: LUNG };

// Every message the sea sends this socket, in order - the shared queue helper hands a message
// to one waiter, and these tests want to ask afterwards what did not arrive.
function listen(url) {
  const ws = new WebSocket(url);
  const seen = [];
  ws.addEventListener('message', (e) => seen.push(JSON.parse(e.data)));
  return {
    seen,
    ready: new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); }),
    say: (o) => ws.send(JSON.stringify(o)),
    close: () => { try { ws.close(); } catch { /* already gone */ } },
  };
}
const ofKind = (c, t) => c.seen.filter((m) => m.t === t);

// Joined, in the open water off nowhere in particular, out of the boat and on its own feet.
async function wanderer(wsUrl, x, z) {
  const c = listen(wsUrl);
  await c.ready;
  c.say({ t: 'join', v: SEA_V });
  await until(() => c.seen.some((m) => m.t === 'welcome'), 'no welcome');
  c.say({ t: 'boat', id: '', a: 'launch', x, z, yaw: 0 });
  await until(() => c.seen.some((m) => m.t === 'boat' && m.pilot), 'no skiff');
  const skiff = c.seen.find((m) => m.t === 'boat' && m.pilot);
  c.say({ t: 'boat', id: skiff.id, a: 'drop' });
  return { c, skiff, id: c.seen.find((m) => m.t === 'welcome').id };
}

test('a diver is told, runs out of air, is hurt, and is sent back to the skiff as drowned', async () => {
  await afloat(async ({ wsUrl }) => {
    const { c, skiff } = await wanderer(wsUrl, 500, 500);
    // Under: swimming, and 1 below the surface with a head half a unit above the feet.
    c.say({ t: 'p', x: 500, y: -1, z: 500, yaw: 0, f: 2 });
    await until(() => ofKind(c, 'evicted').length, 'never sent back', 400);

    const at = (pred) => c.seen.findIndex(pred);
    const under = at((m) => m.t === 'breath' && m.rate === -1);
    const hurt = at((m) => m.t === 'health' && m.hp < 100);
    const home = at((m) => m.t === 'evicted');
    assert.ok(under >= 0, 'nobody said the air was going');
    assert.deepEqual(c.seen[under], { t: 'breath', air: LUNG.airS, max: LUNG.airS, rate: -1 });
    assert.ok(hurt > under, 'health dropped before the air was gone, or never');
    assert.ok(home > hurt, 'sent back before it was hurt');
    const evicted = c.seen[home];
    assert.equal(evicted.why, 'drown');
    assert.equal(evicted.boat, skiff.id, 'a wanderer is put back in their own skiff');
    assert.equal(evicted.x, 500);
    assert.equal(evicted.z, 500);

    // Whole and dry again: a full lung, said after the reason.
    await until(() => c.seen.slice(home).some((m) => m.t === 'breath'), 'no breath after being sent back');
    const after = c.seen.slice(home).find((m) => m.t === 'breath');
    assert.deepEqual(after, { t: 'breath', air: LUNG.airS, max: LUNG.airS, rate: 0 });
    // And left at that: nobody is under any more, and immune for a while besides.
    const said = c.seen.length;
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(ofKind(c, 'evicted').length, 1);
    assert.equal(c.seen.slice(said).filter((m) => m.t === 'breath' || m.t === 'evicted').length, 0);
    c.close();
  }, SEA);
});

test('a swimmer at the surface never loses air, while a diver beside them does', async () => {
  await afloat(async ({ sea, wsUrl }) => {
    const swimmer = await wanderer(wsUrl, 600, 600);
    const diver = await wanderer(wsUrl, 700, 700);
    // Older pages, and everybody today, send -0.07 for a swimmer: never under.
    swimmer.c.say({ t: 'p', x: 600, y: -0.07, z: 600, yaw: 0, f: 2 });
    diver.c.say({ t: 'p', x: 700, y: -1, z: 700, yaw: 0, f: 2 });
    await until(() => ofKind(diver.c, 'evicted').length, 'the diver was never sent back', 400);
    // Longer again than it took the diver to drown.
    await new Promise((r) => setTimeout(r, 500));

    assert.equal(ofKind(diver.c, 'evicted')[0].why, 'drown');
    for (const kind of ['breath', 'health', 'evicted']) {
      assert.equal(ofKind(swimmer.c, kind).length, 0, `the swimmer at the surface was sent a ${kind}`);
    }
    const p = sea.roster.all().find((q) => q.id === swimmer.id);
    assert.equal(p.y, -0.07);
    assert.equal(sea.breath.air(p), LUNG.airS);
    swimmer.c.close();
    diver.c.close();
  }, SEA);
});

test('a body that is deep but not swimming - on a jetty, a deck - is not holding its breath', async () => {
  await afloat(async ({ sea, wsUrl }) => {
    const dry = await wanderer(wsUrl, 800, 800);
    dry.c.say({ t: 'p', x: 800, y: -1, z: 800, yaw: 0, f: 1 });     // moving, not swimming
    await until(() => sea.roster.all().some((q) => q.id === dry.id && q.posed && q.y === -1), 'the pose never arrived');
    await new Promise((r) => setTimeout(r, 500));
    for (const kind of ['breath', 'health', 'evicted']) assert.equal(ofKind(dry.c, kind).length, 0, `sent a ${kind}`);
    dry.c.close();
  }, SEA);
});

test('the sea with the real lung does not drown anybody in the first seconds', async () => {
  // The other side of the shortened one: the defaults, on the same wire.
  await afloat(async ({ wsUrl }) => {
    const { c } = await wanderer(wsUrl, 900, 900);
    c.say({ t: 'p', x: 900, y: -1, z: 900, yaw: 0, f: 2 });
    await until(() => ofKind(c, 'breath').length, 'no breath message', 200);
    assert.deepEqual(ofKind(c, 'breath')[0], { t: 'breath', air: 30, max: 30, rate: -1 });
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(ofKind(c, 'evicted').length, 0);
    assert.equal(ofKind(c, 'health').length, 0);
    c.close();
  }, { tickMs: 20 });
});
