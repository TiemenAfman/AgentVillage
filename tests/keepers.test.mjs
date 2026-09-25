// The innkeeper and the mayor (Plans/kroegbaas-en-burgemeester.md).
//
// Two figures who keep a building rather than live in a house: they go by the building's
// id, stand at its door, never stroll off, do chores or take a boat, and each has a round -
// the mayor across the square now and then, the innkeeper among the tables while the
// village is gathered.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCrowd } from '../lib/crowd.mjs';
import { makeTerrain } from '../shared/terrain.mjs';
import { keeperOf, residentLook, settlerLook, KEEPERS } from '../shared/palette.mjs';

const SIZE = 64;
const SEED = 1337;

function island(n = 6) {
  const terrain = makeTerrain(SEED, { size: SIZE });
  const mid = Math.round(terrain.half);
  const lane = [];
  for (let gx = 8; gx < SIZE - 8; gx++) if (terrain.isLand(gx, mid)) lane.push([gx, mid]);
  const paved = [];
  for (let gz = mid - 1; gz <= mid + 1; gz++) for (let gx = mid - 3; gx <= mid + 3; gx++) if (terrain.isLand(gx, gz)) paved.push([gx, gz]);
  const buildings = lane.slice(0, n).map(([gx, gz], i) => ({
    id: `house:${i}`, kind: 'house', name: `House ${i}`, style: 'opus', plot: { gx, gz: gz + 1, w: 1, d: 1, rot: 0 },
  }));
  // Both facing +z, towards the lane, their fronts on the paving.
  buildings.push({ id: 'civic:tavern', kind: 'civic', civicType: 'tavern', name: 'The tavern', plot: { gx: mid + 1, gz: mid - 5, w: 3, d: 3, rot: 2 } });
  buildings.push({ id: 'civic:townhall', kind: 'civic', civicType: 'townhall', name: 'Town Hall', plot: { gx: mid - 4, gz: mid - 5, w: 3, d: 3, rot: 2 } });
  buildings.push({ id: 'civic:well', kind: 'civic', civicType: 'well', name: 'The well', plot: { gx: mid, gz: mid + 3, w: 1, d: 1, rot: 0 } });
  return {
    id: 'testholm', terrain, mid, paved,
    bundle: {
      island: { name: 'Testholm', seed: SEED, gridSize: SIZE, landing: null, town: { paved } },
      buildings, paths: [{ id: 'lane', cells: lane }],
    },
  };
}

const far = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2);

test('the tavern and the town hall have somebody at the door, and the well does not', () => {
  const crowd = createCrowd(island());
  const inn = crowd.figures.get('civic:tavern');
  const mayor = crowd.figures.get('civic:townhall');
  assert.ok(inn && mayor, 'nobody at the tavern or the town hall');
  assert.equal(inn.post, 'innkeeper');
  assert.equal(mayor.post, 'mayor');
  assert.equal(crowd.figures.get('civic:well'), undefined);
  // After the houses on the wire, so nobody who was already here changes index.
  const ids = [...crowd.figures.keys()];
  assert.deepEqual(ids.slice(-2), ['civic:tavern', 'civic:townhall']);
  // Out of the front of the lot, not inside it: a 3x3 lot's front is 1.5 from its middle.
  const t = island().bundle.buildings.find((b) => b.id === 'civic:tavern').plot;
  const cz = t.gz + 1.5 - SIZE / 2;
  assert.ok(inn.home[1] - cz > 1.5, `the innkeeper stands ${(inn.home[1] - cz).toFixed(2)} out of a lot 1.5 deep`);
});

test('they look like what they keep, and the same on the sea as on the page', () => {
  const spec = { id: 'civic:townhall', kind: 'civic', civicType: 'townhall' };
  const a = residentLook(spec), b = residentLook({ ...spec });
  assert.deepEqual(a, b);
  assert.equal(a.hatShape, KEEPERS.townhall.dress.hatShape);
  assert.equal(a.tunic, KEEPERS.townhall.dress.tunic);
  // Their own face and height under the dress: hashed off the id, like everybody's.
  assert.equal(a.height, settlerLook('civic:townhall', 'unknown', 'adult').height);
  assert.equal(residentLook({ id: 'civic:tavern', kind: 'civic', civicType: 'tavern' }).hatShape, 'none');
  assert.equal(keeperOf({ id: 'house:1', kind: 'house' }), null);
});

test('the innkeeper keeps to the door on an ordinary day; the mayor walks the square', () => {
  const crowd = createCrowd(island());
  const inn = crowd.figures.get('civic:tavern');
  const mayor = crowd.figures.get('civic:townhall');
  const innHome = [...inn.home];
  let innFurthest = 0, mayorFurthest = 0;
  for (let i = 0; i < 40000; i++) {
    crowd.advance(1, 0);
    innFurthest = Math.max(innFurthest, far(inn.pos, innHome));
    mayorFurthest = Math.max(mayorFurthest, far(mayor.pos, mayor.home));
    assert.ok(!inn.work && !mayor.work, 'a keeper went off to do a chore');
  }
  assert.ok(innFurthest < 0.6, `the innkeeper wandered ${innFurthest.toFixed(2)} from the door`);
  assert.ok(mayorFurthest > 1.5, `the mayor never left the town hall step (${mayorFurthest.toFixed(2)})`);
  assert.equal(crowd.walk.available(20, null).some((f) => f.id.startsWith('civic:')), false, 'a keeper was offered a boat');
});

test('at a gathering the innkeeper serves the tables, and the mayor comes too', () => {
  const v = island();
  const crowd = createCrowd(v);
  const inn = crowd.figures.get('civic:tavern');
  const mayor = crowd.figures.get('civic:townhall');
  crowd.walk.setGather(true);
  let served = 0;
  for (let i = 0; i < 30000; i++) {
    crowd.advance(1, 0);
    assert.equal(inn.gathering, false, 'the innkeeper joined the gathering instead of serving it');
    if (far(inn.pos, inn.home) > 1.5) served++;
  }
  assert.ok(served > 0, 'the innkeeper never left the door to serve');
  assert.equal(mayor.gathering, true, 'the mayor stayed away');
  crowd.walk.setGather(false);
  for (let i = 0; i < 30000; i++) crowd.advance(1, 0);
  assert.ok(far(inn.pos, inn.home) < 0.6, 'the innkeeper did not go back behind the bar');
});
