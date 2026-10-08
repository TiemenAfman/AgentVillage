// A boat against a ship that is a boat herself (Plans/speeltest-quests.md B1): every island's galleon,
// moored or under way, is a wall to every other hull at her waterline, as she is drawn now and at her
// own heading - and her shape, not a box round her, so a rowing boat still comes to the foot of her
// ladders to hoist the statue up (web/js/treasure.js HOIST_REACH).
//
// What is held here:
//   the side      cut from her model by scripts/build-shipwalk.mjs, committed in shipwalk-map.js, and
//                 as wide as the model at the water: inside amidships, outside at a ladder's foot
//   a rowing boat at full throttle from every side of her and at every heading of hers stops with its
//                 bow out of her, backs off again, and reaches HOIST_REACH of the ladder it rowed at
//   herself       is never in her own way, and two galleons meet each other
//   walk mode     rowed with the keys into a galleon in setBoats, the rowing boat stops at her side
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';
import { CRAFTS, SHIP_DRAUGHT } from '../shared/crafts.mjs';
import { createSide } from '../shared/hullwalk.mjs';
import { SHIPWALK } from '../web/js/shipwalk-map.js';
import { PIRATESHIP } from '../web/js/pirateship-mesh.js';
import { sideCut } from '../scripts/build-shipwalk.mjs';
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
// walk.js listens on the global window: the keys are driven through the handlers it registers.
const handlers = { keydown: [], keyup: [] };
globalThis.addEventListener = (type, fn) => { if (handlers[type]) handlers[type].push(fn); };
globalThis.removeEventListener = noop;
const key = (k, down) => {
  const e = { key: k, repeat: false, ctrlKey: false, metaKey: false, altKey: false, target: {}, preventDefault: noop };
  for (const fn of handlers[down ? 'keydown' : 'keyup']) fn(e);
};
const { createWalkMode } = await import('../web/js/walk.js');
const { stepBoat, shipsOver, SHIP_SIDE, SHIP_SIDE_H, BOW, BOAT_SCRAPE } = await import('../web/js/boat.js');
const { HOIST_REACH } = await import('../web/js/treasure.js');

const FRAME = 1 / 60;
const OPEN_SEA = -2.5;
const side = createSide(SHIPWALK);
const positions = PIRATESHIP.parts['pirateship hull'].positions;

const ship = (x, z, yaw, id = 'boat:abcd1234') => ({ id, x, z, yaw, v: 0, craft: { spec: CRAFTS.galleon, side } });
const rowboat = (x, z, yaw) => ({ id: 'boat:w-me', x, z, yaw, v: 0, craft: { spec: CRAFTS.rowboat, side: null } });
// The ground walk.js hands hull `self`: the sea, with every ship but `self` stood up out of it.
const groundFor = (boats, self) => (x, z) => shipsOver(boats, x, z, OPEN_SEA, self);
// A point of the world in a ship's frame (shared/deck.mjs toLocal).
const local = (s, x, z) => {
  const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw), dx = x - s.x, dz = z - s.z;
  return [dx * fz - dz * fx, dx * fx + dz * fz];
};
const bowOf = (b) => [b.x + Math.sin(b.yaw) * BOW, b.z + Math.cos(b.yaw) * BOW];

test('her side is cut from her model as it is now, and is as wide as she is at the water', () => {
  assert.ok(SHIPWALK.side, 'shipwalk-map.js has no side - run: node scripts/build-shipwalk.mjs');
  assert.deepEqual(SHIPWALK.side, sideCut(positions), 'the script cuts a different side than the one committed');
  assert.equal(SHIP_SIDE(0, 0), true, 'her middle');
  assert.equal(SHIP_SIDE(2.1, 0), true, 'amidships she is 4.4 wide at the water');
  assert.equal(SHIP_SIDE(-2.1, 1.85), true);
  assert.equal(SHIP_SIDE(0, 4.4), true, 'her stem');
  assert.equal(SHIP_SIDE(1.2, 4.4), false, 'which is pointed, not a box');
  assert.equal(SHIP_SIDE(0, -5.5), true, 'her stern');
  assert.equal(SHIP_SIDE(0, 6), false, 'past her stem the bowsprit is over the water, not in it');
  for (const l of CRAFTS.galleon.ladders) {
    assert.equal(SHIP_SIDE(l.x, l.z), false, 'a ladder hangs outside her side');
  }
  // Every point of her hull in the band the cut keeps is inside it.
  let missed = 0, seen = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 1] - SHIP_DRAUGHT;
    if (y < -0.1 || y > 0.4) continue;
    seen++;
    if (!SHIP_SIDE(positions[i] * 0.999, positions[i + 2])) missed++;
  }
  assert.ok(seen > 100, `only ${seen} corners of her at the water`);
  assert.equal(missed, 0, `${missed} of ${seen} corners of her at the water are outside her side`);
});

test('a rowing boat at full throttle stops at her side from every bearing and at every heading of hers', () => {
  let stops = 0;
  for (const yaw of [0, 0.4, Math.PI / 2, 2.2, Math.PI, -1.1]) {
    const s = ship(30, -12, yaw);
    for (let a = 0; a < 16; a++) {
      const bearing = (a / 16) * Math.PI * 2;
      // From 14 off, heading straight at her middle.
      const b = rowboat(s.x + Math.sin(bearing) * 14, s.z + Math.cos(bearing) * 14, bearing + Math.PI);
      const ground = groundFor([s, b], b);
      for (let i = 0; i < 60 * 6 && !b.aground; i++) {
        stepBoat(b, { throttle: 1, turbo: true }, FRAME, ground);
        const [lx, lz] = local(s, ...bowOf(b));
        assert.equal(side(lx, lz), false, `the bow went into her (her yaw ${yaw}, from ${bearing.toFixed(2)})`);
      }
      assert.equal(b.aground, true, `nothing stopped it (her yaw ${yaw}, from ${bearing.toFixed(2)})`);
      assert.ok(Math.hypot(b.x - s.x, b.z - s.z) < 7.5, 'against her side, not short of it');
      stops++;
      // And astern it comes off her again: never held.
      const before = Math.hypot(b.x - s.x, b.z - s.z);
      for (let i = 0; i < 60; i++) stepBoat(b, { throttle: -1 }, FRAME, ground);
      assert.ok(Math.hypot(b.x - s.x, b.z - s.z) > before + 0.5, 'backed off her');
    }
  }
  assert.equal(stops, 96);
});

test('rowed at one of her ladders it comes within HOIST_REACH of its foot', () => {
  for (const yaw of [0, 1.3, -2.6]) {
    const s = ship(-8, 40, yaw);
    for (const l of CRAFTS.galleon.ladders) {
      const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
      const foot = [s.x + l.x * fz + l.z * fx, s.z - l.x * fx + l.z * fz];
      const out = [(l.x < 0 ? -1 : 1) * fz, -(l.x < 0 ? -1 : 1) * fx];
      // Straight in at the ladder from her beam, and in along her side from ahead of it.
      for (const [sx, sz] of [[foot[0] + out[0] * 10, foot[1] + out[1] * 10],
        [foot[0] + out[0] * 0.5 + fx * 10, foot[1] + out[1] * 0.5 + fz * 10]]) {
        const b = rowboat(sx, sz, Math.atan2(foot[0] - sx, foot[1] - sz));
        const ground = groundFor([s, b], b);
        // Rowed until it is as near as it gets: against her side, or past the ladder along it.
        let d = Infinity;
        for (let i = 0; i < 60 * 5 && !b.aground; i++) {
          stepBoat(b, { throttle: 0.6 }, FRAME, ground);
          d = Math.min(d, Math.hypot(b.x - foot[0], b.z - foot[1]));
        }
        assert.ok(d <= HOIST_REACH, `${d.toFixed(2)} from the ladder's foot`);
      }
    }
  }
});

test('a ship is never in her own way, and two of them meet', () => {
  const s = ship(0, 0, 0);
  const ground = groundFor([s], s);
  for (let i = 0; i < 60 * 3; i++) stepBoat(s, { throttle: 1 }, FRAME, ground);
  assert.equal(s.aground, false);
  assert.ok(s.z > 5, 'she sails');

  const other = ship(0, 30, 0, 'boat:other');
  const me = ship(0, 0, 0);
  const g = groundFor([other, me], me);
  for (let i = 0; i < 60 * 20 && !me.aground; i++) stepBoat(me, { throttle: 1 }, FRAME, g);
  assert.equal(me.aground, true, 'a galleon stops at another');
  assert.ok(other.z - me.z > 9, `${(other.z - me.z).toFixed(2)} between their middles`);

  // A side that only reads the ground where it is already land, and none from a rowing boat.
  s.x = 0; s.z = 0;
  assert.equal(shipsOver([s], 0, 0, 2, null), 2);
  assert.equal(shipsOver([s], 0, 0, OPEN_SEA, null), SHIP_SIDE_H);
  assert.ok(SHIP_SIDE_H > BOAT_SCRAPE, 'her side is a wall, not a shoal');
  assert.equal(shipsOver([rowboat(0, 0, 0)], 0, 0, OPEN_SEA, null), OPEN_SEA);
});

test('in walk mode, a rowing boat rowed at a galleon stops at her side', () => {
  handlers.keydown.length = 0;
  handlers.keyup.length = 0;
  const walk = createWalkMode({
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), material: new THREE.MeshBasicMaterial(), dom: el(),
    terrain: { worldHeight: (x, z) => (z < -30 ? 1 : OPEN_SEA), half: 64, size: 128 },
    following: () => false, poseHull: null,
  });
  walk.enter({ at: [0, -40], blockers: [], interactables: [], onExit: noop, onLeftDeck: noop, onBoarded: noop });
  for (let i = 0; i < 5; i++) walk.update(FRAME);
  const s = ship(0, 12, Math.PI / 2);
  const row = rowboat(0, -4, 0);
  walk.setBoats(() => [s, row]);
  walk.board(row);
  assert.equal(walk.aboard(), row);
  key('w', true);
  for (let i = 0; i < 60 * 4; i++) {
    walk.update(FRAME);
    const [lx, lz] = local(s, ...bowOf(row));
    assert.equal(side(lx, lz), false, 'the bow went into her');
  }
  key('w', false);
  assert.ok(row.z > 4, `it rowed (${row.z.toFixed(2)})`);
  assert.ok(row.z < 12 - 2.2 - BOW + 0.1, `and stopped at her side (${row.z.toFixed(2)})`);
});
