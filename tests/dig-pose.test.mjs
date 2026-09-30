import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);
import * as THREE from 'three';
const previousDocument = globalThis.document;
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { normalizeAvatar } = await import('../web/js/avatar.js');
const { createClassicAvatar } = await import('../web/js/classic-avatar.js');
if (previousDocument === undefined) delete globalThis.document;
else globalThis.document = previousDocument;

const STILL = { moving: false, grounded: true, phase: 0 };
function rig(equip = {}) {
  const avatar = createClassicAvatar(normalizeAvatar({ equip }), new THREE.MeshBasicMaterial());
  const root = new THREE.Group();
  root.add(avatar.object);
  const run = (seconds, pose = STILL) => { for (let i = 0; i < Math.round(seconds * 50); i++) avatar.update(pose, 0.02); };
  // Where the blade's point is, in the rig's own frame (feet on y = 0, forward +z).
  const tip = (side = 'rightArm') => {
    root.updateMatrixWorld(true);
    return avatar.handAttach[side].children[0].localToWorld(new THREE.Vector3(0, 0.37, 0));
  };
  return { avatar, run, tip };
}

test('digging puts the shovel in the hand, worn or not, and gives the old item back', () => {
  const { avatar, run } = rig({ rightHandItem: 'sword' });
  assert.equal(avatar.held('rightArm'), 'sword');
  assert.equal(avatar.dig(true, 'rightArm'), true);
  assert.equal(avatar.held('rightArm'), 'shovel');
  assert.equal(avatar.digging(), true);
  run(0.3);
  avatar.dig(false);
  assert.equal(avatar.held('rightArm'), 'sword');
  assert.equal(avatar.digging(), false);
});

test('with no side named, a free hand takes the shovel and the sword stays where it is', () => {
  const { avatar } = rig({ rightHandItem: 'sword' });
  avatar.dig(true);
  assert.equal(avatar.held('leftArm'), 'shovel');
  assert.equal(avatar.held('rightArm'), 'sword');
  avatar.dig(false);
  assert.equal(avatar.held('leftArm'), null);
  assert.equal(avatar.held('rightArm'), 'sword');
});

test('a worn shovel is used where it is, and stays when the dig stops', () => {
  const { avatar } = rig({ leftHandItem: 'shovel' });
  avatar.dig(true);
  assert.equal(avatar.held('leftArm'), 'shovel');
  assert.equal(avatar.held('rightArm'), null);
  avatar.dig(false);
  assert.equal(avatar.held('leftArm'), 'shovel');
});

test('dig() is idempotent, so a frame loop can hand it the state every frame', () => {
  const { avatar } = rig();
  assert.equal(avatar.dig(true), true);
  assert.equal(avatar.dig(true), false);
  assert.equal(avatar.digging(), true);
  assert.equal(avatar.dig(false), false);
  assert.equal(avatar.dig(false), false);
  assert.equal(avatar.held('rightArm'), null);
});

test('one shovelful is flung per stroke', () => {
  const { avatar, run } = rig();
  avatar.dig(true);
  run(0.3);
  assert.equal(avatar.digged(), 0);
  run(0.2);                     // past the throw at 0.45 s
  assert.equal(avatar.digged(), 1);
  assert.equal(avatar.digged(), 0);
  run(0.6 * 4);
  assert.equal(avatar.digged(), 4);
});

test('the blade goes into the ground in front of the feet, and comes out again', () => {
  const { avatar, run, tip } = rig();
  avatar.dig(true);
  run(0.27);
  const plunged = tip();
  assert.ok(plunged.y < 0, `the point is below the ground at the plunge (${plunged.y})`);
  assert.ok(plunged.y > -0.2, 'not buried to the shaft');
  assert.ok(plunged.z > 0.25 && plunged.z < 0.6, `in front of the feet (${plunged.z})`);
  assert.ok(Math.abs(Math.abs(plunged.x) - 0.118) < 0.03, `straight down the line of the hand, not across the body (${plunged.x})`);
  run(0.3);
  assert.ok(tip().y > 0.1, 'lifted clear of it');
});

test('the body bows forward while it digs and stands up again after', () => {
  const { avatar, run } = rig();
  avatar.dig(true);
  run(0.5);
  assert.ok(avatar.object.rotation.x > 0.25, `bowed (${avatar.object.rotation.x})`);
  avatar.dig(false);
  run(1);
  assert.ok(Math.abs(avatar.object.rotation.x) < 1e-3);
});

test('a new look in the middle of a dig does not take the shovel away', () => {
  const { avatar, run } = rig({ rightHandItem: 'sword' });
  avatar.dig(true, 'rightArm');
  run(0.2);
  avatar.set(normalizeAvatar({ equip: { rightHandItem: 'torch' } }));
  assert.equal(avatar.held('rightArm'), 'shovel');
  avatar.dig(false);
  assert.equal(avatar.held('rightArm'), 'torch');
});

test('sitting, lying or swimming puts the shovel down', () => {
  for (const state of [{ sitting: true }, { lying: true }, { swimming: true }]) {
    const { avatar, run } = rig({ rightHandItem: 'sword' });
    avatar.dig(true, 'rightArm');
    run(0.1, { ...STILL, ...state });
    assert.equal(avatar.digging(), false, JSON.stringify(state));
    assert.equal(avatar.held('rightArm'), 'sword');
  }
});

test('no swing while digging', () => {
  const { avatar } = rig({ rightHandItem: 'sword' });
  avatar.dig(true);
  assert.equal(avatar.attack('rightArm'), false);
  avatar.dig(false);
  assert.equal(avatar.attack('rightArm'), true);
});

test('the pose flags in update() do what dig() and setCarry() do', () => {
  const { avatar, run } = rig();
  run(0.1, { ...STILL, digging: true });
  assert.equal(avatar.digging(), true);
  run(0.1, { ...STILL, digging: false });
  assert.equal(avatar.digging(), false);
  run(0.1, { ...STILL, carrying: true });
  assert.equal(avatar.carrying(), true);
  run(0.1, STILL);                // left out: unchanged
  assert.equal(avatar.carrying(), true);
  run(0.1, { ...STILL, carrying: false });
  assert.equal(avatar.carrying(), false);
});

test('carrying holds both arms out, shows the load and hides what the hands held', () => {
  const { avatar, run } = rig({ rightHandItem: 'sword' });
  assert.equal(avatar.carried.name, 'carried');
  assert.equal(avatar.carried.visible, false);
  assert.equal(avatar.setCarry(true), true);
  assert.equal(avatar.setCarry(true), false);
  assert.equal(avatar.carried.visible, true);
  assert.equal(avatar.handAttach.rightArm.children[0].visible, false);
  run(0.6);
  avatar.object.updateMatrixWorld(true);
  const l = avatar.handAttach.leftArm.getWorldPosition(new THREE.Vector3());
  const r = avatar.handAttach.rightArm.getWorldPosition(new THREE.Vector3());
  const load = avatar.carried.getWorldPosition(new THREE.Vector3());
  for (const hand of [l, r]) {
    assert.ok(hand.z > 0.04, `a hand out in front (${hand.z})`);
    assert.ok(Math.abs(hand.y - load.y) < 0.08, 'at the height of the load');
    assert.ok(Math.abs(hand.x) < 0.13, 'brought in towards it');
  }
  assert.ok(load.z > 0.05, 'the load in front of the chest');
  avatar.setCarry(false);
  assert.equal(avatar.carried.visible, false);
  assert.equal(avatar.handAttach.rightArm.children[0].visible, true);
});

test('hands full, you cannot dig; digging, you put the shovel down to pick something up', () => {
  const { avatar } = rig();
  avatar.setCarry(true);
  assert.equal(avatar.dig(true), false);
  assert.equal(avatar.digging(), false);
  avatar.setCarry(false);
  avatar.dig(true);
  assert.equal(avatar.setCarry(true), true);
  assert.equal(avatar.digging(), false);
});
