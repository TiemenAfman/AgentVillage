// The pirate's sea chest beside the tavern door, the pirate who keeps it, and the treasure
// statue on the square (Plans/schatkaarten.md).
//
// Three things are held here. Where the chest goes is worked out from the tavern's own `rot`
// and never from an island (the sea's starters stand the tavern at rot 2, the town's own east
// lot at rot 3), and the keeper stands out in front of it, not on the step. The statue takes a
// cell nothing stands on, on the plaza's own paving, and nothing else on the island moves for
// it. And both are one-cell plots that a scan writes once and then leaves alone.
//
// No coordinate is written down for the town: each test finds its own cell on the island it has.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { emptyLayout, placeAll, outsideDoor, plotDoor, lotOf, PIRATE_ID, TREASURE_ID } from '../lib/layout.mjs';
import { createCrowd } from '../lib/crowd.mjs';
import { starterBundle } from '../lib/islandbundle.mjs';
import { runPlan, parsePlan, civicSites } from '../lib/plan.mjs';
import { MILESTONES } from '../lib/village.mjs';
import { makeTerrain } from '../shared/terrain.mjs';
import { KEEPERS, keeperOf, residentLook, HAT_SHAPES } from '../shared/palette.mjs';
import { DOOR_DIR } from '../shared/settlerwalk.mjs';

// The drawing half. buildings.js builds a TextureLoader when it is imported, so it gets the
// stub every other test of it uses; the plaque paints a canvas, so it gets a recording one.
register('./support/shared-loader.mjs', import.meta.url);
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { buildBuilding } = await import('../web/js/buildings.js');
const { attachPlaque, setPlaque, disposePlaque } = await import('../web/js/treasure-plaque.js');
const models = await import('../web/js/models.js');
const THREE = await import('three');
delete globalThis.document;

const key = (c) => `${c[0]},${c[1]}`;
const cellsOf = (p) => { const out = []; for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) out.push(key([p.gx + x, p.gz + z])); return out; };

// ---- the keeper -------------------------------------------------------------------------

const SIZE = 64;
const SEED = 1337;

// A tavern at every rot, with the chest one cell along its front from the doorstep on the side
// the keeper's `aside` points to - the cell lib/layout.mjs picks first. The lot is placed so
// that its step lies on the same cell whatever the rot.
function tavernAt(rot) {
  const terrain = makeTerrain(SEED, { size: SIZE });
  const mid = Math.round(terrain.half);
  const gx = mid - 1, gz = mid - 1;                                    // a 3x3 lot on the middle
  const tavern = { gx, gz, w: 3, d: 3, rot };
  const step = outsideDoor(gx, gz, rot);
  const [ox, oz] = DOOR_DIR[rot];
  const chest = { gx: step[0] - oz, gz: step[1] + ox, w: 1, d: 1, rot };
  const bundle = {
    island: { name: 'Testholm', seed: SEED, gridSize: SIZE, landing: null, town: { paved: [] } },
    buildings: [
      { id: 'civic:tavern', kind: 'civic', civicType: 'tavern', name: 'The tavern', plot: tavern },
      { id: PIRATE_ID, kind: 'civic', civicType: 'pirate', name: 'The pirate’s chest', plot: chest },
    ],
    paths: [],
  };
  return { id: 'testholm', terrain, bundle, tavern, chest, step };
}

test('the pirate is a keeper of his chest, and the crowd finds him on any island', () => {
  assert.equal(keeperOf({ id: PIRATE_ID, kind: 'civic', civicType: 'pirate' }), KEEPERS.pirate);
  assert.equal(KEEPERS.pirate.post, 'pirate');
  // A hat the drawing knows: the tricorn comes with the bake, and the dress swaps to it then.
  assert.ok(HAT_SHAPES.some((h) => h.id === KEEPERS.pirate.dress.hatShape), 'his hat is not one of HAT_SHAPES');
  assert.equal(residentLook({ id: PIRATE_ID, kind: 'civic', civicType: 'pirate' }).hatShape, KEEPERS.pirate.dress.hatShape);
  const crowd = createCrowd(tavernAt(2));
  const pirate = crowd.figures.get(PIRATE_ID);
  assert.ok(pirate, 'nobody keeps the chest');
  assert.equal(pirate.post, 'pirate');
  assert.equal(pirate.serves, false);
  assert.equal(pirate.tours, false);
});

test('he stands out in front of the chest, never on the doorstep, whichever way the tavern faces', () => {
  for (const rot of [0, 1, 2, 3]) {
    const v = tavernAt(rot);
    const half = v.terrain.half;
    const crowd = createCrowd(v);
    const pirate = crowd.figures.get(PIRATE_ID);
    const inn = crowd.figures.get('civic:tavern');
    const [ox, oz] = DOOR_DIR[rot];
    const chestMid = [v.chest.gx + 0.5 - half, v.chest.gz + 0.5 - half];
    // In front of the chest along the way it faces, not off to the side of it: `aside` is zero.
    const dx = pirate.home[0] - chestMid[0], dz = pirate.home[1] - chestMid[1];
    assert.ok(Math.abs(dx * ox + dz * oz - 0.85) < 1e-9, `rot ${rot}: he stands ${(dx * ox + dz * oz).toFixed(2)} out, not 0.85`);
    assert.ok(Math.abs(dx * -oz + dz * ox) < 1e-9, `rot ${rot}: he stands off to one side of his chest`);
    // Not on the doorstep, nor in the chest's own cell.
    const cell = [Math.floor(pirate.home[0] + half), Math.floor(pirate.home[1] + half)];
    assert.notEqual(key(cell), key(v.step), `rot ${rot}: the pirate stands on the tavern's doorstep`);
    assert.notEqual(key(cell), key([v.chest.gx, v.chest.gz]), `rot ${rot}: the pirate stands in his own chest`);
    // A cell apart from the innkeeper, who keeps to the step.
    const gap = Math.hypot(pirate.home[0] - inn.home[0], pirate.home[1] - inn.home[1]);
    assert.ok(gap >= 1.2, `rot ${rot}: the pirate and the innkeeper are ${gap.toFixed(2)} apart`);
  }
});

test('the sea\'s starter has a pirate at the tavern door too, on the cell the town would give him', () => {
  const bundle = starterBundle(0);
  const chest = bundle.buildings.find((b) => b.id === PIRATE_ID);
  const tavern = bundle.buildings.find((b) => b.civicType === 'tavern');
  assert.ok(chest && tavern, 'a starter without a tavern or a pirate');
  assert.equal(chest.plot.rot, tavern.plot.rot, 'the chest does not face the way the tavern does');
  const step = outsideDoor(tavern.plot.gx, tavern.plot.gz, tavern.plot.rot);
  const [ox, oz] = DOOR_DIR[tavern.plot.rot];
  assert.deepEqual([chest.plot.gx, chest.plot.gz], [step[0] - oz, step[1] + ox], 'the starter\'s chest is not where lib/layout.mjs would put it');
  const paved = new Set(bundle.island.town.paved.map(key));
  assert.ok(paved.has(key([chest.plot.gx, chest.plot.gz])), 'the chest stands on grass');
  // And the sea's crowd puts the keeper there, standing in front of it on the square.
  const terrain = makeTerrain(bundle.island.seed, { size: bundle.island.gridSize });
  const crowd = createCrowd({ id: bundle.island.id, bundle, terrain });
  const pirate = crowd.figures.get(PIRATE_ID);
  assert.ok(pirate, 'the starter has no pirate');
  const cell = [Math.floor(pirate.home[0] + terrain.half), Math.floor(pirate.home[1] + terrain.half)];
  assert.notEqual(key(cell), key(step), 'the pirate stands on the tavern\'s doorstep');
  assert.ok(paved.has(key(cell)), 'the pirate stands on grass');
});

// ---- the layout -------------------------------------------------------------------------

const LSIZE = 128;
const LSEED = 2024;
const t0 = Date.UTC(2026, 0, 1);

function village(settlers, extra = {}) {
  const buildings = [];
  for (let i = 0; i < settlers; i++) {
    buildings.push({ id: `house:d-${i}`, sessionId: `d-${i}`, kind: 'house', district: 'p:demo', harbour: false, tier: 'hut', startedAt: t0 + i * 1000 });
  }
  return {
    districts: [{ id: 'p:demo', kind: 'project', name: 'Demo', population: settlers, firstSeenAt: t0 }],
    buildings,
    milestones: MILESTONES.map((m) => {
      const unlocked = m.at <= settlers;
      return { ...m, on: m.on || 'settlers', unlocked, unlockedAt: unlocked ? t0 : null, building: unlocked ? `civic:${m.civicType}` : null };
    }),
    furniture: [],
    stats: { settlers },
    ...extra,
  };
}
const scan = (layout, model) => placeAll(layout, model, { seed: LSEED, size: LSIZE });
function island(model) {
  const layout = emptyLayout(LSEED, LSIZE);
  scan(layout, model);
  scan(layout, model);
  return layout;
}
const json = (o) => JSON.stringify(o);
const benches = (n) => Array.from({ length: n }, (_, i) => ({ id: `civic:bench:${i + 1}`, kind: 'bench', label: 'Benches', at: 60 * (i + 1) }));

test('both are one-cell civics', () => {
  assert.deepEqual(lotOf('pirate'), { w: 1, d: 1 });
  assert.deepEqual(lotOf('treasure'), { w: 1, d: 1 });
  assert.equal(plotDoor(PIRATE_ID, { gx: 5, gz: 5, w: 1, d: 1, rot: 0 }), null, 'a chest has no door');
});

test('the chest stands beside the tavern\'s doorstep on its pavement, and the scan after it is a no-op', () => {
  // Sixteen settlers is the first rung at which the tavern stands (MILESTONES: 15).
  const model = village(16);
  const layout = island(model);
  const tavern = layout.plots['civic:tavern'];
  const chest = layout.plots[PIRATE_ID];
  assert.ok(tavern && chest, 'the tavern or the chest is missing');
  assert.deepEqual([chest.w, chest.d], [1, 1]);
  assert.equal(chest.rot, tavern.rot, 'the chest does not face the way the tavern does');
  const step = outsideDoor(tavern.gx, tavern.gz, tavern.rot);
  assert.notEqual(key([chest.gx, chest.gz]), key(step), 'the chest is on the doorstep');
  const [ox, oz] = DOOR_DIR[tavern.rot];
  const off = [chest.gx - step[0], chest.gz - step[1]];
  // One cell along the front (the direction the keeper's `aside` points, or the other way), and
  // not in front of or behind the doorstep.
  assert.equal(Math.abs(off[0] * -oz + off[1] * ox), 1, 'the chest is not one cell along the front of the door');
  assert.equal(off[0] * ox + off[1] * oz + 0, 0, 'the chest is in front of or behind the doorstep');
  assert.ok(layout.town.paved.some((c) => key(c) === key([chest.gx, chest.gz])), 'the chest stands on grass');
  for (const [id, p] of Object.entries(layout.plots)) {
    if (id !== PIRATE_ID) assert.ok(!cellsOf(p).includes(key([chest.gx, chest.gz])), `${id} shares the chest's cell`);
  }
  const before = json(layout);
  scan(layout, model);
  assert.equal(json(layout), before, 'the scan after the chest was placed rewrote the layout');
});

test('the chest comes without the tavern\'s having to move, and no house moves for it', () => {
  // Fifteen settlers is one short of nothing: the tavern is the fifteenth rung. Take the island one
  // scan before its tavern and then one after, and compare every plot that was there.
  const layout = island(village(14));
  assert.equal(layout.plots['civic:tavern'], undefined);
  assert.equal(layout.plots[PIRATE_ID], undefined, 'a chest with no tavern to stand beside');
  const before = new Map(Object.entries(layout.plots).map(([id, p]) => [id, json(p)]));
  const model = village(16);
  scan(layout, model);
  scan(layout, model);
  assert.ok(layout.plots[PIRATE_ID]);
  for (const [id, was] of before) assert.equal(json(layout.plots[id]), was, `${id} moved when the tavern and its chest came`);
});

test('the treasure statue is not on the island until it is set down, then takes a free cell of the plaza', () => {
  const plain = village(40);
  const layout = island(plain);
  assert.equal(layout.plots[TREASURE_ID], undefined, 'a statue nobody has set down');
  const before = new Map(Object.entries(layout.plots).map(([id, p]) => [id, json(p)]));
  const paved = new Set(layout.town.paved.map(key));

  const placed = village(40, { treasure: { placed: true, found: 3 } });
  scan(layout, placed);
  const statue = layout.plots[TREASURE_ID];
  assert.ok(statue, 'the statue was set down and has no cell');
  assert.deepEqual([statue.w, statue.d], [1, 1]);
  assert.ok(paved.has(key([statue.gx, statue.gz])), 'the statue stands on grass, where a house could still be built');
  // No house, no shed, no other civic moved or shares its cell - the invariant "a house never moves".
  for (const [id, was] of before) assert.equal(json(layout.plots[id]), was, `${id} moved when the statue was set down`);
  for (const [id, p] of Object.entries(layout.plots)) {
    if (id !== TREASURE_ID) assert.ok(!cellsOf(p).includes(key([statue.gx, statue.gz])), `${id} shares the statue's cell`);
  }
  // Never on a doorstep: that cell has to stay walkable.
  for (const [id, p] of Object.entries(layout.plots)) {
    const door = id.startsWith('civic:') ? plotDoor(id, p) : null;
    if (door) assert.notEqual(key(door.step), key([statue.gx, statue.gz]), `the statue is on the doorstep of ${id}`);
  }
  // Facing the middle of the square.
  assert.ok(statue.rot >= 0 && statue.rot <= 3);

  const after = json(layout);
  scan(layout, placed);
  assert.equal(json(layout), after, 'the scan after the statue was set down rewrote the layout');
});

test('the statue keeps its cell for good: through a lost treasure.json, and as the town grows', () => {
  const layout = island(village(3, { treasure: { placed: true, found: 0 } }));
  const statue = json(layout.plots[TREASURE_ID]);
  assert.ok(layout.plots[TREASURE_ID], 'a fresh island cannot take the statue');
  // The file gone: not placed any more. A plot is never taken back, so it comes back on the same cell.
  scan(layout, village(3, { treasure: { placed: false, found: 0 } }));
  assert.equal(json(layout.plots[TREASURE_ID]), statue);
  for (const n of [16, 40, 100]) {
    const model = village(n, { treasure: { placed: true, found: n } });
    scan(layout, model);
    scan(layout, model);
    assert.equal(json(layout.plots[TREASURE_ID]), statue, `the statue moved at ${n} settlers`);
    const cells = new Map();
    for (const [id, p] of Object.entries(layout.plots)) for (const c of cellsOf(p)) {
      if (!id.startsWith('shed:')) cells.set(c, [...(cells.get(c) || []), id]);
    }
    // Nothing that came after it stands on it. (Houses share cells with their sheds by design.)
    assert.deepEqual(cells.get(key([layout.plots[TREASURE_ID].gx, layout.plots[TREASURE_ID].gz])), [TREASURE_ID], `something stands in the statue at ${n} settlers`);
  }
});

test('a bench that got there first sends the statue to the next free cell', () => {
  // 300 apprentices' worth of benches take the three inner corners of the square and two rim
  // cells; the statue then has to find a cell that is neither, and still on the paving.
  const furniture = benches(5);
  const settled = village(100, { furniture });
  const layout = island(settled);
  assert.ok(layout.plots['civic:bench:1'], 'the benches are not out');
  // The chest took the fifth bench's rim cell beside the tavern door; the bench stays on the
  // square rather than going to the far end of the town.
  const [cx, cz] = layout.town.centre;
  for (let i = 1; i <= 5; i++) {
    const b = layout.plots[`civic:bench:${i}`];
    assert.ok(Math.max(Math.abs(b.gx - cx), Math.abs(b.gz - cz)) <= 3, `bench ${i} was sent out to [${b.gx - cx}, ${b.gz - cz}]`);
  }
  const before = new Map(Object.entries(layout.plots).map(([id, p]) => [id, json(p)]));
  const paved = new Set(layout.town.paved.map(key));
  const model = village(100, { furniture, treasure: { placed: true, found: 1 } });
  scan(layout, model);
  const statue = layout.plots[TREASURE_ID];
  assert.ok(statue, 'the statue has no cell once the benches are out');
  assert.ok(paved.has(key([statue.gx, statue.gz])), 'the statue stands on grass');
  for (const [id, was] of before) assert.equal(json(layout.plots[id]), was, `${id} moved when the statue was set down`);
  for (const [id, p] of Object.entries(layout.plots)) {
    if (id !== TREASURE_ID) assert.ok(!cellsOf(p).includes(key([statue.gx, statue.gz])), `${id} shares the statue's cell`);
  }
  const after = json(layout);
  scan(layout, model);
  assert.equal(json(layout), after);
});

test('the keeper turning the tavern takes the chest with it, to the new door', () => {
  const model = village(40);
  const layout = island(model);
  const tavern = layout.plots['civic:tavern'];
  const chest = json(layout.plots[PIRATE_ID]);
  const terrain = makeTerrain(LSEED, { size: layout.size, polders: layout.polders || [], fairway: layout.fairway || null, grow: layout.grow || null });
  // A way it may face where it stands, as the planner's own map has it.
  const S = civicSites(layout, terrain);
  const mask = parseInt(S.sites['civic:tavern'][tavern.gz - S.gz][tavern.gx - S.gx], 16);
  const rot = [2, 1, 3].map((k) => (tavern.rot + k) % 4).find((r) => (mask >> r) & 1);
  assert.notEqual(rot, undefined, 'the tavern can face another way where it stands');
  const r = runPlan(layout, model, parsePlan({ ops: [{ op: 'civic', id: 'civic:tavern', gx: tavern.gx, gz: tavern.gz, rot }] }), { seed: LSEED, size: LSIZE, dryRun: false });
  assert.equal(r.ok, true, r.error || (r.verdicts[0] && r.verdicts[0].reason));
  assert.deepEqual(r.diff.plots.otherMoved, [], 'the plan moved things it did not name');
  assert.match(r.verdicts[0].notes.join(' '), /chest goes with it/);
  const now = layout.plots[PIRATE_ID];
  assert.ok(now, 'the chest is gone');
  assert.equal(now.rot, rot, 'the chest does not face the way the turned tavern does');
  assert.notEqual(json(now), chest, 'the chest stayed beside the old door');
  const step = outsideDoor(tavern.gx, tavern.gz, rot);
  assert.equal(Math.abs(now.gx - step[0]) + Math.abs(now.gz - step[1]), 1, 'not beside the new doorstep');
  const settled = json(layout);
  scan(layout, model);
  assert.equal(json(layout), settled, 'the scan after the plan rewrote the layout');
});

// ---- the drawing ------------------------------------------------------------------------

test('the chest and the statue are one mesh each, on their own cell, with no porch', () => {
  // The chest is kept low on purpose (0.72 to the top of its mast, scripts/build-treasure.py: it is
  // a corner you find, not a signboard), the statue is the tall one; `least` is what each must
  // still rise above.
  for (const [civicType, least, tallest] of [['pirate', 0.5, 1.6], ['treasure', 1, 2.1]]) {
    const b = buildBuilding({ id: `civic:${civicType}`, kind: 'civic', civicType, style: 'unknown' });
    assert.equal(b.geometry.groups.length, 0, `${civicType}: a building is one draw call`);
    assert.ok(b.bbox.max.x < 0.5 && b.bbox.min.x > -0.5 && b.bbox.max.z < 0.5 && b.bbox.min.z > -0.5, `${civicType} is wider than the cell it stands on`);
    assert.ok(b.height > least && b.height < tallest, `${civicType} declares a height of ${b.height}`);
    assert.ok(b.bbox.max.y <= b.height + 1e-5, `${civicType}: something reaches above the height it declares`);
    assert.ok(b.solids.length > 0, `${civicType} has nothing to bump into`);
    // Baked with its own footing: a step under it would lift it off the paving.
    assert.equal(b.porch, undefined, `${civicType} has been given a porch`);
  }
});

test('the statue publishes the middle of its plaque, on the front of its plinth', () => {
  const b = buildBuilding({ id: 'civic:treasure', kind: 'civic', civicType: 'treasure', style: 'unknown' });
  assert.ok(b.anchors.sign, 'nothing to hang the count on');
  const [x, y, z] = b.anchors.sign;
  assert.ok(Math.abs(x) < 0.05, 'the plaque is off to one side');
  assert.ok(y > 0.2 && y < 0.7, 'the plaque is not on the shaft of the plinth');
  assert.ok(z > 0.2 && z < 0.4, 'the plaque is not on the front of the plinth');
  if (models.hasAsset('civic_treasure')) assert.deepEqual(b.anchors.sign, models.anchorsOf('civic_treasure').sign);
});

test('the plaque letters the count and repaints only when it changes', () => {
  const said = [];
  const g = { fillRect() {}, strokeRect() {}, measureText: (t) => ({ width: t.length * 20 }), fillText: (t) => said.push(t) };
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => g }) };
  try {
    const group = new THREE.Group();
    const plaque = attachPlaque(group, [0, 0.41, 0.246], 7);
    assert.ok(said.includes('7') && said.some((t) => /treasures found/i.test(t)), `painted ${said.join(' | ')}`);
    assert.equal(group.children.length, 1);
    // In front of the panel, not in it.
    assert.ok(plaque.mesh.position.z > 0.246 && plaque.mesh.position.z < 0.26);
    const n = said.length;
    setPlaque(plaque, 7);
    assert.equal(said.length, n, 'repainted for the same number');
    setPlaque(plaque, 12);
    assert.equal(said[said.length - 1], '12');
    setPlaque(plaque, -3);
    assert.equal(said[said.length - 1], '0', 'a count below nought was drawn');
    disposePlaque(plaque);
  } finally {
    delete globalThis.document;
  }
});
