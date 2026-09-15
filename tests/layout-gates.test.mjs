import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  emptyLayout, placeAll, loadLayout, saveLayout,
  LAYOUT_VERSION, PARCEL_VERSION, ROAD_VERSION,
} from '../lib/layout.mjs';
import { makeModel } from './helpers/model.mjs';
import { testLots } from './helpers/world.mjs';
import { requireIslandStopped, scratchData, cleanup } from './helpers/island-stopped.mjs';

// Four gates, in descending order of violence, and until now described only in prose:
//
//   v / seed / size mismatch   -> emptyLayout, everything replanned
//   terrainHash mismatch       -> resetForNewTerrain, including the town  (the re-founding gate)
//   PARCEL_VERSION bump        -> drop houses+sheds+paths+districts, keep town and bridges
//   ROAD_VERSION bump          -> drop only the roads
//
// Getting one of these wrong is how an island silently replans itself, so each gets its own
// assertion about what survives - not just about what goes.

const SEED = 1337;
const { lots, worldRev } = testLots(SEED);
const SIZE = lots.size;
const VILLAGE = [
  { name: 'repo-a', houses: 6, sheds: 1 },
  { name: 'repo-b', houses: 4 },
];
const MILESTONES = ['townhall', 'well', 'market'];

let dir;
test.before(async () => { await requireIslandStopped(); dir = scratchData('gates'); });
test.after(() => cleanup(dir));

function planted() {
  const layout = emptyLayout(SEED, SIZE);
  placeAll(layout, makeModel(VILLAGE, { milestones: MILESTONES }), { lots, seed: SEED, worldRev });
  return layout;
}

function roundTrip(layout, mutate) {
  const file = path.join(dir, `layout-${Math.random().toString(36).slice(2)}.json`);
  const onDisk = JSON.parse(JSON.stringify(layout));
  mutate(onDisk);
  saveLayout(file, onDisk);
  const back = loadLayout(file, SEED, SIZE);
  fs.rmSync(file, { force: true });
  return back;
}

test('a changed layout version throws the whole island away', () => {
  const layout = planted();
  const back = roundTrip(layout, (l) => { l.v = LAYOUT_VERSION + 1; });
  assert.deepEqual(back, emptyLayout(SEED, SIZE));
});

test('a different seed or grid size throws the whole island away', () => {
  const layout = planted();
  assert.deepEqual(roundTrip(layout, (l) => { l.seed = SEED + 1; }), emptyLayout(SEED, SIZE));
  assert.deepEqual(roundTrip(layout, (l) => { l.size = SIZE * 2; }), emptyLayout(SEED, SIZE));
});

test('a re-parcelling keeps the town and the bridges, and nothing else that stands', () => {
  const layout = planted();
  const townBefore = JSON.parse(JSON.stringify(layout.town));
  const civics = Object.keys(layout.plots).filter((id) => id.startsWith('civic:'));
  assert.ok(civics.length >= 3, 'the fixture should have unlocked some civic buildings');

  const back = roundTrip(layout, (l) => { l.parcelV = PARCEL_VERSION - 1; });

  for (const id of Object.keys(back.plots)) {
    assert.ok(!id.startsWith('house:'), `${id} survived a re-parcelling`);
    assert.ok(!id.startsWith('shed:'), `${id} survived a re-parcelling`);
  }
  for (const id of civics) assert.ok(back.plots[id], `civic ${id} should have been kept`);
  assert.deepEqual(back.paths, [], 'paths are pure geometry and are re-routed from nothing');
  assert.deepEqual(back.cleared, [], 'the scars of the old lattice should be gone');
  assert.equal(back.lattice, null, 'the lattice is re-anchored');
  // The town keeps every stone; only the two derived fields go with the lattice.
  assert.deepEqual(back.town.square, townBefore.square);
  assert.deepEqual(back.town.centre, townBefore.centre);
  assert.equal(back.parcelV, PARCEL_VERSION);
});

test('a re-routing drops the roads and leaves every building standing', () => {
  const layout = planted();
  const plotsBefore = JSON.parse(JSON.stringify(layout.plots));
  const roadIds = layout.paths.filter((p) => p.id.startsWith('road:')).map((p) => p.id);
  const frontIds = layout.paths.filter((p) => p.id.startsWith('path:')).map((p) => p.id);
  assert.ok(roadIds.length > 0, 'the fixture should have laid some hamlet roads');

  const back = roundTrip(layout, (l) => { l.roadV = ROAD_VERSION - 1; });

  assert.deepEqual(back.plots, plotsBefore, 'a re-routing must not move a single building');
  const left = back.paths.map((p) => p.id);
  for (const id of roadIds) assert.ok(!left.includes(id), `hamlet road ${id} should have been dropped`);
  for (const id of frontIds) assert.ok(left.includes(id), `front path ${id} should have been kept`);
  assert.deepEqual(back.cleared, [], 'cleared goes with the roads');
  for (const rec of Object.values(back.districts)) {
    for (const lobe of rec.lobes || []) assert.equal(lobe.road, null, 'a lobe should have forgotten its road');
  }
});

test('new ground re-founds the island, town and all', () => {
  // This is the gate the server rewrite trips once, on purpose. It is the most violent one
  // there is - it takes the town square with it - so it is worth stating out loud that this
  // is intended behaviour and not an accident.
  const layout = planted();
  assert.ok(layout.town, 'the fixture has a town');
  const town = JSON.stringify(layout.town);
  layout.worldRev = 'deadbeef';                          // as if the island had been re-baked

  placeAll(layout, makeModel(VILLAGE, { milestones: MILESTONES }), { lots, seed: SEED, worldRev });

  assert.equal(layout.worldRev, worldRev, 'the layout should record the world it was planned on');
  assert.ok(Object.keys(layout.plots).length > 0, 'and the island should be replanned, not left empty');
  assert.ok(layout.refoundedAt, 'a village that moved should say when');
  assert.equal(layout.previous.worldRev, 'deadbeef', 'and where it stood before');
  assert.equal(JSON.stringify(layout.previous.town), town, 'keeping the old town on record');
});
