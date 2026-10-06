// Going down before going home (Plans/vallen-en-verdrinken.md): the sea tells everybody else that
// a body fell or drowned (`fell`, lib/players.mjs evict) and nobody about a respawn; walk mode holds
// the body where it was caught and plays the death (walk.die), sinking a drowned one to the bed;
// and the rig does it procedurally on every body without a baked clip - the Traveller always, the
// Adventurer until gait-clips.js has `die` and `drown`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);

const noop = () => {};
const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (() => ({ width: 0 }))), set: (t, k, v) => { t[k] = v; return true; } });
const el = () => ({ addEventListener: noop, removeEventListener: noop, set src(_) {}, style: {}, width: 64, height: 64, getContext: () => ctx });
globalThis.document = {
  createElementNS: el, createElement: el, addEventListener: noop, removeEventListener: noop,
  pointerLockElement: null, exitPointerLock: noop,
};
const handlers = { keydown: [], keyup: [] };
globalThis.addEventListener = (type, fn) => { if (handlers[type]) handlers[type].push(fn); };
globalThis.removeEventListener = noop;
const { createWalkMode } = await import('../web/js/walk.js');
const { normalizeAvatar } = await import('../web/js/avatar.js');
const { createClassicAvatar, DEATH_REST } = await import('../web/js/classic-avatar.js');
const { GAIT_CLIPS } = await import('../web/js/gait-clips.js');
const { SEA_V, afloat, until } = await import('./support/sea.mjs');

const FRAME = 1 / 60;
const run = (walk, seconds) => { for (let i = 0; i < Math.round(seconds / FRAME); i++) walk.update(FRAME); };
const key = (k, down) => {
  const e = { key: k, repeat: false, ctrlKey: false, metaKey: false, altKey: false, target: {}, preventDefault: noop };
  for (const fn of handlers[down ? 'keydown' : 'keyup']) fn(e);
};

function make(character, { height = () => 1, bed = height } = {}) {
  handlers.keydown.length = 0;
  handlers.keyup.length = 0;
  const walk = createWalkMode({
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(60, 1, 0.5, 1000),
    terrain: { half: 64, size: 128, worldHeight: height }, ground: { height, bedAt: bed, regionAt: () => null, levelKey: () => null },
    material: new THREE.MeshBasicMaterial(), avatar: normalizeAvatar({ character }),
    dom: { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} },
  });
  walk.enter({ at: [0, -40], facing: [0, 0], blockers: [], interactables: [], onExit: noop });
  run(walk, 0.2);
  return walk;
}

for (const character of ['traveller', 'adventurer']) {
  const procedural = character === 'traveller' || !GAIT_CLIPS.die;
  test(`${character}: a fall ${procedural ? 'topples the body over its feet and lies' : 'plays the clip'}, and lets go after`, () => {
    const rig = createClassicAvatar(normalizeAvatar({ character }), new THREE.MeshBasicMaterial());
    const s = rig.dyingSeconds('fall');
    assert.ok(s > 0.5 && s <= 4, `takes ${s} s`);
    const d = { kind: 'fall', t: 0 };
    for (let t = 0; t < s + 0.2; t += FRAME) { d.t = t; rig.update({ dying: d, distance: 0 }, FRAME); }
    if (procedural) assert.ok(Math.abs(rig.object.rotation.x - 1.45) < 0.01, `face down at ${rig.object.rotation.x}`);
    // Up again (the jump home is under a black screen): the root settles back to standing.
    for (let i = 0; i < 60; i++) rig.update({ grounded: true, distance: 0 }, FRAME);
    assert.ok(Math.abs(rig.object.rotation.x) < 0.02, `stands again at ${rig.object.rotation.x}`);
  });

  test(`${character}: walk mode holds a dying body - no key moves it - and gives it back`, () => {
    const walk = make(character);
    const at = walk.state.pos.clone();
    const s = walk.die('fall');
    assert.ok(s > DEATH_REST, `holds for ${s} s`);
    key('w', true);
    run(walk, 0.5);
    key('w', false);
    assert.ok(walk.state.pos.distanceTo(at) < 1e-6, 'nothing walked');
    assert.equal(walk.dying().kind, 'fall');
    walk.revive();
    assert.equal(walk.dying(), null);
    key('w', true);
    run(walk, 0.5);
    key('w', false);
    assert.ok(walk.state.pos.distanceTo(at) > 0.1, 'walks again');
  });
}

test('in the water a body sinks, whatever caught it, slowly and never through the bed', () => {
  // Open water two units deep: the walker is a swimmer at the surface.
  const walk = make('traveller', { height: () => -2 });
  run(walk, 0.3);
  assert.equal(walk.state.swimming, true);
  const s = walk.die('fall');
  assert.equal(walk.dying().kind, 'drown', 'afloat nobody falls over');
  run(walk, 1);
  const after1 = walk.state.pos.y;
  assert.ok(after1 < -0.2, `going down: ${after1}`);
  run(walk, s + 5);
  assert.ok(walk.state.pos.y >= -2 + 0.05 - 1e-9 && walk.state.pos.y < -1.9, `on the bed: ${walk.state.pos.y}`);
});

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
async function joined(wsUrl) {
  const c = listen(wsUrl);
  await c.ready;
  c.say({ t: 'join', v: SEA_V });
  await until(() => c.seen.some((m) => m.t === 'welcome'), 'no welcome');
  return c;
}

test('the sea tells everybody else that a body fell or drowned, and nobody of a respawn', async () => {
  await afloat(async ({ sea, wsUrl }) => {
    const a = await joined(wsUrl), b = await joined(wsUrl);
    a.say({ t: 'p', x: 300, y: -0.07, z: 300, yaw: 0, f: 2 });
    await until(() => sea.roster.all().some((p) => p.x === 300), 'the pose never arrived');
    const p = sea.roster.all().find((q) => q.x === 300);
    sea.roster.evict(p, [0, 0, 0], null, null, 'drown');
    await until(() => b.seen.some((m) => m.t === 'fell'), 'nobody was told');
    assert.deepEqual(b.seen.find((m) => m.t === 'fell'), { t: 'fell', id: p.id, how: 'drown' });
    await until(() => a.seen.some((m) => m.t === 'evicted'), 'not sent home');
    assert.ok(!a.seen.some((m) => m.t === 'fell'), 'the one sent home plays it from its own evicted');
    sea.roster.evict(p, [0, 0, 0], null, null, null);
    await until(() => b.seen.filter((m) => m.t === 'fell').length === 2, 'a capture said nothing');
    assert.equal(b.seen.filter((m) => m.t === 'fell')[1].how, 'fall');
    sea.roster.evict(p, [0, 0, 0], null, null, 'respawn');
    await until(() => a.seen.filter((m) => m.t === 'evicted').length === 3, 'the respawn never came');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(b.seen.filter((m) => m.t === 'fell').length, 2, 'a respawn asked for is no death');
    a.close(); b.close();
  });
});
