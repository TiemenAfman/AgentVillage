// Respawn to town over the wire (issue #74): a page asks with a bare `{t:'respawn'}` and the
// sea answers with the same `evicted` a capture sends, `why: 'respawn'`, to the refuge it
// works out itself - or with `{t:'respawn', ok:false}` when there is nowhere to go or it is
// too soon. Wanderers, like tests/breath-sea.test.mjs: a skiff is a refuge without an island.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

const { SEA_V, afloat, until } = await import('./support/sea.mjs');

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

async function joined(wsUrl) {
  const c = listen(wsUrl);
  await c.ready;
  c.say({ t: 'join', v: SEA_V });
  await until(() => c.seen.some((m) => m.t === 'welcome'), 'no welcome');
  return c;
}

test('a wanderer adrift asks to go home and is put back in their own skiff, where the sea says', async () => {
  await afloat(async ({ sea, wsUrl }) => {
    const c = await joined(wsUrl);
    c.say({ t: 'boat', id: '', a: 'launch', x: 500, z: 500, yaw: 0 });
    await until(() => c.seen.some((m) => m.t === 'boat' && m.pilot), 'no skiff');
    const skiff = c.seen.find((m) => m.t === 'boat' && m.pilot);
    c.say({ t: 'boat', id: skiff.id, a: 'drop' });
    // Far off, swimming: the page's claim of where it is changes nothing about where home is.
    c.say({ t: 'p', x: 900, y: -0.07, z: 1200, yaw: 0, f: 2 });
    await until(() => sea.roster.all().some((p) => p.x === 900), 'the pose never arrived');
    c.say({ t: 'respawn', x: 0, z: 0 });
    await until(() => ofKind(c, 'evicted').length, 'never taken home');
    const e = ofKind(c, 'evicted')[0];
    assert.equal(e.why, 'respawn');
    assert.equal(e.boat, skiff.id);
    assert.deepEqual([e.x, e.z], [500, 500], 'the skiff, not anything the page said');
    // Asked again at once: refused out loud, not taken home twice.
    c.say({ t: 'respawn' });
    await until(() => ofKind(c, 'respawn').length, 'the refusal was never said');
    assert.deepEqual(ofKind(c, 'respawn')[0], { t: 'respawn', ok: false });
    assert.equal(ofKind(c, 'evicted').length, 1);
    // And nobody was hurt along the way.
    assert.equal(ofKind(c, 'health').length, 0);
    c.close();
  });
});

test('with nowhere to go - no skiff, no island - the sea says no and moves nobody', async () => {
  await afloat(async ({ sea, wsUrl }) => {
    const c = await joined(wsUrl);
    c.say({ t: 'p', x: 300, y: -0.07, z: 300, yaw: 0, f: 2 });
    await until(() => sea.roster.all().some((p) => p.x === 300), 'the pose never arrived');
    c.say({ t: 'respawn' });
    await until(() => ofKind(c, 'respawn').length, 'no answer');
    assert.deepEqual(ofKind(c, 'respawn')[0], { t: 'respawn', ok: false });
    assert.equal(ofKind(c, 'evicted').length, 0);
    assert.equal(sea.roster.all()[0].x, 300);
    c.close();
  });
});
