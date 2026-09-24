// The grid itself grows (Plans/eiland-laten-groeien.md, fase 4): every grid index in the
// layout goes up by k, nothing moves in the world, the ground under everything is the ground
// it was, and an island founded on its whole grid can grow once the setting leaves it room.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { placeAll, emptyLayout, growCanvas, loadLayout, canGrowFurther } from '../lib/layout.mjs';
import { makeTerrain } from '../shared/terrain.mjs';
import { village, clone } from './support/village.mjs';

const SEED = 1337;
const groundOf = (l) => makeTerrain(SEED, { size: l.size, polders: l.polders, fairway: l.fairway, grow: l.grow });
const houses = (l) => Object.keys(l.plots).filter((id) => id.startsWith('house:')).length;

function withQuay(n, quay = 3) {
  const m = village(n, { projects: Math.max(1, Math.round(n / 4)) });
  m.districts.push({ id: 'quay', kind: 'quay', name: 'The Quay', firstSeenAt: 999, population: quay });
  for (let k = 0; k < quay; k++) m.buildings.push({ id: `house:quay:${k}`, kind: 'house', district: 'quay', startedAt: 1500 + k });
  m.stats.settlers = n + quay;
  return m;
}

// A settled island founded on its whole grid, with a quay, polders and roads - every kind of
// cell list a layout keeps. 170 settlers puts the polder ladder past its first rungs.
function settledWhole(size = 128, n = 170) {
  const layout = emptyLayout(SEED, size);
  placeAll(layout, withQuay(n), { seed: SEED, size });
  placeAll(layout, withQuay(n), { seed: SEED, size });
  return layout;
}

// Every [a, b] pair of whole numbers in the layout, by its path.
function pairs(v, at = '', out = new Map()) {
  if (Array.isArray(v)) {
    if (v.length === 2 && v.every(Number.isInteger)) { out.set(at, v); return out; }
    v.forEach((x, i) => pairs(x, `${at}[${i}]`, out));
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) pairs(x, `${at}.${k}`, out);
  }
  return out;
}
// Measured from the lattice anchor, which moves with everything, so rightly left alone.
const SUPER = [/\.lobes\[\d+\]\.(seed|cells)/, /^\.town\.commons/, /^\.polders\[\d+\]\.(supers|seed)/, /^\.zones/, /^\.grow\./, /\.cell$/];

test('a bigger grid moves every grid index by k and no super-cell, and names every field', () => {
  const before = settledWhole();
  assert.ok(before.polders.length, 'the island needs polders for this test to mean anything');
  assert.ok(before.districts.quay && before.districts.quay.pier.length, 'and a quay');
  const k = 16;
  const after = growCanvas(clone(before), before.size + 2 * k);
  assert.equal(after.size, before.size + 2 * k);
  assert.deepEqual(after.grow, { base: before.size, steps: [] });

  const a = pairs(before), b = pairs(after);
  const forgotten = [];
  for (const [at, [x, z]] of a) {
    const [x2, z2] = b.get(at);
    const superField = SUPER.some((re) => re.test(at));
    if (x2 === x + k && z2 === z + k) assert.ok(!superField, `${at} is a super-cell and moved`);
    else if (x2 === x && z2 === z) { if (!superField) forgotten.push(at); }
    else assert.fail(`${at} went from ${x},${z} to ${x2},${z2}`);
  }
  // Grouped, so a forgotten list reads as one field rather than a thousand cells.
  const fields = [...new Set(forgotten.map((p) => p.replace(/\[\d+\]/g, '[]')))];
  assert.deepEqual(fields, [], `grid cells left behind: ${fields.join(', ')}`);
  for (const [id, p] of Object.entries(before.plots)) {
    assert.equal(after.plots[id].gx, p.gx + k, id);
    assert.equal(after.plots[id].gz, p.gz + k, id);
  }
});

// A village the founding grid already holds in full, so the only thing that happens is the
// bigger grid: with houses left over the island would grow into it, and rightly move its quay.
test('the ground under a bigger grid is the ground it was, corner for corner', () => {
  const N = 100;
  const before = settledWhole(128, N);
  assert.equal(houses(before), N + 3, 'the village has to fit for this test');
  const k = 16;
  const after = growCanvas(clone(before), before.size + 2 * k);
  const T0 = groundOf(before), T1 = groundOf(after);
  for (let j = 0; j < T0.N; j++) {
    for (let i = 0; i < T0.N; i++) assert.equal(T1.H[i + k + (j + k) * T1.N], T0.H[i + j * T0.N], `corner ${i},${j}`);
  }
  // And the scan after it keeps everything: the hash is recorded, nothing is re-planned.
  after.terrainHash = T1.hash;
  const m = withQuay(N);
  placeAll(after, m, { seed: SEED, size: after.size });
  for (const [id, p] of Object.entries(before.plots)) {
    const q = after.plots[id];
    assert.ok(q, `${id} was lost`);
    assert.deepEqual([q.gx - k, q.gz - k, q.rot], [p.gx, p.gz, p.rot], `${id} moved`);
  }
  const once = JSON.stringify(after);
  placeAll(after, m, { seed: SEED, size: after.size });
  assert.equal(JSON.stringify(after), once, 'the scan after that one changed the layout');
});

test('an island founded on its whole grid grows once the setting gives it room', () => {
  const size = 64;
  const m = withQuay(90);
  const layout = emptyLayout(SEED, size);
  placeAll(layout, m, { seed: SEED, size });
  placeAll(layout, m, { seed: SEED, size });
  const was = houses(layout);
  assert.ok(was < 93, 'the test needs a village the founding grid cannot hold');
  assert.equal(canGrowFurther(layout, size), false, 'with no room it may not grow');
  const stood = Object.fromEntries(Object.entries(layout.plots).filter(([id]) => !id.includes(':quay:') && id !== 'civic:lighthouse' && id !== 'civic:crane')
    .map(([id, p]) => [id, [p.gx - size / 2, p.gz - size / 2, p.rot]]));

  placeAll(layout, m, { seed: SEED, size, cap: 160 });
  assert.ok(layout.size > size && layout.size <= 160, `the grid is ${layout.size}`);
  assert.ok(layout.grow && layout.grow.base === size && layout.grow.steps.length > 0);
  assert.ok(houses(layout) > was, `${was} -> ${houses(layout)} houses`);
  assert.equal(layout.terrainHash, groundOf(layout).hash);
  for (const [id, at] of Object.entries(stood)) {
    const p = layout.plots[id];
    assert.deepEqual([p.gx - layout.size / 2, p.gz - layout.size / 2, p.rot], at, `${id} moved`);
  }
  const once = JSON.stringify(layout);
  placeAll(layout, m, { seed: SEED, size: layout.size, cap: 160 });
  assert.equal(JSON.stringify(layout), once, 'the scan after growing changed the layout');
});

test('a layout on a different grid from the setting is kept, not thrown away', () => {
  const layout = settledWhole(64, 20);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptholm-canvas-'));
  const file = path.join(dir, 'layout.json');
  fs.writeFileSync(file, JSON.stringify(layout));
  const read = loadLayout(file, SEED, 256);
  assert.equal(read.size, 64, 'raising gridSize threw the town away');
  assert.equal(Object.keys(read.plots).length, Object.keys(layout.plots).length);
  assert.equal(loadLayout(file, SEED + 1, 256).town, null, 'a different seed is still a new island');
  fs.rmSync(dir, { recursive: true, force: true });
});

// A new install is founded small on a small grid (FOUNDING) and both grow with the village:
// the grid a step of 32 at a time, only when a ring does not fit, and never past the cap.
test('an island founded on a small grid grows the grid only as far as its village needs', () => {
  const layout = emptyLayout(SEED, 64, { base: 32, steps: [] });
  const sizes = [];
  for (let n = 10; n <= 150; n += 10) {
    const m = withQuay(n);
    placeAll(layout, m, { seed: SEED, size: layout.size, cap: 384 });
    if (sizes[sizes.length - 1] !== layout.size) sizes.push(layout.size);
    assert.equal(houses(layout), n + 3, `${n}: not everybody was housed`);
    assert.equal(layout.terrainHash, groundOf(layout).hash, `${n}: the hash on record`);
  }
  for (const s of sizes) assert.equal((s - 64) % 32, 0, `a grid of ${s} is not 64 plus steps of 32`);
  assert.ok(layout.size < 384, `150 settlers took the whole cap (${sizes.join(' -> ')})`);
  const once = JSON.stringify(layout);
  placeAll(layout, withQuay(150), { seed: SEED, size: layout.size, cap: 384 });
  assert.equal(JSON.stringify(layout), once);
});

// Growing on demand used to cost far more land than founding big: a hamlet that no ring can
// help (at MAX_LOBES, or short of a free block rather than of land) asked for a ring on every
// scan it gained a house. Ten settlers a scan to 340 on this seed took the coast to 172 on a
// grid of 384, three rings each for one house that went to the commons anyway; with only
// `landWouldHelp` asking it stops at 101 on 224 (measured; seven other seeds too). 120 is the
// coast of an island founded on a whole 256 grid, which is the bar it has to stay under.
test('a village growing gradually needs no more coast than one founded on a whole grid', () => {
  const layout = emptyLayout(SEED, 64, { base: 32, steps: [] });
  for (let n = 10; n <= 340; n += 10) {
    const m = village(n, { projects: Math.min(39, 3 + Math.floor(n / 9)) });
    placeAll(layout, m, { seed: SEED, size: layout.size, cap: 384 });
    const want = m.buildings.filter((b) => b.kind === 'house');
    assert.ok(want.every((b) => layout.plots[b.id]), `${n}: not everybody was housed`);
  }
  const coast = layout.grow.steps[layout.grow.steps.length - 1].r;
  assert.ok(coast <= 120, `340 settlers took a coast of ${coast} on a grid of ${layout.size}`);
  assert.ok(layout.size <= 256, `and a grid of ${layout.size}`);
  assert.equal(layout.terrainHash, groundOf(layout).hash);
  const once = JSON.stringify(layout);
  placeAll(layout, village(340, { projects: 39 }), { seed: SEED, size: layout.size, cap: 384 });
  assert.equal(JSON.stringify(layout), once, 'the scan after that one changed the layout');
});
