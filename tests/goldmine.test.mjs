// The gold mine and the goldsmith (Plans/DONE/goudmijn.md): the keeper's seven-day window as ore
// in the mine, and every five hours a cartload from there, by way of the goldsmith, into the
// gold pit.
//
// Four things are held here, each for the way it would fail without anybody noticing:
//
//   the week      the desktop app's `sd` with a reset worked out from its own history, and
//                 the status line's week not lost when the app spoke last - or the other
//                 way round;
//   the ore       a reading turned into lumps, and no reading or a week gone by being a
//                 full mine rather than an empty one;
//   the place     both lots written once, a second scan byte-identical, and each with a
//                 road that reaches the square on the scan that placed it - the mine once
//                 stood across a river and got its road only on the scan after;
//   the run       the page's delivery: the first word shown at once, a rise delivered only
//                 when the three buildings and the roads between them are there, and shown
//                 at once otherwise - a run that cannot happen must never hold the pit back.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';

import { mineOf, purseOf, MINE_ORE, GOLDMINE_ID, GOLDSMITH_ID, GOLDPIT_ID, GOLD_BARS } from '../shared/gold.mjs';
import { weekResetOf, readDesktopUsage, currentUsage, readingOf, writeUsage } from '../lib/usage.mjs';
import { emptyLayout, placeAll } from '../lib/layout.mjs';
import { stranded } from '../lib/plan.mjs';
import { MILESTONES } from '../lib/village.mjs';
import { roadBetween } from '../shared/roads.mjs';
import { DOOR_DIR } from '../shared/settlerwalk.mjs';
import { makeTerrain } from '../shared/terrain.mjs';
import { village as spreadVillage } from './support/village.mjs';

register('./support/shared-loader.mjs', import.meta.url);
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const THREE = await import('three');
const { createGoldRun, MIN_RISE, STACK_MAX, stackSize, stackSlots } = await import('../web/js/goldrun.js');
const { attachOrePile, ORE_RISE, ORE_FILL_S } = await import('../web/js/goldmine.js');
delete globalThis.document;

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'goldmine-'));
const Q = 15 * 60e3;
const H = 3600e3;
const DAY = 24 * H;
const WEEK = 7 * DAY;

// ---- the week ---------------------------------------------------------------------------

function desktop(samples) {
  const file = path.join(scratch(), 'plan-usage-history.json');
  fs.writeFileSync(file, JSON.stringify({ version: 2, samples }));
  return file;
}

test('the week resets a week after the last real drop the app sampled, and never on a slide', () => {
  const sdOf = (s) => s.sd;
  const t = Date.UTC(2026, 8, 24, 8, 45);
  // A fall to half or less is a reset, and the sample after it is when.
  assert.equal(weekResetOf([{ t, sd: 80 }, { t: t + Q, sd: 30 }, { t: t + 2 * Q, sd: 31 }], sdOf), t + Q + WEEK);
  // So is a fall to five or less, from anywhere.
  assert.equal(weekResetOf([{ t, sd: 9 }, { t: t + Q, sd: 4 }], sdOf), t + Q + WEEK);
  // A rolling window sliding down a point is not.
  assert.equal(weekResetOf([{ t, sd: 40 }, { t: t + Q, sd: 38 }, { t: t + 2 * Q, sd: 37 }], sdOf), null);
  // The last one counts, not the first.
  const two = [{ t, sd: 90 }, { t: t + Q, sd: 1 }, { t: t + WEEK, sd: 70 }, { t: t + WEEK + Q, sd: 2 }];
  assert.equal(weekResetOf(two, sdOf), t + WEEK + Q + WEEK);
  // A sample with no week in it is stepped over, not read as a drop to nothing.
  assert.equal(weekResetOf([{ t, sd: 60 }, { t: t + Q, sd: null }, { t: t + 2 * Q, sd: 58 }], sdOf), null);
});

test('the desktop app\'s week is its last `sd`, for the last account, with the reset it saw', () => {
  const t = Date.UTC(2026, 8, 24, 8, 30);
  const r = readDesktopUsage(desktop([
    { t, org: 'o1', u: { fh: 30, sd: 88 } },
    { t: t + Q, org: 'o1', u: { fh: 2, sd: 1 } },           // Thursday morning: both turn over
    { t: t + 2 * Q, org: 'other', u: { fh: 9, sd: 0.5 } },  // another account's drop is not ours
    { t: t + 3 * Q, org: 'o1', u: { fh: 6, sd: 3 } },
  ]));
  assert.deepEqual(r.sevenDay, { used: 3, resetsAt: t + Q + WEEK });
  const none = readDesktopUsage(desktop([{ t, org: 'o1', u: { fh: 30 } }]));
  assert.equal(none.sevenDay, null, 'an app that samples no week gives no week, not an empty one');
});

test('the week comes from whichever source has one, the newest first', () => {
  const t = Date.UTC(2026, 8, 25, 7);
  // A status line with no seven_day in it (an API key behind a gateway), newer than the app.
  const bare = path.join(scratch(), 'usage.json');
  writeUsage(readingOf({ rate_limits: { five_hour: { used_percentage: 30, resets_at: (t + 4 * H) / 1000 } } }, t + 2 * Q), bare);
  const app = desktop([{ t, org: 'o1', u: { fh: 10, sd: 40 } }, { t: t + Q, org: 'o1', u: { fh: 12, sd: 41 } }]);
  const r = currentUsage({ file: bare, desktopFile: app });
  assert.equal(r.source, 'statusline', 'the five hours still come from the newest');
  assert.equal(r.fiveHour.used, 30);
  assert.equal(r.sevenDay.used, 41, 'the week is not lost because the newest source had none');
  assert.equal(r.sevenDaySource, 'desktop');
  assert.equal(r.sevenDayAt, t + Q);
  assert.equal(mineOf(r, t + 2 * Q).source, 'desktop', 'and the mine names where its number came from');

  // A status line that does carry the week keeps its own.
  const full = path.join(scratch(), 'usage.json');
  writeUsage(readingOf({ rate_limits: {
    five_hour: { used_percentage: 30, resets_at: (t + 4 * H) / 1000 },
    seven_day: { used_percentage: 12, resets_at: (t + 3 * DAY) / 1000 },
  } }, t + 2 * Q), full);
  const own = currentUsage({ file: full, desktopFile: app });
  assert.equal(own.sevenDay.used, 12);
  assert.equal(own.sevenDaySource, undefined);
  assert.equal(mineOf(own, t + 2 * Q).source, 'statusline');
});

test('a week comes to one lump of ore a percent left, and no week is a full mine', () => {
  const now = Date.UTC(2026, 8, 25, 12);
  const at = (used, resetsAt = now + DAY) => ({ sevenDay: { used, resetsAt }, at: now - 1000, source: 'statusline' });
  assert.equal(mineOf(at(27.4), now).ore, 73);
  assert.equal(mineOf(at(0), now).ore, MINE_ORE);
  assert.equal(mineOf(at(100), now).ore, 0);
  assert.equal(mineOf(at(140), now).ore, 0, 'past 100 is an empty mine, not a negative one');
  assert.equal(mineOf(at(60, null), now).ore, 40, 'a week with no known reset still says its number');
  assert.equal(mineOf(at(60, null), now).resetsAt, null);
  const gone = mineOf(at(60, now - 1), now);
  assert.deepEqual([gone.ore, gone.reset, gone.known], [MINE_ORE, true, true], 'a week gone by is a full mine');
  for (const none of [null, {}, { sevenDay: null }, { sevenDay: { used: 'lots' } }]) {
    const m = mineOf(none, now);
    assert.deepEqual([m.ore, m.known], [MINE_ORE, false], 'no reading is a full mine, and says it is not known');
  }
});

// ---- the place --------------------------------------------------------------------------

const t0 = Date.UTC(2026, 0, 1);
function model(settlers) {
  const buildings = [];
  for (let i = 0; i < settlers; i++) {
    buildings.push({ id: `house:d-${i}`, sessionId: `d-${i}`, kind: 'house', district: 'p:demo', harbour: false, tier: 'hut', startedAt: t0 + i * 1000 });
  }
  return {
    districts: [{ id: 'p:demo', kind: 'project', name: 'Demo', population: settlers, firstSeenAt: t0 }],
    buildings,
    milestones: MILESTONES.map((m) => {
      const unlocked = m.at <= settlers;
      return { ...m, on: m.on || 'settlers', unlocked, unlockedAt: unlocked ? t0 : null, building: unlocked ? `civic:${m.civicType}` : null };
    }),
    furniture: [],
    stats: { settlers },
  };
}
// The doorstep settlers stand on, as goldrun.js's `stepOf` works it out.
const stepOf = (p) => { const [dx, dz] = DOOR_DIR[(p.rot | 0) % 4]; return [p.gx + 1 + dx * 2, p.gz + 1 + dz * 2]; };
const roadsOf = (layout) => ({ paths: layout.paths, bridges: layout.bridges, island: { town: layout.town }, districts: [] });

// Seed 7 is the island whose mine stood across the river; 2024 is the planner tests' own.
for (const [seed, settlers] of [[7, 12], [2024, 40], [11, 3]]) {
  test(`seed ${seed}: the mine and the goldsmith stand once, each with a road home, and a cart can go between`, () => {
    const layout = emptyLayout(seed, 128);
    const M = model(settlers);
    const first = placeAll(layout, M, { seed, size: 128 });
    for (const id of [GOLDMINE_ID, GOLDSMITH_ID]) {
      assert.ok(layout.plots[id], `${id} was not placed`);
      assert.ok(!first.unplaced.includes(id), `${id} is unplaced`);
      assert.ok(layout.paths.some((q) => q.id === `path:${id}`), `${id} has no road on the scan that placed it`);
    }
    assert.deepEqual(stranded(layout, layout.size, [GOLDMINE_ID, GOLDSMITH_ID, GOLDPIT_ID]), [], 'a door that does not reach the square');
    // A bare placeAll settles the town's own record on its second pass (it did before these
    // two existed - scan.mjs and tests/plan-civic.test.mjs place twice for it); from there on
    // nothing may change, and neither lot or road may have moved between the first and the
    // second.
    const placed = JSON.stringify([layout.plots[GOLDMINE_ID], layout.plots[GOLDSMITH_ID], layout.paths.filter((q) => /gold/.test(q.id))]);
    placeAll(layout, M, { seed, size: 128 });
    assert.equal(JSON.stringify([layout.plots[GOLDMINE_ID], layout.plots[GOLDSMITH_ID], layout.paths.filter((q) => /gold/.test(q.id))]), placed,
      'the second scan moved a lot or laid its road again');
    const before = JSON.stringify(layout);
    placeAll(layout, M, { seed, size: 128 });
    assert.equal(JSON.stringify(layout), before, 'the third scan rewrote the layout');

    // The run's two legs, over the same graph the settlers walk.
    const v = roadsOf(layout), P = layout.plots;
    const leg1 = roadBetween(v, layout.size, stepOf(P[GOLDMINE_ID]), stepOf(P[GOLDSMITH_ID]));
    const leg2 = roadBetween(v, layout.size, stepOf(P[GOLDSMITH_ID]), stepOf(P[GOLDPIT_ID]));
    assert.ok(leg1 && leg1.length > 1, 'no road from the mine to the goldsmith');
    assert.ok(leg2 && leg2.length > 1, 'no road from the goldsmith to the pit');
    for (const leg of [leg1, leg2]) {
      for (let i = 1; i < leg.length; i++) {
        const [a, b] = [leg[i - 1], leg[i]];
        assert.ok(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) <= 5, `the route jumps from ${a} to ${b}`);
      }
    }
  });
}

test('roadBetween walks the roads and says null where they do not join', () => {
  const size = 16;
  // One lane along z = 5 from x = 2 to x = 12, and a stub nobody joined at z = 12.
  const lane = []; for (let x = 2; x <= 12; x++) lane.push([x, 5]);
  const v = { paths: [{ id: 'path:a', cells: lane }, { id: 'path:b', cells: [[3, 12], [4, 12]] }], bridges: [], island: { town: { paved: [] } }, districts: [] };
  const r = roadBetween(v, size, [2, 6], [12, 6]);
  assert.deepEqual(r[0], [2, 6]);
  assert.deepEqual(r[r.length - 1], [12, 6]);
  assert.ok(r.slice(1, -1).every(([, z]) => z === 5), 'it keeps to the lane');
  assert.equal(roadBetween(v, size, [2, 6], [3, 13]), null, 'no road joins the two');
  assert.equal(roadBetween(v, size, null, [3, 13]), null);
});

// ---- the run ----------------------------------------------------------------------------

// A seed-7 island as main.js would have it standing: a record per building with its group
// on the middle of its plot, turned as its door says.
function standing() {
  const seed = 7;
  const layout = emptyLayout(seed, 128);
  placeAll(layout, model(12), { seed, size: 128 });
  placeAll(layout, model(12), { seed, size: 128 });
  const terrain = makeTerrain(seed, { size: layout.size, polders: layout.polders || [], fairway: layout.fairway || null, grow: layout.grow || null });
  const rec = (id) => {
    const plot = layout.plots[id];
    const group = new THREE.Group();
    const [x, z] = terrain.cellWorld(plot.gx + 1, plot.gz + 1);
    const [dx, dz] = DOOR_DIR[plot.rot % 4];
    group.position.set(x, terrain.heightAt(plot.gx + 1, plot.gz + 1), z);
    group.rotation.y = Math.atan2(dx, dz);
    return { id, spec: { id, plot }, group };
  };
  return { layout, terrain, village: roadsOf(layout), mine: rec(GOLDMINE_ID), smith: rec(GOLDSMITH_ID), pit: rec(GOLDPIT_ID) };
}
function runOn(sites) {
  const shown = [];
  const run = createGoldRun({
    scene: new THREE.Scene(),
    material: new THREE.MeshBasicMaterial(),
    groundAt: (x, z) => (sites ? sites.terrain.worldHeight(x, z) : 0),
    onBars: (n) => shown.push(n),
  });
  if (sites) run.setSites(sites);
  return { run, shown };
}

test('the first word about the pit is shown as it is, and so is every fall', () => {
  const { run, shown } = runOn(standing());
  run.setGold(30);
  assert.equal(run.busy(), false, 'the first reading after a page load is not a delivery');
  assert.equal(run.bars(), 30);
  run.setGold(22);
  assert.equal(run.bars(), 22, 'gold spent comes off at once');
  run.setGold(22 + MIN_RISE - 1);
  assert.equal(run.busy(), false, 'a rise smaller than MIN_RISE is a rounding, not a new window');
  assert.equal(run.bars(), 22 + MIN_RISE - 1);
  assert.deepEqual(shown, [30, 22, 22 + MIN_RISE - 1]);
});

test('a new window is brought from the mine, and the pit counts up only when the barrow is there', () => {
  const sites = standing();
  const { run, shown } = runOn(sites);
  run.setGold(20);
  run.setGold(GOLD_BARS);
  assert.equal(run.busy(), true, 'a rise with the mine, the goldsmith and the roads there is a delivery');
  assert.equal(run.bars(), 20, 'the pit waits for its gold');
  let t = 0;
  // The stack in front of the shop: it has to fill before the barrow leaves, and be empty
  // again - loaded into the barrow - before the pit counts a single bar up.
  const stack = sites.smith.group.children.find((c) => c.isInstancedMesh);
  assert.ok(stack, 'no stack hung on the goldsmith');
  let tallest = 0, emptyBeforePit = null;
  // At most every leg's cap plus the work at each end: far less than ten minutes of frames.
  while (run.busy() && t < 600) {
    run.update(0.1); t += 0.1;
    tallest = Math.max(tallest, stack.count);
    if (emptyBeforePit == null && run.bars() > 20) emptyBeforePit = stack.count === 0 && tallest > 0;
  }
  assert.equal(run.busy(), false, 'the run never finished');
  assert.equal(tallest, stackSize(GOLD_BARS - 20), 'the stack was not laid out whole');
  assert.equal(emptyBeforePit, true, 'the pit counted up before the stack was laid out and loaded');
  assert.equal(stack.count, 0, 'the stack is left standing after the run');
  assert.equal(run.bars(), GOLD_BARS);
  assert.equal(shown[shown.length - 1], GOLD_BARS);
  assert.ok(t > 10, `the whole run took ${t.toFixed(1)} s: nothing was walked`);
  const counted = shown.filter((n) => n > 20 && n < GOLD_BARS);
  assert.ok(counted.length > 0, 'the pit jumped to full instead of counting up');
  for (let i = 1; i < shown.length; i++) assert.ok(shown[i] >= shown[i - 1], 'the pit counted down during a delivery');

  // Spent again mid-run: the pit never shows more than there is.
  run.setGold(50);
  run.setGold(90);
  assert.equal(run.busy(), true);
  run.setGold(40);
  assert.ok(run.bars() <= 50);
});

test('without the buildings or a road between them, a new window fills the pit at once', () => {
  const lone = runOn(null);
  lone.run.setGold(10);
  lone.run.setGold(GOLD_BARS);
  assert.equal(lone.run.busy(), false);
  assert.equal(lone.run.bars(), GOLD_BARS);

  // The buildings there, but the roads gone: no route, so no run to wait on.
  const sites = standing();
  const cut = runOn({ ...sites, village: { paths: [], bridges: [], island: { town: { paved: [] } }, districts: [] } });
  cut.run.setGold(10);
  cut.run.setGold(GOLD_BARS);
  assert.equal(cut.run.busy(), false, 'a run with no road was started');
  assert.equal(cut.run.bars(), GOLD_BARS);
});

// ---- the pit never holds more than the mine can give ---------------------------------------

test('the pit is the five hours or the rest of the week, whichever is less', () => {
  const now = Date.UTC(2026, 8, 25, 12);
  const of = (five, week) => ({
    fiveHour: { used: five, resetsAt: now + H },
    sevenDay: week == null ? null : { used: week, resetsAt: now + DAY },
    at: now - 1000, source: 'statusline',
  });
  const plenty = purseOf(of(20, 10), now);
  assert.deepEqual([plenty.bars, plenty.window, plenty.capped], [80, 80, false], 'a week with room caps nothing');
  const tight = purseOf(of(20, 70), now);
  assert.deepEqual([tight.bars, tight.window, tight.capped], [30, 80, true], 'thirty percent of the week left is thirty bars');
  assert.equal(tight.mine.ore, 30, 'and the mine says the same thirty');
  const spent = purseOf(of(0, 100), now);
  assert.equal(spent.bars, 0, 'a fresh five hours in a spent week is an empty pit');
  // A five-hour window gone by refills the pit - only as far as the week allows.
  const turned = purseOf({ ...of(90, 95), fiveHour: { used: 90, resetsAt: now - 1 } }, now);
  assert.deepEqual([turned.window, turned.bars, turned.reset], [GOLD_BARS, 5, true]);
  // No week on record is no cap: the full mine of mineOf.
  const unknown = purseOf(of(20, null), now);
  assert.deepEqual([unknown.bars, unknown.capped], [80, false]);
  assert.equal(purseOf(null, now).bars, GOLD_BARS, 'no reading at all is still a full pit');
});

test('a gold run can never bring more than the mine has', () => {
  // The run counts the pit up to whatever it is told, and it is told the purse: after a window
  // turns over with ten percent of the week left, it brings ten bars and not a hundred.
  const now = Date.UTC(2026, 8, 25, 12);
  const before = purseOf({ fiveHour: { used: 100, resetsAt: now + 1000 }, sevenDay: { used: 90, resetsAt: now + DAY }, at: now }, now);
  const after = purseOf({ fiveHour: { used: 100, resetsAt: now + 1000 }, sevenDay: { used: 90, resetsAt: now + DAY }, at: now }, now + 2000);
  assert.equal(before.bars, 0);
  assert.equal(after.bars, 10);
  assert.equal(after.window, GOLD_BARS);
});

// ---- the week turning over fills the mine ---------------------------------------------------

test('the mine\'s bin fills over time when the week turns over, and empties at once', () => {
  const group = new THREE.Group();
  const pile = attachOrePile(group, [0, 0, 0]);
  pile.setOre(40);
  assert.equal(pile.shown(), 40, 'the first word is shown as it is');
  pile.setOre(35);
  assert.equal(pile.shown(), 35, 'ore spent comes off at once');
  pile.setOre(35 + ORE_RISE - 1);
  assert.equal(pile.shown(), 35 + ORE_RISE - 1, 'a small rise is a rounding, shown at once');
  pile.setOre(MINE_ORE);
  assert.equal(pile.shown(), 35 + ORE_RISE - 1, 'a week turned over does not fill the bin in one frame');
  let t = 0, last = pile.shown();
  while (pile.shown() < MINE_ORE && t < ORE_FILL_S * 2) {
    pile.update(0.1);
    t += 0.1;
    assert.ok(pile.shown() >= last, 'the bin never counts down while it fills');
    last = pile.shown();
  }
  assert.equal(pile.shown(), MINE_ORE);
  assert.ok(t > ORE_FILL_S * 0.4 && t <= ORE_FILL_S + 0.2, `it filled in ${t.toFixed(1)} s`);
  assert.equal(pile.mesh.count, MINE_ORE);
  pile.setOre(12);
  assert.equal(pile.mesh.count, 12, 'and spending it shows at once again');
  pile.dispose();
});

// ---- the mine keeps off the beach ------------------------------------------------------------

test('on an island founded small the mine waits for ground off the coast, and then stands on it', () => {
  const seed = 1337;
  const settle = (n) => {
    const layout = emptyLayout(seed, 128, { base: 32, steps: [] });
    const m = spreadVillage(n, { projects: Math.max(1, Math.round(n / 3)) });
    const first = placeAll(layout, m, { seed, size: 128 });
    placeAll(layout, m, { seed, size: 128 });
    return { layout, first, m };
  };
  // Nobody yet: the island does not grow, there is no lot off the sand, and the mine waits -
  // without asking for room the way a house left over would.
  const bare = settle(0);
  assert.equal(bare.layout.grow.steps.length, 0);
  assert.equal(bare.layout.plots[GOLDMINE_ID], undefined, 'the mine stood on the founding island\'s beach');
  assert.ok(!bare.first.unplaced.includes(GOLDMINE_ID), 'a mine waiting is not a building left over');

  // The first settler grows the island, and the mine comes with the new ground.
  const one = settle(1);
  const p = one.layout.plots[GOLDMINE_ID];
  assert.ok(p, 'the mine never came');
  const T = makeTerrain(seed, { size: one.layout.size, polders: one.layout.polders || [], fairway: one.layout.fairway || null, grow: one.layout.grow });
  for (let z = p.gz - 2; z < p.gz + 5; z++) {
    for (let x = p.gx - 2; x < p.gx + 5; x++) {
      assert.ok(T.isLand(x, z) && !T.isBeach(x, z), `the mine stands by the sea at ${x},${z}`);
    }
  }
  assert.ok(one.layout.paths.some((q) => q.id === `path:${GOLDMINE_ID}`), 'and it has its road');
  const before = JSON.stringify(one.layout);
  placeAll(one.layout, one.m, { seed, size: 128 });
  assert.equal(JSON.stringify(one.layout), before, 'the scan after it moved something');
});

test('the stack is laid crosswise, four to a layer, and no two bars in one place', () => {
  const slots = stackSlots();
  assert.equal(slots.length, STACK_MAX);
  const seen = new Set(slots.map(([x, y, z]) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`));
  assert.equal(seen.size, STACK_MAX, 'two bars on the same spot');
  for (let i = 0; i < slots.length; i += 4) {
    const layer = slots.slice(i, i + 4);
    assert.ok(layer.every((b) => b[1] === layer[0][1] && b[3] === layer[0][3]), 'a layer is one height and one way');
    if (i) assert.notEqual(layer[0][3], slots[i - 4][3], 'each layer lies across the one below');
  }
  assert.equal(stackSize(0), 4, 'even a small delivery is a stack');
  assert.equal(stackSize(1000), STACK_MAX);
});
