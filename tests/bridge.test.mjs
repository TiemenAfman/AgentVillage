// The rung at ninety, and the only one on the ladder that is a piece of road.
//
// Every other milestone is a building on a plot, so a test of one is a test of where it
// stands. A bridge is not: what is built is a deck over the water, and what can go wrong
// is not that it lands in the wrong field but that it lands nowhere - a crossing over a
// river nobody wanted crossed, with no road onto it at either end, or one laid across the
// dredged channel a boat comes up. So what is asserted here is that the crossing crosses:
//
//   - the deck is straight, all of it over water, and never over the fairway;
//   - there is road at both landings, because a settler's network is `paths` plus
//     `bridges` and a deck with bare ground at one end joins the island at one end;
//   - the two banks are one piece of that network, and stop being one the moment the deck
//     is rubbed out of it - which is "a settler can walk across it and could not before";
//   - a road laid afterwards comes over it rather than round the head of the river, and
//     the measure of that is cells of *fresh* road, not cells walked: REUSE makes a mile
//     of somebody else's lane cheaper than thirty cells of new ground, so the way over is
//     often the longer line and always the cheaper one;
//   - the rung has a plot, so the legend, the chronicle and the dossier have something
//     behind them - beside the head of the deck, never on it, because that cell is the
//     road onto the planks.
//
// Three kinds of island, because the placement has three answers and all three are
// deliberate. Some have a reach worth a crossing and build one. Some are already crossed
// by a road that got there first, and the rung is that crossing - a bridge is built once
// and every later road comes over it. And some have no reach at all and go without, the
// way the polder mill goes without shallows.
//
// No coordinate is written down: every seed puts its river somewhere else. The village is
// synthetic and `placeAll` is called directly, the way tests/harbour-crane.test.mjs does,
// because the scan on this machine may have three settlers on it or three hundred and a
// rung at ninety cannot be measured on an island that has not earned it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { emptyLayout, placeAll, trialRoad, BRIDGE_AT } from '../lib/layout.mjs';
import { MILESTONES } from '../lib/village.mjs';
import { roadCells } from '../shared/roads.mjs';

register('./support/shared-loader.mjs', import.meta.url);
// buildings.js builds a TextureLoader the moment it loads; the same stub the tavern, the
// paths and the docks tests use. It is here for one question only - how high the planks
// ride - because that is the other half of "walkable" and the half that fails silently:
// a deck level with the river is a settler wading across a bridge.
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const { bridgeDeckHeights, DECK_MIN } = await import('../web/js/buildings.js');
delete globalThis.document;

// 1337 at 256 is Promptholm's own seed and grid. The rest were picked off a sweep of ten
// seeds at three sizes, two or three of each answer, so that a change which quietly turns
// one answer into another fails here rather than on somebody's island.
const BUILDS = [{ seed: 314, size: 128 }, { seed: 8888, size: 192 }, { seed: 1337, size: 256 }, { seed: 90210, size: 256 }];
const ADOPTS = [{ seed: 7, size: 128 }, { seed: 42, size: 128 }, { seed: 7, size: 256 }];
// Seed 1337 at 128 is a different island from seed 1337 at 256 - `size` is the generator's
// own argument - and neither it nor 5150 has a reach with usable ground on both banks.
const BARREN = [{ seed: 1337, size: 128 }, { seed: 5150, size: 128 }];

const BRIDGE = MILESTONES.find((m) => m.id === 'bridge');
const ID = 'civic:bridge';
const key = (c) => `${c[0]},${c[1]}`;

// A village past the rung, with a Cowork district so the island has a quay and an ordinary
// one so there are hamlets, roads and houses for a crossing to be measured against. Every
// milestone is unlocked, because the bridge is laid after the roads and what matters is
// where it lands once the rest of the island is standing.
function bigVillage(settlers = BRIDGE.at + 5) {
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

function lay({ seed, size }, settlers) {
  const layout = emptyLayout(seed, size);
  const { terrain, unplaced } = placeAll(layout, bigVillage(settlers), { seed, size });
  return { seed, size, layout, terrain, unplaced };
}

// The two cells a deck lands on: one step past each end of the run it recorded. The same
// derivation lib/layout.mjs uses to find the head, written out again rather than imported,
// so that a test of where a bridge lands does not borrow the answer it is checking.
function landings(b) {
  const k = b.axis === 'x' ? 0 : 1;
  const a = b.cells[0], z = b.cells[b.cells.length - 1];
  const step = Math.sign(z[k] - a[k]) || 1;
  const lo = [...a], hi = [...z];
  lo[k] -= step; hi[k] += step;
  return [lo, hi];
}

// Every cell a settler may walk, exactly as `setRoads` in shared/settlerwalk.mjs is handed
// it: the lanes and the decks in one set. This is the walk the sea steps and the walk the
// browser draws, so a crossing that is not in here is not walkable on either machine.
function network(layout, skip = null) {
  const out = new Set();
  for (const p of roadCells({ paths: layout.paths, bridges: layout.bridges })) {
    if (skip && p === skip) continue;
    for (const c of p.cells) out.add(key(c));
  }
  return out;
}

function connected(cells, from, to) {
  if (!cells.has(key(from)) || !cells.has(key(to))) return false;
  const seen = new Set([key(from)]);
  const q = [from];
  for (let h = 0; h < q.length; h++) {
    const [x, z] = q[h];
    if (x === to[0] && z === to[1]) return true;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = [x + dx, z + dz];
      if (seen.has(key(n)) || !cells.has(key(n))) continue;
      seen.add(key(n));
      q.push(n);
    }
  }
  return false;
}

// Everything already laid: paving, plaza and deck. What a road costs is the cells that are
// not in here, which is why a route twice as long can be a tenth of the price.
function alreadyLaid(layout) {
  const out = new Set();
  for (const p of layout.paths) for (const c of p.cells) out.add(key(c));
  for (const c of layout.town.paved || []) out.add(key(c));
  for (const b of layout.bridges) for (const c of b.cells) out.add(key(c));
  return out;
}
const freshCells = (laid, route) => (route ? route.filter((c) => !laid.has(key(c))).length : null);

// The bridge the stone was put up for: the one whose head it is standing beside.
function marked(layout) {
  const stone = layout.plots[ID];
  if (!stone) return null;
  return layout.bridges.find((b) => landings(b).some(([gx, gz]) =>
    Math.abs(gx - stone.gx) <= 1 && Math.abs(gz - stone.gz) <= 1)) || null;
}

const builders = BUILDS.map((i) => lay(i));
const adopters = ADOPTS.map((i) => lay(i));

test('an island with a reach worth crossing builds exactly one deck', () => {
  for (const { seed, size, layout } of builders) {
    const ours = layout.bridges.filter((b) => b.id === ID);
    assert.equal(ours.length, 1, `seed ${seed}/${size} built ${ours.length} crossings of its own`);
  }
});

test('an island the roads have already crossed takes that crossing rather than build beside it', () => {
  for (const { seed, size, layout } of adopters) {
    assert.ok(layout.bridges.length > 0, `seed ${seed}/${size} was meant to have a crossing already`);
    assert.deepEqual(layout.bridges.filter((b) => b.id === ID), [],
      `seed ${seed}/${size} built a second deck over a river that was already crossed`);
    assert.ok(layout.plots[ID], `seed ${seed}/${size} has a crossing and no stone on the rung`);
  }
});

test('the rung has a plot, and the stone stands beside the head of a deck rather than on it', () => {
  for (const { seed, size, layout } of [...builders, ...adopters]) {
    const stone = layout.plots[ID];
    assert.ok(stone, `seed ${seed}/${size} has a crossing and no plot, so the rung has no record`);
    assert.equal(stone.w, 1, 'the bridge stone takes one cell');
    const b = marked(layout);
    assert.ok(b, `seed ${seed}/${size} put the stone at ${stone.gx},${stone.gz}, beside no deck at all`);
    const heads = landings(b).map(key);
    assert.ok(!heads.includes(key([stone.gx, stone.gz])),
      `seed ${seed}/${size} put the stone on the bridge head, which is the road onto the planks`);
  }
});

test('the deck is straight, over water all the way, and never over the dredged fairway', () => {
  for (const { seed, size, layout, terrain } of builders) {
    const b = layout.bridges.find((x) => x.id === ID);
    const k = b.axis === 'x' ? 0 : 1;
    const j = 1 - k;
    assert.ok(b.cells.length <= 5, `seed ${seed}/${size} spans ${b.cells.length} cells, which is a causeway`);
    for (const c of b.cells) {
      assert.equal(c[j], b.cells[0][j], `seed ${seed}/${size} has a deck that bends`);
      assert.ok(!terrain.isLand(c[0], c[1]), `seed ${seed}/${size} has a deck cell on dry land at ${key(c)}`);
    }
    assert.ok(b.cells.some((c) => terrain.isRiver(c[0], c[1])),
      `seed ${seed}/${size} bridged water that is not a river`);
    // The channel was cut so a boat can come up to the town, and a deck over it closes the
    // river it crosses. Shallow water reads to the reach search exactly like a narrow
    // crossing, which is why this is asserted rather than assumed.
    const channel = new Set(((layout.fairway && layout.fairway.cells) || []).map(key));
    for (const c of b.cells) {
      assert.ok(!channel.has(key(c)), `seed ${seed}/${size} decked the fairway at ${key(c)}`);
    }
    for (const land of landings(b)) {
      assert.ok(terrain.isLand(land[0], land[1]),
        `seed ${seed}/${size} has a deck ending over water at ${key(land)}`);
    }
  }
});

test('a settler can walk across it, and could not before it was there', () => {
  for (const { seed, size, layout } of builders) {
    const b = layout.bridges.find((x) => x.id === ID);
    const [a, z] = landings(b);
    const cells = network(layout);
    assert.ok(cells.has(key(a)), `seed ${seed}/${size} left the bank at ${key(a)} off the road network`);
    assert.ok(cells.has(key(z)), `seed ${seed}/${size} left the bank at ${key(z)} off the road network`);
    assert.ok(connected(cells, a, z),
      `seed ${seed}/${size} has a deck whose two banks are not joined - a settler cannot cross it`);
    const without = new Set(cells);
    for (const c of b.cells) without.delete(key(c));
    assert.ok(!connected(without, a, z),
      `seed ${seed}/${size} joins the two banks without the deck, so the crossing is decoration`);
  }
});

test('the planks ride clear of the water, so crossing is walking rather than wading', () => {
  for (const { seed, size, layout, terrain } of builders) {
    const b = layout.bridges.find((x) => x.id === ID);
    const heights = bridgeDeckHeights(b.cells, terrain, b.axis);
    // Every cell of the run the deck covers, which is wider than what the layout wrote
    // down: `spanToBanks` carries the run outward until it is on land, because the layout
    // measures its water on the server's field and the ground is generated per cell.
    assert.ok(heights.length >= b.cells.length, `seed ${seed}/${size} decked fewer cells than it recorded`);
    for (const [gx, gz, y] of heights) {
      assert.ok(y >= DECK_MIN - 1e-6,
        `seed ${seed}/${size} has the deck at ${y.toFixed(3)} over ${gx},${gz}, which the waves wash through`);
    }
    // And the crown is above the ends, which is what makes it a bridge rather than a
    // jetty with two ends: `bridgeStops` humps the deck and the settlers climb it.
    const ys = heights.map((h) => h[2]);
    assert.ok(Math.max(...ys) > Math.min(...ys), `seed ${seed}/${size} laid a flat plank, not an arch`);
  }
});

test('a road laid afterwards comes over it instead of round the head of the river', () => {
  for (const { seed, size, layout } of builders) {
    const b = layout.bridges.find((x) => x.id === ID);
    const deck = new Set(b.cells.map(key));
    const laid = alreadyLaid(layout);
    // The same island with this one crossing left out, which is the control for all of it.
    // Any deck the roads built on their own stays, so what is measured is this deck and
    // nothing else.
    const others = layout.bridges.filter((x) => x.id !== ID);
    const ends = landings(b);
    const cost = (r) => (r === null ? Infinity : freshCells(laid, r));
    // The far bank is the one the island cannot cheaply reach without the crossing, which
    // is the side `planBridge` calls `away`. Worked out from the control rather than
    // written down, because every seed puts its river somewhere else.
    const detour = ends.map((e) => cost(trialRoad(layout, { seed, size }, e, { bridges: others })));
    const far = ends[detour[0] >= detour[1] ? 0 : 1];

    const over = trialRoad(layout, { seed, size }, far);
    assert.ok(over, `seed ${seed}/${size} has a far bank with no road to the town at all`);
    assert.ok(over.some((c) => deck.has(key(c))),
      `seed ${seed}/${size} laid a road from the far bank that ignores the crossing`);

    const round = trialRoad(layout, { seed, size }, far, { bridges: others });
    const cheap = freshCells(laid, over), dear = freshCells(laid, round);
    assert.ok(round === null || dear > cheap,
      `seed ${seed}/${size}: the way round costs ${dear} cells of new road and the way over ${cheap}`);
  }
});

test('a second placement of the same island changes nothing', () => {
  for (const { seed, size, layout } of [...builders, ...adopters]) {
    const before = JSON.stringify([layout.bridges, layout.plots[ID], layout.paths.find((p) => p.id === `path:${ID}`)]);
    placeAll(layout, bigVillage(), { seed, size });
    const after = JSON.stringify([layout.bridges, layout.plots[ID], layout.paths.find((p) => p.id === `path:${ID}`)]);
    assert.equal(after, before, `seed ${seed}/${size} rewrote its crossing on the second scan`);
  }
});

test('below the rung nothing is built', () => {
  const { layout } = lay(BUILDS[0], BRIDGE_AT - 1);
  assert.deepEqual(layout.bridges.filter((b) => b.id === ID), [], 'a crossing went up before it was earned');
  assert.equal(layout.plots[ID], undefined, 'the rung got a stone before it was earned');
});

test('an island with no crossable reach builds nothing and says so', () => {
  for (const island of BARREN) {
    const { seed, size, layout, unplaced } = lay(island);
    assert.deepEqual(layout.bridges, [], `seed ${seed}/${size} crossed a river it has no reach on`);
    assert.equal(layout.plots[ID], undefined, `seed ${seed}/${size} has a bridge stone with no bridge behind it`);
    assert.ok(unplaced.includes(ID),
      `seed ${seed}/${size} earned the rung, put nothing up, and did not report it as unplaced`);
  }
});
