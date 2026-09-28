// The fleet grows with the village (Plans/mijlpalen-tot-tweehonderd.md, "De vloot").
//
// From 130 settlers a boat every five, dealt round the harbours from the one the island's
// first boat lies at, until every harbour moors its three. What has to hold beyond the
// arithmetic: the count stays in the unit and the range every sea and page already read
// (`harbours[].boats`, 0..BOATS_PER_HARBOUR, the first boat not in it), so an older sea
// moors exactly the boats a newer page draws; the harbour that is dealt one fewer is the one
// mooringsFor really puts the first boat at; and B still builds a boat you can see, now that
// an earned count may already stand above the keeper's own.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyLayout, placeAll, HARBOUR_SIDES } from '../lib/layout.mjs';
import {
  earnedBoats, fleetOf, mooringsFor, FLEET_AT, FLEET_EVERY, FLEET_SIDES, BOATS_PER_HARBOUR,
} from '../shared/quay.mjs';
import { buildBoat, builtBoats, harbourRoom } from '../lib/boatyard.mjs';

const all = (sides) => sides.map((side) => ({ side }));
const total = (c) => Object.values(c).reduce((a, b) => a + b, 0);

test('the dealing order is the layout\'s own order of the harbours', () => {
  assert.deepEqual(FLEET_SIDES, HARBOUR_SIDES);
});

test('nothing is earned below 130, then one boat for every five', () => {
  const h = all(['n', 'e', 's', 'w']);
  assert.equal(total(earnedBoats(0, h, 'n')), 0);
  assert.equal(total(earnedBoats(FLEET_AT - 1, h, 'n')), 0);
  assert.equal(FLEET_AT, 130);
  assert.equal(FLEET_EVERY, 5);
  for (let n = 130; n <= 180; n++) {
    assert.equal(total(earnedBoats(n, h, 'n')), Math.floor((n - 130) / 5) + 1, `${n} settlers`);
  }
  assert.equal(total(earnedBoats(180, h, 'n')), 11, 'eleven by 180 - with the first boat, every berth of four harbours');
  assert.deepEqual(earnedBoats(180, h, 'n'), { n: 2, e: 3, s: 3, w: 3 }, 'the first boat\'s harbour takes one fewer');
  assert.deepEqual(earnedBoats(400, h, 'n'), { n: 2, e: 3, s: 3, w: 3 }, 'and it stops where the berths do');
});

test('dealt round from the first boat\'s harbour, in n e s w order, skipping sides with none', () => {
  const h = all(['n', 'e', 's', 'w']);
  assert.deepEqual(earnedBoats(130, h, 's'), { n: 0, e: 0, s: 1, w: 0 }, 'the kadehaven gets the first one');
  assert.deepEqual(earnedBoats(135, h, 's'), { n: 0, e: 0, s: 1, w: 1 });
  assert.deepEqual(earnedBoats(140, h, 's'), { n: 1, e: 0, s: 1, w: 1 }, 'and round past w to n');
  assert.deepEqual(earnedBoats(145, h, 's'), { n: 1, e: 1, s: 1, w: 1 });
  assert.deepEqual(earnedBoats(150, h, 's'), { n: 1, e: 1, s: 2, w: 1 }, 'then round again');

  // layout.harbours keeps a null slot for a side with no open-water coast.
  const gappy = [{ side: 'n' }, null, { side: 's' }, { side: 'w' }];
  assert.deepEqual(earnedBoats(130, gappy, 'n'), { n: 1, e: 0, s: 0, w: 0 });
  assert.deepEqual(earnedBoats(135, gappy, 'n'), { n: 1, e: 0, s: 1, w: 0 }, 'e has no harbour and is skipped');
  assert.deepEqual(earnedBoats(165, gappy, 'n'), { n: 2, e: 0, s: 3, w: 3 }, 'three harbours are full at eight');
  assert.deepEqual(earnedBoats(200, gappy, 'n'), { n: 2, e: 0, s: 3, w: 3 });

  // A first boat at none of the harbours: start at n, and every harbour holds three.
  assert.deepEqual(earnedBoats(130, h, null), { n: 1, e: 0, s: 0, w: 0 });
  assert.deepEqual(earnedBoats(185, h, null), { n: 3, e: 3, s: 3, w: 3 });
  // A `first` naming a side that has no harbour is the same as none.
  assert.deepEqual(earnedBoats(130, gappy, 'e'), { n: 1, e: 0, s: 0, w: 0 });
  assert.deepEqual(earnedBoats(300, [], 'n'), { n: 0, e: 0, s: 0, w: 0 }, 'no harbours, no boats');
});

test('an earned count is always one the bundle takes', () => {
  // parseBundle's whole(raw.boats, 0, BOATS_PER_HARBOUR) refuses the *whole* bundle past
  // three, so an island that earned a fourth would vanish from every sea.
  const h = all(['n', 'e', 's', 'w']);
  for (const first of [null, 'n', 'e', 's', 'w']) {
    for (let n = 0; n <= 400; n += 1) {
      for (const [side, k] of Object.entries(earnedBoats(n, h, first))) {
        assert.ok(Number.isInteger(k) && k >= 0 && k <= BOATS_PER_HARBOUR - (side === first ? 1 : 0), `${n}, first ${first}: ${side} ${k}`);
      }
    }
  }
});

// A real island's harbours, planned by the layout, to check fleetOf against mooringsFor:
// the same village shape tests/harbours.test.mjs builds, with a Cowork district so the
// island has a quay district of its own and the first boat lies at its planks.
const SIZE = 128;
function village(settlers = 12, cowork = 5) {
  const startedAt = Date.UTC(2026, 0, 2);
  const districts = [
    { id: 'p:d:\\git\\farm', kind: 'project', name: 'farm', population: settlers, firstSeenAt: startedAt },
    { id: 'quay', kind: 'quay', name: 'The Quay', population: cowork, firstSeenAt: startedAt },
  ];
  const buildings = [
    ...Array.from({ length: settlers }, (_, i) => ({
      id: `house:farm-${i}`, sessionId: `farm-${i}`, kind: 'house', district: districts[0].id, tier: 'hut', startedAt: startedAt + i * 1000,
    })),
    ...Array.from({ length: cowork }, (_, i) => ({
      id: `house:cowork-${i}`, sessionId: `cowork-${i}`, kind: 'house', district: 'quay', harbour: true, tier: 'hut', startedAt: startedAt + i * 1000,
    })),
  ];
  return { districts, buildings, milestones: [], furniture: [], stats: { settlers: settlers + cowork } };
}

for (const seed of [7, 1337, 90210]) {
  test(`the fleet is dealt to the harbours mooringsFor draws, one fewer where the first boat lies (seed ${seed})`, () => {
    const layout = emptyLayout(seed, SIZE);
    const { terrain } = placeAll(layout, village(), { seed, size: SIZE });
    const q = layout.districts.quay;
    // What scan.mjs hands fleetOf: the harbours as village.json lists them, and the
    // districts with their planks.
    const harbours = layout.harbours.filter(Boolean).map((h) => ({ side: h.side, shore: h.shore, pier: h.pier }));
    const districts = [{ id: 'quay', pier: q.pier, shore: q.shore }];
    const fleet = fleetOf(terrain, { island: { landing: layout.landing, harbours }, districts });
    assert.ok(fleet.harbours.length >= 2, `only ${fleet.harbours.length} harbour(s)`);

    const shipped = (n) => {
      const earned = earnedBoats(n, fleet.harbours, fleet.first);
      return { island: { landing: layout.landing, harbours: harbours.map((h) => ({ ...h, boats: earned[h.side] })) }, districts };
    };

    // Where the first boat is: exactly the side fleetOf named.
    const alone = mooringsFor('abc123', terrain, shipped(0));
    assert.deepEqual(alone.map((m) => m.id), ['boat:abc123']);
    assert.equal(alone[0].side, fleet.first, 'fleetOf names the harbour the first boat really lies at');

    // And from there the water fills up one boat every five settlers, never a boat lost to
    // a harbour's cap, until every berth is taken.
    // Every harbour's three, plus the first boat when it lies at none of them.
    const berths = fleet.harbours.length * BOATS_PER_HARBOUR + (fleet.first ? 0 : 1);
    let before = 1;
    for (let n = 125; n <= 200; n++) {
      const boats = mooringsFor('abc123', terrain, shipped(n));
      const want = Math.min(berths, 1 + (n < FLEET_AT ? 0 : Math.floor((n - FLEET_AT) / FLEET_EVERY) + 1));
      assert.equal(boats.length, want, `${n} settlers moor ${want} boats`);
      assert.ok(boats.length >= before, 'the fleet never shrinks as the village grows');
      before = boats.length;
      for (const side of HARBOUR_SIDES) assert.ok(boats.filter((m) => m.side === side).length <= BOATS_PER_HARBOUR);
      assert.equal(new Set(boats.map((m) => m.id)).size, boats.length, 'no two boats share an id');
    }
  });
}

// B, now that the village earns boats too. `moored` is what village.json says lies at the
// harbour besides the first boat, and a press builds one past it.
function scratchFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'boatyard-earned-')), 'boats.json');
}

test('B builds one past what the harbour moors, earned boats included', () => {
  const file = scratchFile();
  // Two earned at the east harbour and none built: B makes it three, not one.
  assert.deepEqual(buildBoat('e', { moored: 2, file }), { side: 'e', built: 3 });
  assert.throws(() => buildBoat('e', { moored: 3, file }), /all the boats it can moor/);
  // Ahead of the count: built stays what it was when the earned count catches up, and the
  // scan takes the larger of the two.
  assert.deepEqual(buildBoat('s', { moored: 0, file }), { side: 's', built: 1 });
  assert.deepEqual(builtBoats({ file }), { n: 0, e: 3, s: 1, w: 0 });
});

test('the first boat\'s harbour has room for two more, and two quick presses are two boats', () => {
  const file = scratchFile();
  // Stale `moored`: the rescan after the first press has not landed when the second comes.
  assert.deepEqual(buildBoat('n', { moored: 0, cap: 2, file }), { side: 'n', built: 1 });
  assert.deepEqual(buildBoat('n', { moored: 0, cap: 2, file }), { side: 'n', built: 2 });
  // A third would be the fourth boat at a harbour mooringsFor draws three at.
  assert.throws(() => buildBoat('n', { moored: 0, cap: 2, file }), /all the boats it can moor/);
  assert.deepEqual(builtBoats({ file }), { n: 2, e: 0, s: 0, w: 0 });
});

test('harbourRoom reads a harbour\'s count and cap out of village.json', () => {
  const v = { island: { harbours: [
    { side: 'n', shore: [1, 1], pier: [[1, 2]], boats: 1, first: true },
    { side: 'w', shore: [2, 2], pier: [[2, 3]], boats: 3 },
  ] } };
  assert.deepEqual(harbourRoom(v, 'n'), { moored: 1, cap: BOATS_PER_HARBOUR - 1 });
  assert.deepEqual(harbourRoom(v, 'w'), { moored: 3, cap: BOATS_PER_HARBOUR });
  assert.equal(harbourRoom(v, 'e'), null, 'no harbour on that side');
  assert.equal(harbourRoom(null, 'n'), null, 'no village yet');
});

// village.json marks the first boat's harbour for the boatyard; nothing else needs the mark,
// since every other machine derives it through the same mooringsFor, so it stays at home.
// The count does travel, and at the top of its range still survives parseBundle.
import { buildBundle, parseBundle } from '../lib/islandbundle.mjs';
import { makeTerrain } from '../shared/terrain.mjs';

test('the bundle carries the count and not the mark', () => {
  const size = 64, seed = 1337;
  const v = {
    island: {
      name: 'Testholm', seed, terrainHash: makeTerrain(seed, { size, polders: [] }).hash, landing: [25, 54],
      harbours: [
        { side: 'n', shore: [25, 54], pier: [[25, 55], [25, 56]], boats: 2, first: true },
        { side: 'e', shore: [40, 30], pier: [[41, 30]], boats: BOATS_PER_HARBOUR },
      ],
    },
    grid: { size }, districts: [], buildings: [], paths: [], polders: [], milestones: [], stats: { settlers: 180 },
  };
  const packed = buildBundle({ config: { seed, gridSize: size }, village: v, keeper: 'Tiemen' });
  assert.deepEqual(packed.island.harbours, [
    { side: 'n', shore: [25, 54], pier: [[25, 55], [25, 56]], boats: 2 },
    { side: 'e', shore: [40, 30], pier: [[41, 30]], boats: BOATS_PER_HARBOUR },
  ]);
  assert.deepEqual(parseBundle(JSON.parse(JSON.stringify(packed))).island.harbours, packed.island.harbours);
});
