// Where islands drop anchor in a sea that has no middle.
//
// The property that matters is not "they do not overlap" - createArchipelago.add already
// refuses that - but "an island that has an origin keeps it". A newcomer that shifted the
// fleet would slide the world under the feet of everybody standing on it, and it would do
// it on every screen at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextOrigin, clearOf, berthOf, SEA_GAP, createArchipelago, placeIsland, nearestFirst } from '../shared/regions.mjs';
import { makeTerrain } from '../shared/terrain.mjs';

const isle = (half, origin) => ({ half, origin });

// Place n islands of the given halves, one after another, the way a sea would as they join.
function fleet(halves) {
  const placed = [];
  for (const half of halves) {
    const origin = nextOrigin(placed, half);
    assert.ok(origin, `no berth for an island of ${half}`);
    placed.push(isle(half, origin));
  }
  return placed;
}

test('the first island is the middle, and there is no other middle', () => {
  assert.deepEqual(nextOrigin([], 32), [0, 0]);
});

test('one neighbour of the same size lands due east, where berthOf always put it', () => {
  const placed = fleet([32, 32]);
  assert.deepEqual(placed[1].origin, berthOf(0, 32, 32));
});

test('eight islands all have open water between every pair', () => {
  const placed = fleet([32, 32, 32, 32, 32, 32, 32, 32]);
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      assert.ok(clearOf(placed[i], placed[j]),
        `${i} and ${j} are too close: ${placed[i].origin} vs ${placed[j].origin}`);
    }
  }
});

test('a newcomer never moves anybody already at anchor', () => {
  const grown = [];
  const seen = [];
  for (let n = 0; n < 8; n++) {
    grown.push(isle(32, nextOrigin(grown, 32)));
    seen.push(grown.map((p) => p.origin.join(',')));
  }
  for (let n = 1; n < seen.length; n++) {
    assert.deepEqual(seen[n].slice(0, n), seen[n - 1],
      'placing island ' + n + ' moved one that was already there');
  }
});

test('an island leaving does not move the ones that stay', () => {
  const placed = fleet([32, 32, 32, 32, 32]);
  const before = placed.map((p) => p.origin.join(','));
  placed.splice(2, 1);                       // the middle one goes home
  assert.deepEqual(placed.map((p) => p.origin.join(',')),
    [before[0], before[1], before[3], before[4]],
    'removal is a splice, never a re-plan');
});

test('a big island joining a fleet of small ones moves nobody, it just lands further out', () => {
  const placed = fleet([32, 32, 32]);
  const before = placed.map((p) => p.origin.join(','));
  placed.push(isle(128, nextOrigin(placed, 128)));
  assert.deepEqual(placed.slice(0, 3).map((p) => p.origin.join(',')), before);
  for (let i = 0; i < 3; i++) assert.ok(clearOf(placed[i], placed[3]), `the big one crowds ${i}`);
});

test('mixed sizes in any arrival order still all clear each other', () => {
  for (const order of [[32, 128, 64], [128, 32, 64], [64, 32, 128], [32, 64, 128]]) {
    const placed = fleet(order);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        assert.ok(clearOf(placed[i], placed[j]), `${order}: ${i} vs ${j}`);
      }
    }
  }
});

test('the gap is real water, not a shared beach', () => {
  // Two islands of the same seed, so the coasts are identical and the worst case is the
  // one being measured. The land inside a grid stops short of its edge, so the water is
  // wider than SEA_GAP - but never narrower, which is the thing that would let somebody
  // wade across a crossing that is supposed to need a boat.
  const placed = fleet([32, 32]);
  const need = placed[0].half + placed[1].half + SEA_GAP;
  const apart = Math.abs(placed[1].origin[0] - placed[0].origin[0]);
  assert.ok(apart >= need, `${apart} < ${need}`);
});

test('the archipelago accepts a whole fleet without complaint', () => {
  // The real check: createArchipelago.add() throws on an overlap, so a placement that
  // satisfies clearOf must also satisfy the thing the viewer actually uses.
  const sea = createArchipelago();
  const placed = [];
  for (let n = 0; n < 6; n++) {
    const terrain = makeTerrain(1337 + n, { size: 64 });
    const origin = nextOrigin(placed, terrain.half);
    placed.push(isle(terrain.half, origin));
    sea.add(placeIsland(terrain, { id: `isle-${n}`, origin }));
  }
  assert.equal(sea.count(), 6);
  // And every island's own middle still reports its own ground rather than the open sea.
  for (let n = 0; n < 6; n++) {
    const r = sea.regionAt(placed[n].origin[0], placed[n].origin[1]);
    assert.ok(r, `nothing at the middle of island ${n}`);
    assert.equal(r.id, `isle-${n}`);
  }
});

// Which islands get drawn whole. A lattice puts four islands at the same distance from the
// middle, so "nearest first" is ambiguous unless something settles it - and what settled it
// before was the order the socket messages had arrived in. The near set then swapped
// members between two equally close islands, and every swap tore down a coast and built it
// again, announcing the same island as newly arrived every few seconds.
test('equally close islands are ordered the same way every time', () => {
  const ring = [
    { id: 'dd', origin: [304, 0] },
    { id: 'aa', origin: [0, 304] },
    { id: 'cc', origin: [-304, 0] },
    { id: 'bb', origin: [0, -304] },
    { id: 'ee', origin: [-304, -304] },
  ];
  const once = nearestFirst(ring, [0, 0]).map((r) => r.id);
  assert.deepEqual(once, ['aa', 'bb', 'cc', 'dd', 'ee'], 'the four at 304 sort by id, the corner last');
  // Any arrival order, the same answer.
  for (const shuffled of [[...ring].reverse(), [ring[2], ring[4], ring[0], ring[1], ring[3]]]) {
    assert.deepEqual(nearestFirst(shuffled, [0, 0]).map((r) => r.id), once);
  }
});

test('nearest is measured from home, not from the middle of the world', () => {
  const rows = [{ id: 'far', origin: [0, 0] }, { id: 'near', origin: [608, 0] }];
  assert.deepEqual(nearestFirst(rows, [304, 0]).map((r) => r.id), ['far', 'near'],
    'both are 304 away, so the tiebreak decides - and it is stable');
  assert.deepEqual(nearestFirst(rows, [600, 0]).map((r) => r.id), ['near', 'far']);
});
