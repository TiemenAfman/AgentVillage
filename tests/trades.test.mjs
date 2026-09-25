// The two trades: the sawmill at 55 settlers and the smithy at 60 (Plans/zagerij.md,
// Plans/smidse.md).
//
// What is asserted is the one rule that is theirs and nobody else's: they are three by three
// civics with a door, and they never take one of the lots round the square. Those lots are
// the town's standing and not even always eight - on seed 1337 only six were free when the
// island was founded, and the chapel already stands off the square - and the school counts
// apprentices rather than settlers, so it can unlock long after the sawmill. `TRADES` in
// lib/layout.mjs is what keeps the trades out of that queue, so what stands on the lots is
// exactly what would have stood there if the trades had never been added.
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyLayout, placeAll } from '../lib/layout.mjs';
import { MILESTONES } from '../lib/village.mjs';

const SIZE = 128;
// 5 and 2024 found the island with all eight lots free, so two are still empty when the sawmill
// comes - the case the rule exists for. 1337 found it with six, all spoken for by then.
const SEEDS = [5, 2024, 1337];
const TRADES = ['sawmill', 'smithy'];
const SETTLERS = MILESTONES.find((m) => m.id === 'smithy').at + 2;

// A village that has earned both trades; `school` says whether the apprentices have caught up.
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

test('the sawmill and the smithy are rungs between the lighthouse and the statue', () => {
  const at = (id) => MILESTONES.find((m) => m.id === id).at;
  assert.equal(at('sawmill'), 55);
  assert.equal(at('smithy'), 60);
  assert.ok(at('lighthouse') < at('sawmill') && at('smithy') < at('statue'));
});

for (const seed of SEEDS) {
  test(`seed ${seed}: the trades stand off the square's lots and take nobody's place there`, () => {
    const withTrades = grow(seed, true);
    const without = grow(seed, false);
    for (const t of TRADES) {
      const p = withTrades.layout.plots[`civic:${t}`];
      assert.ok(p, `the ${t} was given ground`);
      assert.equal(p.w, 3, `the ${t} is a three by three`);
    }
    assert.ok(!withTrades.early.some((id) => id && TRADES.includes(id.slice('civic:'.length))), 'no trade on a lot');
    assert.deepEqual(withTrades.early, without.early, 'the lots hold what they would have held without the trades');
    assert.deepEqual(withTrades.late, without.late, 'and so they do once the school comes');
  });
}
