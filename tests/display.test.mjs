// Who is allowed to read a yard sign.
//
// The sign is the one label the island spells out in the world itself rather than in a
// panel you have to open, and what it spells out is the session's opening prompt. The
// page cannot be the one to decide that: a visitor's browser is theirs, not ours. So the
// server answers it at /api/hello and again over SSE, and both answers come from the one
// function below. A stray `!` in it would hand every visitor the prompts and nothing on
// screen would look any different from this side, which is why it is pinned here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { nameplatesVisibleTo, DISPLAY_SETTINGS, setDisplay } from '../lib/paths.mjs';

test('only the keeper reads the signs unless the island says otherwise', () => {
  assert.equal(nameplatesVisibleTo('keeper', 'islander'), true);
  assert.equal(nameplatesVisibleTo('keeper', 'guest'), false);

  assert.equal(nameplatesVisibleTo('everyone', 'islander'), true);
  assert.equal(nameplatesVisibleTo('everyone', 'guest'), true);

  assert.equal(nameplatesVisibleTo('nobody', 'islander'), false);
  assert.equal(nameplatesVisibleTo('nobody', 'guest'), false);

  // A setting that got lost, misspelled or hand-edited into something else falls to the
  // shut answer for a visitor rather than the open one.
  assert.equal(nameplatesVisibleTo(undefined, 'guest'), false);
  assert.equal(nameplatesVisibleTo('Everyone', 'guest'), false);
});

test('a display setting is an allowlist, and refuses before it touches the disk', () => {
  assert.deepEqual(DISPLAY_SETTINGS.nameplates, ['everyone', 'keeper', 'nobody']);
  // Both of these must throw rather than write: config.json is the island's own file and
  // the value arrived over a socket. Nothing is restored afterwards because nothing may
  // have been written - that is the assertion.
  assert.throws(() => setDisplay('port', 4748), /no display setting/);
  assert.throws(() => setDisplay('nameplates', 'sometimes'), /one of/);
});
