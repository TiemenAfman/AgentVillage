// Up the ship's mast to her crow's nest (Plans/DONE/kraaiennest.md, and the sloop's pins and lubber's hole of
// Plans/DONE/nieuwe-sloep.md): the way from her waist (shared/crafts.mjs `aloft`, shared/deck.mjs aloftPath), the nest walked on her model (the walk map's
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
// The sloop's way up (Plans/DONE/nieuwe-sloep.md): pins on the mast's after face, through a lubber's hole in the
// top's floor (`hole`), and a step aside onto the floor beside it. The mast stands at M, the top round it.
const M = (() => { const r = SHIP.rails.find((q) => q.top === undefined && q.hx === q.hz && q.x === 0); return { x: r.x, z: r.z }; })();
const F = L.floor;
const fromMast = (x, z) => Math.hypot(x - M.x, z - M.z);
const up = [-L.out[0], -L.out[1]], away = [L.out[0], L.out[1]];
// Where a body stands to take the pins: before them on the deck, clear of the partners round the mast's foot.
const foot = { x: L.x + L.out[0] * 0.3, z: L.z + L.out[1] * 0.3 };
// From the step-off beside the hole back towards the climber's line: the way down.
const toHole = (() => {
  const cx = L.x + L.out[0] * 0.16, cz = L.z + L.out[1] * 0.16, dx = cx - L.land[0], dz = cz - L.land[1], d = Math.hypot(dx, dz);
  return [dx / d, dz / d];
})();

test('the walk map holds the top: a floor round the mast to stand on, a hole over the pins, and a rim that stops you', () => {
  assert.ok(L.hole, 'the ladder up her mast goes through a hole in the top');
  const s = SHIP_SURFACE;
  // where the pins are stepped off, and round the mast at that distance
  assert.ok(Math.abs(s.standAt(L.land[0], L.land[1], F) - F) < 0.03, 'nowhere to step off beside the hole');
  let round = 0;
  for (let a = 0; a < 16; a++) {
    const x = M.x + 0.5 * Math.cos(a * Math.PI / 8), z = M.z + 0.5 * Math.sin(a * Math.PI / 8);
    const f = s.standAt(x, z, F + 0.02);
    if (f !== null && Math.abs(f - F) < 0.05 && !s.blockedAt(x, z, f)) round++;
  }
  assert.ok(round >= 10, `only ${round} of 16 places round the mast to stand`);
  // over the climber's line no floor of the top: they come up through it
  const hole = s.floorIn(L.x + L.out[0] * 0.16, L.z + L.out[1] * 0.16, F + 0.02);
  assert.ok(hole === null || hole < F - 1, `the hole has a floor at ${hole}`);
  // the rim: beyond it from inside is a wall, and the deck under the top is still the deck
  assert.ok(s.blockedAt(M.x + 0.6, M.z, F), 'the rim does not stop a body on the top\'s floor');
  assert.ok(Math.abs(s.floorIn(foot.x, foot.z, L.foot) - L.foot) < 0.02, 'the deck at the foot of the pins moved');
  assert.equal(s.spanAt(M.x + 0.3, M.z + 0.3)[1] < 3, true, 'the top counted as the hull\'s envelope for the camera');
});

test('from the deck up the pins through the hole into the top, and the sea is told where all the way', () => {
  const { walk, left } = harness();
  standAt(walk, foot.x, foot.z, L.foot);
  const frames = push(walk, up, 40);
  const on = frames.filter((f) => f.climbing);
  assert.ok(on.length > 60, `${on.length} frames on the pins`);
  assert.ok(on.every((f) => f.climbing.at >= 0 && f.climbing.at <= L.top - L.foot + 1), 'a height on the pins outside them');
  // on her the whole way: a deck position at the pins, never cut loose of her
  assert.ok(frames.every((f) => f.deck), 'off her deck during the climb');
  assert.ok(on.some((f) => f.deck.y > 5), 'the deck position did not go up the mast');
  // and out of the hole aside, never through the mast
  assert.ok(on.every((f) => fromMast(f.deck.x, f.deck.z) > 0.09 || f.deck.y < L.foot + 0.5), 'through the mast');
  const s = walk.state;
  assert.equal(s.climbing, null, 'still climbing after forty seconds');
  assert.ok(s.deck.grounded && Math.abs(s.deck.y - F) < 0.15, `not on the top's floor: ${s.deck.y}`);
  assert.ok(fromMast(s.deck.x, s.deck.z) < 0.78, 'outside the top');
  assert.deepEqual(left, [], 'the sea was told we left her');
  // walking about up there: the rim holds
  push(walk, [0.7, 0.7], 2);
  assert.ok(s.deck.y > F - 0.2 && fromMast(s.deck.x, s.deck.z) < 0.78, `walked out of the top: ${JSON.stringify(s.deck)}`);
});

test('sitting in the top, carried by the ship, and up again', () => {
  const { walk, ship } = harness();
  standAt(walk, L.land[0], L.land[1], F);
  walk.update(FRAME);
  const where = walk.deckWhere();
  assert.ok(where.nest != null && where.seat, 'no seat offered in the top');
  assert.ok(walk.sitOnDeck(where.seat));
  for (let i = 0; i < 10; i++) walk.update(FRAME);
  const s = walk.state;
  assert.ok(s.sitting, 'not sitting');
  assert.equal(s.deck.y, SHIP.nest.seat.y);
  assert.ok(Math.abs(s.pos.y - (DECK_Y + SHIP.nest.seat.y)) < 1e-6, 'not on the seat');
  // she sails on and turns, and the seat goes with her
  ship.x = 5; ship.z = 3; ship.yaw = 0.5;
  walk.update(FRAME);
  const want = [ship.x + SHIP.nest.seat.x * Math.cos(0.5) + SHIP.nest.seat.z * Math.sin(0.5), ship.z - SHIP.nest.seat.x * Math.sin(0.5) + SHIP.nest.seat.z * Math.cos(0.5)];
  assert.ok(Math.hypot(s.pos.x - want[0], s.pos.z - want[1]) < 1e-6, 'the seat stayed behind');
  assert.ok(Math.abs(s.yaw - 0.5) < 1e-6, 'not looking out over her bow');
  assert.ok(s.sitting && s.deck.seat, 'stood up when she turned');
  // E again stands you up where you stood
  walk.standUp();
  walk.update(FRAME);
  assert.equal(s.sitting, null);
  assert.ok(Math.hypot(s.deck.x - L.land[0], s.deck.z - L.land[1]) < 0.1 && s.deck.y > F - 0.2, 'not back where we stood');
});

test('down through the hole from the top to the deck, and letting go halfway falls onto her deck', () => {
  const { walk, left } = harness();
  standAt(walk, L.land[0], L.land[1], F);
  // back towards the hole, and stop pushing once off the pins' foot (pushed on, you walk away across her deck)
  const frames = push(walk, toHole, 45, (o) => o.some((f) => f.climbing) && !o.at(-1).climbing && o.at(-1).deck.y < 2);
  assert.ok(frames.some((f) => f.climbing && f.climbing.rise < 0), 'never climbed down');
  const s = walk.state;
  assert.equal(s.climbing, null);
  assert.ok(Math.abs(s.deck.y - L.foot) < 0.05 && s.deck.grounded, `not on the deck: ${s.deck.y}`);

  // up again a few metres and let go
  standAt(walk, foot.x, foot.z, L.foot);
  push(walk, up, 12);
  assert.ok(s.climbing && s.deck.y > 3, `not up the pins: ${s.deck.y}`);
  key(' ', true); key(' ', false);
  for (let i = 0; i < 120; i++) walk.update(FRAME);
  assert.equal(s.climbing, null);
  assert.ok(s.deck && s.deck.grounded && Math.abs(s.deck.y - L.foot) < 0.05, `did not land on her deck: ${JSON.stringify(s.deck)}`);
  assert.deepEqual(left, []);
});

test('what takes you onto it: into its foot from the deck, back into the hole from the top', () => {
  assert.equal(aloftUp(SHIP, foot.x, foot.z, L.foot, ...up), L);
  assert.equal(aloftUp(SHIP, foot.x, foot.z, L.foot, ...away), null, 'walking away from it');
  assert.equal(aloftUp(SHIP, foot.x, foot.z, F, ...up), null, 'from up in the top');
  assert.equal(aloftUp(SHIP, foot.x, 2 * M.z - foot.z, L.foot, ...up), null, 'on the far side of the mast');
  assert.equal(aloftDown(SHIP, L.land[0], L.land[1], F, ...toHole), L);
  assert.equal(aloftDown(SHIP, L.land[0], L.land[1], F, -toHole[0], -toHole[1]), null, 'pushing away from the hole');
  assert.equal(aloftDown(SHIP, 2 * M.x - L.land[0], L.land[1], F, ...toHole), null, 'the far side of the top');
  assert.equal(aloftDown(SHIP, L.land[0], L.land[1], L.foot, ...toHole), null, 'from the deck');
  // the way: up the climber's line to the floor, and aside onto it - never through the mast
  const way = aloftPath(L);
  assert.equal(way.length, 3);
  assert.ok(Math.abs(way[1].y - F) < 1e-9 && fromMast(way[2].x, way[2].z) > 0.3);
  // and somebody else on it, from their deck position alone (peers.js)
  const [a, b] = way;
  const mid = { x: a.x, z: a.z, y: (a.y + b.y) / 2 };
  const hold = aloftHolding(SHIP, mid.x, mid.z, mid.y);
  assert.ok(hold && hold.ladder === L && Math.abs(hold.at - (mid.y - L.foot)) < 1e-9);
  assert.equal(aloftHolding(SHIP, mid.x, mid.z, L.foot), null, 'standing at its foot');
  assert.equal(aloftHolding(SHIP, mid.x + 0.6, mid.z, mid.y), null, 'beside it');
});

test('a running jump goes over the rim and falls the whole way down onto her deck; a standing one does not', () => {
  const { walk, left } = harness();
  const dir = [Math.SQRT1_2, Math.SQRT1_2];     // forward and to starboard, away from the hole
  standAt(walk, M.x + dir[0] * 0.4, M.z + dir[1] * 0.4, F);
  const s = walk.state;
  s.camYaw = Math.atan2(dir[0], dir[1]);
  key('shift', true);
  key('w', true);
  let out = 0, air = 0, jumped = false;
  for (let i = 0; i < 240; i++) {
    // the top is wide: the jump is taken a stride short of its rim
    if (!jumped && fromMast(s.deck.x, s.deck.z) > 0.48) { jumped = true; key(' ', true); key(' ', false); }
    walk.update(FRAME);
    if (fromMast(s.deck.x, s.deck.z) > 0.79) out = Math.max(out, s.deck.y);
    if (!s.deck.grounded) air++;
  }
  key('w', false);
  key('shift', false);
  assert.ok(out > F - 0.2, 'never went over the rim');
  assert.ok(air > 30, `a fall of six units in ${air} frames`);
  assert.ok(s.deck.grounded && s.deck.y < 2, `did not come down on her deck: ${s.deck.y}`);
  assert.deepEqual(left, []);
});

test("a jump at a walk comes down inside the rim again, never through the top's floor", () => {
  const { walk } = harness();
  const dir = [Math.SQRT1_2, Math.SQRT1_2];
  standAt(walk, M.x + dir[0] * 0.45, M.z + dir[1] * 0.45, F);
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
  assert.ok(low > F - 0.2, `fell to ${low.toFixed(2)}`);
  assert.ok(s.deck.grounded && fromMast(s.deck.x, s.deck.z) < 0.78, 'not in the top');
});
