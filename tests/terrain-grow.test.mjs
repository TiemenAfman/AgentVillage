// An island that grows keeps every corner it had: the founding ground is set down in the
// middle of a bigger grid unchanged, and a growth step only ever raises sea that is joined
// to the open water. Plans/eiland-laten-groeien.md is the design; these are its promises.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTerrain, foundingCoast, gridForCoast, BEACH_MAX } from '../shared/terrain.mjs';

const SEEDS = [1337, 7, 'harbour', 'Hoogezand'];

// The corner of a grown grid that stands where corner (i, j) of the founding grid stood.
function sameCorner(small, big) {
  const k = (big.size - small.size) / 2;
  return (i, j) => big.H[i + k + (j + k) * big.N];
}

test('no growth, or growth of nothing, is the island as it always was', () => {
  for (const seed of SEEDS) {
    for (const size of [32, 64, 128]) {
      const plain = makeTerrain(seed, { size });
      assert.equal(makeTerrain(seed, { size, grow: { base: size, steps: [] } }).hash, plain.hash);
    }
  }
});

test('a bigger grid round the founding one changes no corner of it', () => {
  for (const seed of SEEDS) {
    const small = makeTerrain(seed, { size: 32 });
    const big = makeTerrain(seed, { size: 64, grow: { base: 32, steps: [] } });
    const at = sameCorner(small, big);
    for (let j = 0; j < small.N; j++) {
      for (let i = 0; i < small.N; i++) assert.equal(at(i, j), small.H[i + j * small.N], `${seed} corner ${i},${j}`);
    }
    assert.equal(big.landCells.length, small.landCells.length, 'land appeared that nobody grew');
    // The rivers are the founding grid's, moved with it.
    assert.equal(big.rivers.length, small.rivers.length);
  }
});

// The corners a step promises to leave: everything above the beach, and every corner of a
// cell it was told to hold (local coordinates, as the step keeps them).
function fixedCorners(t, hold = []) {
  const out = new Set();
  for (let k = 0; k < t.H.length; k++) if (t.H[k] >= BEACH_MAX) out.add(k);
  for (const [lx, lz] of hold) {
    const gx = lx + t.half, gz = lz + t.half;
    for (const [i, j] of [[gx, gz], [gx + 1, gz], [gx, gz + 1], [gx + 1, gz + 1]]) out.add(i + j * t.N);
  }
  return out;
}

// Buildable cells on the old shore that have a corner low enough to move: exactly what a
// house standing there would need held.
function lowShore(t) {
  return t.landCells.filter(([gx, gz]) => t.isBuildable(gx, gz)
    && [[gx, gz], [gx + 1, gz], [gx, gz + 1], [gx + 1, gz + 1]].some(([i, j]) => t.H[i + j * t.N] < BEACH_MAX));
}

test('a growth step adds land, leaves everything above the beach, and never digs', () => {
  for (const seed of SEEDS) {
    const base = 32;
    const r = foundingCoast(base) * 1.7;
    const size = gridForCoast(r);
    const before = makeTerrain(seed, { size, grow: { base, steps: [] } });
    const after = makeTerrain(seed, { size, grow: { base, steps: [r] } });
    assert.ok(after.landCells.length > before.landCells.length * 1.5, `${seed}: ${before.landCells.length} -> ${after.landCells.length}`);
    const fixed = fixedCorners(before);
    for (let k = 0; k < before.H.length; k++) {
      if (fixed.has(k)) assert.equal(after.H[k], before.H[k], `${seed}: corner ${k} above the beach moved`);
      else assert.ok(after.H[k] >= before.H[k], `${seed}: corner ${k} was dug`);
    }
    // Every founding river cell is still water: the ring does not fill the river bed.
    for (const [gx, gz] of before.riverCells) assert.ok(after.isWater(gx, gz), `${seed}: river at ${gx},${gz} filled`);
  }
});

test('a held cell keeps its corners, and the shore round it rises', () => {
  for (const seed of SEEDS) {
    const base = 32, r = foundingCoast(base) * 1.7, size = gridForCoast(r);
    const before = makeTerrain(seed, { size, grow: { base, steps: [] } });
    const shore = lowShore(before);
    assert.ok(shore.length > 0, `${seed}: no low buildable shore to hold`);
    const hold = shore.slice(0, 5).map(([gx, gz]) => [gx - before.half, gz - before.half]);
    const free = makeTerrain(seed, { size, grow: { base, steps: [r] } });
    const held = makeTerrain(seed, { size, grow: { base, steps: [{ r, hold }] } });
    const corners = (t, [gx, gz]) => [[gx, gz], [gx + 1, gz], [gx, gz + 1], [gx + 1, gz + 1]].map(([i, j]) => t.H[i + j * t.N]);
    let moved = 0;
    for (const c of shore.slice(0, 5)) {
      assert.deepEqual(corners(held, c), corners(before, c), `${seed}: held ${c} moved`);
      if (corners(free, c).some((v, i) => v !== corners(before, c)[i])) moved++;
    }
    assert.ok(moved > 0, `${seed}: holding made no difference - the test proves nothing`);
    assert.ok(held.isBuildable(...shore[0]), 'a held cell is still ground to build on');
  }
});

test('the grid a grown island is drawn on makes no difference to it', () => {
  for (const seed of SEEDS) {
    const r = foundingCoast(32) * 1.7;
    const size = gridForCoast(r);
    const a = makeTerrain(seed, { size, grow: { base: 32, steps: [r] } });
    const b = makeTerrain(seed, { size: size + 16, grow: { base: 32, steps: [r] } });
    const at = sameCorner(a, b);
    for (let j = 0; j < a.N; j++) {
      for (let i = 0; i < a.N; i++) assert.equal(at(i, j), a.H[i + j * a.N], `${seed} corner ${i},${j}`);
    }
    assert.equal(a.landCells.length, b.landCells.length);
  }
});

test('two steps are two rings, and the same steps are the same island', () => {
  const seed = 1337, base = 32;
  const r1 = foundingCoast(base) * 1.4, r2 = foundingCoast(base) * 2;
  const size = gridForCoast(r2);
  const one = makeTerrain(seed, { size, grow: { base, steps: [r1] } });
  const two = makeTerrain(seed, { size, grow: { base, steps: [r1, r2] } });
  assert.ok(two.landCells.length > one.landCells.length);
  for (const k of fixedCorners(one)) assert.equal(two.H[k], one.H[k]);
  assert.equal(makeTerrain(seed, { size, grow: { base, steps: [r1, r2] } }).hash, two.hash);
});

test('a growth that does not fit or does not grow is refused', () => {
  const r = foundingCoast(32) * 1.7;
  assert.throws(() => makeTerrain(1, { size: 48, grow: { base: 64, steps: [] } }), /cannot be drawn/);
  assert.throws(() => makeTerrain(1, { size: 65, grow: { base: 32, steps: [] } }), /cannot be drawn/);
  assert.throws(() => makeTerrain(1, { size: gridForCoast(r) - 2, grow: { base: 32, steps: [r] } }), /needs a grid/);
  assert.throws(() => makeTerrain(1, { size: 128, grow: { base: 32, steps: [10] } }), /does not grow/);
  assert.throws(() => makeTerrain(1, { size: 128, grow: { base: 32, steps: [30, 25] } }), /does not grow/);
  // The volcano never grows: the option is ignored rather than honoured.
  const v = makeTerrain('volcano', { size: 192, volcano: true });
  assert.equal(makeTerrain('volcano', { size: 192, volcano: true, grow: { base: 64, steps: [] } }).hash, v.hash);
  // A relief this code does not know is somebody else's ground, not ours drawn flat.
  assert.throws(() => makeTerrain(1, { size: 128, grow: { base: 32, steps: [{ r: 30, relief: 2 }] } }), /relief 2/);
});

// ---- relief (growRelief) ------------------------------------------------------------------
// The rings growStep takes from a 32 founding, nextCoast's third at a time.
function chain(n) {
  const rs = [];
  let last = foundingCoast(32);
  for (let i = 0; i < n; i++) { const r = Math.floor(last) + Math.max(4, Math.ceil(last * 0.3)); rs.push(r); last = r; }
  return rs;
}
const RINGS = chain(7);                                      // 20 26 34 45 59 77 101
const HOLD = [[-3, 14], [5, -15]];
const stepsOf = (rs, relief) => rs.map((r) => ({ r, grid: Math.max(64, gridForCoast(r)), hold: HOLD, ...(relief ? { relief } : {}) }));
const grown = (seed, rs, relief, size = 224) => makeTerrain(seed, { size, grow: { base: 32, steps: stepsOf(rs, relief) } });

// Recorded before relief existed, on the code that drew every grown island there is. A
// change here is every one of those islands re-planned from nothing on its next scan.
test('islands without relief hash exactly as they did before relief existed', () => {
  const plain = { '1337@256': '8737677c', '7@128': 'c3b8eb64', 'harbour@64': '697d1571', 'Hoogezand@32': 'e0e6a7e7' };
  for (const [key, hash] of Object.entries(plain)) {
    const [seed, size] = key.split('@');
    assert.equal(makeTerrain(/^\d+$/.test(seed) ? Number(seed) : seed, { size: Number(size) }).hash, hash, key);
  }
  const old = { 1337: '731d6ca7', 7: 'ee0e3ad7', harbour: '89b625bb', Hoogezand: 'e7a52ca2' };
  for (const [seed, hash] of Object.entries(old)) {
    const s = /^\d+$/.test(seed) ? Number(seed) : seed;
    assert.equal(grown(s, RINGS, 0, 256).hash, hash, `${seed}, grown with steps from before relief`);
    assert.equal(grown(s, RINGS, 0, 256).hash, makeTerrain(s, { size: 256, grow: { base: 32, steps: stepsOf(RINGS).map((st) => ({ ...st, relief: 0 })) } }).hash,
      `${seed}: relief 0 is not the same as no relief`);
  }
  const r = foundingCoast(32) * 1.7;
  assert.equal(makeTerrain(1337, { size: gridForCoast(r), grow: { base: 32, steps: [r] } }).hash, '0f6e796f', 'a bare step');
});

test('a ring with relief keeps every promise a flat ring makes', () => {
  for (const seed of SEEDS) {
    for (let k = 1; k <= RINGS.length; k++) {
      const before = grown(seed, RINGS.slice(0, k - 1), 1);
      const after = grown(seed, RINGS.slice(0, k), 1);
      const fixed = fixedCorners(before, HOLD);
      for (let c = 0; c < before.H.length; c++) {
        if (fixed.has(c)) assert.equal(after.H[c], before.H[c], `${seed} ring ${k}: corner ${c} above the beach or held moved`);
        else assert.ok(after.H[c] >= before.H[c], `${seed} ring ${k}: corner ${c} was dug`);
      }
      // Every river the island had is still water along its whole course.
      for (const course of before.rivers) {
        for (const [gx, gz] of course) assert.ok(after.isWater(gx, gz), `${seed} ring ${k}: a river at ${gx},${gz} was filled`);
      }
    }
  }
});

test('relief is the same on any grid the steps fit', () => {
  for (const seed of SEEDS) {
    const a = grown(seed, RINGS, 1, 224);
    const b = grown(seed, RINGS, 1, 256);
    const at = sameCorner(a, b);
    for (let j = 0; j < a.N; j++) {
      for (let i = 0; i < a.N; i++) assert.equal(at(i, j), a.H[i + j * a.N], `${seed} corner ${i},${j}`);
    }
    assert.equal(a.rivers.length, b.rivers.length);
    assert.equal(grown(seed, RINGS, 1).hash, a.hash, 'the same steps drew a different island');
  }
});

test('relief gives the new ground hills and rivers that reach the sea, and leaves it buildable', () => {
  let hills = 0, rivers = 0, flat = 0, rough = 0;
  for (const seed of SEEDS) {
    const plain = grown(seed, RINGS, 0);
    const t = grown(seed, RINGS, 1);
    assert.notEqual(t.hash, plain.hash, `${seed}: relief drew the same ground`);
    // High ground away from the founding hill, i.e. in the rings: the founding hill stands
    // 11-15 cells off the middle, so anything past 30 is new.
    const high = (x) => x.landCells.filter(([gx, gz]) => {
      const [lx, lz] = [gx - x.half + 0.5, gz - x.half + 0.5];
      return lx * lx + lz * lz > 30 * 30 && x.heightAt(gx, gz) > 3;
    }).length;
    hills += high(t) - high(plain);
    rivers += t.rivers.length;
    // A river is only worth drawing if it gets to the sea: flood the water from the grid's
    // edge, and every relief river's last cell must be in or beside it.
    const open = new Uint8Array(t.size * t.size);
    const queue = [];
    for (let g = 0; g < t.size; g++) for (const c of [[g, 0], [g, t.size - 1], [0, g], [t.size - 1, g]]) queue.push(c);
    while (queue.length) {
      const [gx, gz] = queue.pop();
      if (!t.inGrid(gx, gz) || open[gx + gz * t.size] || !t.isWater(gx, gz)) continue;
      open[gx + gz * t.size] = 1;
      queue.push([gx + 1, gz], [gx - 1, gz], [gx, gz + 1], [gx, gz - 1]);
    }
    const nearOpen = ([gx, gz]) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => t.inGrid(gx + dx, gz + dz) && open[gx + dx + (gz + dz) * t.size]);
    for (const course of t.rivers) assert.ok(course.some(nearOpen), `${seed}: a river from ${course[0]} never reaches the sea`);
    const buildable = (x) => x.landCells.filter(([gx, gz]) => x.isBuildable(gx, gz)).length;
    flat += buildable(plain); rough += buildable(t);
  }
  assert.ok(hills > 100 * SEEDS.length, `only ${hills} cells of new high ground over ${SEEDS.length} islands`);
  assert.ok(rivers >= SEEDS.length, `only ${rivers} rivers over ${SEEDS.length} islands`);
  // Measured at 4.7% over seven seeds when this was written (3.3-6.5% per island).
  assert.ok(rough > flat * 0.92, `relief cost ${((1 - rough / flat) * 100).toFixed(1)}% of the building ground`);
});
