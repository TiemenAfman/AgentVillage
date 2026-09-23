// Settlers with nothing to do go and do something (Plans/inwoners-aan-het-werk.md).
//
// Like settler-walk.test.mjs this registers no loader and stubs no document: the chores are
// part of the walk, and the walk is what the sea steps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWalk, MAX_CHORES } from '../shared/settlerwalk.mjs';
import { encodeCrowd, decodeCrowd, ANIMS, MOVING } from '../shared/settlerwire.mjs';
import { makeTerrain } from '../shared/terrain.mjs';
import { fishingSpots } from '../lib/crowd.mjs';
import { buildBundle, parseBundle } from '../lib/islandbundle.mjs';
import { parseWork } from '../lib/placements.mjs';

const SIZE = 64;
const SEED = 1337;
const CHORES = new Set(['hoe', 'weed', 'chop', 'gather', 'fish']);

// The lane and the houses of settler-walk.test.mjs, and then work either side of it: a row
// of small fields two cells below the houses, a garden beside every other door, a handful
// of trees above the lane, and the fishing lib/crowd.mjs finds on the coast.
function island(n = 24) {
  const terrain = makeTerrain(SEED, { size: SIZE });
  const mid = Math.round(terrain.half);
  const lane = [];
  for (let gx = 8; gx < SIZE - 8; gx++) if (terrain.isLand(gx, mid)) lane.push([gx, mid]);
  const square = [];
  for (let gz = mid - 1; gz <= mid + 1; gz++) for (let gx = mid - 1; gx <= mid + 1; gx++) if (terrain.isLand(gx, gz)) square.push([gx, gz]);
  const specs = [];
  for (let i = 0; i < n && i * 2 < lane.length; i++) {
    const [gx, gz] = lane[i * 2];
    specs.push({ id: `house:${String(i).padStart(4, '0')}`, kind: 'house', name: `House ${i}`, style: 'opus', plot: { gx, gz: gz + 1, w: 1, d: 1, rot: 0 } });
  }
  const allLand = (gx, gz, w, d) => {
    for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) if (!terrain.isLand(gx + x, gz + z)) return false;
    return true;
  };
  const fields = [];
  for (let gx = 10; gx < SIZE - 14; gx += 6) if (allLand(gx, mid + 3, 4, 3)) fields.push([gx, mid + 3, 4, 3]);
  const gardens = [];
  for (let i = 0; i < specs.length; i += 2) {
    const p = specs[i].plot;
    if (allLand(p.gx + 1, p.gz, 1, 1)) gardens.push([p.gx + 1, p.gz, 1, 1]);
  }
  const trees = [];
  for (let gx = 12; gx < SIZE - 12; gx += 5) {
    if (terrain.isLand(gx, mid - 3)) trees.push([gx - terrain.half + 0.5, mid - 3 - terrain.half + 0.4]);
  }
  const bundle = { paths: [{ id: 'lane', cells: lane }], buildings: specs, island: { town: { paved: square } } };
  const fish = fishingSpots(terrain, bundle);
  const make = (work = { fields, gardens, trees, fish }) => {
    const walk = createWalk(terrain);
    walk.setRoads([{ id: 'lane', cells: lane }], square);
    if (work) walk.setWork(work);
    for (const spec of specs) {
      const at = terrain.cellWorld(spec.plot.gx, spec.plot.gz);
      walk.spawn(spec.id, spec, [at[0], 0, at[1]], {}, 1);
    }
    return walk;
  };
  return { terrain, lane, square, specs, fields, gardens, trees, fish, make };
}

const snapshot = (walk) => [...walk.figures.values()]
  .map((f) => `${f.id}|${f.pos[0]}|${f.pos[1]}|${f.y}|${f.mode}|${f.anim}`);

test('idle settlers go out to every kind of work there is, and come home to the millimetre', () => {
  const v = island(24);
  assert.ok(v.fields.length && v.gardens.length && v.trees.length && v.fish.length, 'the test island has work of every kind');
  const walk = v.make();
  const home = new Map([...walk.figures.values()].map((f) => [f.id, [f.home[0], f.home[1]]]));
  const seen = new Set();
  let most = 0;
  for (let i = 0; i < 40000; i++) {
    walk.advance(1, 0);
    let working = 0;
    for (const f of walk.figures.values()) {
      seen.add(f.anim);
      if (f.work || f.after?.kind?.startsWith('chore') || f.then?.kind === 'chore-home') working++;
    }
    most = Math.max(most, working);
  }
  for (const a of [...CHORES, 'haul']) assert.ok(seen.has(a), `nobody was ever seen at '${a}' (saw ${[...seen].join(', ')})`);
  assert.ok(most <= MAX_CHORES, `${most} at work at once against a cap of ${MAX_CHORES}`);
  for (const f of walk.figures.values()) {
    if (f.after || f.then || f.work) continue;
    assert.deepEqual([f.home[0], f.home[1]], home.get(f.id), `${f.id} did not get their doorstep back`);
  }
});

test('the same ticks give the same world with work in it, however they are grouped', () => {
  const v = island(24);
  const a = v.make();
  const b = v.make();
  for (let i = 0; i < 20000; i++) a.advance(1, 0);
  let left = 20000;
  while (left > 0) { const take = Math.min(left, 7); b.advance(take, 0); left -= take; }
  assert.deepEqual(snapshot(b), snapshot(a));
});

test('a field is worked inside the field, and a tree from beside it', () => {
  const v = island(24);
  const walk = v.make();
  const half = v.terrain.half;
  let hoed = 0, chopped = 0;
  for (let i = 0; i < 40000; i++) {
    walk.advance(1, 0);
    if (i % 20) continue;
    for (const f of walk.figures.values()) {
      if (!f.work) continue;
      const s = f.work.site;
      if (f.anim === 'hoe' || f.anim === 'weed') {
        hoed++;
        const [gx, gz, w, d] = [s.cell[0], s.cell[1], s.size[0], s.size[1]];
        const x = f.pos[0] + half, z = f.pos[1] + half;
        assert.ok(x >= gx && x <= gx + w && z >= gz && z <= gz + d, `${f.id} is ${f.anim}ing at ${f.pos}, outside ${[gx, gz, w, d]}`);
      }
      if (f.anim === 'chop') {
        chopped++;
        const d = Math.sqrt((f.pos[0] - s.at[0]) ** 2 + (f.pos[1] - s.at[1]) ** 2);
        assert.ok(d > 0.2 && d < 0.5, `${f.id} chops ${d.toFixed(2)} from the trunk`);
      }
    }
  }
  assert.ok(hoed > 0 && chopped > 0, `hoed ${hoed}, chopped ${chopped}`);
});

test('somebody whose session is running keeps hammering and never goes to work', () => {
  const v = island(12);
  const walk = v.make();
  const busy = v.specs[0].id;
  walk.setMode(busy, 'hammer');
  for (let i = 0; i < 30000; i++) {
    walk.advance(1, 0);
    assert.equal(walk.figures.get(busy).anim, 'hammer');
  }
});

test('the borrel calls everybody in from the fields', () => {
  const v = island(24);
  const walk = v.make();
  for (let i = 0; i < 12000; i++) walk.advance(1, 0);
  walk.setGather(true);
  for (let i = 0; i < 30000; i++) walk.advance(1, 0);
  const still = [...walk.figures.values()].filter((f) => f.work);
  assert.equal(still.length, 0, `${still.map((f) => f.id).join(', ')} kept working through the borrel`);
  assert.ok([...walk.figures.values()].some((f) => f.gathering), 'and they did go to the square');
});

test('no chores after dark, except a line in the water at dusk', () => {
  const v = island(24);
  const walk = v.make();
  const seen = new Set();
  for (let i = 0; i < 30000; i++) {
    walk.advance(1, 0.6);
    for (const f of walk.figures.values()) if (f.work) seen.add(f.work.kind);
  }
  assert.deepEqual([...seen].filter((k) => k !== 'fish'), [], 'the land was worked at night');
});

test('an island with no work known to it walks exactly as it did', () => {
  const v = island(24);
  const walk = v.make(null);
  for (let i = 0; i < 30000; i++) {
    walk.advance(1, 0);
    for (const f of walk.figures.values()) assert.ok(!CHORES.has(f.anim) && f.anim !== 'haul', `${f.id} is at '${f.anim}' with nothing to do`);
  }
});

test('every fishing spot is a coast cell, standing towards the water', () => {
  const v = island(24);
  const t = v.terrain;
  for (const s of v.fish) {
    const [gx, gz] = s.cell;
    assert.ok(t.isLand(gx, gz), `${s.cell} is not land`);
    const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => !t.isLand(gx + dx, gz + dz));
    assert.ok(wet, `${s.cell} has no water beside it`);
    const [cx, cz] = t.cellWorld(gx, gz);
    assert.ok(Math.abs(s.at[0] - cx) <= 0.5 && Math.abs(s.at[1] - cz) <= 0.5, `${s.cell} stands outside its own cell`);
  }
});

test('the chores go over the wire: working is pinned at once, hauling rides with the walkers', () => {
  assert.deepEqual(ANIMS.slice(0, 4), ['still', 'step', 'walk', 'hammer'], 'the old numbers did not move');
  assert.ok(MOVING.has('haul') && MOVING.has('walk') && !MOVING.has('hoe'));
  const v = island(24);
  const walk = v.make();
  const crowd = { figures: walk.figures };
  const walking = new Set();
  const far = new Map();
  let workRows = 0;
  for (let i = 0; i < 30000; i++) {
    walk.advance(1, 0);
    // Slices of a thousand, so almost nothing is pinned by its turn coming round - what
    // arrives here arrives because it changed.
    const { a, k } = encodeCrowd(crowd, { half: v.terrain.half, slice: i % 1000, slices: 1000, walking });
    decodeCrowd(a, v.terrain.half, far);
    decodeCrowd(k, v.terrain.half, far);
    let idx = -1;
    for (const f of walk.figures.values()) {
      idx++;
      if (!CHORES.has(f.anim) || !f.work || f.work.move) continue;
      // Somebody at a chore, standing: the far end knows what they are doing within the
      // beat they started, not ten seconds later.
      if (far.get(idx)?.anim === f.anim) workRows++;
    }
  }
  assert.ok(workRows > 0, 'nobody at work was ever seen at work on the far side');
});

test('the work sites sail in the bundle, and nothing else gets in with them', () => {
  const terrain = makeTerrain(1337, { size: SIZE });
  const village = {
    island: { name: 'Promptholm', seed: 1337, gridSize: SIZE, terrainHash: terrain.hash, landing: null, town: null, lattice: null },
    grid: { size: SIZE }, districts: [], buildings: [], paths: [], bridges: [], cleared: [], polders: [],
  };
  const work = parseWork({
    fields: [[10, 10, 4, 3], [1, 2, 3], ['a', 1, 1, 1], [60, 60, 8, 8]],
    gardens: [[20, 20, 1, 2]],
    trees: [[1.5, -2.25], [1e9, 0], ['x', 1]],
    __proto__: { evil: 1 },
  });
  assert.deepEqual(work.fields, [[10, 10, 4, 3], [60, 60, 8, 8]]);
  assert.deepEqual(work.trees, [[1.5, -2.25]]);
  const bundle = buildBundle({ config: { gridSize: SIZE }, village, placements: { at: {}, decks: {}, work } });
  // The field running off the edge of a 64 grid is the bundle's to refuse: placements.json
  // does not know the island's size.
  assert.deepEqual(bundle.work.fields, [[10, 10, 4, 3]]);
  assert.deepEqual(bundle.work.gardens, [[20, 20, 1, 2]]);
  const back = parseBundle(JSON.parse(JSON.stringify(bundle)));
  assert.deepEqual(back.work, bundle.work);
  // A page that never reported: null, and the sea's walk treats that as no work at all.
  const none = buildBundle({ config: { gridSize: SIZE }, village, placements: { at: {}, decks: {} } });
  assert.equal(none.work, null);
});
