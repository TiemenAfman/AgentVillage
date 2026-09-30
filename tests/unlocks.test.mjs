import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { isUnlocked, unlock, unlocked, onUnlock, resetUnlocks } from '../web/js/unlocks.js';

// A page has to work without storage, and with whatever a previous version left in it, so
// every test brings its own localStorage (or none at all).
const KEY = 'promptholm.unlocks';
const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
  };
}
function install(storage) {
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
}
beforeEach(() => resetUnlocks());
afterEach(() => {
  if (had) Object.defineProperty(globalThis, 'localStorage', had);
  else delete globalThis.localStorage;
});

test('unlock is new once, remembered, and announced once', () => {
  const store = memoryStorage();
  install(store);
  const heard = [];
  onUnlock((id) => heard.push(id));
  assert.equal(isUnlocked('shovel'), false);
  assert.equal(unlock('shovel'), true);
  assert.equal(unlock('shovel'), false);
  assert.equal(isUnlocked('shovel'), true);
  assert.deepEqual(heard, ['shovel']);
  assert.deepEqual(JSON.parse(store.data[KEY]), { v: 1, ids: ['shovel'] });
  assert.deepEqual(unlocked(), ['shovel']);
  // A fresh page (nothing in memory) finds it in storage.
  resetUnlocks();
  assert.equal(isUnlocked('shovel'), true);
  assert.equal(unlock('shovel'), false);
});

test('the listener can be taken off, and a faulty one hurts nobody', () => {
  install(memoryStorage());
  const heard = [];
  const off = onUnlock((id) => heard.push(id));
  onUnlock(() => { throw new Error('boom'); });
  unlock('a');
  off();
  unlock('b');
  assert.deepEqual(heard, ['a']);
  assert.equal(isUnlocked('b'), true);
});

test('only real ids unlock', () => {
  install(memoryStorage());
  for (const bad of [undefined, null, '', 7, {}, [], 'x'.repeat(65)]) {
    assert.equal(unlock(bad), false, String(bad));
    assert.equal(isUnlocked(bad), false, String(bad));
  }
  assert.deepEqual(unlocked(), []);
});

test('no storage at all: everything still works for the session', () => {
  delete globalThis.localStorage;   // a bare reference now throws ReferenceError
  assert.equal(isUnlocked('shovel'), false);
  assert.equal(unlock('shovel'), true);
  assert.equal(isUnlocked('shovel'), true);
  assert.equal(unlock('shovel'), false);
});

test('storage that throws is survived', () => {
  install({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); } });
  assert.equal(isUnlocked('shovel'), false);
  assert.equal(unlock('shovel'), true);
  assert.equal(isUnlocked('shovel'), true);
});

test('broken or foreign content is an empty set, and unlocking replaces it', () => {
  const junks = ['{not json', 'null', '7', '"shovel"', '[]', '{}', '{"v":1}', '{"v":1,"ids":"shovel"}', '{"v":1,"ids":[1,null,{}]}'];
  for (const junk of junks) {
    const store = memoryStorage({ [KEY]: junk });
    install(store);
    resetUnlocks();
    assert.deepEqual(unlocked(), [], junk);
    assert.equal(unlock('shovel'), true, junk);
    assert.deepEqual(JSON.parse(store.data[KEY]), { v: 1, ids: ['shovel'] }, junk);
  }
});

test('junk among the ids is dropped and the rest kept', () => {
  install(memoryStorage({ [KEY]: JSON.stringify({ v: 1, ids: ['shovel', 3, '', 'tricorn'] }) }));
  assert.deepEqual(unlocked().sort(), ['shovel', 'tricorn']);
});

test('content from a newer version reads as empty and is never overwritten', () => {
  const newer = JSON.stringify({ v: 2, ids: ['shovel', 'from-the-future'] });
  const store = memoryStorage({ [KEY]: newer });
  install(store);
  assert.equal(isUnlocked('shovel'), false);
  assert.equal(unlock('tricorn'), true);      // this session still gets it...
  assert.equal(isUnlocked('tricorn'), true);
  assert.equal(store.data[KEY], newer);        // ...but the newer page's list is left alone
});
