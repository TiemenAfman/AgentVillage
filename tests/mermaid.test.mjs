// The mermaid (Plans/schip-vaart-door.md): when she comes, where, and what E at her does to the real walk
// mode - out of the water onto the ship's planks, the statue left afloat where we swam.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import * as THREE from 'three';
import { CRAFTS } from '../shared/crafts.mjs';
register('./support/shared-loader.mjs', import.meta.url);

const noop = () => {};
// A canvas whose 2D context accepts anything (the Zzz texture and the nameplates draw text).
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
// walk.js listens on the window for the keys and the focus.
globalThis.window = globalThis;
// The keys go through the handlers walk.js registers on the window (tests/diving-walk.test.mjs).
const handlers = { keydown: [], keyup: [] };
globalThis.addEventListener = (type, fn) => { if (handlers[type]) handlers[type].push(fn); };
globalThis.removeEventListener = noop;
const key = (k, down) => {
  const e = { key: k, repeat: false, ctrlKey: false, metaKey: false, altKey: false, target: {}, preventDefault: noop };
  for (const fn of handlers[down ? 'keydown' : 'keyup']) fn(e);
};
const { createWalkMode } = await import('../web/js/walk.js');
const { stepMermaid, mermaidSpot, newMermaid, MERMAID_AFTER_S, MERMAID_FAR, MERMAID_AHEAD, MERMAID_STAY_S } = await import('../web/js/mermaid.js');

const SEA = () => -2.5;
const FRAME = 1 / 60;

function harness() {
  handlers.keydown.length = 0;
  handlers.keyup.length = 0;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  camera.up.set(0, 1, 0);
  const terrain = { worldHeight: SEA, half: 32, size: 64 };
  const dom = el();
  const walk = createWalkMode({
    scene, camera, terrain, material: new THREE.MeshBasicMaterial(), dom,
    following: () => false, poseHull: null, onLetGo: (item, spot) => lets.push({ item, ...spot }),
  });
  const left = [];
  const lets = [];
  walk.enter({
    at: [0, -40], blockers: [], interactables: [], onLeftDeck: (b) => left.push(b.id),
    onBoarded: noop, onInteract: noop, onSendAway: noop, onPlant: noop, onNextSeed: noop, onPrevSeed: noop,
    onBuild: noop, onAvatar: noop, onExit: noop, onRelease: noop, onToggleMinimap: noop, onGive: noop,
  });
  const ship = { id: 'boat:abcd1234', x: 0, z: 0, yaw: 0, v: 0, craft: { spec: CRAFTS.galleon, object: null } };
  return { walk, ship, left, camera, terrain, lets };
}


const deep = () => true;
const lostAt = (m, body, ship, seconds, step = 0.1) => {
  const said = [];
  for (let t = 0; t < seconds; t += step) {
    const s = stepMermaid(m, { lost: true, body, ship, water: deep }, step);
    if (s) said.push(s);
  }
  return said;
};

test('she comes after MERMAID_AFTER_S lost, ahead of us towards the ship, and goes again', () => {
  const m = newMermaid();
  const body = { x: 0, z: 0 }, ship = { x: 100, z: 0 };
  assert.deepEqual(lostAt(m, body, ship, MERMAID_AFTER_S - 0.5), []);
  assert.deepEqual(lostAt(m, body, ship, 1), ['came']);
  assert.ok(Math.abs(m.at.x - MERMAID_AHEAD) < 1e-9 && Math.abs(m.at.z) < 1e-9, `she came up at ${m.at.x}, ${m.at.z}`);
  // Found the ship (or out of the water): she goes, and the count starts over.
  assert.equal(stepMermaid(m, { lost: false }, 0.1), 'gone');
  assert.equal(m.at, null);
  assert.deepEqual(lostAt(m, body, ship, MERMAID_AFTER_S - 0.5), [], 'the count did not start over');
  // Left waiting, she dives after MERMAID_STAY_S.
  const n = newMermaid();
  assert.deepEqual(lostAt(n, body, ship, MERMAID_AFTER_S + MERMAID_STAY_S + 1, 0.5), ['came', 'gone']);
  assert.ok(MERMAID_FAR > 20, 'lost is within sight of her ladders');
});

test('she never comes up on land: either side of the bearing, else not at all', () => {
  const body = { x: 0, z: 0 }, ship = { x: 100, z: 0 };
  // Land straight ahead, water to the north.
  const spot = mermaidSpot(body, ship, (x, z) => z > 1);
  assert.ok(spot && spot.z > 1, 'she came up on land');
  assert.equal(mermaidSpot(body, ship, () => false), null);
  // Facing her: her yaw looks back at the body.
  const s = mermaidSpot(body, ship, deep);
  assert.ok(Math.abs(Math.sin(s.yaw) + 1) < 1e-9, `she looks along ${s.yaw}`);
});

test('E at her: out of the water onto the deck of the ship, the statue left afloat where we swam', () => {
  const { walk, ship, lets } = harness();
  ship.x = 80;
  for (let i = 0; i < 30; i++) walk.update(FRAME);
  assert.ok(walk.state.swimming, 'not in the water');
  assert.ok(walk.lift('statue'), 'could not take the statue up in the water');
  const swamAt = { x: walk.state.pos.x, z: walk.state.pos.z };
  assert.ok(walk.mermaidAboard(ship), 'the mermaid did not take us');
  assert.equal(walk.onDeck(), ship);
  assert.equal(walk.state.swimming, false);
  assert.equal(walk.carrying(), null, 'the statue came along');
  assert.equal(lets.length, 1);
  assert.equal(lets[0].why, 'mermaid');
  assert.ok(lets[0].afloat && Math.hypot(lets[0].x - swamAt.x, lets[0].z - swamAt.z) < 1e-6, 'she was not left afloat where we swam');
  assert.ok(Math.hypot(walk.state.pos.x - ship.x, walk.state.pos.z - ship.z) < 3, 'not within the boarding reach of her middle');
  // Standing on her a few frames later, not falling back into the sea.
  for (let i = 0; i < 60; i++) walk.update(FRAME);
  assert.equal(walk.onDeck(), ship);
  // Already aboard: no second trip.
  assert.equal(walk.mermaidAboard(ship), false);
});

test('main.js has her: a frame step, E at her, and the ship we were crew of last', () => {
  const src = readFileSync(new URL('../web/js/main.js', import.meta.url), 'utf8');
  assert.match(src, /mermaidFrame\(dt\);/);
  assert.match(src, /it\.kind === 'mermaid'\) mermaidHome\(\)/);
  assert.match(src, /if \(isShip\(b\)\) state\.lastShip = b\.id;/);
  assert.match(src, /state\.net\.boardBoat\(ship\.id\); \}, 300\)/, 'crew before the sea has a pose of us aboard');
});
