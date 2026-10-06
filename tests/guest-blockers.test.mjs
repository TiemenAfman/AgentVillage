// The houses on a guest island stop a walker (#70): on a starter you walked straight through the
// tavern and the town hall.
//
// Two halves. guest-island.js's blockers() has to hand over the starter's walls where they stand
// in the world - the island is drawn in an offset group, a blocker is read in world coordinates.
// And main.js has to hand them to walk mode when the island goes up: walk mode keeps the list it
// was given, and on the phone every island is raised while you are already walking (its home is
// open water, the fleet arrives after), so an island raised without a fresh list had no walls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

// buildings.js builds a TextureLoader at import time (see CLAUDE.md, tests).
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {}, strokeRect() {}, fillText() {}, strokeText() {}, clearRect() {}, measureText: () => ({ width: 0 }) }) }),
  createElementNS: () => ({ width: 1, height: 1, addEventListener() {}, removeEventListener() {}, set src(_) {} }),
};
const THREE = await import('three');
const { createGuestIsland } = await import('../web/js/guest-island.js');
const { makeTerrain } = await import('../shared/terrain.mjs');
const { placeIsland } = await import('../shared/regions.mjs');
const { starterBundle } = await import('../lib/islandbundle.mjs');

test('a starter raised as a guest hands walk mode the walls of its buildings, where they stand', () => {
  const b = starterBundle(0);
  const terrain = makeTerrain(b.island.seed, { size: b.grid.size });
  const origin = [400, -200];
  const region = placeIsland(terrain, { id: b.island.id, origin });
  region.village = b;
  const g = createGuestIsland({ scene: new THREE.Scene(), region, buildings: b.buildings, material: new THREE.MeshStandardMaterial(), month: 8 });
  const list = g.blockers();
  for (const civic of ['civic:tavern', 'civic:townhall']) {
    const rec = g.records.find((r) => r.id === civic);
    assert.ok(rec, `the starter has no ${civic}`);
    const walls = list.filter((x) => x.id === `guest:${region.id}:${civic}`);
    assert.ok(walls.length > 0, `${civic} hands walk mode nothing to stop at`);
    // In the world: round the building's own spot plus the island's origin.
    const wx = origin[0] + rec.group.position.x, wz = origin[1] + rec.group.position.z;
    const near = walls.filter((w) => Math.hypot(w.x - wx, w.z - wz) < 8);
    assert.ok(near.length > 0, `${civic}'s walls are not where it stands (${wx.toFixed(1)}, ${wz.toFixed(1)})`);
  }
});

test('raising or lowering a guest island while walking hands walk mode the new blockers', () => {
  const MAIN = readFileSync(new URL('../web/js/main.js', import.meta.url), 'utf8');
  const at = MAIN.indexOf('\nfunction raiseGuestIslands(');
  assert.ok(at >= 0, 'main.js has no raiseGuestIslands any more - this test reads it');
  const end = MAIN.indexOf('\nfunction ', at + 1);
  const body = MAIN.slice(at, end < 0 ? undefined : end);
  assert.match(body, /state\.walk\.setBlockers\(walkableBlockers\(\)\)/,
    'raiseGuestIslands no longer refreshes walk mode\'s blockers: an island raised mid-walk has no walls');
});
