// The volcano in the middle of the sea (Plans/vulkaan-in-het-midden.md, step 3): its ground
// in shared/terrain.mjs and its drawing in web/js/world.js + web/js/lava.js.
//
// Two kinds of promise, and the first is the one that would hurt to break. `volcano: true`
// is a new branch in the function every island's shape comes out of, and an island whose
// hash moves is an island `loadLayout` throws away with its whole town. So the hashes of
// ordinary islands are written down here as they were before the volcano existed, and
// checked to the byte.
//
// The second is what the sea will lean on in step 4 onwards: lava is somewhere nobody can
// build and a guard cannot walk, it never lies at or under the sea plane (which would show
// through the flow), and the crater can be climbed to from the beach.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

const { makeTerrain, SEA_LEVEL, BUILD_HEIGHT_MAX } = await import('../shared/terrain.mjs');
const { findPath } = await import('../shared/settlerwalk.mjs');
const { VOLCANO, volcanoBridges } = await import('../shared/volcano.mjs');

// The size the sea raises it at (192 since it was made higher and ruggeder; it was 128).
const SIZE = VOLCANO.size;
const volcano = () => makeTerrain('volcano', { size: SIZE, volcano: true });

// Measured on the tree as it stood before `volcano` was added (commit 9eac940 plus the
// uncommitted steps 0-2, none of which touch shared/terrain.mjs). Every size a grid comes
// in that the tests use, a string seed and a number seed, and the seed the volcano itself
// is made from - which, asked for without the flag, must still be the ordinary island it
// always was.
const BEFORE = {
  '1337:64': 'f7ec71ac',
  '7331:64': 'b3d1b4cc',
  'Promptholm:64': '3f4e2a9b',
  'x:64': '0608b400',
  '42:128': '72b82f69',
  'volcano:128': '176ab1a9',
  '3:256': '563fafaa',
};

test('every ordinary island hashes exactly as it did before there was a volcano', () => {
  for (const [key, hash] of Object.entries(BEFORE)) {
    const [s, n] = key.split(':');
    const seed = Number.isNaN(Number(s)) ? s : Number(s);
    assert.equal(makeTerrain(seed, { size: Number(n) }).hash, hash, `${key} changed shape`);
    assert.equal(makeTerrain(seed, { size: Number(n), volcano: false }).hash, hash, `${key} changed with volcano: false`);
  }
  // And the open sea a phone stands on wins over the flag: no island at all is no volcano.
  assert.equal(makeTerrain(1337, { size: 64, open: true, volcano: true }).hash, 'ae2ab146');
});

test('the volcano is the same mountain every time it is made', () => {
  const a = volcano(), b = volcano();
  assert.equal(a.hash, b.hash);
  assert.notEqual(a.hash, BEFORE['volcano:128'], 'the flag made no difference');
  // Written down so that a change to its shape is a decision and not an accident. Nothing
  // on disk holds this number - the sea raises the volcano from its seed on every start -
  // but a page and a sea running different shapes disagree about where the lava is, and
  // the page says so only as a banner (ui.setSkew). Tune it on purpose and update this.
  assert.equal(a.hash, 'f103be8a');
  assert.deepEqual(a.lavaCells, b.lavaCells);
  assert.deepEqual(a.crater, b.crater);
});

test('an ordinary island carries the lava fields too, empty, and a volcano the river fields', () => {
  const plain = makeTerrain(1337, { size: 64 });
  assert.equal(plain.volcano, false);
  assert.equal(plain.crater, null);
  assert.deepEqual(plain.lavaCells, []);
  assert.deepEqual(plain.lavaBankCells, []);
  assert.equal(plain.isLava(10, 10), false);

  const t = volcano();
  assert.equal(t.volcano, true);
  assert.deepEqual(t.rivers, [], 'a volcano has no rivers');
  assert.deepEqual(t.riverCells, []);
  assert.deepEqual(t.riverBankCells, []);
  assert.equal(t.isRiver(64, 64), false);
  assert.ok(Array.isArray(t.lakeCentre) && t.lakeCentre.length === 2, 'something reads a point off lakeCentre');
  assert.deepEqual(t.crater.centre, [0, 0]);
  assert.ok(t.crater.r > 10 && t.crater.r < 20, `crater radius ${t.crater.r}`);
});

test('the mountain is a cone with a crater in it and open water all round', () => {
  const t = volcano();
  const middle = t.worldHeight(0, 0);
  // The rim, round the whole circle: the highest ground within a few cells of it on each of
  // 64 bearings. It was one circle 15.3 high with a crater 3.8 deep; now it is 35 to 45 at
  // the summit, jagged, and notched where the flows leave it.
  const rim = [];
  for (let a = 0; a < 64; a++) {
    const [ux, uz] = [Math.cos((a / 64) * 2 * Math.PI), Math.sin((a / 64) * 2 * Math.PI)];
    let best = -Infinity;
    for (let r = t.crater.r * 0.6; r < t.crater.r * 1.6; r += 0.25) best = Math.max(best, t.worldHeight(ux * r, uz * r));
    rim.push(best);
  }
  rim.sort((p, q) => p - q);
  const summit = Math.max(...t.H);
  assert.ok(summit >= 35 && summit <= 45, `the summit stands ${summit} high`);
  assert.equal(t.crater.top > 30, true, `the rim was drawn ${t.crater.top} high`);
  assert.ok(rim[32] - middle > 8, `the crater is ${rim[32] - middle} deep`);
  assert.ok(rim[63] - rim[0] > 5, `the rim is ${rim[63] - rim[0]} from its lowest notch to its highest crag - a circle, not a jagged edge`);
  assert.ok(Math.abs(middle - t.crater.floor) < 1e-9, 'the pool is not on the crater floor');
  // Every edge cell of the grid is sea, so a region at a berth fades into open water.
  for (let i = 0; i < SIZE; i++) {
    for (const [gx, gz] of [[i, 0], [i, SIZE - 1], [0, i], [SIZE - 1, i]]) {
      assert.ok(t.isWater(gx, gz), `(${gx}, ${gz}) is land at the edge of the grid`);
    }
  }
  assert.ok(t.beachCells.length > 200, `only ${t.beachCells.length} cells of beach`);
});

test('the flank is rugged: ridges and ravines stand well off the mean of their ring', () => {
  // How far the ground stands above or below the mean of the ground at the same distance
  // from the crater, as a standard deviation, over the flank between the crater and 70% of
  // the way to the coast - the cone with its apron and beach left out. The 128-grid cone's
  // ridges measured 0.50 here; this one's ridges, ravines, cliff bands and crags 1.51. And
  // the slope varies with them: the steepest tenth of the land is over 2, where it was 0.74.
  const t = volcano();
  const { H, N, half } = t;
  const sum = new Float64Array(half * 2), cnt = new Float64Array(half * 2);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const r = Math.floor(Math.sqrt((i - half) ** 2 + (j - half) ** 2));
    if (r < half * 2) { sum[r] += H[i + j * N]; cnt[r]++; }
  }
  let dev = 0, n = 0;
  const lo = t.crater.r + 3, hi = half * 0.8 * 0.7;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const rr = Math.sqrt((i - half) ** 2 + (j - half) ** 2);
    if (rr < lo || rr > hi) continue;
    const d = H[i + j * N] - sum[Math.floor(rr)] / cnt[Math.floor(rr)];
    dev += d * d; n++;
  }
  const std = Math.sqrt(dev / n);
  assert.ok(std > 1.2, `the flank stands only ${std.toFixed(2)} off its ring on average - smooth, not rugged`);
  const slopes = t.landCells.map(([gx, gz]) => t.slope(gx, gz)).sort((p, q) => p - q);
  assert.ok(slopes[Math.floor(slopes.length * 0.9)] > 2, `the steepest tenth is only ${slopes[Math.floor(slopes.length * 0.9)]}`);
  // And the parasitic cones stand on the lower cone, where the page puts a wisp over each.
  assert.ok(t.crater.vents.length >= 2, `${t.crater.vents.length} parasitic cones`);
  for (const v of t.crater.vents) {
    const r = Math.sqrt(v.x * v.x + v.z * v.z);
    assert.ok(r > t.crater.r * 2 && r < half * 0.7, `a vent ${r.toFixed(1)} from the crater`);
    // A pit in its top: the middle lower than the ring round the pit's edge, on average -
    // on average, because the cone it stands on falls away downhill under one side of it.
    let lip = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
      lip += t.worldHeight(v.x + dx * v.pit * 1.1, v.z + dz * v.pit * 1.1) / 8;
    }
    assert.ok(lip - t.worldHeight(v.x, v.z) > 0.5, `a vent at ${v.x.toFixed(0)},${v.z.toFixed(0)} with no pit in its top`);
  }
});

test('lava lies in gullies above the sea and nobody builds in it, beside it or in the crater', () => {
  const t = volcano();
  assert.equal(t.lavaFlows.length, 3, `${t.lavaFlows.length} flows`);
  assert.ok(t.lavaCells.length > 50);
  for (const [gx, gz] of t.lavaCells) {
    assert.equal(t.isLava(gx, gz), true);
    assert.equal(t.isBuildable(gx, gz), false, `lava at (${gx}, ${gz}) is buildable`);
    for (const h of [t.corner(gx, gz), t.corner(gx + 1, gz), t.corner(gx, gz + 1), t.corner(gx + 1, gz + 1)]) {
      assert.ok(h > SEA_LEVEL, `lava at (${gx}, ${gz}) has a corner at ${h}, where the sea shows through`);
    }
  }
  for (const [gx, gz] of t.lavaBankCells) {
    assert.equal(t.isLava(gx, gz), false);
    assert.equal(t.isBuildable(gx, gz), false, `the bank at (${gx}, ${gz}) is buildable`);
  }
  for (let gz = 0; gz < SIZE; gz++) {
    for (let gx = 0; gx < SIZE; gx++) {
      const [x, z] = t.cellWorld(gx, gz);
      if (x * x + z * z < t.crater.r * t.crater.r) assert.equal(t.isBuildable(gx, gz), false, `crater cell (${gx}, ${gz})`);
    }
  }
  // Every flow reaches the sea: its last cell has water beside it, diagonals included.
  for (const course of t.lavaFlows) {
    const [gx, gz] = course[course.length - 1];
    let wet = false;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (t.isWater(gx + dx, gz + dz)) wet = true;
    assert.ok(wet, `a flow stops at (${gx}, ${gz}), short of the sea`);
    // And it is a gully and not a canal: under the ground either side, by about LAVA_DEPTH -
    // more where the flow has found one of the ravines, which is what it looks for. Measured
    // at five points down the middle of it rather than one, so a single ravine does not
    // carry or sink the test.
    const depths = [];
    for (const u of [0.3, 0.4, 0.5, 0.6, 0.7]) {
      const i = Math.floor(course.length * u);
      const mid = course[i], prev = course[i - 1], next = course[i + 1];
      const [x, z] = t.cellWorld(mid[0], mid[1]);
      const dx = next[0] - prev[0], dz = next[1] - prev[1], L = Math.sqrt(dx * dx + dz * dz);
      const side = (k) => t.worldHeight(x - (dz / L) * k, z + (dx / L) * k);
      depths.push((side(2.5) + side(-2.5)) / 2 - t.worldHeight(x, z));
    }
    depths.sort((p, q) => p - q);
    assert.ok(depths[2] > 0.15 && depths[2] < 3, `the gully down the middle is ${depths[2]} deep`);
  }
});

test('a flow is an unbroken chain of cells that bends on its way down', () => {
  // Routed as a greedy walk the flows ran down the fall line, 52 cells straying at most five
  // from the straight line between their ends, and from orbit they were two ruled lines. What
  // lavaCourse promises instead: a chain the gully, the banks and the ribbon can all follow,
  // that swings well off that line and back again more than once, and never climbs back
  // towards the crater. "Back again" is counted as turns of at least a cell and a half in
  // its offset from that line (a zigzag with that much hysteresis): an arc out and home is
  // one turn, a meander is several. It used to be "to both sides of the line", which the
  // 128-grid flows met at 9.9/3.5 and 2.1/6.7; on the 192 one a flow can sweep round the
  // cone to one side of its chord and still bend three times on the way, which is the thing
  // worth holding. Measured: 5, 4 and 3 turns (the 128-grid flows made 2 and 4).
  const t = volcano();
  const turnsOf = (off) => {
    let turns = 0, up = null, ext = off[0];
    for (const o of off) {
      if (up === null) { if (o - ext >= 1.5) { up = true; ext = o; } else if (ext - o >= 1.5) { up = false; ext = o; } continue; }
      if (up) { if (o > ext) ext = o; else if (ext - o >= 1.5) { turns++; up = false; ext = o; } }
      else if (o < ext) ext = o; else if (o - ext >= 1.5) { turns++; up = true; ext = o; }
    }
    return turns;
  };
  for (const course of t.lavaFlows) {
    for (let i = 1; i < course.length; i++) {
      const step = Math.abs(course[i][0] - course[i - 1][0]) + Math.abs(course[i][1] - course[i - 1][1]);
      assert.equal(step, 1, `a gap in the flow between ${course[i - 1]} and ${course[i]}`);
    }
    const [a, b] = [course[0], course[course.length - 1]];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.sqrt(dx * dx + dz * dz);
    let left = 0, right = 0, far = 0;
    const offs = [];
    for (const [gx, gz] of course) {
      const [x, z] = t.cellWorld(gx, gz);
      const r = Math.sqrt(x * x + z * z);
      assert.ok(r >= far - 1, `the flow climbs back towards the crater at (${gx}, ${gz})`);
      far = Math.max(far, r);
      const off = ((gx - a[0]) * dz - (gz - a[1]) * dx) / L;
      left = Math.max(left, off); right = Math.max(right, -off);
      offs.push(off);
    }
    assert.ok(Math.max(left, right) >= 6, `a flow strays only ${Math.max(left, right).toFixed(1)} cells from a straight line`);
    assert.ok(turnsOf(offs) >= 2, `a flow turns only ${turnsOf(offs)} times: an arc, not a meander`);
  }
});

test('the lower flank is ground the sea can build on', () => {
  const t = volcano();
  let n = 0;
  for (const [gx, gz] of t.landCells) if (t.isBuildable(gx, gz)) n++;
  assert.ok(n > 1500, `only ${n} buildable cells on the whole mountain`);
  assert.ok(n < t.landCells.length, 'everything is buildable, which the upper flank is not');
  // All the way round, not on one side: the sea scatters houses by hash over the whole
  // mountain, and a lava flow or a steep ridge must not have eaten a quarter of it.
  const quarter = [0, 0, 0, 0];
  for (const [gx, gz] of t.landCells) {
    if (!t.isBuildable(gx, gz)) continue;
    assert.ok(t.heightAt(gx, gz) < BUILD_HEIGHT_MAX);
    quarter[(gx < SIZE / 2 ? 0 : 1) + (gz < SIZE / 2 ? 0 : 2)]++;
  }
  for (const q of quarter) assert.ok(q > 300, `a quarter of the mountain has only ${q} buildable cells`);
});

test('the crater rim can be walked to from the beach, all the way round, the way a guard walks', () => {
  // On the ground lib/hostility.mjs hands a guard's search: land, with the lava left out
  // except where one of the bridges (shared/volcano.mjs volcanoBridges) carries a deck over
  // it. From the beach on eight bearings to the highest dry rim cell on the same bearing,
  // so no side of the mountain is cut off by a flow or a cliff band.
  //
  // It is a climb now and not a stroll: the 128-grid volcano's every step was under 1.2,
  // this one's upper cone has cliff bands and ravine walls a route may have to cross (the
  // steepest measured is 3.7). A* prices slope rather than refusing it and a walker's feet
  // have no slope rule at all, so what is held is that the way up exists, that it is mostly
  // walking (median slope under one) and that it never goes up a sheer face.
  const t = volcano();
  const deck = new Set();
  for (const b of volcanoBridges(t)) for (const [gx, gz] of b.cells) deck.add(gx + gz * SIZE);
  const ground = { ...t, isLand: (gx, gz) => t.isLand(gx, gz) && (!t.isLava(gx, gz) || deck.has(gx + gz * SIZE)) };
  for (const dir of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
    const beach = t.beachCells.reduce((best, c) => {
      const score = (c[0] - SIZE / 2) * dir[0] + (c[1] - SIZE / 2) * dir[1];
      const was = (best[0] - SIZE / 2) * dir[0] + (best[1] - SIZE / 2) * dir[1];
      return score > was ? c : best;
    });
    let rim = null, high = -Infinity;
    for (let r = t.crater.r - 1; r <= t.crater.r + 2; r += 0.5) {
      const c = [Math.floor(SIZE / 2 + dir[0] * r), Math.floor(SIZE / 2 + dir[1] * r)];
      if (ground.isLand(...c) && t.heightAt(...c) > high) { high = t.heightAt(...c); rim = c; }
    }
    assert.ok(high > 30, `the rim on bearing ${dir} is only ${high} up`);
    const path = findPath(ground, beach, rim, null);
    assert.ok(path && path.length > 30, `no way up from the beach at (${beach}) to the rim at (${rim})`);
    const slopes = path.map(([x, z]) => t.slope(Math.floor(x + SIZE / 2), Math.floor(z + SIZE / 2))).sort((p, q) => p - q);
    assert.ok(slopes[slopes.length >> 1] < 1, `the climb from (${beach}) is mostly steeper than one: ${slopes[slopes.length >> 1]}`);
    assert.ok(slopes[slopes.length - 1] < 4.5, `the climb from (${beach}) goes up a face of ${slopes[slopes.length - 1]}`);
    for (const [x, z] of path) {
      const gx = Math.floor(x + SIZE / 2), gz = Math.floor(z + SIZE / 2);
      if (t.isLava(gx, gz)) assert.ok(deck.has(gx + gz * SIZE), `the climb from (${beach}) wades the lava at (${gx}, ${gz})`);
    }
  }
});

test('a small volcano does not fall over', () => {
  const t = makeTerrain('volcano', { size: 64, volcano: true });
  assert.ok(t.crater.r > 2);
  assert.ok(t.lavaFlows.length >= 1);
  for (const [gx, gz] of t.lavaCells) assert.ok(t.heightAt(gx, gz) > SEA_LEVEL);
});

test('shared/terrain.mjs still does its arithmetic without transcendental functions', () => {
  // The rule from the top of shared/rng.mjs: two runtimes may differ in the last bit of a
  // sin or a pow, and a last bit is a different heightfield and a mismatched hash. sqrt is
  // correctly rounded by IEEE 754 and allowed.
  const src = fs.readFileSync(new URL('../shared/terrain.mjs', import.meta.url), 'utf8')
    .replace(/\/\/.*$/gm, '');
  for (const fn of ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'pow', 'exp', 'log', 'hypot', 'cbrt', 'sinh', 'cosh', 'tanh']) {
    assert.ok(!new RegExp(`Math\\.${fn}\\b`).test(src), `shared/terrain.mjs calls Math.${fn}`);
  }
});

// ---- the drawing ----------------------------------------------------------------------
// Same preamble as tests/guest-landscape.test.mjs: buildings.js makes a TextureLoader at
// import time, and the ground asks for its sheets while it is being built.
globalThis.document = {
  createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }),
};
const THREE = await import('three');
const { createLandscape, seasonOf } = await import('../web/js/world.js');

const EMPTY = {
  island: { town: null, lattice: null },
  districts: [], buildings: [], paths: [], bridges: [], cleared: [], polders: [],
};

test('a volcano is drawn with lava and smoke and without a wood', () => {
  const terrain = volcano();
  // Where guest-island.js puts a region: in a group at its berth, drawn in local coordinates.
  const parent = new THREE.Group();
  parent.position.set(300, 0, -170);
  const land = createLandscape({ parent, terrain, village: EMPTY, season: seasonOf(8), skipSeabed: true });
  const dressing = parent.getObjectByName('volcano');
  assert.ok(dressing, 'no volcano dressing in the landscape');
  const lava = dressing.children.filter((o) => o.isMesh && !o.isInstancedMesh);
  const smoke = dressing.children.filter((o) => o.isInstancedMesh);
  assert.equal(lava.length, 1, 'every flow and the pool are one draw call');
  assert.equal(smoke.length, 1, 'the smoke and the steam are one draw call');
  assert.equal(lava[0].castShadow, false);
  // One smoke source in the crater and one steam source per flow.
  assert.ok(smoke[0].count >= 14 + 6 * terrain.lavaFlows.length - 1);
  // In the island's own frame: the offset is the group's business, not the geometry's.
  const sphere = lava[0].geometry.boundingSphere;
  assert.ok(Math.abs(sphere.center.x) < terrain.half && Math.abs(sphere.center.z) < terrain.half);
  // Nothing grows: every instanced set but the boulders, the coastal shelves and the smoke is empty.
  const grown = [];
  parent.traverse((o) => {
    if (!o.isInstancedMesh || o === smoke[0]) return;
    grown.push(o.count);
  });
  const total = grown.reduce((a, b) => a + b, 0);
  assert.ok(total > 0, 'not even a boulder');
  assert.ok(total < 2000, `${total} instances on a volcano - is the forest growing on it?`);
  land.update(0.5, 8);
  land.dispose();
  assert.equal(parent.children.length, 0);
});

test('an ordinary island gets no volcano dressing', () => {
  const parent = new THREE.Group();
  createLandscape({ parent, terrain: makeTerrain(1337, { size: 64 }), village: EMPTY, season: seasonOf(8) });
  assert.equal(parent.getObjectByName('volcano'), undefined);
});
