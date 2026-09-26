// The trades: the sawmill at 55 settlers, the smithy at 60, the bakery at 65 and the stable at
// 75 (Plans/zagerij.md, Plans/smidse.md, Plans/stal-en-veld.md).
//
// What is asserted is the one rule that is theirs and nobody else's: they are square civics
// with a door, and they never take one of the lots round the square. Those lots are the
// town's standing and not even always eight - on seed 1337 only six were free when the
// island was founded, and the chapel already stands off the square - and the school counts
// apprentices rather than settlers, so it can unlock long after the sawmill. `TRADES` in
// lib/layout.mjs is what keeps the trades out of that queue, so what stands on the lots is
// exactly what would have stood there if the trades had never been added.
//
// And the one thing `TRADES` takes on trust: that each bake fits the lot `findBlockAround`
// hands it. Read off the plot's own `w`, so a trade that one day needs a bigger lot fails
// here rather than standing half on its neighbour's road.
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLayout, placeAll } from '../lib/layout.mjs';
import { MILESTONES } from '../lib/village.mjs';
import { SAWMILL } from '../web/js/sawmill-mesh.js';
import { SMITHY } from '../web/js/smithy-mesh.js';
import { BAKERY } from '../web/js/bakery-mesh.js';
import { STABLE } from '../web/js/stable-mesh.js';

const SIZE = 128;
// 5 and 2024 found the island with all eight lots free, so two are still empty when the sawmill
// comes - the case the rule exists for. 1337 found it with six, all spoken for by then.
const SEEDS = [5, 2024, 1337];
const TRADES = ['sawmill', 'smithy', 'bakery', 'stable'];
const BAKES = { sawmill: SAWMILL, smithy: SMITHY, bakery: BAKERY, stable: STABLE };
const SETTLERS = Math.max(...TRADES.map((t) => MILESTONES.find((m) => m.id === t).at)) + 2;
// The stable's paddock was modelled to fill its lot: the outer rail's posts (0.035 square)
// stand centred on the lot line, so half of one is over it. Nothing else is.
const POST = 0.02;

// A village that has earned every trade; `school` says whether the apprentices have caught up.
function village({ school, trades = true }) {
  const t0 = Date.UTC(2026, 0, 1);
  const buildings = [];
  for (let i = 0; i < SETTLERS; i++) {
    buildings.push({
      id: `house:demo-${i}`, sessionId: `demo-${i}`, kind: 'house', district: 'p:demo',
      harbour: false, tier: 'hut', startedAt: t0 + i * 1000,
    });
  }
  return {
    districts: [{ id: 'p:demo', kind: 'project', name: 'Demo', population: SETTLERS, firstSeenAt: t0 }],
    buildings,
    milestones: MILESTONES.filter((m) => trades || !TRADES.includes(m.id)).map((m) => {
      const unlocked = m.on === 'apprentices' ? school : m.at <= SETTLERS;
      return { ...m, on: m.on || 'settlers', unlocked, unlockedAt: unlocked ? t0 : null, building: unlocked ? `civic:${m.civicType}` : null };
    }),
    furniture: [],
    stats: { settlers: SETTLERS },
  };
}

// Who stands on each of the square's lots, in the lots' own order.
function onTheLots(layout) {
  return (layout.town.lots || []).map(([gx, gz]) =>
    Object.entries(layout.plots).find(([, p]) => p.gx === gx && p.gz === gz)?.[0] || null);
}

// Two scans, the way a young island meets them: the settlers first, the apprentices later.
function grow(seed, trades) {
  const layout = emptyLayout(seed, SIZE);
  placeAll(layout, village({ school: false, trades }), { seed, size: SIZE });
  const early = onTheLots(layout);
  placeAll(layout, village({ school: true, trades }), { seed, size: SIZE });
  return { layout, early, late: onTheLots(layout) };
}

// How far a set's bake reaches from its middle, either way along either axis: a lot is square
// and the plot turns it by quarters, so this is the one number that has to fit in half of it.
function reachOf(set) {
  let far = 0;
  for (const part of Object.values(set.parts)) {
    const at = part.at || [0, 0, 0];
    for (let i = 0; i < part.positions.length; i += 3) {
      far = Math.max(far, Math.abs(part.positions[i] + at[0]), Math.abs(part.positions[i + 2] + at[2]));
    }
  }
  return far;
}

test('the trades are rungs between the lighthouse and the bridge, and none shares one', () => {
  const at = (id) => MILESTONES.find((m) => m.id === id).at;
  assert.equal(at('sawmill'), 55);
  assert.equal(at('smithy'), 60);
  assert.equal(at('bakery'), 65);
  assert.equal(at('stable'), 75);
  assert.ok(at('lighthouse') < at('sawmill') && at('smithy') < at('bakery') && at('bakery') < at('statue'));
  assert.ok(at('statue') < at('stable') && at('stable') < at('bridge'));
  const settlers = MILESTONES.filter((m) => (m.on || 'settlers') === 'settlers').map((m) => m.at);
  for (const t of TRADES) assert.equal(settlers.filter((n) => n === at(t)).length, 1, `the ${t} shares its rung`);
});

for (const seed of SEEDS) {
  test(`seed ${seed}: the trades stand off the square's lots and take nobody's place there`, () => {
    const withTrades = grow(seed, true);
    const without = grow(seed, false);
    for (const t of TRADES) {
      const p = withTrades.layout.plots[`civic:${t}`];
      assert.ok(p, `the ${t} was given ground`);
      assert.equal(p.w, p.d, `the ${t}'s lot is not square`);
      const reach = reachOf(BAKES[t]);
      assert.ok(reach <= p.w / 2 + POST, `the ${t} reaches ${reach.toFixed(3)} from its middle on a lot ${p.w} wide`);
    }
    assert.ok(!withTrades.early.some((id) => id && TRADES.includes(id.slice('civic:'.length))), 'no trade on a lot');
    assert.deepEqual(withTrades.early, without.early, 'the lots hold what they would have held without the trades');
    assert.deepEqual(withTrades.late, without.late, 'and so they do once the school comes');
  });
}
