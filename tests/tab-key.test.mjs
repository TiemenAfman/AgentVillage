// Tab is no key of the game's (web/js/page-keys.js): outside a field or a dialog it is cancelled,
// or it walked the focus round the HUD's chips. And a jump in movementX/Y when a pointer lock is
// taken must never reach camPitch (walk.js LOOK_JUMP) - it put the camera on the sky.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installPageKeys, tabBelongsToPage } from '../web/js/page-keys.js';

const el = (inZone, tag = 'BUTTON') => ({ tagName: tag, closest: () => (inZone ? {} : null) });

test('Tab is cancelled on the HUD and kept in fields and dialogs', () => {
  const h = {};
  installPageKeys({ addEventListener: (t, fn) => { h[t] = fn; } });
  const press = (target) => { let cancelled = false; h.keydown({ key: 'Tab', target, preventDefault: () => { cancelled = true; } }); return cancelled; };
  assert.equal(press(el(false)), true);
  assert.equal(press(el(false, 'CANVAS')), true);
  assert.equal(press(el(true)), false);
  assert.equal(press(el(false, 'INPUT')), false);
  assert.equal(tabBelongsToPage(null), false);
});

test('walk mode drops the first locked move and any jump', () => {
  const src = readFileSync(new URL('../web/js/walk.js', import.meta.url), 'utf8');
  assert.match(src, /freshLock = true/);
  assert.match(src, /freshLock \|\| Math\.abs\(dx\) > LOOK_JUMP \|\| Math\.abs\(dy\) > LOOK_JUMP/);
});
