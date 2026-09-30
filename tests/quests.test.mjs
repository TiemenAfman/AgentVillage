// The pirate's quest chain: data plus one reducer, with a state that lives in localStorage and
// therefore has to survive being empty, half-written, edited by hand or written by a newer page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  QUESTS, QUEST_EVENTS, QUEST_STATE_V, advance, activeQuest, activeStep, parseQuestState,
  unlocksOf, completedQuests, timesDone, pirateHasBusiness,
} from '../shared/quests.mjs';
import { UNLOCK_IDS } from '../shared/treasure.mjs';

const fresh = () => parseQuestState(null);
const run = (state, ...events) => events.reduce((s, e) => advance(s, e).state, state);
const TALK = { type: 'talked', with: 'pirate' };
const STATUE = (type) => ({ type, kind: 'statue' });

// ---- the data ----------------------------------------------------------------------------

test('the chain is well formed: unique ids, known events, real unlocks, repeatable last', () => {
  assert.equal(new Set(QUESTS.map((q) => q.id)).size, QUESTS.length);
  for (const q of QUESTS) {
    assert.ok(q.title && q.text, q.id);
    assert.ok(q.steps.length > 0, q.id);
    for (const s of q.steps) {
      assert.ok(QUEST_EVENTS.includes(s.on), `${q.id}: unknown event ${s.on}`);
      assert.ok(s.goal && s.text, `${q.id}: a step with no words`);
      for (const u of [...(s.grant?.unlock || [])]) assert.ok(UNLOCK_IDS.includes(u), `${q.id}: ${u} is no tile`);
    }
    for (const u of q.reward?.unlock || []) assert.ok(UNLOCK_IDS.includes(u), `${q.id}: reward ${u} is no tile`);
  }
  const firstRepeat = QUESTS.findIndex((q) => q.repeat);
  assert.ok(firstRepeat > 0 && QUESTS.slice(firstRepeat).every((q) => q.repeat), 'a repeatable quest must not stand before the end of the story');
  assert.deepEqual(QUESTS.slice(0, 3).map((q) => q.id), ['first-dig', 'bring-it-home', 'treasure-of-the-day']);
});

// ---- the story ---------------------------------------------------------------------------

test('a new player starts at the first quest and the pirate has business with them', () => {
  const s = fresh();
  assert.equal(activeQuest(s).id, 'first-dig');
  assert.equal(activeStep(s).index, 0);
  assert.ok(pirateHasBusiness(s));
  assert.deepEqual(unlocksOf(s), []);
});

test('talking to the pirate hands over the shovel and the first map, and only then can the dig count', () => {
  const r = advance(fresh(), TALK);
  assert.deepEqual(r.gained.unlocks, ['shovel']);
  assert.deepEqual(r.gained.cards, ['first-hunt']);
  assert.deepEqual(r.gained.stepDone, { quest: 'first-dig', index: 0 });
  assert.equal(r.gained.questDone, null);
  assert.deepEqual(unlocksOf(r.state), ['shovel']);
  assert.ok(!pirateHasBusiness(r.state), 'he has nothing more to say until the statue is out');
  // Digging the statue before talking to him is not remembered.
  const early = advance(fresh(), { type: 'dug', kind: 'statue' });
  assert.deepEqual(early.state, fresh());
  assert.equal(early.gained.stepDone, null);
});

test('the whole story, in order', () => {
  let s = fresh();
  let r = advance(s, TALK); s = r.state;
  r = advance(s, STATUE('dug')); s = r.state;
  assert.equal(r.gained.questDone, 'first-dig');
  assert.equal(r.gained.next, 'bring-it-home');
  assert.equal(activeQuest(s).id, 'bring-it-home');
  for (const t of ['lifted', 'boarded', 'delivered']) { r = advance(s, STATUE(t)); assert.equal(r.gained.stepDone.quest, 'bring-it-home'); s = r.state; }
  assert.ok(pirateHasBusiness(s), 'the pirate is the one to hand in to');
  assert.deepEqual(unlocksOf(s), ['shovel'], 'the colour waits for the pirate');
  r = advance(s, TALK); s = r.state;
  assert.deepEqual(r.gained.unlocks, ['sea-green']);
  assert.equal(r.gained.questDone, 'bring-it-home');
  assert.equal(activeQuest(s).id, 'treasure-of-the-day');
  assert.deepEqual(completedQuests(s).map((q) => q.id), ['first-dig', 'bring-it-home']);
  assert.deepEqual(unlocksOf(s).sort(), ['sea-green', 'shovel']);
});

test('the daily treasure comes round again and again, and counts', () => {
  let s = run(fresh(), TALK, STATUE('dug'), STATUE('lifted'), STATUE('boarded'), STATUE('delivered'), TALK);
  assert.equal(timesDone(s, 'treasure-of-the-day'), 0);
  for (let n = 1; n <= 3; n++) {
    const r = advance(s, { type: 'dug', kind: 'chest' });
    s = r.state;
    assert.equal(r.gained.questDone, 'treasure-of-the-day');
    assert.equal(activeQuest(s).id, 'treasure-of-the-day');
    assert.equal(timesDone(s, 'treasure-of-the-day'), n);
  }
  assert.deepEqual(completedQuests(s).map((q) => q.id), ['first-dig', 'bring-it-home'], 'a repeat is not a finished quest');
});

test('events out of turn, unknown events and junk change nothing', () => {
  const s = run(fresh(), TALK);
  for (const ev of [STATUE('delivered'), { type: 'dug', kind: 'chest' }, { type: 'talked', with: 'baker' }, { type: 'nonsense' },
    'lifted', null, undefined, 7, [], {}, { type: 'dug' }]) {
    const r = advance(s, ev);
    assert.deepEqual(r.state, s, JSON.stringify(ev));
    assert.equal(r.gained.stepDone, null);
    assert.deepEqual(r.gained.unlocks, []);
  }
});

test('advance leaves the state it was given alone', () => {
  const s = run(fresh(), TALK);
  const frozen = JSON.stringify(s);
  Object.freeze(s); Object.freeze(s.done); Object.freeze(s.repeats);
  advance(s, STATUE('dug'));
  assert.equal(JSON.stringify(s), frozen);
});

// ---- the state on disk -------------------------------------------------------------------

test('a state survives JSON, as a string too', () => {
  const s = run(fresh(), TALK, STATUE('dug'), STATUE('lifted'));
  assert.deepEqual(parseQuestState(JSON.parse(JSON.stringify(s))), s);
  assert.deepEqual(parseQuestState(JSON.stringify(s)), s);
  assert.deepEqual(unlocksOf(JSON.stringify(s)), ['shovel']);
});

test('a broken state is an empty one, and never throws', () => {
  const empty = fresh();
  for (const raw of [undefined, null, '', '{', 'not json', '[]', '"x"', '42', 7, true, [], [1, 2], {}, { v: 'one' }, { v: 0 }, { v: null },
    { done: ['first-dig'] }, JSON.stringify({ v: 1 }).slice(0, 5), () => 1, Symbol('x')]) {
    let got;
    assert.doesNotThrow(() => { got = parseQuestState(raw); }, String(raw));
    if (raw && typeof raw === 'object' && raw.v === undefined) assert.deepEqual(got, empty, JSON.stringify(raw));
    assert.equal(got.v, QUEST_STATE_V);
    assert.ok(Array.isArray(got.done) && Number.isInteger(got.step));
  }
  assert.deepEqual(parseQuestState('{'), empty);
  assert.deepEqual(parseQuestState({ v: 'one' }), empty);
});

test('a state from a newer page is not read as ours', () => {
  const newer = { v: QUEST_STATE_V + 1, done: ['first-dig', 'bring-it-home'], step: 0, repeats: { 'treasure-of-the-day': 9 }, extra: true };
  assert.deepEqual(parseQuestState(newer), fresh());
  assert.deepEqual(parseQuestState(JSON.stringify(newer)), fresh());
});

test('a state that is only slightly wrong is repaired, not thrown away', () => {
  // Unknown quests dropped, duplicates gone, the step held inside its quest.
  const a = parseQuestState({ v: 1, done: ['first-dig', 'first-dig', 'a-quest-from-the-future'], step: 99, repeats: { 'first-dig': 3, 'treasure-of-the-day': 2, x: 1 } });
  assert.deepEqual(a, { v: 1, done: ['first-dig'], step: 0, repeats: { 'treasure-of-the-day': 2 } });
  // A quest cannot be done before the one it follows.
  assert.deepEqual(parseQuestState({ v: 1, done: ['bring-it-home'], step: 1 }), { v: 1, done: [], step: 1, repeats: {} });
  // Steps must be whole, non-negative numbers.
  for (const step of [-1, 1.5, '1', NaN, null]) assert.equal(parseQuestState({ v: 1, done: [], step }).step, 0, String(step));
  // Counts must be sane.
  assert.deepEqual(parseQuestState({ v: 1, done: ['first-dig', 'bring-it-home'], repeats: { 'treasure-of-the-day': -4 } }).repeats, {});
});

test('what is unlocked is only what the progress supports', () => {
  // A hand-edited state cannot grant the colour by claiming a step it has not done.
  assert.deepEqual(unlocksOf({ v: 1, done: ['first-dig'], step: 3, repeats: {} }), ['shovel']);
  assert.deepEqual(unlocksOf({ v: 1, done: [], step: 0, repeats: {} }), []);
  assert.deepEqual(unlocksOf('junk'), []);
});

// ---- shared/'s rule ----------------------------------------------------------------------

test('nothing in the quests can differ between two engines', () => {
  const src = readFileSync(fileURLToPath(new URL('../shared/quests.mjs', import.meta.url)), 'utf8')
    .split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
  const banned = /Math\.(sin|cos|tan|asin|acos|atan|atan2|pow|exp|log|log2|log10|cbrt|hypot|random)\s*\(|\*\*/;
  const m = src.match(banned);
  assert.equal(m, null, `shared/quests.mjs uses ${m && m[0]}`);
  assert.ok(!/Date\.now|new Date|localStorage|window|document/.test(src), 'the quests must be pure: storage is the page\'s');
});
