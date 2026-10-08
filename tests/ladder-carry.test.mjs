// Up a ship's rope ladder with the treasure statue (the keeper's report, 8 Oct 2026: "je kan niet met
// een schatkist aan boord klimmen"). The load goes on the back for the climb (classic-avatar.js
// CARRIED_BACK), onto her deck as cargo at the top (walk.js putOnBoat, `onBoarded(b, { stowed })` so
// the book hears `boarded`), and comes down again on the back of whoever climbs down from a deck she
// is on. Drives the real walk mode on the galleon's real walk map, as tests/crows-nest.test.mjs does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
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
const handlers = { keydown: [], keyup: [] };
globalThis.addEventListener = (type, fn) => { if (handlers[type]) handlers[type].push(fn); };
globalThis.removeEventListener = noop;
const key = (k, down) => {
  const e = { key: k, repeat: false, ctrlKey: false, metaKey: false, altKey: false, target: {}, preventDefault: noop };
  for (const fn of handlers[down ? 'keydown' : 'keyup']) fn(e);
};

const { createWalkMode } = await import('../web/js/walk.js');
const { SHIP_SURFACE } = await import('../web/js/boat.js');
const { createClassicAvatar } = await import('../web/js/classic-avatar.js');
const { DEFAULT_AVATAR } = await import('../web/js/avatar.js');
const { CRAFTS } = await import('../shared/crafts.mjs');

const FRAME = 1 / 60;
const SHIP = CRAFTS.galleon;
const L = SHIP.ladders.find((l) => l.x > 0);   // her starboard ladder, at +x: she lies at the origin, bow north

// Sea, with a beach east of x = 7 to lift the statue on.
const ground = (x) => (x > 7 ? 0.5 : -2.5);

function harness() {
  handlers.keydown.length = 0;
  handlers.keyup.length = 0;
  const terrain = { worldHeight: ground, half: 32, size: 64 };
  const sea = { height: ground, bedAt: ground, regionAt: () => null, levelKey: () => null };
  const walk = createWalkMode({
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), terrain, ground: sea,
    material: new THREE.MeshBasicMaterial(), dom: el(), following: () => false, poseHull: null,
  });
  const boarded = [], left = [];
  walk.enter({
    at: [8, L.z], facing: [0, L.z], blockers: [], interactables: [],
    onBoarded: (b, info) => boarded.push({ id: b.id, ...info }), onLeftDeck: (b) => left.push(b.id),
    onInteract: noop, onSendAway: noop, onPlant: noop, onNextSeed: noop, onPrevSeed: noop,
    onBuild: noop, onAvatar: noop, onExit: noop, onRelease: noop, onToggleMinimap: noop, onGive: noop,
  });
  const craft = { spec: SHIP, object: null, walk: SHIP_SURFACE, held: null, setCargo(m) { craft.held = m; } };
  const ship = { id: 'boat:abcd1234', x: 0, z: 0, yaw: 0, v: 0, craft };
  walk.setBoats(() => [ship]);
  for (let i = 0; i < 10; i++) walk.update(FRAME);
  return { walk, ship, boarded, left };
}
// Hold W with the camera along `way` (the world's, and her frame's: she lies at the origin, bow north).
function push(walk, way, seconds, stop = () => false) {
  const s = walk.state, out = [];
  s.camYaw = Math.atan2(way[0], way[1]);
  key('w', true);
  for (let i = 0; i < seconds / FRAME; i++) {
    walk.update(FRAME);
    out.push({ deck: !!s.deck, climbing: s.climbing, carry: s.carry, cargo: s.cargo, y: s.pos.y });
    if (stop(out)) break;
  }
  key('w', false);
  walk.update(FRAME);
  return out;
}

test('with the statue in the arms, up the galleon\'s ladder from the water: on the back, then her cargo', () => {
  const { walk, ship, boarded } = harness();
  assert.equal(walk.lift('statue'), true, 'in the arms on the beach');
  // West into the sea and on into the foot of her ladder, until the top.
  const going = push(walk, [-1, 0], 60, (o) => o[o.length - 1].deck);
  const rungs = going.filter((f) => f.climbing);
  assert.ok(rungs.length > 30, `climbed (${rungs.length} frames on the rungs)`);
  assert.ok(rungs.every((f) => f.carry === 'statue'), 'carried all the way up (on the back)');
  assert.ok(walk.state.deck, 'on her deck');
  assert.equal(walk.carrying(), null, 'aboard, nothing in the arms');
  assert.deepEqual(walk.cargo(), { item: 'statue', hull: ship }, 'she is the ship\'s cargo');
  assert.ok(ship.craft.held, 'drawn on her deck');
  assert.deepEqual(boarded, [{ id: ship.id, stowed: true }], 'the book is told she came aboard');
});

test('down the ladder from a deck she is on: the statue comes along on the back, into the water in the arms', () => {
  const { walk, ship, left } = harness();
  walk.lift('statue');
  push(walk, [-1, 0], 60, (o) => o[o.length - 1].deck);
  assert.ok(walk.cargo());
  // Back out over the side at the head of the ladder: down it.
  const d = walk.state.deck;
  Object.assign(d, { x: L.land[0], z: L.land[1] });
  const going = push(walk, [1, 0], 30, () => walk.state.swimming);
  const rungs = going.filter((f) => f.climbing);
  assert.ok(rungs.length > 10, `climbed down (${rungs.length} frames)`);
  assert.ok(rungs.every((f) => f.carry === 'statue' && !f.cargo), 'off her deck and on the back');
  assert.equal(ship.craft.held, null, 'the deck is bare');
  assert.equal(walk.state.deck, null);
  assert.equal(walk.carrying(), 'statue', 'in the arms at the foot');
  assert.deepEqual(left, [ship.id], 'and the sea hears we left her');
  // and up once more: she goes aboard again
  push(walk, [-1, 0], 30, (o) => o[o.length - 1].deck);
  assert.deepEqual(walk.cargo(), { item: 'statue', hull: ship });
});

test('a climb with nothing carried says nothing was stowed', () => {
  const { walk, boarded } = harness();
  push(walk, [-1, 0], 60, (o) => o[o.length - 1].deck);
  assert.ok(walk.state.deck);
  assert.deepEqual(boarded, [{ id: 'boat:abcd1234', stowed: false }]);
  assert.equal(walk.cargo(), null);
});

test('the rig carries the load on its back on a ladder, and in its arms again off it', () => {
  for (const character of ['adventurer', 'traveller']) {
    const rig = createClassicAvatar({ ...DEFAULT_AVATAR, character }, new THREE.MeshBasicMaterial());
    rig.setCarry(true);
    const carried = rig.object.getObjectByName('carried');
    assert.ok(carried && carried.visible);
    for (let i = 0; i < 30; i++) rig.update({ moving: false, grounded: true }, FRAME);
    assert.ok(carried.position.z > 0.1, `${character}: in front, in the arms (${carried.position.z})`);
    for (let i = 0; i < 30; i++) rig.update({ moving: true, grounded: true, climbing: { rise: 0.005, at: 0.5 } }, FRAME);
    assert.ok(carried.visible && carried.position.z < -0.05, `${character}: on the back up the ladder (${carried.position.z})`);
    for (let i = 0; i < 30; i++) rig.update({ moving: false, grounded: true }, FRAME);
    assert.ok(carried.position.z > 0.1, `${character}: back in the arms at the top`);
  }
});
