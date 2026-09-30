// The treasure statue in both arms and the dig with a shovel (web/js/walk.js, Plans/schatkaarten.md),
// on a real walk mode driven frame by frame, the way tests/diving-walk.test.mjs drives it. The sea's
// half (the two pose bits) is tests/player-look.test.mjs; this is what only the whole walk can answer:
// that a carrier cannot jump, run, fight, ride or dive and walks at 0.55; that a dig runs its 2.5 s
// standing still and ends in a callback, or is cancelled by a step, a jump, a crouch, a blow, a
// panel or leaving walk mode; that a statue carried aboard becomes cargo on the hull (the arms are
// empty at the tiller) and comes back into the arms on the way ashore, but is not put in the sea.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);

const noop = () => {};
// A 2D context that accepts anything: zzz.js and the avatar paint a canvas at construction.
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
const { createBoat, cargoMesh, registerCargo, DECK_Y } = await import('../web/js/boat.js');

const FRAME = 1 / 60;
const key = (k, down) => {
  const e = { key: k, repeat: false, ctrlKey: false, metaKey: false, altKey: false, target: {}, preventDefault: noop };
  for (const fn of handlers[down ? 'keydown' : 'keyup']) fn(e);
};
const press = (k) => key(k, true);
const release = (k) => key(k, false);
const run = (walk, seconds) => { for (let i = 0; i < Math.round(seconds / FRAME); i++) walk.update(FRAME); };

// Dry land everywhere at 1.0, unless `h` says otherwise. Water is anything below 0.
const LAND = () => 1;
// Sea until x = 20, then a beach climbing out of it: where a boat lies and where it can land.
const SHORE = (x) => (x > 20 ? Math.min(0.6, -2.5 + (x - 20) * 0.5) : -2.5);

function make(h = LAND, extra = {}, at = [0, 0]) {
  handlers.keydown.length = 0;
  handlers.keyup.length = 0;
  const events = { done: [], cancelled: [], blocked: [], swings: [] };
  const scene = new THREE.Scene();
  const material = new THREE.MeshBasicMaterial();
  const sea = { height: h, bedAt: h, regionAt: () => null, levelKey: () => null };
  const terrain = { half: 64, size: 128, worldHeight: h };
  const walk = createWalkMode({
    scene, camera: new THREE.PerspectiveCamera(60, 1, 0.5, 1000), terrain, ground: sea, material,
    dom: { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} },
    onDigDone: (x, z, info) => events.done.push({ x, z, ...info }),
    onDigCancelled: (why) => events.cancelled.push(why),
    onBlocked: (why) => events.blocked.push(why),
    onSwing: (side) => events.swings.push(side),
    ...extra,
  });
  walk.enter({ at, facing: [at[0], at[1] + 10], blockers: [], interactables: [], onExit: noop });
  return { walk, events, scene, material };
}

// ---- carrying -------------------------------------------------------------------------------

test('lifting takes both arms: the item is carried, once, and put down again', () => {
  const { walk } = make();
  run(walk, 0.2);
  assert.equal(walk.carrying(), null);
  assert.equal(walk.lift('statue'), true);
  assert.equal(walk.carrying(), 'statue');
  assert.equal(walk.state.carry, 'statue', 'net.js reads state.carry for the CARRYING bit');
  assert.equal(walk.lift('statue'), false, 'lifted twice');
  assert.equal(walk.putDown(), 'statue');
  assert.equal(walk.carrying(), null);
  assert.equal(walk.putDown(), null);
  assert.equal(walk.state.vehicle, null, 'the statue is not a vehicle');
  assert.equal(walk.state.bike, null);
});

test('a carrier cannot jump, and a walker can', () => {
  const { walk } = make();
  run(walk, 0.2);
  walk.lift('statue');
  press(' ');
  run(walk, 0.1);
  assert.equal(walk.state.grounded, true, 'jumped with both hands full');
  assert.equal(walk.state.vy, 0);
  release(' ');
  walk.putDown();
  press(' ');
  walk.update(FRAME);
  assert.equal(walk.state.grounded, false, 'the control: an empty-handed walker jumps');
  release(' ');
});

test('a carrier walks at 0.55 of a walk, and Shift buys no run', () => {
  const metres = (carrying, shift) => {
    const { walk } = make();
    run(walk, 0.2);
    if (carrying) walk.lift('statue');
    const z0 = walk.state.pos.z;
    if (shift) press('shift');
    press('w');
    run(walk, 1);
    release('w'); release('shift');
    return walk.state.pos.z - z0;
  };
  const walking = metres(false, false);
  const carrying = metres(true, false);
  const sprinting = metres(true, true);
  assert.ok(walking > 3, `walks only ${walking}`);
  assert.ok(Math.abs(carrying / walking - 0.55) < 0.02, `carries at ${(carrying / walking).toFixed(3)} of a walk`);
  assert.ok(Math.abs(sprinting - carrying) < 1e-6, `Shift made a carrier faster: ${sprinting} against ${carrying}`);
});

test('a carrier cannot crouch, dance, fight or get on a bicycle', () => {
  const { walk, events } = make(LAND, { bikes: true });
  run(walk, 0.2);
  walk.lift('statue');
  press('c'); release('c');
  run(walk, 0.1);
  assert.equal(walk.state.crouching, false);
  press('r');
  run(walk, 0.1);
  assert.equal(walk.state.dancing, false);
  walk.hand('rightArm', true); walk.hand('rightArm', false);
  assert.deepEqual(events.swings, [], 'swung with both hands full');
  press('f');
  run(walk, 0.1);
  assert.equal(walk.state.bike, null, 'rode a bicycle with a statue');
  assert.deepEqual(events.blocked, ['carry'], 'the refusal is told to main.js');
  // The control: without the statue, the same hand swings.
  walk.putDown();
  walk.hand('rightArm', true); walk.hand('rightArm', false);
  assert.equal(events.swings.length, 1, 'the empty hand does not swing either');
});

test('a carrier cannot dive: C in deep water is nothing', () => {
  const { walk } = make(() => -2.5);
  run(walk, 0.3);
  walk.state.carry = 'statue';      // wading in with it (lift itself refuses the water)
  press('c');
  run(walk, 1.5);
  assert.equal(walk.state.dive, false);
  assert.equal(walk.state.swimming, true, 'the carrier floats');
  release('c');
});

test('lift is for dry land: never from the water', () => {
  const { walk } = make(() => -2.5);
  run(walk, 0.3);
  assert.equal(walk.state.swimming, true);
  assert.equal(walk.lift('statue'), false);
});

// ---- digging --------------------------------------------------------------------------------

test('a dig runs its 2.5 seconds standing still and ends in onDigDone at the hole', () => {
  const { walk, events } = make();
  run(walk, 0.2);
  assert.equal(walk.dig(), true);
  assert.equal(walk.digging(), true);
  assert.ok(walk.state.digging, 'net.js reads state.digging for the DIGGING bit');
  assert.equal(walk.dig(), false, 'a second dig on top of the first');
  run(walk, 2.3);
  assert.equal(walk.digging(), true, 'done early');
  assert.equal(events.done.length, 0);
  assert.ok(walk.digProgress() > 0.9 && walk.digProgress() < 1);
  run(walk, 0.4);
  assert.equal(walk.digging(), false);
  assert.equal(walk.digProgress(), null);
  assert.equal(walk.state.digging, null);
  assert.deepEqual(events.cancelled, []);
  assert.equal(events.done.length, 1, 'onDigDone is heard once');
  // Facing +z from the origin: the shovel goes in a step ahead.
  const [d] = events.done;
  assert.ok(Math.abs(d.x) < 1e-6 && Math.abs(d.z - 0.6) < 1e-6, `the hole is at ${d.x}, ${d.z}`);
  assert.deepEqual(d.from.map((n) => Math.round(n * 1e6) / 1e6), [0, 0]);
  // And it can be dug again.
  assert.equal(walk.dig(1), true);
  run(walk, 1.1);
  assert.equal(events.done.length, 2);
});

test('a step cancels a dig; so do a jump, a crouch, a blow and a panel', () => {
  const cancelled = (setup) => {
    const { walk, events } = make();
    run(walk, 0.2);
    assert.equal(walk.dig(), true);
    run(walk, 0.5);
    setup(walk);
    assert.equal(walk.digging(), false, 'still digging');
    assert.equal(events.done.length, 0);
    return events.cancelled;
  };
  assert.deepEqual(cancelled((walk) => { press('w'); walk.update(FRAME); release('w'); }), ['moved']);
  assert.deepEqual(cancelled(() => { press(' '); release(' '); }), ['jump']);
  assert.deepEqual(cancelled(() => { press('c'); release('c'); }), ['crouch']);
  assert.deepEqual(cancelled((walk) => walk.cancelDig('hit')), ['hit']);
  assert.deepEqual(cancelled((walk) => { walk.setPaused(true); walk.update(FRAME); }), ['paused']);
  assert.deepEqual(cancelled((walk) => walk.exit()), ['reset'], 'leaving walk mode leaves the shovel');
  // A jump cancels the dig and nothing more: the press is not also a hop.
  const { walk } = make();
  run(walk, 0.2);
  walk.dig();
  press(' ');
  run(walk, 0.1);
  release(' ');
  assert.equal(walk.state.grounded, true);
});

test('a dig does not start while moving, swimming, carrying or aboard', () => {
  const still = make();
  press('w');
  run(still.walk, 0.2);
  assert.equal(still.walk.dig(), false, 'started a dig on the move');
  release('w');
  run(still.walk, 0.2);
  assert.equal(still.walk.dig(), true);

  const wet = make(() => -2.5);
  run(wet.walk, 0.3);
  assert.equal(wet.walk.dig(), false, 'dug in the sea');

  const held = make();
  run(held.walk, 0.2);
  held.walk.lift('statue');
  assert.equal(held.walk.dig(), false, 'dug with both hands full');
  assert.deepEqual(held.events.blocked, ['carry']);

  const sat = make();
  run(sat.walk, 0.2);
  sat.walk.dig();
  sat.walk.sitOn({ x: 0, z: 0, y: 1 });
  assert.equal(sat.walk.digging(), false, 'a seat ends a dig');
  assert.equal(sat.walk.dig(), false, 'dug sitting down');
});

test('a dig is not the walk of a body under a panel: paused is refused too', () => {
  const { walk } = make();
  run(walk, 0.2);
  walk.setPaused(true);
  assert.equal(walk.dig(), false);
});

// ---- carrying aboard ------------------------------------------------------------------------

function boatIn(walk, scene, material) {
  const craft = createBoat({ scene, material });
  craft.place(5, 0, 0);
  return { id: 'boat:t', x: 5, z: 0, yaw: 0, v: 0, aground: false, craft, deckY: DECK_Y, pilot: null };
}

test('a statue carried aboard becomes cargo on the hull, and the arms are free', () => {
  const { walk, scene, material } = make(SHORE, {}, [30, 0]);
  run(walk, 0.2);
  walk.lift('statue');
  const boat = boatIn(walk, scene, material);
  walk.board(boat);
  assert.equal(walk.aboard(), boat);
  assert.equal(walk.carrying(), null, 'the pose would say CARRYING at the tiller');
  assert.equal(walk.state.carry, null);
  assert.deepEqual(walk.cargo(), { item: 'statue', hull: boat });
  const shown = boat.craft.cargo();
  assert.ok(shown, 'nothing drawn on the deck');
  assert.equal(shown.parent, boat.craft.object, 'the statue must ride the hull\'s own transform');
  run(walk, 0.5);
  // It rides the swell: the hull's bob moves the statue in the world, the local offset unchanged.
  const local = shown.position.clone();
  boat.craft.bob(0.4);
  boat.craft.object.updateMatrixWorld(true);
  assert.deepEqual(shown.position.toArray(), local.toArray());
  const before = shown.getWorldPosition(new THREE.Vector3());
  boat.craft.bob(1.9);
  boat.craft.object.updateMatrixWorld(true);
  assert.ok(shown.getWorldPosition(new THREE.Vector3()).distanceTo(before) > 1e-4, 'the statue did not move with the hull');
});

test('the statue is not put in the sea, but it comes ashore in the arms', () => {
  const { walk, events, scene, material } = make(SHORE, {}, [30, 0]);
  run(walk, 0.2);
  walk.lift('statue');
  const boat = boatIn(walk, scene, material);
  walk.board(boat);
  run(walk, 0.2);
  // Over the side into open water: refused, still aboard, still cargo.
  assert.equal(walk.unboard([10, 5], { water: true }), false);
  assert.deepEqual(events.blocked, ['carry']);
  assert.equal(walk.aboard(), boat);
  assert.ok(walk.cargo() && boat.craft.cargo(), 'the statue left the hull without a shore');
  // Onto the beach: ashore, and the statue in the arms, the deck bare.
  assert.equal(walk.unboard([30, 0]), true);
  assert.equal(walk.aboard(), null);
  assert.equal(walk.cargo(), null);
  assert.equal(boat.craft.cargo(), null);
  assert.equal(walk.carrying(), 'statue');
  // It slows the walk again from the moment it is in the arms.
  const z0 = walk.state.pos.z;
  press('w');
  run(walk, 1);
  release('w');
  assert.ok(walk.state.pos.z - z0 < 3.4 * 0.6, `walks ${walk.state.pos.z - z0} with a statue`);
});

test('takeOffBoat is for a body that is off the hull, and refuses one at the tiller', () => {
  const { walk, scene, material } = make(SHORE, {}, [30, 0]);
  run(walk, 0.2);
  walk.lift('statue');
  const boat = boatIn(walk, scene, material);
  walk.board(boat);
  assert.equal(walk.takeOffBoat(), false, 'the statue came off under the pilot');
  assert.equal(walk.putOnBoat(boat), false, 'nothing is in the arms to put on');
  walk.exit();                                      // to the sky: the body leaves the hull, the statue stays on it
  assert.deepEqual(walk.cargo(), { item: 'statue', hull: boat });
  walk.enter({ at: [30, 0], facing: [40, 0], blockers: [], interactables: [], onExit: noop });
  assert.equal(walk.takeOffBoat(), true);
  assert.equal(walk.carrying(), 'statue');
  assert.equal(boat.craft.cargo(), null);
});

test('leaving walk mode leaves a carried statue in the arms: nothing goes missing', () => {
  const { walk } = make();
  run(walk, 0.2);
  walk.lift('statue');
  walk.exit();
  assert.equal(walk.carrying(), 'statue');
});

test('a climber cannot take a rope ladder with a statue in the arms', () => {
  // The ladder itself is tests/ship-*.test.mjs's; here it is enough that the refusal is the walk's.
  const { walk } = make();
  run(walk, 0.2);
  walk.lift('statue');
  let asked = 0;
  walk.setBoats(() => { asked++; return []; });
  press('w');
  run(walk, 0.2);
  release('w');
  assert.ok(asked > 0, 'the ladder was never looked for');
  assert.equal(walk.state.deck, undefined);
});

// ---- the cargo on the hull ------------------------------------------------------------------

test('a hull carries a cargo mesh as its child, swaps it, and gives back what it made', () => {
  const scene = new THREE.Scene();
  const material = new THREE.MeshBasicMaterial();
  const craft = createBoat({ scene, material });
  assert.equal(craft.cargo(), null);
  const a = cargoMesh('statue', material);
  craft.setCargo(a);
  assert.equal(a.parent, craft.object);
  assert.ok(a.position.y > 0, 'the statue is under the deck');
  const b = cargoMesh('statue', material);
  craft.setCargo(b);
  assert.equal(a.parent, null, 'the first stayed on the hull');
  assert.equal(b.parent, craft.object);
  craft.setCargo(null);
  assert.equal(craft.object.children.length, 0);
  // A baked model, once there is one, is registered by name and replaces the placeholder.
  const baked = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  registerCargo('statue', () => baked);
  assert.equal(cargoMesh('statue', material), baked);
  registerCargo('statue', null);
  assert.notEqual(cargoMesh('statue', material), baked);
});

// ---- somebody else's pose -------------------------------------------------------------------

test('a peer whose pose says carrying or digging is drawn without trouble, on any rig', async () => {
  // peers.js tells the rig (avatar.setCarry / avatar.dig) only when the answer changes, and only
  // where the rig has them: a rig from before them, or one still being written, is left alone.
  const { createPeers } = await import('../web/js/peers.js');
  const { DEFAULT_AVATAR } = await import('../web/js/avatar.js');
  const { FLAG_CARRYING, FLAG_DIGGING } = await import('../web/js/net.js');
  const { POSE } = await import('../lib/players.mjs');
  const scene = new THREE.Scene();
  const peers = createPeers({ scene, material: new THREE.MeshBasicMaterial({ vertexColors: true }), terrain: { worldHeight: () => 0 } });
  peers.join({ id: 'ann', name: 'Ann', look: DEFAULT_AVATAR });
  const pose = (f) => peers.snapshot([['ann', 0, 0, 0, 0, f]]);
  for (const f of [0, FLAG_CARRYING, FLAG_CARRYING | POSE.MOVING, FLAG_DIGGING, FLAG_DIGGING | POSE.MOVING, FLAG_CARRYING | FLAG_DIGGING, POSE.SWIMMING | FLAG_DIGGING, 0]) {
    pose(f); pose(f);
    for (let i = 0; i < 5; i++) peers.update(1 / 60, { beat: 0 });
  }
  peers.dispose();
});
