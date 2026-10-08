// The gold mine's floors (shared/mine.mjs, Plans/goudmijn-zoektocht.md): seeded from a string, so
// a page and a test seed the same mine, and a floor is the same all day - that is what lets a player
// remember where the stair was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  GRID, SPOTS, FLOORS, ENTRY_SPOT, ENTRY_CLEAR, GEMS, floorOf, digAt, mineSeed, colRow, spotAt, spotCentre,
  DIGS_PER_BAR,
} from '../shared/mine.mjs';

const reachable = (f) => {
  const seen = new Set([ENTRY_SPOT]);
  const q = [ENTRY_SPOT];
  while (q.length) {
    const i = q.shift();
    const [c, r] = colRow(i);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= GRID || nr >= GRID) continue;
      const n = nr * GRID + nc;
      if (!f.rock[n] && !seen.has(n)) { seen.add(n); q.push(n); }
    }
  }
  return seen;
};

test('a floor is the same for the same seed, and another day is another mine', () => {
  const a = floorOf(mineSeed('isle', 100), 3), b = floorOf(mineSeed('isle', 100), 3);
  assert.deepEqual([...a.rock], [...b.rock]);
  assert.equal(a.goal, b.goal);
  assert.deepEqual([...a.gem], [...b.gem]);
  const days = new Set();
  for (let d = 0; d < 20; d++) days.add(floorOf(mineSeed('isle', d), 1).goal);
  assert.ok(days.size > 5, 'the stair moves from day to day');
});

test('the way down is always on open earth a body can reach, never by the door, and only the bottom holds the key', () => {
  for (let d = 0; d < 60; d++) {
    for (let fl = 1; fl <= FLOORS; fl++) {
      const f = floorOf(mineSeed('s', d), fl);
      assert.equal(f.rock[f.goal], 0);
      assert.ok(reachable(f).has(f.goal), `day ${d} floor ${fl}: the goal is walled in`);
      assert.ok(colRow(f.goal)[1] < GRID - ENTRY_CLEAR, 'not on the row by the door');
      for (let i = 0; i < SPOTS; i++) if (colRow(i)[1] >= GRID - ENTRY_CLEAR) assert.equal(f.rock[i], 0);
      assert.equal(digAt(f, f.goal), fl === FLOORS ? 'key' : 'stair');
      for (const [i, id] of f.gem) {
        assert.ok(!f.rock[i] && i !== f.goal);
        assert.ok(GEMS.find((g) => g.id === id).from <= fl, `${id} on floor ${fl}`);
      }
    }
  }
});

test('a floor is worth the bar: about forty spots of earth, so the stair is found within it on average', () => {
  let earth = 0, n = 0;
  for (let d = 0; d < 40; d++) for (let fl = 1; fl <= FLOORS; fl++) {
    const f = floorOf(mineSeed('w', d), fl);
    earth += f.rock.reduce((s, r) => s + (r ? 0 : 1), 0);
    n++;
  }
  const avg = earth / n;
  assert.ok(avg > 30 && avg < 46, `avg earth ${avg}`);
  assert.ok(avg / 2 < DIGS_PER_BAR, 'half a floor fits in a bar');
});

test('a spot and its place in the room are each other\'s inverse', () => {
  for (let i = 0; i < SPOTS; i++) {
    const { x, z } = spotCentre(i);
    assert.equal(spotAt(x, z), i);
  }
  assert.equal(spotAt(100, 0), -1);
  assert.equal(digAt(floorOf('x', 1), -1), null);
});

test('nothing in the mine can differ between two engines', () => {
  const src = readFileSync(fileURLToPath(new URL('../shared/mine.mjs', import.meta.url)), 'utf8')
    .split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
  const m = src.match(/Math\.(sin|cos|tan|atan2?|pow|exp|log|hypot|random)\s*\(|\*\*/);
  assert.equal(m, null);
});
