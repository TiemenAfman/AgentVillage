// A ship you jump from keeps running out. Off her deck nothing steps a boat that nobody is
// aboard, so she froze where you left her; walk.js now keeps the hull it left running (`loose`)
// and main.js calls `runOut(dt)` every frame. This drives the real walk mode: on her deck, over
// the rail, and then frames with nobody on her.
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
    following: () => false, poseHull: null,
  });
  const left = [];
  walk.enter({
    at: [0, -40], blockers: [], interactables: [], onLeftDeck: (b) => left.push(b.id),
    onBoarded: noop, onInteract: noop, onSendAway: noop, onPlant: noop, onNextSeed: noop, onPrevSeed: noop,
    onBuild: noop, onAvatar: noop, onExit: noop, onRelease: noop, onToggleMinimap: noop, onGive: noop,
  });
  const ship = { id: 'boat:abcd1234', x: 0, z: 0, yaw: 0, v: 0, craft: { spec: CRAFTS.galleon, object: null } };
  return { walk, ship, left, camera };
}

test('a ship you jump from runs out on her own, and stops being run when she is done', () => {
  const { walk, ship, left } = harness();
  ship.v = 8;
  walk.board(ship);
  assert.ok(walk.leaveHelm(), 'could not step off the helm onto the deck');
  assert.equal(walk.onDeck(), ship);
  // With nobody at the helm and nobody having jumped, she is stepped by the deck alone.
  assert.equal(walk.runningOut(), null, 'on her deck she is not "left running"');
  // Over the side: the body goes past the rail at the waist, the jump takes it off the planks.
  walk.state.deck.x = 1.95; walk.state.deck.z = 0;
  for (let i = 0; i < 240 && !left.length; i++) {
    walk.state.deck.x += 0.05;
    walk.update(FRAME);
  }
  assert.deepEqual(left, [ship.id], 'never left the deck, or the sea was not told');
  assert.equal(walk.onDeck(), null);

  // Nobody aboard: her way is still on, and she is run out from here, frame by frame.
  const z0 = ship.z, v0 = ship.v;
  assert.equal(walk.runningOut(), ship, 'the ship we left is not the one running out');
  for (let i = 0; i < 60; i++) walk.runOut(FRAME);
  assert.ok(ship.z > z0 + 4, `she went only ${(ship.z - z0).toFixed(1)} units in a second`);
  assert.ok(ship.v < v0 && ship.v > v0 * 0.85, `her way went from ${v0} to ${ship.v}`);
  // Until she is done.
  for (let i = 0; i < 100 * 60 && walk.runningOut(); i++) walk.runOut(FRAME);
  assert.equal(walk.runningOut(), null);
  assert.equal(ship.v, 0, 'she is not at rest');
});

test('at her wheel W and S set her sails a step at a time, and the setting stands with no key held', () => {
  const { walk, ship } = harness();
  walk.board(ship);
  assert.equal(ship.underSail, 0, 'a ship lying still came to the wheel under sail');
  // Two taps of W: half sail. A tap is one step, however long it is held under the repeat.
  for (let i = 0; i < 2; i++) { key('w', true); walk.update(FRAME); key('w', false); walk.update(FRAME); }
  assert.equal(ship.underSail, 0.5);
  for (let i = 0; i < 30 * 60; i++) walk.update(FRAME);
  const half = CRAFTS.galleon.sail.top / 2;
  assert.ok(Math.abs(ship.v - half) < 1e-6, `half sail with no key held made ${ship.v}, not ${half}`);
  // Held: a step, then another every repeat - up to full and no further.
  key('w', true);
  for (let i = 0; i < 3 * 60; i++) walk.update(FRAME);
  key('w', false);
  assert.equal(ship.underSail, 1);
  // S all the way down is her sails backed: astern.
  key('s', true);
  for (let i = 0; i < 4 * 60; i++) walk.update(FRAME);
  key('s', false);
  assert.equal(ship.underSail, -1);
});

test('let go of her wheel and stay aboard: the sails stand, she keeps her way and her heading', () => {
  const { walk, ship, left } = harness();
  const half = CRAFTS.galleon.sail.top / 2;
  ship.v = half;
  ship.underSail = 0.5;
  walk.board(ship);
  assert.ok(walk.leaveHelm());
  const yaw0 = ship.yaw;
  // A minute and a half on her deck, standing at the wheel's foot: well past any run-out.
  for (let i = 0; i < 90 * 60; i++) walk.update(FRAME);
  assert.deepEqual(left, [], 'standing still went over the side');
  assert.ok(Math.abs(ship.v - half) < 1e-6, `under half sail she went from ${half} to ${ship.v}`);
  assert.ok(Math.abs(ship.yaw - yaw0) < 1e-9, 'the rudder was not left amidships');
  assert.ok(ship.z > half * 85, `she made only ${ship.z.toFixed(0)} units in ninety seconds`);
  // Back at the wheel they are as they were.
  assert.ok(walk.takeHelm());
  assert.equal(ship.underSail, 0.5);
});

test('a ship running out with no sails we know of is given the step that matches her way at the wheel', () => {
  const { walk, ship } = harness();
  ship.v = 8;   // 8 of 13: over a half, under three quarters
  walk.board(ship);
  assert.equal(ship.underSail, 0.5);
});

test('over the side her sails are struck and she runs out as before', () => {
  const { walk, ship, left } = harness();
  ship.v = 8;
  ship.underSail = 0.75;
  walk.board(ship);
  walk.leaveHelm();
  for (let i = 0; i < 30 * 60; i++) walk.update(FRAME);
  walk.state.deck.x = 1.95; walk.state.deck.z = 0;
  for (let i = 0; i < 240 && !left.length; i++) { walk.state.deck.x += 0.05; walk.update(FRAME); }
  assert.deepEqual(left, [ship.id]);
  assert.equal(ship.underSail, 0, 'sails still set on a ship nobody is aboard');
  let t = 0;
  for (; t < 100 * 60 && walk.runningOut(); t++) walk.runOut(FRAME);
  assert.ok(t / 60 < CRAFTS.galleon.sail.runOut, `she ran ${(t / 60).toFixed(0)} s, past her run-out`);
  assert.equal(ship.v, 0);
  // And somebody else sailing her on (lib/boats.mjs handOn) ends our running her out at once.
  const again = harness();
  again.ship.v = 8;
  again.walk.board(again.ship);
  again.walk.leaveHelm();
  again.walk.state.deck.x = 1.95;
  for (let i = 0; i < 240 && !again.left.length; i++) { again.walk.state.deck.x += 0.05; again.walk.update(FRAME); }
  assert.equal(again.walk.runningOut(), again.ship);
  again.walk.stopRunning(again.ship);
  assert.equal(again.walk.runningOut(), null);
});

test('main.js hands her on: our sails go with the letgo, and the sea word on who sails her is read', () => {
  const src = readFileSync(new URL('../web/js/main.js', import.meta.url), 'utf8');
  assert.match(src, /letGoBoat\(it\.id, sailOf\(state\.walk\.onDeck\(\)\)\)/);
  assert.match(src, /if \(b\.coast\) return b\.coast !== me;/, 'hullFollowed does not follow the one the sea names');
  assert.match(src, /state\.walk\.stopRunning\(craft\)/);
});

test('a ship that had no way on her is not left running, and a Benchy never is', () => {
  const still = harness();
  still.ship.v = 0;
  still.walk.board(still.ship);
  still.walk.leaveHelm();
  still.walk.state.deck.x = 3;
  for (let i = 0; i < 60 && !still.left.length; i++) still.walk.update(FRAME);
  assert.equal(still.walk.runningOut(), null);

  const benchy = harness();
  benchy.ship.craft = { spec: CRAFTS.rowboat, object: null };
  benchy.ship.v = 8;
  benchy.walk.board(benchy.ship);
  assert.equal(benchy.walk.runningOut(), null);
});

test('main.js steps her in every mode, sends her position and does not take the echo back', () => {
  const src = readFileSync(new URL('../web/js/main.js', import.meta.url), 'utf8');
  assert.match(src, /state\.walk\.runOut\(dt\)/, 'nothing calls runOut every frame');
  assert.match(src, /b === mine \|\| b === running/, 'her position is not sent while she runs out');
  assert.match(src, /craft === ownHull\(\) \|\| craft === runningHull\(\)/, 'the sea\'s echo would drag her back');
});

test('the camera takes only a share of the swell of the ship it is on', () => {
  const { walk, ship, camera } = harness();
  // A hull pitched 0.2 rad (far more than her swell) with her wheel where the ship's is.
  const object = new THREE.Object3D();
  object.rotation.x = 0.2;
  ship.craft = { spec: CRAFTS.galleon, object, camScale: 10, helm: { x: 0, y: 2, z: -3.2 } };
  ship.v = 8;
  walk.board(ship);
  walk.update(FRAME);
  const angle = new THREE.Vector3(0, 1, 0).angleTo(camera.up);
  assert.ok(angle > 0.01, 'the camera ignored the swell altogether');
  assert.ok(angle < 0.2 * 0.5, `the camera rolled ${angle.toFixed(3)} rad with a hull tilted 0.2`);
});

test('E at a ship\'s wheel offers to leave it whatever her speed', () => {
  const src = readFileSync(new URL('../web/js/main.js', import.meta.url), 'utf8');
  const ship = src.indexOf("kind: 'leavehelm'");
  const gate = src.indexOf('Math.abs(aboard.v || 0) > OFFER_BELOW');
  assert.ok(ship > 0 && gate > 0, 'main.js no longer reads like this');
  assert.ok(ship < gate, 'the speed gate comes before the ship\'s leave-the-helm offer: E does nothing under way');
});
