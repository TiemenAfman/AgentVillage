// Where islands drop anchor.
//
// The property that matters is not "they do not overlap" - createArchipelago.add already
// refuses that - but "an island that has an origin keeps it". A newcomer that shifted the
// fleet would slide the world under the feet of everybody standing on it, and it would do
// it on every screen at once.
//
// Most of these place a fleet of equals with nobody special in the middle, which is a sea
// raised without a volcano; the ones at the bottom put the volcano at [0, 0] the way every
// real sea does now (lib/fleet.mjs raiseVolcano) and hold the ring round it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextOrigin, clearOf, berthOf, SEA_GAP, createArchipelago, placeIsland, nearestFirst } from '../shared/regions.mjs';
import { makeTerrain } from '../shared/terrain.mjs';
import { VOLCANO } from '../shared/volcano.mjs';

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

// ---- the middle -----------------------------------------------------------------------

// The volcano's own half - 96 since it grew to a 192-grid (it was 64). Ring 1 lies at that
// plus SEA_GAP plus the biggest other island's half: 176 round 64-grids, 208 round 128s and
// 272 round 256s.
const VOLCANO_HALF = VOLCANO.size / 2;
const withVolcano = (halves) => {
  const placed = [isle(VOLCANO_HALF, [0, 0])];
  for (const half of halves) {
    const origin = nextOrigin(placed, half);
    assert.ok(origin, `no berth for an island of ${half}`);
    placed.push(isle(half, origin));
  }
  return placed;
};
const allClear = (placed, what) => {
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      assert.ok(clearOf(placed[i], placed[j]), `${what}: ${placed[i].origin} vs ${placed[j].origin}`);
    }
  }
};

test('the first island hugs the volcano across exactly one sea gap, due east', () => {
  const [, first] = withVolcano([32]);
  assert.deepEqual(first.origin, [VOLCANO_HALF + SEA_GAP + 32, 0]);
  // Written out, so a change to the volcano's size is seen to move everybody's berth.
  assert.deepEqual(first.origin, [176, 0]);
  assert.deepEqual(withVolcano([64])[1].origin, [208, 0]);
  assert.deepEqual(withVolcano([128])[1].origin, [272, 0]);
});

test('eight 64-grids fit on the first ring round the volcano, and the ninth starts the next', () => {
  const placed = withVolcano([32, 32, 32, 32, 32, 32, 32, 32, 32]);
  const ring = VOLCANO_HALF + SEA_GAP + 32;
  const reach = (p) => Math.max(Math.abs(p.origin[0]), Math.abs(p.origin[1]));
  assert.deepEqual(placed.slice(1, 9).map(reach), Array(8).fill(ring));
  // The four bearings first, in berthOf's order, so the horizon's "look east" still holds.
  assert.deepEqual(placed.slice(1, 5).map((p) => p.origin), [[ring, 0], [-ring, 0], [0, ring], [0, -ring]]);
  // One pitch of an ordinary island further out - the volcano does not set the spacing.
  assert.equal(reach(placed[9]), ring + 2 * 32 + SEA_GAP);
  allClear(placed, 'nine round the volcano');
});

test('the volcano does not spread the others out: neighbours on the ring keep their own gap', () => {
  const placed = withVolcano([32, 32, 32, 32, 32]);
  // The corners come after all four bearings, so the fifth island is a corner, and it sits
  // one ordinary sea gap from the bearing beside it - not a volcano's width.
  const corner = placed[5];
  const beside = placed.find((p) => p.origin[0] === corner.origin[0] && p.origin[1] === 0);
  const apart = Math.abs(corner.origin[1] - beside.origin[1]);
  assert.ok(apart >= 32 + 32 + SEA_GAP, `${apart}`);
  assert.ok(apart < 2 * VOLCANO_HALF + SEA_GAP, 'spaced by the volcano, not by themselves');
});

test('round the volcano, a newcomer never moves anybody and the answer ignores arrival order', () => {
  const grown = [isle(VOLCANO_HALF, [0, 0])];
  for (let n = 0; n < 12; n++) {
    const before = grown.map((p) => p.origin.join(','));
    grown.push(isle(32, nextOrigin(grown, 32)));
    assert.deepEqual(grown.slice(0, -1).map((p) => p.origin.join(',')), before);
  }
  // The same set handed over in another order gives the same next berth.
  const next = nextOrigin(grown, 32);
  const shuffled = [grown[5], grown[0], ...grown.slice(6).reverse(), ...grown.slice(1, 5)];
  assert.deepEqual(nextOrigin(shuffled, 32), next);
});

test('mixed sizes round the volcano still all clear each other and the middle', () => {
  for (const order of [[32, 64, 32], [64, 32, 128, 32], [128, 32, 32, 64], [32, 32, 32, 32, 32, 32, 32, 32, 64]]) {
    allClear(withVolcano(order), `${order}`);
  }
});

test('a phone looking for open water gets a free berth on the ring, not the volcano', () => {
  // web/js/main.js standaloneHome asks nextOrigin for a wanderer's home, fed the fleet rows.
  const placed = withVolcano([32, 32]);
  const berth = nextOrigin(placed, 32);
  assert.notDeepEqual(berth, [0, 0]);
  assert.ok(placed.every((p) => clearOf(isle(32, berth), p)));
});

test('the archipelago takes a volcano and its ring without complaint', () => {
  const sea = createArchipelago();
  const volcano = makeTerrain('volcano', { size: VOLCANO.size, volcano: true });
  sea.add(placeIsland(volcano, { id: 'volcano', origin: [0, 0] }));
  const placed = [isle(volcano.half, [0, 0])];
  for (let n = 0; n < 9; n++) {
    const terrain = makeTerrain(1337 + n, { size: 64 });
    const origin = nextOrigin(placed, terrain.half);
    placed.push(isle(terrain.half, origin));
    sea.add(placeIsland(terrain, { id: `isle-${n}`, origin }));
  }
  assert.equal(sea.count(), 10);
});
