// The dossier's Archive (issue #78): a settler waiting for you can be taken off the list, and
// comes back by itself the moment the session says something new - what is kept is *until
// when*, never a flag.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { waitingSessions } from '../lib/waiting.mjs';
import { readDismissed, dismissWaiting, undismissWaiting, isDismissed } from '../lib/waiting-dismissed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SID = 'aaaaaaaa-1111-2222-3333-444444444444';

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'promptholm-dismiss-'));
}

// A Claude home with one transcript whose last turn is an assistant question at `at`.
function homeWith(turns) {
  const home = scratch();
  const dir = path.join(home, 'projects', 'p');
  fs.mkdirSync(dir, { recursive: true });
  const lines = turns.map(([type, at, text]) => JSON.stringify({
    type, timestamp: new Date(at).toISOString(),
    message: { role: type, content: [{ type: 'text', text }] },
  }));
  fs.writeFileSync(path.join(dir, `${SID}.jsonl`), lines.join('\n') + '\n');
  return home;
}

const waitsOf = (home, now, dismissed) => {
  const all = waitingSessions([{ sessionId: SID, alive: true }], { home, now });
  for (const [sid, w] of [...all]) if (isDismissed(dismissed, sid, w)) all.delete(sid);
  return all;
};

test('archiving keeps the wait off the list until the session says something new', () => {
  const t0 = Date.parse('2026-10-06T10:00:00Z');
  const home = homeWith([['user', t0 - 60_000, 'do it'], ['assistant', t0, 'Shall I push it?']]);
  const file = path.join(scratch(), 'waiting-dismissed.json');
  const now = t0 + 5 * 60_000;

  const before = waitsOf(home, now, readDismissed(file));
  assert.equal(before.size, 1);
  const wait = before.get(SID);
  assert.equal(wait.asked, true);

  dismissWaiting(SID, wait.since, { file });
  assert.equal(readDismissed(file).get(SID), t0, 'kept until the turn it was waiting on');
  assert.equal(waitsOf(home, now, readDismissed(file)).size, 0, 'archived');
  assert.equal(waitsOf(home, now + 3_600_000, readDismissed(file)).size, 0, 'staying quiet keeps it archived');

  // The keeper answers elsewhere and the session asks again: back on the list.
  const t1 = t0 + 10 * 60_000;
  fs.appendFileSync(path.join(home, 'projects', 'p', `${SID}.jsonl`), [
    JSON.stringify({ type: 'user', timestamp: new Date(t1 - 30_000).toISOString(), message: { role: 'user', content: [{ type: 'text', text: 'yes' }] } }),
    JSON.stringify({ type: 'assistant', timestamp: new Date(t1).toISOString(), message: { role: 'assistant', content: [{ type: 'text', text: 'Pushed. Open a PR too?' }] } }),
  ].join('\n') + '\n');
  const after = waitsOf(home, t1 + 60_000, readDismissed(file));
  assert.equal(after.size, 1, 'new activity brings it back');
  assert.equal(after.get(SID).question, 'Open a PR too?');
});

test('undo puts it back, and a damaged file archives nothing', () => {
  const file = path.join(scratch(), 'waiting-dismissed.json');
  dismissWaiting(SID, 1000, { file });
  dismissWaiting('other', undefined, { file, now: 5000 });
  assert.equal(readDismissed(file).get('other'), 5000, 'no since known: until now');
  undismissWaiting(SID, { file });
  assert.equal(readDismissed(file).has(SID), false);
  assert.equal(readDismissed(file).has('other'), true);

  fs.writeFileSync(file, '{ torn');
  assert.equal(readDismissed(file).size, 0);
  assert.equal(readDismissed(path.join(scratch(), 'none.json')).size, 0);
});

test('isDismissed compares against the wait it was archived on', () => {
  const d = new Map([[SID, 2000]]);
  assert.equal(isDismissed(d, SID, { since: 2000 }), true);
  assert.equal(isDismissed(d, SID, { since: 1999 }), true);
  assert.equal(isDismissed(d, SID, { since: 2001 }), false);
  assert.equal(isDismissed(d, 'other', { since: 1 }), false);
  assert.equal(isDismissed(null, SID, { since: 1 }), false);
  assert.equal(isDismissed(d, SID, null), false);
});

test('the scan hears it, and the route that writes it is the keeper\'s alone', () => {
  const village = fs.readFileSync(path.join(ROOT, 'lib/village.mjs'), 'utf8');
  assert.match(village, /isDismissed\(dismissed, sid, w\)/);
  const scan = fs.readFileSync(path.join(ROOT, 'scan.mjs'), 'utf8');
  assert.match(scan, /dismissed: o\.codex \? null : readDismissed\(\)/);
  const serve = fs.readFileSync(path.join(ROOT, 'serve.mjs'), 'utf8');
  assert.match(serve, /p === '\/api\/waiting\/dismiss' && req\.method === 'POST'/);
  const access = fs.readFileSync(path.join(ROOT, 'lib/access.mjs'), 'utf8');
  const pub = access.match(/const PUBLIC_API = new Set\(\[([^\]]*)\]\)/);
  assert.ok(pub, 'PUBLIC_API found');
  assert.doesNotMatch(pub[1], /waiting/);
});
