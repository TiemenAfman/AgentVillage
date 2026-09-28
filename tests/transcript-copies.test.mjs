// A session that starts in a git worktree has its transcript under two project folders,
// the worktree's copy stopping where the session carried on under the repository's slug
// (issue #59). The house must be built from the longer copy, and the waiting check must
// read the same one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discover } from '../lib/sources.mjs';
import { findTranscript } from '../lib/waiting.mjs';

const SID = '50b4448c-0000-4000-8000-000000000001';

function home() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promptholm-copies-'));
  const line = (i) => JSON.stringify({ type: 'user', sessionId: SID, n: i }) + '\n';
  const write = (slug, lines, at) => {
    const dir = path.join(root, 'projects', slug);
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `${SID}.jsonl`);
    fs.writeFileSync(f, Array.from({ length: lines }, (_, i) => line(i)).join(''));
    fs.utimesSync(f, at, at);
    return f;
  };
  // The repository's slug sorts first, so the worktree's copy is the one discovered last.
  const long = write('D--git-Repo', 24, new Date('2026-09-11T12:00:00Z'));
  const short = write('D--git-Repo--claude-worktrees-tool', 13, new Date('2026-09-10T12:00:00Z'));
  return { root, long, short };
}

test('a session filed under two slugs is discovered once, as its newest copy', () => {
  const { root, long } = home();
  const found = discover({ claudeHome: root, desktopDir: path.join(root, 'no-desktop') })
    .transcripts.filter((t) => t.sessionId === SID);
  assert.equal(found.length, 1, 'both copies came through');
  assert.equal(found[0].file, long, 'the truncated worktree copy won');
});

test('the waiting check reads the same copy the house was built from', () => {
  const { root, long } = home();
  assert.equal(findTranscript(SID, root), long);
});
