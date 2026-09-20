// The rung above the polder mill.
//
// `MILESTONES` stopped at 150 and the village kept growing, so the crane was added at 165.
// It is the only civic on the island placed against another district's ground rather than
// against the town, and the only one that faces away from the town centre, so what is
// asserted here is exactly those two things and the rule that made them safe:
//
//   - it never stands on the ramp - the one step between the road and the planks - and
//     never out on the planks themselves;
//   - it stands at the water, within reach of the berth, with its jib out over the water;
//   - it takes a cell nobody was standing on, and no house moves when it goes up;
//   - a quay whose waterfront has filled up still gets one, which is the case that
//     matters: by 165 settlers the harbour houses are shoulder to shoulder, and the first
//     draft of the placement quietly gave up on the real island for exactly that reason;
//   - an island with no quay simply does not have one, and says so instead of throwing.
//
// No coordinate is written down: every seed puts its quay somewhere else, so each of
// these is a relation between the crane and the planks it was placed against.
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLayout, placeAll } from '../lib/layout.mjs';
import { MILESTONES } from '../lib/village.mjs';
import { QUAY_REACH } from '../shared/quay.mjs';

const SIZE = 128;
const SEEDS = [1337, 7, 90210];
const CRANE = MILESTONES.find((m) => m.id === 'crane');

// A village big enough to have earned the crane, with a Cowork district so that it has a
// quay to stand at and an ordinary district so that there is something on the island the
// crane is not allowed to disturb. Every milestone is unlocked, because what is being
// measured is where the last one lands once the rest are already standing.
function bigVillage(settlers = CRANE.at + 5) {
  const t0 = Date.UTC(2026, 0, 1);
  const buildings = [];
  for (let i = 0; i < 7; i++) {
    buildings.push({
      id: `house:cowork-${i}`, sessionId: `cowork-${i}`, kind: 'house', district: 'quay',
      harbour: true, tier: 'hut', startedAt: t0 + i * 1000,
    });
  }
  for (let i = 0; i < settlers - 7; i++) {
    buildings.push({
      id: `house:demo-${i}`, sessionId: `demo-${i}`, kind: 'house', district: 'p:demo',
      harbour: false, tier: 'hut', startedAt: t0 + 10000 + i * 1000,
    });
  }
  return {
    districts: [
      { id: 'quay', kind: 'quay', name: 'The Quay', population: 7, firstSeenAt: t0 },
      { id: 'p:demo', kind: 'project', name: 'Demo', population: settlers - 7, firstSeenAt: t0 },
    ],
    buildings,
    milestones: MILESTONES.map((m) => ({
      ...m, unlocked: true, unlockedAt: t0, on: m.on || 'settlers', building: `civic:${m.civicType}`,
    })),
    furniture: [],
    stats: { settlers },
  };
}

const cheb = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
// The layout's own convention: rot 0 faces -z, 1 faces +x, 2 faces +z, 3 faces -x. It is
// shared/settlerwalk.mjs's DOOR_DIR, written out again here so that a test of which way
// the crane looks does not borrow the table it is checking.
const LOOK = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// Everything that has to be true of a crane wherever the placement put it.
function assertStandsAtTheQuay(layout, terrain, quay) {
  const crane = layout.plots['civic:crane'];
  assert.ok(crane, 'the crane was given ground');
  assert.equal(crane.w, 1, 'on a single cell, like the well and the mill');

  const here = [crane.gx, crane.gz];
  assert.notDeepEqual(here, quay.shore, 'not on the ramp, which is the only way onto the planks');
  for (const plank of quay.pier) assert.notDeepEqual(here, plank, 'and not out on the planks');
  assert.ok(terrain.isLand(here[0], here[1]), 'it stands on land');

  // Within reach of the hull it exists to unload: no further from the far end of the
  // planks than the planks are long.
  const head = quay.pier[quay.pier.length - 1];
  assert.ok(cheb(here, head) <= QUAY_REACH, `the crane stands ${cheb(here, head)} cells from the berth`);

  // And looking at the water rather than back at the town, which is the whole reason the
  // placement hands this one plot something other than the town centre to face.
  const [dx, dz] = LOOK[crane.rot];
  assert.ok(terrain.isWater(here[0] + dx, here[1] + dz), 'the jib reaches out over the water');
}

test('the crane is the rung above the polder mill', () => {
  const mill = MILESTONES.find((m) => m.id === 'poldermill');
  assert.ok(CRANE, 'the ladder has a crane on it');
  assert.ok(CRANE.at > mill.at, 'and it stands above the mill');
  // The comment on the milestone hangs the number on POLDER_EVERY, so if that moves this
  // says so rather than leaving the reasoning quietly false.
  assert.ok(CRANE.at > 150 && CRANE.at < 175, 'between the first polder and the second');
});

// How many of the seeds below found ground for a crane on a quay whose waterfront was
// already built out. Asserted once at the end rather than per seed: whether a *particular*
// island has quayside left over is a question about that island's coastline, and a test
// that demanded it of every seed would be asserting the terrain. What has to hold is that
// the rule finds it where it is there - the first draft of this placement looked only
// beside the ramp and found nothing on the one island that matters.
const foundRoomAnyway = [];

for (const seed of SEEDS) {
  test(`the crane stands at the quay and looks at the water (seed ${seed})`, () => {
    const layout = emptyLayout(seed, SIZE);
    const { terrain } = placeAll(layout, bigVillage(), { seed, size: SIZE });
    const quay = layout.districts.quay;
    assert.ok(quay && quay.pier.length, 'this island has a quay with planks');
    assertStandsAtTheQuay(layout, terrain, quay);
  });

  test(`a quay with no room left does not put the crane on somebody (seed ${seed})`, () => {
    const layout = emptyLayout(seed, SIZE);
    const village = bigVillage();
    let { terrain } = placeAll(layout, village, { seed, size: SIZE });
    const quay = layout.districts.quay;

    // Forge the quay the real island has: the whole waterfront round the ramp built on.
    // This is what it looks like by the time the crane is earned - measured on the island
    // with every session on it, all four cells beside the ramp were somebody's plot - and
    // the first draft of the placement gave up there and left the island craneless. So
    // the crane has to walk along the water's edge, and it may not take a cell somebody
    // is standing on to do it.
    const first = [layout.plots['civic:crane'].gx, layout.plots['civic:crane'].gz];
    delete layout.plots['civic:crane'];
    const [sx, sz] = quay.shore;
    const wharf = [first];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const c = [sx + dx, sz + dz];
      if (!terrain.isLand(c[0], c[1])) continue;                  // the planks are water
      if (wharf.some((w) => cheb(w, c) === 0)) continue;
      wharf.push(c);
    }
    wharf.forEach((c, i) => { layout.plots[`house:wharf-${i}`] = { gx: c[0], gz: c[1], w: 1, d: 1, rot: 0 }; });

    const { terrain: after, unplaced } = placeAll(layout, village, { seed, size: SIZE });
    const crane = layout.plots['civic:crane'];
    if (!crane) {
      // A cove with nothing but these cells on it. The crane waits, the way the polder
      // mill waits for shallows, and says so.
      assert.ok(unplaced.includes('civic:crane'), 'it is on record as waiting, not as forgotten');
      return;
    }
    assertStandsAtTheQuay(layout, after, quay);
    const here = [crane.gx, crane.gz];
    for (const c of wharf) assert.notDeepEqual(here, c, 'and it did not stand on anybody');
    foundRoomAnyway.push(seed);
  });
}

test('and on a quay that has any shore left, it walks along it', () => {
  assert.ok(foundRoomAnyway.length, 'no seed exercised the walk along the shore at all');
});

test('the crane takes nobody\'s ground, and a second scan leaves it alone', () => {
  const seed = 1337;
  const layout = emptyLayout(seed, SIZE);

  // The island one settler short of the crane, settled and standing.
  const before = bigVillage(CRANE.at - 1);
  before.milestones = before.milestones.map((m) => (m.id === 'crane' ? { ...m, unlocked: false, building: null } : m));
  placeAll(layout, before, { seed, size: SIZE });
  assert.equal(layout.plots['civic:crane'], undefined, 'nothing is built before it is earned');
  const settled = structuredClone(layout.plots);

  // And the scan that earns it.
  placeAll(layout, bigVillage(CRANE.at), { seed, size: SIZE });
  assert.ok(layout.plots['civic:crane'], 'the crane goes up');
  for (const [id, p] of Object.entries(settled)) {
    const now = layout.plots[id];
    assert.ok(now, `${id} kept its plot`);
    assert.deepEqual([now.gx, now.gz, now.rot], [p.gx, p.gz, p.rot], `${id} did not move`);
  }

  const after = structuredClone(layout.plots);
  placeAll(layout, bigVillage(CRANE.at), { seed, size: SIZE });
  assert.deepEqual(layout.plots, after, 'a second pass over the same village moves nothing');
});

test('an island with no quay has no crane, and does not fall over', () => {
  const seed = 1337;
  const layout = emptyLayout(seed, SIZE);
  const village = bigVillage();
  // Every Cowork house and the district they belong to, gone: this is an island where
  // nobody has ever run a Cowork task, which is most of them.
  village.districts = village.districts.filter((d) => d.id !== 'quay');
  village.buildings = village.buildings.filter((b) => b.district !== 'quay');
  village.stats.settlers = village.buildings.length;

  const { unplaced } = placeAll(layout, village, { seed, size: SIZE });
  assert.equal(layout.districts.quay, undefined, 'no quay');
  assert.equal(layout.plots['civic:crane'], undefined, 'and so no crane');
  assert.ok(unplaced.includes('civic:crane'), 'it is on record as waiting, not as forgotten');
});
