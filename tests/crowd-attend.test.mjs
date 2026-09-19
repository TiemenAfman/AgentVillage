// Walking up to a settler, over a socket.
//
// The walk holds one attention slot per settler and has no idea who filled it
// (shared/settlerwalk.mjs), which was fine while the page doing the talking was the page
// running the walk: the slot died with the tab. The sea walks the crowd now, so the other
// half of the pairing had to be written down somewhere, and lib/crowd.mjs is where. What
// is asserted here is the half that only exists because there is a network: somebody
// stopping talking, and somebody vanishing mid-sentence.
//
// No loader and no document, like every test of the sea's own half.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCrowd, createCrowds } from '../lib/crowd.mjs';
import { makeTerrain } from '../shared/terrain.mjs';

const SIZE = 64;
const SEED = 1337;

// The same shape lib/fleet.mjs hands over, cut to the bone: a lane of houses and nothing
// on the water, because nothing here sails.
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
      island: { name: 'Testholm', seed: SEED, gridSize: SIZE, landing: null },
      buildings,
      paths: [{ id: 'lane', cells: lane }],
      town: { paved: lane.slice(0, 4) },
    },
  };
}

const first = (crowd) => [...crowd.figures.values()][0];

test('being spoken to holds somebody where they stand', () => {
  const crowd = createCrowd(island());
  const f = first(crowd);
  // Long enough that an errand would have taken them somewhere: MAX_STROLL and the idle
  // wander both have plenty of time in four hundred ticks.
  crowd.advance(400, 0);

  assert.equal(crowd.attend('alice', f.id, [f.pos[0] + 1.2, f.pos[1]]), true);
  const was = [f.pos[0], f.pos[1]];
  crowd.advance(400, 0);
  assert.deepEqual([f.pos[0], f.pos[1]], was, 'a settler being talked to wandered off');
  assert.equal(f.anim, 'still');

  // And they are looking at whoever it is, rather than wherever they last walked.
  assert.ok(f.face[0] > 0.9, `turned to face the talker, not ${f.face}`);
});

test('letting go lets them get on with their day', () => {
  const crowd = createCrowd(island());
  const f = first(crowd);
  crowd.attend('alice', f.id, [f.pos[0] + 1.2, f.pos[1]]);
  assert.equal(crowd.release('alice'), true);
  assert.equal(f.attend, null);
  // Releasing twice is not an error - a page that reloads mid-sentence sends it again.
  assert.equal(crowd.release('alice'), false);
});

test('the first to leave does not take the second one’s conversation with them', () => {
  const crowd = createCrowd(island());
  const f = first(crowd);
  crowd.attend('alice', f.id, [f.pos[0] + 1.2, f.pos[1]]);
  crowd.attend('bob', f.id, [f.pos[0] - 1.4, f.pos[1]]);

  crowd.release('alice');
  assert.notEqual(f.attend, null, 'bob was still standing there and got cut off');
  assert.ok(f.attend[0] < f.pos[0], 'the settler is looking at where alice was, not bob');

  crowd.release('bob');
  assert.equal(f.attend, null);
});

test('one conversation at a time, and the old one ends by itself', () => {
  const crowd = createCrowd(island());
  const [a, b] = [...crowd.figures.values()];
  crowd.attend('alice', a.id, [a.pos[0] + 1, a.pos[1]]);
  crowd.attend('alice', b.id, [b.pos[0] + 1, b.pos[1]]);
  assert.equal(a.attend, null, 'the first settler is still being held by somebody who left');
  assert.notEqual(b.attend, null);
});

test('a talker who vanishes releases whoever they were holding', () => {
  const crowds = createCrowds();
  const it = island();
  const crowd = crowds.join(it);
  const f = first(crowd);

  assert.equal(crowds.attend('alice', it.id, f.id, [f.pos[0] + 1, f.pos[1]]), true);
  assert.notEqual(f.attend, null);
  // What lib/players.mjs calls on detach - a closed laptop, a lost line, a reload.
  assert.equal(crowds.release('alice'), true);
  assert.equal(f.attend, null, 'a settler is waiting for somebody who is never coming back');
});

test('a settler on an island that is not here is simply not held', () => {
  const crowds = createCrowds();
  const it = island();
  crowds.join(it);
  assert.equal(crowds.attend('alice', 'nowhere', 'house:0000', [0, 0]), false);
  assert.equal(crowds.attend('alice', it.id, 'house:9999', [0, 0]), false);

  // And an island that sinks under a conversation leaves nothing behind to let go of.
  const f = first(crowds.get(it.id));
  crowds.attend('bob', it.id, f.id, [f.pos[0] + 1, f.pos[1]]);
  crowds.leave(it.id);
  assert.equal(crowds.release('bob'), false);
});
