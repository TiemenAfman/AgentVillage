// Treasure maps: the spot on an islet, the islet a seed points at, what the chest holds and
// when a bottle washes up. All of it is arithmetic on a seed (shared/treasure.mjs), so the
// tests are about the properties two screens must agree on: the same seed is the same spot
// everywhere, and that spot is somewhere a person can actually dig.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { isletsNear, isletById, candidate, isletHeight, ISLET_KINDS } from '../shared/islets.mjs';
import {
  spotOf, pickIslet, cardOf, gridOf, bottleOf, bottleWashesUp, rewardOf, FIRST_HUNT_SEED,
  DRY_MIN, PALM_CLEAR, BUSH_CLEAR, MAP_MIN, MAP_MAX,
  REWARD_COLORS, REWARD_HATS, REWARD_ITEMS, UNLOCK_IDS,
} from '../shared/treasure.mjs';
import { WORLD_HALF, KM } from '../shared/regions.mjs';

// A fleet as the sea hands it round (tests/islets.test.mjs has the same).
const FLEET = [
  { id: '0000000000000000', origin: [0, 0], gridSize: 192, reach: 96, volcano: true },
  { id: 'a', origin: [336, 0], gridSize: 64, reach: 192 },
  { id: 'b', origin: [0, -336], gridSize: 64, reach: 192 },
  { id: 'c', origin: [-336, -336], gridSize: 64, reach: 192 },
];
const ISLETS = isletsNear(FLEET, [0, 0], { range: 1500 });
const dist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);

// ---- isletById ---------------------------------------------------------------------------

test('an islet by id is the very islet the fleet hands out, palms and all', () => {
  assert.ok(ISLETS.length > 20);
  for (const islet of ISLETS) assert.deepEqual(isletById(islet.id), islet, islet.id);
});

test('an id that names no islet gives null, and never throws', () => {
  let empty = null;
  for (let i = 0; i < 40 && !empty; i++) if (!candidate(i, 0)) empty = `islet:${i}:0`;
  assert.ok(empty, 'no empty square found to test with');
  for (const bad of [empty, 'islet:1', 'islet:a:b', 'islet:1.5:2', 'islet:01:2', 'islet:-0:1', 'islet:1:2:3', 'ISLET:1:2',
    'islet:99999999:1', '', null, undefined, 42, {}, ['islet:1:1']]) {
    assert.equal(isletById(bad), null, String(bad));
  }
});

test('asking for an islet by id, or a spot on it, does not disturb the flora of the others', () => {
  const one = isletsNear(FLEET, [0, 0], { range: 1500 });
  for (const islet of ISLETS) { isletById(islet.id); spotOf(islet, 'x'); }
  assert.deepEqual(isletsNear(FLEET, [0, 0], { range: 1500 }), one);
});

// ---- the spot ----------------------------------------------------------------------------

test('the spot is deterministic, dry and clear of palms and bushes - on every kind of islet', () => {
  const kinds = new Set();
  let checked = 0;
  for (const islet of ISLETS) {
    kinds.add(islet.kind);
    for (let n = 0; n < 60; n++) {
      const seed = `s${n}`;
      const a = spotOf(islet, seed), b = spotOf(islet, seed);
      assert.deepEqual(a, b, `${islet.id}/${seed} is not repeatable`);
      assert.ok(isletHeight(islet, a.x, a.z) >= DRY_MIN, `${islet.id}/${seed} is wet: ${isletHeight(islet, a.x, a.z)}`);
      assert.ok(Math.abs(a.y - isletHeight(islet, a.x, a.z)) < 1e-12);
      for (const p of islet.palms) assert.ok(dist(a, p) >= PALM_CLEAR - 1e-9, `${islet.id}/${seed} is under a palm`);
      for (const bush of islet.bushes) assert.ok(dist(a, bush) >= BUSH_CLEAR - 1e-9, `${islet.id}/${seed} is in a bush`);
      checked++;
    }
  }
  assert.deepEqual([...kinds].sort(), Object.keys(ISLET_KINDS).sort(), 'not every kind of islet was tried');
  assert.ok(checked > 1000);
});

test('the spot spreads over the islet: different seeds do not all dig in one place', () => {
  const green = ISLETS.find((i) => i.kind === 'green');
  const spots = new Set();
  for (let n = 0; n < 50; n++) { const s = spotOf(green, `m${n}`); spots.add(`${s.x.toFixed(2)},${s.z.toFixed(2)}`); }
  assert.ok(spots.size > 40, 'only ' + spots.size + ' different spots');
});

test('the fallback still gives a dry spot clear of the palm when the tries run out', () => {
  // A sandbank ringed with bushes so that the rejection sampling finds nothing to keep.
  const bank = ISLETS.find((i) => i.kind === 'sandbank');
  const tight = { ...bank, palms: [{ x: 0, z: 0 }], bushes: [{ x: 1.7, z: 0 }, { x: -1.7, z: 0 }, { x: 0, z: 1.7 }, { x: 0, z: -1.7 }] };
  for (let n = 0; n < 100; n++) {
    const a = spotOf(tight, `t${n}`);
    assert.deepEqual(a, spotOf(tight, `t${n}`));
    assert.ok(isletHeight(tight, a.x, a.z) >= DRY_MIN);
    assert.ok(dist(a, { x: 0, z: 0 }) >= PALM_CLEAR - 1e-9);
  }
});

// ---- which islet -------------------------------------------------------------------------

test('a seed points at an islet 150 to 900 from the berth, by id, whatever order the list is in', () => {
  const berth = [336, 0];
  const inBand = ISLETS.filter((i) => { const d = dist(i, { x: berth[0], z: berth[1] }); return d >= MAP_MIN && d <= MAP_MAX; });
  assert.ok(inBand.length > 3);
  const ids = new Set();
  for (let n = 0; n < 80; n++) {
    const id = pickIslet(ISLETS, berth, `p${n}`);
    assert.equal(typeof id, 'string');
    assert.ok(inBand.some((i) => i.id === id), `${id} is out of the band`);
    assert.equal(pickIslet([...ISLETS].reverse(), berth, `p${n}`), id, 'the order of the list matters');
    ids.add(id);
  }
  assert.ok(ids.size > 3, 'every seed lands on the same few islets');
  assert.equal(pickIslet([], berth, 'x'), null);
  assert.equal(pickIslet(null, berth, 'x'), null);
});

test('the pick survives the fleet changing, unless it is the very islet that went', () => {
  const berth = [336, 0];
  const inBand = ISLETS.filter((i) => { const d = dist(i, { x: berth[0], z: berth[1] }); return d >= MAP_MIN && d <= MAP_MAX; });
  for (let n = 0; n < 30; n++) {
    const id = pickIslet(ISLETS, berth, `k${n}`);
    // Take away any other islet in the band: the map must not move.
    const other = inBand.find((i) => i.id !== id && hashish(i.id, n));
    const without = ISLETS.filter((i) => i !== other);
    assert.equal(pickIslet(without, berth, `k${n}`), id, `losing ${other && other.id} moved the pick`);
    // Take away the pick itself: it has to go somewhere else.
    const then = pickIslet(ISLETS.filter((i) => i.id !== id), berth, `k${n}`);
    assert.notEqual(then, id);
  }
});
function hashish(id, n) { return (id.length + n) % 2 === 0; }

test('a lonely berth still gets the nearest islet to the band', () => {
  const far = [{ id: 'islet:1:1', x: 5000, z: 0 }, { id: 'islet:2:2', x: 3000, z: 0 }];
  assert.equal(pickIslet(far, [0, 0], 'x'), 'islet:2:2');
  const near = [{ id: 'islet:1:1', x: 10, z: 0 }, { id: 'islet:2:2', x: 100, z: 0 }];
  assert.equal(pickIslet(near, [0, 0], 'x'), 'islet:2:2');
});

test('the first hunt has one seed per island and it is not the day\'s', () => {
  assert.equal(FIRST_HUNT_SEED('abc'), FIRST_HUNT_SEED('abc'));
  assert.notEqual(FIRST_HUNT_SEED('abc'), FIRST_HUNT_SEED('abd'));
  assert.notEqual(FIRST_HUNT_SEED('abc'), bottleOf('abc', 20000, [[1, 1]]).seed);
});

// ---- the map -----------------------------------------------------------------------------

test('the chart square is the one the world map draws: A1 north-west, P16 south-east, 252 apiece', () => {
  assert.equal(gridOf(-WORLD_HALF + 1, -WORLD_HALF + 1), 'A1');
  assert.equal(gridOf(WORLD_HALF - 1, WORLD_HALF - 1), 'P16');
  assert.equal(gridOf(0, 0), 'I9');
  assert.equal(gridOf(-WORLD_HALF + KM * 10 + 1, -WORLD_HALF + KM * 6 + 1), 'K7');
  assert.equal(gridOf(1e9, -1e9), 'P1', 'off the sheet is clamped, not invented');
});

test('a map holds the id, the world spot and the square, and the spot is on the islet', () => {
  const berth = [336, 0];
  const card = cardOf('seed-1', 'island-1', { candidates: ISLETS, berth, day: 20000 });
  assert.ok(card);
  assert.equal(card.seed, 'seed-1');
  assert.equal(card.status, 'awake');
  const islet = ISLETS.find((i) => i.id === card.isletId);
  assert.ok(dist(card.spot, islet) <= islet.r);
  assert.deepEqual(card.spot, { x: islet.x + card.local.x, z: islet.z + card.local.z });
  assert.match(card.grid, /^[A-P]([1-9]|1[0-6])$/);
  assert.equal(card.grid, gridOf(card.spot.x, card.spot.z));
  assert.deepEqual(JSON.parse(JSON.stringify(card)), card, 'a map must survive localStorage');
});

test('a map on an islet that has fallen under somebody\'s water sleeps, keeps its cross, and wakes again', () => {
  const berth = [336, 0];
  const awake = cardOf('sleepy', 'i', { candidates: ISLETS, berth });
  const gone = ISLETS.filter((i) => i.id !== awake.isletId);
  const asleep = cardOf('sleepy', 'i', { candidates: gone, berth, isletId: awake.isletId });
  assert.equal(asleep.status, 'asleep');
  assert.deepEqual(asleep.spot, awake.spot, 'the cross moved while the islet was away');
  assert.equal(asleep.grid, awake.grid);
  assert.equal(cardOf('sleepy', 'i', { candidates: ISLETS, berth, isletId: awake.isletId }).status, 'awake');
  assert.equal(cardOf('sleepy', 'i', { candidates: [], berth }), null);
  assert.equal(cardOf('sleepy', 'i', { candidates: ISLETS, berth, isletId: 'islet:not:one' }), null);
});

// ---- the bottle --------------------------------------------------------------------------

test('one bottle per island per world day, on the same cell for everybody', () => {
  const cells = [[10, 4], [11, 4], [12, 5], [3, 9]];
  const a = bottleOf('isl', 20000, cells);
  assert.deepEqual(a, bottleOf('isl', 20000, [...cells].reverse()));
  assert.ok(cells.some((c) => c[0] === a.cell[0] && c[1] === a.cell[1]));
  assert.notEqual(a.seed, bottleOf('isl', 20001, cells).seed);
  assert.notEqual(a.seed, bottleOf('other', 20000, cells).seed);
  const days = new Set();
  for (let d = 20000; d < 20060; d++) days.add(bottleOf('isl', d, cells).cell.join());
  assert.ok(days.size > 1, 'the bottle lies on the same cell every day');
  assert.equal(bottleOf('isl', 20000, []), null);
  assert.equal(bottleOf('isl', 20000, null), null);
});

test('no bottle on a day nobody worked', () => {
  assert.equal(bottleWashesUp(20000, [19998, 19999]), false);
  assert.equal(bottleWashesUp(20000, [19999, 20000]), true);
  assert.equal(bottleWashesUp(20000, 20000), true);
  assert.equal(bottleWashesUp(20000, new Set([20000])), true);
  assert.equal(bottleWashesUp(20000, []), false);
  assert.equal(bottleWashesUp(20000, undefined), false);
  assert.equal(bottleWashesUp(NaN, [NaN]), false);
});

// ---- the chest ---------------------------------------------------------------------------

test('a chest holds what it holds for everybody, and roughly 70 / 25 / 5', () => {
  const N = 4000;
  const seen = { color: 0, hat: 0, item: 0, doubloons: 0 };
  for (let n = 0; n < N; n++) {
    const r = rewardOf(`r${n}`, []);
    assert.deepEqual(r, rewardOf(`r${n}`, []));
    seen[r.kind]++;
  }
  assert.equal(seen.doubloons, 0);
  assert.ok(Math.abs(seen.color / N - 0.70) < 0.04, JSON.stringify(seen));
  assert.ok(Math.abs(seen.hat / N - 0.25) < 0.04, JSON.stringify(seen));
  assert.ok(Math.abs(seen.item / N - 0.05) < 0.03, JSON.stringify(seen));
});

test('a chest never repeats a find, and gives doubloons once everything is owned', () => {
  const everything = [...REWARD_COLORS, ...REWARD_HATS, ...REWARD_ITEMS].map((r) => r.id);
  const owned = new Set();
  for (let n = 0; n < everything.length; n++) {
    const r = rewardOf(`fill${n}`, owned);
    assert.notEqual(r.kind, 'doubloons', 'gave up with things left to find');
    assert.ok(!owned.has(r.id), `${r.id} twice`);
    assert.ok(everything.includes(r.id));
    owned.add(r.id);
  }
  for (let n = 0; n < 50; n++) {
    const r = rewardOf(`full${n}`, owned);
    assert.equal(r.kind, 'doubloons');
    assert.equal(r.id, null);
  }
  // A used-up kind passes to the next one instead of repeating.
  const noColors = REWARD_COLORS.map((c) => c.id);
  for (let n = 0; n < 200; n++) assert.ok(!noColors.includes(rewardOf(`nc${n}`, noColors).id));
  // Junk in `owned` is not a reason to throw.
  assert.doesNotThrow(() => rewardOf('x', 5));
  assert.doesNotThrow(() => rewardOf('x', null));
  assert.ok(rewardOf('x', undefined).id);
});

test('the reward ids are the ones the plan names, and unique', () => {
  assert.deepEqual(REWARD_COLORS.map((c) => c.id), ['captain-red', 'sea-green', 'kraken-purple', 'gold-leaf']);
  assert.deepEqual(REWARD_HATS.map((c) => c.id), ['tricorn', 'bandana']);
  assert.deepEqual(REWARD_ITEMS.map((c) => c.id), ['spyglass']);
  assert.equal(new Set(UNLOCK_IDS).size, UNLOCK_IDS.length);
  assert.ok(UNLOCK_IDS.includes('shovel'));
});

// ---- shared/'s rule ----------------------------------------------------------------------

test('nothing in the treasure can differ between two engines', () => {
  for (const file of ['treasure.mjs', 'quests.mjs']) {
    const src = readFileSync(fileURLToPath(new URL('../shared/' + file, import.meta.url)), 'utf8')
      .split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
    const banned = /Math\.(sin|cos|tan|asin|acos|atan|atan2|pow|exp|log|log2|log10|cbrt|hypot|random)\s*\(|\*\*/;
    const m = src.match(banned);
    assert.equal(m, null, `shared/${file} uses ${m && m[0]} - see the rule at the top of shared/rng.mjs`);
    assert.ok(!/Date\.now|performance\.now|new Date/.test(src), `${file} must not read a clock`);
    assert.ok(!/from '\.\.\/(web|lib)\//.test(src) && !/from ['"]three/.test(src), `${file} must not reach into the browser or the islander`);
  }
});
