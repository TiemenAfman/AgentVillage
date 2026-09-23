// The volcano, as a page raises it: a guest region with nothing standing on it.
//
// Every other island that reaches web/js/guest-island.js has a town, a landing, harbours
// and buildings; the volcano has none of them (lib/islandbundle.mjs volcanoBundle). So the
// thing worth asserting is that the ordinary guest path - the landscape, the buildings, the
// crowd view, the empty roster the sea sends for it - takes an island with nothing on it
// without tripping over a missing town or an empty list, and that the ground it is handed
// is the volcano's own terrain rather than an ordinary island of the same seed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

// buildings.js builds a TextureLoader at import time and the landscape asks for its grass
// sheet while it is being built - so, as in tests/guest-landscape.test.mjs, the stub stays.
globalThis.document = {
  createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }),
};
const THREE = await import('three');
const { createGuestIsland } = await import('../web/js/guest-island.js');
const { createCrowdView } = await import('../web/js/crowd-view.js');
const { makeTerrain } = await import('../shared/terrain.mjs');
const { placeIsland } = await import('../shared/regions.mjs');
const { volcanoBundle } = await import('../lib/islandbundle.mjs');

// What main.js's joinIsland does with a bundle off /island/:id, minus the archipelago.
function raise(origin = [-144, 0]) {
  const bundle = JSON.parse(JSON.stringify(volcanoBundle()));
  const terrain = makeTerrain(bundle.island.seed, {
    size: bundle.grid.size, polders: bundle.polders, fairway: bundle.fairway, volcano: bundle.island.volcano === true,
  });
  const region = placeIsland(terrain, { id: bundle.island.id, origin });
  region.village = bundle;
  return { bundle, terrain, region };
}

test('the page builds the volcano\'s own ground from its bundle', () => {
  const { bundle, terrain } = raise();
  assert.equal(terrain.hash, bundle.island.terrainHash);
  assert.equal(terrain.volcano, true, 'drawn as an ordinary island of the same seed');
});

test('a guest island with no town, no landing and no buildings raises without complaint', () => {
  const { region, bundle } = raise();
  const scene = new THREE.Scene();
  const material = new THREE.MeshBasicMaterial();
  const g = createGuestIsland({ scene, region, buildings: bundle.buildings, material, month: 8 });
  assert.equal(g.buildingCount, 0);
  assert.deepEqual(g.blockers(), []);
  assert.ok(g.triangles > 0, 'no ground was drawn');
  assert.deepEqual(g.group.position.toArray(), [-144, 0, 0], 'drawn at its berth in the scene');
  g.update(0.016, 8);
  g.dispose();
});

test('its crowd view is empty and takes the sea\'s empty roster', () => {
  const { region, bundle } = raise();
  const crowd = createCrowdView({ scene: new THREE.Scene(), material: new THREE.MeshBasicMaterial(), region, buildings: bundle.buildings });
  crowd.roster([]);
  crowd.apply(new Map(), 1000);
  crowd.applyRides(new Map(), 1000);
  assert.equal(crowd.count(), 0);
  crowd.dispose();
});

test('the region facade hands on the volcano\'s own fields, and keeps the crater local', () => {
  const { region, terrain } = raise();
  assert.equal(region.volcano, true);
  assert.equal(region.lavaCells, terrain.lavaCells);
  assert.equal(region.lavaBankCells, terrain.lavaBankCells);
  assert.deepEqual(region.crater, terrain.crater, 'the crater is a point on its own grid, not moved by the berth');
  const [gx, gz] = terrain.lavaCells[0] || [0, 0];
  assert.equal(region.isLava(gx, gz), terrain.isLava(gx, gz));
  // And an ordinary island says no everywhere, through the same members.
  const plain = placeIsland(makeTerrain(1337, { size: 64 }), { id: 'plain', origin: [144, 0] });
  assert.ok(!plain.volcano);
  assert.equal(plain.isLava(32, 32), false);
});
