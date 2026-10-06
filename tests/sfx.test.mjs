// The keeper's own recordings (Plans/meer-geluiden.md, phase 9): the names a file in
// HOME/audio/sfx may have (shared/sfx.mjs), the folder and the two routes (lib/sfx.mjs). What is
// held: a family is one of sound.js's own voices, variants are told apart by a suffix, the folder
// is made with its notes and the keeper's SOURCES.txt is never written over, a request names only
// a family's file in the folder, and no visitor reaches any of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SFX_FAMILIES, SFX_EXTS, sfxFamilyOf, sfxLoops } from '../shared/sfx.mjs';
import { ensureSfx, listSfx, sfxFile } from '../lib/sfx.mjs';
import { MUSIC_TYPES } from '../lib/music.mjs';
import { isPublicPath } from '../lib/access.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOUND = fs.readFileSync(path.join(HERE, '..', 'web', 'js', 'sound.js'), 'utf8');
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'promptholm-sfx-'));

test('every family is a voice sound.js makes, under the name it makes it', () => {
  const lazy = SOUND.slice(SOUND.indexOf('const LAZY = {'), SOUND.indexOf('function* once('));
  for (const name of Object.keys(SFX_FAMILIES)) {
    assert.ok(new RegExp(`\\b${name}\\b`).test(lazy) || new RegExp(`^  ${name}: \\(c\\) =>`, 'm').test(SOUND), `${name} is no voice of sound.js`);
  }
  assert.equal(sfxLoops('surf'), true);
  assert.equal(sfxLoops('gull'), false);
  assert.equal(sfxLoops('constructor'), false);
});

test('a file is a family, a dash and anything, and an extension a browser plays', () => {
  for (const [file, family] of [['surf.ogg', 'surf'], ['surf-1.ogg', 'surf'], ['Surf-2.OGG', 'surf'],
    ['gull-herring_far.mp3', 'gull'], ['murmur-kroeg.1.wav', 'murmur'], ['moo-3.m4a', 'moo']]) {
    assert.equal(sfxFamilyOf(file), family, file);
  }
  for (const file of ['surfing.ogg', 'surf.txt', 'surf', '.surf.ogg', '../surf.ogg', 'sub/surf.ogg', 'surf 1.ogg',
    'greet0.ogg', 'rave.mp3', 'constructor.ogg', '1-surf.ogg', null, 'surf-1.ogg'.padEnd(200, 'x')]) {
    assert.equal(sfxFamilyOf(file), null, String(file));
  }
  for (const ext of SFX_EXTS) assert.ok(MUSIC_TYPES[ext], `the islander has a content type for ${ext}`);
});

test('the folder is made with its notes, and the keeper\'s list of sources is never written over', () => {
  const root = path.join(scratch(), 'sfx');
  assert.ok(ensureSfx(root));
  const readme = fs.readFileSync(path.join(root, 'README.txt'), 'utf8');
  for (const name of Object.keys(SFX_FAMILIES)) assert.match(readme, new RegExp(`^  ${name} `, 'm'), name);
  fs.writeFileSync(path.join(root, 'SOURCES.txt'), 'surf-1.ogg  freesound  CC0');
  fs.writeFileSync(path.join(root, 'README.txt'), 'old');
  ensureSfx(root);
  assert.equal(fs.readFileSync(path.join(root, 'SOURCES.txt'), 'utf8'), 'surf-1.ogg  freesound  CC0');
  assert.equal(fs.readFileSync(path.join(root, 'README.txt'), 'utf8'), readme, 'the README is ours and says the names as they are now');
});

test('a list is every family with a file, in name order; anything else is left out', () => {
  const root = scratch();
  for (const n of ['surf-10.ogg', 'surf-2.ogg', 'surf-1.ogg', 'gull.mp3', 'notes.txt', 'rave.mp3', '.surf-3.ogg', 'SOURCES.txt']) {
    fs.writeFileSync(path.join(root, n), 'x');
  }
  fs.mkdirSync(path.join(root, 'wind-1.ogg'));
  assert.deepEqual(listSfx(root), { surf: ['surf-1.ogg', 'surf-2.ogg', 'surf-10.ogg'], gull: ['gull.mp3'] });
  assert.deepEqual(listSfx(path.join(root, 'nowhere')), {});
});

test('a request names a family\'s file in the folder, or nothing', () => {
  const root = scratch();
  fs.writeFileSync(path.join(root, 'gull-1.ogg'), 'x');
  fs.writeFileSync(path.join(root, 'notes.txt'), 'x');
  assert.equal(sfxFile('gull-1.ogg', root), path.join(root, 'gull-1.ogg'));
  for (const name of ['gull-2.ogg', 'notes.txt', '../gull-1.ogg', '..\\gull-1.ogg', 'sfx/gull-1.ogg', '', null]) {
    assert.equal(sfxFile(name, root), null, String(name));
  }
});

test('a visitor reaches none of it', () => {
  assert.equal(isPublicPath('/api/sfx'), false);
  assert.equal(isPublicPath('/api/sfx/gull-1.ogg'), false);
});
