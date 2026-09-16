import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as THREE from 'three';

register('./support/shared-loader.mjs', import.meta.url);
// buildings.js starts texture requests on import; geometry tests need no image IO.
const previousDocument = globalThis.document;
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { figureGeometry, settlerLook, eyeHeight, createSettlers } = await import('../web/js/settlers.js');
if (previousDocument === undefined) delete globalThis.document;
else globalThis.document = previousDocument;
const { HAT_SHAPES } = await import('../web/js/avatar.js');

test('all resident hats render with finite normals and no expedition equipment', () => {
  for (const { id } of HAT_SHAPES) {
    const look = { ...settlerLook('resident', 'sonnet'), hatShape: id };
    const g = figureGeometry('sonnet', { look });
    g.computeBoundingBox();
    assert.equal(g.groups.length, 0);
    assert.equal(g.boundingBox.min.y, 0);
    assert.ok(g.boundingBox.max.y > eyeHeight({ look }));
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) < .29) assert.ok(p.getZ(i) > -.10, 'no backpack behind the resident');
    }
    assert.ok(g.attributes.position.count / 3 < 3000);
    for (const attribute of Object.values(g.attributes)) assert.ok(attribute.array.every(Number.isFinite));
    for (let i = 0; i < g.attributes.normal.count; i++) {
      const n = g.attributes.normal;
      assert.ok(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) > .99, id);
    }
    g.dispose();
  }
});

test('resident identity stays deterministic and sailors keep their uniform', () => {
  assert.deepEqual(settlerLook('same', 'fable'), settlerLook('same', 'fable'));
  assert.notDeepEqual(settlerLook('same', 'fable'), settlerLook('different', 'fable'));
  assert.equal(settlerLook('sailor', 'opus', 'sailor').hatShape, 'sailor');
  assert.ok(eyeHeight({ look: settlerLook('young', 'sonnet', 'apprentice'), baseScale: .62 }) < .30);
});

test('crowd batches stay constant, new skin and face parts track and hide with their owner', () => {
  const scene = new THREE.Scene();
  const material = new THREE.MeshStandardMaterial();
  const terrain = { half: 32, size: 64, worldHeight: () => 0 };
  const settlers = createSettlers(scene, material, terrain);
  assert.equal(scene.children.length, 12, 'five body, six hats, one existing hammer batch');
  for (let i = 0; i < 100; i++) settlers.add(`resident:${i}`, { style: 'sonnet', kind: 'hut' }, [i,0,0]);
  settlers.update(0, 0);
  assert.equal(scene.children.length, 12, 'no mesh per person');
  const [torso, limbs, head, hands, details] = scene.children;
  for (const mesh of [torso, limbs, head, hands, details]) assert.equal(mesh.count, 100);
  assert.deepEqual([...head.instanceColor.array], [...hands.instanceColor.array]);
  assert.deepEqual([...torso.instanceMatrix.array], [...hands.instanceMatrix.array]);
  assert.deepEqual([...head.instanceMatrix.array], [...details.instanceMatrix.array]);
  assert.deepEqual(settlers.pickables(), [torso, head]);
  assert.equal(settlers.figureAt(head, 3).id, 'resident:3');
  settlers.remove('resident:3');
  assert.equal(settlers.figureAt(head, 3), null);
  const matrix = new THREE.Matrix4();
  for (const mesh of [torso, limbs, head, hands, details]) {
    mesh.getMatrixAt(3, matrix);
    assert.equal(matrix.elements[13], -999);
  }
  for (const mesh of scene.children) mesh.geometry.dispose();
  material.dispose();
});
