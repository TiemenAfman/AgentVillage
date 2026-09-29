// The sea bed (Plans/onderwater-zwemmen.md, 3): shared/seabed.mjs (the relief), createArchipelago's
// `bedAt` (what a diver stands on), and web/js/seabed.js (what is drawn).
//
// What is worth holding here rather than in a screenshot: that the relief is the same number on
// every machine and never trig; that it stays inside the range that keeps a boat's keel and the
// sea's pose clamp out of it; that a player can walk every slope of it; that it is *beside* the
// terrain and never in it (the terrain hash is what every house's place hangs off); that the seam
// between an island's own ground and the field is one continuous surface, with no gap and no
// step; that two pages berthed apart put a bank in the same place; and that the mesh which draws
// it is world-locked, crack-free, cheap to plan and rebuilt only when it has to be.
//
// No document stub: seabed.js reaches three.js and shared/ only, never buildings.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

const THREE = await import('three');
const S = await import('../shared/seabed.mjs');
const { makeTerrain, BEACH_MAX } = await import('../shared/terrain.mjs');
const R = await import('../shared/regions.mjs');
const { isletsNear, isletBed, ISLET_SPAN } = await import('../shared/islets.mjs');
const P = await import('../web/js/seabed.js');

const { BED_FLOOR, BED_TOP, BED_DEEPEST, BED_BAND, BED_FADE, bedDelta, fieldHeight, distToSquares } = S;
const { OPEN_SEA, placeIsland, createArchipelago, berthOf } = R;

// One sea, home at the origin and a guest a berth east, the way tests/regions.test.mjs has it.
function sea2(seed = 1337) {
  const a = makeTerrain(seed, { size: 64 });
  const b = makeTerrain(seed + 1, { size: 64 });
  const home = placeIsland(a, { id: 'home', origin: [0, 0] });
  const guest = placeIsland(b, { id: 'guest', origin: berthOf(0, a.half, b.half) });
  const sea = createArchipelago();
  sea.add(home);
  sea.add(guest);
  return { sea, home, guest, a, b };
}
const outside = (sea, x, z) => distToSquares(x, z, sea.waterSquares());

// ---- the relief -------------------------------------------------------------------------

test('the relief is the same number everywhere it is asked: golden samples', () => {
  const golden = [
    [100, -250, 0.05983347852130475],
    [-777.5, 1234.25, -0.021535862841563756],
    [2016, -2016, -0.14334648528448402],
    [-1500, -191, 1.3928582862072252],     // a bank
    [-1500, -548, -0.9307378975941402],    // a trench
    [-1500, 149, 0.6854260848226361],      // a flank
  ];
  for (const [x, z, want] of golden) assert.ok(Math.abs(bedDelta(x, z) - want) < 1e-12, `bedDelta(${x}, ${z}) = ${bedDelta(x, z)}`);
  assert.equal(bedDelta(3.25, 9.5), bedDelta(3.25, 9.5));
  // Pure: asking in another order changes nothing.
  const a = bedDelta(11, 12), b = bedDelta(-50, 7);
  assert.equal(bedDelta(-50, 7), b);
  assert.equal(bedDelta(11, 12), a);
});

test('shared/seabed.mjs and the archipelago keep to the shared rule: no trig, no pow, no clock, no random', () => {
  for (const file of ['../shared/seabed.mjs', '../shared/regions.mjs']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(src, /Math\.(sin|cos|tan|asin|acos|atan2?|pow|exp|log\d*|random|cbrt|hypot)\b|Date\.|performance\.|\*\*/, file);
  }
});

test('the floor is the open sea, the range is exactly what keeps a keel and a clamp out of it', () => {
  assert.equal(BED_FLOOR, OPEN_SEA);
  assert.equal(BED_TOP, -1.0);
  assert.equal(BED_DEEPEST, -3.5);
  assert.equal(BED_BAND, 12);
  assert.equal(BED_FADE, 40);
  // A boat scrapes from BEACH_MAX (0.35); the top of a bank is a metre and a half under that.
  assert.ok(BED_TOP < BEACH_MAX - 1, 'a bank could touch a hull');
  // The sea clamps a pose to y >= -4 (lib/players.mjs): the bed is above it with a body's worth to spare.
  assert.ok(BED_DEEPEST >= -4 + 0.5, 'a trench is deeper than a diver can be sent');
  assert.equal(fieldHeight(10, 10, 0), BED_FLOOR, 'right against an island it is flat');
  assert.equal(fieldHeight(-1500, -191, BED_BAND), BED_FLOOR, 'and flat all through the band');
  assert.equal(fieldHeight(-1500, -191, Infinity), BED_FLOOR + bedDelta(-1500, -191));
});

test('the open sea stays in [BED_DEEPEST, BED_TOP], is about one part in seven bank, and every flank is one you can walk', () => {
  let n = 0, banks = 0, trenches = 0, lo = 9, hi = -9, ripples = 0;
  const R6 = 3000;
  for (let x = -R6; x < R6; x += 5) {
    for (let z = -R6; z < R6; z += 5) {
      const h = fieldHeight(x, z, Infinity);
      n++;
      if (h < lo) lo = h;
      if (h > hi) hi = h;
      const d = h - BED_FLOOR;
      if (d > 0.25) banks++;
      if (d < -0.25) trenches++;
      if (Math.abs(d) > 0.06 && Math.abs(d) <= 0.09) ripples++;
    }
  }
  assert.ok(lo >= BED_DEEPEST && hi <= BED_TOP, `the field left its range: ${lo} .. ${hi}`);
  assert.ok(lo < -3.3 && hi > -1.2, `the relief never gets going: ${lo} .. ${hi}`);
  console.log(`seabed field: ${(100 * banks / n).toFixed(1)}% bank, ${(100 * trenches / n).toFixed(1)}% trench, range ${lo.toFixed(3)} .. ${hi.toFixed(3)}`);
  assert.ok(banks / n > 0.09 && banks / n < 0.19, `banks: ${banks / n}`);
  assert.ok(trenches / n > 0.07 && trenches / n < 0.17, `trenches: ${trenches / n}`);
  assert.ok(ripples > 0, 'no ripples on the sand');

  // The steepest gradient anywhere, from one-unit differences and a finer one for the ripples.
  let steepest = 0;
  for (let x = -R6; x < R6; x += 3) {
    for (let z = -R6; z < R6; z += 3) {
      const h = fieldHeight(x, z, Infinity);
      const g = Math.hypot(fieldHeight(x + 1, z, Infinity) - h, fieldHeight(x, z + 1, Infinity) - h);
      const f = Math.hypot(fieldHeight(x + 0.25, z, Infinity) - h, fieldHeight(x, z + 0.25, Infinity) - h) / 0.25;
      steepest = Math.max(steepest, g, f);
    }
  }
  console.log(`seabed field: steepest slope ${steepest.toFixed(3)}`);
  assert.ok(steepest <= 0.3, `a flank of ${steepest} is not one to walk`);
});

test('the ripples are centimetres and only on flat sand', () => {
  // Where nothing is a bank or a trench (delta small) the sand is rippled by at most 0.08.
  let flat = 0, max = 0;
  for (let x = -1500; x < 1500; x += 3) {
    for (let z = -1500; z < 1500; z += 3) {
      const d = Math.abs(bedDelta(x, z));
      if (d > 0.081) continue;
      flat++;
      if (d > max) max = d;
    }
  }
  assert.ok(flat > 1000);
  assert.ok(max <= 0.081 && max > 0.05, `ripples reach ${max}`);
});

// ---- bedAt ------------------------------------------------------------------------------

test('inside a grid the bed is the ground that is drawn, not the ramped height the water shades by', () => {
  const { sea, home, guest, a } = sea2();
  let unrampedDiffers = 0;
  for (const r of [home, guest]) {
    const [ox, oz] = r.origin;
    for (let lx = -r.half; lx <= r.half; lx += 3.25) {
      for (let lz = -r.half; lz <= r.half; lz += 2.75) {
        const drawn = r.terrain.worldHeight(lx, lz);
        assert.equal(sea.bedAt(ox + lx, oz + lz), drawn, `${r.id} (${lx}, ${lz})`);
        // The ramp only ever pulls water towards OPEN_SEA, in the outer BLEND_CELLS of the grid.
        if (Math.abs(sea.height(ox + lx, oz + lz) - drawn) > 1e-9) unrampedDiffers++;
      }
    }
  }
  assert.ok(unrampedDiffers > 0, 'the rim is never ramped on this seed: pick another');
  // Every land cell of the home island is exactly its own ground.
  for (const cell of a.landCells) {
    const p = a.cellWorld(cell[0], cell[1]);
    assert.equal(sea.bedAt(p[0], p[1]), a.worldHeight(p[0], p[1]));
  }
});

test('the bed sits beside the terrain: no H, no hash, and height() answers as it always did', () => {
  const { sea, home, guest, a, b } = sea2();
  const before = [a.hash, b.hash, home.hash, guest.hash];
  const H = [Float64Array.from(a.H), Float64Array.from(b.H)];
  const heights = [[0, 0], [56, 3], [-200, 90], [400, 400], [0, 300], [56, -60]].map(([x, z]) => sea.height(x, z));
  for (let x = -300; x <= 500; x += 7) for (let z = -300; z <= 300; z += 7) sea.bedAt(x, z);
  const sampler = sea.bedSampler();
  for (let x = -300; x <= 500; x += 11) for (let z = -300; z <= 300; z += 11) sampler(x, z);
  const seabed = P.createSeabed({ scene: new THREE.Scene(), sea });
  seabed.update({ x: 56, z: 0, active: true });
  seabed.dispose();
  assert.deepEqual([a.hash, b.hash, home.hash, guest.hash], before, 'a terrain hash moved');
  assert.deepEqual(Float64Array.from(a.H), H[0]);
  assert.deepEqual(Float64Array.from(b.H), H[1]);
  assert.deepEqual([[0, 0], [56, 3], [-200, 90], [400, 400], [0, 300], [56, -60]].map(([x, z]) => sea.height(x, z)), heights);
  // Out in the open sea the logical depth is the open sea's, however the bed is shaped.
  for (const [x, z] of [[-300, 0], [200, 500], [-1500, -191], [-1500, -548]]) assert.equal(sea.height(x, z), OPEN_SEA);
});

test('past the band the bed is the field, faded in by the distance to the nearest grid', () => {
  const { sea } = sea2();
  let seen = 0;
  for (const [x, z] of [[-300, 0], [-260, 90], [200, 400], [400, -350], [-100, 320], [56, 200], [-500, -20]]) {
    const d = outside(sea, x, z);
    assert.ok(d >= BED_BAND, `(${x}, ${z}) is inside the band`);
    assert.equal(sea.bedAt(x, z), fieldHeight(x, z, d, OPEN_SEA), `(${x}, ${z})`);
    if (Math.abs(sea.bedAt(x, z) - OPEN_SEA) > 0.1) seen++;
  }
  assert.ok(seen > 0, 'none of the samples was in relief');
  // Within the band the relief is not in it at all, only the blend from the grid's edge to the floor:
  // at the far end of the band it is the floor, at the grid it is the grid.
  for (const [x, z] of [[40, 0], [-38, 10], [10, 42], [38, 38]]) {
    const d = outside(sea, x, z);
    assert.ok(d > 0 && d < BED_BAND, `(${x}, ${z}) is ${d} out`);
    assert.ok(sea.bedAt(x, z) >= OPEN_SEA - 1e-9, 'the blend went under the floor');
  }
  assert.ok(Math.abs(sea.bedAt(-32 - BED_BAND + 1e-6, 5) - OPEN_SEA) < 1e-4, 'the band does not end on the floor');
});

test('the bed is one surface at a grid edge, and from the edge into the field: no step, no gap, no overlap', () => {
  for (const seed of [1337, 1, 424242]) {
    const { sea, home } = sea2(seed);
    // Straddling each side of the home grid: no jump at the boundary itself, in either direction.
    for (let t = -30; t <= 30; t += 1.5) {
      for (const [x, z, ox, oz] of [[32, t, 1, 0], [-32, t, -1, 0], [t, 32, 0, 1], [t, -32, 0, -1]]) {
        const inside = sea.bedAt(x - ox * 1e-7, z - oz * 1e-7), beyond = sea.bedAt(x + ox * 1e-7, z + oz * 1e-7);
        assert.ok(Math.abs(inside - beyond) < 1e-5, `seed ${seed}: ${inside} in, ${beyond} out at (${x}, ${z})`);
        assert.equal(sea.bedAt(x, z), home.terrain.worldHeight(x, z), 'the edge itself is the grid');
      }
    }
    // And along a line out from the edge, over the band and the fade and on into the open sea (west,
    // north and south are open water; east is the gap to the guest, which the blend meets from its
    // side too): the surface is a surface - no step, and never steeper than a flank you can walk.
    const rays = [];
    for (const off of [-24, -8, 0, 8, 24]) {
      rays.push([-32, off, -1, 0, 140], [off, -32, 0, -1, 140], [off, 32, 0, 1, 140], [32, off, 1, 0, 47]);
    }
    for (const [x0, z0, dx, dz, len] of rays) {
      let prev = sea.bedAt(x0 + dx * 0.25, z0 + dz * 0.25), steepest = 0;
      for (let d = 0.5; d <= len; d += 0.25) {
        const h = sea.bedAt(x0 + dx * d, z0 + dz * d);
        steepest = Math.max(steepest, Math.abs(h - prev) / 0.25);
        assert.ok(h >= BED_DEEPEST, `seed ${seed}: ${h} at ${d}`);
        prev = h;
      }
      assert.ok(steepest <= 0.42, `seed ${seed}: the seam is ${steepest} steep from (${x0}, ${z0}) towards (${dx}, ${dz})`);
    }
  }
});

test('outside every island the bed is never deeper than BED_DEEPEST, nor higher than BED_TOP past the band', () => {
  const { sea } = sea2();
  const squares = sea.waterSquares();
  let lo = 9, hi = -9, n = 0;
  for (let x = -400; x <= 560; x += 3.5) {
    for (let z = -300; z <= 300; z += 3.5) {
      if (sea.regionAt(x, z)) continue;
      const h = sea.bedAt(x, z);
      const d = distToSquares(x, z, squares);
      n++;
      assert.ok(h >= BED_DEEPEST, `(${x}, ${z}) is ${h}`);
      if (d >= BED_BAND) { assert.ok(h <= BED_TOP, `(${x}, ${z}) is ${h}, ${d} out`); if (h > hi) hi = h; }
      if (h < lo) lo = h;
      // Inside the band it is between the edge and the floor, which may be as high as the coast.
      if (d < BED_BAND) assert.ok(h >= OPEN_SEA - 1e-9, `(${x}, ${z}) dips under the floor next to a grid: ${h}`);
    }
  }
  assert.ok(n > 5000);
  console.log(`seabed near two islands: ${lo.toFixed(2)} .. ${hi.toFixed(2)} outside the band over ${n} points`);
});

test('every slope outside the grids can be walked', () => {
  const { sea } = sea2();
  let steepest = 0, at = null;
  for (let x = -260; x <= 420; x += 1) {
    for (let z = -160; z <= 160; z += 1) {
      if (outside(sea, x, z) < 0.6 || outside(sea, x + 1, z + 1) < 0.6) continue;
      const h = sea.bedAt(x, z);
      const g = Math.hypot(sea.bedAt(x + 1, z) - h, sea.bedAt(x, z + 1) - h);
      if (g > steepest) { steepest = g; at = [x, z]; }
    }
  }
  console.log(`seabed near two islands: steepest slope ${steepest.toFixed(3)} at ${at}`);
  assert.ok(steepest <= 0.4, `${steepest} at ${at}`);
});

test('the field is in the world frame: two pages berthed apart put a bank in the same place', () => {
  // The world has an island at [0, 0] and another at [176, 0]. Page A is berthed at the first:
  // its scene is the world. Page B is berthed at the second: its scene is the world less [176, 0].
  const a = makeTerrain(7, { size: 64 }), b = makeTerrain(8, { size: 64 });
  const pageA = createArchipelago();
  pageA.add(placeIsland(a, { id: 'a', origin: [0, 0] }));
  pageA.add(placeIsland(b, { id: 'b', origin: [176, 0] }));
  pageA.setBedHome([0, 0]);
  const pageB = createArchipelago();
  pageB.add(placeIsland(a, { id: 'a', origin: [-176, 0] }));
  pageB.add(placeIsland(b, { id: 'b', origin: [0, 0] }));
  pageB.setBedHome([176, 0]);
  let relief = 0;
  for (let x = -400; x <= 600; x += 9) {
    for (let z = -300; z <= 300; z += 9) {
      const here = pageA.bedAt(x, z), there = pageB.bedAt(x - 176, z);
      assert.ok(Math.abs(here - there) < 1e-9, `world (${x}, ${z}): ${here} on one page, ${there} on the other`);
      if (Math.abs(here - OPEN_SEA) > 0.3) relief++;
    }
  }
  assert.ok(relief > 50, 'nothing to compare: the samples were all flat');
  // A page that was never told its berth answers in its scene frame - which is the world only for a host at the origin.
  const naive = createArchipelago();
  naive.add(placeIsland(a, { id: 'a', origin: [-176, 0] }));
  naive.add(placeIsland(b, { id: 'b', origin: [0, 0] }));
  let differs = 0;
  for (let x = -400; x <= 200; x += 9) if (Math.abs(naive.bedAt(x, 150) - pageA.bedAt(x + 176, 150)) > 1e-6) differs++;
  assert.ok(differs > 0);
  // Rubbish is no berth.
  pageB.setBedHome(null);
  assert.equal(pageB.bedAt(-300, 100), naive.bedAt(-300, 100));
  pageB.setBedHome([NaN, 3]);
  assert.equal(pageB.bedAt(-300, 100), naive.bedAt(-300, 100));
});

test('an islet keeps its own bed, and the relief keeps its distance from it', () => {
  // The sea as tests/islets.test.mjs has it; standing on the origin, so scene = world.
  const FLEET = [
    { id: '0000000000000000', origin: [0, 0], gridSize: 192, reach: 96, volcano: true },
    { id: 'a', origin: [336, 0], gridSize: 64, reach: 192 },
    { id: 'b', origin: [0, -336], gridSize: 64, reach: 192 },
    { id: 'c', origin: [-336, -336], gridSize: 64, reach: 192 },
  ];
  const islets = isletsNear(FLEET, [336, 0]);
  assert.ok(islets.length > 3);
  const seabed = {
    height: (x, z) => {
      for (const islet of islets) {
        const lx = x - islet.x, lz = z - islet.z, span = islet.r * ISLET_SPAN;
        if (Math.abs(lx) > span || Math.abs(lz) > span) continue;
        const h = isletBed(islet, lx, lz, OPEN_SEA);
        if (h != null) return h;
      }
      return null;
    },
    squares: () => islets.map((i) => ({ origin: [i.x, i.z], half: i.r * ISLET_SPAN, reach: 6, step: 2 })),
  };
  const sea = createArchipelago();
  sea.setSeabed(seabed);
  for (const islet of islets) {
    assert.equal(sea.bedAt(islet.x, islet.z), seabed.height(islet.x, islet.z), `${islet.id}: not its own ground in the middle`);
    assert.ok(sea.bedAt(islet.x, islet.z) > 0.3);
    // It meets the field round it without a step, all the way round the rim of its span, and past
    // the rim the ground is the field's own gentle one.
    const span = islet.r * ISLET_SPAN;
    const dirs = [[1, 0], [0.92388, 0.38268], [0.70711, 0.70711], [0.38268, 0.92388], [0, 1], [-0.38268, 0.92388], [-0.70711, 0.70711], [-0.92388, 0.38268],
      [-1, 0], [-0.92388, -0.38268], [-0.70711, -0.70711], [-0.38268, -0.92388], [0, -1], [0.38268, -0.92388], [0.70711, -0.70711], [0.92388, -0.38268]];
    for (const [dx, dz] of dirs) {
      const inside = sea.bedAt(islet.x + dx * (span - 1e-3), islet.z + dz * (span - 1e-3));
      const beyond = sea.bedAt(islet.x + dx * (span + 1e-3), islet.z + dz * (span + 1e-3));
      assert.ok(Math.abs(inside - beyond) < 0.02, `${islet.id}: ${inside} in, ${beyond} out at the rim`);
      // (A neighbouring islet's own bed may lie on the way - its spans can overlap - and it has the
      // steep coast of a dome; it is the field's slope that is being held here.)
      let prev = beyond;
      for (let d = span + 0.25; d <= span + 40; d += 0.25) {
        const x = islet.x + dx * d, z = islet.z + dz * d;
        if (seabed.height(x, z) != null) { prev = null; continue; }
        const h = sea.bedAt(x, z);
        if (prev != null) assert.ok(Math.abs(h - prev) <= 0.25 * 0.3, `${islet.id}: a step of ${h - prev} at ${d - span} past its span`);
        assert.ok(h >= BED_DEEPEST);
        prev = h;
      }
    }
    // Within the band of its square the sea round it is flat: the relief is faded out by its distance.
    const out = span + 5;
    if (seabed.height(islet.x + out, islet.z + out) == null) {
      assert.equal(sea.bedAt(islet.x + out, islet.z + out), OPEN_SEA, `${islet.id}: relief right up against it`);
    }
  }
});

// ---- the mesh: planning (pure) ----------------------------------------------------------

test('the plan has the cells and the triangles the rings say, inside the budget', () => {
  const full = P.seabedLayout(false), modest = P.seabedLayout(true);
  // 48x48 at step 1, then the 128 square at step 2 less the 48 hole, then the 256 square at step 4 less the 128.
  const cells = 48 * 48 + (64 * 64 - 24 * 24) + (64 * 64 - 32 * 32);
  assert.equal(full.cells.length / 4, cells);
  assert.equal(full.maxTriangles, 2 * cells);
  assert.equal(full.maxTriangles, 17792);
  assert.ok(full.maxTriangles <= 20000, 'over the plan\'s triangle budget');
  assert.ok(modest.maxTriangles < full.maxTriangles / 2, 'modest should be a good deal lighter');
  assert.equal(modest.maxTriangles, 2 * (48 * 48 + (32 * 32 - 12 * 12) + (32 * 32 - 16 * 16)));
  console.log(`seabed rings: ${full.count} vertices, ${full.maxTriangles} triangles (modest ${modest.count}, ${modest.maxTriangles})`);
  // The rings' own counts, from the cells' corners.
  const perRing = [0, 0, 0];
  for (let i = 0; i < full.cells.length; i += 4) {
    const a = full.cells[i], d = full.cells[i + 3];
    const s = full.lx[d] - full.lx[a];
    perRing[[1, 2, 4].indexOf(s)]++;
  }
  assert.deepEqual(perRing, [48 * 48, 64 * 64 - 24 * 24, 64 * 64 - 32 * 32]);
});

test('the lattice is the world\'s: the same plan for a focus anywhere in a cell, and every vertex on its ring\'s own multiples', () => {
  for (const modest of [false, true]) {
    const snap = P.seabedLayout(modest).snap;
    assert.equal(snap, modest ? 8 : 4);
    const one = P.seabedPlan(100.2, -37.9, { modest });
    for (const [x, z] of [[100.9, -37.5], [98.1, -38.4], [101.99, -35.6], [99.5, -36.01]]) {
      const two = P.seabedPlan(x, z, { modest });
      if (Math.floor(x / snap + 0.5) !== Math.floor(100.2 / snap + 0.5) || Math.floor(z / snap + 0.5) !== Math.floor(-37.9 / snap + 0.5)) continue;
      assert.deepEqual(two, one, `${modest}: a focus at (${x}, ${z}) moved the plan`);
    }
    // A step across a cell is a plan on the next multiple of the snap, whichever way the focus goes.
    for (const [x, z] of [[0, 0], [1.9, 1.9], [2.1, -2.1], [-1234.5, 777.7], [5000, -5000]]) {
      const plan = P.seabedPlan(x, z, { modest });
      assert.ok(plan.cx % snap === 0 && plan.cz % snap === 0, `${modest}: the centre is off the snap`);
      assert.ok(Math.abs(plan.cx - x) <= snap / 2 && Math.abs(plan.cz - z) <= snap / 2);
      // Every vertex, in world coordinates, is on the multiples of the step of the ring that made it.
      const l = plan.layout;
      const steps = l.rings.map((r) => r.step);
      for (let v = 0; v < l.count; v++) {
        const wx = plan.cx + l.lx[v], wz = plan.cz + l.lz[v];
        assert.ok(steps.some((s) => wx % s === 0 && wz % s === 0), `${modest}: vertex ${v} is off every lattice`);
        // The ring that owns a vertex is the innermost one that reaches it: on its own multiples.
        const ring = l.rings.findIndex((r) => Math.max(Math.abs(l.lx[v]), Math.abs(l.lz[v])) <= r.half);
        if (l.sa[v] < 0 && ring > 0 && Math.max(Math.abs(l.lx[v]), Math.abs(l.lz[v])) > l.rings[ring - 1].half) {
          assert.ok(wx % steps[ring] === 0 && wz % steps[ring] === 0, `${modest}: a ring-${ring} vertex is off its step`);
        }
      }
    }
  }
  // Moving the focus a whole cell moves every vertex by whole cells and nothing else: the same
  // lattice points are drawn from either plan, with the same heights.
  const bed = (x, z) => fieldHeight(x, z, Infinity);
  const p1 = P.seabedPlan(96, 96), p2 = P.seabedPlan(100, 96);
  assert.equal(p2.cx - p1.cx, 4);
  const y1 = P.seabedHeights(p1, bed, new Float32Array(p1.layout.count));
  const y2 = P.seabedHeights(p2, bed, new Float32Array(p2.layout.count));
  const at = new Map();
  for (let v = 0; v < p1.layout.count; v++) if (p1.layout.sa[v] < 0) at.set(`${p1.cx + p1.layout.lx[v]},${p1.cz + p1.layout.lz[v]}`, y1[v]);
  let shared = 0;
  for (let v = 0; v < p2.layout.count; v++) {
    if (p2.layout.sa[v] >= 0) continue;
    const k = `${p2.cx + p2.layout.lx[v]},${p2.cz + p2.layout.lz[v]}`;
    if (at.has(k)) { shared++; assert.equal(at.get(k), y2[v], `the sand at ${k} is not the same sand from two plans`); }
  }
  assert.ok(shared > 3000, `only ${shared} lattice points in common`);
});

test('where a fine ring meets a coarse one the edge is one polyline: no crack', () => {
  for (const modest of [false, true]) {
    const plan = P.seabedPlan(0, 0, { modest });
    const l = plan.layout;
    // A floor with real relief on it, so a straight line between two coarse neighbours is not
    // what the truth would give and a vertex left un-stitched would show.
    const bed = (x, z) => -2.5 + 0.9 * Math.sin(x * 0.37) * Math.cos(z * 0.29) + 0.3 * Math.sin((x + z) * 0.11);
    const y = P.seabedHeights(plan, bed, new Float32Array(l.count));
    let stitched = 0;
    for (let v = 0; v < l.count; v++) {
      if (l.sa[v] < 0) { assert.equal(y[v], Math.fround(bed(plan.cx + l.lx[v], plan.cz + l.lz[v]))); continue; }
      stitched++;
      const a = l.sa[v], b = l.sb[v];
      // The two coarse neighbours are the ones either side of it, along the same edge.
      assert.ok((l.lx[a] === l.lx[b]) !== (l.lz[a] === l.lz[b]), 'neighbours are not on one edge');
      const along = l.lx[a] === l.lx[b] ? [l.lz[a], l.lz[b], l.lz[v]] : [l.lx[a], l.lx[b], l.lx[v]];
      assert.ok(along[0] < along[2] && along[2] < along[1]);
      const t = (along[2] - along[0]) / (along[1] - along[0]);
      assert.ok(Math.abs(y[v] - (y[a] + (y[b] - y[a]) * t)) < 1e-6, `vertex ${v} is off the coarse line`);
      // Never itself stitched: a coarse neighbour is always a real sample.
      assert.equal(l.sa[a], -1);
      assert.equal(l.sa[b], -1);
    }
    assert.ok(stitched > 100, `${modest}: only ${stitched} stitched vertices`);
  }
});

test('a cell that is land is left out, one that has any water is drawn, and the winding is the island\'s', () => {
  const plan = P.seabedPlan(0, 0);
  const l = plan.layout;
  // A plateau of land, 9.5 on each side of the middle: every corner inside it is above the waterline.
  const bed = (x, z) => (Math.abs(x) < 9.5 && Math.abs(z) < 9.5 ? 0.5 : -2);
  const y = P.seabedHeights(plan, bed, new Float32Array(l.count));
  const index = new Uint16Array(l.cells.length / 4 * 6);
  const used = P.seabedIndex(l, y, index);
  // Vertices at -9..9 are land: cells from -9 to 8 whole are all land, 18 a side, 324 of them.
  assert.equal(used / 3, l.maxTriangles - 2 * 18 * 18);
  // Nothing is drawn for a cell whose four corners are all >= SEABED_LAND, and every cell with a low one is.
  let cellsDrawn = 0;
  for (let i = 0; i < l.cells.length; i += 4) {
    const low = [0, 1, 2, 3].some((k) => y[l.cells[i + k]] < P.SEABED_LAND);
    if (low) cellsDrawn++;
  }
  assert.equal(used / 6, cellsDrawn);
  // Up-facing, and the diagonal the island's own mesh has: (a, c, b) and (b, c, d).
  const normals = P.seabedNormals(l, y, index, used, new Float32Array(l.count * 3));
  for (let i = 0; i < used; i += 3) {
    const a = index[i], b = index[i + 1], c = index[i + 2];
    const cross = (l.lx[b] - l.lx[a]) * (l.lz[c] - l.lz[a]) - (l.lz[b] - l.lz[a]) * (l.lx[c] - l.lx[a]);
    assert.ok(cross < 0, `triangle ${i / 3} faces down`);   // in x-z, (a, c, b) turns the way three's up-facing ones do
  }
  let upward = 0;
  for (let v = 0; v < l.count; v++) if (normals[v * 3 + 1] > 0.7) upward++;
  assert.ok(upward > l.count * 0.95, 'the normals are not up');
  // Everything is land: nothing left to draw.
  assert.equal(P.seabedIndex(l, new Float32Array(l.count).fill(1), index), 0);
  // Everything is sea: the whole of it.
  assert.equal(P.seabedIndex(l, new Float32Array(l.count).fill(-2), index), l.maxTriangles * 3);
});

// ---- the mesh: the thing itself ---------------------------------------------------------

function uniformsOf() {
  return {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(0xffffff) },
    uNight: { value: 0 },
  };
}

test('the mesh follows the focus on the world lattice, shows only when asked, and rebuilds only when it must', () => {
  const { sea } = sea2();
  const scene = new THREE.Scene();
  let calls = 0;
  const counted = { bedAt: (x, z) => { calls++; return sea.bedAt(x, z); }, bedSampler: () => { const f = sea.bedSampler(); return (x, z) => { calls++; return f(x, z); }; } };
  const seabed = P.createSeabed({ scene, sea: counted, uniforms: uniformsOf() });
  const { mesh } = seabed;
  assert.equal(mesh.visible, false, 'hidden until asked');
  assert.ok(scene.children.includes(mesh));
  assert.equal(mesh.frustumCulled, false);
  seabed.update({ x: 60, z: 60, active: false });
  assert.equal(calls, 0, 'asked nothing while it is not wanted');
  assert.equal(mesh.visible, false);

  seabed.update({ x: 60, z: 61, active: true });
  assert.equal(mesh.visible, true);
  assert.equal(seabed.info().rebuilds, 1);
  const layoutCount = P.seabedLayout(false).count;
  assert.ok(calls <= layoutCount && calls > layoutCount * 0.9, `${calls} heights for ${layoutCount} vertices`);
  assert.equal(mesh.position.x, 60);
  assert.equal(mesh.position.z, 60);
  assert.equal(mesh.position.y, P.SEABED_LIFT);
  const tris = mesh.geometry.drawRange.count / 3;
  assert.ok(tris > 0 && tris <= P.seabedLayout(false).maxTriangles, `${tris} triangles`);
  assert.equal(seabed.info().triangles, tris);

  // The vertices are the truth, and the whole mesh is what is lowered.
  const pos = mesh.geometry.attributes.position.array, l = P.seabedLayout(false);
  for (let v = 0; v < l.count; v += 97) {
    if (l.sa[v] >= 0) continue;
    assert.equal(pos[v * 3 + 1], Math.fround(sea.bedAt(60 + l.lx[v], 60 + l.lz[v])));
    assert.equal(pos[v * 3], l.lx[v]);
    assert.equal(pos[v * 3 + 2], l.lz[v]);
  }

  // A drift inside the hold, back and forth across every snapping boundary: no rebuild, ever.
  for (let i = 0; i < 200; i++) seabed.update({ x: 60 + (i % 2 ? 2.1 : 1.9), z: 60 + (i % 3) * 0.5 - 1, active: true });
  assert.equal(seabed.info().rebuilds, 1, 'thrashing on a boundary');
  assert.equal(mesh.position.x, 60);
  // Past the hold: one rebuild on the next multiple of the snap, and a swimmer bobbing about the new spot stays put.
  seabed.update({ x: 60 + P.SEABED_HOLD + 0.5, z: 60, active: true });
  assert.equal(seabed.info().rebuilds, 2);
  assert.equal(mesh.position.x % 4, 0);
  const cx = mesh.position.x;
  for (let i = 0; i < 100; i++) seabed.update({ x: 68.5 + (i % 2 ? 0.2 : -0.2), z: 60, active: true });
  assert.equal(seabed.info().rebuilds, 2);
  assert.equal(mesh.position.x, cx);

  // Not wanted: hidden, and nothing is rebuilt however far it has gone; wanted again where it was: no work.
  seabed.update({ x: 900, z: 900, active: false });
  assert.equal(mesh.visible, false);
  assert.equal(seabed.info().rebuilds, 2);
  seabed.update({ x: 68.5, z: 60, active: true });
  assert.equal(mesh.visible, true);
  assert.equal(seabed.info().rebuilds, 2);
  // A sea that changed under it: rebuilt on the next look, and not before.
  seabed.reshape();
  assert.equal(seabed.info().rebuilds, 2);
  seabed.update({ x: 68.5, z: 60, active: true });
  assert.equal(seabed.info().rebuilds, 3);
  // Nonsense is not a place.
  seabed.update({ x: NaN, z: 0, active: true });
  assert.equal(mesh.visible, false);
  seabed.update({ x: 68.5, z: 60, active: true });
  assert.equal(seabed.info().rebuilds, 3);

  seabed.dispose();
  assert.ok(!scene.children.includes(mesh));
  seabed.update({ x: 0, z: 0, active: true });
  assert.equal(mesh.visible, false, 'a disposed bed came back');
});

test('the mesh is a rebuild of about a couple of milliseconds, in one draw call, in both tiers', () => {
  const { sea } = sea2();
  for (const modest of [false, true]) {
    const scene = new THREE.Scene();
    const seabed = P.createSeabed({ scene, sea, uniforms: uniformsOf(), modest });
    seabed.update({ x: 20, z: 20, active: true });
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) { seabed.reshape(); seabed.update({ x: 20, z: 20, active: true }); }
    const ms = (performance.now() - t0) / 20;
    console.log(`seabed rebuild (${modest ? 'modest' : 'full'}): ${ms.toFixed(2)} ms, ${seabed.info().triangles} triangles`);
    assert.ok(ms < 40, `a rebuild costs ${ms} ms`);
    assert.equal(scene.children.filter((c) => c.isMesh).length, 1, 'more than one draw call');
    assert.ok(seabed.info().triangles <= (modest ? 7904 : 17792));
    seabed.dispose();
  }
});

test('the material shares the water\'s uniforms, fogs like the water, and sits under an island\'s own mesh', () => {
  const uniforms = uniformsOf();
  const seabed = P.createSeabed({ scene: new THREE.Scene(), sea: sea2().sea, uniforms });
  const mat = seabed.mesh.material;
  // Shared, not cloned: one clock, one sun, one nightfall.
  for (const k of Object.keys(uniforms)) assert.equal(mat.uniforms[k], uniforms[k], `${k} was copied`);
  assert.equal(mat.fog, true);
  assert.ok('fogColor' in mat.uniforms && 'fogNear' in mat.uniforms && 'fogFar' in mat.uniforms);
  assert.equal(mat.polygonOffset, true);
  assert.ok(mat.polygonOffsetFactor < 0 && mat.polygonOffsetUnits < 0, 'the offset pushes the wrong way: an island\'s dark underwater ground would show through the bed');
  assert.equal(mat.transparent, false);
  assert.equal(mat.side, THREE.FrontSide);
  assert.ok(P.SEABED_LIFT > 0 && P.SEABED_LIFT <= 0.05);
  // The shaders take the same fog the water does.
  assert.match(mat.vertexShader, /#include <fog_pars_vertex>[\s\S]*#include <fog_vertex>/);
  assert.match(mat.vertexShader, /vec4 mvPosition/, 'fog_vertex needs mvPosition in scope (radial-fog.js)');
  assert.match(mat.fragmentShader, /#include <fog_pars_fragment>/);
  assert.match(mat.fragmentShader, /distance\(vWorld, cameraPosition\)/);
  // Caustics, on the water's clock, dimmed by depth and by the sun and the night.
  assert.match(mat.fragmentShader, /caustics\(vWorld\.xz, uTime\)/);
  assert.match(mat.fragmentShader, /exp\(-below \* 0\.4\)/);
  assert.match(mat.fragmentShader, /uSunDir\.y/);
  assert.match(mat.fragmentShader, /1\.0 - uNight/);
  // Every rate on the water's clock is a multiple of a tenth, so it wraps at 20 pi without a jump.
  const rates = [...mat.fragmentShader.matchAll(/(?:p\.x|p\.y|\(p\.x [+-] p\.y\)) \* [0-9.]+ [+-] t \* ([0-9.]+)/g)].map((m) => Number(m[1]));
  assert.ok(rates.length >= 6, `found ${rates.length} rates`);
  for (const r of rates) assert.ok(Math.abs(Math.round(r * 10) - r * 10) < 1e-9, `rate ${r} does not wrap with the water's clock`);
  seabed.dispose();
});

test('a sea that has no bulk reader still draws, through bedAt', () => {
  const { sea } = sea2();
  let calls = 0;
  const seabed = P.createSeabed({ scene: new THREE.Scene(), sea: { bedAt: (x, z) => { calls++; return sea.bedAt(x, z); } } });
  seabed.update({ x: 0, z: 0, active: true });
  assert.ok(calls > 8000);
  assert.equal(seabed.info().rebuilds, 1);
  seabed.dispose();
});
