// Out of the water onto planks (the keeper, 13 Oct 2026: "je kan vanaf het water niet de steiger op";
// walk.js climbOut). Space at a plank's edge: the Adventurer pulls himself up by Mixamo's Freehang Climb
// To Standing (gait-clips.js climbOut, played by walk.js stepHoist along the way it measured), the
// Traveller by his climb's reach let go of. With the real walk mode and its own rig, frame by frame at
// 60 a second, both bodies: nothing jumps further in one frame than a body can (tests/ladder-step's
// measure), the hands start on the edge's height and the soles end on the planks.
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
const { QUAY_DECK } = await import('../web/js/buildings.js');
const { DEFAULT_AVATAR } = await import('../web/js/avatar.js');
const { GAIT_CLIPS } = await import('../web/js/gait-clips.js');

const FRAME = 1 / 60;
const BODIES = { adventurer: { ...DEFAULT_AVATAR, character: 'adventurer' }, traveller: { ...DEFAULT_AVATAR, character: 'traveller' } };
const STEP_MAX = 0.06;
const TURN_MAX = 0.2;
// A jetty along x >= 0 at QUAY_DECK, a lid over the water as main.js hands planks over; sea west of it,
// a beach far off east so walk mode has dry ground to be set down on.
const EDGE = 0;
const jetty = { x0: EDGE, x1: 8, z0: -2, z1: 2, y: QUAY_DECK, lid: true };

function swimmerAtTheEdge(look) {
  handlers.keydown.length = 0;
  handlers.keyup.length = 0;
  const height = (x) => (x > 12 ? 0.2 : -1);
  const ground = { height, bedAt: height, regionAt: () => null, levelKey: () => null };
  const walk = createWalkMode({
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(60, 1, 0.5, 1000),
    terrain: { half: 64, size: 128, worldHeight: height }, ground, material: new THREE.MeshBasicMaterial(),
    dom: { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} }, avatarSpec: look,
  });
  walk.setAvatar(look);
  walk.setSurfaces([jetty]);
  // set down on the planks, then off their end into the sea and back round to face them
  walk.enter({ at: [1, 0], facing: [-10, 0], blockers: [], interactables: [], onExit: noop });
  walk.state.camYaw = -Math.PI / 2;
  key('w', true);
  for (let i = 0; i < 240 && walk.state.pos.x > -1.2; i++) walk.update(FRAME);
  key('w', false);
  for (let i = 0; i < 90; i++) walk.update(FRAME);
  walk.state.camYaw = Math.PI / 2;
  key('w', true);
  for (let i = 0; i < 240 && walk.state.pos.x < EDGE - 0.35; i++) walk.update(FRAME);
  key('w', false);
  for (let i = 0; i < 60; i++) walk.update(FRAME);
  return walk;
}

const parts = (walk) => {
  const out = [];
  walk.avatar.updateWorldMatrix(true, true);
  walk.avatar.traverse((o) => { if (o.isBone || o.name.startsWith('mount:') || o.name.startsWith('clavicle:')) { const v = o.getWorldPosition(new THREE.Vector3()); v.name = o.name; out.push(v); } });
  return out;
};
const facing = new THREE.Vector3();

for (const [name, look] of Object.entries(BODIES)) {
  test(`${name}: out of the water onto the jetty with Space, smoothly`, () => {
    const walk = swimmerAtTheEdge(look);
    assert.equal(walk.state.swimming, true, `not in the water at x ${walk.state.pos.x.toFixed(2)}`);
    assert.ok(walk.state.pos.x < EDGE, `swam under the planks to x ${walk.state.pos.x.toFixed(2)}`);
    let was = null, worst = { root: 0, limb: 0, turn: 0, who: '' }, frames = 0, hands = null;
    key(' ', true);
    for (let i = 0; i < 300; i++) {
      walk.update(FRAME);
      if (i === 0) key(' ', false);
      walk.avatar.getWorldDirection(facing);
      const now = { pos: walk.state.pos.clone(), yaw: Math.atan2(facing.x, facing.z), joints: parts(walk) };
      if (walk.state.climbing && walk.state.climbing.out != null) {
        frames++;
        // a moment in, once the climb's pose has faded in: where the hands are against the planks
        if (frames === 20) hands = Math.max(...now.joints.filter((p) => /Arm:end|wrist|hand/i.test(p.name)).map((p) => p.y));
      }
      if (was) {
        worst.root = Math.max(worst.root, now.pos.distanceTo(was.pos));
        now.joints.forEach((p, k) => { const d = was.joints[k] ? p.distanceTo(was.joints[k]) : 0; if (d > worst.limb) { worst.limb = d; worst.who = `${p.name} at frame ${i}`; } });
        worst.turn = Math.max(worst.turn, Math.abs(Math.atan2(Math.sin(now.yaw - was.yaw), Math.cos(now.yaw - was.yaw))));
      }
      was = now;
      if (!walk.state.climbing && frames && i > frames + 40) break;
    }
    assert.ok(frames > 60, `climbed out in ${frames} frames`);
    assert.equal(walk.state.swimming, false, 'still in the water');
    assert.ok(walk.state.pos.x > EDGE, `not on the planks: x ${walk.state.pos.x.toFixed(2)}`);
    assert.ok(Math.abs(walk.state.pos.y - QUAY_DECK) < 1e-9, `at ${walk.state.pos.y}`);
    assert.ok(worst.root <= STEP_MAX, `the body jumped ${worst.root.toFixed(3)} in one frame`);
    assert.ok(worst.limb <= STEP_MAX, `a joint jumped ${worst.limb.toFixed(3)} in one frame: ${worst.who}`);
    assert.ok(worst.turn <= TURN_MAX, `the body turned ${worst.turn.toFixed(3)} in one frame`);
    if (name === 'adventurer' && GAIT_CLIPS.climbOut) {
      assert.ok(hands != null && hands > QUAY_DECK - 0.12, `the hands are at ${hands} against planks at ${QUAY_DECK}: not on the edge`);
    }
    // and the soles on the planks, standing
    const toes = parts(walk).filter((p) => p.name.endsWith('Leg:toe'));
    if (toes.length) {
      const sole = Math.min(...toes.map((p) => p.y));
      assert.ok(Math.abs(sole - QUAY_DECK) < 0.06, `the soles at ${sole.toFixed(3)} on planks at ${QUAY_DECK}`);
    }
  });
}
