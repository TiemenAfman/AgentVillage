import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecovery, renderSnapshot } from '../web/js/graphics-health.js';

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

test('diagnostics copy counters so later renders cannot change the pre-crash snapshot', () => {
  const renderer = {
    info: { render: { calls: 12, triangles: 300, points: 2, lines: 4 },
      memory: { geometries: 8, textures: 9 }, programs: [{}, {}] },
    domElement: { width: 1600, height: 1000 },
    getPixelRatio: () => 1.15, shadowMap: { enabled: true },
  };
  const snapshot = renderSnapshot(renderer, 123.7);
  renderer.info.render.calls = 0;
  renderer.info.memory.textures = 0;
  assert.equal(snapshot.calls, 12);
  assert.equal(snapshot.textures, 9);
  assert.equal(snapshot.programs, 2);
  assert.equal(snapshot.atMs, 124);
  assert.equal(snapshot.width, 1600);
});
