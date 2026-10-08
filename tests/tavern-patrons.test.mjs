// The village tavern's regulars (web/js/tavern-patrons.js, interior.js buildTavern): the room is
// full - it stood empty but for the barman - and still yours to walk: nobody stands in a wall, on
// a stool or in the way from the door to the bar, and the whole house is drawn by one instanced
// crowd.
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
const { createInterior } = await import('../web/js/interior.js');
const { tavernPatrons } = await import('../web/js/tavern-patrons.js');

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

test('the same house every visit, with a few places left free', () => {
  const tables = [[0, 0], [2, 0], [4, 0]];
  const a = tavernPatrons({ tables, floor: 1 }), b = tavernPatrons({ tables, floor: 1 });
  assert.deepEqual(a, b);
  assert.ok(a.length < 12 && a.length >= 8, `${a.length} of twelve places`);
  for (const p of a) assert.equal(p.seat.h, 0.135, 'on the tavern\'s bench');
});

test('the tavern is full, and the way from the door to the bar is still open', () => {
  const it = tavern();
  const blockers = it.walk.state.blockers || [];
  const people = blockers.filter((b) => b.r === 0.12);
  assert.ok(people.length >= 20, `${people.length} people in the tavern`);
  // Nobody sits or stands on a stool: those are the player's.
  for (const p of people) {
    for (const s of it.walk.state.interactables || []) {
      if (s.kind === 'seat') assert.ok(Math.hypot(p.x - s.x, p.z - s.z) > 0.3, `somebody on ${s.id}`);
    }
  }
  // From the spawn, straight north to the stools.
  const s = it.walk.state;
  key('w', true);
  for (let i = 0; i < 240; i++) { s.camYaw = Math.PI; it.update(1 / 60); }
  key('w', false);
  assert.ok(s.pos.z < -1.0, `got to ${s.pos.z.toFixed(2)}, short of the bar`);
  it.dispose();
});
