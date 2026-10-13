// A rope ladder at a port in the bulwark, and the follow camera in a cabin under the poop
// (Plans/nieuwe-sloep.md, chip 2b): what the sloop's two entrances and her open stern cabin need of
// the climb, the landing and the camera before her bake exists, held on a synthetic craft - the
// galleon's own hull and walk map with a ladder given a `port`, and a walk map of two plates for the
// cabin - so that chip 4 can measure the real ship against the same rules.
//
//   - shared/deck.mjs ladderPath: with `port` three points, straight in at the deck's level; without
//     it the four of old, to the byte.
//   - the climb ends exactly where walk.js lands (ladder-way.js ladderLanding, one sum for startClimb,
//     hoistOnto and what another page reads off a climber: ladderAt), and never rises over a rail.
//   - boat.js ladderBoxes: the ropes end at the deck's level and lie flat inside the sill.
//   - a craft's `near` is how far from her middle a ladder is looked for.
//   - in a cabin under a deck the camera sweeps a full turn under the deck's underside, with no jump,
//     and only because the walk map says there is a lid (ceilingIn): blind to it, the camera is lifted
//     up through the poop deck, which is what tests/camera-boom.test.mjs's sweep never saw on the galleon.
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
const { SHIP_SURFACE, ladderBoxes } = await import('../web/js/boat.js');
const { CRAFTS, SHIP_DRAUGHT } = await import('../shared/crafts.mjs');
const { ladderPath, deckAt, RUNG_STEP, RUNG_R } = await import('../shared/deck.mjs');
const { createSurface } = await import('../shared/hullwalk.mjs');
const { ladderLanding } = await import('../web/js/ladder-way.js');
const { DECK_Y } = await import('../shared/hull.mjs');
const { DEFAULT_AVATAR } = await import('../web/js/avatar.js');
const { setCameraFixed } = await import('../web/js/camera-prefs.js');
const { layer } = await import('../scripts/build-shipwalk.mjs');

const FRAME = 1 / 60;
const G = CRAFTS.galleon;
const SEA = (-0.07) - DECK_Y;     // where a swimmer's feet are, as walk.js hands ladderPath (WATER_Y - SWIM_SINK)

// The galleon's starboard ladder hung at a port instead: to the deck's level, landing just inside the
// sill, at the edge of her deck's rectangle (a port's `land` is the step-off point of its climb anchor,
// chip 2a; the galleon's own lies a unit in, clear of her rail, which a port has no need of).
const OLD = G.ladders.find((q) => q.x > 0);
const LAND = Object.freeze([1.7, OLD.z]);
const PORT = Object.freeze({ ...OLD, land: LAND, top: deckAt(G, LAND[0], LAND[1]), port: 0.3 });
const SHIP_PORT = Object.freeze({ ...G, ladders: Object.freeze([PORT, G.ladders.find((q) => q.x < 0)]) });

test('ladderPath: with a port three points straight in at deck level, without one the way of old', () => {
  const p = ladderPath(SHIP_PORT, PORT, SEA);
  assert.equal(p.length, 3);
  const out = Math.abs(PORT.x) + 0.16;
  assert.deepEqual(p[0], { x: out, z: PORT.z, y: SEA });
  assert.deepEqual(p[1], { x: out, z: PORT.z, y: PORT.top });
  assert.deepEqual(p[2], { x: PORT.land[0], z: PORT.land[1], y: PORT.top });
  assert.equal(p[1].y, p[2].y, 'the step over the sill is level: in at the deck, not over a rail');
  // and without a port, the four points the galleon has always been climbed by
  const q = ladderPath(G, OLD, SEA);
  assert.deepEqual(q, [
    { x: out, z: OLD.z, y: SEA },
    { x: out, z: OLD.z, y: OLD.top },
    { x: Math.abs(OLD.x) - 0.42, z: OLD.z, y: OLD.top + 0.06 },
    { x: OLD.land[0], z: OLD.land[1], y: deckAt(G, OLD.land[0], OLD.land[1]) },
  ]);
});

test('ladderBoxes: at a port the ropes end at the deck, the belay lies flat inside the sill, the rungs stop under it', () => {
  const boxes = ladderBoxes({ ladders: [PORT] }).map((g) => { g.computeBoundingBox(); return g.boundingBox; });
  const top = DECK_Y + PORT.top;
  const ropes = boxes.filter((b) => b.max.y - b.min.y > 1);
  assert.equal(ropes.length, 2);
  for (const r of ropes) assert.ok(Math.abs(r.max.y - top) < 1e-6, `a rope ends ${r.max.y - top} off the deck's level`);
  assert.ok(boxes.every((b) => b.max.y <= top + 0.03 + 1e-9), 'nothing of the ladder stands up over the deck');
  const belays = boxes.filter((b) => b.max.x - b.min.x > 0.2 && b.max.y - b.min.y < 0.03);
  assert.equal(belays.length, 2);
  for (const b of belays) {
    assert.ok(Math.abs(b.min.y - top) < 1e-6, 'the belay lies on the planks');
    assert.ok(Math.abs(b.min.x - (Math.abs(PORT.x) - 0.3)) < 1e-6, `the belay runs to ${b.min.x}, the sill's inside is at ${Math.abs(PORT.x) - 0.3}`);
  }
  const rungs = boxes.filter((b) => b.max.y - b.min.y < 3 * RUNG_R && b.max.z - b.min.z > PORT.hw);
  assert.ok(rungs.length > 20);
  for (const r of rungs) assert.ok(r.max.y < top - 0.06 + 1e-9, 'a rung within 0.06 of the deck');
  const foot = DECK_Y + PORT.foot;
  for (const r of rungs) {
    const k = ((r.min.y + r.max.y) / 2 - foot) / RUNG_STEP;
    assert.ok(Math.abs(k - Math.round(k)) < 1e-6, 'a rung off the climb\'s step');
  }
});

// Walk mode in open water beside a ship lying at the origin, bow north.
function afloat(ship, look = { ...DEFAULT_AVATAR, character: 'adventurer' }, at = [3.2, 1.85]) {
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
    at, blockers: [], interactables: [], onLeftDeck: noop,
    onBoarded: noop, onInteract: noop, onSendAway: noop, onPlant: noop, onNextSeed: noop, onPrevSeed: noop,
    onBuild: noop, onAvatar: noop, onExit: noop, onRelease: noop, onToggleMinimap: noop, onGive: noop,
  });
  walk.setBoats(() => [ship]);
  // `at` is a cell of the island; the water beside her is a place of the scene, so the feet are put there
  walk.state.pos.set(at[0], walk.state.pos.y, at[1]);
  return { walk, camera };
}
const shipOf = (spec, walkMap = SHIP_SURFACE) => ({ id: 'boat:abcd1234', x: 0, z: 0, yaw: 0, v: 0, craft: { spec, object: null, walk: walkMap } });
// Hold W along a way for at most `seconds`, taking a record each frame, until `stop`.
function along(walk, way, seconds, take, stop = () => false) {
  const s = walk.state;
  s.camYaw = Math.atan2(way[0], way[1]);
  key('w', true);
  for (let i = 0; i < seconds / FRAME; i++) {
    walk.update(FRAME);
    take(s);
    if (stop(s)) break;
  }
  key('w', false);
}

for (const body of ['adventurer', 'traveller']) {
  test(`the ${body} climbs in through the port and ends exactly where the ladder lands, never over a rail, seen the same by another page`, () => {
    const ship = shipOf(SHIP_PORT);
    const { walk } = afloat(ship, { ...DEFAULT_AVATAR, character: body });
    const s = walk.state;
    for (let i = 0; i < 30; i++) walk.update(FRAME);
    assert.ok(s.swimming, 'not in the water beside her');
    const frames = [];
    let prev = s.pos.clone();
    along(walk, [-1, 0], 25, () => {
      const seen = walk.ladderAt(s.pos.x, s.pos.y, s.pos.z);
      frames.push({ y: s.pos.y, step: s.pos.distanceTo(prev), climbing: !!s.climbing, top: s.climbing ? s.climbing.top : null, seen: seen && seen.top != null ? seen.top : null, deck: !!s.deck });
      prev = s.pos.clone();
    }, () => s.deck && !s.climbing);
    assert.ok(s.deck && !s.climbing, 'not on her deck');
    assert.ok(frames.some((f) => f.climbing), 'never on the rungs');
    // where the ladder lands: the one sum, the same as ladderUp's end
    const land = ladderLanding(SHIP_SURFACE, SHIP_PORT, PORT);
    assert.ok(Math.hypot(s.deck.x - land.x, s.deck.z - land.z) < 1e-6 && Math.abs(s.deck.y - land.y) < 1e-6,
      `landed at (${s.deck.x}, ${s.deck.z}, ${s.deck.y}), the landing is (${land.x}, ${land.z}, ${land.y})`);
    assert.ok(Math.abs(land.y - PORT.top) < 0.02, 'the landing is the deck at the port');
    // never over a bulwark: the feet never higher than the landing plus a hair (the clip's own last
    // rows), nowhere near the rail the galleon's own ladder goes over
    const highest = Math.max(...frames.map((f) => f.y));
    assert.ok(highest <= DECK_Y + land.y + 0.03, `the feet rose to ${(highest - DECK_Y).toFixed(3)} above DECK_Y, the landing is at ${land.y}`);
    assert.ok(highest < DECK_Y + OLD.top - 0.1, 'the feet went up towards the rail');
    // the step over the sill is played, and another page reads the same moment off the position alone
    const over = frames.filter((f) => f.top != null && f.top > 0.02 && f.top < 0.98);
    assert.ok(over.length > 10, `over the sill by the clip (${over.length} frames)`);
    assert.ok(over.every((f) => f.seen != null && Math.abs(f.seen - f.top) < 0.05), 'seen over the sill as it is, by another page');
    // and no jump, on the rungs, over the sill or onto the deck
    const jump = Math.max(...frames.map((f) => f.step));
    assert.ok(jump <= 0.06, `the feet moved ${jump.toFixed(3)} in one frame`);
  });
}

test('a craft\'s `near` is how far from her middle a ladder is looked for', () => {
  const far = { ...SHIP_PORT, near: 1 };
  const { walk } = afloat(shipOf(far));
  const on = ladderPath(far, PORT, SEA);
  const mid = { x: on[0].x, z: on[0].z, y: (on[0].y + on[1].y) / 2 + DECK_Y };
  assert.equal(walk.ladderAt(mid.x, mid.y, mid.z), null, 'a ladder 2.6 from her middle is not looked for within 1');
  const { walk: near } = afloat(shipOf(SHIP_PORT));
  assert.ok(near.ladderAt(mid.x, mid.y, mid.z), 'within the default 7 it is');
});

// ---- the camera in a cabin under the poop ------------------------------------------------------

// A walk map of plates, cut like the ship's (scripts/build-shipwalk.mjs layer): a main deck, a poop
// deck over its after part with a cabin under it - CLEAR of headroom, over the 0.75 the sloop's plan
// asks - and a floor to stand the helm on. Heights in the hull's frame above DECK_Y; the cutter takes
// them lifted by her draught and DECK_Y, as the bake has them.
// On the cutter's 2 cm steps, so the map holds them as they are.
const DECK = 1.0, CLEAR = 0.8, PLATE = 0.04;
const CABIN = { z0: -6, z1: -2.5 };
function plate(pos, x0, x1, z0, z1, y) {
  const lift = SHIP_DRAUGHT + DECK_Y, h = y + lift;
  pos.push(x0, h, z0, x1, h, z0, x1, h, z1, x0, h, z0, x1, h, z1, x0, h, z1);
}
function cabinMap() {
  const pos = [];
  plate(pos, -1.6, 1.6, -6, 6, DECK);
  plate(pos, -1.6, 1.6, CABIN.z0, CABIN.z1, DECK + CLEAR);            // the poop's underside, the cabin's lid
  plate(pos, -1.6, 1.6, CABIN.z0, CABIN.z1, DECK + CLEAR + PLATE);    // and its planks
  const g = { cell: 0.05, x0: -1.7, z0: -6.2, nx: 68, nz: 248, y0: 0.7, q: 0.02, top: 2.6 };
  return layer(pos, g);
}
const CABIN_SPEC = Object.freeze({ ...G, deck: Object.freeze([Object.freeze({ x: 0, z: 0, hx: 1.6, hz: 6, y: DECK })]), rails: Object.freeze([]), ladders: Object.freeze([]), aloft: Object.freeze([]), mounts: Object.freeze([]), helm: Object.freeze([0, -4]) });

function inCabin(walkMap) {
  const ship = shipOf(CABIN_SPEC, walkMap);
  const { walk, camera } = afloat(ship, undefined, [0, -40]);
  walk.board(ship);
  assert.ok(walk.leaveHelm(), 'could not step off the helm');
  const s = walk.state;
  Object.assign(s.deck, { x: 0, z: -4.25, y: DECK, vy: 0, grounded: true, yaw: 0 });
  for (let i = 0; i < 10; i++) walk.update(FRAME);
  assert.ok(Math.abs(s.deck.y - DECK) < 1e-6 && Math.abs(s.deck.z + 4.25) < 1e-6, 'not standing in the cabin');
  return { walk, camera };
}
// A full turn a degree a frame (tests/camera-boom.test.mjs sweep): the highest the camera came, and
// the worst jump beyond what the turn itself moved it.
function sweep(walk, camera, pitch) {
  const s = walk.state;
  s.camYaw = 0; s.camPitch = pitch;
  for (let i = 0; i < 20; i++) walk.update(FRAME);
  const prev = camera.position.clone();
  let highest = -Infinity, worst = 0, at = null;
  for (let i = 0; i < 360; i++) {
    s.camYaw = (i * Math.PI) / 180;
    walk.update(FRAME);
    highest = Math.max(highest, camera.position.y);
    const turn = (Math.PI / 180) * Math.hypot(camera.position.x - s.pos.x, camera.position.z - s.pos.z);
    const jolt = camera.position.distanceTo(prev) - turn;
    if (jolt > worst) { worst = jolt; at = i; }
    prev.copy(camera.position);
  }
  return { highest, worst, at };
}

test('in a cabin under the poop the camera stays under the deck through a full turn, with no jump', () => {
  setCameraFixed(false);
  try {
    const surface = createSurface(cabinMap());
    assert.equal(surface.ceilingIn(0, -4.25, DECK + 0.5), DECK + CLEAR, 'the map has the cabin\'s lid');
    assert.equal(surface.ceilingIn(0, 0, DECK + 0.5), null, 'and none over the waist');
    const lid = DECK_Y + DECK + CLEAR;
    for (const pitch of [0.28, 0.8]) {
      const { walk, camera } = inCabin(surface);
      const { highest, worst, at } = sweep(walk, camera, pitch);
      assert.ok(highest <= lid, `at pitch ${pitch} the camera rose to ${(highest - lid).toFixed(3)} over the deck's underside`);
      assert.ok(worst <= 0.06, `at pitch ${pitch} the camera jumped ${worst.toFixed(3)} beyond the turn at ${at} degrees`);
    }
    // Blind to the lid (a map without ceilingIn, as a sea-side reader would be) the poop deck is a floor
    // under the camera and it is lifted up through it: the lid is what keeps it down.
    const blind = { ...surface, ceilingIn: null };
    const { walk, camera } = inCabin(blind);
    const { highest } = sweep(walk, camera, 0.28);
    assert.ok(highest > lid, `without the lid the camera still stayed under the deck (${(highest - lid).toFixed(3)})`);
  } finally {
    setCameraFixed(true);
  }
});
