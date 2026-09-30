// The harbour's stone quay as the sea, the player and the drawing share it (shared/quay-basin.mjs
// `createQuayKade`, web/js/quay-basin.js `buildQuayKade`). The quay itself is ground
// (`works.kade`, tests/kade.test.mjs); what is held here is the wall's face over the cell in front
// of it, and the stairs down that face:
//   - the foot of the wall is every water-side neighbour of a quay cell on the wall, stood on at
//     the quay's own level, and nowhere else is claimed;
//   - stairs stand in front of the face, every STAIR_EVERY cells, never where the water in front
//     is a deck, planks, a plot or a road, in risers of at most STAIR_RISE down to STAIR_FOOT;
//   - the mesh is one mesh, and the treads it draws are the treads the feet stand on;
//   - a village without a quay has none of it.
// It used to test the basin overlay (`createQuayBasin`), which the harbour's real water replaced.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createQuayKade, quayKade, STAIR_EVERY, STAIR_FIRST, STAIR_LEN, STAIR_DEPTH, STAIR_FOOT, STAIR_RISE } from '../shared/quay-basin.mjs';
register('./support/shared-loader.mjs', import.meta.url);
const { buildQuayKade } = await import('../web/js/quay-basin.js');
const THREE = await import('three');

// A quay three wide along x = 10..12, rows 2..29, the land to the east (+x), on a grid of 32.
const terrain = { size: 32, half: 16 };
const kadeCells = [];
for (let z = 2; z <= 29; z++) for (let x = 10; x <= 12; x++) kadeCells.push([x, z]);
const village = { works: { v: 1, kade: { cells: kadeCells, level: 113, back: [1, 0], hold: [] } }, districts: [], buildings: [], paths: [] };
const local = (gx, gz) => [gx - terrain.half + 0.5, gz - terrain.half + 0.5];

test('the foot of the wall is the row in front of it, stood on at the quay\'s level', () => {
  const k = createQuayKade(village, terrain);
  assert.ok(k);
  assert.equal(k.level, 113 / 256);
  assert.equal(k.foot.length, 28, 'one foot cell for each row of the wall');
  assert.ok(k.foot.every((f) => f.gx === 9), 'on the water side, x 9');
  assert.ok(k.foot.every((f) => f.face === 9), 'the face on the foot cell\'s water edge');
  assert.equal(k.runs.length, 1);
  // The top of the wall over the foot (the stairs stand in front of it, not on it); and nothing
  // claimed anywhere else.
  for (let z = 2; z <= 29; z++) assert.equal(k.height(...local(9, z)), 113 / 256, `the wall top at 9,${z}`);
  for (const [gx, gz] of [[10, 10], [12, 10], [13, 10], [9, 1], [9, 30], [5, 10]]) {
    assert.equal(k.height(...local(gx, gz)), null, `${gx},${gz} is not the wall's`);
  }
});

test('the stairs go down the face every so often, in treads the feet can take', () => {
  const k = createQuayKade(village, terrain);
  // 28 rows: flights at the 5th and the 17th cell of the wall (STAIR_FIRST, then STAIR_EVERY on).
  assert.deepEqual(k.stairs.map((s) => s.a0), [2 + STAIR_FIRST, 2 + STAIR_FIRST + STAIR_EVERY]);
  for (const s of k.stairs) {
    assert.ok((s.top - STAIR_FOOT) / s.steps <= STAIR_RISE + 1e-12, 'no riser taller than STAIR_RISE');
    let last = s.top;
    // Down the flight, just in front of the face: never up, one riser at a time, to the foot.
    for (let i = 0; i < 200; i++) {
      const along = s.a0 + (i + 0.5) * STAIR_LEN / 200;
      const X = s.face - STAIR_DEPTH / 2;
      const y = k.height(X - terrain.half, along - terrain.half);
      assert.ok(y <= last + 1e-12, 'the stairs only go down');
      assert.ok(last - y <= STAIR_RISE + 1e-9, 'one riser at a time');
      last = y;
    }
    assert.ok(Math.abs(last - STAIR_FOOT) < 1e-9, 'down to just over the water');
    // Past the flight's depth in front of the face, it is the water's.
    assert.equal(k.height(s.face - STAIR_DEPTH - 0.1 - terrain.half, s.a0 + 1 - terrain.half), null);
  }
});

test('no stairs where the water in front of the wall carries a deck, a plot or a road', () => {
  const k0 = createQuayKade(village, terrain);
  const busy = structuredClone(village);
  busy.districts = [{ kind: 'quay', deck: [[8, k0.stairs[0].a0]] }];
  busy.paths = [{ id: 'road:x', cells: [[8, k0.stairs[1].a0 + 1]] }];
  assert.equal(createQuayKade(busy, terrain).stairs.length, 0);
  const plots = structuredClone(village);
  plots.buildings = [{ plot: { gx: 6, gz: k0.stairs[0].a0 - 1, w: 3, d: 3 } }];
  assert.equal(createQuayKade(plots, terrain).stairs.length, 1);
});

test('one mesh, standing on the bed, and its treads are the ones the feet stand on', () => {
  const k = quayKade(village, terrain);
  assert.equal(quayKade(village, terrain), k, 'asked twice, worked out once');
  const group = buildQuayKade(k, terrain);
  assert.equal(group.children.length, 1, 'one draw call for the whole quay');
  const geo = group.children[0].geometry;
  for (const n of geo.attributes.position.array) assert.ok(Number.isFinite(n));
  geo.computeBoundingBox();
  assert.ok(geo.boundingBox.min.y < -0.55, 'the face reaches under the harbour\'s dug bed');
  assert.ok(geo.boundingBox.max.y < k.level + 0.1);
  group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  for (const s of k.stairs) {
    for (let i = 0; i < s.steps; i++) {
      const along = s.a0 + (i + 0.5) * STAIR_LEN / s.steps;
      const x = s.face - STAIR_DEPTH / 2 - terrain.half, z = along - terrain.half;
      ray.set(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(group.children[0])[0];
      assert.ok(hit, 'each tread is drawn');
      assert.ok(Math.abs(hit.point.y - k.height(x, z)) < 1e-5, 'feet agree with the drawn tread');
    }
  }
  // Over a foot cell, the drawn top is the quay's level (a hair proud).
  const [x, z] = local(9, 3);
  ray.set(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0));
  const top = ray.intersectObject(group.children[0])[0];
  assert.ok(top && top.point.y >= k.level && top.point.y - k.level < 0.1);
});

test('a quay on another side of its harbour turns with it', () => {
  // The land to the north (-z): the wall runs along x and its foot is on the south.
  const cells = [];
  for (let x = 4; x <= 20; x++) for (let z = 8; z <= 10; z++) cells.push([x, z]);
  const v = { works: { v: 1, kade: { cells, level: 113, back: [0, -1], hold: [] } }, districts: [], buildings: [], paths: [] };
  const k = createQuayKade(v, terrain);
  assert.equal(k.foot.length, 17);
  assert.ok(k.foot.every((f) => f.gz === 11 && f.face === 12));
  assert.equal(k.height(...local(12, 11)), 113 / 256);
  assert.equal(k.stairs.length, 1);
  assert.equal(buildQuayKade(k, terrain).children.length, 1);
});

test('a village with no quay has no wall, and draws nothing', () => {
  assert.equal(createQuayKade({ districts: [] }, terrain), null);
  assert.equal(createQuayKade({ works: { v: 1 } }, terrain), null);
  assert.equal(buildQuayKade(null, terrain).children.length, 0);
});
