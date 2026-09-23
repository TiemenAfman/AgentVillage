// Which code a tree is. lib/buildinfo.mjs reads .git by hand rather than running git,
// because the Docker stage that stamps the sea has no git - so this holds the hand-reading
// against the real thing on whatever checkout the suite runs in, worktrees included.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gitCommit, readBuildInfo, buildLabel } from '../lib/buildinfo.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the commit read by hand is the one git says', (t) => {
  let want;
  try { want = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch { return t.skip('no git here'); }
  assert.equal(gitCommit(root), want);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.deepEqual(readBuildInfo(root), { version: pkg.version, commit: want });
});

test('a release says it itself, and a bare folder says nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptholm-build-'));
  try {
    assert.deepEqual(readBuildInfo(dir), { version: null, commit: null });
    assert.equal(buildLabel(readBuildInfo(dir)), 'unknown build');
    fs.writeFileSync(path.join(dir, 'release.json'), JSON.stringify({ name: 'Promptholm', version: '0.2.0', commit: 'abc1234' }));
    assert.deepEqual(readBuildInfo(dir), { version: '0.2.0', commit: 'abc1234' });
    assert.equal(buildLabel(readBuildInfo(dir)), '0.2.0 · abc1234');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
