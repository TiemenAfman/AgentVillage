// The horse you ride (web/js/mount.js, Plans/paard-in-plaats-van-fiets.md): the Adventurer's
// ride, beside the Traveller's bicycle.
//
// The same three promises the bicycle makes (tests/bicycle.test.mjs), and three of a horse's own.
// It is a way to get somewhere: faster than any run, slower than a boat, and slower to get going
// and to stop than a bicycle. It keeps to the feet's world: deep water, a solid and a ledge are
// walls - and since a horse is long, its chest finds a wall before its middle does, and since a
// rider sits high, a low lid is a wall too. And its legs: the gait is a band of the speed with a
// margin, the cadence never runs away, and standing it is the stable's horse at its ease.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const M = await import('../web/js/mount.js');
const { saddleOf, createPose, stepPose } = await import('../web/js/fauna.js');
const { horsebackOf } = await import('../web/js/classic-avatar.js');
delete globalThis.document;
const {
  stepMount, mountAt, gaitOf, cadenceOf, mountPose, createRide, turnRate, GAITS, GAIT_EDGES, GAIT_MARGIN,
  MOUNT_TOP, MOUNT_GALLOP, MOUNT_REVERSE, MOUNT_HOP, MOUNT_GRAVITY, MOUNT_WADE, MOUNT_NOSE, MOUNT_TURN, MOUNT_TURN_FAST,
  MOUNT, MOUNT_SCALE, CADENCE_MAX,
} = M;

const WALK_SOURCE = readFileSync(new URL('../web/js/walk.js', import.meta.url), 'utf8');
const walkConst = (name) => Number(WALK_SOURCE.match(new RegExp(`^const ${name} = ([0-9.]+);`, 'm'))[1]);
const FRAME = 1 / 60;
const MEADOW = () => 0.5;
function ride(m, input, seconds, world = { ground: MEADOW }, dt = FRAME) {
  for (let i = 0; i < Math.round(seconds / dt); i++) stepMount(m, input, dt, world);
  return m;
}
const horse = () => mountAt(0, 0, 0, 0.5);

// ---- the way --------------------------------------------------------------------------------

test('normal reins select trot and sprint selects the faster gallop', () => {
  assert.deepEqual(GAITS, ['stand', 'trot', 'gallop']);
  assert.ok(MOUNT_TOP > 0 && MOUNT_TOP * MOUNT_GALLOP > MOUNT_TOP);
  const m = ride(horse(), { rein: 1 }, 6);
  assert.ok(Math.abs(m.v - MOUNT_TOP) < 1e-9, `the reins settled at ${m.v}`);
  assert.ok(Math.abs(m.x) < 1e-9);
  assert.ok(Math.abs(ride(horse(), { rein: 1, gallop: true }, 8).v - MOUNT_TOP * MOUNT_GALLOP) < 1e-9);
  const back = ride(horse(), { rein: -1 }, 3);
  assert.ok(Math.abs(back.v + MOUNT_REVERSE) < 1e-9 && back.z < 0);
});

test('acceleration and braking are gradual at the scale of the horse', () => {
  let t = 0;
  const m = horse();
  while (m.v < MOUNT_TOP * 0.95 && t < 10) { stepMount(m, { rein: 1 }, FRAME, { ground: MEADOW }); t += FRAME; }
  assert.ok(t > .9 && t < 1.4, `to cruising speed in ${t.toFixed(2)} s`);
  t = 0;
  while (m.v > 0 && t < 5) { stepMount(m, { rein: -1 }, FRAME, { ground: MEADOW }); t += FRAME; }
  assert.ok(t > .2 && t < .5, `reined in from the top in ${t.toFixed(2)} s`);
  assert.equal(m.v, 0, 'reining in did not go on into backing up in the same press');
});

test('a turn is tight at a walk and wide at a gallop', () => {
  assert.equal(turnRate(0), MOUNT_TURN);
  assert.equal(turnRate(MOUNT_TOP * MOUNT_GALLOP), MOUNT_TURN_FAST);
  let last = Infinity;
  for (let v = 0; v <= 11; v += 0.5) { const r = turnRate(v); assert.ok(r <= last + 1e-12); last = r; }
  // And a rein to one side turns right, lowering the yaw, as everything on the island does.
  const m = ride(horse(), { rein: 0.3, turn: 1 }, 0.5);
  assert.ok(m.yaw < 0);
});

// ---- the feet's world -----------------------------------------------------------------------

test('deep water is a wall, shallow water is not', () => {
  const shore = (x, z) => (z > 3 ? -0.6 : z > 1.5 ? -0.1 : 0.5);
  const m = ride(horse(), { rein: 1 }, 4, { ground: shore });
  assert.ok(m.z < 3, `rode into the sea to ${m.z}`);
  assert.ok(m.z > 1.5 + 0.5, `stopped short of the shallows at ${m.z}`);
  assert.ok(MOUNT_WADE < 0.3 && MOUNT_WADE > 0.1);
});

test('the chest meets a wall before the middle does', () => {
  const wall = (x, z) => z > 2;
  const m = ride(horse(), { rein: 1 }, 4, { ground: MEADOW, blocked: wall });
  assert.ok(m.z + MOUNT_NOSE <= 2.01, `the chest is at ${(m.z + MOUNT_NOSE).toFixed(3)}, the wall at 2`);
  assert.ok(m.z > 2 - MOUNT_NOSE - 0.2, `stopped well short, at ${m.z}`);
  // A glancing blow slides along it.
  const slant = mountAt(0, 0, 0.6, 0.5);
  ride(slant, { rein: 1 }, 6, { ground: MEADOW, blocked: wall });
  assert.ok(slant.x > 1, `slid along the wall to x ${slant.x}`);
  // And a ledge above a step is a wall.
  const ledge = ride(horse(), { rein: 1 }, 6, { ground: (x, z) => (z > 2 ? 1.2 : 0.5) });
  assert.ok(ledge.z < 2);
});

test('a lid with no room for the rider stops the horse, not only a jump', () => {
  // `ceiling` is walk.js's lid less a walker's head less MOUNT_HEAD: the highest the hooves may
  // stand. A deck that leaves a walker room but not a rider puts it under the meadow.
  const under = (x, z) => (z > 2 ? 0.5 - 0.1 : Infinity);
  const m = ride(horse(), { rein: 1 }, 6, { ground: MEADOW, ceiling: under });
  assert.ok(m.z + MOUNT_NOSE <= 2.01, `rode under it to ${m.z}`);
  const open = ride(horse(), { rein: 1 }, 6, { ground: MEADOW, ceiling: () => 2 });
  assert.ok(open.z > 3);
});

test('Space is a jump that clears a brook, and coming down in deep water ends the ride', () => {
  const m = horse();
  stepMount(m, { hop: true }, FRAME, { ground: MEADOW });
  let top = m.y;
  for (let i = 0; i < 120; i++) { stepMount(m, {}, FRAME, { ground: MEADOW }); top = Math.max(top, m.y); }
  const rise = MOUNT_HOP * MOUNT_HOP / (2 * MOUNT_GRAVITY);
  assert.ok(Math.abs(top - 0.5 - rise) < 0.03, `rose ${(top - 0.5).toFixed(3)} for ${rise.toFixed(3)}`);
  assert.ok(rise > walkConst('JUMP_V') ** 2 / (2 * walkConst('GRAVITY')), 'a horse jumps higher than the feet');
  assert.equal(m.air, false);

  const sea = mountAt(0, 0, 0, 0.5);
  const off = (x, z) => (z > 0.6 ? -0.8 : 0.5);
  ride(sea, { rein: 1 }, 1.5, { ground: off });
  assert.equal(sea.splash, false, 'the reins alone never go into the sea');
  stepMount(sea, { rein: 1, hop: true }, FRAME, { ground: off });
  sea.v = MOUNT_TOP;
  ride(sea, { rein: 1 }, 1, { ground: off });
  assert.equal(sea.splash, true, 'a jump off the bank into deep water should end in a splash');
});

// ---- the gaits ------------------------------------------------------------------------------

test('the gait climbs with the speed and holds within its margin', () => {
  let last = 0;
  for (let v = 0; v <= 11; v += 0.05) {
    const k = GAITS.indexOf(gaitOf(v));
    assert.ok(k >= last, `gait went down at ${v}`);
    last = k;
  }
  assert.equal(gaitOf(0), 'stand');
  assert.equal(gaitOf(.3), 'trot');
  assert.equal(gaitOf(MOUNT_TOP), 'trot', 'W alone is a trot');
  assert.equal(gaitOf(MOUNT_TOP * MOUNT_GALLOP), 'gallop', 'Shift is the gallop');
  for (let i = 1; i < GAIT_EDGES.length; i++) {
    const e = GAIT_EDGES[i];
    assert.equal(gaitOf(e + GAIT_MARGIN * 0.5, GAITS[i]), GAITS[i], `up over ${e} within the margin`);
    assert.equal(gaitOf(e - GAIT_MARGIN * 0.5, GAITS[i + 1]), GAITS[i + 1], `down under ${e} within the margin`);
    assert.equal(gaitOf(e + GAIT_MARGIN * 1.5, GAITS[i]), GAITS[i + 1]);
  }
  // A peer that sees the same speeds in the same order sees the same gaits.
  const seq = []; let a = null, b = null;
  for (let t = 0; t < 400; t++) {
    const v = 5 + 5 * Math.sin(t * 0.05);
    a = gaitOf(v, a); b = gaitOf(v, b); seq.push(a === b);
  }
  assert.ok(seq.every(Boolean));
});

test('the cadence never runs away, and the pose never goes NaN', () => {
  for (let v = 0; v <= 12; v += 0.1) {
    for (const g of GAITS) {
      const hz = cadenceOf(v, g);
      assert.ok(hz >= 0 && hz <= CADENCE_MAX && CADENCE_MAX <= 4, `${g} at ${v}: ${hz} Hz`);
    }
  }
  // Natural cycle frequencies at the two selected riding speeds.
  assert.equal(cadenceOf(MOUNT_TOP, 'trot'), 1.6);
  assert.ok(Math.abs(cadenceOf(MOUNT_TOP*MOUNT_GALLOP, 'gallop')-2.05)<1e-9);
  const r = createRide();
  for (let i = 0; i < 2000; i++) {
    const v = (i % 600) / 600 * MOUNT_TOP * MOUNT_GALLOP;
    mountPose(r, { speed: v, rate: Math.sin(i * 0.01), air: i % 300 < 20 }, FRAME);
    for (const n of [...r.pose.legs, r.pose.headX, r.pose.headY, r.pose.tailX, r.pose.tailZ, r.pose.bodyX, r.pose.bodyY, r.pose.bodyZ]) {
      assert.ok(Number.isFinite(n), `NaN at step ${i}`);
    }
    for (const l of r.pose.legs) assert.ok(Math.abs(l) < 1.2);
  }
});

test('the walk is four-beat and lateral, the trot diagonal', () => {
  // When each leg is furthest forward (it lands) over one stride.
  function landings(speed) {
    const r = createRide();
    for (let i = 0; i < 400; i++) mountPose(r, { speed }, FRAME);
    const prev = r.pose.legs.slice(), out = [null, null, null, null];
    const start = r.cycle;
    for (let i = 0; i < 200; i++) {
      mountPose(r, { speed }, FRAME);
      r.pose.legs.forEach((l, k) => { if (out[k] === null && prev[k] < l - 1e-6 && l > 0 && prev[k] <= 0 - 1e-6) out[k] = r.cycle; prev[k] = l; });
    }
    return { out, start };
  }
  // fl, fr, bl, br: in the walk the diagonals are a quarter apart, not together.
  const walk = M.PATTERN.walk.land, trot = M.PATTERN.trot.land;
  assert.notEqual(walk[0], walk[3]);
  assert.equal(trot[0], trot[3]);
  assert.equal(trot[1], trot[2]);
  // Lateral: each hind lands a quarter-stride (more or less) before the fore on its side.
  const quarter = (a, b) => { const d = ((a - b) % 1 + 1) % 1; return d > 0.2 && d < 0.35; };
  assert.ok(quarter(walk[0], walk[2]) && quarter(walk[1], walk[3]));
  assert.ok(landings(1).out.every((x) => x !== null), 'every leg swings at a walk');
});

test('standing, the horse is the stable\'s at its ease: it breathes, swishes and shifts its weight', () => {
  const r = createRide();
  const ys = [], tails = [], heads = [], hinds = [];
  for (let i = 0; i < 60 * 60; i++) {
    mountPose(r, { speed: 0 }, FRAME);
    ys.push(r.pose.bodyY); tails.push(r.pose.tailZ); heads.push(r.pose.headX); hinds.push(r.pose.legs[2] - r.pose.legs[3]);
  }
  const span = (a) => Math.max(...a) - Math.min(...a);
  assert.ok(span(ys) > 0.002 && span(ys) < 0.02, `breathing ${span(ys)}`);
  assert.ok(span(tails) > 0.2, `the tail swishes ${span(tails)}`);
  assert.ok(span(heads) > 0.1, `the head moves ${span(heads)}`);
  assert.ok(Math.max(...hinds) > 0.05 && Math.min(...hinds) < -0.05, 'the weight goes from one hind leg to the other');
  // And it is the stable's own pose: fauna.js's 'still', the same numbers.
  const still = createPose('horse');
  for (let i = 0; i < 600; i++) stepPose('horse', still, { act: 'still' }, FRAME);
  const again = createRide();
  for (let i = 0; i < 600; i++) mountPose(again, { speed: 0 }, FRAME);
  assert.ok(Math.abs(again.idle.headY - still.headY) < 1e-12 && Math.abs(again.idle.tailZ - still.tailZ) < 1e-12);
  // The tail goes on swishing at a walk.
  const walking = createRide(), sw = [];
  for (let i = 0; i < 1200; i++) { mountPose(walking, { speed: 1.2 }, FRAME); sw.push(walking.pose.tailZ); }
  assert.ok(span(sw.slice(600)) > 0.05);
});

// ---- the saddle -----------------------------------------------------------------------------

test('the seat and the irons come off the bake, inside the horse, and the Adventurer fits it at its size', () => {
  const s = saddleOf();
  assert.ok(MOUNT && s);
  assert.equal(MOUNT.seat, s.seat);
  assert.ok(MOUNT.seat > 0.4 && MOUNT.seat < 0.55);
  assert.ok(MOUNT.stirrup.y < MOUNT.seat && MOUNT.stirrup.y > 0.2);
  assert.ok(Math.abs(MOUNT.stirrup.z) < 0.15 && MOUNT.stirrup.x < 0.15);
  assert.equal(MOUNT_SCALE, 1, 'the keeper\'s choice: the horse at its own size');
  // The horse's size is MOUNT_SCALE alone since the pose stopped carrying one (`horse` left HORSEBACK_OF
  // when only the Adventurer came to ride); the Adventurer's numbers are his own.
  assert.notEqual(horsebackOf('adventurer'), horsebackOf('traveller'), 'the Adventurer is the rider who fits it');
});

test('walk mode rides a horse for the Adventurer and the bicycle for the Traveller', () => {
  assert.match(WALK_SOURCE, /character === 'adventurer' \? 'horse' : 'bike'/);
  // And the lid a rider needs is a rider's: MOUNT_HEAD in the horse's branch.
  assert.match(WALK_SOURCE, /ceilingAt\(x, z, m\.floor\) - HEAD - MOUNT_HEAD/);
});
