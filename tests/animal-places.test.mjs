// Where the story animals can be (lib/animal-places.mjs, Plans/dierenverhalen.md).
//
// The promises: every spot an animal is sent to is land and outside every building; a doorstep
// is just outside the door and not on the settler's own spot; a mark only goes on ground a
// garden bed would accept, never twice in one place; the landmark is the lighthouse when there
// is one; and the same village always gives the same answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { islandPlaces } from '../lib/animal-places.mjs';
import { animalIsland } from './support/animal-island.mjs';

test('every settler has a doorstep, a garden and a roof, and none of them is inside a wall', () => {
  const { village, check } = animalIsland();
  const p = islandPlaces(village, { check: check() });
  const rs = p.residents();
  assert.equal(rs.length, 5);
  for (const r of rs) {
    assert.ok(r.spots.door && r.spots.garden, `${r.id} has nowhere to be visited`);
    for (const k of ['door', 'garden']) assert.ok(p.standable(...r.spots[k]), `${r.id} ${k} is not standable`);
    assert.ok(r.cursor > 0);
  }
  // The doorstep of a house facing +z (rot 2) is on its +z side, beside the doorway.
  const h = village.buildings[0];
  const r0 = rs.find((r) => r.id === h.id);
  const frontZ = h.plot.gz + 3 - p.half;
  assert.ok(r0.spots.door[1] > frontZ, 'the doorstep is not in front of the house');
  const doorX = h.plot.gx + 1.5 - p.half;
  assert.ok(Math.abs(r0.spots.door[0] - doorX) > 0.3, 'standing exactly where the settler stands');
});

test('a newcomer gets a home by a house, a goat a lookout on higher ground', () => {
  const { village, check, terrain: t } = animalIsland();
  const p = islandPlaces(village, { check: check() });
  const b = village.buildings[1];
  for (const sp of ['chicken', 'goat', 'sparrow']) {
    const home = p.homeFor(sp, b);
    assert.ok(home && home.r > 0 && /Verdant Moor/.test(home.label), sp);
  }
  const home = p.homeFor('goat', b);
  const look = p.lookoutNear(home);
  assert.ok(look, 'no lookout');
  assert.ok(t.worldHeight(look[0], look[1]) >= t.worldHeight(home.x, home.z) - 1e-6, 'the lookout is lower than home');
});

test('the landmark is the lighthouse, and marks go on honest ground a mark apart', () => {
  const { village, check } = animalIsland();
  const p = islandPlaces(village, { check: check() });
  const lm = p.landmark();
  assert.equal(lm.label, 'lighthouse');
  const near = p.residents()[0].spots.door;
  const placed = [];
  for (let i = 0; i < 4; i++) {
    const at = p.traceSpot(near, placed);
    assert.ok(at, `no room for mark ${i}`);
    assert.ok(p.honest(at.x, at.z));
    for (const q of placed) assert.ok(Math.hypot(q.x - at.x, q.z - at.z) >= 0.7 - 1e-9, 'two marks on top of each other');
    placed.push(at);
  }
  // Out at sea there is no ground at all.
  assert.equal(p.traceSpot([-p.half + 0.5, -p.half + 0.5], []), null);
});

test('the same village gives the same answers', () => {
  const { village, check } = animalIsland();
  const a = islandPlaces(village, { check: check() });
  const b = islandPlaces(structuredClone(village), { check: check() });
  assert.deepEqual(a.residents(), b.residents());
  assert.deepEqual(a.landmark(), b.landmark());
  assert.deepEqual(a.lookoutNear(a.homeFor('goat', village.buildings[2])), b.lookoutNear(b.homeFor('goat', village.buildings[2])));
});
