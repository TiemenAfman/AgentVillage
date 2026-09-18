// The journey home, from both ends.
//
// The host writes down what a visitor did to their own island (lib/journal.mjs); the
// visitor's own machine pulls that log and replays it against its own files
// (lib/visits.mjs). Everything here runs against a temp directory, because the whole
// subject is files being written.
//
// The assertion this file exists for is the first one: `layout.*` and `village.*` are not
// expressible. scan.mjs is the only writer of village.json and layout.json and it builds
// them from Claude transcripts that live only on the owner's machine, so a host can never
// have a newer one - it can only hold the copy it was handed. A house never moves, and an
// op that could name a layout is the one way this feature could move one. It is asserted
// at both ends, because both ends are reachable by somebody who wants it to be.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { STARTING_PURSE } from '../shared/crops.mjs';
import { createJournal, JOURNAL_OPS } from '../lib/journal.mjs';
import { createVisit, hostIdFor, journalUrl } from '../lib/visits.mjs';
import { listProps, PROPS_FILE } from '../lib/props.mjs';
import { readGarden, GARDEN_FILE } from '../lib/garden.mjs';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'promptholm-visit-'));
}

const snapshot = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };

// An island at home, with a purse and a basket somebody has already been trading out of.
function homeIsland(dir, garden = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'garden.json'), JSON.stringify({
    v: 1, purse: STARTING_PURSE, seeds: {}, basket: {}, held: null, beds: [],
    ledger: { sown: 0, pulled: 0, earned: 0, spent: 0 },
    ...garden,
  }));
  fs.writeFileSync(path.join(dir, 'props.json'), JSON.stringify({ v: 1, props: [] }));
  return dir;
}

const HOST = { host: '192.168.1.40', port: 4747, islandId: 'a'.repeat(16) };
const visitOn = (dir, extra = {}) => createVisit({ ...HOST, dir, ...extra });

// A line as the host writes one. Nothing here goes through createJournal, so the visitor's
// own refusals are tested rather than the host's.
const line = (seq, op, payload = {}) => ({ seq, at: new Date().toISOString(), op, by: 'P', payload });

// ---------------------------------------------------------------- the allowlist

test('a journal cannot express a layout or a village, at either end', () => {
  const dir = tempDir();
  const journal = createJournal({ dir });

  // Seven words, and these seven. A list that grew by accident is the failure this guards.
  assert.deepEqual(JOURNAL_OPS, ['build', 'unbuild', 'sow', 'harvest', 'dig', 'buy', 'sell']);

  const forbidden = [
    'layout', 'layout.move', 'layout.write', 'layout.json', 'village', 'village.rebuild',
    'village.write', 'scan', 'config', 'move', '', null, undefined, 'BUILD', 'build ',
    '__proto__', 'constructor',
  ];
  for (const op of forbidden) {
    assert.throws(() => journal.append({ op, payload: {} }), /is not something a visit can do/, `the host accepted ${JSON.stringify(op)}`);
  }
  assert.equal(journal.seq(), 0, 'a refused op still took a sequence number');

  // And the same list at the visitor's end, which is the one that matters: a host is
  // allowed to lie, and this is the machine whose files are at stake.
  const home = homeIsland(path.join(dir, 'home'));
  const visit = visitOn(home);
  for (const op of forbidden) {
    assert.throws(() => visit.applyLines([line(1, op)]), /is not something a visit can bring home/, `the visitor accepted ${JSON.stringify(op)}`);
  }
  // Nothing was applied, so nothing was written - not even the before-copies.
  assert.equal(visit.state().since, 0);
  assert.deepEqual(fs.readdirSync(home).filter((f) => f.includes('before-')), []);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('a journal numbers its lines once and resumes from the file', () => {
  const dir = tempDir();
  const first = createJournal({ dir });
  assert.equal(first.seq(), 0);
  assert.equal(first.append({ op: 'buy', by: 'P', payload: { kind: 'turnip', count: 2 } }).seq, 1);
  assert.equal(first.append({ op: 'build', payload: { id: 'prop:aaaaaaaa', kind: 'bench', x: 1, z: 2 } }).seq, 2);
  assert.equal(first.append({ op: 'sell', payload: { kind: 'turnip', count: 1 } }).seq, 3);

  // A restart is not a reason to start counting again: the visitor's bookmark is a number
  // they will send back, and a counter that began at 1 twice would make every line they
  // had already applied look new.
  const second = createJournal({ dir });
  assert.equal(second.seq(), 3);
  assert.equal(second.append({ op: 'dig', payload: { id: 'bed:1' } }).seq, 4);

  assert.deepEqual(second.since(2).map((r) => r.seq), [3, 4]);
  assert.deepEqual(second.since(0).map((r) => r.op), ['buy', 'build', 'sell', 'dig']);
  assert.deepEqual(second.since(4), []);
  assert.equal(second.since(0)[0].by, 'P');
  assert.equal(second.since(0)[1].by, null);

  // A half-written last line is the one thing appending can leave behind, and skipping it
  // is the whole recovery.
  fs.appendFileSync(path.join(dir, 'journal.jsonl'), '{"seq":5,"op":"buy","pay');
  assert.equal(createJournal({ dir }).seq(), 4);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- replaying

test('a replayed journal changes nothing the second time', () => {
  const dir = tempDir();
  const home = homeIsland(path.join(dir, 'home'));
  const realProps = snapshot(PROPS_FILE);
  const realGarden = snapshot(GARDEN_FILE);
  const visit = visitOn(home);

  const lines = [
    line(1, 'buy', { kind: 'turnip', count: 3 }),
    line(2, 'build', { id: 'prop:hosthost', kind: 'bench', x: 4, z: 4, label: 'Brought home' }),
  ];

  const once = visit.applyLines(lines);
  assert.equal(once.applied.length, 2);
  assert.equal(once.skipped.length, 0);
  assert.equal(once.since, 2);

  const after = {
    purse: readGarden({ file: path.join(home, 'garden.json') }).purse,
    props: listProps({ file: path.join(home, 'props.json') }),
  };
  assert.equal(after.purse, STARTING_PURSE - 6);
  assert.equal(after.props.length, 1);

  // The same lines again. `build` and `buy` are not idempotent on their own - addProp
  // mints a fresh id every call and a purchase is a delta - so what makes this safe is the
  // bookmark, and that is what is being asserted.
  const twice = visit.applyLines(lines);
  assert.deepEqual(twice.applied, []);
  assert.equal(twice.skipped.length, 2);
  assert.ok(twice.skipped.every((s) => s.why === 'already home'));
  assert.equal(readGarden({ file: path.join(home, 'garden.json') }).purse, after.purse);
  assert.deepEqual(listProps({ file: path.join(home, 'props.json') }), after.props);

  // The host's id for the bench is not this island's id for it, so the pair is remembered
  // and an `unbuild` of the host's id finds the right bench.
  assert.equal(visit.state().ids['prop:hosthost'], after.props[0].id);
  const gone = visit.applyLines([line(3, 'unbuild', { id: 'prop:hosthost' })]);
  assert.equal(gone.applied.length, 1);
  assert.deepEqual(listProps({ file: path.join(home, 'props.json') }), []);
  // And unbuilding it again is a no-op rather than a failure, at every level.
  assert.equal(visit.applyLines([line(4, 'unbuild', { id: 'prop:hosthost' })]).applied[0].result, null);

  assert.equal(snapshot(PROPS_FILE), realProps, 'a visit wrote to the real props.json');
  assert.equal(snapshot(GARDEN_FILE), realGarden, 'a visit wrote to the real garden.json');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('what cannot be afforded at home is skipped and reported, never forced', () => {
  const dir = tempDir();
  // Somebody at home sold the carrots and spent the coins while the visitor was away.
  // That is not a conflict to resolve, it is the answer: the coins are gone.
  const home = homeIsland(path.join(dir, 'home'), { purse: 1, basket: {}, seeds: {} });
  const visit = visitOn(home);
  const gardenFile = path.join(home, 'garden.json');

  const out = visit.applyLines([
    line(1, 'sell', { kind: 'carrot', count: 3 }),
    line(2, 'buy', { kind: 'pumpkin', count: 2 }),
    line(3, 'harvest', { id: 'bed:gonealready' }),
    line(4, 'dig', { id: 'bed:gonealready' }),
  ]);

  assert.deepEqual(out.applied, [], 'something was applied that could not be');
  assert.equal(out.skipped.length, 4);
  assert.deepEqual(out.skipped.map((s) => s.seq), [1, 2, 3, 4]);
  // Reported, with the mutator's own sentence - the one a person would have been shown
  // had they done it standing here.
  assert.match(out.skipped[0].why, /no carrots in the basket/);
  assert.match(out.skipped[1].why, /the purse holds 1/);
  assert.match(out.skipped[2].why, /no bed there/);

  // The purse is exactly where it was. This is the line the whole design is for: an
  // operation log merges with what happened at home, a purse balance would clobber it.
  const g = readGarden({ file: gardenFile });
  assert.equal(g.purse, 1);
  assert.deepEqual(g.basket, {});
  assert.ok(g.purse >= 0, 'the purse was forced negative by something that happened elsewhere');

  // And the bookmark moved past all four: a line this island will not take is not going to
  // become acceptable on the next poll.
  assert.equal(visit.state().since, 4);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a bookmark that goes backwards and a journal from elsewhere are both refused', () => {
  const dir = tempDir();
  const home = homeIsland(path.join(dir, 'home'));
  const visit = visitOn(home);

  visit.applyLines([line(1, 'buy', { kind: 'turnip', count: 1 })]);
  assert.equal(visit.state().since, 1);

  // Within one slice: a journal does not go backwards, and neither does it repeat itself.
  assert.throws(() => visit.applyLines([line(5, 'buy', { kind: 'turnip' }), line(4, 'buy', { kind: 'turnip' })]), /does not go backwards/);
  assert.throws(() => visit.applyLines([line(5, 'buy', { kind: 'turnip' }), line(5, 'buy', { kind: 'turnip' })]), /does not go backwards/);
  assert.throws(() => visit.applyLines([line(0, 'buy', { kind: 'turnip' })]), /without a sequence number/);
  assert.throws(() => visit.applyLines([{ op: 'buy', payload: {} }]), /without a sequence number/);

  // And across slices: a host whose counter has restarted is a host that would make us
  // replay a purchase, so the envelope's own `since` is checked against the bookmark.
  assert.throws(() => visit.applyLines([line(2, 'buy', { kind: 'turnip' })], { since: 0 }), /does not go backwards/);
  assert.doesNotThrow(() => visit.applyLines([line(2, 'buy', { kind: 'turnip' })], { since: 1 }));

  // A journal from a host this island is not visiting is refused, in the envelope and on
  // the line: replayed against this bookmark it would apply somebody else's operations
  // under our numbering.
  const mine = hostIdFor(HOST.host, HOST.port);
  assert.equal(visit.state().hostId, mine);
  assert.throws(() => visit.applyLines([line(3, 'buy', { kind: 'turnip' })], { hostId: 'somewhere-else-9' }), /this visit is to/);
  assert.throws(() => visit.applyLines([{ ...line(3, 'buy', { kind: 'turnip' }), hostId: 'somewhere-else-9' }]), /claims to come from/);
  assert.doesNotThrow(() => visit.applyLines([{ ...line(3, 'buy', { kind: 'turnip' }), hostId: mine }], { hostId: mine }));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('the island is copied once, before the first thing a visit changes', () => {
  const dir = tempDir();
  const home = homeIsland(path.join(dir, 'home'));
  const visit = visitOn(home);
  const { visitId } = visit.state();
  const before = {
    props: path.join(home, `props.before-${visitId}.json`),
    garden: path.join(home, `garden.before-${visitId}.json`),
  };

  // Nothing yet: a visit that has changed nothing has nothing to undo.
  assert.ok(!fs.existsSync(before.props));
  assert.ok(!fs.existsSync(before.garden));

  const was = fs.readFileSync(path.join(home, 'garden.json'), 'utf8');
  visit.applyLines([line(1, 'buy', { kind: 'turnip', count: 2 })]);

  // Both files, both small, and between them a whole undo.
  assert.ok(fs.existsSync(before.props), 'no copy of props.json was taken');
  assert.ok(fs.existsSync(before.garden), 'no copy of garden.json was taken');
  assert.equal(fs.readFileSync(before.garden, 'utf8'), was, 'the copy was taken after the change');
  assert.equal(readGarden({ file: before.garden }).purse, STARTING_PURSE);

  // Once, not per line: this is "put my island back the way it was before I sailed", not
  // a step-by-step history.
  visit.applyLines([line(2, 'buy', { kind: 'turnip', count: 1 })]);
  assert.equal(fs.readFileSync(before.garden, 'utf8'), was, 'a second apply overwrote the undo');

  // And a crash resumes rather than replays: the bookmark and the visit id are on disk.
  const resumed = visitOn(home);
  assert.equal(resumed.state().since, 2);
  assert.equal(resumed.state().visitId, visitId);
  assert.deepEqual(resumed.applyLines([line(1, 'buy', { kind: 'turnip' })]).applied, []);

  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- the wire

test('the pull is one function, and it is the only thing that touches the network', async () => {
  const dir = tempDir();
  const home = homeIsland(path.join(dir, 'home'));
  const asked = [];
  // The host echoes the bookmark it was handed, which is what the visitor checks has not
  // gone backwards - so the stub has to echo it too, or it is not standing in for a host.
  const fetchImpl = async (url) => {
    asked.push(url);
    const since = Number(new URL(url).searchParams.get('since'));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        hostId: hostIdFor(HOST.host, HOST.port),
        island: HOST.islandId,
        since,
        entries: since < 1 ? [line(1, 'buy', { kind: 'turnip', count: 2 })] : [],
      }),
    };
  };

  const visit = visitOn(home, { fetchImpl });
  const out = await visit.pull();
  assert.equal(out.applied.length, 1);
  assert.equal(readGarden({ file: path.join(home, 'garden.json') }).seeds.turnip, 2);

  // GET /api/island-journal?island=<id>&since=<seq>, and the bookmark is in it - which is
  // what stops the host resending the whole visit on every poll.
  assert.equal(asked.length, 1);
  assert.equal(asked[0], journalUrl({ ...HOST, since: 0 }));
  assert.match(asked[0], /\/api\/island-journal\?island=a{16}&since=0$/);
  assert.match(journalUrl({ ...HOST, since: 7 }), /since=7$/);

  await visit.pull();
  assert.match(asked[1], /since=1$/, 'the second ask did not carry the new bookmark');

  fs.rmSync(dir, { recursive: true, force: true });
});
