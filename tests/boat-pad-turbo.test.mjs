// The pad's sprint at the helm (issue #72). On foot a tap of L3 - or the touchpad's LS, which
// polls as the same button - keeps you running until the stick is let go; at the helm the stick
// is the throttle and is never let go, so the turbo stayed open for good and the boat's pool
// emptied, refilled and emptied again. Afloat a tap is now one burst, and a held button goes on
// working the way Shift does. This drives the real walk mode at the helm of a Benchy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
import { CRAFTS } from '../shared/crafts.mjs';
import { BOAT, RECOVER_AT } from '../web/js/stamina.js';
register('./support/shared-loader.mjs', import.meta.url);

const noop = () => {};
const ctx = new Proxy(function () {}, {
  get: (_, k) => (k === 'measureText' ? () => ({ width: 10 }) : ctx),
  set: () => true,
  apply: () => ctx,
});
const el = () => ({
  addEventListener: noop, removeEventListener: noop, set src(_) {}, style: {}, requestPointerLock: noop,
  getContext: () => ctx, width: 64, height: 64,
});
globalThis.document = {
  createElementNS: el, createElement: el, addEventListener: noop, removeEventListener: noop,
  pointerLockElement: null, exitPointerLock: noop,
};
globalThis.window = globalThis;
globalThis.addEventListener = noop;
globalThis.removeEventListener = noop;
const { createWalkMode } = await import('../web/js/walk.js');

const SEA = () => -2.5;
const FRAME = 1 / 60;

function atTheHelm() {
  const walk = createWalkMode({
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), terrain: { worldHeight: SEA, half: 512, size: 1024 },
    material: new THREE.MeshBasicMaterial(), dom: el(), following: () => false, poseHull: null,
  });
  walk.enter({
    at: [0, -40], blockers: [], interactables: [], onLeftDeck: noop,
    onBoarded: noop, onInteract: noop, onSendAway: noop, onPlant: noop, onNextSeed: noop, onPrevSeed: noop,
    onBuild: noop, onAvatar: noop, onExit: noop, onRelease: noop, onToggleMinimap: noop, onGive: noop,
  });
  walk.board({ id: 'boat:abcd1234', x: 0, z: 0, yaw: 0, v: 0, craft: { spec: CRAFTS.benchy, object: null } });
  return walk;
}

// One poll of a pad: the stick at `y` (up is negative, as gamepad.js has it) and L3 tapped or held.
const poll = (y, { tap = false, held = false } = {}) => ({
  move: { x: 0, y }, look: { x: 0, y: 0 }, lt: 0, rt: 0,
  hit: (a) => tap && a === 'sprint', down: (a) => held && a === 'sprint', raw: {},
});
// Frames of full throttle ahead, `opts` on the first; how many of them had the turbo.
function sail(walk, seconds, first = {}, every = {}) {
  let on = 0;
  for (let i = 0; i < Math.round(seconds / FRAME); i++) {
    walk.pad(poll(-1, i === 0 ? { ...every, ...first } : every), FRAME);
    walk.update(FRAME);
    if (walk.state.turbo) on++;
  }
  return on * FRAME;
}
// Long enough for an emptied pool to be open again, and then some.
const REFILL = BOAT.delay + BOAT.refill * RECOVER_AT + 1;

test('a tapped sprint at the helm is one burst: it ends with the pool and does not come back', () => {
  const walk = atTheHelm();
  const burst = sail(walk, BOAT.drain + 0.5, { tap: true });
  assert.ok(Math.abs(burst - BOAT.drain) < 0.1, `the tap gave ${burst.toFixed(2)} s of turbo, not the pool's ${BOAT.drain}`);
  // Full throttle all along, the stick never at rest: before #72 the turbo opened again here.
  const after = sail(walk, REFILL + BOAT.drain);
  assert.equal(after, 0, `the turbo came back on its own for ${after.toFixed(2)} s`);
  assert.equal(walk.state.stamina.boat.spent, false, 'the pool never got back to open');
});

test('taking the throttle off ahead ends a tapped sprint, and a new tap starts one', () => {
  const walk = atTheHelm();
  assert.ok(sail(walk, 0.5, { tap: true }) > 0.4, 'the tap gave no turbo');
  walk.pad(poll(0), FRAME); walk.update(FRAME);
  assert.equal(sail(walk, 0.5), 0, 'the turbo outlived the throttle');
  assert.ok(sail(walk, 0.5, { tap: true }) > 0.4, 'a second tap gave no turbo');
});

test('held, the sprint is the turbo for as long as the pool allows, the way Shift is', () => {
  const walk = atTheHelm();
  const first = sail(walk, BOAT.drain + 0.5, {}, { held: true });
  assert.ok(Math.abs(first - BOAT.drain) < 0.1, `held gave ${first.toFixed(2)} s of turbo`);
  // Still held: the pool locks out, refills and opens again, as it does under Shift.
  assert.ok(sail(walk, REFILL + 1, {}, { held: true }) > 0.5, 'a held sprint never got its turbo back');
});
