// A crowd rebuilt in the middle of a gathering keeps its people where they are.
//
// 8 October 2026, lunch on Hoogezand: a long line of settlers on the road through the wood to
// the square, and a minute later the road was empty. A working island republishes every scan
// (a house's `lastAt` moves), the sea builds the crowd again from the bundle, and a new crowd
// stood everybody back at their own front door - a field away, and on a road longer than a
// minute's walk nobody ever reached the square. `adopt` (shared/settlerwalk.mjs) now carries
// the gathering over the way it carries the gold errand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCrowds } from '../lib/crowd.mjs';
import { makeTerrain } from '../shared/terrain.mjs';
import { DT } from '../shared/settlerwalk.mjs';

// One long lane with the square at its west end and the houses at its east end, so the walk
// to the square takes well over a minute.
function island(id) {
  const terrain = makeTerrain(1337, { size: 64 });
  const mid = Math.round(terrain.half);
  const lane = [];
  for (let gx = 4; gx < 60; gx++) if (terrain.isLand(gx, mid)) lane.push([gx, mid]);
  const buildings = lane.slice(-6).map(([gx, gz], i) => ({
    id: `house:${i}`, kind: 'house', name: `House ${i}`, style: 'opus', plot: { gx, gz: gz + 1, w: 1, d: 1, rot: 0 },
  }));
  const square = lane.slice(0, 3);
  return { id, terrain, square, bundle: { island: { name: id, seed: 1337, gridSize: 64, landing: null, town: { paved: square } }, buildings, paths: [{ id: 'lane', cells: lane }] } };
}

const MINUTE = Math.round(60 / DT);
const houses = (crowd) => [...crowd.figures.values()].filter((f) => f.id.startsWith('house:'));

test('a republish mid-walk keeps every gatherer where they were, on their way', () => {
  const crowds = createCrowds({ now: () => 0 });
  const it = island('a');
  const first = crowds.join(it);
  crowds.setGather(true);
  first.advance(400, 0);
  const before = new Map(houses(first).map((f) => [f.id, [f.pos[0], f.pos[1]]]));
  assert.ok(houses(first).every((f) => f.gathering && f.mode === 'walk'), 'everybody is on the road');

  const again = crowds.join(island('a'));
  for (const f of houses(again)) {
    const [x, z] = before.get(f.id);
    assert.ok(Math.hypot(f.pos[0] - x, f.pos[1] - z) < 1e-9, `${f.id} was stood back somewhere else`);
    assert.ok(f.gathering && f.mode === 'walk', `${f.id} stopped walking to the square`);
  }
});

test('republished every minute, the village still reaches the square and goes home after', () => {
  const crowds = createCrowds({ now: () => 0 });
  const it = island('a');
  let crowd = crowds.join(it);
  crowds.setGather(true);
  const onSquare = (f) => Math.abs(f.pos[0] - it.terrain.cellWorld(it.square[0][0], it.square[0][1])[0]) < 4;
  let minutes = 0;
  while (minutes < 10 && !houses(crowd).every(onSquare)) {
    crowd.advance(MINUTE, 0);
    crowd = crowds.join(island('a'));     // the scan's republish
    minutes++;
  }
  assert.ok(houses(crowd).every(onSquare), `after ${minutes} minutes of republishing, still not all on the square`);
  // Standing about on the square through another republish, and nobody wanders off.
  crowd.advance(MINUTE, 0);
  crowd = crowds.join(island('a'));
  assert.ok(houses(crowd).every((f) => f.gathering && onSquare(f)), 'a republish took somebody off the square');

  // And when the bell rings the end, home along the road they came.
  crowds.setGather(false);
  for (let m = 0; m < 10 && houses(crowd).some((f) => f.gathering); m++) {
    crowd.advance(MINUTE, 0);
    crowd = crowds.join(island('a'));
  }
  assert.ok(houses(crowd).every((f) => !f.gathering), 'somebody never got home');
});

test('a gatherer whose house moved starts at the new door', () => {
  const crowds = createCrowds({ now: () => 0 });
  const first = crowds.join(island('a'));
  crowds.setGather(true);
  first.advance(400, 0);
  const moved = island('a');
  moved.bundle.buildings[0].plot.gz -= 2;
  const again = crowds.join(moved);
  const f = again.figures.get('house:0');
  // At their new door (spawn stands them within a few centimetres of it), not on the road.
  assert.ok(Math.hypot(f.pos[0] - f.home[0], f.pos[1] - f.home[1]) < 0.2, 'carried over from a door that is no longer theirs');
  assert.equal(f.gathering, false);
  // Everybody else did come along.
  assert.ok(houses(again).filter((g) => g.id !== 'house:0').every((g) => g.gathering));
});
