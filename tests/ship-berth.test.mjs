// Where the galleon lies, now that two machines have to agree about it.
//
// `shipBerth` moved out of web/js/main.js into shared/quay.mjs because lib/layout.mjs keeps
// the rede - the VOC ships' anchorage, Plans/DONE/mijlpalen-tot-tweehonderd.md - clear of her and
// of the room she turns in. The move promised the page no change at all, and that is what is
// held here: the function as it stood in main.js is copied below, word for word but for its
// `state.sea.height` becoming an argument, and the two are asked about every mooring several
// islands have and a spread of spots along their coasts that sends the search out to sea.
//
// The copy calls Math.sin and Math.cos; the shared one may not (shared/'s rule, the top of
// shared/rng.mjs) and reads literals instead. So the literals are held to the two functions
// first, bit for bit - which is only a promise about V8, the engine both Node and every
// Chromium page run, and that is the promise the page and the scanner need.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTerrain } from '../shared/terrain.mjs';
import { placeIsland } from '../shared/regions.mjs';
import { CRAFTS } from '../shared/crafts.mjs';
import { shipBerth, shipWater, shipWaterOf, SHIP_WATER, SHIP_TRIG, mooringsFor } from '../shared/quay.mjs';
import { emptyLayout, placeAll } from '../lib/layout.mjs';

// web/js/main.js, as it was on 28 September 2026 before the move.
function pageShipBerth(m, height) {
  const probes = CRAFTS.galleon.sail.probes;
  const pts = [[0, 0], ...probes, ...probes.map(([x, z]) => [x, -z])];
  const fx = Math.sin(m.yaw), fz = Math.cos(m.yaw);
  const clear = (x, z) => pts.every(([px, pz]) => height(x + px * fz + pz * fx, z - px * fx + pz * fz) < -0.3);
  if (clear(m.x, m.z)) return m;
  for (let d = 1; d <= 40; d += 1) {
    for (let k = 0; k < 16; k++) {
      const a = (k * Math.PI) / 8;
      const x = m.x + Math.sin(a) * d, z = m.z + Math.cos(a) * d;
      if (clear(x, z)) return { x, z };
    }
  }
  return m;
}

const YAWS = [0, 1.5707963267948966, -1.5707963267948966, 3.141592653589793];

test('the literals are the doubles Math.sin and Math.cos hand back', () => {
  assert.equal(SHIP_WATER, -0.3);
  assert.deepEqual(SHIP_TRIG.HEADINGS.map(([yaw]) => yaw), YAWS, 'the four yaws of shared/quay.mjs SEAWARD');
  for (const [yaw, [s, c]] of SHIP_TRIG.HEADINGS) {
    assert.ok(Object.is(s, Math.sin(yaw)) && Object.is(c, Math.cos(yaw)), `yaw ${yaw}`);
  }
  assert.equal(SHIP_TRIG.BEARINGS.length, 16);
  SHIP_TRIG.BEARINGS.forEach(([s, c], k) => {
    const a = (k * Math.PI) / 8;
    assert.ok(Object.is(s, Math.sin(a)) && Object.is(c, Math.cos(a)), `bearing ${k}`);
  });
});

// A few islands with harbours on them, so the moorings are the ones a page is handed.
const ISLANDS = [{ seed: 5, size: 128 }, { seed: 2024, size: 128 }, { seed: 1337, size: 128 }, { seed: 1337, size: 256 }];
function island({ seed, size }) {
  const t0 = Date.UTC(2026, 0, 1);
  const n = 12;
  const village = {
    districts: [{ id: 'p:demo', kind: 'project', name: 'Demo', population: n, firstSeenAt: t0 }],
    buildings: Array.from({ length: n }, (_, i) => ({ id: `house:d-${i}`, sessionId: `d-${i}`, kind: 'house', district: 'p:demo', harbour: false, tier: 'hut', startedAt: t0 + i * 1000 })),
    milestones: [], furniture: [], stats: { settlers: n },
  };
  const layout = emptyLayout(seed, size);
  placeAll(layout, village, { seed, size });
  const terrain = makeTerrain(seed, { size, polders: layout.polders, fairway: layout.fairway, works: layout.works || null, grow: layout.grow });
  const view = { island: { landing: layout.landing, harbours: (layout.harbours || []).filter(Boolean).map((h) => ({ side: h.side, shore: h.shore, pier: h.pier, boats: 3 })) }, districts: [] };
  return { terrain, moorings: mooringsFor('x', terrain, view) };
}

for (const spec of ISLANDS) {
  test(`seed ${spec.seed} on ${spec.size}: the galleon lies where the page always laid her`, () => {
    const { terrain, moorings } = island(spec);
    const height = placeIsland(terrain).worldHeight;
    assert.ok(moorings.length, 'the island has moorings');
    let moved = 0;
    const asked = [...moorings];
    // Along the whole coast, with each of the four headings, so the search runs its rings.
    terrain.coastCells.forEach(([gx, gz], i) => {
      if (i % 23) return;
      const [x, z] = terrain.cellWorld(gx, gz);
      for (const yaw of YAWS) asked.push({ x, z, yaw });
    });
    for (const m of asked) {
      const ours = shipBerth(m, height);
      const theirs = pageShipBerth(m, height);
      assert.deepEqual(ours, theirs, `from ${m.x},${m.z} at ${m.yaw}`);
      if (ours !== m) moved++;
    }
    assert.ok(moved > 0, 'some of them were moved out to sea, so the search was measured and not only the first test');
  });
}

test('a heading that is not a mooring\'s is handed back untouched', () => {
  const { terrain } = island(ISLANDS[0]);
  const m = { x: 0, z: 0, yaw: 0.3 };
  assert.equal(shipBerth(m, placeIsland(terrain).worldHeight), m);
});

// ---- the big ships' water (fase 3 of Plans/quay-en-rivier.md) ------------------------------
// On an island with a stone quay the galleon lies in `shipWater`: the pirates' half of the
// harbour funnel, off the channel's lane, past the quay's end. The sixteen rays do not find a
// strip that narrow, so she is laid on the middle of the nearest cell whose every hull point
// floats and is allowed - whole numbers from the mooring's own cell, so a page that draws the
// island at another origin lays her in the same cell to the bit.
test('with no ships\' water she lies exactly where she always did', () => {
  const { terrain, moorings } = island(ISLANDS[0]);
  const height = placeIsland(terrain).worldHeight;
  for (const m of moorings) assert.deepEqual(shipBerth(m, height, null), shipBerth(m, height));
  assert.equal(shipWater(null, terrain.half), null);
  assert.equal(shipWater({ v: 1, haven: { top: [1, 1], dir: [0, 64], w0: 1.5, open: 0.25, max: 6, from: 0 } }, terrain.half), null, 'a funnel and no quay: no ships\' water');
});

test('in the ships\' water she lies in the nearest cell that takes all of her, on every page alike', () => {
  const { terrain, moorings } = island(ISLANDS[0]);
  const height = placeIsland(terrain).worldHeight;
  const half = terrain.half;
  const PTS = [[0, 0], ...CRAFTS.galleon.sail.probes, ...CRAFTS.galleon.sail.probes.map(([x, z]) => [x, -z])];
  let placed = 0;
  for (const m of moorings) {
    // A strip of the sea some way off the mooring, the way the pirates' half of a funnel is.
    const [mx, mz] = [Math.floor(m.x + half), Math.floor(m.z + half)];
    const allow = (gx, gz) => gx >= mx + 6 && gx <= mx + 20 && gz >= mz - 30 && gz <= mz + 30;
    const water = { half, origin: [0, 0], allow };
    const at = shipBerth(m, height, water);
    const [fs, fc] = SHIP_TRIG.HEADINGS.find(([y]) => y === m.yaw)[1];
    const fits = (x, z) => PTS.every(([px, pz]) => {
      const wx = x + px * fc + pz * fs, wz = z - px * fs + pz * fc;
      return height(wx, wz) < SHIP_WATER && allow(Math.floor(wx + half), Math.floor(wz + half));
    });
    if (!fits(at.x, at.z)) continue;          // no such water within reach: she fell back to the rays
    placed++;
    // The nearest such cell, measured in whole cells from the mooring's.
    const d2 = (x, z) => (Math.floor(x + half) - mx) ** 2 + (Math.floor(z + half) - mz) ** 2;
    for (let gz = mz - 40; gz <= mz + 40; gz++) for (let gx = mx - 40; gx <= mx + 40; gx++) {
      const x = gx - half + 0.5, z = gz - half + 0.5;
      if ((gx - mx) ** 2 + (gz - mz) ** 2 < d2(at.x, at.z) && (gx - mx) ** 2 + (gz - mz) ** 2 <= 1600) assert.ok(!fits(x, z), `a nearer cell ${gx},${gz} takes her`);
    }
    // And a page that draws the island at an origin of its own lays her in the same cell.
    const o = [608, -352];
    const there = shipBerth({ ...m, x: m.x + o[0], z: m.z + o[1] }, (x, z) => height(x - o[0], z - o[1]), { half, origin: o, allow });
    assert.equal(there.x - o[0], at.x);
    assert.equal(there.z - o[1], at.z);
  }
  assert.ok(placed > 0, 'no mooring had any such water near it, so nothing was measured');
});

test('the ships\' water is the pirates\' half of the funnel, off the lane, past the quay\'s end', () => {
  // A funnel due south from [50,20], its quay on the east bank rows 20..40.
  const cells = [];
  for (let z = 20; z <= 40; z++) for (let x = 60; x <= 62; x++) cells.push([x, z]);
  const works = { v: 1, haven: { top: [50, 20], dir: [0, 64], w0: 1.5, open: 0.5, max: 12, from: 0 }, kade: { cells, level: 113, back: [1, 0], hold: [] } };
  const allow = shipWaterOf(works);
  assert.ok(allow(44, 50), 'west, six off the axis, past the quay');
  assert.equal(allow(56, 50), false, 'the quay\'s own bank');
  assert.equal(allow(48, 50), false, 'two off the axis is the channel\'s lane');
  assert.equal(allow(46, 50), true, 'four off it is not');
  assert.equal(allow(44, 40), false, 'alongside the quay');
  assert.equal(allow(44, 41), true, 'one row past its end');
  assert.equal(allow(30, 50), false, 'outside the funnel');
});
