import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createQuayBasin, BASIN_FLOOR, BASIN_DECK } from '../shared/quay-basin.mjs';
register('./support/shared-loader.mjs', import.meta.url);
const { buildQuayBasin, sampleGroundAttribute } = await import('../web/js/quay-basin.js');
const THREE = await import('three');

const terrain = { size: 8, half: 4, worldHeight: () => 1.6 };
const village = {
  island: { lattice: { anchor: [0, 0], pitch: 1 } },
  districts: [{ kind: 'quay', deck: [[2, 2], [3, 2], [4, 2]],
    lobes: [{ parcel: { i0: 2, j0: 2, w: 3, h: 3, rows: ['111', '111', '111'] } }] }],
};

test('the bed has one cell of clearance and leaves the saved ground intact', () => {
  const wide = structuredClone(village);
  wide.districts[0].lobes[0].parcel = { i0: 2, j0: 2, w: 10, h: 10, rows: Array(10).fill('1111111111') };
  const ground = { ...terrain, size: 16, half: 8, seed: 1337 };
  const before = JSON.stringify(wide);
  const basin = createQuayBasin(wide, ground);
  assert.ok(Math.abs(basin.height(0, 0) - BASIN_FLOOR) < 1e-9);
  assert.equal(basin.height(-7, 0), 1.6);
  assert.equal(ground.worldHeight(0, 0), 1.6);
  assert.equal(JSON.stringify(wide), before);
  assert.equal(basin.edges.length, 48);
  const mesh = buildQuayBasin(basin, ground);
  for (const m of mesh.children) {
    const p = m.geometry.attributes.position;
    for (const n of p.array) assert.ok(Number.isFinite(n));
  }
  mesh.children[0].geometry.computeBoundingBox();
  assert.ok(Math.abs(mesh.children[0].geometry.boundingBox.min.y - BASIN_FLOOR) < 1e-6);
  const bed = mesh.children[0].geometry.attributes.position;
  for (let i = 0; i < bed.count; i++) {
    assert.ok(Math.abs(bed.getY(i) - basin.height(bed.getX(i), bed.getZ(i))) < 1e-6,
      'the visible slope agrees with the shared walking and water-depth samples at every vertex');
  }
  assert.equal(basin.height(-7, 0), 1.6, 'the lip meets the uncut ground');
  assert.ok(basin.height(-5, 0) < 1.6 && basin.height(-5, 0) > BASIN_FLOOR, 'the bank slopes down');
  assert.ok(Math.abs(basin.height(-7 + 1e-6, 0) - 1.6) < .00001, 'no vertical retaining face at the lip');
});

test('the outside seam inherits the actual ground colour and lighting normal', () => {
  const ground = new THREE.BufferGeometry();
  const colors = [], normals = [];
  for (let z = 0; z <= terrain.size; z++) for (let x = 0; x <= terrain.size; x++) {
    colors.push(x / terrain.size, z / terrain.size, .3);
    normals.push(0, 1, 0);
  }
  ground.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  ground.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  const basin = createQuayBasin(village, terrain);
  const bank = buildQuayBasin(basin, terrain, { groundGeometry: ground }).children[0].geometry;
  const { position, color, normal, bankCoverage, uv } = bank.attributes;
  let checked = 0;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = position.getZ(i);
    if (basin.bankDistance(x, z) > 1e-6) continue;
    const expected = sampleGroundAttribute(ground, terrain, 'color', x, z);
    assert.ok(Math.abs(color.getX(i) - expected[0]) < 1e-6);
    assert.ok(Math.abs(color.getY(i) - expected[1]) < 1e-6);
    assert.equal(bankCoverage.getX(i), 0, 'no shingle at the seam');
    assert.equal(normal.getY(i), 1, 'no lighting crease at the seam');
    assert.ok(Math.abs(uv.getX(i) - x / 3) < 1e-6, 'the grass texture stays aligned');
    checked++;
  }
  assert.ok(checked > 10);
});

test('the bank stays below the harbour platforms, without moving their plots', () => {
  const v = structuredClone(village);
  v.buildings = [{ harbour: true, plot: { quay: true, gx: 2, gz: 2, w: 3, d: 3 } }];
  const before = JSON.stringify(v);
  const basin = createQuayBasin(v, terrain);
  for (let z = -2; z <= 1; z += .25) for (let x = -2; x <= 1; x += .25) {
    assert.ok(basin.height(x, z) <= -.14999, 'the platform has water under it');
  }
  assert.equal(JSON.stringify(v), before);
});

test('every landing joins the planks to the bank with continuous walking heights', () => {
  const entrance = structuredClone(village);
  entrance.districts[0].lobes[0].parcel = { i0: 2, j0: 1, w: 5, h: 6, rows: Array(6).fill('11111') };
  entrance.districts[0].deck = [[2, 4], [3, 4], [4, 4]];
  const basin = createQuayBasin(entrance, terrain);
  const r = basin.ramps.find(r => r.dx === -1);
  assert.equal(r.length, 3, 'use the straight approach, stopping before the opposite bank');
  for (let i = 0; i <= 100; i++) {
    const t = i / 100;
    const along = (t - 1) * r.length;
    const y = basin.rampHeight(r.x + r.dx * along, r.z + r.dz * along);
    assert.ok(Math.abs(y - (BASIN_DECK + (r.y - BASIN_DECK) * t)) < 1e-9);
    assert.ok(basin.height(r.x + r.dx * along, r.z + r.dz * along) <= y - .024,
      'the rounded bank never pokes through the access planks');
  }
  assert.equal(r.y, terrain.worldHeight(r.x, r.z) + .025);
  assert.equal(basin.rampHeight(r.x + r.dx * .01, r.z + r.dz * .01), null);
});

test('the harbour mouth has no landward ramps when the surrounding coast is water', () => {
  const basin = createQuayBasin(village, { ...terrain, worldHeight: () => -.2 });
  assert.equal(basin.ramps.length, 0);
  assert.equal(buildQuayBasin(basin, { ...terrain, worldHeight: () => -.2 }).children.length, 1);
});
