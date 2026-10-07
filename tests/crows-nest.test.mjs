// Up the galleon's mainmast to her crow's nest (Plans/DONE/kraaiennest.md): the rope ladder from her waist
// (shared/crafts.mjs `aloft`, shared/deck.mjs aloftPath), the nest walked on her model (the walk map's
// `aloft` layer, scripts/build-shipwalk.mjs), the seat against the topmast (`nest`, walk.js sitOnDeck),
// and back down. Drives the real walk mode, as tests/ship-runout.test.mjs does, on her real walk map.
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
const { CRAFTS } = await import('../shared/crafts.mjs');
const { aloftPath, aloftHolding, aloftUp, aloftDown } = await import('../shared/deck.mjs');
const { DECK_Y } = await import('../shared/hull.mjs');

const FRAME = 1 / 60;
const SHIP = CRAFTS.galleon;
const L = SHIP.aloft[0];

function harness() {
  handlers.keydown.length = 0;
  handlers.keyup.length = 0;
  const camera = new THREE.PerspectiveCamera();
  const terrain = { worldHeight: () => -2.5, half: 32, size: 64 };
  const walk = createWalkMode({
    scene: new THREE.Scene(), camera, terrain, material: new THREE.MeshBasicMaterial(), dom: el(),
    following: () => false, poseHull: null,
  });
  const left = [];
  walk.enter({
    at: [0, -40], blockers: [], interactables: [], onLeftDeck: (b) => left.push(b.id),
    onBoarded: noop, onInteract: noop, onSendAway: noop, onPlant: noop, onNextSeed: noop, onPrevSeed: noop,
    onBuild: noop, onAvatar: noop, onExit: noop, onRelease: noop, onToggleMinimap: noop, onGive: noop,
  });
  const ship = { id: 'boat:abcd1234', x: 0, z: 0, yaw: 0, v: 0, craft: { spec: SHIP, object: null, walk: SHIP_SURFACE } };
  walk.board(ship);
  assert.ok(walk.leaveHelm(), 'could not step off the helm onto her deck');
  return { walk, ship, left };
}
// Stand on her deck at a point of her frame (she lies at the origin, bow north, so it is the world's).
function standAt(walk, x, z, y) {
  Object.assign(walk.state.deck, { x, z, y, vy: 0, grounded: true });
}
// Hold W with the camera along a way in her frame for `seconds`, every frame's deck and climb.
// With `stop`, until it says so after a frame.
function push(walk, way, seconds, stop = () => false) {
  const s = walk.state, out = [];
  s.camYaw = Math.atan2(way[0], way[1]);
  key('w', true);
  for (let i = 0; i < seconds / FRAME; i++) {
    walk.update(FRAME);
    out.push({ deck: s.deck && { ...s.deck }, climbing: s.climbing, pos: s.pos.clone() });
    if (stop(out)) break;
  }
  key('w', false);
  walk.update(FRAME);
  return out;
}
const up = [-L.out[0], -L.out[1]], away = [L.out[0], L.out[1]];
const foot = { x: L.x + L.out[0] * 0.2, z: L.z + L.out[1] * 0.2 };

test('the walk map holds the nest: a ring to stand on round the topmast, and a rim that stops you', () => {
  const s = SHIP_SURFACE;
  // where the ladder lands, and all round the mast at that distance
  assert.ok(Math.abs(s.standAt(L.land[0], L.land[1], L.floor) - L.floor) < 0.03, 'nowhere to step down where the ladder lands');
  let round = 0;
  for (let a = 0; a < 16; a++) {
    const r = 0.41, x = r * Math.cos(a * Math.PI / 8), z = r * Math.sin(a * Math.PI / 8);
    const f = s.standAt(x, z, 9.0);
    if (f !== null && f > 8.7 && !s.blockedAt(x, z, f)) round++;
  }
  assert.ok(round >= 10, `only ${round} of 16 places round the topmast to stand`);
  // the rim: beyond it from inside is a wall, and the deck under the nest is still the deck
  assert.ok(s.blockedAt(0.6, 0, 8.82), 'the rim does not stop a body on the nest floor');
  assert.ok(Math.abs(s.floorIn(0.68, -0.68, 1.12) - L.foot) < 0.01, 'the deck at the ladder\'s foot moved');
  assert.equal(s.spanAt(0.3, 0.3)[1] < 3, true, 'the nest counted as the hull\'s envelope for the camera');
});

test('from the deck up the ladder into the nest, and the sea is told where all the way', () => {
  const { walk, left } = harness();
  standAt(walk, foot.x + L.out[0] * 0.15, foot.z + L.out[1] * 0.15, L.foot);
  const frames = push(walk, up, 40);
  const on = frames.filter((f) => f.climbing);
  assert.ok(on.length > 60, `${on.length} frames on the rungs`);
  assert.ok(on.every((f) => f.climbing.at >= 0 && f.climbing.at <= L.top - L.foot + 0.1), 'a height on the ladder outside it');
  // on her the whole way: a deck position at the rope, never cut loose of her
  assert.ok(frames.every((f) => f.deck), 'off her deck during the climb');
  assert.ok(on.some((f) => f.deck.y > 5), 'the deck position did not go up the mast');
  const s = walk.state;
  assert.equal(s.climbing, null, 'still climbing after forty seconds');
  assert.ok(s.deck.grounded && Math.abs(s.deck.y - L.floor) < 0.15, `not on the nest's floor: ${s.deck.y}`);
  assert.ok(Math.hypot(s.deck.x, s.deck.z) < 0.6, 'outside the nest');
  assert.deepEqual(left, [], 'the sea was told we left her');
  // walking about up there: the far side's rim holds
  push(walk, [-0.7, 0.7], 2);
  assert.ok(s.deck.y > 8.5 && Math.hypot(s.deck.x, s.deck.z) < 0.6, `walked out of the nest: ${JSON.stringify(s.deck)}`);
});

test('sitting in the nest, carried by the ship, and up again', () => {
  const { walk, ship } = harness();
  standAt(walk, L.land[0], L.land[1], L.floor);
  walk.update(FRAME);
  const where = walk.deckWhere();
  assert.ok(where.nest != null && where.seat, 'no seat offered in the nest');
  assert.ok(walk.sitOnDeck(where.seat));
  for (let i = 0; i < 10; i++) walk.update(FRAME);
  const s = walk.state;
  assert.ok(s.sitting, 'not sitting');
  assert.equal(s.deck.y, SHIP.nest.seat.y);
  assert.ok(Math.abs(s.pos.y - (DECK_Y + SHIP.nest.seat.y)) < 1e-6, 'not on the seat');
  // she sails on and turns, and the seat goes with her
  ship.x = 5; ship.z = 3; ship.yaw = 0.5;
  walk.update(FRAME);
  const want = [ship.x + SHIP.nest.seat.z * Math.sin(0.5), ship.z + SHIP.nest.seat.z * Math.cos(0.5)];
  assert.ok(Math.hypot(s.pos.x - want[0], s.pos.z - want[1]) < 1e-6, 'the seat stayed behind');
  assert.ok(Math.abs(s.yaw - 0.5) < 1e-6, 'not looking out over her bow');
  assert.ok(s.sitting && s.deck.seat, 'stood up when she turned');
  // E again stands you up where you stood
  walk.standUp();
  walk.update(FRAME);
  assert.equal(s.sitting, null);
  assert.ok(Math.hypot(s.deck.x - L.land[0], s.deck.z - L.land[1]) < 0.1 && s.deck.y > 8.5, 'not back where we stood');
});

test('down the ladder from the nest to the deck, and letting go halfway falls onto her deck', () => {
  const { walk, left } = harness();
  standAt(walk, L.land[0], L.land[1], L.floor);
  // down, and stop pushing once off its foot (pushed on, you walk away across her deck)
  const frames = push(walk, away, 45, (o) => o.some((f) => f.climbing) && !o.at(-1).climbing && o.at(-1).deck.y < 2);
  assert.ok(frames.some((f) => f.climbing && f.climbing.rise < 0), 'never climbed down');
  const s = walk.state;
  assert.equal(s.climbing, null);
  assert.ok(Math.abs(s.deck.y - L.foot) < 0.05 && s.deck.grounded, `not on the deck: ${s.deck.y}`);

  // up again a few metres and let go
  push(walk, up, 12);
  assert.ok(s.climbing && s.deck.y > 3, `not up the rope: ${s.deck.y}`);
  key(' ', true); key(' ', false);
  for (let i = 0; i < 120; i++) walk.update(FRAME);
  assert.equal(s.climbing, null);
  assert.ok(s.deck && s.deck.grounded && Math.abs(s.deck.y - L.foot) < 0.05, `did not land on her deck: ${JSON.stringify(s.deck)}`);
  assert.deepEqual(left, []);
});

test('what takes you onto it: into its foot from the deck, out over its head from the nest', () => {
  assert.equal(aloftUp(SHIP, foot.x, foot.z, L.foot, ...up), L);
  assert.equal(aloftUp(SHIP, foot.x, foot.z, L.foot, ...away), null, 'walking away from it');
  assert.equal(aloftUp(SHIP, foot.x, foot.z, L.floor, ...up), null, 'from up in the nest');
  assert.equal(aloftUp(SHIP, -foot.x, -foot.z, L.foot, ...up), null, 'on the far side of the mast');
  assert.equal(aloftDown(SHIP, L.land[0], L.land[1], L.floor, ...away), L);
  assert.equal(aloftDown(SHIP, -L.land[0], -L.land[1], L.floor, ...L.out), null, 'the far side of the nest');
  assert.equal(aloftDown(SHIP, L.land[0], L.land[1], L.foot, ...away), null, 'from the deck');
  // and somebody else on it, from their deck position alone (peers.js)
  const [a, b] = aloftPath(L);
  const mid = { x: a.x, z: a.z, y: (a.y + b.y) / 2 };
  const hold = aloftHolding(SHIP, mid.x, mid.z, mid.y);
  assert.ok(hold && hold.ladder === L && Math.abs(hold.at - (mid.y - L.foot)) < 1e-9);
  assert.equal(aloftHolding(SHIP, mid.x, mid.z, L.foot), null, 'standing at its foot');
  assert.equal(aloftHolding(SHIP, mid.x + 0.6, mid.z, mid.y), null, 'beside it');
});

test('a running jump goes over the rim and falls the whole way down onto her deck; a standing one does not', () => {
  const { walk, left } = harness();
  const dir = [-Math.SQRT1_2, Math.SQRT1_2];     // the side away from the ladder
  standAt(walk, dir[0] * 0.38, dir[1] * 0.38, L.floor);
  const s = walk.state;
  s.camYaw = Math.atan2(dir[0], dir[1]);
  key('shift', true);
  key('w', true);
  let out = 0, air = 0;
  for (let i = 0; i < 240; i++) {
    if (i === 3) { key(' ', true); key(' ', false); }
    walk.update(FRAME);
    if (Math.hypot(s.deck.x, s.deck.z) > 0.9) out = Math.max(out, s.deck.y);
    if (!s.deck.grounded) air++;
  }
  key('w', false);
  key('shift', false);
  assert.ok(out > 8, 'never went over the rim');
  assert.ok(air > 30, `a fall of eight units in ${air} frames`);
  assert.ok(s.deck.grounded && s.deck.y < 2, `did not come down on her deck: ${s.deck.y}`);
  assert.deepEqual(left, []);
});

test("a jump at a walk comes down inside the rim again, never through the nest's floor", () => {
  const { walk } = harness();
  const dir = [-Math.SQRT1_2, Math.SQRT1_2];
  standAt(walk, dir[0] * 0.4, dir[1] * 0.4, L.floor);
  const s = walk.state;
  s.camYaw = Math.atan2(dir[0], dir[1]);
  key('w', true);
  let low = Infinity;
  for (let i = 0; i < 120; i++) {
    if (i === 3) { key(' ', true); key(' ', false); }
    walk.update(FRAME);
    low = Math.min(low, s.deck.y);
  }
  key('w', false);
  assert.ok(low > L.floor - 0.2, `fell to ${low.toFixed(2)}`);
  assert.ok(s.deck.grounded && Math.hypot(s.deck.x, s.deck.z) < 0.6, 'not in the nest');
});
