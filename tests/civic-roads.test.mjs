// A civic building whose road leaned on a hamlet road has it back on the scan that lost it,
// not on the one after (lib/layout.mjs, "the civic roads, relaid once more").
//
// A road records only the cells it paved itself, so a civic road that braided onto a hamlet
// road is left ending in the grass when that hamlet is taken up, and scan.mjs's
// `pruneUnreachable` drops it. `placeAll` lays it again from the door, but the pass that does
// so runs before the front paths, and from a building far out on the coast the router finds
// no way to the square across unroaded ground in its budget. The front paths then paved part
// of the way, and the road came back only on the next scan - which was not a no-op. Found on
// a copy of the live island (the fishery, 120 cells from the square); seed 2024 on a 256 grid
// is an island where the same happens, to the weigh house, and this test failed on it before
// the second pass existed.
//
// The wipe is scan.mjs's own: every hamlet road taken up, then whatever only reached the
// square through one. The hamlets themselves stay, so their roads are laid again in the same
// pass - after the first civic pass, which is the point.
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLayout, placeAll, plotDoor, pruneUnreachable } from '../lib/layout.mjs';
import { MILESTONES, civicIdOf } from '../lib/village.mjs';
import { village } from './support/village.mjs';

const SEED = 2024;
const SIZE = 256;

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

// Every civic lot with a door and no road of its own on record.
const roadless = (l) => Object.entries(l.plots)
  .filter(([id, p]) => id.startsWith('civic:') && plotDoor(id, p) && !l.paths.some((q) => q.id === `path:${id}`))
  .map(([id]) => id);

test('a civic road that leaned on a hamlet road is back on the scan that lost it, and the next changes nothing', () => {
  const model = ladder(200);
  const layout = emptyLayout(SEED, SIZE);
  placeAll(layout, model, { seed: SEED, size: SIZE });
  const before = roadless(layout);

  for (const rec of Object.values(layout.districts)) {
    for (const lobe of rec.lobes || []) {
      if (!lobe.road) continue;
      layout.paths = layout.paths.filter((q) => q.id !== lobe.road);
      lobe.road = null;
    }
  }
  const lost = pruneUnreachable(layout, layout.size)
    .filter((id) => id.startsWith('path:civic:') && layout.plots[id.slice('path:'.length)]);
  assert.ok(lost.length, 'taking up the hamlet roads cost a civic building its road');

  placeAll(layout, model, { seed: SEED, size: SIZE });
  assert.deepEqual(roadless(layout), before, 'every civic lot that had a road has one again');
  const once = JSON.stringify(layout);
  placeAll(layout, model, { seed: SEED, size: SIZE });
  assert.equal(JSON.stringify(layout), once, 'and the scan after it changes nothing');
});
