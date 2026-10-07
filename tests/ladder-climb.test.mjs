// Climbing a rope ladder (the galleon's two, the Salty Kraken's up its hull, issue #86): the
// Adventurer plays Mixamo's Climbing Up A Ladder by the height gained (scripts/bake-mixamo-gait.py
// `climb`, classic-avatar.js climbStep), the Traveller reaches up procedurally (climbReach), walk.js
// says when a body is on the rungs (`state.climbing`) and peers.js finds somebody else on a ladder
// from their height alone (walk.js ladderAt, shared/deck.mjs ladderHolding) - no pose bit.
// The harness is tests/pirate-stair-walk.test.mjs's.
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
const { buildBuilding } = await import('../web/js/buildings.js');
const { createClassicAvatar, climbStep, climbKind, climbReach, CLIMB_RATE_MAX, CLIMB_REACH } = await import('../web/js/classic-avatar.js');
const { DEFAULT_AVATAR } = await import('../web/js/avatar.js');
const { GAITS } = await import('../web/js/avatar-gait.js');
const { GAIT_CLIPS } = await import('../web/js/gait-clips.js');
const { CRAFTS } = await import('../shared/crafts.mjs');
const { ladderHolding, ladderPath } = await import('../shared/deck.mjs');

const FRAME = 1 / 60;

test('the climb is baked as a cycle that rises, with its hips kept on the rungs', () => {
  const c = GAIT_CLIPS.climb;
  assert.ok(c, 'clips.json lists the climb');
  assert.equal(c.source, 'climbing-ladder.fbx');
  // Mixamo's Climbing Up A Ladder: about half a leg up a cycle of three quarters of a second.
  assert.ok(c.rise > 0.4 && c.rise < 0.8, `rise ${c.rise} legs a cycle`);
  assert.ok(c.seconds > 0.5 && c.seconds < 1.2, `${c.seconds} s`);
  assert.equal(c.stride, undefined, 'no stride: it is played by height, not distance');
  // The steady rise is taken out, so the hips go up and down round their rest and do not climb
  // away from the feet through the cycle - and the first row meets the last again.
  const k = c.rows[0].length - 1;
  const drops = c.rows.map((r) => r[k]);
  assert.ok(Math.max(...drops.map(Math.abs)) < 0.4, `drops ${Math.min(...drops)}..${Math.max(...drops)}`);
  assert.ok(Math.abs(drops[0] - drops[drops.length - 1]) < 0.1, 'a loop, not a ramp');
});

test('which climb a body plays: the clip for a body of clips, the reach for the Traveller', () => {
  assert.equal(climbKind(GAITS.athlete), 'clip');
  assert.equal(climbKind(GAITS.traveller), 'reach');
});

test('the climb moves by height: a rung climbed is a share of a cycle, hanging still holds it, down plays it back', () => {
  const per = 0.12;
  assert.equal(climbStep(0.3, 0, per, FRAME), 0.3, 'still on the ladder: still in the cycle');
  assert.ok(Math.abs(climbStep(0.3, 0.012, per, 0.1) - 0.4) < 1e-9, 'a tenth of a cycle up');
  assert.ok(Math.abs(climbStep(0.3, -0.012, per, 0.1) - 0.2) < 1e-9, 'and back down');
  assert.ok(Math.abs(climbStep(0.95, 0.012, per, 0.1) - 0.05) < 1e-9, 'wrapping round');
  // never faster than CLIMB_RATE_MAX cycles a second, whatever a late sample says
  const fast = climbStep(0, 5, per, FRAME);
  assert.ok(Math.abs(fast - CLIMB_RATE_MAX * FRAME) < 1e-9, `${fast}`);
});

test('the Traveller reaches up with both hands in turn and steps with the other foot', () => {
  const a = climbReach(0.25), b = climbReach(0.75);
  for (const p of [a, b]) {
    assert.ok(p.limbs.leftArm < -2 && p.limbs.rightArm < -2, 'both hands up the ropes');
    assert.ok(p.limbs.leftLeg < 0 && p.limbs.rightLeg < 0, 'both legs forward onto the rungs');
  }
  assert.ok(a.limbs.leftArm < a.limbs.rightArm && a.limbs.rightLeg < a.limbs.leftLeg, 'left hand high, right foot up');
  assert.ok(b.limbs.rightArm < b.limbs.leftArm && b.limbs.leftLeg < b.limbs.rightLeg, 'and the other way round');
  assert.ok(a.knees[1] > a.knees[0] && b.knees[0] > b.knees[1], 'the leg going up is the one bent');
  assert.equal(CLIMB_REACH.rungs, 0.4);
});

// The rig itself, stepped like walk.js steps it: where its hands are against its head.
function handsOf(rig) {
  rig.object.updateWorldMatrix(true, true);
  const at = (side) => new THREE.Vector3().setFromMatrixPosition(rig.handAttach[side].matrixWorld);
  return { left: at('leftArm'), right: at('rightArm') };
}
function climbRig(character) {
  const rig = createClassicAvatar({ ...DEFAULT_AVATAR, character }, new THREE.MeshBasicMaterial());
  const parent = new THREE.Group();
  parent.add(rig.object);
  for (let i = 0; i < 60; i++) rig.update({ moving: false, grounded: true }, FRAME);
  const standing = handsOf(rig);
  return { rig, standing };
}
const pose = (rise) => ({ moving: true, grounded: true, climbing: { rise } });

for (const character of ['adventurer', 'traveller']) {
  test(`the ${character} climbs: hands up the ropes, moving with the height gained and still when hanging`, () => {
    const { rig, standing } = climbRig(character);
    // a cycle's rise: the clip's on his leg (0.212, avatar-gait.js), or the Traveller's two rungs
    const per = character === 'adventurer' ? GAIT_CLIPS.climb.rise * 0.212 : CLIMB_REACH.rungs;
    // up for a second at a pace of 1.5 cycles a second
    const rise = per * 1.5 * FRAME;
    const lefts = [];
    for (let i = 0; i < 60; i++) { rig.update(pose(rise), FRAME); lefts.push(handsOf(rig).left.y); }
    const up = handsOf(rig);
    assert.ok(up.left.y > standing.left.y + 0.07 && up.right.y > standing.right.y + 0.07,
      `hands raised: ${up.left.y.toFixed(3)}/${up.right.y.toFixed(3)} from ${standing.left.y.toFixed(3)}/${standing.right.y.toFixed(3)}`);
    const swing = Math.max(...lefts.slice(20)) - Math.min(...lefts.slice(20));
    assert.ok(swing > 0.02, `the left hand goes from rung to rung (${swing.toFixed(3)})`);
    // hanging still: the pose holds
    for (let i = 0; i < 15; i++) rig.update(pose(0), FRAME);   // the limbs catching up with the pose
    const held = handsOf(rig);
    for (let i = 0; i < 30; i++) rig.update(pose(0), FRAME);
    const later = handsOf(rig);
    const moved = Math.max(held.left.distanceTo(later.left), held.right.distanceTo(later.right));
    assert.ok(moved < 2e-3, `still on the ladder, still in the pose (${moved.toFixed(4)})`);
    // off the ladder it lets go of the climb again
    for (let i = 0; i < 90; i++) rig.update({ moving: false, grounded: true }, FRAME);
    const down = handsOf(rig);
    assert.ok(Math.abs(down.left.y - standing.left.y) < 0.03, `hands down again: ${down.left.y.toFixed(3)} for ${standing.left.y.toFixed(3)}`);
  });
}

// ---- walk mode on the Salty Kraken's rope ladder (built as tests/pirate-stair-walk.test.mjs builds it)

const made = buildBuilding({ id: 'c:piratetavern', kind: 'civic', civicType: 'piratetavern', style: 'unknown' }, {});
const DECK = 0.44;
const lift = DECK - made.anchors.door[1];
const up = (o) => ({ ...o, ...(o.y != null ? { y: o.y + lift } : {}), ...(o.y0 != null ? { y0: o.y0 + lift } : {}), ...(o.y1 != null ? { y1: o.y1 + lift } : {}) });
const lifted = (q) => ({ ...q, y: q.y + lift });
const sea = { surfaces: made.surfaces.map(up), solids: made.solids.map(up), climbs: made.climbs.map((l) => ({ ...l, lo: lifted(l.lo), hi: lifted(l.hi) })) };
const T = Object.fromEntries(sea.surfaces.map((f) => [f.name, f]));
const L = sea.climbs.find((l) => l.name === 'side');

function onTheLanding() {
  handlers.keydown.length = 0;
  handlers.keyup.length = 0;
  const height = () => -0.8;
  const ground = { height, bedAt: height, regionAt: () => null, levelKey: () => null };
  const terrain = { half: 64, size: 128, worldHeight: height };
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 1000);
  const dom = { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} };
  const walk = createWalkMode({ scene: new THREE.Scene(), camera, terrain, ground, material: new THREE.MeshBasicMaterial(), dom });
  walk.setSurfaces(sea.surfaces);
  walk.setClimbs(sea.climbs);
  walk.enter({ at: [T.land.x1 - 0.3, T.land.z1 - 0.2], y: T.land.y, facing: [0, 0], blockers: sea.solids, interactables: [], onExit: noop });
  return walk;
}
// Push towards `to` for `seconds`, the camera turned that way; each frame's height and `climbing`.
function push(walk, to, seconds) {
  const s = walk.state, out = [];
  key('w', true);
  for (let i = 0; i < seconds / FRAME; i++) {
    const dx = to[0] - s.pos.x, dz = to[1] - s.pos.z;
    if (Math.hypot(dx, dz) > 0.08) s.camYaw = Math.atan2(dx, dz);
    walk.update(FRAME);
    out.push({ y: s.pos.y, climbing: s.climbing, yaw: s.yaw });
  }
  key('w', false);
  return out;
}

test('walk mode says when the feet are on the rungs, and how far they went up or down', () => {
  const walk = onTheLanding();
  const s = walk.state;
  push(walk, [L.lo.x, L.lo.z + 0.2], 3);
  assert.equal(s.climbing, null, 'on the landing: no climb');
  const going = push(walk, [L.hi.x, L.hi.z], 1.5);
  const on = going.filter((f) => f.climbing);
  assert.ok(on.length > 10, `climbing on the way up (${on.length} frames)`);
  assert.ok(on.every((f) => f.climbing.rise >= 0) && on.some((f) => f.climbing.rise > 0.005), 'rising');
  // let go of the keys halfway: still on the ladder, rising by nothing
  for (let i = 0; i < 10; i++) walk.update(FRAME);
  assert.ok(s.climbing && s.climbing.rise === 0, `hanging: ${JSON.stringify(s.climbing)}`);
  // the page's own question about somebody else, asked of where we hang: on it, facing the hull
  const at = walk.ladderAt(s.pos.x, s.pos.y, s.pos.z);
  assert.ok(at, 'a body halfway up is on the ladder');
  assert.ok(Math.abs(Math.atan2(Math.sin(at.yaw - s.yaw), Math.cos(at.yaw - s.yaw))) < 1e-6, `facing it as we do: ${at.yaw} for ${s.yaw}`);
  assert.equal(walk.ladderAt(s.pos.x, L.lo.y, s.pos.z), null, 'standing at its foot is not on it');
  assert.equal(walk.ladderAt(s.pos.x + 0.5, s.pos.y, s.pos.z), null, 'nor is a body beside it');
  // down again: rise below zero, then off at the foot and no climb
  const back = push(walk, [L.lo.x, L.lo.z + 0.6], 4);
  assert.ok(back.some((f) => f.climbing && f.climbing.rise < -0.005), 'climbing down');
  assert.equal(s.climbing, null, 'off at the foot');
  // and up all the way: over the top onto the plank, no climb any more
  push(walk, [L.hi.x, L.hi.z], 12);
  assert.equal(s.climbing, null, `on the plank: ${s.pos.y.toFixed(2)}`);
  assert.equal(walk.ladderAt(s.pos.x, s.pos.y, s.pos.z), null, 'nor is anybody on the plank');
});

test('a ship\'s ladder is found from where a body hangs in her frame', () => {
  const ship = CRAFTS.galleon;
  const l = ship.ladders[0], s = l.x < 0 ? -1 : 1;
  const foot = -0.8;
  const path = ladderPath(ship, l, foot);
  const mid = { x: path[0].x, z: path[0].z, y: (path[0].y + path[1].y) / 2 };
  assert.equal(ladderHolding(ship, mid.x, mid.z, mid.y, foot), l, 'halfway up the ropes');
  assert.equal(ladderHolding(ship, mid.x, mid.z, foot, foot), null, 'treading water at its foot is not climbing');
  assert.equal(ladderHolding(ship, mid.x + s * 0.6, mid.z, mid.y, foot), null, 'out in the water beside her');
  assert.equal(ladderHolding(ship, mid.x, mid.z + 1, mid.y, foot), null, 'along her side from it');
  assert.equal(ladderHolding(ship, mid.x, mid.z, l.top + 0.5, foot), null, 'above the bulwark');
});
