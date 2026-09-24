// The bicycle (web/js/bicycle.js, Plans/fiets.md), and what it has to be to be worth riding.
//
// Three promises. It is a way to get somewhere: faster than a run, slower than a boat, and it
// brakes and freewheels like a bicycle rather than stopping like feet. It keeps to the feet's
// world: the water's edge is a wall, a solid is a wall you slide along, and a ledge above a
// step is a wall too. And the baked model is a bicycle that can move: every part is on its
// own axis, the tyres stand on the ground, and the rider has a saddle and a pair of grips.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import * as THREE from 'three';
register('./support/shared-loader.mjs', import.meta.url);

// bicycle.js reaches buildings.js for the parts, and buildings.js asks for its texture sheets
// the moment it loads - the stub tests/boat.test.mjs uses, for the same reason.
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const {
  stepBike, bikeAt, createBicycle, GEOMETRY, RIDER,
  BIKE_TOP, BIKE_TURBO, BIKE_REVERSE, BIKE_SHORE, BIKE_HOP, BIKE_GRAVITY,
} = await import('../web/js/bicycle.js');
const { BOAT_TOP } = await import('../web/js/boat.js');
const { BICYCLE } = await import('../web/js/bicycle-mesh.js');
delete globalThis.document;

// The feet's speeds, read out of walk.js rather than copied (tests/boat.test.mjs explains why).
const WALK_SOURCE = readFileSync(new URL('../web/js/walk.js', import.meta.url), 'utf8');
const feetSpeed = (name) => Number(WALK_SOURCE.match(new RegExp(`^const ${name} = ([0-9.]+);`, 'm'))[1]);
const WALK_SPEED = feetSpeed('WALK_SPEED');
const RUN_SPEED = feetSpeed('RUN_SPEED');

const FRAME = 1 / 60;
const MEADOW = () => 0.5;
function ride(b, input, seconds, world = { ground: MEADOW }, dt = FRAME) {
  for (let i = 0; i < Math.round(seconds / dt); i++) stepBike(b, input, dt, world);
  return b;
}
const bike = () => bikeAt(0, 0, 0, 0.5);

// ---- the way ------------------------------------------------------------------------

test('a bike beats a run, a boat beats the bike, and backing it up is slower than a walk', () => {
  assert.ok(BIKE_TOP > RUN_SPEED, `a bike at ${BIKE_TOP} is no faster than a run at ${RUN_SPEED}`);
  assert.ok(BIKE_TOP < BOAT_TOP, `a bike at ${BIKE_TOP} outruns the boat at ${BOAT_TOP}`);
  assert.ok(BIKE_REVERSE < WALK_SPEED);

  const b = ride(bike(), { pedal: 1 }, 5);
  assert.ok(Math.abs(b.v - BIKE_TOP) < 1e-9, `pedalling settled at ${b.v}`);
  assert.ok(b.z > RUN_SPEED * 4, 'five seconds on the pedals covered less than a run would');
  assert.ok(Math.abs(b.x) < 1e-9, 'riding straight drifted sideways');

  const back = ride(bike(), { pedal: -1 }, 3);
  assert.ok(Math.abs(back.v + BIKE_REVERSE) < 1e-9, `backing up settled at ${back.v}`);
  assert.ok(back.z < 0);
});

test('standing on the pedals lifts the top speed, and only `true` does', () => {
  const b = ride(bike(), { pedal: 1, turbo: true }, 6);
  assert.ok(Math.abs(b.v - BIKE_TOP * BIKE_TURBO) < 1e-9, `standing up settled at ${b.v}`);
  // Sitting back down freewheels to cruising speed rather than snapping to it.
  stepBike(b, { pedal: 1 }, FRAME, { ground: MEADOW });
  assert.ok(b.v > BIKE_TOP, 'sitting down braked to cruising speed in one frame');
  ride(b, { pedal: 1 }, 3);
  assert.equal(b.v, BIKE_TOP);
  assert.equal(ride(bike(), { pedal: 1, turbo: 1 }, 6).v, BIKE_TOP);
});

test('S is the brakes with way on, and letting go freewheels to a stop', () => {
  const braking = ride(bike(), { pedal: 1 }, 5);
  let t = 0;
  while (braking.v > 0 && t < 5) { stepBike(braking, { pedal: -1 }, FRAME, { ground: MEADOW }); t += FRAME; }
  assert.ok(t < 1, `braking from top speed took ${t.toFixed(2)} s`);
  assert.equal(braking.v, 0, 'the brakes stopped it and then did not go on into reverse in the same press');

  const coasting = ride(bike(), { pedal: 1 }, 5);
  let last = coasting.v;
  t = 0;
  while (coasting.v > 0 && t < 20) {
    stepBike(coasting, {}, FRAME, { ground: MEADOW });
    assert.ok(coasting.v <= last, 'a freewheeling bike sped up on the flat');
    last = coasting.v;
    t += FRAME;
  }
  assert.equal(coasting.v, 0, 'a freewheeling bike never came to rest');
  assert.ok(t > 3, `it freewheeled for only ${t.toFixed(1)} s`);
});

test('D turns right, which lowers yaw, and the bars and the lean go the same way', () => {
  const b = ride(bike(), { pedal: 1 }, 2);
  ride(b, { pedal: 1, turn: 1 }, 0.3);
  assert.ok(b.yaw < 0, `turning right raised yaw to ${b.yaw}`);
  assert.ok(b.steer > 0 && b.lean > 0, 'the bars or the lean went the wrong way');
  // Backwards, the bars steer the other way round.
  const back = ride(bike(), { pedal: -1 }, 2);
  ride(back, { pedal: -1, turn: 1 }, 0.3);
  assert.ok(back.yaw > 0);
});

test('a hill pulls: downhill it freewheels faster than on the flat, uphill slower', () => {
  const up = (x, z) => 0.5 + z * 0.3, down = (x, z) => 5 - z * 0.3;
  const flat = ride(bike(), {}, 2, { ground: MEADOW }, FRAME);
  const start = () => { const b = bikeAt(0, 0, 0, 0.5); b.v = 4; return b; };
  const onFlat = ride(start(), {}, 1).v;
  const climbing = start(); climbing.y = up(0, 0);
  const descending = start(); descending.y = down(0, 0);
  assert.ok(ride(climbing, {}, 1, { ground: up }).v < onFlat);
  assert.ok(ride(descending, {}, 1, { ground: down }).v > onFlat);
  assert.equal(flat.v, 0);
});

// ---- the feet's world -----------------------------------------------------------------

test('the water is a wall: the bike stops at the shore and never gets its wheels wet', () => {
  // Land up to z = 3, the sea after it.
  const coast = (x, z) => (z < 3 ? 0.4 : -1.2);
  const b = ride(bike(), { pedal: 1, turbo: true }, 4, { ground: coast });
  assert.ok(b.z < 3, `the bike rode into the sea to z = ${b.z}`);
  assert.ok(coast(b.x, b.z) >= BIKE_SHORE);
  assert.equal(b.v, 0, 'it is still trying to go somewhere');
});

test('a solid is slid along, and a head-on one stops it', () => {
  // A wall along x = 1, ridden at at an angle: the bike slides up it rather than stopping.
  const wall = { ground: MEADOW, blocked: (x) => x > 1 };
  const b = bikeAt(0, 0, 0.6, 0.5);
  ride(b, { pedal: 1 }, 3, wall);
  assert.ok(b.x <= 1 && b.z > 3, `slid to (${b.x.toFixed(2)}, ${b.z.toFixed(2)})`);
  // Straight into a wall across the road.
  const across = { ground: MEADOW, blocked: (x, z) => z > 2 };
  const c = ride(bike(), { pedal: 1 }, 3, across);
  assert.ok(c.z <= 2);
  // And a ledge taller than a step is as good as a wall.
  const ledge = { ground: (x, z) => (z > 2 ? 1.5 : 0.5) };
  const d = ride(bike(), { pedal: 1 }, 3, ledge);
  assert.ok(d.z <= 2 && d.y === 0.5, 'rode up a ledge');
});

test('it is a function of what it is handed: the same ride twice is the same ride, and junk is ignored', () => {
  const go = () => {
    const b = bike();
    for (let i = 0; i < 300; i++) stepBike(b, { pedal: 1, turn: Math.sin(i / 20) }, FRAME, { ground: (x, z) => 0.5 + Math.sin(x) * 0.1 });
    return b;
  };
  assert.deepEqual(go(), go());
  const b = bike();
  stepBike(b, { pedal: NaN, turn: 'left' }, FRAME, { ground: MEADOW });
  stepBike(b, { pedal: 1 }, NaN, { ground: MEADOW });
  stepBike(b, { pedal: 1 }, FRAME, {});
  assert.deepEqual(b, bike());
  // A tab back from the background hands over seconds; it is ridden in slices, not in one leap.
  const leap = bike();
  leap.v = BIKE_TOP;
  stepBike(leap, { pedal: 1 }, 3, { ground: MEADOW, blocked: (x, z) => z > 1 && z < 1.5 });
  assert.ok(leap.z < 1.5, 'one long frame jumped a wall');
});

// ---- the hop --------------------------------------------------------------------------

test('Space on the bike is the jump the feet make: as high, and back down on its tyres', () => {
  // Not a copy that can drift: walk.js's numbers, read out of its source.
  assert.equal(BIKE_HOP, feetSpeed('JUMP_V'));
  assert.equal(BIKE_GRAVITY, feetSpeed('GRAVITY'));
  const b = ride(bike(), { pedal: 1 }, 2);
  stepBike(b, { pedal: 1, hop: true }, FRAME, { ground: MEADOW });
  assert.ok(b.air && b.y > 0.5, 'the hop did not leave the ground');
  let top = b.y, t = 0;
  const v = b.v;
  while (b.air && t < 2) { stepBike(b, { pedal: 1 }, FRAME, { ground: MEADOW }); top = Math.max(top, b.y); t += FRAME; }
  // The feet's jump integrated the way walk.js integrates it, frame by frame - not the ideal
  // parabola, which is a couple of centimetres higher than either of them ever gets.
  let feet = 0, fvy = BIKE_HOP, peak = 0;
  while (fvy > 0 || feet > 0) { fvy -= BIKE_GRAVITY * FRAME; feet += fvy * FRAME; peak = Math.max(peak, feet); }
  assert.ok(Math.abs(top - 0.5 - peak) < 0.005, `it rose ${(top - 0.5).toFixed(3)}, the feet ${peak.toFixed(3)}`);
  assert.ok(!b.air && b.y === 0.5 && b.vy === 0, 'it did not land back on the meadow');
  assert.ok(Math.abs(b.v - v) < 1e-9 || b.v >= v, 'the pedals pushed or braked in the air');
  // A hop is a press: held, it does not bounce, and in the air a second press does nothing.
  stepBike(b, { hop: true }, FRAME, { ground: MEADOW });
  const vy = b.vy;
  stepBike(b, { hop: true }, FRAME, { ground: MEADOW });
  assert.ok(b.vy < vy, 'a press in the air hopped again');
});

test('a hop clears what a ride cannot: a kerb above a step, and a brook', () => {
  // A ledge 0.6 up at z = 2: ridden at, it is a wall; hopped at, it is somewhere to land.
  const kerb = { ground: (x, z) => (z > 2 ? 1.1 : 0.5) };
  const walled = ride(bike(), { pedal: 1 }, 3, kerb);
  assert.ok(walled.z <= 2);
  const hopper = bikeAt(0, 0.5, 0, 0.5);
  hopper.v = 5;
  stepBike(hopper, { pedal: 1, hop: true }, FRAME, kerb);
  ride(hopper, { pedal: 1 }, 1, kerb);
  assert.ok(hopper.z > 2 && hopper.y === 1.1 && !hopper.air, `hopped to z = ${hopper.z.toFixed(2)}, y = ${hopper.y}`);
  // A brook half a unit wide at z = 3: hopped at speed, the bike comes down on the far bank.
  const brook = { ground: (x, z) => (z > 3 && z < 3.5 ? -0.4 : 0.5) };
  const b = bikeAt(0, 1.5, 0, 0.5);
  b.v = BIKE_TOP;
  stepBike(b, { pedal: 1, hop: true }, FRAME, brook);
  ride(b, { pedal: 1 }, 1, brook);
  assert.ok(b.z > 3.5 && !b.splash, `came down at z = ${b.z.toFixed(2)}`);
});

test('coming down in the water ends the ride, and a deck overhead stops the hop', () => {
  const sea = { ground: (x, z) => (z > 2.3 ? -1.2 : 0.5) };
  const b = bikeAt(0, 1.5, 0, 0.5);
  b.v = BIKE_TOP;
  stepBike(b, { pedal: 1, hop: true }, FRAME, sea);
  ride(b, { pedal: 1 }, 2, sea);
  assert.ok(b.splash && b.v === 0, 'landed in the sea and rode on');
  const splashed = { ...b };
  stepBike(b, { pedal: 1, hop: true }, FRAME, sea);
  assert.deepEqual(b, splashed, 'a splashed bike still moved');
  // A lid 0.2 over the road: the hop rises that far and no further.
  const under = { ground: MEADOW, ceiling: () => 0.7 };
  const c = bike();
  stepBike(c, { hop: true }, FRAME, under);
  let top = 0;
  for (let i = 0; i < 60; i++) { stepBike(c, {}, FRAME, under); top = Math.max(top, c.y); }
  assert.ok(top <= 0.7 + 1e-9 && !c.air, `rose to ${top}`);
});

// ---- the model ------------------------------------------------------------------------

test('the baked bicycle is one hero set in seven moving parts, well under its budget', () => {
  const names = Object.keys(BICYCLE.parts);
  const base = [...new Set(names.map((n) => n.split(':')[0]))].sort();
  assert.deepEqual(base, ['bicycle crank', 'bicycle frame', 'bicycle pedal left', 'bicycle pedal right',
    'bicycle steer', 'bicycle wheel front', 'bicycle wheel rear']);
  const tris = Object.values(BICYCLE.parts).reduce((n, p) => n + p.positions.length / 9, 0);
  // Every riding peer draws one, so it keeps well under HERO_BUDGET (4000).
  assert.ok(tris <= 1600, `${tris} triangles`);
  assert.ok(GEOMETRY.baked);
});

test('every part turns about its own axis, and the tyres stand on the ground', () => {
  const G = GEOMETRY;
  // Both wheels on the ground, the same size, the front one ahead of the rear.
  assert.ok(Math.abs(G.rear[1] - G.tyre) < 1e-3 && Math.abs(G.front[1] - G.tyre) < 1e-3);
  assert.ok(G.front[2] > G.rear[2] + 0.25);
  // The steering axis is the head tube: it leans back from the front axle, not forward.
  assert.ok(G.steer[1] > G.front[1] && G.steer[2] < G.front[2]);
  // The pedals are half a turn apart about the crank axle, one on either side.
  const arm = (p) => [p[1] - G.crank[1], p[2] - G.crank[2]];
  const [ly, lz] = arm(G.pedalL), [ry, rz] = arm(G.pedalR);
  assert.ok(Math.abs(ly + ry) < 1e-6 && Math.abs(lz + rz) < 1e-6);
  assert.ok(G.pedalL[0] < 0 && G.pedalR[0] > 0);
  // The rider: a saddle over the bottom bracket's back, grips ahead of it and higher.
  assert.ok(RIDER.saddle[1] > G.crank[1] + 0.1 && RIDER.saddle[2] < G.crank[2]);
  assert.ok(RIDER.grip[2] > RIDER.saddle[2] && RIDER.grip[1] > RIDER.saddle[1]);
});

test('the mesh turns what it should and keeps its feet on the ground', () => {
  globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
  const scene = new THREE.Scene();
  const b = createBicycle({ scene, material: new THREE.MeshBasicMaterial() });
  delete globalThis.document;
  const box = () => new THREE.Box3().setFromObject(b.object, true);   // the vertices, not turned boxes
  b.place(0, 0, 0, 0);
  b.pose({});
  assert.ok(Math.abs(box().min.y) < 0.002, `standing at rest its lowest point is ${box().min.y}`);
  // Spun, steered and cranked, it is still standing on its tyres - nothing swings through the road.
  for (let a = 0; a < 6.3; a += 0.7) {
    b.pose({ wheel: a, crank: a, steer: 0.4 * Math.sin(a) });
    assert.ok(box().min.y > -0.004, `at ${a.toFixed(1)} a part dipped to ${box().min.y.toFixed(4)}`);
  }
  // A positive steer turns the front wheel to the right, which is -x.
  const front = b.object.children.find((c) => c.children.some((m) => m.isMesh) && c.children.some((m) => m.isGroup));
  b.pose({ steer: 0.5 });
  b.object.updateMatrixWorld(true);
  const ahead = new THREE.Vector3(0, 0, 1).applyQuaternion(front.quaternion);
  assert.ok(ahead.x < -0.2, `steering right pointed the wheel at x = ${ahead.x.toFixed(2)}`);
  b.dispose();
  assert.equal(scene.children.length, 0);
});
