// config.json is filled in from the code on start, and config.example.json is what a
// newcomer copies. Both used to be kept by hand and both had drifted: the example promised
// a `dispatch` and a `github` block the code had never heard of, said `gridSize: 128` where
// the code said 64 - a number that cannot be changed once a town stands on it - and had no
// `multiplayer.sea` in it at all, by then the setting that decided whether you were alone
// in the world. Nothing crashed, because every reader carries its own fallback; the
// settings were simply invisible to whoever opened the file to change one.
//
// Every test here writes to a config file of its own. lib/paths.mjs gives fillConfig the
// same `{ file }` escape it gives forgetSea, for the same reason: the alternative is a test
// that rewrites the config.json of whoever ran it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fillConfig, DEFAULT_DISPATCH, DEFAULT_GITHUB_DISPATCH, ROOT } from '../lib/paths.mjs';

let n = 0;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'settlers-config-'));
function configWith(contents) {
  const file = path.join(tmpDir, `config-${n++}.json`);
  fs.writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2));
  return file;
}
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// An empty object filled in is DEFAULT_CONFIG itself, which is how the rest of this file
// gets at it without exporting it just for the tests.
function defaults() {
  const file = configWith({});
  fillConfig({ file });
  return read(file);
}

const keyPaths = (o, prefix = '') => Object.entries(o).flatMap(([k, v]) => (
  v && typeof v === 'object' && !Array.isArray(v) ? keyPaths(v, `${prefix}${k}.`) : [prefix + k]
));

test('config.example.json is the defaults, exactly', () => {
  // Not "has the same keys": the same bytes. The example is a dump of DEFAULT_CONFIG, so
  // there is no second hand-kept list of settings that can fall behind the first.
  const onDisk = fs.readFileSync(path.join(ROOT, 'config.example.json'), 'utf8');
  assert.deepEqual(JSON.parse(onDisk), defaults());
});

test('the example names every setting the code has', () => {
  // The assertion above already covers this. It is here on its own because this is the
  // failure that actually happened, and a diff of two whole objects does not say it.
  const ex = new Set(keyPaths(JSON.parse(fs.readFileSync(path.join(ROOT, 'config.example.json'), 'utf8'))));
  const missing = keyPaths(defaults()).filter((k) => !ex.has(k));
  assert.deepEqual(missing, [], `config.example.json never grew: ${missing.join(', ')}`);
});

test('the wording in config.json is the wording the island sends out', () => {
  // DEFAULT_DISPATCH and DEFAULT_GITHUB_DISPATCH moved into lib/paths.mjs so DEFAULT_CONFIG
  // could spread them instead of naming them again. If they ever stop being the same object,
  // a keeper reads one sentence in the file and their agents are handed another.
  const d = defaults();
  assert.deepEqual(d.dispatch, DEFAULT_DISPATCH);
  assert.deepEqual(d.github.dispatch, DEFAULT_GITHUB_DISPATCH);
});

test('a config from an older island gains what it is missing', () => {
  // The shape of the file that started this: updated a few times, still carrying the
  // settings it was first given. `multiplayer` is there, but from before the sea existed.
  const file = configWith({
    islandName: 'Promptholm',
    foundedAt: '2026-01-01T00:00:00.000Z',
    seed: 1337,
    gridSize: 64,
    network: { public: true },
    multiplayer: { enabled: true, maxPlayers: 16 },
  });
  const { added, written } = fillConfig({ file });
  assert.equal(written, true);
  // A gap inside a block that is present is named by the whole path down to it; a block
  // that is missing outright is named once, rather than once per leaf under it. The list
  // goes in the line the island prints on start, and "multiplayer.sea" is the sentence
  // somebody needs to read - not six of its children.
  assert.ok(added.includes('multiplayer.sea'), 'the sea is the one that mattered');
  assert.ok(added.includes('visitorGraceMs'));
  assert.ok(added.includes('dispatch'));
  assert.ok(added.includes('github'));
  assert.ok(!added.some((k) => k.startsWith('dispatch.')), 'a missing block is named once');

  const after = read(file);
  assert.equal(after.multiplayer.sea.mode, 'single');
  assert.equal(after.multiplayer.sea.port, 4750);
  assert.equal(after.dispatch.opening, DEFAULT_DISPATCH.opening);
  assert.equal(after.github.dispatch.skill, DEFAULT_GITHUB_DISPATCH.skill);
  // And what was already there is untouched, including the two blocks that named some of
  // their keys and not others: filling `network` in must not be a way to lose `public`.
  assert.equal(after.islandName, 'Promptholm');
  assert.equal(after.foundedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(after.network.public, true);
  assert.equal(after.network.inviteCode, null);
  assert.equal(after.multiplayer.maxPlayers, 16);
  assert.equal(after.multiplayer.guestView, 'redacted');
});

test('a config that is already complete is left alone', () => {
  // Otherwise every start rewrites the file, races setSea and setDisplay for it, and moves
  // its mtime for nothing.
  const file = configWith(defaults());
  const before = fs.readFileSync(file, 'utf8');
  const { added, written } = fillConfig({ file });
  assert.deepEqual(added, []);
  assert.equal(written, false);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('a setting the keeper chose wins, null included', () => {
  const file = configWith({
    gridSize: 96,
    network: { public: false, inviteCode: 'hallo' },
    multiplayer: { sea: { mode: 'join', url: 'http://example.org:4750/', key: null } },
    display: { nameplates: 'nobody' },
  });
  fillConfig({ file });
  const after = read(file);
  assert.equal(after.gridSize, 96);
  assert.equal(after.network.public, false);
  assert.equal(after.network.inviteCode, 'hallo');
  assert.equal(after.display.nameplates, 'nobody');
  assert.equal(after.multiplayer.sea.mode, 'join');
  assert.equal(after.multiplayer.sea.url, 'http://example.org:4750/');
  // Present and null is a choice, not a gap. Overwriting it with the default would hand a
  // key back to somebody who had deliberately taken it out.
  assert.equal(after.multiplayer.sea.key, null);
});

test('an array is a value, never something to merge into', () => {
  // Merging element by element would resurrect every sea the keeper has ever forgotten,
  // and every founder they have removed.
  const file = configWith({ founders: ['a'], multiplayer: { sea: { known: [] } }, network: { hosts: ['x'] } });
  fillConfig({ file });
  const after = read(file);
  assert.deepEqual(after.founders, ['a']);
  assert.deepEqual(after.multiplayer.sea.known, []);
  assert.deepEqual(after.network.hosts, ['x']);
});

test('a setting this version has never heard of is kept', () => {
  // The file is also the older island's, and the branch beside this one's. Tidying away
  // what we do not recognise would delete somebody's settings on their behalf.
  const file = configWith({ islandName: 'Contextholm', somethingElse: 42, network: { ownIdea: true } });
  fillConfig({ file });
  const after = read(file);
  assert.equal(after.somethingElse, 42);
  assert.equal(after.network.ownIdea, true);
  assert.equal(after.network.public, true);   // and the fill still happened around it
});

test('a config that is not there is left to loadConfig to found', () => {
  const file = path.join(tmpDir, 'no-such-config.json');
  const { added, written } = fillConfig({ file });
  assert.deepEqual(added, []);
  assert.equal(written, false);
  assert.equal(fs.existsSync(file), false);
});

test('a config that is not JSON is not overwritten', () => {
  // readJson swallows the parse error and hands back null. Writing a fresh config over the
  // top would be the one case where this loses settings rather than adding them - a keeper
  // with a trailing comma in their file wants to be told, not to have it replaced.
  const file = configWith('{ "islandName": "Promptholm", }');
  const before = fs.readFileSync(file, 'utf8');
  const { added, written } = fillConfig({ file });
  assert.deepEqual(added, []);
  assert.equal(written, false);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});
