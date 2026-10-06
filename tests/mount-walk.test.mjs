// A real walk mode on a meadow, riding (web/js/walk.js + web/js/mount.js,
// Plans/paard-in-plaats-van-fiets.md): F puts the Adventurer on a horse and the Traveller on his
// bicycle, never both; the reins take the horse up through its gaits; the rider sits on the
// saddle the horse carries; and F again sets him down beside it. The pure step is
// tests/mount.test.mjs; this is what only the whole thing can answer.
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
const tap = (k) => { key(k, true); key(k, false); };
const { createWalkMode } = await import('../web/js/walk.js');
const { normalizeAvatar } = await import('../web/js/avatar.js');
const { horsebackOf } = await import('../web/js/classic-avatar.js');
const { MOUNT, MOUNT_TOP } = await import('../web/js/mount.js');

const FRAME = 1 / 60;
const MEADOW = 0.5;
function make(character) {
  handlers.keydown.length = 0;
  handlers.keyup.length = 0;
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 1000);
  const dom = { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} };
  const scene = new THREE.Scene();
  const walk = createWalkMode({
    scene, camera, bikes: true,
    terrain: { half: 64, size: 128, worldHeight: () => MEADOW },
    ground: { height: () => MEADOW, bedAt: () => MEADOW, regionAt: () => null, levelKey: () => null },
    material: new THREE.MeshBasicMaterial(), dom,
  });
  walk.setAvatar(normalizeAvatar({ character }));
  walk.enter({ at: [0, 0], facing: [0, 10], blockers: [], interactables: [], onExit: noop });
  return { walk, scene, camera };
}
const run = (walk, seconds) => { for (let i = 0; i < Math.round(seconds / FRAME); i++) walk.update(FRAME); };

test('F puts the Adventurer on a horse, and the Traveller on his bicycle', () => {
  const a = make('adventurer');
  run(a.walk, 0.2);
  tap('f');
  assert.equal(a.walk.rideKind(), 'horse');
  assert.ok(a.walk.state.mount, 'no horse under the Adventurer');
  assert.equal(a.walk.state.bike, null, 'a bicycle as well as a horse');
  assert.ok(a.walk.riding());
  const t = make('traveller');
  run(t.walk, 0.2);
  tap('f');
  assert.equal(t.walk.rideKind(), 'bike');
  assert.ok(t.walk.state.bike);
  assert.equal(t.walk.state.mount, null);
});

test('the reins ride the horse through its gaits, and the rider sits on its saddle', () => {
  const { walk } = make('adventurer');
  run(walk, 0.2);
  tap('f');
  const s = walk.state;
  key('w', true);
  run(walk, 4);
  assert.ok(Math.abs(s.mount.v - MOUNT_TOP) < 0.05, `cantering at ${s.mount.v}`);
  assert.ok(s.pos.z > 10, `rode to ${s.pos.z}`);
  assert.equal(s.moving, true);
  assert.equal(s.grounded, true);
  // The rider's feet (the rig's origin) put his hips on the seat, wherever the horse's rock has it.
  const hips = walk.avatar.position.y + 0.25;
  const seat = MEADOW + MOUNT.seat + horsebackOf('adventurer').perch;
  assert.ok(Math.abs(hips - seat) < 0.08, `hips at ${hips.toFixed(3)}, seat at ${seat.toFixed(3)}`);
  key('w', false);
  run(walk, 6);
  assert.equal(s.mount.v, 0, 'let go of the reins and it stops');
});

test('F again sets the rider down beside the horse, on foot, and the horse is gone', () => {
  const { walk, scene } = make('adventurer');
  run(walk, 0.2);
  tap('f');
  key('w', true); run(walk, 1); key('w', false); run(walk, 3);
  const at = walk.state.pos.clone();
  tap('f');
  run(walk, 0.1);
  assert.equal(walk.state.mount, null);
  assert.equal(walk.riding(), null);
  const off = Math.hypot(walk.state.pos.x - at.x, walk.state.pos.z - at.z);
  assert.ok(Math.abs(off - 0.45) < 0.05, `stepped off ${off.toFixed(3)} to the side`);
  let shown = 0;
  scene.traverse((o) => { if (o.isMesh && o.visible && /fauna_horse/.test(o.geometry?.name || '')) shown++; });
  assert.equal(shown, 0);
});

test('a change into the Traveller takes the Adventurer off his horse', () => {
  const { walk } = make('adventurer');
  run(walk, 0.2);
  tap('f');
  assert.ok(walk.state.mount);
  walk.setAvatar(normalizeAvatar({ character: 'traveller' }));
  assert.equal(walk.state.mount, null);
  assert.equal(walk.state.bike, null);
});
