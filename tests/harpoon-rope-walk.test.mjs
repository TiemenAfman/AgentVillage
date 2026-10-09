// A real walk mode on a harpoon's line (web/js/walk.js takeRope, Plans/harpoen.md): walked along a flat
// one with W, slid down a steep one without a key, never taken up a steep one, stepped off onto the
// ground at the hook, and Space jumps off it with the way it had - into the water a plunge.
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
const { createWalkMode } = await import('../web/js/walk.js');

const FRAME = 1 / 60;
// Land from x 18 on, 1 high; deep sea short of it.
const ground = (x) => (x >= 18 ? 1 : -3);

function make() {
  handlers.keydown.length = 0;
  handlers.keyup.length = 0;
  const sea = { height: ground, bedAt: ground, regionAt: () => null, levelKey: () => null };
  const terrain = { half: 64, size: 128, worldHeight: ground };
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 1000);
  const dom = { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} };
  const walk = createWalkMode({ scene: new THREE.Scene(), camera, terrain, ground: sea, material: new THREE.MeshBasicMaterial(), dom });
  walk.enter({ at: [20, 0], facing: [0, 10], blockers: [], interactables: [], onExit: noop });
  return walk;
}
const run = (walk, s) => { for (let i = 0; i < Math.round(s / FRAME); i++) walk.update(FRAME); };
const line = (a, b) => ({ ends: () => ({ a, b }), deck: null });

test('a flat line is walked with W, and stepped off onto the ground at the hook', () => {
  const walk = make();
  run(walk, 0.2);
  // From the shore at x 20 back out to a point over the sea, 2 up: walked from its land end (b).
  const rope = line({ x: 4, y: 3, z: 0 }, { x: 20, y: 2.2, z: 0 });
  assert.equal(walk.takeRope(rope, 'b'), true);
  walk.state.camYaw = -Math.PI / 2;          // looking along -x, out over the water
  key('w', true);
  run(walk, 4);
  const s = walk.state;
  assert.equal(walk.onLine(), true);
  assert.equal(s.rope, 'walk');
  assert.ok(s.pos.x < 19 && s.pos.x > 16, `walked out to ${s.pos.x}`);
  assert.ok(Math.abs(s.pos.y - (2.2 + (3 - 2.2) * (20 - s.pos.x) / 16)) < 0.02, 'on the line');
  // And back in: S, with the same view.
  key('w', false);
  key('s', true);
  run(walk, 8);
  key('s', false);
  assert.equal(walk.onLine(), false, 'off at the hook');
  assert.ok(s.grounded && s.pos.x > 20, `on the ground at ${s.pos.x}`);
});

test('a steep line falls from where you are: slid down it with no key, and not climbed up it', () => {
  const walk = make();
  run(walk, 0.2);
  const steep = line({ x: 12, y: 1.2, z: 0 }, { x: 20, y: 6, z: 0 });
  assert.equal(walk.takeRope(steep, 'a'), false, 'not up from its low end');
  assert.equal(walk.takeRope(steep, 'b'), true);
  run(walk, 0.5);
  assert.equal(walk.state.rope, 'zip');
  assert.ok(walk.state.pos.x < 19.5, 'sliding');
  // Its low end has no deck here (no ship): off the line at it, into the air and the sea.
  run(walk, 4);
  assert.equal(walk.onLine(), false);
});

test('Space jumps off a line with the way it had, and into deep water that is a dive', () => {
  const walk = make();
  run(walk, 0.2);
  const rope = line({ x: 4, y: 3, z: 0 }, { x: 20, y: 2.2, z: 0 });
  walk.takeRope(rope, 'b');
  walk.state.camYaw = -Math.PI / 2;
  key('w', true);
  run(walk, 6);
  key('w', false);
  const x0 = walk.state.pos.x;
  key(' ', true);
  walk.update(FRAME);
  key(' ', false);
  assert.equal(walk.onLine(), false);
  assert.equal(walk.state.grounded, false, 'in the air');
  assert.ok(walk.state.vy > 2, 'jumped');
  run(walk, 3);
  assert.equal(walk.state.swimming, true, 'in the water');
  assert.ok(walk.state.pos.x < x0, 'carried on the way it was going');
});

test('hooked by somebody else\'s harpoon the body is drawn to their gun, and Space struggles free', () => {
  const walk = make();
  run(walk, 0.2);
  const ends = [];
  walk.state.onPullEnd = (why) => ends.push(why);
  const gun = { x: 10, y: 2.5, z: 0 };
  assert.equal(walk.pullTo(() => gun), true);
  run(walk, 0.5);
  assert.equal(walk.pulled(), true);
  assert.ok(walk.state.pos.x < 19 && walk.state.grounded === false, `on its way at ${walk.state.pos.x}`);
  run(walk, 3);
  assert.equal(walk.pulled(), false);
  assert.deepEqual(ends, ['arrived']);
  assert.ok(Math.hypot(walk.state.pos.x - 10, walk.state.pos.z) < 2, 'at the rail');
  // Again, and this time Space.
  run(walk, 2);
  walk.pullTo(() => ({ x: 0, y: 2.5, z: 0 }));
  run(walk, 0.3);
  key(' ', true); walk.update(FRAME); key(' ', false);
  assert.equal(walk.pulled(), false);
  assert.equal(ends.at(-1), 'free');
});

test('hauled in by a ship\'s harpoon the body lands over her rail on her deck, and is crew', async () => {
  const { CRAFTS } = await import('../shared/crafts.mjs');
  const { createSurface, nearestStand } = await import('../shared/hullwalk.mjs');
  const { SHIPWALK } = await import('../web/js/shipwalk-map.js');
  const { deckAt } = await import('../shared/deck.mjs');
  const { DECK_Y } = await import('../shared/hull.mjs');
  const walk = make();
  run(walk, 0.2);
  // Her starboard harpoon (the second of the two after the cannons), her bow to +z, lying at x 8 in
  // the deep water off the shore - the swimmer is on the beach at x 20.
  const spec = CRAFTS.galleon;
  const mount = spec.mounts.findIndex((g) => g.kind === 'harpoon' && g.x > 0);
  const g = spec.mounts[mount];
  const ship = { id: 'boat:abcd1234', x: 8, z: 0, yaw: 0, v: 0, craft: { spec, object: null, walk: createSurface(SHIPWALK) } };
  const boarded = [], ends = [];
  walk.state.onBoarded = (b) => boarded.push(b.id);
  walk.state.onPullEnd = (why) => ends.push(why);
  // Her harpoon's mouth, as main.js hands it over: in her frame (bow +z, yaw 0), a little over the gun.
  const mouth = () => ({ x: ship.x + g.x, y: DECK_Y + g.y + 0.3, z: ship.z + g.z });
  // Hauled out of the water at her side: the pull lets go below her deck, so the hop has to rise.
  walk.state.pos.set(ship.x + 6, -0.3, 3);
  assert.equal(walk.pullTo(mouth, { ship, mount }), true);
  let top = -Infinity;
  for (let i = 0; i < 300 && walk.pulled(); i++) { walk.update(FRAME); top = Math.max(top, walk.state.pos.y); }
  run(walk, 0.2);
  assert.equal(walk.pulled(), false);
  assert.deepEqual(ends, ['boarded']);
  assert.deepEqual(boarded, [ship.id], 'the sea was told we are aboard');
  assert.equal(walk.onDeck(), ship, 'on her deck');
  const d = walk.state.deck;
  assert.equal(d.boat, ship.id);
  // Where her model has room to stand behind that harpoon, never a coordinate of our own.
  const want = nearestStand(ship.craft.walk, g.stand[0], g.stand[1], (deckAt(spec, g.stand[0], g.stand[1]) ?? g.y) + 0.2);
  assert.ok(want, 'her model has no place to stand behind the harpoon');
  assert.ok(Math.hypot(d.x - want.x, d.z - want.z) < 1e-9 && Math.abs(d.y - want.y) < 1e-9, `on the deck at ${d.x},${d.z}`);
  assert.equal(walk.state.swimming, false, 'not in the water beside her');
  assert.ok(top > DECK_Y + want.y + 0.5, `over her bulwark: the hop rose only to ${top.toFixed(2)}`);
  // And she is walked like any deck: a second later still on her, standing.
  run(walk, 1);
  assert.equal(walk.onDeck(), ship);
  assert.equal(walk.state.deck.grounded, true);
});

test('struggling free of a ship\'s harpoon line still lets go where you are', () => {
  const walk = make();
  run(walk, 0.2);
  const ends = [];
  walk.state.onPullEnd = (why) => ends.push(why);
  const ship = { id: 'boat:abcd1234', x: 0, z: 0, yaw: 0, v: 0, craft: { spec: { mounts: [] }, object: null } };
  walk.pullTo(() => ({ x: 0, y: 2.5, z: 0 }), { ship, mount: 0 });
  run(walk, 0.3);
  key(' ', true); walk.update(FRAME); key(' ', false);
  assert.equal(walk.pulled(), false);
  assert.equal(walk.onDeck(), null);
  assert.deepEqual(ends, ['free']);
});
