import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';

register('./support/shared-loader.mjs', import.meta.url);
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { buildBuilding, buildFountainWaterGeometry } = await import('../web/js/buildings.js');
const { attachFountain, updateFountain } = await import('../web/js/fountain.js');
delete globalThis.document;

test('the Blender fountain publishes separate animated water', () => {
  const built = buildBuilding({ id: 'civic:fountain', kind: 'civic', civicType: 'fountain', style: 'unknown' });
  assert.deepEqual(built.animated.fountain.at, [0, 0, 0]);

  const surfaces = buildFountainWaterGeometry('surface');
  const jets = buildFountainWaterGeometry('jets');
  assert.ok(surfaces.attributes.position.count > 100, 'both bowls have a real water surface');
  assert.ok(jets.attributes.position.count > 100, 'the four streams have their own geometry');
  surfaces.computeBoundingBox();
  jets.computeBoundingBox();
  assert.ok(surfaces.boundingBox.max.y > 0.9, 'the upper bowl is present');
  assert.ok(jets.boundingBox.min.y < 0.4 && jets.boundingBox.max.y > 0.85, 'streams reach bowl to basin');
});

test('fountain water ripples from its authored shape without drifting', () => {
  const group = new THREE.Group();
  const fountain = attachFountain(group, [0, 0, 0], new THREE.MeshBasicMaterial());
  const authored = new Float32Array(fountain.base);

  updateFountain(fountain, 0.25);
  const moved = fountain.surface.geometry.attributes.position.array;
  assert.ok(moved.some((v, i) => i % 3 === 1 && Math.abs(v - authored[i]) > 1e-5), 'surface did not move');
  assert.notEqual(fountain.jets.scale.y, 1, 'streams did not pulse');

  // A later sample is still measured from Blender's positions, rather than adding every
  // wave to the previous one and slowly walking out of its basin.
  updateFountain(fountain, 1000);
  const later = fountain.surface.geometry.attributes.position.array;
  for (let i = 1; i < later.length; i += 3) {
    assert.ok(Number.isFinite(later[i]));
    assert.ok(Math.abs(later[i] - authored[i]) <= 0.0061);
  }
});

// The square put the tables one cell from the fountain, corner to corner, and the walker
// could see between them and not walk it: the fountain's solid was the square round its
// basin, and the tables' was one box over an L of two trestles whose empty corner faces
// the fountain. A round solid and the L kept as its parts open the diagonal again.
test('the fountain is walked round as a circle, and the tables leave the corner of their L', () => {
  const f = buildBuilding({ id: 'civic:fountain', kind: 'civic', civicType: 'fountain', style: 'unknown' });
  assert.equal(f.solids.length, 1);
  assert.ok(f.solids[0].r > 0.5 && f.solids[0].r < 0.6, 'the fountain has a radius');
  const t = buildBuilding({ id: 'civic:tables', kind: 'civic', civicType: 'tables', style: 'unknown' });
  const at = (x, z) => t.solids.some((r) => Math.abs(x - r.x) < r.hx && Math.abs(z - r.z) < r.hz);
  assert.ok(at(-0.2, -0.15) && at(0.2, 0.2), 'both tables are still solid');
  assert.ok(!at(-0.3, 0.35), 'the empty corner of the L is closed off again');
});
