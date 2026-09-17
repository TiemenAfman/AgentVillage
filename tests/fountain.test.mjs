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
