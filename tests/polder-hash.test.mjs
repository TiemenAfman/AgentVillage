// The terrain hash and the polders, which are the two halves of one trap.
//
// `placeAll` treats a changed heightfield as a changed seed: the ground moved under a
// layout planned on the old one, so the island is planned again from nothing rather than
// leave houses standing in water. That guard is right for a tuned generator and for the
// rivers it was written for - and ruinous for a polder, because draining one changes the
// heightfield *on purpose*, every time the village crosses another POLDER_EVERY.
//
// The polder was the first thing to do that and the dredged channel is the second, so the
// rule below is not a polder's eccentricity: `planFairway` deepens the ground at
// FAIRWAY_AT exactly as `reclaim` raises it at POLDER_AT, and both stand behind the one
// line that records the hash.
//
// So `layout.terrainHash` has to be recorded after reclaiming, not before. Recorded
// before, the stored hash is the coast without the new polder: the next scan finds a
// mismatch it caused itself, wipes the town, reclaims, mismatches again - and every house
// on the island moves on every scan, which is the one thing layout.json must never do.
//
// The ordering is one line in `placeAll` and reads as arbitrary, which is exactly why it
// wants a measurement rather than a comment. There are three assertions here and the
// third is the one that would catch the line being moved back: an island carrying the
// hash the wrong ordering would have written is measured, and most of it moves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { placeAll, emptyLayout, poldersWanted, POLDER_AT } from '../lib/layout.mjs';
import { makeTerrain } from '../shared/terrain.mjs';

const SEED = 1337;
const SIZE = 64;

// The ground the layout says it made. This mirrors the `makeTerrain` call in `placeAll`
// (lib/layout.mjs:1553) and has to keep mirroring it: every list that feeds the heightfield
// belongs here, or the expectation below is computed from a different island than the one
// `placeAll` measured.
//
// It is a helper rather than four literal calls because the polder is no longer the only
// thing that moves the coast on purpose. The dredged channel is the second - dug at
// FAIRWAY_AT, which is twenty-five settlers and so already in the ground long before the
// first polder - and it is what turned "the bare island" from a fact into a moment. There
// is no reason to think it is the last, and a test that spells the list out does not fail
// when a third arrives: it goes on passing, against an island nobody is planning.
const groundOf = (l) => makeTerrain(SEED, { size: SIZE, polders: l.polders, fairway: l.fairway }).hash;

// A village of `settlers` spread over twelve projects, which past POLDER_AT is more land
// than a 64-grid has - the shortage polders exist for. Only the fields `placeAll` reads
// are filled in; it never looks at a settler, only at the buildings and the count.
function village(settlers, { mill = settlers >= POLDER_AT } = {}) {
  const districts = [], buildings = [];
  for (let d = 0; d < 12; d++) {
    const id = `proj:${d}`;
    const pop = Math.floor(settlers / 12) + (d < settlers % 12 ? 1 : 0);
    districts.push({ id, firstSeenAt: 1000 + d, population: pop });
    for (let n = 0; n < pop; n++) {
      buildings.push({ id: `house:${id}:${n}`, kind: 'house', district: id, startedAt: 2000 + d * 1000 + n });
    }
  }
  return {
    stats: { settlers }, districts, buildings, furniture: [],
    milestones: [{ civicType: 'poldermill', unlocked: mill }],
  };
}

const clone = (o) => JSON.parse(JSON.stringify(o));
// A plot's whole identity for this purpose: where it stands and which way it faces.
const stands = (l) => Object.fromEntries(Object.entries(l.plots).map(([id, p]) => [id, `${p.gx},${p.gz},${p.rot}`]));
const movedBetween = (a, b) => Object.keys(a).filter((id) => a[id] !== b[id]);

test('the hash on record is the coast after the polder, not before it', () => {
  // A village too small to reclaim anything, so the hash it records is the island before
  // any polder - but not an untouched one: at a hundred settlers the channel has been
  // dredged for seventy-five of them, and that is already in the ground and in the hash.
  const layout = emptyLayout(SEED, SIZE);
  placeAll(layout, village(POLDER_AT - 50), { seed: SEED, size: SIZE });
  const bare = groundOf(layout);
  assert.equal(layout.polders.length, 0, 'nothing is reclaimed below POLDER_AT');
  assert.ok(layout.fairway, 'and the channel is dug by now, which is what `bare` includes');
  assert.equal(layout.terrainHash, bare);
  const before = stands(layout);

  // And now it crosses POLDER_AT and drains its first polder.
  placeAll(layout, village(POLDER_AT + 10), { seed: SEED, size: SIZE });
  assert.equal(layout.polders.length, poldersWanted(POLDER_AT + 10));

  const drained = groundOf(layout);
  // Without this the assertion below would pass on an island that reclaimed nothing.
  assert.notEqual(drained, bare, 'draining a polder is supposed to move the coast');
  assert.equal(layout.terrainHash, drained, 'the hash on record is the drained coast');

  // Which is the whole point: the village that was already standing keeps every stone.
  assert.deepEqual(movedBetween(before, stands(layout)), [],
    'reclaiming land must not move a single thing that was already placed');
  assert.ok(layout.plots['civic:poldermill'], 'and the mill the polder earned is standing');
});

test('a scan of an island that has a polder changes nothing', () => {
  const layout = emptyLayout(SEED, SIZE);
  placeAll(layout, village(POLDER_AT - 50), { seed: SEED, size: SIZE });
  placeAll(layout, village(POLDER_AT + 10), { seed: SEED, size: SIZE });
  const before = clone(layout);
  placeAll(layout, village(POLDER_AT + 10), { seed: SEED, size: SIZE });
  // Compared as written rather than as objects, because that is what "a second scan does
  // not change layout.json" means - and because `clone` is the file round trip, which is
  // the only thing that drops the `commons: undefined` a hamlet house carries in memory.
  //
  // Everything `tests/layout-measure.test.mjs` compares, bar `districts`. A village this
  // dense is more than a 64-grid holds - which is the point of polders - so some projects
  // here are left with no land at all, and such a record picks up an empty `square` and
  // `paved` on its second pass through `placeAll`. That wobble reproduces on an island
  // with no polder on it at all and is nothing to do with the coast; the real scanner
  // does not meet it, which is why layout-measure can compare `districts` and this cannot.
  for (const part of ['terrainHash', 'polders', 'plots', 'town', 'paths', 'bridges', 'cleared', 'lattice']) {
    assert.equal(JSON.stringify(layout[part]), JSON.stringify(before[part]),
      `${part} was rewritten by the second scan`);
  }
});

test('the hash the wrong ordering would write re-plans the island', () => {
  // The negative control. This is what `placeAll` would have on record if the hash were
  // taken before `reclaim` instead of after it, and it is measured rather than argued:
  // the mismatch is treated as a reseeding and the town is planned again from nothing.
  const layout = emptyLayout(SEED, SIZE);
  placeAll(layout, village(POLDER_AT - 50), { seed: SEED, size: SIZE });
  placeAll(layout, village(POLDER_AT + 10), { seed: SEED, size: SIZE });
  const settled = stands(layout);

  const wrong = clone(layout);
  // The coast before the polder - and *with* the channel, because the wrong ordering would
  // still have dredged before it took the hash. Anything else makes the control wrong in
  // two ways and proves the weaker of them.
  wrong.terrainHash = makeTerrain(SEED, { size: SIZE, polders: [], fairway: layout.fairway }).hash;
  placeAll(wrong, village(POLDER_AT + 10), { seed: SEED, size: SIZE });

  const moved = movedBetween(settled, stands(wrong));
  assert.ok(moved.length > Object.keys(settled).length / 2,
    `the wrong hash should uproot most of the island; ${moved.length} of ${Object.keys(settled).length} moved`);
});
