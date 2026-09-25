// A neighbour's island is drawn by the same code ours is.
//
// It was not, for as long as there have been two islands. guest-island.js built a
// heightfield and a set of buildings and stopped, so an island across the water was a bare
// green hill with houses on it: no wood, no undergrowth, no ploughing, no walls, no
// district colour. The reason was never the wire - a bundle has carried `cleared`,
// `paths`, `bridges`, `districts` with their lobes and hues, `lattice` and `polders` all
// along - it was that all of that was drawn inside createWorld's closure, and createWorld
// owns the one sky, the one sea and the three lights there can only be one of.
//
// So the standing half came out as `createLandscape`, and this asserts the thing that is
// easy to break by accident and invisible until somebody sails past: that the shared call
// actually plants a forest when it is handed a village, and that it plants the *same* one
// for the same island however many times it is asked.
//
// Deliberately about counts and not about pixels. What a tree looks like is the bake's
// business (tests/models.test.mjs); what this guards is that a neighbour gets one at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

// buildings.js builds a TextureLoader at import time, and world.js reaches it - and
// unlike the other web/js tests this one may not take the stub away again afterwards:
// `sheet()` is called while a landscape is being built, not while the module is loaded,
// so the ground asks for its grass sheet inside every build() below.
globalThis.document = {
  createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }),
};
const THREE = await import('three');
const { createLandscape, seasonOf } = await import('../web/js/world.js');
const { makeTerrain } = await import('../shared/terrain.mjs');

const SIZE = 64;
const SEED = 1337;

// An island with a town and one hamlet on it - enough for ownership, a field plan and a
// stretch of road, which is what the scatter reads to decide where a wood may stand.
function village() {
  return {
    island: {
      name: 'Hoogezand', seed: SEED, gridSize: SIZE,
      town: { gx: 32, gz: 32, r: 8, paved: [[32, 32], [33, 32]], square: [32, 32], size: 3, parcel: null },
      lattice: null,
    },
    grid: { size: SIZE },
    districts: [], buildings: [], bridges: [], polders: [],
    paths: [{ cells: [[30, 32], [31, 32], [32, 32]] }],
    cleared: [[32, 32], [33, 32], [31, 32]],
  };
}

const build = (v = village(), opts = {}) => {
  const terrain = makeTerrain(SEED, { size: SIZE });
  const parent = new THREE.Group();
  const land = createLandscape({
    parent, terrain, village: v, season: seasonOf(8), ...opts,
  });
  const counts = [];
  parent.traverse((o) => { if (o.isInstancedMesh) counts.push(o.count); });
  return { land, parent, counts, total: counts.reduce((a, b) => a + b, 0) };
};

test('a village handed to the landscape comes back with a wood on it', () => {
  const { counts, total } = build();
  assert.ok(counts.length >= 4, `expected the instanced sets, got ${counts.length}`);
  // The number itself is not the point and will move when the scatter is tuned; that it is
  // thousands rather than none is. A bare island is what this whole file is about.
  assert.ok(total > 1000, `only ${total} instances on a 64-cell island - the neighbour is bare again`);
});

test('the same island plants the same forest twice running', () => {
  assert.deepEqual(build().counts, build().counts);
});

test('a guest island leaves its seabed undrawn and ours does not', () => {
  const whole = build(village(), { skipSeabed: false });
  const guest = build(village(), { skipSeabed: true });
  assert.equal(whole.land.triangles, SIZE * SIZE * 2, 'ours draws every quad');
  assert.ok(guest.land.triangles < whole.land.triangles,
    'a berth that draws its seabed arrives as a raft of sand');
  assert.ok(guest.land.triangles > 0);
});

test('an island nobody has built on yet still gets a coastline', () => {
  // What guest-island.js hands over when a region has no village on it - see EMPTY_VILLAGE
  // there. It must not throw, because the alternative is a hole in the water.
  const empty = {
    island: { town: null, lattice: null },
    districts: [], buildings: [], paths: [], bridges: [], cleared: [], polders: [],
  };
  const { land, total } = build(empty);
  assert.ok(land.ground, 'no ground for an island with nothing on it');
  assert.ok(total > 0, 'an island nobody lives on is all wood, not none');
});

test('a landscape can be taken down again', () => {
  // A berth empties when a neighbour leaves. Four visits leaving their woods behind is
  // four forests of buffers nobody can reach.
  const { land, parent } = build();
  assert.ok(parent.children.length > 0);
  land.dispose();
  assert.equal(parent.children.length, 0, 'the landscape left its group behind');
});

test('active houses arrive with scaffolding, also when a guest island is rebuilt', async () => {
  const { createGuestIsland } = await import('../web/js/guest-island.js');
  const { addScaffold } = await import('../web/js/scaffold.js');
  const scene = new THREE.Scene(), material = new THREE.MeshStandardMaterial();
  const buildings = [true, false].map((active, i) => ({
    id: `house:${i}`, kind: 'house', tier: 'cottage', style: 'sonnet', active,
    plot: { gx: 30 + i * 4, gz: 30, w: 3, d: 3, rot: i },
  }));
  const region = { id: 'neighbour', origin: [80, 0], terrain: makeTerrain(SEED, { size: SIZE }), village: village() };
  for (let pass = 0; pass < 2; pass++) {
    const island = createGuestIsland({ scene, region, buildings, material });
    const [working, idle] = island.records;
    assert.ok(working.scaffold, 'an already active house needs no start event');
    assert.equal(idle.scaffold, undefined);
    assert.equal(working.scaffold.parent, working.group);
    assert.ok(working.scaffold.scale.toArray().every(v => Number.isFinite(v) && v > 0));
    const count = working.group.children.length;
    addScaffold(working, material);
    assert.equal(working.group.children.length, count, 'a later start event does not duplicate the frame');
    island.dispose();
  }
  material.dispose();
});
