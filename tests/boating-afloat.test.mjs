// A busier bay for a bigger village, and outings that sail round whatever stands on the water
// (Plans/mijlpalen-tot-tweehonderd.md: "De vloot" item 3, and "Botsen" under the VOC ship).
//
// The ship at anchor on the rede is a plot like any civic's - four cells wide and thirteen to
// fifteen long, lying in the water - and an outing is moved along its route rather than
// sailed, so nothing but the route would stop a dinghy going straight through her. What has
// to hold: a planned voyage keeps a cell clear of every plot on the water at every sample and
// never crosses one between samples; a ship across the bay changes the circle rather than
// ending the afternoon; and an island with nothing on its water plans the voyages it always
// did. And the cap: two outings, three from 140 settlers, four from 180, and never more.
//
// No loader and no document for the crowd half: the sea steps a crowd in Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../shared/rng.mjs';
import { planVoyage, openWater, waterPlots, outingsAtOnce, createBoating } from '../shared/boating.mjs';
import { createCrowd } from '../lib/crowd.mjs';
import { makeTerrain } from '../shared/terrain.mjs';
import { quayFor } from '../shared/quay.mjs';

// tests/boating.test.mjs's coast: land to the north of `shore`, open sea south of it.
function coast({ size = 96, shore = 30 } = {}) {
  const half = size / 2;
  return {
    size,
    half,
    isWater: (gx, gz) => gz > shore,
    cellWorld: (gx, gz) => [gx - half + 0.5, gz - half + 0.5],
  };
}
const cellOf = (t, x, z) => [Math.floor(x + t.half), Math.floor(z + t.half)];

test('outings at once: two, then one more for every forty settlers past a hundred, four at most', () => {
  assert.equal(outingsAtOnce(0), 2);
  assert.equal(outingsAtOnce(100), 2);
  assert.equal(outingsAtOnce(139), 2);
  assert.equal(outingsAtOnce(140), 3);
  assert.equal(outingsAtOnce(179), 3);
  assert.equal(outingsAtOnce(180), 4);
  assert.equal(outingsAtOnce(1000), 4);
  assert.equal(outingsAtOnce(undefined), 2, 'nobody counted is the quiet bay of old');
});

test('waterPlots holds the water under a plot and none of the land, w along x and d along z', () => {
  const t = coast({ shore: 30 });
  // A 4 by 15 plot, turned: rot 1 already carries its w and d swapped, so it is read as it is.
  const cells = waterPlots(t, [{ id: 'civic:ship', plot: { gx: 10, gz: 28, w: 4, d: 15, rot: 1 } }]);
  assert.equal(cells.size, 4 * 12, 'rows 28-30 are the beach and are left out');
  for (let gz = 31; gz <= 42; gz++) for (let gx = 10; gx <= 13; gx++) assert.ok(cells.has(gx + gz * t.size), `${gx},${gz}`);
  assert.ok(!cells.has(14 + 31 * t.size), 'four wide, no wider');
  assert.ok(!cells.has(10 + 30 * t.size), 'no land');
  // A plot off the edge of the grid names no other cell.
  assert.equal(waterPlots(t, [{ plot: { gx: 94, gz: 40, w: 4, d: 1, rot: 0 } }]).size, 2);
  assert.equal(waterPlots(t, [{ id: 'house:x' }, null]).size, 0, 'no plot, nothing');
});

test('openWater keeps a cell of margin round what stands on the water', () => {
  const t = coast({ shore: 30 });
  const cells = waterPlots(t, [{ plot: { gx: 40, gz: 40, w: 4, d: 4, rot: 0 } }]);
  const at = (gx, gz) => t.cellWorld(gx, gz);
  assert.equal(openWater(t, ...at(38, 38)), true, 'without the mask this is open sea');
  assert.equal(openWater(t, ...at(38, 38), cells), true, 'two cells off the plot is clear');
  assert.equal(openWater(t, ...at(39, 39), cells), false, 'a cell off it is not');
  assert.equal(openWater(t, ...at(41, 41), cells), false, 'and on it certainly not');
});

// The ship lies across the bay in front of the berth: fifteen cells along the coast, four
// deep, six cells out. A circle out of the berth either turns short of her or goes wide
// round her ends; plenty of the circles the rng picks do neither.
const SHIP = { gx: 41, gz: 40, w: 15, d: 4, rot: 0 };
const inShip = (gx, gz) => gx >= SHIP.gx && gx < SHIP.gx + SHIP.w && gz >= SHIP.gz && gz < SHIP.gz + SHIP.d;

// Every point the hull passes through on its way round, the legs between samples included,
// finely enough that a leg cannot step over a cell.
function sailed(start, points) {
  const out = [];
  let prev = start;
  for (const p of points) {
    const n = Math.ceil(Math.hypot(p[0] - prev[0], p[1] - prev[1]) / 0.1);
    for (let k = 0; k <= n; k++) out.push([prev[0] + ((p[0] - prev[0]) * k) / n, prev[1] + ((p[1] - prev[1]) * k) / n]);
    prev = p;
  }
  return out;
}

test('a voyage sails round a 4 by 15 plot lying in the water across its route', () => {
  const t = coast();
  const start = [0, 34 - t.half + 0.5];
  const cells = waterPlots(t, [{ id: 'civic:ship', plot: SHIP }]);
  assert.equal(cells.size, 60, 'the whole plot is on the water');

  let crossedBefore = 0, planned = 0;
  for (let seed = 0; seed < 200; seed++) {
    const bare = planVoyage(t, start, [0, 1], makeRng(`ship:${seed}`));
    if (bare && sailed(start, bare).some(([x, z]) => inShip(...cellOf(t, x, z)))) crossedBefore++;

    const round = planVoyage(t, start, [0, 1], makeRng(`ship:${seed}`), { blocked: cells });
    if (!round) continue;
    planned++;
    for (const [x, z] of round) {
      assert.equal(openWater(t, x, z, cells), true, `seed ${seed}: (${x.toFixed(2)}, ${z.toFixed(2)}) is within a cell of the ship`);
    }
    for (const [x, z] of sailed(start, round)) {
      assert.ok(!inShip(...cellOf(t, x, z)), `seed ${seed}: the leg through (${x.toFixed(2)}, ${z.toFixed(2)}) goes through the ship`);
    }
    const end = round[round.length - 1];
    assert.ok(Math.hypot(end[0] - start[0], end[1] - start[1]) < 1e-9, `seed ${seed} still comes home`);
  }
  // The test bites: without the mask a good share of these voyages went through her.
  assert.ok(crossedBefore > 20, `only ${crossedBefore} of 200 unmasked voyages crossed the plot`);
  // And a ship across the bay is a detour, not a harbour closed. Six cells off the berth
  // and fifteen wide she is in the way of every circle under a radius of about ten, so
  // about half the afternoons still sail (99 of 200, measured); the rest walk to the end of
  // the pier and home, which is what an outing with nowhere to go has always done.
  assert.ok(planned > 50, `only ${planned} of 200 voyages found a way round`);
});

test('nothing on the water, or an empty mask, plans exactly the voyages of old', () => {
  const t = coast();
  const start = [0, 34 - t.half + 0.5];
  // A house on the beach is a plot too, and is not on the water: the mask stays empty.
  const cells = waterPlots(t, [{ id: 'house:beach', plot: { gx: 47, gz: 29, w: 1, d: 1, rot: 0 } }]);
  assert.equal(cells.size, 0);
  for (let seed = 0; seed < 50; seed++) {
    assert.deepEqual(
      planVoyage(t, start, [0, 1], makeRng(`same:${seed}`), { blocked: cells }),
      planVoyage(t, start, [0, 1], makeRng(`same:${seed}`)),
      `seed ${seed}`,
    );
  }
});

// createBoating on its own, with a village that does whatever it is asked at once - so the
// only thing that decides how many are out is the cap.
function eagerVillage(n = 40) {
  const busy = new Set();
  const people = Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: `S${i}`, home: [0, -30] }));
  return {
    available: (k) => people.filter((p) => !busy.has(p.id)).slice(0, k),
    charter: (id) => { if (busy.has(id)) return false; busy.add(id); return true; },
    routeTo: () => [[0, -20]],
    sendOut: (id, route, done) => done(true),
    where: () => ({ x: 0, z: -14, y: 0.3 }),
    carry: () => {},
    release: (id) => busy.delete(id),
    has: () => true,
  };
}

function peakOut(opts) {
  const t = coast();
  const start = [0, 34 - t.half + 0.5];
  const dock = {
    cells: [[48, 31], [48, 32], [48, 33]], dir: [0, 1], berth: start, yaw: 0, shore: [48, 30], region: t,
  };
  let hulls = 0;
  const boating = createBoating({
    terrain: () => t,
    settlers: eagerVillage(),
    dock: () => dock,
    fleet: { take: () => ({ id: `h${hulls++}`, x: 0, z: 0, yaw: 0, deckY: 0.3 }), release: () => {}, bob: () => {} },
    rng: makeRng('busy bay'),
    eager: true,
    ...opts,
  });
  let peak = 0;
  for (let i = 0; i < 20000; i++) {
    boating.update(0.05, 0);
    peak = Math.max(peak, boating.rides().length);
  }
  return { peak, boating };
}

test('the cap is the cap: two by default, and up to four for a bigger village', () => {
  const quiet = peakOut({});
  assert.equal(quiet.boating.maxOut, 2);
  assert.equal(quiet.peak, 2, 'an eager bay of old fills its two and no more');
  const busy = peakOut({ maxOut: outingsAtOnce(180) });
  assert.equal(busy.boating.maxOut, 4);
  assert.ok(busy.peak > 2, `a village of 180 never had more than ${busy.peak} out`);
  assert.ok(busy.peak <= 4, `${busy.peak} out at once`);
});

// The crowd end to end: tests/crowd-boating.test.mjs's island, with a ship lying in the water
// beside the quay and across the circles its outings sail.
const SIZE = 64;
const SEED = 1337;

function bundle(terrain, { houses = 10, sheds = 0, ship = null } = {}) {
  const mid = Math.round(terrain.half);
  const lane = [];
  for (let gx = 8; gx < SIZE - 8; gx++) if (terrain.isLand(gx, mid)) lane.push([gx, mid]);
  const landing = lane[lane.length - 1];
  const land = terrain.landCells;
  const buildings = [
    ...Array.from({ length: houses }, (_, i) => {
      const [gx, gz] = i < 10 ? [lane[i][0], lane[i][1] + 1] : land[(i * 7) % land.length];
      return { id: `house:${String(i).padStart(4, '0')}`, kind: 'house', name: `House ${i}`, style: 'opus', plot: { gx, gz, w: 1, d: 1, rot: 0 } };
    }),
    ...Array.from({ length: sheds }, (_, i) => {
      const [gx, gz] = land[(i * 11 + 3) % land.length];
      return { id: `shed:${i}`, kind: 'shed', master: 'house:0000', style: 'opus', plot: { gx, gz, w: 1, d: 1, rot: 0 } };
    }),
  ];
  if (ship) buildings.push({ id: 'civic:ship', kind: 'civic', civicType: 'ship', plot: ship });
  return {
    island: { name: 'Testholm', seed: SEED, gridSize: SIZE, landing },
    buildings,
    paths: [{ id: 'lane', cells: lane }],
    town: { paved: lane.slice(0, 4) },
  };
}

test('the sea gives a bigger village a busier bay, counting settlers and not apprentices', () => {
  const terrain = makeTerrain(SEED, { size: SIZE });
  const crowd = (o) => createCrowd({ id: 'testholm', bundle: bundle(terrain, o), terrain });
  assert.equal(crowd({ houses: 10 }).outingCap, 2);
  assert.equal(crowd({ houses: 140 }).outingCap, 3);
  assert.equal(crowd({ houses: 180 }).outingCap, 4);
  assert.equal(crowd({ houses: 120, sheds: 80 }).outingCap, 2, 'two hundred walk, a hundred and twenty of them settlers');
});

test('the sea sails its outings round a ship lying at anchor off the quay', () => {
  const terrain = makeTerrain(SEED, { size: SIZE });
  const quay = quayFor(terrain, bundle(terrain).island.landing);
  assert.ok(quay, 'the fixture has no quay to sail from');
  // North of the berth and along the coast, across the bigger circles that turn that way.
  // Partly over the beach, which is how a ship's plot may lie; only its water is masked.
  const ship = { gx: 49, gz: 19, w: 15, d: 4, rot: 0 };
  const over = (r) => {
    const [gx, gz] = [Math.floor(r.x + terrain.half), Math.floor(r.z + terrain.half)];
    return gx >= ship.gx && gx < ship.gx + ship.w && gz >= ship.gz && gz < ship.gz + ship.d;
  };
  const sail = (withShip) => {
    const crowd = createCrowd({ id: 'testholm', bundle: bundle(terrain, { ship: withShip ? ship : null }), terrain });
    let rides = 0, through = 0;
    for (let i = 0; i < 60000; i++) {
      crowd.advance(1, 0);
      for (const r of crowd.rides()) { rides++; if (over(r)) through++; }
    }
    return { rides, through };
  };
  const before = sail(false);
  assert.ok(before.through > 0, 'the fixture bites: without the ship in the bundle, outings sail where she lies');
  const after = sail(true);
  assert.equal(after.through, 0, 'no hull passes over a cell of the ship');
  assert.ok(after.rides > 0, 'and the village still goes out on the water');
});
