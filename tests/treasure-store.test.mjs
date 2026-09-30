// The treasure statue's store (lib/treasure.mjs, data/treasure.json) and the door to it.
//
// data/treasure.json is one of the irreplaceable files under data/, so most of this is about
// what can go wrong on the way to it: a file that is torn or from a newer island, a statue
// asked to leave its plinth, two requests in a row, a write that would leave a half-file.
// The bundle's side of the same field is in island-bundle.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';
register('./support/shared-loader.mjs', import.meta.url);

// lib/treasure.mjs reads DATA from lib/paths.mjs, which decides HOME while it is being
// imported and - without PROMPTHOLM_HOME - may copy a whole island (tests/home.test.mjs). So
// HOME is pinned to a scratch folder BEFORE the module is loaded, and a static import here
// (hoisted above this line) would defeat that.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'promptholm-treasure-'));
process.env.PROMPTHOLM_HOME = home;
const T = await import('../lib/treasure.mjs');
const { createAccess, isPublicPath } = await import('../lib/access.mjs');
const { TREASURE_FOUND_MAX: BUNDLE_MAX } = await import('../lib/islandbundle.mjs');

const here = path.dirname(fileURLToPath(import.meta.url));
const source = (f) => fs.readFileSync(path.join(here, '..', f), 'utf8');
let n = 0;
const fresh = () => path.join(home, 'data', `treasure-${n++}.json`);
const NOW = Date.parse('2026-09-29T12:00:00Z');

test('the file lives in the scratch HOME, never in the real island', () => {
  assert.equal(path.dirname(T.TREASURE_FILE), path.join(home, 'data'));
  assert.equal(path.basename(T.TREASURE_FILE), 'treasure.json');
});

test('a new island has its statue buried and nothing found', () => {
  assert.deepEqual(T.loadTreasure({ file: fresh() }), { statue: 'buried', found: 0, placedAt: null });
  assert.deepEqual(T.viewOf(T.defaultTreasure()), { placed: false, found: 0 });
});

test('placing: from buried or lifted, stamped once, and never back', () => {
  const buried = T.defaultTreasure();
  const placed = T.apply(buried, 'placed', { now: NOW });
  assert.equal(placed.statue, 'placed');
  assert.equal(placed.placedAt, '2026-09-29T12:00:00.000Z');
  assert.deepEqual(T.apply(T.apply(buried, 'lifted'), 'placed', { now: NOW }), placed);
  // A second screen delivering it again changes nothing - not even the time.
  const again = T.apply(placed, 'placed', { now: NOW + 60000 });
  assert.equal(again.placedAt, placed.placedAt);
  assert.ok(T.sameTreasure(again, placed));
  // And no action takes it off the plinth.
  assert.throws(() => T.apply(placed, 'lifted'), /already stands/);
  assert.throws(() => T.apply(placed, 'dropped'), /already stands/);
});

test('lifting and dropping: a statue carried off can be put back on its islet', () => {
  const lifted = T.apply(T.defaultTreasure(), 'lifted');
  assert.equal(lifted.statue, 'lifted');
  assert.ok(T.sameTreasure(T.apply(lifted, 'lifted'), lifted));
  assert.equal(T.apply(lifted, 'dropped').statue, 'buried');
  assert.ok(T.sameTreasure(T.apply(T.defaultTreasure(), 'dropped'), T.defaultTreasure()));
  // Carrying it is nobody else's business: the village reads it as not placed.
  assert.deepEqual(T.viewOf(lifted), { placed: false, found: 0 });
});

test('finding counts one at a time, in any state, up to the cap the bundle also has', () => {
  let s = T.defaultTreasure();
  for (let i = 0; i < 3; i++) s = T.apply(s, 'found');
  assert.equal(s.found, 3);
  assert.equal(T.apply(T.apply(s, 'placed', { now: NOW }), 'found').found, 4);
  assert.equal(T.apply({ ...s, found: T.TREASURE_FOUND_MAX }, 'found').found, T.TREASURE_FOUND_MAX);
  assert.equal(T.TREASURE_FOUND_MAX, BUNDLE_MAX, 'the store writes what a bundle can carry');
  assert.deepEqual(T.viewOf(s), { placed: false, found: 3 });
});

test('the reducer does not touch its input and refuses an action it does not know', () => {
  const s = Object.freeze({ statue: 'buried', found: 1, placedAt: null });
  assert.equal(T.apply(s, 'found').found, 2);
  assert.equal(s.found, 1);
  for (const bad of ['', 'place', 'PLACED', undefined, null, 7]) {
    assert.throws(() => T.apply(s, bad), /action is one of placed, found, lifted, dropped/);
  }
});

test('junk in a state is made sane rather than thrown at', () => {
  assert.deepEqual(T.sane(null), T.defaultTreasure());
  assert.deepEqual(T.sane([1, 2]), T.defaultTreasure());
  assert.deepEqual(T.sane('placed'), T.defaultTreasure());
  assert.deepEqual(T.sane({ statue: 'sunk', found: 2.5 }), T.defaultTreasure());
  assert.deepEqual(T.sane({ statue: 'buried', found: -4 }), T.defaultTreasure());
  assert.equal(T.sane({ found: 1e12 }).found, T.TREASURE_FOUND_MAX);
  // A time means something only beside 'placed', and only if it is a time.
  assert.equal(T.sane({ statue: 'buried', placedAt: '2026-09-29T12:00:00Z' }).placedAt, null);
  assert.equal(T.sane({ statue: 'placed', placedAt: 'yesterday' }).placedAt, null);
});

test('writing and reading it back, atomically, leaving no half-file behind', () => {
  const file = fresh();
  T.updateTreasure('found', { file, now: NOW });
  const r = T.updateTreasure('placed', { file, now: NOW });
  assert.equal(r.changed, true);
  assert.equal(r.viewChanged, true);
  assert.deepEqual(r.view, { placed: true, found: 1 });
  assert.deepEqual(T.loadTreasure({ file }), { statue: 'placed', found: 1, placedAt: '2026-09-29T12:00:00.000Z' });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).v, T.TREASURE_V);
  // Renamed over, not written in place: no temp file survives the write.
  const stray = fs.readdirSync(path.dirname(file)).filter((f) => f.startsWith(path.basename(file)) && f !== path.basename(file));
  assert.deepEqual(stray, []);
});

test('an action that changes nothing writes nothing, and only a visible change asks for a rescan', () => {
  const file = fresh();
  T.updateTreasure('placed', { file, now: NOW });
  const before = fs.statSync(file).mtimeMs;
  const twice = T.updateTreasure('placed', { file, now: NOW + 5000 });
  assert.equal(twice.changed, false);
  assert.equal(twice.viewChanged, false);
  assert.equal(fs.statSync(file).mtimeMs, before);
  // Lifting is the carrier's: it writes, but village.json would read the same.
  const f2 = fresh();
  const lifted = T.updateTreasure('lifted', { file: f2 });
  assert.equal(lifted.changed, true);
  assert.equal(lifted.viewChanged, false);
  assert.equal(T.updateTreasure('found', { file: f2 }).viewChanged, true);
});

test('a refused move leaves the file exactly as it was', () => {
  const file = fresh();
  T.updateTreasure('placed', { file, now: NOW });
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => T.updateTreasure('dropped', { file }), /already stands/);
  assert.throws(() => T.updateTreasure('nonsense', { file }), /action is one of/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('a torn file reads as the default and is kept aside before it is written over', () => {
  const file = fresh();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{"v":1,"statue":"pla');
  assert.deepEqual(T.loadTreasure({ file }), T.defaultTreasure());
  T.updateTreasure('found', { file, now: NOW });
  assert.equal(T.loadTreasure({ file }).found, 1);
  const aside = fs.readdirSync(path.dirname(file)).filter((f) => f.startsWith(`${path.basename(file)}.unreadable-`));
  assert.equal(aside.length, 1);
  assert.equal(fs.readFileSync(path.join(path.dirname(file), aside[0]), 'utf8'), '{"v":1,"statue":"pla');
});

test('a file from a newer island reads as the default and is kept, not overwritten unseen', () => {
  const file = fresh();
  const theirs = JSON.stringify({ v: T.TREASURE_V + 1, statue: 'placed', found: 40, harbour: 'new' });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, theirs);
  assert.deepEqual(T.loadTreasure({ file }), T.defaultTreasure());
  T.updateTreasure('found', { file, now: NOW });
  const aside = fs.readdirSync(path.dirname(file)).filter((f) => f.startsWith(`${path.basename(file)}.unreadable-`));
  assert.equal(aside.length, 1);
  assert.equal(fs.readFileSync(path.join(path.dirname(file), aside[0]), 'utf8'), theirs);
});

test('a well-formed file is not copied aside on every write', () => {
  const file = fresh();
  T.updateTreasure('found', { file, now: NOW });
  T.updateTreasure('found', { file, now: NOW + 1 });
  const aside = fs.readdirSync(path.dirname(file)).filter((f) => f.startsWith(`${path.basename(file)}.unreadable-`));
  assert.deepEqual(aside, []);
});

// ---- the door -----------------------------------------------------------------------

const req = ({ addr = '127.0.0.1', host = 'localhost:4747', origin } = {}) =>
  ({ socket: { remoteAddress: addr }, headers: { host, ...(origin ? { origin } : {}) } });
const access = (open) => createAccess({ port: 4747, config: { network: { public: open, inviteCode: 'sesame', hosts: [] }, multiplayer: {} } });

test('the route is not public: deny-by-default in lib/access.mjs, and no exception added', () => {
  assert.equal(isPublicPath('/api/treasure'), false);
  assert.ok(!/treasure/i.test(source('lib/access.mjs')), 'lib/access.mjs was given a treasure exception');
});

test('only a loopback socket with a known Host and no foreign Origin is the keeper', () => {
  const url = new URL('http://localhost:4747/api/treasure');
  const shut = access(false), open = access(true);
  assert.equal(shut.classify(req(), url).role, 'islander');
  // serve.mjs answers 403 to everyone who is not 'islander' on a non-public path.
  for (const a of [shut, open]) {
    for (const r of [
      req({ addr: '192.168.1.9' }),                      // the same network
      req({ addr: '203.0.113.7' }),                      // outside
      req({ origin: 'https://evil.example' }),           // a page on another site, over loopback
      req({ host: 'evil.example' }),                     // DNS rebinding
    ]) {
      assert.notEqual(a.classify(r, url).role, 'islander', JSON.stringify(r));
    }
  }
});

test('serve.mjs wires the route, the store and the rescan; scan.mjs writes village.treasure', () => {
  const serve = source('serve.mjs');
  assert.match(serve, /p === '\/api\/treasure'/);
  assert.match(serve, /updateTreasure\(action\)/);
  assert.match(serve, /if \(done\.viewChanged\) await rescan\('treasure'\)/);
  assert.match(source('scan.mjs'), /treasure: treasureView\(loadTreasure\(\)\)/);
});

test('the sea never imports the store: it holds nothing on disk (Dockerfile.sea names its files)', () => {
  // The sea shares lib/islandbundle.mjs, so this is the edge that must stay one-way: the
  // store imports the bundle's cap, and the bundle never imports the store.
  assert.ok(!/from '\.\/treasure\.mjs'/.test(source('lib/islandbundle.mjs')));
  for (const f of ['lib/sea.mjs', 'lib/fleet.mjs', 'sea.mjs']) {
    assert.ok(!/treasure\.mjs/.test(source(f)), `${f} imports the treasure store`);
  }
});
