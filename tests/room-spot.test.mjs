// Back into the room the page was closed in (web/js/room-spot.js, main.js recalledRoom): the record
// survives storage and nothing else does, the door must still stand where it was, and the feet go
// back on the floor they stood on - a gallery's or the one under it - or the room's own way in.
// The walk-mode half uses tests/walk-surfaces.test.mjs's stubs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
globalThis.addEventListener = noop;
globalThis.removeEventListener = noop;
const { createWalkMode } = await import('../web/js/walk.js');
const { packRoomSpot, readRoomSpot, doorOf, placeInRoom, DOOR_SLACK, FLOOR_SLACK } = await import('../web/js/room-spot.js');

const FLOOR = 0.06;
const GALLERY = 0.86;
// A gallery from x 2 to 4 over the room's floor, reached by a stair from x 0.
const SURFACES = [
  { x0: 0, x1: 2, z0: -0.5, z1: 0.5, y0: FLOOR, y1: GALLERY, axis: 'x' },
  { x0: 2, x1: 4, z0: -1, z1: 1, y: GALLERY },
];
const AREAS = [{ x0: -5, x1: 5, z0: -5, z1: 5 }];
const DOORWAY = { z: 5.2, hx: 0.6 };

function room(blockers = []) {
  const flat = () => FLOOR;
  const walk = createWalkMode({
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(60, 1, 0.05, 100),
    terrain: { half: 16, size: 32, worldHeight: flat },
    ground: { height: flat, bedAt: flat, regionAt: () => null, levelKey: () => null },
    material: new THREE.MeshBasicMaterial(),
    dom: { addEventListener: noop, removeEventListener: noop, requestPointerLock: undefined, style: {} },
  });
  walk.setSurfaces(SURFACES);
  walk.setBlockers(blockers);
  return walk;
}
const spotAt = (x, y, z) => ({ room: 'piratetavern', door: { at: [10, 20], facing: [10, 19] }, at: [x, y, z], yaw: 1.2, pitch: 0.1 });
const fits = (walk, spot) => placeInRoom(spot, { areas: AREAS, doorway: DOORWAY, standFloor: walk.standFloor });

test('a record goes through storage whole, and nothing else comes back as one', () => {
  const packed = packRoomSpot({
    room: 'piratetavern', door: { at: [10.12345, 20], facing: null },
    pos: { x: 1.23456, y: GALLERY, z: -0.5 }, yaw: 0.5, pitch: undefined,
  });
  const back = readRoomSpot(JSON.parse(JSON.stringify(packed)));
  assert.deepEqual(back, { room: 'piratetavern', door: { at: [10.123, 20], y: null, facing: null }, at: [1.235, GALLERY, -0.5], yaw: 0.5, pitch: null });
  for (const bad of [null, 'x', {}, { ...packed, v: 2 }, { ...packed, room: '' }, { ...packed, at: [1, 2] },
    { ...packed, at: [1, 'a', 2] }, { ...packed, yaw: null }, { ...packed, door: { at: [1] } }, { ...packed, door: { at: [1, 2], facing: [1] } }]) {
    assert.equal(readRoomSpot(bad), null, JSON.stringify(bad));
  }
});

test('the door must still stand where you came in', () => {
  const spot = spotAt(0, FLOOR, 0);
  const door = { room: 'piratetavern', x: 10.5, z: 19.6, r: 0.9 };
  assert.equal(doorOf(spot, [{ room: 'tavern', x: 10, z: 20, r: 2 }, door]), door);
  // The pub lifted onto its beach: the same room, a door somewhere else.
  assert.equal(doorOf(spot, [{ ...door, x: 10 + 0.9 + DOOR_SLACK + 0.1, z: 20 }]), null);
  assert.equal(doorOf(spot, []), null);
});

test('under the gallery is the floor, on it is the gallery', () => {
  const walk = room();
  const under = fits(walk, spotAt(3, FLOOR, 0));
  assert.deepEqual(under.at, [3, 0]);
  assert.equal(under.y, FLOOR);
  const over = fits(walk, spotAt(3, GALLERY, 0));
  assert.equal(over.y, GALLERY);
  // And walk mode stands the body there, not on the highest floor over (x, z).
  walk.enter({ at: under.at, y: under.y, facing: [3, 1], blockers: [], interactables: [], onExit: noop });
  assert.equal(walk.state.pos.y, FLOOR);
  walk.exit();
  walk.enter({ at: over.at, y: over.y, facing: [3, 1], blockers: [], interactables: [], onExit: noop });
  assert.equal(walk.state.pos.y, GALLERY);
});

test('a floor that is not there any more, the doorway and outside the room give the way in', () => {
  const walk = room();
  // Remembered on a storey higher than anything the room has now.
  assert.equal(fits(walk, spotAt(-3, GALLERY + FLOOR_SLACK + 0.2, 0)), null);
  // In the doorway is outside again: a step in, or nothing.
  const door = fits(walk, spotAt(0, FLOOR, 5.1));
  assert.ok(!door || door.at[1] <= DOORWAY.z - 0.3, `put down in the doorway at ${door && door.at}`);
  assert.equal(fits(walk, spotAt(8, FLOOR, 8)), null);
});

test('a spot taken since is left for the nearest place beside it', () => {
  const walk = room([{ x: -3, z: 0, r: 0.2 }]);   // a stool where you sat
  const back = fits(walk, spotAt(-3, FLOOR, 0));
  assert.ok(back, 'found nowhere to stand beside the stool');
  assert.ok(Math.hypot(back.at[0] + 3, back.at[1]) <= 0.71, `put down ${back.at} away from it`);
  assert.equal(back.y, FLOOR);
});

test('main.js forgets the room on every way out of it, and remembers it only for its own island', () => {
  const src = readFileSync(new URL('../web/js/main.js', import.meta.url), 'utf8');
  const body = (name) => {
    const at = src.indexOf(`function ${name}(`);
    assert.ok(at >= 0, name);
    return src.slice(at, src.indexOf('\n}\n', at));
  };
  assert.match(body('leaveInterior'), /forgetRoom\(\)/);
  assert.match(body('exitWalk'), /state\.inside = null;\s*forgetRoom\(\);/);
  assert.match(body('roomSpotKey'), /!state\.guest && !STANDALONE/);
  assert.match(body('recalledRoom'), /params\.has\('square'\)/);
  assert.match(body('enterWalk'), /enterInterior\(back\.spot\.room, back\.door, back\.spot\)/);
});
