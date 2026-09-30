// The Salty Kraken on the ground (Plans/piratenkroeg.md): rung 52, a three by three at the water,
// and the pirate's chest moving from beside the village tavern to behind the pub.
//
// Held here: the pub stands on land with its door on the water and a road a settler at the door
// finds; the chest moves once, on the scan the pub first stands, onto one of `chestSpots(pub)`
// with the keeper's cell dry ground and on no road; below 52 nothing changes; an island founded
// past 52 has both on its first scan and the second is a no-op; and turning the village tavern
// no longer takes the chest along. Where on the coast the pub stands is `pirateTavernSite`'s, and
// is to move to the pirate bank of the haven (Plans/quay-en-rivier.md) - so nothing here holds it
// to a distance from any one harbour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLayout, placeAll, outsideDoor, plotDoor, PIRATE_ID, PUB_ID } from '../lib/layout.mjs';
import { runPlan, parsePlan, civicSites } from '../lib/plan.mjs';
import { MILESTONES, civicIdOf } from '../lib/village.mjs';
import { makeTerrain } from '../shared/terrain.mjs';
import { houseGate } from '../shared/roads.mjs';
import { DOOR_DIR } from '../shared/settlerwalk.mjs';
import { chestSpots, CHEST_SPOTS, LOOK } from '../shared/treasure.mjs';
import { village, stands } from './support/village.mjs';

const SIZE = 128;
const SEEDS = [5, 2024, 1337];
const json = (o) => JSON.stringify(o);
const key = (c) => `${c[0]},${c[1]}`;
const cellsOf = (p) => { const out = []; for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) out.push([p.gx + x, p.gz + z]); return out; };

function ladder(settlers) {
  const v = village(settlers);
  const apprentices = v.buildings.filter((b) => b.kind === 'shed').length;
  v.stats.apprentices = apprentices;
  v.milestones = MILESTONES.map((m) => {
    const on = m.on === 'apprentices' ? 'apprentices' : 'settlers';
    const unlocked = (on === 'apprentices' ? apprentices : settlers) >= m.at;
    return { ...m, on, civicId: civicIdOf(m), unlocked, unlockedAt: unlocked ? 0 : null, building: unlocked ? civicIdOf(m) : null };
  });
  return v;
}
const groundOf = (seed, l) => makeTerrain(seed, { size: l.size, polders: l.polders, fairway: l.fairway, grow: l.grow || null });
const scan = (layout, seed, n) => placeAll(layout, ladder(n), { seed, size: SIZE });
const byPub = (chest, pub) => chestSpots(pub).some((s) => s.cell[0] === chest.gx && s.cell[1] === chest.gz && s.rot === chest.rot);
const pathCells = (layout) => new Set(layout.paths.flatMap((q) => [...(q.cells || []), ...(q.strand || [])]).map(key));

test('rung 52 is the pirate tavern, between the lighthouse and the sawmill', () => {
  const i = MILESTONES.findIndex((m) => m.civicType === 'piratetavern');
  assert.ok(i > 0);
  assert.equal(MILESTONES[i].at, 52);
  assert.equal(civicIdOf(MILESTONES[i]), PUB_ID);
  assert.ok(MILESTONES[i - 1].at <= 52 && MILESTONES[i + 1].at >= 52);
});

test('the chest spots are behind and beside the lot, never in front, never the doorstep', () => {
  assert.deepEqual(LOOK, DOOR_DIR);
  assert.equal(CHEST_SPOTS.length, 9);
  for (const rot of [0, 1, 2, 3]) {
    const p = { gx: 10, gz: 10, w: 3, d: 3, rot };
    const lot = new Set(cellsOf(p).map(key));
    const step = key(outsideDoor(p.gx, p.gz, rot));
    const cells = new Set();
    for (const s of chestSpots(p)) {
      assert.ok(!lot.has(key(s.cell)), `rot ${rot}: a spot on the lot`);
      assert.notEqual(key(s.cell), step, `rot ${rot}: the doorstep`);
      assert.ok(!lot.has(key(s.keeper)), `rot ${rot}: the keeper stands on the lot`);
      assert.equal(Math.abs(s.keeper[0] - s.cell[0]) + Math.abs(s.keeper[1] - s.cell[1]), 1, 'the keeper a step off his chest');
      // Never towards the front: the spot is no further forward than the lot's middle.
      const [lx, lz] = LOOK[rot];
      assert.ok((s.cell[0] - 11) * lx + (s.cell[1] - 11) * lz <= 0, `rot ${rot}: a spot in front`);
      cells.add(key(s.cell));
    }
    assert.equal(cells.size, 9);
    assert.deepEqual(chestSpots(p)[0].cell, [11 - 2 * LOOK[rot][0], 11 - 2 * LOOK[rot][1]], 'first straight behind the middle');
  }
});

for (const seed of SEEDS) {
  test(`seed ${seed}: the pub stands at the water at 52, the chest moves behind it once, and stays`, () => {
    const layout = emptyLayout(seed, SIZE);
    scan(layout, seed, 40);
    scan(layout, seed, 40);
    assert.equal(layout.plots[PUB_ID], undefined, 'no pub below 52');
    const tavern = layout.plots['civic:tavern'];
    const old = layout.plots[PIRATE_ID];
    assert.ok(old, 'the chest stands by the tavern below 52');
    const step = outsideDoor(tavern.gx, tavern.gz, tavern.rot);
    assert.equal(Math.abs(old.gx - step[0]) + Math.abs(old.gz - step[1]), 1, 'beside the tavern\'s doorstep');

    const before = stands(layout);
    scan(layout, seed, 60);
    const pub = layout.plots[PUB_ID];
    assert.ok(pub, 'the pub was given ground');
    assert.deepEqual([pub.w, pub.d], [3, 3]);
    const terrain = groundOf(seed, layout);
    for (const [gx, gz] of cellsOf(pub)) assert.ok(terrain.isLand(gx, gz), `the pub stands in the water at ${gx},${gz}`);
    // Its front is on the water: the cell its door opens on is sea, or sand with the sea beyond.
    const door = plotDoor(PUB_ID, pub);
    const [dx, dz] = DOOR_DIR[pub.rot];
    const [sx, sz] = door.step;
    assert.ok(terrain.isWater(sx, sz) || terrain.isWater(sx + dx, sz + dz) || terrain.isWater(sx + 2 * dx, sz + 2 * dz), 'the pub does not face the water');
    // A road, and one a settler standing at the door finds.
    assert.ok(layout.paths.some((q) => q.id === `path:${PUB_ID}`), 'the pub has no road');
    const walks = {
      paths: layout.paths, bridges: layout.bridges || [], island: { town: layout.town },
      districts: Object.entries(layout.districts).map(([id, d]) => ({ id, ...d })),
    };
    assert.notEqual(houseGate(walks, layout.size, door.door), null, 'no road within reach of the pub\'s door');

    // The chest, behind it, and nothing else moved.
    const chest = layout.plots[PIRATE_ID];
    assert.ok(chest && byPub(chest, pub), `the chest is not behind the pub (${json(chest)})`);
    const spot = chestSpots(pub).find((s) => s.cell[0] === chest.gx && s.cell[1] === chest.gz);
    assert.ok(terrain.isLand(...spot.keeper) && !terrain.isWater(...spot.keeper), 'the pirate stands in the water');
    const others = Object.entries(layout.plots).filter(([id]) => id !== PIRATE_ID).flatMap(([, p]) => cellsOf(p)).map(key);
    assert.ok(!others.includes(key(spot.keeper)), 'the pirate stands on a plot');
    assert.ok(!others.includes(key(spot.cell)), 'the chest shares its cell');
    assert.ok(!pathCells(layout).has(key(spot.cell)), 'the chest stands on a road');
    const moved = Object.keys(before).filter((id) => before[id] !== stands(layout)[id]);
    assert.deepEqual(moved, [PIRATE_ID], 'only the chest moved');

    // And the scan after it, and the one after that, change nothing.
    const once = json(layout.plots);
    scan(layout, seed, 60);
    assert.equal(json(layout.plots), once, 'the scan after the move moved something');
    scan(layout, seed, 60);
    assert.equal(json(layout.plots), once);
  });
}

test('an island founded past 52 has the pub and the chest behind it on its first scan', () => {
  for (const seed of SEEDS) {
    const layout = emptyLayout(seed, SIZE);
    scan(layout, seed, 60);
    const pub = layout.plots[PUB_ID], chest = layout.plots[PIRATE_ID];
    assert.ok(pub, `seed ${seed}: the pub on the first scan`);
    assert.ok(chest && byPub(chest, pub), `seed ${seed}: the chest behind it on the first scan`);
    const once = json(layout.plots);
    scan(layout, seed, 60);
    assert.equal(json(layout.plots), once, `seed ${seed}: the second scan moved something`);
  }
});

test('below 52 there is no pub and the chest keeps to the tavern', () => {
  const seed = 2024;
  const layout = emptyLayout(seed, SIZE);
  scan(layout, seed, 48);
  scan(layout, seed, 48);
  assert.equal(layout.plots[PUB_ID], undefined);
  assert.ok(layout.plots[PIRATE_ID]);
});

test('with the pub standing, turning the village tavern leaves the chest where it is', () => {
  const seed = 2024;
  const model = ladder(60);
  const layout = emptyLayout(seed, SIZE);
  placeAll(layout, model, { seed, size: SIZE });
  placeAll(layout, model, { seed, size: SIZE });
  const tavern = layout.plots['civic:tavern'];
  const chest = json(layout.plots[PIRATE_ID]);
  const terrain = groundOf(seed, layout);
  const S = civicSites(layout, terrain);
  const mask = parseInt(S.sites['civic:tavern'][tavern.gz - S.gz][tavern.gx - S.gx], 16);
  const rot = [2, 1, 3].map((k) => (tavern.rot + k) % 4).find((r) => (mask >> r) & 1);
  assert.notEqual(rot, undefined, 'the tavern can face another way where it stands');
  const r = runPlan(layout, model, parsePlan({ ops: [{ op: 'civic', id: 'civic:tavern', gx: tavern.gx, gz: tavern.gz, rot }] }), { seed, size: SIZE, dryRun: false });
  assert.equal(r.ok, true, r.error || (r.verdicts[0] && r.verdicts[0].reason));
  assert.doesNotMatch(r.verdicts[0].notes.join(' '), /chest goes with it/);
  assert.equal(json(layout.plots[PIRATE_ID]), chest, 'the chest left the pub');
});
