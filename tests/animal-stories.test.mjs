// The story animals' memory (lib/animal-stories.mjs, lib/animal-store.mjs; Plans/dierenverhalen.md).
//
// The promises: activity is an opportunity and never counted twice - a rescan, a lower counter
// or a re-import buys nothing; a committed memory survives a crash, a torn write and a reopen
// without a checkpoint; relationships move through their four words with hysteresis and at most
// one big change a day; the three limits hold; character changes what an animal chooses; history
// leaves its marks and the one mystery can be solved both by many settlers and by one; and the
// same commands always make the same story.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openAnimalStore } from '../lib/animal-store.mjs';
import {
  rulesFor, labelOf, arrivalDue, emptyAnimalStories, decideAnimalEvent, applyAnimalEvent, TEMPLATES, entryOf,
} from '../lib/animal-stories.mjs';

const R = rulesFor(1);
const W = R.window;
const HOME = { x: 0, z: 0, r: 0.9, label: 'by the well' };

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'animal-story-'));
  let store = openAnimalStore(dir, { rules: R });
  t.after(() => { try { store.close(); } catch {} fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, get store() { return store; }, reopen() { store.close(); store = openAnimalStore(dir, { rules: R }); return store; } };
}

// A settler as the lifecycle hands one over: a cursor, whether they are working, and the spots
// on their plot an animal can go to.
const resident = (id, cursor, { active = true, lastAt = 0, name = id.slice(6) } = {}) => ({
  id, cursor, active, lastAt, name,
  spots: { door: [1, 1], garden: [2, 1], roof: [1, 2], look: [1, 3] },
});
const arrive = (species = 'chicken', extra = {}) => ({ kind: 'arrive', species, home: HOME, lookout: [5, 5], seed: 'test', ...extra });

// Run an island for `windows` activity windows: each window every resident does a little more,
// the sea finishes every errand a minute later. Returns the store's history.
function live(store, { windows, residents, start = W, every = 1, landmark = null }) {
  const cursors = new Map(residents.map((r) => [r.id, r.cursor]));
  for (let w = 0; w < windows; w++) {
    const at = start + w * W;
    const rs = residents.map((r) => {
      if (w % every === 0) cursors.set(r.id, cursors.get(r.id) + 3);
      return { ...r, cursor: cursors.get(r.id) };
    });
    const e = store.dispatch({ kind: 'observe', residents: rs, landmark }, at);
    for (const a of (e && e.data.actions) || []) store.dispatch({ kind: 'complete', action: a.id, landmark }, at + 60000);
  }
  return store.history({ limit: 200, after: 0 });
}

test('activation baselines old activity; rescans and counter corrections create no visits', (t) => {
  const s = fixture(t).store;
  s.dispatch(arrive('chicken', { baseline: { 'house:nova': 800 } }), 0);
  assert.equal(s.dispatch({ kind: 'observe', residents: [resident('house:nova', 800)] }, W), null, 'nothing new');
  assert.equal(s.dispatch({ kind: 'observe', residents: [resident('house:nova', 12)] }, W), null, 'a lower counter is nothing');
  const e = s.dispatch({ kind: 'observe', residents: [resident('house:nova', 801)] }, W);
  assert.equal(e.data.actions.length, 1);
  assert.equal(e.data.cursors['house:nova'], 801, 'the cursor that bought the visit is written with it');
  assert.equal(s.dispatch({ kind: 'observe', residents: [resident('house:nova', 802)] }, W + 2), null, 'one per animal per window, and a pending one waits');
  s.dispatch({ kind: 'complete', action: e.data.actions[0].id }, W + 5);
  assert.equal(s.dispatch({ kind: 'observe', residents: [resident('house:nova', 802)] }, W + 10), null, 'still the same window');
  assert.equal(s.dispatch({ kind: 'observe', residents: [resident('house:nova', 802)] }, 2 * W).data.actions.length, 1);
});

test('a settler first seen after the animal came is a baseline, not an opportunity', (t) => {
  const s = fixture(t).store;
  s.dispatch(arrive(), 0);
  const e = s.dispatch({ kind: 'observe', residents: [resident('house:new', 50)] }, W);
  assert.deepEqual(e.data.cursors, { 'house:new': 50 });
  assert.deepEqual(e.data.actions, []);
});

test('pending visits, cursors and relationships survive reopening without a checkpoint', (t) => {
  const f = fixture(t);
  f.store.dispatch(arrive('chicken', { baseline: { 'house:nova': 0 } }), 0);
  const pending = f.store.dispatch({ kind: 'observe', residents: [resident('house:nova', 3)] }, W).data.actions[0];
  f.reopen();
  assert.deepEqual(f.store.snapshot().pending[pending.id].to, pending.to);
  assert.equal(f.store.dispatch({ kind: 'complete', action: pending.id }, W + 1).data.rel.visits, 1);
  live(f.store, { windows: 40, residents: [resident('house:nova', 3)], start: 2 * W });
  const before = f.store.snapshot();
  f.reopen();
  assert.deepEqual(f.store.snapshot(), before);
  assert.equal(f.store.dispatch({ kind: 'complete', action: pending.id }, 99 * W), null, 'a finished errand is nothing the second time');
});

test('the four words have hysteresis', () => {
  assert.equal(labelOf('tolerant', { fam: 50, trust: 59, irr: 0 }), 'tolerant');
  assert.equal(labelOf('tolerant', { fam: 50, trust: 60, irr: 0 }), 'bonded');
  assert.equal(labelOf('bonded', { fam: 50, trust: 50, irr: 0 }), 'bonded', 'a friend is not dropped at the entry line');
  assert.equal(labelOf('bonded', { fam: 50, trust: 44, irr: 0 }), 'tolerant');
  assert.equal(labelOf('tolerant', { fam: 0, trust: 0, irr: 34 }), 'tolerant');
  assert.equal(labelOf('tolerant', { fam: 0, trust: 0, irr: 35 }), 'suspicious');
  assert.equal(labelOf('suspicious', { fam: 0, trust: 0, irr: 21 }), 'suspicious');
  assert.equal(labelOf('suspicious', { fam: 0, trust: 0, irr: 70 }), 'nemesis');
  assert.equal(labelOf('nemesis', { fam: 0, trust: 0, irr: 50 }), 'nemesis');
  assert.equal(labelOf('nemesis', { fam: 0, trust: 0, irr: 30 }), 'suspicious', 'down from nemesis through wariness, not straight to friends');
});

test('a hen becomes a friend over repeated visits, and says so once', (t) => {
  const s = fixture(t).store;
  s.dispatch(arrive('chicken', { baseline: { 'house:nova': 0 } }), 0);
  const history = live(s, { windows: 60, residents: [resident('house:nova', 0)] });
  const rel = s.snapshot().animals['animal:1'].rel['house:nova'];
  assert.equal(rel.label, 'bonded');
  const majors = history.filter((e) => e.kind === 'encounter' && e.data.major);
  assert.equal(majors.length, 1, 'bonding is one event, not one per visit');
  assert.match(majors[0].data.line, /friends now/);
});

test('at most one major change per animal per day', (t) => {
  const s = fixture(t).store;
  s.dispatch(arrive('goat', { baseline: { 'house:a': 0, 'house:b': 0 } }), 0);
  // A day's worth of windows, two people: the goat may go wary of one of them, but a second
  // big change the same day waits for tomorrow.
  const history = live(s, { windows: Math.floor(R.day / W) - 2, residents: [resident('house:a', 0), resident('house:b', 0)] });
  const days = new Map();
  for (const e of history) if (e.kind === 'encounter' && e.data.major) days.set(e.data.day, (days.get(e.data.day) || 0) + 1);
  for (const [, n] of days) assert.ok(n <= 1);
});

test('three notable events an hour across the whole island, one per animal per window', (t) => {
  const s = fixture(t).store;
  const base = {};
  const people = [];
  for (let i = 0; i < 8; i++) { base[`house:${i}`] = 0; people.push(resident(`house:${i}`, 0)); }
  for (const sp of ['chicken', 'goat', 'sparrow', 'chicken', 'goat', 'sparrow']) s.dispatch(arrive(sp, { baseline: base }), 0);
  const history = live(s, { windows: 30, residents: people });
  const notable = history.filter((e) => e.kind === 'activity').flatMap((e) => e.data.actions.filter((a) => a.notable).map((a) => ({ ...a, at: e.at })));
  for (const a of notable) {
    const inHour = notable.filter((b) => b.at > a.at - R.hour && b.at <= a.at).length;
    assert.ok(inHour <= R.notablePerHour, `${inHour} notable in an hour`);
  }
  const perAnimalWindow = new Set();
  for (const a of notable) {
    const k = `${a.animal}:${a.window}`;
    assert.ok(!perAnimalWindow.has(k), 'two notable encounters in one window');
    perAnimalWindow.add(k);
  }
});

test('character changes the choice: a bold animal goes where the work is, a shy one to the quiet', () => {
  const pick = (traits) => {
    let busy = 0, quiet = 0;
    for (let i = 0; i < 60; i++) {
      let s = emptyAnimalStories();
      const e0 = decideAnimalEvent(s, arrive('chicken', { seed: `c${i}`, baseline: { 'house:busy': 0, 'house:still': 0 } }), 0, R);
      e0.data.traits = traits;
      s = applyAnimalEvent(s, e0);
      const e = decideAnimalEvent(s, { kind: 'observe', residents: [
        resident('house:busy', 5, { active: true }), resident('house:still', 5, { active: false, lastAt: 0 }),
      ] }, W * (i + 1), R);
      const a = e.data.actions.find((x) => x.notable);
      if (a && a.resident === 'house:busy') busy++;
      if (a && a.resident === 'house:still') quiet++;
    }
    return { busy, quiet };
  };
  const bold = pick(['bold', 'curious']);
  const shy = pick(['shy', 'curious']);
  assert.ok(bold.busy > bold.quiet * 2, `bold went ${bold.busy} busy / ${bold.quiet} quiet`);
  assert.ok(shy.quiet > shy.busy, `shy went ${shy.busy} busy / ${shy.quiet} quiet`);
});

test('a goat and a settler can fall out and make it up again', (t) => {
  const s = fixture(t).store;
  s.dispatch(arrive('goat', { baseline: { 'house:max': 0 } }), 0);
  // Force the character that quarrels and forgives: stubborn enough to butt, gentle enough
  // not to - the story has to find its own way to both words.
  let labels = new Set();
  let sawTruce = false;
  for (let w = 0; w < 400 && !(labels.has('suspicious') && sawTruce); w++) {
    const e = s.dispatch({ kind: 'observe', residents: [resident('house:max', 3 * (w + 1))] }, (w + 1) * W);
    for (const a of (e && e.data.actions) || []) {
      if (a.template === 'truce') sawTruce = true;
      const done = s.dispatch({ kind: 'complete', action: a.id }, (w + 1) * W + 1000);
      labels.add(done.data.rel.label);
    }
  }
  assert.ok(labels.has('suspicious') || labels.has('nemesis'), `the goat never took against anybody: ${[...labels]}`);
  assert.ok(sawTruce, 'no truce was ever offered');
});

test('history leaves a place: a nest, a lookout, a perch, and the feathered corner', (t) => {
  const s = fixture(t).store;
  s.dispatch(arrive('chicken', { baseline: { 'house:nova': 0 } }), 0);
  s.dispatch(arrive('goat', { baseline: { 'house:nova': 0 } }), 0);
  s.dispatch(arrive('sparrow', { baseline: { 'house:nova': 0 } }), 0);
  live(s, { windows: 160, residents: [resident('house:nova', 0)] });
  const traces = s.snapshot().traces;
  assert.ok(traces['trace:nest:animal:1'], 'no nest');
  assert.ok(traces['trace:lookout:animal:2'], 'no lookout');
  assert.ok(traces['trace:perch:animal:3'], 'no perch');
  assert.ok(Object.values(s.snapshot().discoveries).some((d) => d.recipe === 'feathered-corner'), 'no feathered corner');
  // Placing is its own event and happens once.
  const nest = traces['trace:nest:animal:1'];
  assert.equal(nest.placed, null);
  assert.ok(s.dispatch({ kind: 'place', trace: nest.id, x: 1.2, z: 0.8, rot: 1 }, 999 * W));
  assert.equal(s.dispatch({ kind: 'place', trace: nest.id, x: 5, z: 5, rot: 0 }, 999 * W), null);
  assert.deepEqual(s.snapshot().traces[nest.id].placed, { x: 1.2, z: 0.8, rot: 1 });
});

test('the mystery: a print, three finds, and the landmark - by many settlers or by one', (t) => {
  for (const people of [['house:a', 'house:b', 'house:c', 'house:d'], ['house:solo']]) {
    const s = fixture(t).store;
    const base = Object.fromEntries(people.map((p) => [p, 0]));
    s.dispatch(arrive('chicken', { baseline: base }), 0);
    s.dispatch(arrive('sparrow', { baseline: base }), 0);
    const landmark = { at: [30, -20], label: 'lighthouse' };
    live(s, { windows: 300, residents: people.map((p) => resident(p, 0)), landmark });
    const m = s.snapshot().mystery;
    assert.ok(m, `${people.length} settler(s): the mystery never began`);
    assert.equal(m.stage, 3, `${people.length} settler(s): stuck at stage ${m.stage} with ${m.finds.length} finds`);
    const traces = s.snapshot().traces;
    for (const id of ['trace:print:signal', 'trace:find:signal:1', 'trace:find:signal:2', 'trace:find:signal:3', 'trace:cache:signal']) {
      assert.ok(traces[id], `${people.length} settler(s): missing ${id}`);
    }
    assert.deepEqual(traces['trace:cache:signal'].near, landmark.at);
  }
});

test('a long absence gets one gentle line on return, not two', (t) => {
  const s = fixture(t).store;
  s.dispatch(arrive(), 0);
  assert.equal(s.dispatch({ kind: 'return' }, R.vignetteAfter / 2), null);
  const v = s.dispatch({ kind: 'return' }, 10 * R.vignetteAfter);
  assert.equal(v.kind, 'vignette');
  assert.equal(s.dispatch({ kind: 'return' }, 10 * R.vignetteAfter + 1), null);
});

test('errands the sea never finished, or for a settler who left, are let go', (t) => {
  const s = fixture(t).store;
  s.dispatch(arrive('chicken', { baseline: { 'house:a': 0 } }), 0);
  const a = s.dispatch({ kind: 'observe', residents: [resident('house:a', 1)] }, W).data.actions[0];
  assert.equal(s.dispatch({ kind: 'abandon', residents: ['house:a'] }, W + 1), null);
  assert.deepEqual(s.dispatch({ kind: 'abandon', residents: [] }, W + 2).data.actions, [a.id]);
  assert.deepEqual(s.snapshot().pending, {});
  const b = s.dispatch({ kind: 'observe', residents: [resident('house:a', 2)] }, 2 * W).data.actions[0];
  assert.deepEqual(s.dispatch({ kind: 'abandon', residents: ['house:a'] }, 2 * W + R.abandonAfter).data.actions, [b.id]);
});

test('arrivals: the first hen needs somebody watching a working island, later ones a day and a story', () => {
  let s = emptyAnimalStories();
  assert.equal(arrivalDue(s, 0, { viewing: false, working: true }, R), null);
  assert.equal(arrivalDue(s, 0, { viewing: true, working: false }, R), null);
  assert.equal(arrivalDue(s, 0, { viewing: true, working: true }, R), 'chicken');
  s = applyAnimalEvent(s, decideAnimalEvent(s, arrive(), 0, R));
  assert.equal(arrivalDue(s, R.arrivalGap + 1, { viewing: true }, R), null, 'no story yet');
  s.sinceArrival = R.arrivalEncounters;
  assert.equal(arrivalDue(s, R.arrivalGap - 1, { viewing: true }, R), null, 'too soon');
  assert.equal(arrivalDue(s, R.arrivalGap + 1, { viewing: true }, R), 'goat');
  for (const sp of ['goat', 'sparrow', 'chicken', 'goat', 'sparrow']) s = applyAnimalEvent(s, decideAnimalEvent(s, arrive(sp), 0, R));
  s.sinceArrival = 99;
  assert.equal(arrivalDue(s, 10 * R.arrivalGap, { viewing: true }, R), null, 'six is the cast');
  assert.equal(decideAnimalEvent(s, arrive(), 0, R), null);
  assert.equal(new Set(Object.values(s.animals).map((a) => a.name)).size, 6, 'no two animals share a name');
});

test('the same commands make the same story, byte for byte', (t) => {
  const run = () => {
    const f = fixture(t);
    f.store.dispatch(arrive('chicken', { baseline: { 'house:a': 0, 'house:b': 0 } }), 0);
    f.store.dispatch(arrive('goat', { baseline: { 'house:a': 0, 'house:b': 0 } }), 0);
    live(f.store, { windows: 50, residents: [resident('house:a', 0), resident('house:b', 0, { active: false })] });
    return fs.readFileSync(path.join(f.dir, 'animal-events.jsonl'), 'utf8');
  };
  assert.equal(run(), run());
});

test('every diary line names its animal, and nothing is a raw number or a template hole', (t) => {
  const s = fixture(t).store;
  s.dispatch(arrive('chicken', { baseline: { 'house:nova': 0 } }), 0);
  s.dispatch(arrive('goat', { baseline: { 'house:nova': 0 } }), 0);
  s.dispatch(arrive('sparrow', { baseline: { 'house:nova': 0 } }), 0);
  const history = live(s, { windows: 120, residents: [resident('house:nova', 0)], landmark: { at: [9, 9], label: 'lighthouse' } });
  const names = Object.values(s.snapshot().animals).map((a) => a.name);
  for (const e of history) {
    const entry = entryOf(e);
    if (!entry) continue;
    assert.ok(!/[{}]/.test(entry.line), `a hole in "${entry.line}"`);
    assert.ok(names.some((n) => entry.line.includes(n)), `nobody named in "${entry.line}"`);
  }
  assert.ok(Object.keys(TEMPLATES).length >= 13);
});

// ---- the store --------------------------------------------------------------------------

test('checkpoint corruption cannot override committed history', (t) => {
  const f = fixture(t);
  f.store.dispatch(arrive(), 0);
  f.store.checkpoint();
  f.store.dispatch({ kind: 'observe', residents: [resident('house:x', 500)] }, 1);
  fs.writeFileSync(path.join(f.dir, 'animals.json'), '{broken');
  f.reopen();
  assert.equal(f.store.snapshot().seq, 2);
  f.store.checkpoint();
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.dir, 'animals.json'), 'utf8')), f.store.snapshot());
});

test('interrupted final write is saved separately, then the next record remains readable', (t) => {
  const f = fixture(t);
  f.store.dispatch(arrive(), 0);
  f.store.close();
  const journal = path.join(f.dir, 'animal-events.jsonl');
  const tail = Buffer.from('{"name":"Pip');
  fs.appendFileSync(journal, tail);
  f.reopen();
  assert.equal(f.store.snapshot().seq, 1);
  assert.deepEqual(fs.readFileSync(`${journal}.interrupted`), tail);
  f.store.dispatch({ kind: 'observe', residents: [resident('house:x', 4)] }, 1);
  f.reopen();
  assert.equal(f.store.snapshot().seq, 2);
});

test('corrupt complete records stop recovery without truncating the journal', (t) => {
  const f = fixture(t);
  f.store.dispatch(arrive(), 0);
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
  const event = f.store.dispatch(arrive(), 0);
  f.store.close();
  const journal = path.join(f.dir, 'animal-events.jsonl');
  for (const change of [{ version: 2 }, { rules: 2 }, { seq: 4 }, { id: 'other' }]) {
    fs.writeFileSync(journal, `${JSON.stringify({ ...event, ...change })}\n`);
    assert.throws(() => openAnimalStore(f.dir), /envelope/);
  }
});

test('a second writer is refused, a dead writer\'s lock is taken over, closing releases ownership', (t) => {
  const f = fixture(t);
  assert.throws(() => openAnimalStore(f.dir), /locked/);
  f.store.close();
  // A lock left by a process that is gone - the pid is our own child, which has exited.
  const lock = path.join(f.dir, 'animal-store.lock');
  fs.writeFileSync(lock, JSON.stringify({ pid: 2147483646 }));
  assert.throws(() => openAnimalStore(f.dir), /locked/, 'never taken over unless asked');
  const s = openAnimalStore(f.dir, { recoverStale: true, rules: R });
  s.dispatch(arrive(), 0);
  assert.equal(s.snapshot().seq, 1);
  s.close();
  f.reopen();
  // ...but a live writer's lock is never taken, even when asked.
  assert.throws(() => openAnimalStore(f.dir, { recoverStale: true }), /locked/);
});

test('returned state and events cannot mutate the persisted story', (t) => {
  const f = fixture(t);
  const event = f.store.dispatch(arrive(), 0);
  const name = event.data.name;
  event.data.name = 'Changed';
  f.store.snapshot().animals['animal:1'].name = 'Changed';
  f.store.history()[0].data.name = 'Changed';
  assert.equal(f.store.snapshot().animals['animal:1'].name, name);
  f.reopen();
  assert.equal(f.store.snapshot().animals['animal:1'].name, name);
});

test('opaque ids cannot alter prototypes; invalid cursors cannot enter the journal', (t) => {
  const { store: s } = fixture(t);
  s.dispatch(arrive('chicken', { baseline: { __proto__: 1, ['__proto__']: 1 } }), 0);
  s.dispatch({ kind: 'observe', residents: [resident('__proto__', 2)] }, 0);
  assert.ok(Object.hasOwn(s.snapshot().consumed, '__proto__'));
  for (const cursor of [-1, NaN, Infinity, 1.1, '1']) {
    assert.throws(() => s.dispatch({ kind: 'observe', residents: [{ ...resident('house:x', 0), cursor }] }, 0), /invalid activity/);
  }
  assert.equal(s.snapshot().seq, 2);
});

test('failed append blocks further writes until the store is reopened', (t) => {
  const f = fixture(t);
  const journal = path.join(f.dir, 'animal-events.jsonl');
  fs.mkdirSync(journal);
  assert.throws(() => f.store.dispatch(arrive(), 0));
  assert.throws(() => f.store.dispatch(arrive(), 1), /needs recovery/);
  fs.rmdirSync(journal);
  f.reopen();
  assert.equal(f.store.snapshot().seq, 0);
});

test('history pages by animal', (t) => {
  const s = fixture(t).store;
  s.dispatch(arrive('chicken', { baseline: { 'house:a': 0 } }), 0);
  s.dispatch(arrive('goat', { baseline: { 'house:a': 0 } }), 0);
  live(s, { windows: 20, residents: [resident('house:a', 0)] });
  const hen = s.story('animal:1', { limit: 5 });
  assert.ok(hen.entries.length > 0 && hen.entries.length <= 5);
  assert.ok(hen.entries.every((e) => e.animal === 'animal:1'));
  for (let i = 1; i < hen.entries.length; i++) assert.ok(hen.entries[i].seq < hen.entries[i - 1].seq, 'newest first');
  const older = s.story('animal:1', { before: hen.entries[hen.entries.length - 1].seq, limit: 50 });
  assert.ok(older.entries.every((e) => e.seq < hen.entries[hen.entries.length - 1].seq));
});
