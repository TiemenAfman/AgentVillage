// Every page module parses. Most of web/js is only ever loaded by a browser, so a stray line
// that breaks the syntax of main.js - a hunk applied in the wrong place, which is how this
// test came about - passes every other test in this folder and leaves the island stuck on
// "Charting the island…". `node --check` parses without running, so nothing is imported and
// no browser global is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('every module in web/js and shared/ parses', () => {
  const files = [
    ...fs.readdirSync(path.join(ROOT, 'web/js')).filter((f) => f.endsWith('.js') && !f.endsWith('-mesh.js')).map((f) => path.join(ROOT, 'web/js', f)),
    ...fs.readdirSync(path.join(ROOT, 'shared')).filter((f) => f.endsWith('.mjs')).map((f) => path.join(ROOT, 'shared', f)),
  ];
  assert.ok(files.length > 40);
  const bad = [];
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (r.status !== 0) bad.push(`${path.relative(ROOT, f)}: ${(r.stderr || '').split('\n').slice(0, 4).join(' ').trim()}`);
  }
  assert.deepEqual(bad, []);
});
