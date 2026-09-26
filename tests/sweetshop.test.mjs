import test from 'node:test';
import assert from 'node:assert/strict';
import { Ray, Vector3 } from 'three';
import { SWEETSHOP } from '../web/js/sweetshop-mesh.js';

test('sweet shop side gables hide the interior when viewed from either side', () => {
  // Sample plaster above the eaves and beside the attic window. With back-face
  // culling, an inward-facing gable lets this ray reach the opposite wall instead.
  for (const side of [-1, 1]) {
    const ray = new Ray(new Vector3(side * 2, 1.2, -0.05), new Vector3(-side, 0, 0));
    const hits = [];
    for (const [name, part] of Object.entries(SWEETSHOP.parts)) {
      if (!name.startsWith('civic_sweetshop house:') || part.sheet !== 'wall') continue;
      const offset = new Vector3(...part.at);
      for (let i = 0; i < part.positions.length; i += 9) {
        const vertices = [0, 3, 6].map(j => new Vector3().fromArray(part.positions, i + j).add(offset));
        const hit = ray.intersectTriangle(...vertices, true, new Vector3());
        if (hit) hits.push(hit);
      }
    }
    assert.ok(hits.some(hit => Math.abs(hit.x - side * 0.84) < 1e-5),
      `the ${side < 0 ? 'left' : 'right'} gable must face the viewer outside its wall`);
  }
});
