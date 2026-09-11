import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecovery } from '../web/js/graphics-health.js';

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test('reloads share a four-attempt budget, even after renderer initialization', () => {
  const saved = storage();
  for (let attempt = 1; attempt <= 4; attempt++) {
    assert.equal(createRecovery(saved).reserve(), attempt);
  }
  assert.equal(createRecovery(saved).reserve(), null);
});

test('only successful visible rendering resets the budget; failure resets progress', () => {
  const saved = storage();
  const health = createRecovery(saved, { stableMs: 1000 });
  assert.equal(health.reserve(), 1);
  health.frame(0, true);
  health.frame(500, true);
  health.failed();
  health.frame(1000, true);
  health.frame(1250, true);
  health.frame(1500, false);
  health.frame(100000, false);
  health.frame(100250, true);
  assert.equal(health.reserve(), 2);
  health.frame(100500, true);
  health.frame(100750, true);
  health.frame(101000, true);
  assert.equal(health.reserve(), 1);
});

test('unavailable or corrupt persistence disables automatic reloads', () => {
  assert.equal(createRecovery({ getItem() { throw Error('denied'); } }).reserve(), null);
  for (const value of ['NaN', '-1', '1.5', 'Infinity']) {
    assert.equal(createRecovery({ getItem: () => value }).reserve(), null);
  }
  assert.equal(createRecovery({ getItem: () => null, setItem() {} }).reserve(), null);
});
