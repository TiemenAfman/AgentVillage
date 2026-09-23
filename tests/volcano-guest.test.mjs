// The volcano, as a page raises it: a guest region with one building standing on it.
//
// Every other island that reaches web/js/guest-island.js has a town, a landing, harbours
// and a village; the volcano has none of them, only the guardhouse (lib/islandbundle.mjs
// volcanoBundle). So the thing worth asserting is that the ordinary guest path - the
// landscape, the buildings, the crowd view, the roster the sea sends for it - takes an
// island with next to nothing on it without tripping over a missing town, that the ground
// it is handed is the volcano's own terrain rather than an ordinary island of the same
// seed, and that the guards, who have no house of their own, are dressed each as somebody.
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
const { settlerLook } = await import('../shared/palette.mjs');

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

test('a guest island with no town and no landing raises its guardhouse without complaint', () => {
  const { region, bundle } = raise();
  const scene = new THREE.Scene();
  const material = new THREE.MeshBasicMaterial();
  const g = createGuestIsland({ scene, region, buildings: bundle.buildings, material, month: 8 });
  assert.equal(g.buildingCount, 1, 'the guardhouse was not drawn');
  assert.equal(g.records[0].id, 'civic:guardhouse');
  // Standing on its own lot, in the island's frame, and solid to a walker - at the berth.
  const { gx, gz } = bundle.buildings[0].plot;
  const pos = g.records[0].group.position;
  assert.ok(Math.abs(pos.x - (gx + 1.5 - 64)) < 0.8 && Math.abs(pos.z - (gz + 1.5 - 64)) < 0.8);
  const solid = g.blockers();
  assert.ok(solid.length > 0);
  assert.ok(solid.every((b) => b.id === `guest:${region.id}:civic:guardhouse`));
  assert.ok(Math.abs(solid[0].x - (-144 + pos.x)) < 2, 'the blocker was not moved to the berth');
  assert.ok(g.triangles > 0, 'no ground was drawn');
  assert.deepEqual(g.group.position.toArray(), [-144, 0, 0], 'drawn at its berth in the scene');
  g.update(0.016, 8);
  g.dispose();
});

test('its crowd view takes an empty roster, and dresses each guard from their own id', () => {
  const { region, bundle } = raise();
  const crowd = createCrowdView({ scene: new THREE.Scene(), material: new THREE.MeshBasicMaterial(), region, buildings: bundle.buildings });
  crowd.roster([]);
  crowd.apply(new Map(), 1000);
  crowd.applyRides(new Map(), 1000);
  assert.equal(crowd.count(), 0);
  // No building is called guard:n; they are dressed against the guardhouse, and look
  // different because the look is hashed off the guard, not off the house.
  const ids = ['guard:0', 'guard:1', 'guard:2', 'guard:3', 'guard:4', 'guard:5'];
  crowd.roster(ids);
  assert.equal(crowd.count(), ids.length);
  const looks = ids.map((id) => crowd.figure(id).look);
  assert.equal(new Set(looks.map((l) => `${l.tunic}/${l.skin}/${l.trim}/${l.height}`)).size, ids.length, 'two guards are the same man');
  assert.deepEqual(looks[0], settlerLook('guard:0', 'unknown', 'adult'), 'dressed exactly as the sea strode them');
  // A fallen guard is a hole: he goes, and nobody else moves up into his place.
  crowd.roster(['guard:0', null, ...ids.slice(2)]);
  assert.equal(crowd.count(), ids.length - 1);
  assert.equal(crowd.figure('guard:1'), null);
  assert.equal(crowd.figure('guard:2').look.tunic, looks[2].tunic);
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

// The Codex houses, as the sea hands them on (lib/residents.mjs, the `codex` message): real
// specs off the plot pool, through the same whitelist a bundle's buildings go through.
const { codexPlots, codexId } = await import('../shared/volcano.mjs');
const { codexHouse } = await import('../lib/islandbundle.mjs');
function codexHouses(islandId, ids, terrain) {
  const pool = codexPlots(terrain);
  return ids.map((id, i) => codexHouse({ id: codexId(islandId, id), style: 'unknown', tier: 'cottage', active: false, ...pool[i * 7] }));
}

test('a Codex house going up or coming down touches that house and nothing else on the volcano', () => {
  const { region, bundle, terrain } = raise();
  const scene = new THREE.Scene();
  const material = new THREE.MeshBasicMaterial();
  const g = createGuestIsland({ scene, region, buildings: bundle.buildings, material, month: 8 });
  const ground = g.ground;
  const triangles = g.triangles;
  const guardhouse = g.records[0];
  const island = 'aaaaaaaaaaaaaaaa';

  const three = codexHouses(island, ['house:s0', 'house:s1', 'house:s2'], terrain);
  let r = g.applyBuildings([...bundle.buildings, ...three]);
  assert.equal(r.added.length, 3);
  assert.equal(r.removed.length, 0);
  assert.equal(g.buildingCount, 4);
  assert.equal(g.ground, ground, 'the ground was built again for a house');
  assert.equal(g.triangles, triangles);
  assert.equal(g.records[0], guardhouse, 'the guardhouse was raised again');
  const s1 = g.records.find((x) => x.id === codexId(island, 'house:s1'));
  assert.ok(s1.group.parent === g.group, 'not standing in the volcano\'s own group');
  const { gx, gz } = three[1].plot;
  assert.ok(Math.abs(s1.group.position.x - (gx + 1.5 - 64)) < 0.8 && Math.abs(s1.group.position.z - (gz + 1.5 - 64)) < 0.8);
  assert.ok(g.blockers().some((b) => b.id === `guest:${region.id}:${codexId(island, 'house:s1')}`), 'a new house is not solid');

  // s0 comes down, s1 is left alone (only its settler's `active` moved), s3 goes up.
  const next = [...bundle.buildings, { ...three[1], active: true }, three[2], ...codexHouses(island, ['house:s3'], terrain).map((h, i) => ({ ...h, plot: codexPlots(terrain)[50 + i].plot }))];
  r = g.applyBuildings(next);
  assert.deepEqual(r.removed.map((x) => x.id), [codexId(island, 'house:s0')]);
  assert.deepEqual(r.added.map((x) => x.id), [codexId(island, 'house:s3')]);
  assert.equal(g.records.find((x) => x.id === codexId(island, 'house:s1')), s1, 'a house was rebuilt for its settler starting work');
  assert.equal(r.removed[0].group.parent, null, 'the house that came down is still in the scene');
  assert.equal(g.ground, ground);

  // Everybody gone again is the volcano as it was raised.
  r = g.applyBuildings(bundle.buildings);
  assert.equal(g.buildingCount, 1);
  assert.equal(g.records[0], guardhouse);
  g.dispose();
});

test('a Codex resident is dressed from its house, or from the guardhouse while it lodges there', () => {
  const { region, bundle, terrain } = raise();
  const crowd = createCrowdView({ scene: new THREE.Scene(), material: new THREE.MeshBasicMaterial(), region, buildings: bundle.buildings });
  const island = 'aaaaaaaaaaaaaaaa';
  const lodger = codexId(island, 'house:s0');
  const housed = codexId(island, 'house:s1');
  // The roster before the houses: a lodger is dressed at once, against the guardhouse; the
  // other has a house the page has not been told about yet, and waits.
  const [h1] = codexHouses(island, ['house:s1'], terrain);
  crowd.roster(['guard:0', lodger, housed]);
  assert.equal(crowd.figure(lodger).spec.id, 'civic:guardhouse');
  assert.deepEqual(crowd.figure(lodger).look, settlerLook(lodger, 'unknown', 'adult'), 'not dressed as the sea strode them');
  assert.equal(crowd.figure(housed).spec.id, 'civic:guardhouse', 'a resident with no house the page knows lodges until it does');

  // The houses arrive: the one who has one moves in, and nobody else is touched.
  const guard = crowd.figure('guard:0');
  const wasLodger = crowd.figure(lodger);
  crowd.setBuildings([...bundle.buildings, { ...h1, style: 'opus' }]);
  assert.equal(crowd.figure(housed).spec.id, housed);
  assert.deepEqual(crowd.figure(housed).look, settlerLook(housed, 'opus', 'adult'));
  assert.equal(crowd.figure('guard:0'), guard, 'a guard was dressed again for somebody else\'s house');
  assert.equal(crowd.figure(lodger), wasLodger);
  assert.equal(crowd.count(), 3);

  // And a house coming down puts its resident back in the guardhouse, under the same number.
  crowd.setBuildings(bundle.buildings);
  assert.equal(crowd.figure(housed).spec.id, 'civic:guardhouse');
  assert.equal(crowd.count(), 3);
  // A resident who leaves is a hole, like a fallen guard.
  crowd.roster(['guard:0', null, housed]);
  assert.equal(crowd.figure(lodger), null);
  assert.equal(crowd.count(), 2);
  crowd.dispose();
});

test('a crowd that runs all evening gives a departed body\'s slot to the next one enrolled', async () => {
  const { createFigures, CAPACITY } = await import('../web/js/settler-figures.js');
  const view = createFigures(new THREE.Scene(), new THREE.MeshBasicMaterial(), { armed: true });
  const look = settlerLook('x', 'unknown', 'adult');
  const bodies = Array.from({ length: CAPACITY }, (_, i) => ({ id: `codex:aaaaaaaaaaaaaaaa:house:s${i}`, pos: [0, 0], y: 0, yaw: 0, visible: true }));
  for (const f of bodies) assert.equal(view.enrol(f, look, 'adult'), true);
  assert.equal(view.enrol({ id: 'one-too-many', pos: [0, 0], visible: true }, look, 'adult'), false, 'the crowd was not full');
  // Arrivals and departures for longer than the crowd is wide, and still room every time.
  for (let i = 0; i < CAPACITY + 10; i++) {
    const gone = bodies[i % CAPACITY];
    view.free(gone);
    assert.equal(gone.slot, null);
    const next = { id: `guard:${i}`, pos: [0, 0], y: 0, yaw: 0, visible: true };
    assert.equal(view.enrol(next, look, 'adult'), true, `no room on arrival ${i}`);
    assert.equal(view.figureAt(view.pickables()[0], next.slot), next, 'the slot still names the one who left');
    bodies[i % CAPACITY] = next;
  }
  view.dispose();
});
