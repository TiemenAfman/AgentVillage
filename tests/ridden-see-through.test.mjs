// What the walker rides is never seen through (see-through.js, buildings.js solidMaterial).
// main.js hands walk mode and peers the island's buildingMat, which carries the see-through
// cone; the horse under a rider was stippled away with the house in front of him (7 Oct 2026).
// The stable's horse and every other animal keep the island's material: one that hides you
// may open, the one you sit on may not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const THREE = await import('three');
const { createBuildingMaterial, solidMaterial } = await import('../web/js/buildings.js');
const { createMount } = await import('../web/js/mount.js');
const { createBicycle } = await import('../web/js/bicycle.js');
const { createAnimal } = await import('../web/js/fauna.js');
delete globalThis.document;

const island = createBuildingMaterial({ seeThrough: true });

// What the compiled shader would get: the cache key and the hook's own patch, called on the
// material the mesh actually carries (`this` is how the hook reads seeThroughOff).
function seen(material) {
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <fog_vertex>\n',
    fragmentShader: '#include <common>\n#include <clipping_planes_fragment>\n#include <emissivemap_fragment>\n',
  };
  material.onBeforeCompile.call(material, shader);
  return { key: material.customProgramCacheKey.call(material), cut: 'uSeeOn' in shader.uniforms };
}

function materialsOf(object) {
  const out = new Set();
  object.traverse((o) => { if (o.isMesh) out.add(o.material); });
  return [...out];
}

test('the island material itself is seen through', () => {
  assert.deepEqual(seen(island), { key: 'settlers-emissive-ground-v1-see', cut: true });
});

test('the ridden horse is never seen through, and shares the island\'s live uniforms', () => {
  const horse = createMount({ scene: new THREE.Group(), material: island, seed: 'mount:me' });
  assert.ok(horse, 'the horse is in the build');
  const mats = materialsOf(horse.object);
  assert.ok(mats.length > 0);
  for (const m of mats) {
    assert.notEqual(m, island);
    assert.deepEqual(seen(m), { key: 'settlers-emissive-ground-v1', cut: false });
    assert.equal(m.userData.uniforms, island.userData.uniforms, 'night and fade still reach it');
  }
  // One clone for every rider (ours and every peer's), so one program.
  const other = createMount({ scene: new THREE.Group(), material: island, seed: 'mount:peer' });
  assert.deepEqual(materialsOf(other.object), mats);
});

test('the bicycle is never seen through either', () => {
  const bike = createBicycle({ scene: new THREE.Group(), material: island });
  const mats = materialsOf(bike.object);
  assert.ok(mats.length > 0);
  for (const m of mats) {
    assert.deepEqual(seen(m), { key: 'settlers-emissive-ground-v1', cut: false });
  }
});

test('a horse nobody rides keeps the island material', () => {
  const stable = createAnimal('horse', island, { seed: 'stable:horse' });
  for (const m of materialsOf(stable.object)) assert.equal(m, island);
});

test('a material with no see-through is handed back unchanged', () => {
  const plain = createBuildingMaterial();
  assert.equal(solidMaterial(plain), plain);
  assert.equal(solidMaterial(island), solidMaterial(island));
});
