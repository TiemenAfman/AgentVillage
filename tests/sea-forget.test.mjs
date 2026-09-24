// Taking an address off the picker's list.
//
// `known` grows by itself, which is the whole point of the picker - a url you typed once is
// one you will want again. That is also why it needs a way back: a typo, a machine that has
// gone, an address that moved. Without one the only way to shorten the list is to edit
// config.json by hand, which is exactly what the picker was built to avoid.
//
// Two refusals matter more than the removal. The sea this island is *in* is not an address
// to forget, it is a world to leave - and leaving is what the three cards do. And an
// address that is not on the list has to say so rather than report success, or a button
// that does nothing looks like a button that worked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { forgetSea, isOpenSea, OPEN_SEA } from '../lib/paths.mjs';

const A = 'https://one.example/';
const B = 'https://two.example/';

// A config of our own, because the real one belongs to whoever is running this.
function config(sea) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sea-forget-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({
    islandName: 'Testholm',
    multiplayer: { enabled: true, sea: { mode: 'single', url: null, key: 'k', port: 4750, name: null, known: [A, B], ...sea } },
  }, null, 2));
  return file;
}

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('an address goes, and nothing else does', () => {
  const file = config();
  const sea = forgetSea(A, { file });
  assert.deepEqual(sea.known, [B]);

  // On disk too, and with the rest of the block intact - a key wiped by a housekeeping
  // button is a sea you can no longer reach and no clue why.
  const after = read(file);
  assert.deepEqual(after.multiplayer.sea.known, [B]);
  assert.equal(after.multiplayer.sea.key, 'k');
  assert.equal(after.multiplayer.sea.port, 4750);
  assert.equal(after.islandName, 'Testholm', 'the rest of config.json was rewritten');
});

test('the sea we are in is left, not forgotten', () => {
  const file = config({ mode: 'join', url: A });
  assert.throws(() => forgetSea(A, { file }), /the sea we are in/);
  // And it really did not go.
  assert.deepEqual(read(file).multiplayer.sea.known, [A, B]);
  // The other one still can.
  assert.deepEqual(forgetSea(B, { file }).known, [A]);
});

test('an address that is not on the list says so', () => {
  const file = config();
  assert.throws(() => forgetSea('https://three.example/', { file }), /not one of the saved/);
  assert.throws(() => forgetSea('', { file }), /is not an address/);
  assert.throws(() => forgetSea('not a url', { file }), /is not an address/);
  assert.deepEqual(read(file).multiplayer.sea.known, [A, B]);
});

test('a capital in a hostname does not make a row that cannot be removed', () => {
  // The real one: the default list ships this with capitals, new URL() lowercases a
  // hostname, and the comparison was against the raw string - so the row somebody would
  // most want rid of was the one row that refused to go, while being shown to them.
  const DEFAULT = 'http://AgentVillage.freeddns.org:4750/';
  const file = config({ known: [DEFAULT, B] });
  assert.deepEqual(forgetSea(DEFAULT, { file }).known, [B]);
});

test('the same address written two ways is one address', () => {
  // A url goes through URL() on the way in and on the way out, so the trailing slash a
  // person does or does not type cannot make a row that is impossible to remove.
  const file = config();
  assert.deepEqual(forgetSea('https://one.example', { file }).known, [B]);
});

test('the last sea chosen, left behind in `url`, can be forgotten too', () => {
  // Back on its own after a join, the island still remembers where it last sailed; the
  // picker lists that as a row ('chosen'), and a row you can see is a row you can remove.
  const C = 'https://three.example/';
  const file = config({ mode: 'single', url: C });
  const sea = forgetSea(C, { file });
  assert.equal(sea.url, null);
  assert.deepEqual(sea.known, [A, B], 'the saved list is untouched');
  assert.equal(read(file).multiplayer.sea.url, null);
});

test('the open sea is recognised in any spelling, so it never lands among the local seas', () => {
  assert.equal(isOpenSea(OPEN_SEA), true);
  assert.equal(isOpenSea('http://agentvillage.xeroxmsj.freeddns.org:4750/'), true);
  assert.equal(isOpenSea('HTTPS://AgentVillage.xeroxmsj.freeddns.org'), true);
  assert.equal(isOpenSea('http://192.168.1.37:4750/'), false);
  assert.equal(isOpenSea('not a url'), false);
  // And /api/seas leaves such a spelling out of the saved rows (serve.mjs, the offer loop).
  const src = fs.readFileSync(new URL('../serve.mjs', import.meta.url), 'utf8');
  assert.match(src, /if \(!isOpenSea\(url\)\) offer\(/);
  assert.match(src, /cfg\.url && !isOpenSea\(cfg\.url\)/);
});

test('the open sea cannot be forgotten', () => {
  // It is offered by /api/seas whatever `known` says, so taking it off the list would be a
  // button that reports success and changes nothing. Refused, in whatever spelling, and
  // the file is left alone.
  const file = config({ known: [OPEN_SEA, B] });
  assert.throws(() => forgetSea(OPEN_SEA, { file }), /always on the list/);
  assert.throws(() => forgetSea('HTTPS://agentvillage.xeroxmsj.freeddns.org', { file }), /always on the list/);
  assert.deepEqual(read(file).multiplayer.sea.known, [OPEN_SEA, B]);
});
