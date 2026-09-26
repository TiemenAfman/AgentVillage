import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openAnimalStore } from '../lib/animal-store.mjs';
import { ACTIVITY_WINDOW_MS as WINDOW } from '../lib/animal-stories.mjs';

const arrival = { kind: 'arrive', id: 'chicken:1', species: 'chicken', name: 'Pip' };
const observe = (cursor, source = 'house:private-session') => ({ kind: 'observe', animal: arrival.id, source, cursor });

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'animal-story-'));
  let store = openAnimalStore(dir);
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, get store() { return store; }, reopen() { store.close(); store = openAnimalStore(dir); return store; } };
}

function visit(store, cursor, at) {
  const event = store.dispatch(observe(cursor), at);
  assert.ok(event.data.action, 'new activity should schedule a visit');
  return store.dispatch({ kind: 'complete', action: event.data.action.id }, at + 1);
}

test('activation baselines old activity; rescans and counter corrections create no visits', (t) => {
  const f = fixture(t), s = f.store;
  s.dispatch(arrival, 0);
  s.dispatch(observe(800), 0);
  assert.deepEqual(s.snapshot().pending, {});
  assert.equal(s.dispatch(observe(800), WINDOW), null);
  assert.equal(s.dispatch(observe(12), WINDOW), null);
  assert.equal(s.snapshot().cursors['house:private-session'], 800);
  assert.equal(visit(s, 801, WINDOW).data.visits, 1);
  assert.equal(s.dispatch(observe(802), WINDOW + 2).data.action, null, 'same activity window is quiet');
  assert.equal(s.history().filter((e) => e.kind === 'encounter').length, 1);
});

test('pending visit, cursors and completed bond survive reopening without a checkpoint', (t) => {
  const f = fixture(t);
  f.store.dispatch(arrival, 0);
  f.store.dispatch(observe(0), 0);
  const pending = f.store.dispatch(observe(1), WINDOW).data.action;
  f.reopen();
  assert.deepEqual(f.store.snapshot().pending[pending.id], pending);
  assert.equal(f.store.dispatch({ kind: 'complete', action: pending.id }, WINDOW + 1).data.visits, 1);
  visit(f.store, 2, 2 * WINDOW);
  visit(f.store, 3, 3 * WINDOW);
  const before = f.store.snapshot();
  f.reopen();
  assert.deepEqual(f.store.snapshot(), before);
  assert.equal(before.animals[arrival.id].relationships['house:private-session'].label, 'bonded');
  assert.equal(f.store.dispatch({ kind: 'complete', action: pending.id }, 4 * WINDOW), null);
  assert.equal(f.store.dispatch(observe(3), 4 * WINDOW), null);
});

test('a pending visit cannot be replaced by another resident or a later scan', (t) => {
  const { store: s } = fixture(t);
  s.dispatch(arrival, 0);
  s.dispatch(observe(0), 0);
  s.dispatch(observe(0, 'house:second'), 0);
  const action = s.dispatch(observe(1), WINDOW).data.action;
  assert.equal(s.dispatch(observe(1, 'house:second'), 2 * WINDOW).data.action, null);
  assert.deepEqual(Object.values(s.snapshot().pending), [action]);
  assert.equal(s.dispatch({ kind: 'complete', action: 'unknown' }, 2 * WINDOW), null);
  assert.deepEqual(s.snapshot().animals[arrival.id].relationships, {});
});

test('arrival is idempotent but cannot silently change an existing identity', (t) => {
  const { store: s } = fixture(t);
  s.dispatch(arrival, 0);
  assert.equal(s.dispatch(arrival, 1), null);
  assert.throws(() => s.dispatch({ ...arrival, species: 'goat' }, 2), /already used/);
  assert.throws(() => s.dispatch({ ...arrival, id: 'cat:1', species: 'cat' }, 2), /invalid arrival/);
  assert.equal(s.snapshot().seq, 1);
});

test('checkpoint corruption cannot override committed history', (t) => {
  const f = fixture(t);
  f.store.dispatch(arrival, 0);
  f.store.checkpoint();
  f.store.dispatch(observe(500), 1);
  fs.writeFileSync(path.join(f.dir, 'animals.json'), '{broken');
  f.reopen();
  assert.equal(f.store.snapshot().seq, 2);
  f.store.checkpoint();
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dir, 'animals.json'), 'utf8')), f.store.snapshot());
});

test('interrupted final write is saved separately, then the next record remains readable', (t) => {
  const f = fixture(t);
  f.store.dispatch(arrival, 0);
  f.store.close();
  const journal = path.join(f.dir, 'animal-events.jsonl');
  const tail = Buffer.from('{"name":"Pip');
  fs.appendFileSync(journal, tail);
  f.reopen();
  assert.equal(f.store.snapshot().seq, 1);
  assert.deepEqual(fs.readFileSync(`${journal}.interrupted`), tail);
  f.store.dispatch(observe(4), 1);
  f.reopen();
  assert.equal(f.store.snapshot().seq, 2);
});

test('corrupt complete records stop recovery without truncating the journal', (t) => {
  const f = fixture(t);
  f.store.dispatch(arrival, 0);
  f.store.close();
  const journal = path.join(f.dir, 'animal-events.jsonl');
  fs.appendFileSync(journal, '{broken}\n');
  const before = fs.readFileSync(journal);
  assert.throws(() => openAnimalStore(f.dir));
  assert.deepEqual(fs.readFileSync(journal), before);
  assert.equal(fs.existsSync(path.join(f.dir, 'animal-store.lock')), false);
});

test('unknown versions and sequence gaps fail closed', (t) => {
  const f = fixture(t);
  const event = f.store.dispatch(arrival, 0);
  f.store.close();
  const journal = path.join(f.dir, 'animal-events.jsonl');
  for (const change of [{ version: 2 }, { rules: 2 }, { seq: 4 }, { id: 'other' }]) {
    fs.writeFileSync(journal, `${JSON.stringify({ ...event, ...change })}\n`);
    assert.throws(() => openAnimalStore(f.dir), /envelope/);
  }
});

test('a second writer is refused and closing releases ownership', (t) => {
  const f = fixture(t);
  assert.throws(() => openAnimalStore(f.dir), /locked/);
  f.reopen();
  f.store.dispatch(arrival, 0);
  assert.equal(f.store.snapshot().seq, 1);
});

test('returned state and events cannot mutate the persisted story', (t) => {
  const f = fixture(t);
  const event = f.store.dispatch(arrival, 0);
  event.data.name = 'Changed';
  f.store.snapshot().animals[arrival.id].name = 'Changed';
  f.store.history()[0].data.name = 'Changed';
  assert.equal(f.store.snapshot().animals[arrival.id].name, 'Pip');
  f.reopen();
  assert.equal(f.store.snapshot().animals[arrival.id].name, 'Pip');
});

test('opaque ids cannot alter prototypes; invalid cursors cannot enter the journal', (t) => {
  const { store: s } = fixture(t);
  s.dispatch({ ...arrival, id: '__proto__' }, 0);
  s.dispatch({ ...observe(1, '__proto__'), animal: '__proto__' }, 0);
  assert.ok(Object.hasOwn(s.snapshot().animals, '__proto__'));
  assert.ok(Object.hasOwn(s.snapshot().cursors, '__proto__'));
  for (const cursor of [-1, NaN, Infinity, 1.1, '1']) {
    assert.throws(() => s.dispatch({ ...observe(cursor), animal: '__proto__' }, 0), /invalid activity/);
  }
  assert.equal(s.snapshot().seq, 2);
});

test('failed append blocks further writes until the store is reopened', (t) => {
  const f = fixture(t);
  const journal = path.join(f.dir, 'animal-events.jsonl');
  fs.mkdirSync(journal);
  assert.throws(() => f.store.dispatch(arrival, 0));
  assert.throws(() => f.store.dispatch(arrival, 1), /needs recovery/);
  fs.rmdirSync(journal);
  f.reopen();
  assert.equal(f.store.snapshot().seq, 0);
});
