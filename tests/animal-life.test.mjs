// The story animals as the islander runs them (lib/animal-life.mjs, Plans/dierenverhalen.md).
//
// The promises: the first hen turns up only while the keeper is watching a working island, and
// by a house; an errand counts once, and only when the sea says it happened on the line it was
// sent on; what goes to the sea names nobody by their real id; marks get ground once they are
// earned; a journal that will not open leaves the animals off and the island running.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAnimalLife } from '../lib/animal-life.mjs';
import { rulesFor } from '../lib/animal-stories.mjs';
import { animalIsland, worked } from './support/animal-island.mjs';

const R = rulesFor(1);

function life(t, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'animal-life-'));
  const island = animalIsland();
  let clock = island.now;
  const news = [];
  let changes = 0;
  const make = () => createAnimalLife({ dir, now: () => clock, check: island.check, onNews: (n) => news.push(n), onChange: () => changes++, ...extra });
  let l = make();
  t.after(() => { try { l.close(); } catch {} fs.rmSync(dir, { recursive: true, force: true }); });
  return {
    dir, island, news, get life() { return l; }, get changes() { return changes; },
    at: (v) => { clock = v; }, get now() { return clock; },
    reopen() { l.close(); l = make(); return l; },
  };
}

// Answer every pending errand, as the sea would, on generation `gen`.
function finishAll(l, gen) {
  const s = l.state();
  let n = 0;
  for (const id of Object.keys(s.pending)) if (l.complete({ action: id, gen }, gen)) n++;
  return n;
}

test('the first hen needs the keeper watching a working island, and lives by a house', (t) => {
  const f = life(t);
  const v = f.island.village;
  f.life.afterScan(v, { viewing: false });
  assert.equal(Object.keys(f.life.state().animals).length, 0, 'arrived with nobody watching');
  const idle = structuredClone(v);
  for (const b of idle.buildings) b.active = false;
  f.life.afterScan(idle, { viewing: true });
  assert.equal(Object.keys(f.life.state().animals).length, 0, 'arrived on an island where nobody works');
  f.life.afterScan(v, { viewing: true });
  const hens = Object.values(f.life.state().animals);
  assert.equal(hens.length, 1);
  assert.equal(hens[0].species, 'chicken');
  assert.equal(hens[0].near, 'house:h0', 'the hen came to somebody other than whoever was working');
  assert.equal(f.news[0].kind, 'arrival');
  assert.ok(fs.existsSync(path.join(f.dir, 'animal-events.jsonl')));
});

test('an errand counts once, and only on the line it was sent on', (t) => {
  const f = life(t);
  f.life.afterScan(f.island.village, { viewing: true });
  f.at(f.now + R.window);
  f.life.afterScan(worked(f.island.village, 1, { at: f.now }), { viewing: true });
  const [id] = Object.keys(f.life.state().pending);
  assert.ok(id, 'new work bought no visit');
  const pub = f.life.publicState(() => null);
  assert.equal(pub.actions.length, 1);
  assert.equal(pub.actions[0].id, id);
  assert.equal(f.life.complete({ action: id, gen: 1 }, 2), false, 'a completion from an old line was taken');
  assert.equal(f.life.complete({ action: id, gen: 2 }, 2), true);
  assert.equal(f.life.complete({ action: id, gen: 2 }, 2), false, 'counted twice');
  assert.equal(f.life.state().encounters, 1);
  assert.equal(f.life.publicState(() => null).actions.length, 0);
});

test('what goes to the sea names settlers only by their redacted ids', (t) => {
  const f = life(t);
  f.life.afterScan(f.island.village, { viewing: true });
  for (let i = 1; i <= 12; i++) {
    f.at(f.now + R.window);
    f.life.afterScan(worked(f.island.village, i, { at: f.now }), { viewing: true });
    finishAll(f.life, 1);
  }
  const shown = { 'house:h0': 'house:s0' };
  const pub = f.life.publicState((real) => shown[real] || null);
  const text = JSON.stringify(pub);
  assert.ok(!/house:h\d/.test(text), `a real id went to the sea: ${text.match(/house:h\d/)}`);
  assert.ok(pub.animals[0].friends.every((x) => x.who === 'house:s0'));
  assert.ok(pub.animals[0].about && pub.animals[0].about.length <= 160);
  // And the keeper's own page gets the real ids and the names.
  const priv = f.life.privateState();
  assert.equal(priv.animals[0].relationships[0].resident, 'house:h0');
  assert.equal(priv.animals[0].relationships[0].name, 'Slate Mill');
  assert.ok(priv.story.length > 0 && priv.story[0].seq > priv.story[priv.story.length - 1].seq, 'newest first');
});

test('earned marks get ground, and go to the sea with it', (t) => {
  const f = life(t);
  f.life.afterScan(f.island.village, { viewing: true });
  for (let i = 1; i <= 90 && !Object.keys(f.life.state().traces).length; i++) {
    f.at(f.now + R.window);
    f.life.afterScan(worked(f.island.village, i, { at: f.now }), { viewing: true });
    finishAll(f.life, 1);
  }
  const traces = Object.values(f.life.state().traces);
  assert.ok(traces.length, 'ninety windows of friendship and no nest');
  assert.ok(traces.every((x) => x.placed), 'a mark was left without ground');
  const pub = f.life.publicState(() => null);
  assert.equal(pub.traces.length, traces.length);
  assert.ok(f.news.some((n) => n.kind === 'trace' || n.kind === 'mystery' || n.kind === 'discovery'));
});

test('a journal that will not open leaves the animals off and the island running', (t) => {
  const f = life(t);
  f.life.close();
  fs.writeFileSync(path.join(f.dir, 'animal-events.jsonl'), '{broken}\n');
  const l = f.reopen();
  assert.equal(l.afterScan(f.island.village, { viewing: true }), false);
  const priv = l.privateState();
  assert.equal(priv.enabled, false);
  assert.match(priv.error, /JSON|Unexpected|token/i);
  assert.equal(l.publicState(), null);
});

test('a lock left by an islander that crashed is taken over on the next start', (t) => {
  const f = life(t);
  f.life.afterScan(f.island.village, { viewing: true });
  f.life.close();
  fs.writeFileSync(path.join(f.dir, 'animal-store.lock'), JSON.stringify({ pid: 2147483646 }));
  const l = f.reopen();
  l.afterScan(f.island.village, { viewing: true });
  assert.equal(Object.keys(l.state().animals).length, 1, 'the hen was lost to a stale lock');
});

test('the return card has at most three things on it, the biggest first', (t) => {
  const f = life(t);
  f.life.afterScan(f.island.village, { viewing: true });
  for (let i = 1; i <= 120; i++) {
    f.at(f.now + R.window);
    f.life.afterScan(worked(f.island.village, i, { at: f.now }), { viewing: true });
    finishAll(f.life, 1);
  }
  const all = f.life.summary(0);
  assert.ok(all.items.length >= 1 && all.items.length <= 3);
  assert.equal(f.life.summary(all.seq).items.length, 0, 'nothing new since the last look');
  const story = f.life.story('animal:1', { limit: 5 });
  assert.ok(story.entries.every((x) => x.animal === 'animal:1'));
});
