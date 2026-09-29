// A tent nobody has asked anything of for a long time packs up and leaves, and the village
// shrinks with it - but whatever the village had already earned stays standing, and the next
// rung waits until the village is that big again (Plans/tenten-vertrekken.md).
//
// Built on a synthetic session list rather than transcripts on disk: what is under test is
// what buildVillage makes of a session's turns and dates, and the dates are the whole point.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVillage, reachedOf, nextMilestone, MILESTONES } from '../lib/village.mjs';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-28T12:00:00Z');
const CWD = 'D:\\git\\Promptholm';

// A session `start` days before NOW that last did anything `quiet` days before NOW, with
// `turns` human turns. Three or more is a hut, fewer a tent.
function session(id, { start = 30, quiet = 0, turns = 1, agents = 0, cwd = CWD } = {}) {
  return { id, start: NOW - start * DAY, last: NOW - quiet * DAY, turns, agents, cwd };
}

function world(list, { locks = [], cowork = [], extra = {} } = {}) {
  const sources = {
    transcripts: [], subagents: [], locks,
    desktop: new Map(), cowork: new Map(), released: new Set(),
  };
  const cache = { files: {}, repoRoots: {} };
  // The resolver would walk the disk for a .git; tell it the answer instead.
  cache.repoRoots[CWD.toLowerCase()] = { root: CWD, kind: 'git', wt: null, at: NOW };
  const agg = (s, extraTurns = true) => ({
    sessionId: s.id, lines: 10, firstTs: s.start, lastTs: s.last,
    humanTurns: extraTurns ? s.turns : 0, assistantMsgs: 4, cwds: { [s.cwd]: 1 }, models: { 'claude-opus-5': 1 },
    titles: { custom: null, ai: `Work ${s.id}`, firstPrompt: null }, lastPrompt: null,
    tools: {}, tokens: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 }, agents: {},
  });
  for (const s of list) {
    const file = `C:\\claude\\projects\\p\\${s.id}.jsonl`;
    sources.transcripts.push({ sessionId: s.id, file, origin: 'code' });
    cache.files[file.toLowerCase()] = { agg: agg(s) };
    for (let k = 0; k < s.agents; k++) {
      const sub = `C:\\claude\\projects\\p\\${s.id}\\subagents\\agent-a${k}.jsonl`;
      sources.subagents.push({ sessionId: s.id, agentId: `a${k}`, file: sub, meta: { agentType: 'Explore' } });
      cache.files[sub.toLowerCase()] = { agg: agg(s, false) };
    }
  }
  for (const id of cowork) sources.cowork.set(id, { title: 'A Cowork task' });
  // The island excludes nothing here: the paths above are made up, not a temp folder.
  const { config = {}, ...rest } = extra;
  return { sources, cache, arrivals: [], now: NOW, ...rest, config: { excludeCwd: [], ...config } };
}

const village = (list, opts) => buildVillage(world(list, opts));
const ids = (model) => model.buildings.filter((b) => b.kind !== 'shed').map((b) => b.sessionId).sort();

test('a tent left alone for more than a week packs up; a hut never does', () => {
  const model = village([
    session('old-tent', { quiet: 8 }),
    session('fresh-tent', { quiet: 2 }),
    session('old-hut', { quiet: 90, turns: 3 }),
  ]);
  assert.deepEqual(ids(model), ['fresh-tent', 'old-hut']);
  assert.equal(model.stats.settlers, 2);
  assert.deepEqual(model.departed, ['old-tent']);
  assert.ok(model.dropped.includes('house:old-tent'), 'its plot goes back to the land');
});

test('what is not drawn as a tent, or was asked for by the keeper, stays', () => {
  const quiet = { quiet: 40 };
  const model = village([
    session('founder', quiet),
    session('running', quiet),
    session('quay', quiet),
    session('rehomed', quiet),
    session('hotel', { ...quiet, agents: 10 }),
    session('plain', quiet),
  ], {
    locks: [{ sessionId: 'running', alive: true }],
    cowork: ['quay'],
    extra: { config: { founders: ['founder'] }, rehomed: { 'house:rehomed': { district: 'n:mine', name: 'Mine' } } },
  });
  assert.deepEqual(model.departed, ['plain']);
  assert.deepEqual(ids(model), ['founder', 'hotel', 'quay', 'rehomed', 'running']);
});

test('a keeper can switch the leaving off', () => {
  const model = village([session('old-tent', { quiet: 300 })], { extra: { config: { tentGraceMs: 0 } } });
  assert.deepEqual(model.departed, []);
  assert.equal(model.stats.settlers, 1);
});

test('the apprentices of a tent that leaves go with it', () => {
  const model = village([session('old-tent', { quiet: 8, agents: 2 }), session('hut', { turns: 5, agents: 1 })]);
  assert.equal(model.stats.apprentices, 1);
  assert.ok(model.dropped.includes('shed:old-tent:a0'));
  assert.ok(model.dropped.includes('shed:old-tent:a1'));
  assert.ok(!model.dropped.includes('shed:hut:a0'));
});

// Five old tents and one hut: under the old rule six settlers, the well (5) standing.
const OLD = [
  ...[1, 2, 3, 4, 5].map((n) => session(`tent${n}`, { start: 60 - n, quiet: 50 - n })),
  session('hut', { start: 40, turns: 9 }),
];

test('the first scan under the rule keeps everything the island had, with the same dates', () => {
  const before = village(OLD, { extra: { config: { tentGraceMs: 0 } } });
  const after = village(OLD);
  assert.equal(after.stats.settlers, 1, 'five tents left');
  const well = (m) => m.milestones.find((x) => x.id === 'well');
  assert.equal(well(before).unlocked, true);
  assert.equal(well(after).unlocked, true, 'the well stays');
  assert.equal(well(after).unlockedAt, well(before).unlockedAt, 'and keeps its date');
  assert.deepEqual(after.arrivals, before.arrivals, 'nothing in the chronicle moves');
  assert.deepEqual(after.ladder, { since: NOW, settlers: 6, apprentices: 0 });
  assert.deepEqual(after.stats.reached, { settlers: 6, apprentices: 0 });
});

test('below a rung already earned, the next one waits for the village to be that big again', () => {
  const ladder = village(OLD).ladder;                       // what scan.mjs wrote down
  const newcomers = (n) => Array.from({ length: n }, (_, k) => session(`new${k}`, { start: 5, turns: 4 }));
  // 1 + 8 = 9 settlers now; the most ever was 6, so the market (10) waits for one more.
  let m = village([...OLD, ...newcomers(8)], { extra: { ladder } });
  assert.equal(m.stats.settlers, 9);
  assert.equal(m.milestones.find((x) => x.id === 'well').unlocked, true);
  assert.equal(m.milestones.find((x) => x.id === 'market').unlocked, false);
  assert.deepEqual(nextMilestone(m.stats), { id: 'market', at: 10, on: 'settlers', label: 'Market stalls', remaining: 1 });
  assert.equal(m.ladder.settlers, 9, 'a new most-ever is written down');
  // Ten: the market stands, dated to the moment ten lived here at once.
  m = village([...OLD, ...newcomers(9)], { extra: { ladder: m.ladder } });
  const market = m.milestones.find((x) => x.id === 'market');
  assert.equal(market.unlocked, true);
  assert.equal(market.unlockedAt, NOW - 5 * DAY);
});

test('a village that shrinks keeps its rungs, its furniture and its count of the most ever', () => {
  const big = Array.from({ length: 12 }, (_, k) => session(`s${k}`, { start: 20, quiet: 1 }));
  const first = village(big);
  assert.equal(first.milestones.find((x) => x.id === 'bakery').unlocked, true);
  // Nine of them fall quiet for a month; the stored ladder says the village once had twelve.
  const later = big.map((s, k) => (k < 9 ? { ...s, last: NOW - 30 * DAY } : s));
  const m = village(later, { extra: { ladder: first.ladder } });
  assert.equal(m.stats.settlers, 3);
  for (const id of ['well', 'market', 'bakery']) assert.equal(m.milestones.find((x) => x.id === id).unlocked, true, id);
  assert.equal(m.ladder.settlers, 12, 'the most ever never goes down');
  assert.equal(nextMilestone(m.stats).id, 'tavern');
  assert.equal(nextMilestone(m.stats).remaining, 12, 'fifteen, from three');
  // The square's furniture is on the apprentices' ladder the same way: a village that once
  // had thirty keeps its first flower bed with none left.
  const furnished = village(later, { extra: { ladder: { ...first.ladder, apprentices: 30 } } });
  assert.equal(furnished.stats.apprentices, 0);
  assert.deepEqual(furnished.furniture.map((f) => f.id), ['civic:planter:1']);
});

test('a departure is dated when it happened, never before the rule began', () => {
  // The rule began ten days ago. A tent that went quiet twenty days ago left the day the rule
  // began, not a fortnight earlier; one that went quiet eight days ago left yesterday.
  const since = NOW - 10 * DAY;
  const list = [
    session('a', { start: 30, quiet: 20 }),
    session('b', { start: 29, quiet: 8 }),
    session('c', { start: 3, turns: 4 }),
  ];
  const m = village(list, { extra: { ladder: { since, settlers: 2, apprentices: 0 } } });
  // a arrives (1), b arrives (2), a leaves at `since` (1), c arrives (2), b leaves (1): the
  // village never had three at once.
  assert.deepEqual(m.arrivals, [NOW - 30 * DAY, NOW - 29 * DAY]);
  assert.equal(m.stats.settlers, 1);
  assert.equal(m.ladder.since, since, 'the start is kept');
});

test('every reader of the ladder falls back to the population on a model without one', () => {
  assert.equal(reachedOf({ stats: { settlers: 7 } }), 7);
  assert.equal(reachedOf({ stats: { settlers: 7, reached: { settlers: 11 } } }), 11);
  assert.equal(reachedOf({ stats: { apprentices: 2, reached: { apprentices: 5 } } }, 'apprentices'), 5);
  // And a rung is only "next" once it is not already standing.
  const stats = { settlers: 3, apprentices: 0, reached: { settlers: 12, apprentices: 0 } };
  const next = nextMilestone(stats);
  assert.ok(MILESTONES.find((x) => x.id === next.id).at > 12);
});
