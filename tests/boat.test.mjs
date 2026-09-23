// The boat, and the two promises it has to keep.
//
// The first is a comparison. tests/sea-gap.test.mjs proves the channel cannot be waded, so
// the boat is the only way across it - and a way across that is slower than running round
// your own island is a punishment rather than a journey. So the numbers in web/js/boat.js
// are only meaningful next to the ones the feet use, and those are read out of walk.js
// below rather than copied here: if RUN_SPEED is ever raised past the hull, this says so.
//
// The second is the inverse of walk.js:440. Feet refuse the water; the hull refuses the
// land, and it refuses it at the bow rather than at the waist. That is the assertion worth
// having a net under, because the failure is not a crash - it is a boat sitting on a hill,
// found by somebody sailing rather than by anything here.
//
// lib/boats.mjs is tested at the bottom, for the claiming rules: first hand on the tiller
// wins, and nobody else's message about that boat is read at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { createBoats, skiffOf } from '../lib/boats.mjs';
import * as THREE from 'three';
import { DRAUGHT, CABIN_FLOOR } from '../shared/hull.mjs';
register('./support/shared-loader.mjs', import.meta.url);

// boat.js reaches buildings.js for the hull, and buildings.js asks for its texture sheets
// the moment it loads. The same stub tests/paths.test.mjs uses, for the same reason.
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const {
  stepBoat, createBoat,
  BOAT_TOP, BOAT_REVERSE, BOAT_TURN, BOAT_TURN_MIN, BOW, DECK_Y,
} = await import('../web/js/boat.js');
delete globalThis.document;

// The speeds the feet move at, read out of walk.js rather than written down again. This is
// the one place a copy would be actively misleading - the whole claim being tested is a
// comparison with these - and walk.js itself cannot be imported here, because it pulls in
// three/addons and a GLTF loader to do it.
const WALK_SOURCE = readFileSync(new URL('../web/js/walk.js', import.meta.url), 'utf8');
function feetSpeed(name) {
  const m = WALK_SOURCE.match(new RegExp(`^const ${name} = ([0-9.]+);`, 'm'));
  if (!m) throw new Error(`walk.js no longer declares ${name} as a plain constant`);
  return Number(m[1]);
}
const WALK_SPEED = feetSpeed('WALK_SPEED');
const RUN_SPEED = feetSpeed('RUN_SPEED');
const SWIM_SPEED = feetSpeed('SWIM_SPEED');

const FRAME = 1 / 60;
const OPEN_SEA = () => -2.5;                                  // shared/regions.mjs's own number
const hull = (over = {}) => ({ x: 0, z: 0, yaw: 0, v: 0, ...over });
function sail(b, input, seconds, heightAt = OPEN_SEA, dt = FRAME) {
  for (let i = 0; i < Math.round(seconds / dt); i++) stepBoat(b, input, dt, heightAt);
  return b;
}

// ---- the way ------------------------------------------------------------------------

test('a boat beats a run, and astern does not beat a walk', () => {
  assert.ok(BOAT_TOP > RUN_SPEED, `a boat at ${BOAT_TOP} is no faster than a run at ${RUN_SPEED}`);
  assert.ok(BOAT_TOP > SWIM_SPEED * 4, `a boat at ${BOAT_TOP} barely beats a swim at ${SWIM_SPEED}`);

  // Not just the constant: the hull actually gets there, and stays there.
  const ahead = sail(hull(), { throttle: 1, turn: 0 }, 5);
  assert.ok(Math.abs(ahead.v - BOAT_TOP) < 1e-9, `full ahead settled at ${ahead.v}`);
  assert.ok(ahead.z > RUN_SPEED * 4, 'five seconds of full ahead covered less than a run would');

  // Astern is for pushing off a beach. The brief asked for it to be slower than a swim,
  // which BOAT_REVERSE (2.8) is not against SWIM_SPEED (1.9) - the two numbers it was
  // given cannot both be true. Kept as it was given and asserted against the claim that
  // does hold: you can walk faster than this boat goes backwards, so nobody will ever
  // cross the channel in reverse on purpose.
  const astern = sail(hull(), { throttle: -1, turn: 0 }, 6);
  assert.ok(Math.abs(astern.v + BOAT_REVERSE) < 1e-9, `full astern settled at ${astern.v}`);
  assert.ok(BOAT_REVERSE < WALK_SPEED, `backing up at ${BOAT_REVERSE} outpaces a walk at ${WALK_SPEED}`);
  assert.ok(BOAT_REVERSE < BOAT_TOP / 3, 'astern is not meaningfully slower than ahead');

  // And it takes a hull's time to get there rather than a pedal's.
  let t = 0;
  const b = hull();
  while (b.v < BOAT_TOP - 1e-9 && t < 10) { stepBoat(b, { throttle: 1, turn: 0 }, FRAME, OPEN_SEA); t += FRAME; }
  assert.ok(t > 1.5 && t < 2.5, `it took ${t.toFixed(2)} s to reach top speed, not about two`);
});

test('let go and it coasts to a stop, never speeding up on the way', () => {
  const b = sail(hull(), { throttle: 1, turn: 0 }, 5);
  let last = b.v, t = 0;
  while (b.v > 0 && t < 10) {
    stepBoat(b, { throttle: 0, turn: 0 }, FRAME, OPEN_SEA);
    assert.ok(b.v < last, `a coasting boat sped up: ${last} -> ${b.v}`);
    assert.ok(b.v >= 0, 'a coasting boat started going backwards');
    last = b.v;
    t += FRAME;
  }
  assert.equal(b.v, 0, 'a coasting boat never actually came to rest');
  assert.ok(t > 3 && t < 5, `it drifted for ${t.toFixed(1)} s, which is not about four`);
});

// ---- the shore ----------------------------------------------------------------------

test('the bow cannot climb onto land, at any angle or frame rate', () => {
  // Water everywhere, and a coast running north-south at x = 10.
  const coast = (x) => (x > 10 ? 1.0 : -2.5);
  // Head on, and every slant a keyboard can hold, ahead and astern. The astern runs face
  // the other way and back into the same coast, which is the case a hull tested at its
  // middle gets wrong first.
  const runs = [
    ...[0, 0.3, -0.3, 0.7, -0.7, 1.1, -1.1].map((off) => ({ yaw: Math.PI / 2 + off, throttle: 1 })),
    ...[0, 0.5, -0.5].map((off) => ({ yaw: -Math.PI / 2 + off, throttle: -1 })),
  ];
  for (const { yaw, throttle } of runs) {
    // 0.25 is a browser tab coming back to the front: a step that long, integrated whole,
    // would carry the bow two boat-lengths inland before anything looked at the ground.
    for (const dt of [FRAME, 0.25]) {
      const b = hull({ x: -5, yaw });
      let grounded = false;
      for (let i = 0; i < 1600; i++) {
        stepBoat(b, { throttle, turn: 0 }, dt, coast);
        const lead = b.x + Math.sin(b.yaw) * BOW * (b.v >= 0 ? 1 : -1);
        assert.ok(lead <= 10 + 1e-9, `the bow reached x=${lead.toFixed(3)} at yaw ${yaw.toFixed(2)}, dt ${dt}`);
        assert.ok(b.x < 10, `the hull is standing on the beach at x=${b.x.toFixed(3)}`);
        if (b.aground) grounded = true;
      }
      assert.ok(grounded, `yaw ${yaw.toFixed(2)} at dt ${dt} never reached the coast at all`);
      assert.equal(b.v, 0, 'a grounded hull kept its way');
      // Soft, not sticky: astern backs it straight off again.
      sail(b, { throttle: throttle > 0 ? -1 : 1, turn: 0 }, 1, coast, dt);
      assert.ok(!b.aground, 'a grounded boat could not back off the beach');
    }
  }
});

// ---- the tiller ---------------------------------------------------------------------

test('the rudder needs way: an oar at rest, the full rate at speed', () => {
  const rateAt = (v) => {
    const b = hull({ v });
    stepBoat(b, { throttle: 0, turn: 1 }, FRAME, OPEN_SEA);
    return Math.abs(b.yaw) / FRAME;
  };
  assert.ok(Math.abs(rateAt(0) - BOAT_TURN_MIN) < 1e-9, `at rest it turns at ${rateAt(0)}`);
  assert.ok(Math.abs(rateAt(BOAT_TOP) - BOAT_TURN) < 1e-9, `at speed it turns at ${rateAt(BOAT_TOP)}`);
  // It arrives at the full rate somewhere around walking pace and climbs all the way there,
  // so there is no speed at which the boat suddenly starts steering.
  let last = -1;
  for (const v of [0, 0.5, 1, 2, 3, 4]) {
    const r = rateAt(v);
    assert.ok(r > last, `the turn stopped tightening between ${v} and the speed below it`);
    last = r;
  }
  assert.ok(Math.abs(rateAt(4) - BOAT_TURN) < 1e-9, 'the rudder never reaches its full rate');
  // Starboard is a falling yaw - the island's convention, walk.js:615-617.
  const b = hull({ v: BOAT_TOP });
  stepBoat(b, { throttle: 0, turn: 1 }, FRAME, OPEN_SEA);
  assert.ok(b.yaw < 0, 'turning to starboard raised the yaw, which steers like a mirror');
});

test('a hard turn spends way, under power and while coasting', () => {
  const straight = sail(hull({ v: BOAT_TOP }), { throttle: 1, turn: 0 }, 2);
  const carving = sail(hull({ v: BOAT_TOP }), { throttle: 1, turn: 1 }, 2);
  assert.ok(carving.v < straight.v * 0.9,
    `full helm under full power cost ${(straight.v - carving.v).toFixed(2)} of ${straight.v.toFixed(2)}`);

  const drifting = sail(hull({ v: BOAT_TOP }), { throttle: 0, turn: 0 }, 1);
  const turning = sail(hull({ v: BOAT_TOP }), { throttle: 0, turn: 1 }, 1);
  assert.ok(turning.v < drifting.v, 'a coasting boat lost no way to the helm');
});

test('the same run twice is the same boat twice', () => {
  // A coast in two directions, so the run grounds and backs off as well as sailing.
  const land = (x, z) => (x > 12 || z < -8 ? 0.9 : -2.5);
  const run = () => {
    const b = hull();
    for (let i = 0; i < 900; i++) {
      const dt = [1 / 60, 1 / 50, 1 / 30, 0.2][i % 4];
      stepBoat(b, { throttle: i % 7 < 5 ? 1 : -1, turn: ((i % 5) - 2) / 2 }, dt, land);
    }
    return b;
  };
  assert.deepEqual(run(), run(), 'two identical runs ended in different places');
});

test('rubbish from the tiller is hands off, not a NaN in the hull', () => {
  const b = hull({ v: 4 });
  stepBoat(b, { throttle: NaN, turn: undefined }, FRAME, OPEN_SEA);
  assert.ok(Number.isFinite(b.x) && Number.isFinite(b.z) && Number.isFinite(b.v) && Number.isFinite(b.yaw));
  const still = hull({ v: 4 });
  assert.deepEqual(stepBoat(still, { throttle: 1, turn: 0 }, 0, OPEN_SEA), hull({ v: 4 }), 'a zero step moved the boat');
});

// ---- the mesh -----------------------------------------------------------------------

test('the rider stands on the baked cabin floor with room below its roof', () => {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const made = createBoat({ scene: { add() {}, remove() {} }, material });
  const origin = new THREE.Vector3(0, 0.5 - DRAUGHT, 0);
  const floor = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0)).intersectObject(made.object)[0];
  const roof = new THREE.Raycaster(origin, new THREE.Vector3(0, 1, 0)).intersectObject(made.object)[0];
  assert.ok(floor && roof, 'the cabin must have a floor and roof');
  assert.ok(Math.abs(floor.point.y + DRAUGHT - CABIN_FLOOR) < 0.002, 'rider feet must meet the floor');
  assert.ok(roof.point.y - floor.point.y >= 0.54 + 0.05, 'the rider needs headroom');
  made.dispose();
  material.dispose();
});

test('BOW is the hull it was measured from, and the boat is one draw call', () => {
  globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
  let held = [];
  const scene = { add(o) { held.push(o); }, remove(o) { held = held.filter((x) => x !== o); } };
  const made = createBoat({ scene, material: {} });
  assert.equal(held.length, 1, 'the boat was never put in the scene');
  assert.equal(made.object.geometry.groups.length, 0, 'a boat is one draw call');

  // The hull lies along z, which is the island's forward (assets/README.md: a model faces
  // +Z), so BOW is its half-length there. The x extent is the gunwale stripes and the sail.
  made.object.geometry.computeBoundingBox();
  const bb = made.object.geometry.boundingBox;
  assert.ok(Math.abs(bb.max.z - BOW) < 1e-5, `the bow is at ${bb.max.z}, BOW says ${BOW}`);
  assert.ok(Math.abs(bb.min.z + BOW) < 1e-5, `the stern is at ${bb.min.z}, BOW says ${-BOW}`);

  made.place(3, -4, 1.2);
  assert.equal(made.object.position.x, 3);
  assert.equal(made.object.position.z, -4);
  assert.equal(made.object.rotation.y, 1.2);

  made.bob(0);
  assert.equal(made.object.position.y, 0, 'the hull does not ride on the water plane');
  assert.equal(made.deck(), DECK_Y);
  assert.equal(made.object.rotation.y, 1.2, 'the swell threw away the heading');
  made.bob(1.1);
  assert.ok(Math.abs(made.object.position.y) < 0.06, 'that is a wave, not a swell');
  assert.ok(Math.abs(made.object.rotation.z) < 0.06, 'that is a capsize, not a roll');

  made.dispose();
  assert.equal(held.length, 0, 'the boat was left in the scene');
  delete globalThis.document;
});

// ---- who has the tiller -------------------------------------------------------------

const MOORINGS = [
  { id: 'boat:home-jetty', x: 12, z: -30, yaw: 0.5 },
  { id: 'boat:guest-jetty', x: 88, z: -30, yaw: -0.5 },
];
const ANN = 'a1b2c3d4e5f6';
const BEN = '0f0f0f0f0f0f';

test('first hand on the tiller wins, and the second is told whose it is', () => {
  const boats = createBoats({ moorings: MOORINGS });
  const first = boats.take('boat:home-jetty', ANN);
  assert.equal(first.pilot, ANN);
  assert.equal(first.x, 12, 'a boat nobody has touched is not at its mooring');

  const second = boats.take('boat:home-jetty', BEN);
  assert.equal(second.pilot, ANN, 'the second claimant took a boat somebody was sailing');

  // The other boat is nobody's, and taking one boat does not take the fleet.
  assert.equal(boats.take('boat:guest-jetty', BEN).pilot, BEN);
  assert.equal(boats.take('boat:nowhere', ANN), null, 'a boat with no mooring could be taken');
  assert.equal(boats.take('boat:home-jetty', 'not an id'), null);
  assert.equal(boats.take('../../etc/passwd', ANN), null);
});

test('only the pilot moves the boat, and dropping it remembers where', () => {
  const boats = createBoats({ moorings: MOORINGS });
  boats.take('boat:home-jetty', ANN);

  assert.equal(boats.moved('boat:home-jetty', BEN, 50, -30, 1), null, 'a passer-by moved somebody else\'s boat');
  assert.equal(boats.moved('boat:guest-jetty', ANN, 50, -30, 1), null, 'a boat nobody has taken was moved');
  assert.deepEqual(boats.moved('boat:home-jetty', ANN, 50, -30, 1), { id: 'boat:home-jetty', x: 50, z: -30, yaw: 1 });

  // Numbers that merely convert to numbers are not numbers. Without this a null or a
  // string moors the boat at the middle of the world.
  for (const bad of [null, '50', undefined, NaN, Infinity, {}]) {
    assert.equal(boats.moved('boat:home-jetty', ANN, bad, -30, 1), null, `${String(bad)} was taken for a position`);
  }
  assert.deepEqual(boats.snapshot().find((b) => b.id === 'boat:home-jetty'),
    { id: 'boat:home-jetty', x: 50, z: -30, yaw: 1, pilot: ANN });

  const moored = boats.drop('boat:home-jetty', ANN);
  assert.deepEqual(moored, { id: 'boat:home-jetty', x: 50, z: -30, yaw: 1, pilot: null });
  assert.equal(boats.drop('boat:home-jetty', ANN), null, 'a boat was dropped twice');
  // And it stays where it was left, for everybody.
  assert.deepEqual(boats.snapshot(), [{ id: 'boat:home-jetty', x: 50, z: -30, yaw: 1, pilot: null }]);
  assert.equal(boats.take('boat:home-jetty', BEN).x, 50, 'the next person found it back at its mooring');
});

test('a pilot who disappears leaves the boat where it floats', () => {
  const boats = createBoats({ moorings: MOORINGS });
  boats.take('boat:home-jetty', ANN);
  boats.moved('boat:home-jetty', ANN, 44, -31, 2);
  boats.take('boat:guest-jetty', BEN);

  assert.deepEqual(boats.release(ANN), [{ id: 'boat:home-jetty', x: 44, z: -31, yaw: 2, pilot: null }]);
  assert.deepEqual(boats.release(ANN), [], 'releasing twice freed something a second time');
  assert.deepEqual(boats.release(null), [], 'a nameless player freed a boat');
  assert.equal(boats.snapshot().find((b) => b.id === 'boat:guest-jetty').pilot, BEN, 'somebody else lost their boat');
  assert.equal(boats.take('boat:home-jetty', BEN).pilot, BEN, 'the abandoned boat could not be taken');
});

test('the fleet is the moorings, however hard the socket is poked', () => {
  const boats = createBoats({ moorings: MOORINGS });
  assert.equal(boats.count(), 0, 'an untouched fleet is carrying state around');
  for (let i = 0; i < 500; i++) {
    boats.take(`boat:ghost-${i}`, ANN);
    boats.take(MOORINGS[i % 2].id, ANN);
    boats.moved('boat:home-jetty', ANN, i, i, 0);
  }
  assert.ok(boats.count() <= MOORINGS.length, `${boats.count()} boats came out of ${MOORINGS.length} moorings`);

  boats.forget(['boat:home-jetty']);
  assert.equal(boats.count(), 1, 'a boat taken off the island kept its position');

  assert.throws(() => createBoats({ moorings: [{ id: 'jetty', x: 0, z: 0 }] }), /boat:/,
    'a mooring with a bad id was accepted and would refuse every message about it');
  assert.throws(() => createBoats({ moorings: [{ id: 'boat:a', x: '0', z: 0 }] }), /place/);
  assert.throws(() => createBoats({ moorings: [{ id: 'boat:a', x: 0, z: 0 }, { id: 'boat:a', x: 1, z: 1 }] }), /two moorings/);
});

// A skiff is the boat of somebody with no island (the app on a phone). It has no mooring,
// so it only exists because its owner launched it, only its owner may sail it, and it goes
// when they do - three rules, because each one missing leaves a hull nobody can fetch.
test('a skiff is launched by its owner, sailed by nobody else, and sinks when they leave', () => {
  const boats = createBoats({ moorings: MOORINGS });
  const id = skiffOf(ANN);
  assert.equal(boats.take(id, ANN), null, 'a skiff existed before anybody launched it');

  const put = boats.launch(ANN, 40, -12, 1);
  assert.deepEqual(put, { id, x: 40, z: -12, yaw: 1, pilot: ANN }, 'a launch did not hand its owner the tiller');
  assert.ok(boats.snapshot().some((b) => b.id === id), 'a late arrival would not be told about the skiff');
  assert.ok(boats.moved(id, ANN, 42, -12, 1), 'its owner could not row it');

  boats.drop(id, ANN);
  assert.equal(boats.take(id, BEN), null, "a stranger took somebody else's skiff");
  assert.equal(boats.take(skiffOf(BEN), BEN), null, 'a skiff appeared out of a take');
  assert.equal(boats.take(id, ANN).pilot, ANN, 'the owner could not get back into their own skiff');

  // The same boat again after a second launch - a page that reconnects - not a second one.
  const before = boats.count();
  boats.launch(ANN, 0, 0, 0);
  assert.equal(boats.count(), before);

  assert.deepEqual(boats.sink(ANN), [{ id, x: 0, z: 0, yaw: 0, pilot: null, gone: true }]);
  assert.equal(boats.count(), before - 1, 'a skiff outlived its owner');
  assert.deepEqual(boats.sink(ANN), [], 'a skiff sank twice');
  assert.equal(boats.launch('not an id', 0, 0, 0), null);
  assert.equal(boats.launch(BEN, Number.NaN, 0, 0), null, 'a skiff was launched nowhere');
});
