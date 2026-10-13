// Taking a ship's ladder from the water while she is under way, and what is left of a way in the water
// (the keeper's recording of 13 Oct 2026: he swam to the sloop's port ladder and on taking it was slid
// some 1.5 m along her side to its foot; the log read 75.8 kn over her). Three things were wrong:
//   - out of a gun (launchSelf) her sails were left standing and nobody stepped her, so she lay frozen
//     with her speed in `v` - the 75.8 kn, 9.75 a second under three quarters of sail;
//   - a swimmer taking her ladder stepped her (stepClimb), so she got under way at that speed at once;
//   - the body is eased onto the rope from where it was drawn, and that was eased in the world's frame,
//     so a hull under way left it behind by her speed and slid it back along her side.
// With the real walk mode and its own rig, 60 frames a second, measured in the ship's own frame: no
// joint and no root may move more than STEP_MAX in one frame there while a body takes her ladder.
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
const { DEFAULT_AVATAR } = await import('../web/js/avatar.js');

const FRAME = 1 / 60;
const STEP_MAX = 0.06;
const SHIP = CRAFTS.galleon;
const L = SHIP.ladders.find((q) => q.x > 0);
const BODIES = { adventurer: { ...DEFAULT_AVATAR, character: 'adventurer' }, traveller: { ...DEFAULT_AVATAR, character: 'traveller' } };

function joints(walk) {
  const out = [];
  walk.avatar.updateWorldMatrix(true, true);
  walk.avatar.traverse((o) => { if (o.isBone || o.name.startsWith('mount:') || o.name.startsWith('clavicle:')) out.push(o.getWorldPosition(new THREE.Vector3())); });
  return out;
}
function world(walk, ship, look, following = () => false) {
  handlers.keydown.length = 0;
  handlers.keyup.length = 0;
  const camera = new THREE.PerspectiveCamera();
  const terrain = { worldHeight: () => -2.5, half: 32, size: 64 };
  const w = createWalkMode({
    scene: new THREE.Scene(), camera, terrain, material: new THREE.MeshBasicMaterial(), dom: el(),
    following, poseHull: null, avatarSpec: look,
  });
  w.setAvatar(look);
  w.enter({
    at: [0, -40], blockers: [], interactables: [], onLeftDeck: noop, onBoarded: noop, onInteract: noop,
    onSendAway: noop, onPlant: noop, onNextSeed: noop, onPrevSeed: noop, onBuild: noop, onAvatar: noop,
    onExit: noop, onRelease: noop, onToggleMinimap: noop, onGive: noop,
  });
  w.setBoats(() => [ship]);
  return w;
}
const shipAt = (extra = {}) => ({ id: 'boat:abcd1234', x: 0, z: 0, yaw: 0, v: 0, craft: { spec: SHIP, object: null, walk: SHIP_SURFACE }, ...extra });

for (const [name, look] of Object.entries(BODIES)) {
  test(`the ${name} takes the ladder of a ship somebody else is sailing, and is not slid along her side`, () => {
    // Somebody else has her wheel (following): their page steps her, ours glides her, at 4 a second
    // north, bow first - faster than anybody swims, so the swimmer lies in wait off her side, pushing
    // into it, and her ladder comes by.
    const V = 4;
    const ship = shipAt({ v: V });
    const walk = world(null, ship, look, () => true);
    const s = walk.state;
    s.pos.set(L.x + 0.45, -0.07, L.z + 1.2);
    s.deck = null;
    for (let i = 0; i < 20; i++) walk.update(FRAME);
    assert.ok(s.swimming, 'not in the water beside her');
    let was = null, worst = { v: 0, at: -1 }, climbed = false, aboard = 0;
    key('w', true);
    for (let i = 0; i < 1500; i++) {
      // press into her side, and let her come
      s.camYaw = -Math.PI / 2;
      ship.z += V * FRAME;
      walk.update(FRAME);
      // what the eye sees, in her frame
      const now = { root: s.pos.clone().setZ(s.pos.z - ship.z), j: joints(walk).map((p) => p.setZ(p.z - ship.z)) };
      if (s.climbing) climbed = true;
      if (was && climbed) {
        const step = Math.max(now.root.distanceTo(was.root), ...now.j.map((p, k) => (was.j[k] ? p.distanceTo(was.j[k]) : 0)));
        if (step > worst.v) worst = { v: step, at: i };
      }
      was = now;
      // up, over the sill, and a moment standing on her deck
      if (s.deck && !s.climbing && ++aboard > 45) break;
    }
    key('w', false);
    assert.ok(climbed, 'never took her ladder');
    assert.ok(aboard > 45, 'never stood on her deck');
    assert.ok(worst.v <= STEP_MAX, `something of the body jumped ${worst.v.toFixed(3)} in her frame at frame ${worst.at}`);
  });
}

test('a swimmer taking the ladder of a ship nobody sails does not set her going, sails standing or not', () => {
  // As the gun used to leave her: three quarters of sail and her speed in `v`, with nobody stepping her.
  const ship = shipAt({ v: 0, underSail: 0.75 });
  const walk = world(null, ship, BODIES.adventurer);
  const s = walk.state;
  s.pos.set(L.x + 0.9, -0.07, L.z);
  s.deck = null;
  key('w', true);
  s.camYaw = -Math.PI / 2;
  let climbed = false;
  // up her side as far as her deck: aboard her, crew, she is sailed as anybody's who stands on her
  for (let i = 0; i < 600 && !s.deck; i++) { walk.update(FRAME); if (s.climbing) climbed = true; }
  key('w', false);
  assert.ok(climbed, 'never took her ladder');
  assert.equal(ship.v, 0, `she got under way at ${ship.v}`);
  assert.equal(ship.z, 0);
});

test('fired out of a gun, the ship is let run with her sails struck, as over her rail', () => {
  const ship = shipAt({ v: 4, underSail: 0.75 });
  const walk = world(null, ship, BODIES.adventurer);
  walk.board(ship);
  assert.ok(walk.leaveHelm(), 'could not step off the helm onto her deck');
  ship.underSail = 0.75;
  walk.launchSelf([ship.x + 2, 3, ship.z], [8, 4, 0]);
  assert.ok(!ship.underSail, `her sails still stand at ${ship.underSail}`);
  assert.equal(walk.runningOut(), ship, 'nobody runs her out');
  // and she does run out: stepped by this page until she lies still
  for (let i = 0; i < 60 * 60 && walk.runningOut(); i++) walk.runOut(FRAME);
  assert.ok(Math.abs(ship.v) <= 0.05, `still making ${ship.v}`);
});

test('out of a gun into the sea, the way is braked by the water and not carried on a ship\'s length', () => {
  const ship = shipAt();
  const walk = world(null, ship, BODIES.adventurer);
  const s = walk.state;
  s.pos.set(20, -0.07, 20);
  for (let i = 0; i < 10; i++) walk.update(FRAME);
  // shared/cannon.mjs HUMAN_SPEED, laid a little up: 12 a second along, from 3 up
  walk.launchSelf([20, 3, 20], [12, 6, 0]);
  let wet = null;
  for (let i = 0; i < 600; i++) {
    walk.update(FRAME);
    if (wet === null && s.swimming) wet = s.pos.x;
  }
  assert.ok(wet !== null, 'never came down in the water');
  // at 1/s under water it went on 12 more; the water's drag now takes most of it within a few units
  assert.ok(s.pos.x - wet < 6.5, `went on ${(s.pos.x - wet).toFixed(1)} after hitting the water`);
});
