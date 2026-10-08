// The treasure statue between a rowing boat and a ship, on the real walk mode
// (Plans/roeiboot-en-schat.md, "de sloep van het schip"): besides climbing a ladder with her on the back
// (tests/ladder-carry.test.mjs), from a rowing boat at one of the galleon's ladders `hoistOnto` takes her up with you - her onto
// the ship as cargo, you onto the planks where that ladder lands - and `lowerOff` takes her off the
// ship into a rowing boat again, which you then board. tests/treasure-hunt.test.mjs holds the
// offers (E at the ladder, E beside her on the deck); this holds what the walker does with them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
import { CRAFTS } from '../shared/crafts.mjs';
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

const FRAME = 1 / 60;
// Land south of z = -30, sea everywhere else.
const ground = (x, z) => (z < -30 ? 1 : -2.5);

// A hull as main.js keeps one, with a craft that remembers what was hung on it.
function hull(id, spec) {
  const craft = { spec, object: null, held: null, setCargo(m) { craft.held = m; } };
  return { id, x: 0, z: 0, yaw: 0, v: 0, craft };
}

function harness() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  camera.up.set(0, 1, 0);
  const walk = createWalkMode({
    scene, camera, terrain: { worldHeight: ground, half: 64, size: 128 }, material: new THREE.MeshBasicMaterial(), dom: el(),
    following: () => false, poseHull: null,
  });
  walk.enter({
    at: [0, -40], blockers: [], interactables: [], onLeftDeck: noop,
    onBoarded: noop, onInteract: noop, onSendAway: noop, onPlant: noop, onNextSeed: noop, onPrevSeed: noop,
    onBuild: noop, onAvatar: noop, onExit: noop, onRelease: noop, onToggleMinimap: noop, onGive: noop,
  });
  for (let i = 0; i < 5; i++) walk.update(FRAME);
  return { walk };
}

test('up the ship\'s side from the rowing boat with the statue, and down into a rowing boat again', () => {
  const { walk } = harness();
  assert.equal(walk.lift('statue'), true, 'in the arms on the beach');
  const row = hull('boat:w-me', CRAFTS.rowboat);
  row.x = 2.9; row.z = 1.85;
  walk.board(row);
  assert.equal(walk.carrying(), null, 'aboard, the arms are on the oars');
  assert.equal(walk.cargo().hull, row, 'and she is in the rowing boat');

  const ship = hull('boat:abcd1234', CRAFTS.galleon);
  const ladder = CRAFTS.galleon.ladders[0];
  assert.equal(walk.hoistOnto(ship, ladder), true);
  assert.equal(walk.aboard(), null, 'out of the rowing boat');
  assert.equal(walk.cargo().hull, ship, 'she is on the ship');
  assert.equal(row.craft.held, null, 'and gone from the rowing boat');
  assert.ok(ship.craft.held, 'drawn on her deck');
  const where = walk.deckWhere();
  assert.ok(where && where.boat === ship, 'we stand on her deck');
  const d = walk.state.deck;
  assert.ok(Math.hypot(d.x - ladder.land[0], d.z - ladder.land[1]) < 0.6, 'where the ladder lands');
  for (let i = 0; i < 30; i++) walk.update(FRAME);
  assert.ok(walk.deckWhere(), 'and stay there');
  assert.equal(walk.hoistOnto(ship, ladder), false, 'not twice: she is not in a rowing boat now');

  const back = hull('boat:w-me', CRAFTS.rowboat);
  back.x = 2.9; back.z = 1.85;
  assert.equal(walk.lowerOff({ id: 'boat:other' }, back), false, 'not off a ship she is not on');
  assert.equal(walk.lowerOff(ship, back), true);
  assert.equal(walk.deckWhere(), null, 'off her deck');
  assert.equal(walk.cargo().hull, back, 'into the rowing boat');
  assert.equal(ship.craft.held, null);
  walk.board(back);
  assert.equal(walk.aboard(), back, 'at the oars, with her in the stern');
  assert.equal(walk.cargo().hull, back);
});
