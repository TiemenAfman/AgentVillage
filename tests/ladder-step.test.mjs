// Getting onto a rope ladder and off it again (the keeper's recording of 8 Oct 2026: the Adventurer
// stood on the Salty Kraken's landing one frame and hung on the rungs with his knees up the next, and
// stood upright on the boarding plank the frame after the last rung). Every way on and off, with the
// real walk mode and its own rig, frame by frame at 60 a second: no part of the body - the feet, the
// root, every joint of the rig - may move further in one frame than a body can, and the way it faces
// may not turn faster than a body turns. On the Kraken's ladder up its hull, the galleon's over her
// side (from the water and back into it) and her mast's to the crow's nest, both bodies.
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
const { buildBuilding } = await import('../web/js/buildings.js');
const { SHIP_SURFACE } = await import('../web/js/boat.js');
const { CRAFTS } = await import('../shared/crafts.mjs');
const { DEFAULT_AVATAR } = await import('../web/js/avatar.js');

const FRAME = 1 / 60;
const BODIES = { adventurer: { ...DEFAULT_AVATAR, character: 'adventurer' }, traveller: { ...DEFAULT_AVATAR, character: 'traveller' } };
// The most any point of the body may move in one frame, the root (the feet) and the joints: the
// climb itself moves a hand up to 0.053 in a frame (the Adventurer's clip, where a hand lets go of a
// rung and reaches for the next), and getting on or off may move nothing faster. The snaps this was
// written for moved the body's joints 0.2 in one frame, and dropped it 0.28 into the water at the
// foot of the galleon's ladder. And how far the body may turn in one frame.
const STEP_MAX = 0.06;
const TURN_MAX = 0.2;

// Every joint of the rig, by world position: what the eye sees move.
function joints(walk) {
  const out = [];
  walk.avatar.updateWorldMatrix(true, true);
  walk.avatar.traverse((o) => { if (o.isBone || o.name.startsWith('mount:') || o.name.startsWith('clavicle:')) { const v = o.getWorldPosition(new THREE.Vector3()); v.name = o.name; out.push(v); } });
  return out;
}
const facing = new THREE.Vector3();
// Record what one frame did against the last: the root's step, the largest joint's step, the turn.
function recorder(walk) {
  let was = null;
  const frames = [];
  return {
    frames,
    take() {
      const s = walk.state;
      // the way the body is drawn facing, not walk mode's own yaw: getting on a ladder from a deck
      // turns it round to face the hull, and that turn is eased in the drawing
      walk.avatar.getWorldDirection(facing);
      const now = { pos: s.pos.clone(), yaw: Math.atan2(facing.x, facing.z), joints: joints(walk), climbing: !!s.climbing, deck: !!s.deck, swimming: s.swimming };
      // the lower foot: where the soles are drawn, against where walk mode has the feet
      const toes = now.joints.filter((p) => p.name.endsWith('Leg:toe'));
      const sole = toes.length ? Math.min(...toes.map((p) => p.y)) : null;
      if (was) {
        let limb = 0;
        let who = '';
        now.joints.forEach((p, i) => { if (was.joints[i] && p.distanceTo(was.joints[i]) > limb) { limb = p.distanceTo(was.joints[i]); who = p.name; } });
        const turn = Math.abs(Math.atan2(Math.sin(now.yaw - was.yaw), Math.cos(now.yaw - was.yaw)));
                // and what another page makes of this body from where it is alone (peers.js asks ladderAt)
        const seen = walk.ladderAt(now.pos.x, now.pos.y, now.pos.z);
        frames.push({ root: now.pos.distanceTo(was.pos), limb, who, turn, climbing: now.climbing, deck: now.deck, swimming: now.swimming, y: now.pos.y, top: s.climbing ? s.climbing.top : null, sole, seen: seen && seen.top != null ? seen.top : null });
      }
      was = now;
    },
  };
}
function smooth(frames, what) {
  const worst = (k) => frames.reduce((m, f, i) => (f[k] > m.v ? { v: f[k], i } : m), { v: 0, i: -1 });
  const root = worst('root'), limb = worst('limb'), turn = worst('turn');
  const at = (w) => `frame ${w.i} of ${frames.length} (${w.i >= 0 ? JSON.stringify(frames[w.i]) : ''})`;
  assert.ok(root.v <= STEP_MAX, `${what}: the body jumped ${root.v.toFixed(3)} in one frame at ${at(root)}`);
  assert.ok(limb.v <= STEP_MAX, `${what}: a joint jumped ${limb.v.toFixed(3)} in one frame at ${at(limb)}`);
  assert.ok(turn.v <= TURN_MAX, `${what}: the body turned ${turn.v.toFixed(3)} in one frame at ${at(turn)}`);
}

// ---- the Salty Kraken's ladder, up its hull from the zigzag's landing to the boarding plank -----

const made = buildBuilding({ id: 'c:piratetavern', kind: 'civic', civicType: 'piratetavern', style: 'unknown' }, {});
const DECK = 0.44;
const lift = DECK - made.anchors.door[1];
const up = (o) => ({ ...o, ...(o.y != null ? { y: o.y + lift } : {}), ...(o.y0 != null ? { y0: o.y0 + lift } : {}), ...(o.y1 != null ? { y1: o.y1 + lift } : {}) });
const lifted = (q) => ({ ...q, y: q.y + lift });
const kraken = { surfaces: made.surfaces.map(up), solids: made.solids.map(up), climbs: made.climbs.map((l) => ({ ...l, lo: lifted(l.lo), hi: lifted(l.hi) })) };
const T = Object.fromEntries(kraken.surfaces.map((f) => [f.name, f]));
const K = kraken.climbs.find((l) => l.name === 'side');

function onTheLanding(look) {
  handlers.keydown.length = 0;
  handlers.keyup.length = 0;
  const height = () => -0.8;
  const ground = { height, bedAt: height, regionAt: () => null, levelKey: () => null };
  const terrain = { half: 64, size: 128, worldHeight: height };
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 1000);
  const dom = { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} };
  const walk = createWalkMode({ scene: new THREE.Scene(), camera, terrain, ground, material: new THREE.MeshBasicMaterial(), dom, avatarSpec: look });
  walk.setAvatar(look);
  walk.setSurfaces(kraken.surfaces);
  walk.setClimbs(kraken.climbs);
  walk.enter({ at: [T.land.x1 - 0.3, T.land.z1 - 0.2], y: T.land.y, facing: [0, 0], blockers: kraken.solids, interactables: [], onExit: noop });
  return walk;
}
// Hold W towards a point in the world (the camera turned that way), recording every frame.
function towards(walk, rec, to, seconds, stop = () => false) {
  const s = walk.state;
  key('w', true);
  for (let i = 0; i < seconds / FRAME; i++) {
    const dx = to[0] - s.pos.x, dz = to[1] - s.pos.z;
    if (Math.hypot(dx, dz) > 0.08) s.camYaw = Math.atan2(dx, dz);
    walk.update(FRAME);
    rec.take();
    if (stop(s)) break;
  }
  key('w', false);
}
const seen = (rec) => rec.frames.some((f) => f.climbing);
const still = (walk, rec, seconds) => { for (let i = 0; i < seconds / FRAME; i++) { walk.update(FRAME); rec.take(); } };

for (const [name, look] of Object.entries(BODIES)) {
  test(`the ${name} steps onto the Kraken's ladder, climbs it, steps off onto the plank and back, with no jump`, () => {
    const walk = onTheLanding(look);
    const s = walk.state, rec = recorder(walk);
    // walk up to a pace in front of its foot, turn to face it (on foot a body turns at its own
    // rate, and that is not the ladder's doing) and stand there a moment
    const ox = K.lo.x - K.hi.x, oz = K.lo.z - K.hi.z, on = Math.hypot(ox, oz);
    towards(walk, rec, [K.lo.x + (ox / on) * 0.25, K.lo.z + (oz / on) * 0.25], 3);
    s.yaw = Math.atan2(-ox, -oz);
    still(walk, rec, 0.5);
    rec.frames.length = 0;
    // into it: onto the rungs, up, over the top onto the plank - and on along it a step
    towards(walk, rec, [K.hi.x, K.hi.z], 25, () => seen(rec) && !s.climbing && Math.hypot(s.pos.x - K.hi.x, s.pos.z - K.hi.z) < 0.02);
    assert.ok(rec.frames.some((f) => f.climbing), 'never on the rungs');
    assert.ok(Math.abs(s.pos.y - K.hi.y) < 0.05, `not on the plank: ${s.pos.y.toFixed(2)} for ${K.hi.y.toFixed(2)}`);
    // over the top by the step's own way, from its start to its end
    const tops = rec.frames.map((f) => f.top).filter((t) => t != null);
    assert.ok(tops.length > 20 && Math.min(...tops) < 0.05 && Math.max(...tops) > 0.95, `over the top in ${tops.length} frames`);
    // and stood on the plank at its end, soles on the planks (the Adventurer by the clip, which
    // carries its feet up over the top; the Traveller is lifted along the same way)
    // another page sees the same step over the top from where the body is (peers.js)
    const over = rec.frames.filter((f) => f.top != null && f.top > 0.02 && f.top < 0.98);
    assert.ok(over.every((f) => f.seen != null && Math.abs(f.seen - f.top) < 0.05), `seen over the top as it is: ${over.filter((f) => f.seen == null || Math.abs(f.seen - f.top) >= 0.05).map((f) => `${f.top.toFixed(2)}/${f.seen}`).slice(0, 5)}`);
    if (name === 'adventurer') {
      const last = rec.frames.findLast((f) => f.top != null);
      assert.ok(Math.abs(last.sole - K.hi.y) < 0.04, `soles ${last.sole.toFixed(3)} for the plank's ${K.hi.y.toFixed(3)}`);
    }
    still(walk, rec, 0.6);
    smooth(rec.frames, 'up');
    // and back down from the plank to the landing
    rec.frames.length = 0;
    towards(walk, rec, [K.lo.x + (K.lo.x - K.hi.x) * 3, K.lo.z + (K.lo.z - K.hi.z) * 3], 25, () => seen(rec) && !s.climbing && Math.hypot(s.pos.x - K.lo.x, s.pos.z - K.lo.z) < 0.02);
    assert.ok(rec.frames.some((f) => f.climbing), 'never climbed down');
    assert.ok(Math.abs(s.pos.y - K.lo.y) < 0.05, `not back on the landing: ${s.pos.y.toFixed(2)}`);
    still(walk, rec, 0.6);
    smooth(rec.frames, 'down');
  });
}

// ---- the galleon: over her side from her deck into the water and back, and up her mast ------------

const SHIP = CRAFTS.galleon;
function aboard(look) {
  handlers.keydown.length = 0;
  handlers.keyup.length = 0;
  const camera = new THREE.PerspectiveCamera();
  const terrain = { worldHeight: () => -2.5, half: 32, size: 64 };
  const walk = createWalkMode({
    scene: new THREE.Scene(), camera, terrain, material: new THREE.MeshBasicMaterial(), dom: el(),
    following: () => false, poseHull: null, avatarSpec: look,
  });
  walk.setAvatar(look);
  walk.enter({
    at: [0, -40], blockers: [], interactables: [], onLeftDeck: noop,
    onBoarded: noop, onInteract: noop, onSendAway: noop, onPlant: noop, onNextSeed: noop, onPrevSeed: noop,
    onBuild: noop, onAvatar: noop, onExit: noop, onRelease: noop, onToggleMinimap: noop, onGive: noop,
  });
  const ship = { id: 'boat:abcd1234', x: 0, z: 0, yaw: 0, v: 0, craft: { spec: SHIP, object: null, walk: SHIP_SURFACE } };
  walk.setBoats(() => [ship]);
  walk.board(ship);
  assert.ok(walk.leaveHelm(), 'could not step off the helm onto her deck');
  return { walk, ship };
}
// Hold W along a way in the world (she lies at the origin, bow north, so it is hers as well).
function along(walk, rec, way, seconds, stop = () => false) {
  const s = walk.state;
  s.camYaw = Math.atan2(way[0], way[1]);
  key('w', true);
  for (let i = 0; i < seconds / FRAME; i++) {
    walk.update(FRAME);
    rec.take();
    if (stop(s)) break;
  }
  key('w', false);
}

for (const [name, look] of Object.entries(BODIES)) {
  test(`the ${name} goes over the galleon's side down her ladder into the water and up it again, with no jump`, () => {
    const { walk } = aboard(look);
    const s = walk.state, rec = recorder(walk);
    const l = SHIP.ladders.find((q) => q.x > 0);
    // stand at the head of the ladder on her deck
    Object.assign(s.deck, { x: l.land[0], z: l.land[1], y: s.deck.y, vy: 0, grounded: true, yaw: Math.PI / 2 });
    still(walk, rec, 0.5);
    rec.frames.length = 0;
    // out over the side, down to the water
    along(walk, rec, [1, 0], 20, () => seen(rec) && s.swimming);
    assert.ok(rec.frames.some((f) => f.climbing), 'never on her ladder');
    assert.ok(s.swimming && !s.deck, 'not in the water beside her');
    still(walk, rec, 0.6);
    smooth(rec.frames, 'down her side');
    // and up again: into the hull, up, over the bulwark onto her deck
    rec.frames.length = 0;
    along(walk, rec, [-1, 0], 25, () => seen(rec) && s.deck && !s.climbing && s.deck.y < l.top);
    assert.ok(s.deck, 'not back on her deck');
    const over = rec.frames.filter((f) => f.top != null && f.top > 0.02 && f.top < 0.98);
    assert.ok(over.length > 20, `over her bulwark by the step (${over.length} frames)`);
    assert.ok(over.every((f) => f.seen != null && Math.abs(f.seen - f.top) < 0.05), 'seen over the bulwark as it is, by another page');
    still(walk, rec, 0.6);
    smooth(rec.frames, 'up her side');
  });

  test(`the ${name} climbs the galleon's mast to the crow's nest and down, with no jump`, () => {
    const { walk } = aboard(look);
    const s = walk.state, rec = recorder(walk);
    const L = SHIP.aloft[0];
    // on the deck before its foot, facing it
    Object.assign(s.deck, { x: L.x + L.out[0] * 0.3, z: L.z + L.out[1] * 0.3, y: L.foot, vy: 0, grounded: true, yaw: Math.atan2(-L.out[0], -L.out[1]) });
    still(walk, rec, 0.5);
    rec.frames.length = 0;
    along(walk, rec, [-L.out[0], -L.out[1]], 45, () => seen(rec) && !s.climbing && Math.abs(s.deck.y - L.floor) < 0.02);
    assert.ok(s.deck && s.deck.y > L.floor - 0.1, `not in the nest: ${s.deck && s.deck.y}`);
    still(walk, rec, 0.6);
    smooth(rec.frames, 'up the mast');
    rec.frames.length = 0;
    along(walk, rec, L.out, 45, () => seen(rec) && !s.climbing && Math.abs(s.deck.y - L.foot) < 0.05);
    assert.ok(s.deck && s.deck.y < L.foot + 0.3, `not back on the deck: ${s.deck && s.deck.y}`);
    still(walk, rec, 0.6);
    smooth(rec.frames, 'down the mast');
  });
}
