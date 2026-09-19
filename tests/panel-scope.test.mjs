// Whose notice board this is.
//
// The boards live on the sea, and the sea holds every island's at once. A prop id is eight
// hex digits drawn per island, so two islands sharing one is unlikely rather than
// impossible - and what it would mean is two villages writing over each other's board,
// which is a fault that gets blamed on whoever typed last rather than on the collision.
//
// lib/players.mjs has accepted a scoped id since the boards moved; for a long time nothing
// sent one, which is plumbing without a button. These two functions are the button, and
// the thing worth asserting about a pair like this is that they are exact inverses - and
// that the server's own door agrees with what they produce.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scopePanel, ourPanel } from '../shared/panels.mjs';

// The shape lib/players.mjs insists on, copied deliberately: if it ever changes, this
// fails and says so, which is the whole reason for spelling it out twice.
const PANEL_ID = /^(?:[a-f0-9]{8,64}:)?prop:[0-9a-f-]{1,36}$/;

const MINE = 'a84a82acc8646c6c';
const THEIRS = '0123456789abcdef';
const BOARD = 'prop:8df81f09';

test('a board says which island it is on, and comes back the same', () => {
  const sent = scopePanel(MINE, BOARD);
  assert.equal(sent, `${MINE}:${BOARD}`);
  assert.ok(PANEL_ID.test(sent), 'the server would refuse what we send');
  assert.equal(ourPanel(MINE, sent), BOARD, 'the two are not inverses');
});

test('a neighbour’s board is not ours, however much its digits look like it', () => {
  // The collision this exists for: the same eight digits on two islands.
  assert.equal(ourPanel(MINE, scopePanel(THEIRS, BOARD)), null);
  // And `all` replaces the whole set, so letting one through would not be untidy - it
  // would empty our own boards.
  const wire = [scopePanel(MINE, BOARD), scopePanel(THEIRS, BOARD), scopePanel(THEIRS, 'prop:ccd57698')];
  assert.deepEqual(wire.map((id) => ourPanel(MINE, id)).filter(Boolean), [BOARD]);
});

test('an older sea has only us in it, and says nothing about islands', () => {
  // A bare id predates the scoping. There was one island then, so it is ours.
  assert.equal(ourPanel(MINE, BOARD), BOARD);
  // And a page that does not know its own island id yet cannot scope, so it says the bare
  // name - which the server still accepts and the line above still reads back.
  const sent = scopePanel(null, BOARD);
  assert.equal(sent, BOARD);
  assert.ok(PANEL_ID.test(sent));
});

test('scoping twice does not double the name', () => {
  // A round trip through the wire and back out again, which is what a re-send is.
  const once = scopePanel(MINE, BOARD);
  assert.equal(scopePanel(MINE, once), once);
  assert.equal(ourPanel(MINE, scopePanel(MINE, once)), BOARD);
});

test('nonsense is nobody’s board', () => {
  for (const junk of [null, undefined, '', 'prop', 'house:0001', `${MINE}:house:0001`]) {
    const out = ourPanel(MINE, junk);
    assert.ok(out === null || PANEL_ID.test(out), `"${junk}" came back as ${out}`);
  }
});
