// What may come through the planner's door. lib/plan.mjs rebuilds a plan field by field
// from whatever arrived on the socket, and everything it refuses is refused here on
// purpose: a plan is the one request that is allowed to move a hamlet, so the shape of it
// is not something to be lenient about.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlan, PLAN_CAPS, isSnapshotName, snapshotName } from '../lib/plan.mjs';

const refuses = (raw, why) => assert.throws(() => parsePlan(raw), why);

test('a move is normalised: default lobe, duplicates dropped, integers only', () => {
  const p = parsePlan({ ops: [{ op: 'move', lobes: [{ district: 'p:d:\\git\\x' }, { district: 'p:d:\\git\\x', lobe: 0 }, { district: 'p:d:\\git\\y', lobe: 1 }], di: 2, dj: -1 }] });
  assert.deepEqual(p, { ops: [{ op: 'move', lobes: [{ district: 'p:d:\\git\\x', lobe: 0 }, { district: 'p:d:\\git\\y', lobe: 1 }], di: 2, dj: -1 }] });
  // And nothing else rides along: a spread of the request would have kept `extra`.
  const q = parsePlan({ ops: [{ op: 'move', lobes: [{ district: 'a', lobe: 0, extra: 1 }], di: 1, dj: 0, extra: true }], extra: 'x' });
  assert.deepEqual(Object.keys(q), ['ops']);
  assert.deepEqual(Object.keys(q.ops[0]), ['op', 'lobes', 'di', 'dj']);
  assert.deepEqual(Object.keys(q.ops[0].lobes[0]), ['district', 'lobe']);
});

test('a zone is normalised: kind defaults, supers deduplicated and sorted', () => {
  const p = parsePlan({ ops: [{ op: 'zone', add: [[3, 1], [1, 1], [3, 1], [0, 0]], remove: [[9, 9]] }] });
  assert.deepEqual(p.ops[0], { op: 'zone', kind: 'no-build', add: [[0, 0], [1, 1], [3, 1]], remove: [[9, 9]] });
});

test('the shape is not negotiable', () => {
  refuses(null, /object/);
  refuses([], /object/);
  refuses({ ops: [] }, /at least one/);
  refuses({ ops: 'move' }, /at least one/);
  refuses({ ops: Array.from({ length: PLAN_CAPS.ops + 1 }, () => ({ op: 'zone', add: [[1, 1]] })) }, /at most/);
  refuses({ ops: [{ op: 'square', dx: 4 }] }, /unknown op/);
  refuses({ ops: [null] }, /not an object/);
});

test('a move needs whole hamlets and a whole, bounded, non-zero delta', () => {
  refuses({ ops: [{ op: 'move', lobes: [], di: 1, dj: 0 }] }, /at least one hamlet/);
  refuses({ ops: [{ op: 'move', lobes: [{ district: 'a' }], di: 0, dj: 0 }] }, /nothing at all/);
  refuses({ ops: [{ op: 'move', lobes: [{ district: 'a' }], di: 1.5, dj: 0 }] }, /whole number/);
  refuses({ ops: [{ op: 'move', lobes: [{ district: 'a' }], di: '1', dj: 0 }] }, /whole number/);
  refuses({ ops: [{ op: 'move', lobes: [{ district: 'a' }], di: PLAN_CAPS.shift + 1, dj: 0 }] }, /out of range/);
  refuses({ ops: [{ op: 'move', lobes: [{ district: 'a', lobe: -1 }], di: 1, dj: 0 }] }, /out of range/);
  refuses({ ops: [{ op: 'move', lobes: [{ district: 7 }], di: 1, dj: 0 }] }, /must be a string/);
  refuses({ ops: [{ op: 'move', lobes: [{ district: '' }], di: 1, dj: 0 }] }, /must be a string/);
  refuses({ ops: [{ op: 'move', lobes: Array.from({ length: PLAN_CAPS.lobes + 1 }, (_, i) => ({ district: `d${i}` })), di: 1, dj: 0 }] }, /at most/);
});

test('a district id is looked up, never trusted as a key', () => {
  // `layout.districts['__proto__']` is Object.prototype, which is truthy: a plan naming
  // it would find a "hamlet" with no lobes and a confusing refusal at best. Stopped at the
  // door instead.
  refuses({ ops: [{ op: 'move', lobes: [{ district: '__proto__' }], di: 1, dj: 0 }] }, /not a name/);
  refuses({ ops: [{ op: 'move', lobes: [{ district: 'constructor' }], di: 1, dj: 0 }] }, /not a name/);
});

test('a zone is whole super-cells of a kind that exists', () => {
  refuses({ ops: [{ op: 'zone', kind: 'build-here', add: [[1, 1]] }] }, /unknown zone kind/);
  refuses({ ops: [{ op: 'zone' }] }, /changes nothing/);
  refuses({ ops: [{ op: 'zone', add: [[1]] }] }, /not \[i, j\]/);
  refuses({ ops: [{ op: 'zone', add: [[1.5, 1]] }] }, /whole number/);
  refuses({ ops: [{ op: 'zone', add: 'all' }] }, /list of super-cells/);
  refuses({ ops: [{ op: 'zone', add: Array.from({ length: PLAN_CAPS.zoneSupers + 1 }, (_, i) => [i, 0]) }] }, /more than/);
});

test('a snapshot name is the shape the server writes and nothing else', () => {
  const name = snapshotName(new Date(2026, 8, 22, 14, 5, 9));
  assert.equal(name, 'layout.before-plan-20260922-140509.json');
  assert.ok(isSnapshotName(name));
  for (const bad of ['layout.json', '../layout.json', 'layout.before-plan-20260922-140509.json/../x', 'layout.before-256-20260918-151140.json', '', null, 42]) {
    assert.equal(isSnapshotName(bad), false, `${bad} passed as a snapshot`);
  }
});
