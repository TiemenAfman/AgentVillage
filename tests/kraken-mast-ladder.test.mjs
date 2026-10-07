// The two ladders up the Salty Kraken's mast, from the pit to the crow's nest (kraken-layout.js
// MAST_CLIMBS), climbed by the room's own walk mode as the rope ladder up her hull is outside
// (walk.js setClimbs, tests/ladder-climb.test.mjs): walk into the foot facing the mast and up you go,
// out over the head onto the nest's planks, and back down from there. The harness is
// tests/room-walls-walk.test.mjs's.
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
const key = (k, down) => {
  const e = { key: k, repeat: false, ctrlKey: false, metaKey: false, altKey: false, target: {}, preventDefault: noop };
  for (const fn of handlers[down ? 'keydown' : 'keyup']) fn(e);
};
// No network: the captain's model (captain.js) is asked for on the first enter() and refused here.
globalThis.fetch = () => Promise.reject(new Error('no network in a test'));
const realWarn = console.warn;
console.warn = () => {};
const { createInterior, prepareRoom } = await import('../web/js/interior.js');
const K = await import('../web/js/kraken-layout.js');
await prepareRoom('piratetavern');

const FRAME = 1 / 60;
const { LEVEL } = K;

function room(name) {
  handlers.keydown.length = 0;
  handlers.keyup.length = 0;
  const material = new THREE.MeshBasicMaterial();
  material.userData.uniforms = { uNight: { value: 0 } };
  let left = false;
  const it = createInterior({
    room: name, camera: new THREE.PerspectiveCamera(60, 1, 0.05, 100), material,
    dom: { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} },
    onLeave: (to) => { left = to || true; },
  });
  it.enter({});
  return { it, walk: it.walk, left: () => left };
}


// Push towards `to` for `seconds` through the room's own update; each frame's height and climb.
function push(r, to, seconds) {
  const s = r.walk.state, out = [];
  key('w', true);
  for (let i = 0; i < seconds / FRAME; i++) {
    const dx = to[0] - s.pos.x, dz = to[1] - s.pos.z;
    if (Math.hypot(dx, dz) > 0.08) s.camYaw = Math.atan2(dx, dz);
    r.it.update(FRAME);
    out.push({ y: s.pos.y, climbing: s.climbing });
  }
  key('w', false);
  for (let i = 0; i < 20; i++) r.it.update(FRAME);
  return out;
}

for (const l of K.MAST_CLIMBS.filter((c) => !c.exit)) {
  test(`${l.name}: up from the pit to the crow's nest and down again`, () => {
    const r = room('piratetavern');
    const s = r.walk.state;
    // a pace out from the foot on the pit, on the side away from the mast
    const out = [l.lo.x - l.hi.x, l.lo.z - l.hi.z], n = Math.hypot(...out);
    s.pos.set(l.lo.x + out[0] / n * 0.3, LEVEL.pit, l.lo.z + out[1] / n * 0.3);
    s.floor = LEVEL.pit; s.grounded = true; s.vy = 0;
    for (let i = 0; i < 10; i++) r.it.update(FRAME);
    assert.ok(Math.abs(s.pos.y - LEVEL.pit) < 0.05, `on the pit: ${s.pos.y.toFixed(2)}`);
    const up = push(r, [l.hi.x, l.hi.z], 12);
    assert.ok(up.filter((f) => f.climbing && f.climbing.rise > 0).length > 30, 'climbed, rung by rung');
    assert.ok(Math.abs(s.pos.y - LEVEL.top) < 0.05 && !s.climbing, `in the crow's nest: ${s.pos.y.toFixed(2)}`);
    assert.ok(Math.hypot(s.pos.x - K.KIT.mast.x, s.pos.z - K.KIT.mast.z) < K.KIT.mast.nestR, 'inside its rail');
    const down = push(r, [l.lo.x + out[0] / n, l.lo.z + out[1] / n], 12);
    assert.ok(down.some((f) => f.climbing && f.climbing.rise < 0), 'climbed down');
    assert.ok(Math.abs(s.pos.y - LEVEL.pit) < 0.05 && !s.climbing, `back on the pit: ${s.pos.y.toFixed(2)}`);
  });
}

// The ladder from the crow's nest up to the hatch in the ridge goes on through it: climbed to its head,
// the room is left for the deck outside, as E at its foot does.
test('the hatch ladder: climbed from the crow\'s nest, out onto the deck', () => {
  const l = K.MAST_CLIMBS.find((c) => c.exit);
  assert.equal(l.exit, 'deck');
  const r = room('piratetavern');
  const s = r.walk.state;
  s.pos.set(l.lo.x + 0.1, LEVEL.top, l.lo.z);
  s.floor = LEVEL.top; s.grounded = true; s.vy = 0;
  for (let i = 0; i < 10; i++) r.it.update(FRAME);
  assert.ok(Math.abs(s.pos.y - LEVEL.top) < 0.05, `in the nest: ${s.pos.y.toFixed(2)}`);
  const ys = [];
  key('w', true);
  for (let i = 0; i < 8 / FRAME && !r.left(); i++) {
    s.camYaw = Math.atan2(l.hi.x - l.lo.x, l.hi.z - l.lo.z);
    r.it.update(FRAME);
    ys.push(s.pos.y);
  }
  key('w', false);
  assert.equal(r.left(), 'deck', 'out through the hatch');
  assert.ok(Math.max(...ys) > l.hi.y - 0.05, `up to the hatch first (${Math.max(...ys).toFixed(2)})`);
});
