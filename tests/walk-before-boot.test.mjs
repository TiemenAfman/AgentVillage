// Walking before the island stands. The chips are created with the ui, long before boot() has
// fetched the village, and Enter (ORBIT_KEYS) pressed the walk chip under the boot screen:
// enterWalk read `state.village.island` off a null and threw. Booting all of main.js under
// Node is not something any test here does, so this reads the source for the two gates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// Some files are checked out with CRLF; the patterns below speak in \n.
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const main = read('web/js/main.js');

const body = (name) => {
  const at = main.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `${name} is where it was`);
  return main.slice(at, main.indexOf('\n}\n', at));
};

test('enterWalk returns before reading anything the boot has not made', () => {
  const code = body('enterWalk').split('\n').slice(1).filter((l) => !/^\s*\/\//.test(l));
  assert.match(code[0], /if \(!state\.walk \|\| !state\.village\) return;/,
    'the first statement of enterWalk is the gate - every caller, key, pad or eviction, goes through it');
});

test('the walk mode and the village are both made before the boot screen goes', () => {
  const boot = body('boot');
  const walk = boot.indexOf('state.walk = createWalkMode(');
  const village = boot.indexOf('applyVillage(village');
  const done = boot.indexOf('state.ui.boot(true)');
  assert.ok(walk >= 0 && village >= 0 && done >= 0, 'boot() still raises the island the same way');
  assert.ok(walk < done && village < done, 'so the gate is open by the time anybody can see a chip');
});

test('the chips\' keys wait for the boot screen, which covers the chips themselves', () => {
  assert.match(main, /else if \(chip && !openPanel\(\) && !booting\(\)\)/);
  assert.match(body('booting'), /classList\.contains\('gone'\)/);
  assert.match(read('web/js/ui.js'), /el\('boot'\)\.classList\.add\('gone'\)/,
    'and `gone` is what ui.js boot(true) puts on it');
});
