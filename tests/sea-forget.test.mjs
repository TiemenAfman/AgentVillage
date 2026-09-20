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
import { forgetSea } from '../lib/paths.mjs';

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

test('the same address written two ways is one address', () => {
  // A url goes through URL() on the way in and on the way out, so the trailing slash a
  // person does or does not type cannot make a row that is impossible to remove.
  const file = config();
  assert.deepEqual(forgetSea('https://one.example', { file }).known, [B]);
});
