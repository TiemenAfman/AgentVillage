// What an island is called once somebody else can see it.
//
// Everybody who runs this project starts out as `Promptholm`, which is fine on loopback
// and useless the moment three of them are in one sea: three identical rows in the join
// picker and three coastlines nobody can tell apart. So a host goes by the name of the
// machine it is running on - the one name the people being invited already have, because
// it is in the address they were handed - and a joiner does not, because in somebody
// else's world the name in config.json is the one the keeper chose to be known by.
//
// The rule lives in exactly one place (lib/paths.mjs), and this file is here because it
// is read from four: scan.mjs writes it into village.json's island block, serve.mjs hands
// it to /api/hello and to the beacon, and lib/sea.mjs is created with the sea's half of
// it. A second copy of "are we hosting?" anywhere would be the bug this guards.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostingSea, islandNameOf, seaNameOf } from '../lib/paths.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MACHINE = String(os.hostname()).split('.')[0];
const cfg = (mode, extra = {}) => ({
  islandName: 'Promptholm',
  multiplayer: { sea: { mode, name: null, ...extra } },
});

test('hosting puts the machine name on the island and on its sea', () => {
  assert.equal(hostingSea(cfg('host')), true);
  assert.equal(islandNameOf(cfg('host')), MACHINE);
  // One name for both, deliberately: the row in somebody's picker and the coastline they
  // arrive at should say the same thing.
  assert.equal(seaNameOf(cfg('host')), MACHINE);
});

test('joining and being alone leave the configured name alone', () => {
  for (const mode of ['join', 'single', undefined]) {
    assert.equal(hostingSea(cfg(mode)), false);
    assert.equal(islandNameOf(cfg(mode)), 'Promptholm');
    assert.equal(seaNameOf(cfg(mode)), "Promptholm's sea");
  }
});

test('a sea somebody named by hand keeps that name in every mode', () => {
  for (const mode of ['host', 'join', 'single']) {
    assert.equal(seaNameOf(cfg(mode, { name: 'The open sea' })), 'The open sea');
  }
  // The island's own is overridden while hosting even so: the point of the rule is that
  // the host is recognisable, and a default nobody ever changed is the case it is for.
  assert.equal(islandNameOf(cfg('host', { name: 'The open sea' })), MACHINE);
});

test('a config with nothing in it still has a name', () => {
  assert.equal(islandNameOf({}), 'Promptholm');
  assert.equal(islandNameOf(null), 'Promptholm');
  assert.equal(seaNameOf(null), "Promptholm's sea");
});

test('the machine name is the short one, never a fully-qualified host', () => {
  assert.ok(!islandNameOf(cfg('host')).includes('.'), `${MACHINE} should be the short name`);
  assert.ok(MACHINE.length > 0);
});

// The four readers. A grep rather than a run: booting serve.mjs to read one string would
// start a real server, a real scan and a real beacon, and this is the cheaper promise -
// that nobody has quietly gone back to reading config.islandName on the way out.
test('nothing publishes config.islandName directly any more', () => {
  for (const file of ['serve.mjs', 'scan.mjs']) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.equal(src.includes('config.islandName'), false,
      `${file} still reads config.islandName; it should go through islandNameOf()`);
    assert.ok(src.includes('islandNameOf('), `${file} should use islandNameOf()`);
  }
});
