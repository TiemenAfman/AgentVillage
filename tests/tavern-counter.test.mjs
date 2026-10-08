// The tavern's counter, where the miner's draught is sold (interior.js `counter`, Plans/goudmijn-zoektocht.md),
// walked to by the real walk mode the way a player does it: in at the door, up the aisle to the bar, along
// it to the west end. The playtest (Plans/speeltest-quests.md) found it reachable only from a strip a few
// centimetres wide - one of the regulars standing at the end of the bar stood on it.
// The harness is tests/room-walls-walk.test.mjs's.
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
globalThis.fetch = () => Promise.reject(new Error('no network in a test'));
const realWarn = console.warn;
console.warn = () => {};
const { createInterior } = await import('../web/js/interior.js');

const FRAME = 1 / 60;

function tavern() {
  const material = new THREE.MeshBasicMaterial();
  material.userData.uniforms = { uNight: { value: 0 } };
  const it = createInterior({
    room: 'tavern', camera: new THREE.PerspectiveCamera(60, 1, 0.05, 100), material,
    dom: { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} },
    onLeave: noop,
  });
  it.enter({});
  return it;
}

// Walks towards (x, z) with W held and the camera turned that way each frame, like a player steering
// with the mouse; stops there or after `seconds`. Returns whether the counter was in reach on the way.
function walkTowards(it, x, z, seconds = 6) {
  const s = it.walk.state;
  let counter = false;
  key('w', true);
  for (let i = 0; i < seconds / FRAME; i++) {
    if (Math.hypot(x - s.pos.x, z - s.pos.z) < 0.05) break;
    s.camYaw = Math.atan2(x - s.pos.x, z - s.pos.z);
    const w = it.update(FRAME);
    if (w && w.near && w.near.kind === 'counter') counter = true;
  }
  key('w', false);
  for (let i = 0; i < 20; i++) {
    const w = it.update(FRAME);
    if (w && w.near && w.near.kind === 'counter') counter = true;
  }
  return counter;
}

test('a player who walks up to the west end of the bar is offered the draught', () => {
  const it = tavern();
  // Up the aisle to the bar, then along it to its west end and on towards the counter itself.
  walkTowards(it, 0.1, -0.8);
  walkTowards(it, -1.5, -1.0);
  const reached = walkTowards(it, -1.92, -1.4);
  const s = it.walk.state;
  assert.ok(reached, `the counter was never in reach; the walk stopped at ${s.pos.x.toFixed(2)}, ${s.pos.z.toFixed(2)}`);
});

test.after(() => { console.warn = realWarn; });
