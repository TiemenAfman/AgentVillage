// The Salty Kraken on the ground (Plans/piratenkroeg.md, Plans/kraken-op-zee.md): rung 52, a galleon
// on a rock on a lot of eleven by six (PUB_LOT) a little off the shore in the sea, reached by a
// gangway, and the pirate's chest moving from beside the village tavern to where the gangway comes
// ashore.
//
// Held here: the pub stands in the sea, on PUB_LOT turned whichever way, every cell of it water, its
// gangway running from the stair's step straight to the land over PUB_PIER_MIN to PUB_PIER_MAX cells
// of water; its road begins with the gangway (`pier`, which the replay keeps as road over the
// water) and a settler at the foot of the stair finds it; the water stays water for the polders and
// the dredger; the chest moves once, on the scan the pub first stands, onto one of
// `pubChestSpots(pub)` with the keeper's cell dry ground and on no road; a pub on the beach goes out
// to the sea once (`layout.pubSea`);
// below 52 nothing changes; an island founded past 52 has both on its first scan and the second is
// a no-op; turning the village tavern no longer takes the chest along; and a pub standing on the
// three by three it was given before it was a galleon moves once onto PUB_LOT, its chest with it,
// and the scan after is the same bytes. Where on the coast the pub stands is `pirateTavernSite`'s -
// so nothing here holds it to a distance from any one harbour. Its distance from a stone quay is
// measured on a copy of the live island (Plans/piratenkroeg.md), which the ladder here never lays.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyLayout, placeAll, outsideDoor, plotDoor, stamped, fitsLot, PIRATE_ID, PUB_ID, PUB_LOT, PUB_GATE,
  PUB_PIER_MIN, PUB_PIER_MAX, pubChestSpots, replayGrid, keptWater, fairwayHeld, PATH,
} from '../lib/layout.mjs';
import { pubGangway } from '../shared/kraken.mjs';
import { register } from 'node:module';
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
const groundOf = (seed, l) => makeTerrain(seed, { size: l.size, polders: l.polders, fairway: l.fairway, works: l.works || null, grow: l.grow || null });
const scan = (layout, seed, n) => placeAll(layout, ladder(n), { seed, size: SIZE });
const byPub = (chest, pub, terrain) => pubChestSpots(pub, terrain).some((s) => s.cell[0] === chest.gx && s.cell[1] === chest.gz && s.rot === chest.rot);
// The first free stretch of dry land of `w` by `d` nearest the town's middle, for a pub put down by hand
// the way an older island has one: on a three by three, or on the beach.
function landBlock(layout, seed, w, d) {
  const grid = replayGrid(groundOf(seed, layout), layout);
  const [cx, cz] = layout.town.centre;
  for (let r = 6; r < layout.size; r++) {
    for (let gz = cz - r; gz <= cz + r; gz++) for (let gx = cx - r; gx <= cx + r; gx++) {
      if (Math.max(Math.abs(gx - cx), Math.abs(gz - cz)) !== r) continue;
      if (grid.freeBlock(gx - 1, gz - 1, w + 2, d + 2, false)) return [gx, gz];
    }
  }
  return null;
}
const gangwayOf = (pub, terrain) => pubGangway(pub, (gx, gz) => terrain.inGrid(gx, gz) && terrain.isWater(gx, gz));
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

// The spots as they were worked out while every pub was a three by three, cell for cell: a chest
// standing behind one of those must still read as standing behind it, or it would be lifted.
test('on a three by three the chest spots are the cells they always were', () => {
  const ALONG = LOOK.map(([lx, lz]) => [-lz, lx]);
  for (const rot of [0, 1, 2, 3]) {
    const [lx, lz] = LOOK[rot], [ax, az] = ALONG[rot];
    const old = CHEST_SPOTS.map(([u, v]) => [21 + u * lx + v * ax, 31 + u * lz + v * az]);
    assert.deepEqual(chestSpots({ gx: 20, gz: 30, w: 3, d: 3, rot }).map((s) => s.cell), old, `rot ${rot}`);
    assert.deepEqual(chestSpots({ gx: 20, gz: 30, rot }).map((s) => s.cell), old, 'a plot with no w and d is a three by three');
  }
});

test('on the Kraken\'s eleven by six the chest spots are behind and beside it, never in front, never the stair\'s step', () => {
  for (const rot of [0, 1, 2, 3]) {
    const { w, d } = stamped(PUB_LOT, rot);
    const p = { gx: 40, gz: 40, w, d, rot };
    assert.ok(fitsLot('piratetavern', p));
    assert.ok(!fitsLot('piratetavern', { gx: 40, gz: 40, w: 3, d: 3, rot }), 'a three by three is not the Kraken\'s lot');
    const lot = new Set(cellsOf(p).map(key));
    const { door, step } = plotDoor(PUB_ID, p);
    assert.ok(lot.has(key(door)), `rot ${rot}: the stair's foot is off the lot`);
    assert.ok(!lot.has(key(step)), `rot ${rot}: the step is on the lot`);
    const [lx, lz] = LOOK[rot];
    assert.deepEqual([step[0] - door[0], step[1] - door[1]], [lx, lz], `rot ${rot}: the step is not in front of the door`);
    const mid2 = [2 * p.gx + w - 1, 2 * p.gz + d - 1];
    const cells = new Set();
    for (const s of chestSpots(p)) {
      assert.ok(Number.isInteger(s.cell[0]) && Number.isInteger(s.cell[1]), 'a spot between cells');
      assert.ok(!lot.has(key(s.cell)), `rot ${rot}: a spot on the lot`);
      assert.ok(!lot.has(key(s.keeper)), `rot ${rot}: the keeper on the lot`);
      assert.notEqual(key(s.cell), key(step), `rot ${rot}: the step`);
      assert.ok((2 * s.cell[0] - mid2[0]) * lx + (2 * s.cell[1] - mid2[1]) * lz <= 0, `rot ${rot}: a spot in front of the middle`);
      // Against its wall, not out in the field.
      assert.ok(cellsOf(p).some((c) => Math.max(Math.abs(c[0] - s.cell[0]), Math.abs(c[1] - s.cell[1])) === 1), `rot ${rot}: a spot off the wall`);
      cells.add(key(s.cell));
    }
    assert.equal(cells.size, 9);
  }
});

// PUB_GATE is anchor.door of the bake, on the lot's front edge: the stair's foot as walk mode meets it.
test('the stair\'s foot in the bake is the Kraken\'s door on the grid', async () => {
  register('./support/shared-loader.mjs', import.meta.url);
  const { anchorsOf } = await import('../web/js/models.js');
  const [x, , z] = anchorsOf('piratetavern').door;
  assert.ok(Math.abs(x - PUB_GATE[0]) < 0.05, `anchor.door x ${x} against PUB_GATE ${PUB_GATE[0]}`);
  assert.ok(z < PUB_GATE[1] && z > PUB_GATE[1] - 1, `anchor.door z ${z} is not in the front row of the lot`);
  assert.equal(PUB_GATE[1], PUB_LOT.d / 2);
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
    assert.deepEqual([pub.w, pub.d], [stamped(PUB_LOT, pub.rot).w, stamped(PUB_LOT, pub.rot).d]);
    const terrain = groundOf(seed, layout);
    assert.equal(pub.sea, true, 'the pub is not in the sea');
    for (const [gx, gz] of cellsOf(pub)) assert.ok(terrain.isWater(gx, gz) && !terrain.isLand(gx, gz), `the pub stands on land at ${gx},${gz}`);
    // Its gangway: from the stair's step straight on, the way the lot looks, over water to the land.
    const door = plotDoor(PUB_ID, pub);
    const g = gangwayOf(pub, terrain);
    assert.ok(g, 'no gangway');
    assert.deepEqual(g.cells[0], door.step, 'the gangway does not start at the stair');
    assert.deepEqual(g.dir, DOOR_DIR[pub.rot], 'the gangway does not run the way the pub looks');
    assert.ok(g.cells.length >= PUB_PIER_MIN && g.cells.length <= PUB_PIER_MAX, `a gangway of ${g.cells.length}`);
    assert.ok(terrain.isLand(...g.shore), 'the gangway does not come ashore');
    // A road that begins with the gangway, and one a settler standing at the door finds.
    const road = layout.paths.find((q) => q.id === `path:${PUB_ID}`);
    assert.ok(road, 'the pub has no road');
    assert.deepEqual(road.pier, g.cells, 'the road does not record its planks');
    assert.deepEqual(road.cells.slice(0, g.cells.length), g.cells, 'the road does not begin with the gangway');
    const grid = replayGrid(terrain, layout);
    for (const c of g.cells) assert.equal(grid.get(...c), PATH, `the replay lost the plank at ${key(c)}`);
    // Its water is kept: from the polders and from the dredger.
    const kept = keptWater(layout), held = fairwayHeld(layout);
    for (const c of [...cellsOf(pub), ...g.cells]) assert.ok(kept.has(key(c)) && held.has(key(c)), `${key(c)} is not kept as water`);
    const walks = {
      paths: layout.paths, bridges: layout.bridges || [], island: { town: layout.town },
      districts: Object.entries(layout.districts).map(([id, d]) => ({ id, ...d })),
    };
    assert.notEqual(houseGate(walks, layout.size, door.door), null, 'no road within reach of the pub\'s door');

    // The chest, behind it, and nothing else moved.
    const chest = layout.plots[PIRATE_ID];
    assert.ok(chest && byPub(chest, pub, terrain), `the chest is not by the gangway (${json(chest)})`);
    const spot = pubChestSpots(pub, terrain).find((s) => s.cell[0] === chest.gx && s.cell[1] === chest.gz);
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
    assert.ok(pub.sea, `seed ${seed}: the pub is not in the sea`);
    assert.ok(chest && byPub(chest, pub, groundOf(seed, layout)), `seed ${seed}: the chest by it on the first scan`);
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

// The one deliberate move (Plans/piratenkroeg.md, "Bijsturing na het eerste oordeel in het spel"):
// an island whose Salty Kraken was placed on a three by three before it was a galleon - the live
// island's stood behind the stone quay. Made here the way it came about: the pub's plot put on a
// free block of the coast, and the island scanned below 52 so that the pub gets its road and the
// chest moves behind it, as the old code did. Then the scan at 52 and after.
test('a pub on the old three by three moves once onto PUB_LOT, the chest with it, and then holds still', () => {
  const seed = 2024;
  const layout = emptyLayout(seed, SIZE);
  scan(layout, seed, 48);
  const at = landBlock(layout, seed, 3, 3);
  assert.ok(at, 'no free three by three');
  const old = { gx: at[0], gz: at[1], w: 3, d: 3, rot: 2 };
  layout.plots[PUB_ID] = old;
  scan(layout, seed, 48);
  scan(layout, seed, 48);
  assert.deepEqual(layout.plots[PUB_ID], old, 'the old pub moved below 52');
  assert.ok(layout.paths.some((q) => q.id === `path:${PUB_ID}`), 'the old pub has no road');
  assert.ok(byPub(layout.plots[PIRATE_ID], old, groundOf(seed, layout)), 'the chest is not behind the old pub');
  const settled = json({ plots: layout.plots, paths: layout.paths });
  scan(layout, seed, 48);
  assert.equal(json({ plots: layout.plots, paths: layout.paths }), settled, 'the old island does not hold still');

  const before = stands(layout);
  scan(layout, seed, 60);
  const pub = layout.plots[PUB_ID];
  assert.ok(pub && fitsLot('piratetavern', pub), `the pub did not move onto its lot (${json(pub)})`);
  assert.ok(byPub(layout.plots[PIRATE_ID], pub, groundOf(seed, layout)), 'the chest did not follow the pub');
  const moved = Object.keys(before).filter((id) => before[id] !== stands(layout)[id]);
  assert.deepEqual(moved.sort(), [PIRATE_ID, PUB_ID].sort(), 'something else moved with the pub');
  const walks = {
    paths: layout.paths, bridges: layout.bridges || [], island: { town: layout.town },
    districts: Object.entries(layout.districts).map(([id, d]) => ({ id, ...d })),
  };
  assert.notEqual(houseGate(walks, layout.size, plotDoor(PUB_ID, pub).door), null, 'no road at the foot of the stair');

  // The scan after the move, and the one after that, are the same bytes - roads included.
  const once = json({ plots: layout.plots, paths: layout.paths });
  scan(layout, seed, 60);
  assert.equal(json({ plots: layout.plots, paths: layout.paths }), once, 'the scan after the move changed something');
  scan(layout, seed, 60);
  assert.equal(json({ plots: layout.plots, paths: layout.paths }), once);
});

test('the scan that moves the pub keeps the layout it moved it from, and no other scan does', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { backUpBeforePub } = await import('../scan.mjs');
  const at = new Date(2026, 9, 1, 12, 30, 5);
  const place = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pub-backup-'));
    const file = path.join(dir, 'layout.json');
    fs.writeFileSync(file, JSON.stringify({ was: 'three by three' }));
    return { dir, file };
  };
  const backups = (dir) => fs.readdirSync(dir).filter((f) => f.startsWith('layout.before-pub-'));
  const oldPub = JSON.stringify({ gx: 1, gz: 1, w: 3, d: 3, rot: 3 });
  const newPub = { gx: 4, gz: 1, w: 6, d: 11, rot: 3 };
  let { dir, file } = place();
  backUpBeforePub(file, oldPub, { plots: { [PUB_ID]: newPub } }, at);
  assert.deepEqual(backups(dir), ['layout.before-pub-20261001-123005.json']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, backups(dir)[0]), 'utf8')), { was: 'three by three' });
  ({ dir, file } = place());
  backUpBeforePub(file, 'null', { plots: { [PUB_ID]: newPub } }, at);
  assert.deepEqual(backups(dir), [], 'a pub placed for the first time');
  ({ dir, file } = place());
  backUpBeforePub(file, JSON.stringify(newPub), { plots: { [PUB_ID]: newPub } }, at);
  assert.deepEqual(backups(dir), [], 'a pub that stayed');
});

// An island founded small (FOUNDING: 40 on a grid of 64) has every stretch of coast in a hamlet by
// the time the pub is earned - the old three by three fitted between them, eleven by six does not.
// It grows one ring for the pub (`layout.pubRing`), places it on that scan, and the scan after is a
// no-op: no second ring.
test('on an island founded small the pub is given one ring of new coast, once', () => {
  const seed = 3;
  const layout = emptyLayout(seed, 64, { base: 40, steps: [] });
  const go = (n) => placeAll(layout, ladder(n), { seed, size: 64, cap: 384 });
  for (const n of [10, 20, 30, 40, 50]) go(n);
  const rings = layout.grow.steps.length;
  assert.equal(layout.plots[PUB_ID], undefined);
  go(52);
  const pub = layout.plots[PUB_ID];
  assert.ok(pub && fitsLot('piratetavern', pub), 'no pub on the scan that earned it');
  // In the sea there is room on most coasts of a small island too, and then no ring is grown for it
  // (Plans/kraken-op-zee.md); only where neither the sea nor the beach has a lot, one ring, once.
  assert.ok(layout.grow.steps.length <= rings + 1, 'more than one ring for the pub');
  if (layout.grow.steps.length > rings) assert.equal(layout.pubRing, layout.grow.steps.length);
  assert.ok(byPub(layout.plots[PIRATE_ID], pub, groundOf(seed, layout)), 'the chest did not follow');
  const once = json(layout);
  go(52);
  assert.equal(json(layout), once, 'the scan after grew or moved something');
});

// The second deliberate move (Plans/kraken-op-zee.md): a Kraken already on the beach - the live
// island's, since 1 October - goes out onto a rock in the sea once, its chest to where the gangway
// comes ashore, and `layout.pubSea` keeps the question from being asked again.
test('a pub on the beach goes out to sea once, the chest with it, and then holds still', () => {
  const seed = 2024;
  const layout = emptyLayout(seed, SIZE);
  scan(layout, seed, 48);
  const at = landBlock(layout, seed, 11, 6);
  assert.ok(at, 'no free stretch of eleven by six');
  const beach = { gx: at[0], gz: at[1], w: 11, d: 6, rot: 2 };
  layout.plots[PUB_ID] = beach;
  scan(layout, seed, 48);
  assert.deepEqual(layout.plots[PUB_ID], beach, 'the beach pub moved below 52');
  assert.equal(layout.pubSea, undefined, 'asked before the pub was earned');

  const before = stands(layout);
  scan(layout, seed, 60);
  const pub = layout.plots[PUB_ID];
  assert.ok(pub && pub.sea, `the pub did not go out to sea (${json(pub)})`);
  assert.equal(layout.pubSea, true);
  const terrain = groundOf(seed, layout);
  assert.ok(byPub(layout.plots[PIRATE_ID], pub, terrain), 'the chest did not follow the pub');
  const moved = Object.keys(before).filter((id) => before[id] !== stands(layout)[id]);
  assert.deepEqual(moved.sort(), [PIRATE_ID, PUB_ID].sort(), 'something else moved with the pub');
  const walks = {
    paths: layout.paths, bridges: layout.bridges || [], island: { town: layout.town },
    districts: Object.entries(layout.districts).map(([id, d]) => ({ id, ...d })),
  };
  assert.notEqual(houseGate(walks, layout.size, plotDoor(PUB_ID, pub).door), null, 'no road at the foot of the stair');

  const once = json(layout);
  scan(layout, seed, 60);
  assert.equal(json(layout), once, 'the scan after the move changed something');
  scan(layout, seed, 60);
  assert.equal(json(layout), once);
});

test('a pub on the beach that has been asked once stays on its beach', () => {
  const seed = 2024;
  const layout = emptyLayout(seed, SIZE);
  scan(layout, seed, 48);
  const at = landBlock(layout, seed, 11, 6);
  const beach = { gx: at[0], gz: at[1], w: 11, d: 6, rot: 2 };
  layout.plots[PUB_ID] = beach;
  layout.pubSea = true;
  scan(layout, seed, 60);
  assert.deepEqual(layout.plots[PUB_ID], beach);
});
