// The bell, rung by the sea.
//
// shared/settlerwalk.mjs has had `setGather` since the first borrel, and the walk test
// proves the square fills and empties when it is called. What was missing was anybody
// calling it: the browser stopped when the walk moved out to the sea, and the sea never
// started. This file is the half that only exists because there is a sea - that the
// crowds are told, off the world's clock, and told at once when they are rebuilt.
//
// No loader and no document, like every test of the sea's own half.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCrowds } from '../lib/crowd.mjs';
import { makeTerrain } from '../shared/terrain.mjs';

const SIZE = 64;
const SEED = 1337;

// The same shape lib/fleet.mjs hands over, cut to the bone: a lane of houses with a bit
// of square on it, and nothing on the water.
function island(id = 'testholm') {
  const terrain = makeTerrain(SEED, { size: SIZE });
  const mid = Math.round(terrain.half);
  const lane = [];
  for (let gx = 8; gx < SIZE - 8; gx++) if (terrain.isLand(gx, mid)) lane.push([gx, mid]);
  const buildings = lane.slice(0, 6).map(([gx, gz], i) => ({
    id: `house:${String(i).padStart(4, '0')}`,
    kind: 'house', name: `House ${i}`, style: 'opus',
    plot: { gx, gz: gz + 1, w: 1, d: 1, rot: 0 },
  }));
  return {
    id,
    terrain,
    bundle: {
      // The paving goes inside `island`, which is where shared/roads.mjs looks for it -
      // a square at the top level reads as no square at all, and then the bell rings and
      // nobody has anywhere to go.
      island: { name: 'Testholm', seed: SEED, gridSize: SIZE, landing: null, town: { paved: lane.slice(8, 12) } },
      buildings,
      paths: [{ id: 'lane', cells: lane }],
    },
  };
}

// A moment on this machine's own clock, which is the clock the sea reads - see `bellAt`
// in lib/crowd.mjs. Built with the local constructor so the test says "Wednesday, 12:35"
// in whatever zone it happens to run.
const WED = 23, SAT = 26;   // September 2026
const localAt = (day, h, m) => new Date(2026, 8, day, h, m).getTime();

const gathering = (crowd) => [...crowd.figures.values()].filter((f) => f.gathering).length;

// A minute of world time per beat. The cap is off because the point of the test is to get
// through lunch, not to protect a sea from a suspended laptop.
function minutes(crowds, clock, n) {
  for (let i = 0; i < n; i++) { clock.t += 60000; crowds.tick(0); }
}

test('lunch on a Wednesday fills the square, and one o\'clock empties it again', () => {
  const clock = { t: localAt(WED, 12, 35) };
  const crowds = createCrowds({ now: () => clock.t, maxTicksPerBeat: Infinity });
  const crowd = crowds.join(island());
  const home = new Map([...crowd.figures.values()].map((f) => [f.id, [f.home[0], f.home[1]]]));

  minutes(crowds, clock, 20);
  assert.equal(crowds.gathering() && crowds.gathering().id, 'lunch');
  assert.ok(gathering(crowd) > 0, 'the bell rang and nobody came');

  clock.t = localAt(WED, 13, 0);
  minutes(crowds, clock, 40);
  assert.equal(crowds.gathering(), null);
  assert.equal(gathering(crowd), 0, 'somebody is still at the tables at twenty to two');
  for (const f of crowd.figures.values()) {
    if (f.after || f.then) continue;
    assert.deepEqual([f.home[0], f.home[1]], home.get(f.id), `${f.id} did not get their doorstep back`);
  }
});

test('the same hour on a Saturday rings no bell', () => {
  const clock = { t: localAt(SAT, 12, 35) };
  const crowds = createCrowds({ now: () => clock.t, maxTicksPerBeat: Infinity });
  const crowd = crowds.join(island());
  minutes(crowds, clock, 20);
  assert.equal(crowds.gathering(), null);
  assert.equal(gathering(crowd), 0, 'somebody went to lunch on a Saturday');
});

test('a village rebuilt in the middle of lunch is told so at once, not on the next beat', () => {
  const clock = { t: localAt(WED, 12, 40) };
  const crowds = createCrowds({ now: () => clock.t, maxTicksPerBeat: Infinity });
  crowds.join(island('first'));
  minutes(crowds, clock, 1);
  assert.equal(crowds.gathering() && crowds.gathering().id, 'lunch');

  // A republish: the crowd is thrown away and built again from the bundle. Stepped on its
  // own here, without a beat of the world's clock in between, so the only way anybody can
  // be on their way to the square is if `join` told them.
  const again = crowds.join(island('first'));
  again.advance(2400, 0);
  assert.ok(gathering(again) > 0, 'the rebuilt village stood at its doorsteps through lunch');
});

test('a village that arrives outside a break is left to its own day', () => {
  const clock = { t: localAt(WED, 14, 0) };
  const crowds = createCrowds({ now: () => clock.t, maxTicksPerBeat: Infinity });
  minutes(crowds, clock, 1);
  const crowd = crowds.join(island());
  crowd.advance(2400, 0);
  assert.equal(gathering(crowd), 0);
});
