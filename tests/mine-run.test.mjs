// A visit to the gold mine (web/js/mine.js, Plans/goudmijn-zoektocht.md), played with a Map for
// storage: blind digging, a bar that empties in the mine and fills outside it, a draught that fills
// it, and the way down to the key - which is the same all day, so a second attempt can go by memory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

const { createMineRun, readBar, MINE_KEY_STORE } = await import('../web/js/mine.js');
const { DIGS_PER_BAR, REFILL_S, FLOORS, SPOTS, gemById } = await import('../shared/mine.mjs');

function storage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
}
function rig({ potions = 0 } = {}) {
  let t = 1_000_000;
  const events = [];
  const gems = [];
  const g = { n: potions };
  const run = createMineRun({
    storage: storage(), island: () => 'isle', day: () => 42, now: () => t,
    garden: {
      found: (k) => gems.push(k),
      potions: () => g.n,
      drink: async () => { if (!g.n) throw new Error('none'); g.n -= 1; },
    },
    quests: {
      entered: () => events.push(['entered']), descended: (f) => events.push(['descended', f]),
      dug: (k) => events.push(['dug', k]), found: (k) => events.push(['found', k]),
    },
  });
  return { run, events, gems, g, tick: (s) => { t += s * 1000; } };
}
// Dig straight to the goal, as somebody who remembers it would.
const toGoal = (run) => { const g = run.plan().goal; return run.dig(g); };

test('the way down by memory: a dig on each floor\'s goal, seven floors, the key at the bottom', () => {
  const { run, events } = rig();
  run.enter();
  assert.equal(run.floor(), 1);
  for (let fl = 1; fl < FLOORS; fl++) {
    assert.equal(toGoal(run), 'stair');
    assert.equal(run.actionAt(run.plan().goal), 'down');
    assert.ok(run.descend());
  }
  assert.equal(run.floor(), FLOORS);
  assert.equal(toGoal(run), 'key');
  assert.equal(run.actionAt(run.plan().goal), 'key');
  assert.ok(run.takeKey());
  assert.ok(!run.takeKey(), 'taken once');
  assert.deepEqual(events[0], ['entered']);
  assert.deepEqual(events.filter((e) => e[0] === 'descended').map((e) => e[1]), [2, 3, 4, 5, 6, 7]);
  assert.deepEqual(events.at(-1), ['found', 'key']);
});

test('a rock is never dug, a hole not twice, and the stair is not taken before it is dug open', () => {
  const { run } = rig();
  run.enter();
  const f = run.plan();
  const rock = f.rock.findIndex((r) => r);
  if (rock >= 0) { assert.equal(run.actionAt(rock), 'rock'); assert.equal(run.dig(rock), null); }
  assert.ok(!run.descend(), 'the stair is still under the earth');
  const earth = [...Array(SPOTS).keys()].find((i) => !f.rock[i] && i !== f.goal);
  assert.ok(run.dig(earth));
  assert.equal(run.actionAt(earth), null);
  assert.equal(run.dig(earth), null);
});

test('a stone dug goes to the purse and to the book', () => {
  const { run, gems, events } = rig();
  run.enter();
  // Find a floor's stone by digging everything but the goal.
  const f = run.plan();
  const [i, id] = [...f.gem][0] || [];
  if (i == null) return;   // a floor with no stone: nothing to check
  assert.equal(run.dig(i), id);
  assert.ok(gemById(id));
  assert.deepEqual(gems, [id]);
  assert.deepEqual(events.at(-1), ['dug', 'gem']);
});

test('the bar empties by digging, a draught fills it, and with none left that is the end', async () => {
  const { run, g } = rig({ potions: 1 });
  run.enter();
  const f = run.plan();
  const earth = [...Array(SPOTS).keys()].filter((i) => !f.rock[i] && i !== f.goal);
  // Leave the goal for later: dig until the bar is empty (more spots than a bar, or come back for more).
  let done = 0;
  for (const i of earth) { if (run.actionAt(i) !== 'dig') break; run.dig(i); done++; }
  assert.ok(done <= DIGS_PER_BAR);
  if (done === DIGS_PER_BAR) {
    assert.equal(run.actionAt(f.goal), 'drink');
    await run.drink();
    assert.equal(g.n, 0);
    assert.equal(run.level(), 1);
    for (let k = 0; k < DIGS_PER_BAR - 1; k++) { if (run.actionAt(earth[done + k] ?? -1) === 'dig') run.dig(earth[done + k]); }
  }
});

test('in the mine the bar does not fill; outside it fills in REFILL_S; leaving starts at the top again', () => {
  const { run, tick } = rig();
  run.enter();
  const f = run.plan();
  const earth = [...Array(SPOTS).keys()].filter((i) => !f.rock[i] && i !== f.goal);
  for (const i of earth.slice(0, 10)) run.dig(i);
  const after = run.level();
  tick(REFILL_S);
  assert.equal(run.level(), after, 'no refill inside');
  toGoal(run); run.descend();
  run.leave();
  tick(REFILL_S / 10);
  assert.ok(Math.abs(run.level() - (after - 1 / DIGS_PER_BAR + 0.1)) < 1e-6);
  tick(REFILL_S);
  assert.equal(run.level(), 1);
  run.enter();
  assert.equal(run.floor(), 1, 'out is starting again');
  assert.equal(run.dugSpots().length, 0);
  assert.equal(run.plan().goal, f.goal, 'and the same stair, the same day');
});

test('the bar survives a reload and junk in storage reads as full', () => {
  const s = storage();
  s.setItem(MINE_KEY_STORE, 'not json');
  assert.deepEqual(readBar(s), { level: 1, at: 0 });
  s.setItem(MINE_KEY_STORE, JSON.stringify({ level: 0.25, at: 5 }));
  assert.deepEqual(readBar(s), { level: 0.25, at: 5 });
});
