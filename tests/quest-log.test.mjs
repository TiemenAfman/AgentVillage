// The quest book in the browser (web/js/quest-log.js): the reducer's state and the map in hand
// kept in localStorage, and the words an event earns. Storage is a stub with a Map behind it,
// because the whole point is what happens when the real one is empty, broken or refuses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

// DOM-free, like the animal panel's helpers: the moment this import needs a stub, that stopped
// being true and the page's main.js is no longer the only thing that can touch the storage.
assert.equal(globalThis.document, undefined);
const L = await import('../web/js/quest-log.js');
const { isletsNear } = await import('../shared/islets.mjs');
const { cardOf, FIRST_HUNT_SEED, UNLOCK_IDS } = await import('../shared/treasure.mjs');
const { QUESTS } = await import('../shared/quests.mjs');

const memory = (init = {}) => {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
};
const FLEET = [
  { id: '0000000000000000', origin: [0, 0], gridSize: 192, reach: 96, volcano: true },
  { id: 'a', origin: [336, 0], gridSize: 64, reach: 192 },
];
const ISLETS = isletsNear(FLEET, [0, 0], { range: 1500 });
const CARD = cardOf(FIRST_HUNT_SEED('a'), 'a', { candidates: ISLETS, berth: [336, 0] });
assert.ok(CARD, 'the fixture fleet has an islet to point at');

// A book with the unlocks recorded and a map maker that counts its calls.
function book(storage = memory(), extra = {}) {
  const unlocked = [];
  const calls = [];
  const log = L.createQuestLog({
    storage,
    unlock: (id) => unlocked.push(id),
    cardFor: (name) => { calls.push(name); return CARD; },
    ...extra,
  });
  return { log, unlocked, calls, storage };
}
const TALK = { type: 'talked', with: 'pirate' };

test('a new book starts on the first quest, holds no map and keeps nothing until something happens', () => {
  const { log, storage } = book();
  const v = log.view();
  assert.equal(v.active.id, 'first-dig');
  assert.equal(v.active.index, 0);
  assert.equal(v.active.talk, 'pirate');
  assert.equal(v.active.giver, 'pirate');
  assert.deepEqual(v.repeating, [], 'no day\'s chest to speak of before the first dig');
  assert.deepEqual(v.done, []);
  assert.equal(v.card, null);
  assert.equal(storage.m.size, 0);
});

test('talking to the pirate unlocks the shovel, hands over the first map and remembers both', () => {
  const { log, unlocked, calls, storage } = book();
  const r = log.applyEvent(TALK);
  assert.deepEqual(unlocked, ['shovel']);
  assert.deepEqual(calls, ['first-hunt']);
  assert.equal(r.cardMade, true);
  assert.equal(log.card().grid, CARD.grid);
  assert.ok(r.lines.some((l) => /map/.test(l)), r.lines.join('|'));
  assert.ok(r.lines.some((l) => /Unlocked: Shovel/.test(l)), r.lines.join('|'));
  const kept = JSON.parse(storage.getItem(L.QUESTS_KEY));
  assert.equal(kept.step, 1);
  assert.equal(JSON.parse(storage.getItem(L.FINDS_KEY)).card.isletId, CARD.isletId);
});

test('a new page reads the book back: the step, the map, and it gives the unlocks again', () => {
  const a = book();
  a.log.applyEvent(TALK);
  const b = book(a.storage);
  assert.equal(b.log.view().active.index, 1);
  assert.equal(b.log.card().seed, CARD.seed);
  b.log.sync();
  assert.deepEqual(b.unlocked, ['shovel']);
});

test('an event that is not the step changes and writes nothing, and says nothing', () => {
  const { log, storage, unlocked } = book();
  const r = log.applyEvent({ type: 'delivered', kind: 'statue' });
  assert.deepEqual(r.lines, []);
  assert.equal(storage.m.size, 0);
  assert.deepEqual(unlocked, []);
  assert.deepEqual(log.applyEvent('nonsense').lines, []);
  assert.deepEqual(log.applyEvent(null).lines, []);
});

test('the whole chain through the page-facing calls, each step saying its next goal', () => {
  const { log, unlocked } = book();
  log.onTalked('pirate');
  const dug = log.onDug('statue');
  assert.equal(dug.gained.questDone, 'first-dig');
  assert.equal(log.card(), null, 'digging uses the map up');
  assert.ok(dug.lines[0].startsWith('Quest done: The First Dig'), dug.lines.join('|'));
  assert.ok(dug.lines.some((l) => /New quest: Bring It Home/.test(l)));
  assert.match(log.onLifted().lines[0], /Put the statue on your boat/);
  assert.match(log.onBoarded().lines[0], /Stand the statue in your town/);
  assert.match(log.onDelivered().lines[0], /Tell the pirate/);
  assert.equal(log.view().active.talk, 'pirate');
  const done = log.onTalked('pirate');
  assert.equal(done.gained.questDone, 'bring-it-home');
  assert.deepEqual(unlocked, ['shovel', 'sea-green']);
  const v = log.view();
  assert.deepEqual(v.done.map((q) => q.id), ['first-dig', 'bring-it-home']);
  assert.deepEqual(v.done[1].rewards, ['Sea green']);
  // The story goes on into the Salty Kraken, and the day's chest counts alongside it.
  assert.equal(v.active.id, 'a-round-for-the-crew');
  assert.equal(v.active.repeat, false);
  assert.equal(v.active.talk, 'captain');
  assert.equal(log.businessWith(), 'captain');
  assert.deepEqual(v.repeating.map((q) => q.id), ['treasure-of-the-day']);
  assert.match(log.onTalked('captain').lines[0], /Order a drink at the bar of the Salty Kraken/);
  assert.equal(log.onDrank('tavern').lines.length, 0, 'the village tavern is not the Kraken');
  assert.match(log.onDrank('piratetavern').lines[0], /Tell the Captain/);
  const round = log.onTalked('captain');
  assert.equal(round.gained.questDone, 'a-round-for-the-crew');
  assert.ok(round.lines.some((l) => /Unlocked: Kraken purple/.test(l)));
  assert.equal(log.businessWith(), 'navigator');
  log.onTalked('navigator');
  assert.equal(log.onDived(1.2).lines.length, 0);
  assert.match(log.onDived(2.4).lines[0], /Tell Quill/);
});

test('a chest dug in the repeatable quest counts and clears the map', () => {
  const { log } = book();
  log.onTalked('pirate'); log.onDug('statue'); log.onLifted(); log.onBoarded(); log.onDelivered(); log.onTalked('pirate');
  log.setCard(CARD);
  const r = log.onDug('chest');
  assert.equal(r.gained.questDone, 'treasure-of-the-day');
  assert.equal(log.card(), null);
  // Counted beside the story, which still waits on the captain.
  assert.equal(log.view().active.id, 'a-round-for-the-crew');
  assert.equal(log.view().repeating[0].times, 1);
  assert.match(r.lines[0], /Quest done: Treasure of the Day/);
});

test('a chest that is also a step of Three Chests says both', () => {
  const { log } = book();
  log.onTalked('pirate'); log.onDug('statue'); log.onLifted(); log.onBoarded(); log.onDelivered(); log.onTalked('pirate');
  for (const ev of [{ type: 'talked', with: 'captain' }, { type: 'drank', where: 'piratetavern' }, { type: 'talked', with: 'captain' },
    { type: 'talked', with: 'navigator' }, { type: 'dived', depth: 2 }, { type: 'talked', with: 'navigator' }, { type: 'talked', with: 'bosun' }]) log.applyEvent(ev);
  log.onDug('chest'); log.onDug('chest');
  const third = log.onDug('chest');
  assert.ok(third.lines.some((l) => /Three Chests: Report to Bosun Tarr/.test(l)), third.lines.join('|'));
  assert.ok(third.lines.some((l) => /Treasure of the Day: done 3×/.test(l)), third.lines.join('|'));
});

test('the map is owed, not lost: no fleet yet means none now and one as soon as there is', () => {
  let ready = false;
  const { log } = book(memory(), { cardFor: () => (ready ? CARD : null) });
  const r = log.onTalked('pirate');
  assert.equal(r.cardMade, false);
  assert.equal(log.card(), null);
  assert.equal(log.ensureCard(), false);
  ready = true;
  assert.equal(log.ensureCard(), true);
  assert.equal(log.card().grid, CARD.grid);
  assert.equal(log.ensureCard(), false, 'asked again with a map in hand it does nothing');
});

test('no map is made on a step that does not dig for the statue', () => {
  const { log, calls } = book();
  assert.equal(log.ensureCard(), false);
  assert.deepEqual(calls, []);
});

test('a map from the chest side is kept beside its other keys, and they survive every write', () => {
  const s = memory({ [L.FINDS_KEY]: JSON.stringify({ v: 1, found: ['captain-red'], purse: 3 }) });
  const { log } = book(s);
  log.setCard(CARD);
  log.onTalked('pirate');
  log.clearCard();
  const kept = JSON.parse(s.getItem(L.FINDS_KEY));
  assert.deepEqual(kept, { v: 1, found: ['captain-red'], purse: 3 });
  log.setCard(CARD);
  assert.equal(JSON.parse(s.getItem(L.FINDS_KEY)).card.grid, CARD.grid);
});

test('a bare list in the finds key is carried along as `found`', () => {
  const s = memory({ [L.FINDS_KEY]: JSON.stringify(['a', 'b']) });
  const { log } = book(s);
  log.setCard(CARD);
  assert.deepEqual(JSON.parse(s.getItem(L.FINDS_KEY)).found, ['a', 'b']);
});

test('broken storage is an empty book: junk, a newer version, a card that is not one', () => {
  for (const bad of ['{{{', '"x"', '[]', 'null', '42', JSON.stringify({ v: 99, done: ['first-dig', 'bring-it-home'] })]) {
    const { log } = book(memory({ [L.QUESTS_KEY]: bad, [L.FINDS_KEY]: bad }));
    assert.equal(log.view().active.id, 'first-dig', bad);
    assert.equal(log.card(), null, bad);
    assert.doesNotThrow(() => log.onTalked('pirate'));
  }
  const cards = [
    { ...CARD, spot: { x: NaN, z: 0 } }, { ...CARD, grid: 'Z9' }, { ...CARD, status: 'dreaming' },
    { ...CARD, isletId: '' }, { ...CARD, seed: 5 }, { ...CARD, spot: null }, [], 'x', 7,
    { ...CARD, spot: { x: 1e9, z: 0 } },
  ];
  for (const c of cards) assert.equal(L.parseCard(c), null, JSON.stringify(c));
  assert.deepEqual(L.parseCard({ ...CARD, extra: 1 }), L.parseCard(CARD), 'unknown keys are dropped');
});

test('a storage that throws on every call still gives a working book for this page', () => {
  const angry = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  const { log } = book(angry);
  assert.doesNotThrow(() => log.onTalked('pirate'));
  assert.equal(log.view().active.index, 1);
  assert.equal(log.card().grid, CARD.grid);
});

test('the default storage falls back to memory when localStorage is not there', () => {
  const s = L.defaultStorage();
  s.setItem('k', 'v');
  assert.equal(s.getItem('k'), 'v');
  assert.equal(s.getItem('missing'), null);
});

test('an asleep map is remembered as asleep, and wakes', () => {
  const { log, storage } = book();
  log.setCard(CARD);
  assert.equal(log.setStatus('asleep'), true);
  assert.equal(log.view().card.asleep, true);
  assert.equal(JSON.parse(storage.getItem(L.FINDS_KEY)).card.status, 'asleep');
  assert.equal(log.setStatus('asleep'), false, 'no change, no write');
  assert.equal(log.setStatus('nap'), false);
  assert.equal(log.setStatus('awake'), true);
  assert.equal(log.view().card.asleep, false);
});

test('onChange fires when the book changes and never when it does not; a throwing listener is harmless', () => {
  let n = 0;
  const { log } = book(memory(), { onChange: () => { n++; throw new Error('panel'); } });
  log.applyEvent({ type: 'lifted', kind: 'statue' });
  assert.equal(n, 0);
  log.onTalked('pirate');
  assert.ok(n >= 1);
});

test('every unlock a quest can give has a name for the toast', () => {
  for (const q of QUESTS) {
    for (const st of q.steps) for (const u of (st.grant?.unlock || [])) assert.notEqual(L.unlockName(u), u, u);
    for (const u of (q.reward?.unlock || [])) assert.notEqual(L.unlockName(u), u, u);
  }
  for (const id of UNLOCK_IDS) assert.ok(L.UNLOCK_NAMES[id], id);
});

test('an unlock() that throws does not stop the story', () => {
  const { log } = book(memory(), { unlock: () => { throw new Error('tile'); } });
  assert.doesNotThrow(() => log.onTalked('pirate'));
  assert.equal(log.view().active.index, 1);
});

test('the module is DOM-free and never reaches into the page, and takes its rules from shared/', () => {
  const src = readFileSync(new URL('../web/js/quest-log.js', import.meta.url), 'utf8');
  assert.ok(!/\bdocument\./.test(src.replace(/\/\/.*$/gm, '')), 'quest-log.js touches document');
  assert.ok(!/\bfetch\(/.test(src), 'quest-log.js reaches the network');
  assert.match(src, /from 'shared\/quests\.mjs'/);
});
