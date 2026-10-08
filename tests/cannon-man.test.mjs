// Manning one of the galleon's guns (Plans/kanonnen.md), in the real walk mode with no browser: E's
// offer at its breech, laying it with the camera inside its limits and at its own pace, a ball rammed
// home over LOAD_S before the left button fires, and climbing into an empty one to be fired out of it -
// a flight that is the jump's own fall, ending in the water as any fall from a ship does.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
import { CRAFTS } from '../shared/crafts.mjs';
import { GUN_TURN, LOAD_S, RECOIL_S, HUMAN_SPEED } from '../shared/cannon.mjs';
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
const gun = CRAFTS.galleon.mounts[0];

function harness() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const terrain = { worldHeight: () => -2.5, half: 32, size: 64 };
  const walk = createWalkMode({ scene, camera, terrain, material: new THREE.MeshBasicMaterial(), dom: el(), following: () => false, poseHull: null });
  const shots = [], events = [], left = [];
  walk.enter({
    at: [0, -40], blockers: [], interactables: [], onLeftDeck: (b) => left.push(b.id), onBoarded: noop,
    onInteract: noop, onSendAway: noop, onPlant: noop, onNextSeed: noop, onPrevSeed: noop, onBuild: noop,
    onAvatar: noop, onExit: noop, onRelease: noop, onToggleMinimap: noop, onGive: noop,
    onGunEvent: (what) => events.push(what),
    // As main.js answers for a body in the gun: out of the muzzle, along the bore.
    onGunFire: (shot) => {
      shots.push(shot);
      const h = gun.yaw + shot.lay[0];
      const c = Math.cos(shot.lay[1]);
      return { at: [gun.x + Math.sin(h) * 0.4, 2, gun.z + Math.cos(h) * 0.4], v: [Math.sin(h) * c * HUMAN_SPEED, Math.sin(shot.lay[1]) * HUMAN_SPEED, Math.cos(h) * c * HUMAN_SPEED] };
    },
  });
  const ship = { id: 'boat:abcd1234', x: 0, z: 0, yaw: 0, v: 0, craft: { spec: CRAFTS.galleon, object: null } };
  walk.board(ship);
  assert.ok(walk.leaveHelm());
  return { walk, ship, shots, events, left };
}

const run = (walk, seconds) => { for (let i = Math.round(seconds / FRAME); i > 0; i--) walk.update(FRAME); };

test('E is offered at a gun\'s breech, and the gunner stands behind it, turned with it', () => {
  const { walk } = harness();
  assert.equal(walk.gunNear(), null, 'a gun within reach of the wheel');
  walk.state.deck.x = gun.stand[0]; walk.state.deck.z = gun.stand[1] + 0.2;
  assert.equal(walk.gunNear(), 0);
  assert.ok(walk.manGun(0));
  run(walk, 0.1);
  assert.ok(Math.abs(walk.state.deck.x - gun.stand[0]) < 1e-6 && Math.abs(walk.state.deck.z - gun.stand[1]) < 1e-6);
  assert.ok(Math.abs(walk.state.yaw - gun.yaw) < 0.05, `facing ${walk.state.yaw}, the gun ${gun.yaw}`);
  assert.equal(walk.gunNear(), null, 'nothing more to offer while one is manned');
});

test('the camera lays the gun, at the gun\'s pace and never past its limits', () => {
  const { walk } = harness();
  walk.state.deck.x = gun.stand[0]; walk.state.deck.z = gun.stand[1];
  walk.manGun(0);
  walk.state.camYaw += 3;           // far past the traverse
  walk.state.camPitch = -2;         // and far up
  run(walk, 0.25);
  const lay = walk.gun().lay;
  assert.ok(Math.abs(lay[0]) <= GUN_TURN * 0.26 + 1e-9, `turned ${lay[0]} in a quarter second`);
  run(walk, 3);
  const [yaw, pitch] = walk.gun().lay;
  assert.ok(Math.abs(Math.abs(yaw) - gun.yawLim) < 1e-9, `traverse ${yaw}`);
  assert.ok(Math.abs(pitch - gun.pitchLim[1]) < 1e-9, `elevation ${pitch}`);
});

test('an empty gun does not fire; a rammed one fires once, and runs back and out', () => {
  const { walk, shots, events } = harness();
  walk.state.deck.x = gun.stand[0]; walk.state.deck.z = gun.stand[1];
  walk.manGun(0);
  assert.equal(walk.fireGun(), false);
  assert.ok(events.includes('empty'));
  assert.ok(walk.loadGun());
  run(walk, LOAD_S * 0.5);
  assert.equal(walk.fireGun(), false, 'fired half rammed');
  run(walk, LOAD_S * 0.6);
  assert.ok(walk.gun().loaded && events.includes('loaded'));
  assert.ok(walk.fireGun());
  assert.equal(shots.length, 1);
  assert.equal(shots[0].self, false);
  assert.equal(walk.fireGun(), false, 'fired twice on one ball');
  run(walk, RECOIL_S * 0.1);
  assert.ok(walk.gun().kick > 0.05, 'did not run back');
  run(walk, RECOIL_S);
  assert.equal(walk.gun().kick, 0, 'did not run out again');
  // Unloading: a rammed ball drawn again.
  walk.loadGun(); run(walk, LOAD_S + 0.1);
  assert.ok(walk.loadGun() && !walk.gun().loaded);
});

test('a step lets go of it, and E does too', () => {
  const { walk } = harness();
  walk.state.deck.x = gun.stand[0]; walk.state.deck.z = gun.stand[1];
  walk.manGun(0);
  assert.ok(walk.leaveGun());
  assert.equal(walk.gun(), null);
  assert.ok(walk.state.deck, 'still on her deck');
});

test('climbed into an empty gun and fired, a body flies the arc and comes down in the sea', () => {
  const { walk, shots, left, ship } = harness();
  walk.state.deck.x = gun.stand[0]; walk.state.deck.z = gun.stand[1];
  walk.manGun(0);
  walk.state.camPitch = -2;
  run(walk, 2);
  assert.ok(walk.climbInGun());
  assert.equal(walk.loadGun(), false, 'loaded a ball on top of a body');
  assert.ok(walk.fireGun());
  assert.equal(shots[0].self, true);
  assert.deepEqual(left, [ship.id], 'the sea was not told we left her');
  assert.equal(walk.state.deck, null);
  assert.ok(walk.state.launched && !walk.state.grounded);
  let top = -Infinity, x0 = walk.state.pos.x;
  for (let i = 0; i < 60 * 8 && !walk.state.grounded; i++) { walk.update(FRAME); top = Math.max(top, walk.state.pos.y); }
  assert.ok(walk.state.grounded, 'never came down');
  assert.equal(walk.state.launched, false);
  assert.ok(top > 4.5, `rose only to ${top.toFixed(1)}`);
  const flown = walk.state.pos.x - x0;
  assert.ok(flown > 20, `flew only ${flown.toFixed(1)} units`);
  assert.ok(walk.state.swimming, 'not in the water');
});
