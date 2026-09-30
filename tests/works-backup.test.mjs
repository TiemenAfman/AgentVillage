// The layout is kept beside itself before the scan whose earthworks change the island's hash
// (`layout.before-works-<ts>.json`, scan.mjs `backUpBeforeWorks`): an older copy of the code on the
// same ~/.promptholm ignores `works`, finds another hash and plans the town again from nothing, and
// this file is the way back (Plans/quay-en-rivier.md, review point 5).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backUpBeforeWorks } from '../scan.mjs';

function place() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptholm-works-'));
  const file = path.join(dir, 'layout.json');
  fs.writeFileSync(file, JSON.stringify({ terrainHash: 'aaaaaaaa' }));
  return { dir, file };
}
const backups = (dir) => fs.readdirSync(dir).filter((f) => f.startsWith('layout.before-works-'));

test('the layout on disk is kept before earthworks change the hash, and only then', () => {
  const before = { works: JSON.stringify(null), hash: 'aaaaaaaa' };
  const at = new Date(2026, 8, 30, 14, 5, 9);
  // Works written and the hash moved: the file as it was is kept, named by the time.
  let { dir, file } = place();
  backUpBeforeWorks(file, before, { works: { v: 1, fill: [[1, 1]] }, terrainHash: 'bbbbbbbb' }, at);
  assert.deepEqual(backups(dir), ['layout.before-works-20260930-140509.json']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, backups(dir)[0]), 'utf8')), { terrainHash: 'aaaaaaaa' });
  // Works written but the hash the same (an empty fill, a null funnel): nothing to keep.
  ({ dir, file } = place());
  backUpBeforeWorks(file, before, { works: { v: 1, fill: [] }, terrainHash: 'aaaaaaaa' }, at);
  assert.deepEqual(backups(dir), []);
  // The hash moved but not by the works (a growth ring, a polder): not this backup's business.
  ({ dir, file } = place());
  backUpBeforeWorks(file, before, { works: null, terrainHash: 'cccccccc' }, at);
  assert.deepEqual(backups(dir), []);
  // No layout on disk yet (a new island): nothing to keep, and no throw.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'promptholm-works-'));
  backUpBeforeWorks(path.join(empty, 'layout.json'), before, { works: { v: 1 }, terrainHash: 'dddddddd' }, at);
  assert.deepEqual(backups(empty), []);
});
