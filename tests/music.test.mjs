// The keeper's own music (lib/music.mjs): folders in HOME/audio the islander serves to its own
// page only. What is held: the folders are made without touching what is in them, a list is
// playable files in name order, a request can name only a file in one of the folders, and the
// routes are not ones a visitor reaches.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureMusic, listMusic, musicFile, MUSIC_ROOMS } from '../lib/music.mjs';
import { isPublicPath } from '../lib/access.mjs';

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'promptholm-music-'));

test('the folders are made once, with a note, and nothing in them is touched', () => {
  const root = scratch();
  assert.ok(ensureMusic(root));
  for (const dir of ['kroeg', 'rave', 'pirates']) assert.ok(fs.statSync(path.join(root, dir)).isDirectory(), dir);
  assert.match(fs.readFileSync(path.join(root, 'README.txt'), 'utf8'), /pirates\/\s+the Salty Kraken/);
  fs.writeFileSync(path.join(root, 'pirates', 'a.mp3'), 'x');
  fs.writeFileSync(path.join(root, 'README.txt'), 'mine');
  ensureMusic(root);
  assert.equal(fs.readFileSync(path.join(root, 'pirates', 'a.mp3'), 'utf8'), 'x');
  assert.equal(fs.readFileSync(path.join(root, 'README.txt'), 'utf8'), 'mine', 'the note is not written again');
  assert.deepEqual(Object.values(MUSIC_ROOMS), ['tavern', 'rave', 'piratetavern']);
});

test('a list is the playable files of each folder, in the order their names give', () => {
  const root = scratch();
  ensureMusic(root);
  for (const n of ['10 last.mp3', '2 second.ogg', '01 first.MP3', 'cover.jpg', '.hidden.mp3', 'notes.txt']) {
    fs.writeFileSync(path.join(root, 'pirates', n), 'x');
  }
  fs.mkdirSync(path.join(root, 'pirates', 'sub.mp3'));
  const lists = listMusic(root);
  assert.deepEqual(lists.pirates, ['01 first.MP3', '2 second.ogg', '10 last.mp3']);
  assert.deepEqual(lists.kroeg, []);
  assert.deepEqual(listMusic(path.join(root, 'nowhere')), { kroeg: [], rave: [], pirates: [] });
});

test('a request names a file in one of the folders, or nothing', () => {
  const root = scratch();
  ensureMusic(root);
  fs.writeFileSync(path.join(root, 'rave', 'set.mp3'), 'x');
  fs.writeFileSync(path.join(root, 'secret.mp3'), 'x');
  assert.equal(musicFile('rave', 'set.mp3', root), path.join(root, 'rave', 'set.mp3'));
  for (const [dir, name] of [['rave', '../secret.mp3'], ['rave', '..\\secret.mp3'], ['..', 'secret.mp3'], ['data', 'set.mp3'],
    ['rave', 'nope.mp3'], ['rave', 'set.exe'], ['rave', ''], ['rave', '.set.mp3'], ['constructor', 'set.mp3'], ['rave', null]]) {
    assert.equal(musicFile(dir, name, root), null, `${dir}/${name}`);
  }
});

test('a visitor reaches none of it', () => {
  assert.equal(isPublicPath('/api/music'), false);
  assert.equal(isPublicPath('/api/music/pirates/01.mp3'), false);
});
