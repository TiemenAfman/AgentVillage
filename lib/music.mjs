// The keeper's own music (Plans/piratenkroeg.md): a folder in the island's home with one folder
// per room, into which the keeper drops audio files - `audio/kroeg` for the village tavern,
// `audio/rave` for the castle's Saturday night, `audio/pirates` for the Salty Kraken. A folder
// with files in it plays them one after the other, whole; an empty one leaves the room to the
// music web/js/sound.js computes (the rave and the shanties), or to its murmur.
//
// In HOME and not in the checkout, on purpose: whatever the keeper puts there is theirs to have
// and not the repository's to publish, so its licence is nobody's business but theirs. For the
// same reason the islander serves it only to its own page - the routes are under /api/, which
// lib/access.mjs keeps from every visitor - and nothing of it goes on the sea: a visitor, and
// every other island, hears the computed music.
import fs from 'node:fs';
import path from 'node:path';
import { HOME } from './paths.mjs';

export const MUSIC = path.join(HOME, 'audio');
// Folder -> the room it plays in (interior.js ROOMS names; 'tavern' is the village's).
export const MUSIC_ROOMS = { kroeg: 'tavern', rave: 'rave', pirates: 'piratetavern' };
export const MUSIC_TYPES = {
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.m4a': 'audio/mp4',
  '.aac': 'audio/aac', '.wav': 'audio/wav', '.flac': 'audio/flac',
};

const README = `Promptholm - your own music for the rooms you can walk into.

Put audio files (mp3, ogg, m4a, wav, flac) in these folders:

  kroeg/    the village tavern
  rave/     the castle's rave on a Saturday night
  pirates/  the Salty Kraken

A folder with files in it plays them one after the other, whole, in name order (start the
names with 01, 02 ... to choose the order). An empty folder leaves the room to the music the
island makes itself. Only your own page plays these files: visitors and other islands never
receive them. New files are picked up the next time you walk into the room.
`;

// Make the folders, and the note that says what they are for. Never touches what is in them.
export function ensureMusic(root = MUSIC) {
  try {
    for (const dir of Object.keys(MUSIC_ROOMS)) fs.mkdirSync(path.join(root, dir), { recursive: true });
    const note = path.join(root, 'README.txt');
    if (!fs.existsSync(note)) fs.writeFileSync(note, README);
    return true;
  } catch {
    return false;
  }
}

const playable = (name) => Object.hasOwn(MUSIC_TYPES, path.extname(name).toLowerCase());

// `{ kroeg: [names], rave: [...], pirates: [...] }`, each in name order, playable files only.
export function listMusic(root = MUSIC) {
  const out = {};
  for (const dir of Object.keys(MUSIC_ROOMS)) {
    let names = [];
    try {
      names = fs.readdirSync(path.join(root, dir), { withFileTypes: true })
        .filter((e) => e.isFile() && playable(e.name) && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    } catch { /* no folder is no music */ }
    out[dir] = names;
  }
  return out;
}

// The file a request names, or null: one of the folders, a bare file name in it (no path, no
// dot-dot, nothing hidden), a type a browser plays, and there.
export function musicFile(dir, name, root = MUSIC) {
  if (!Object.hasOwn(MUSIC_ROOMS, dir) || typeof name !== 'string' || !name) return null;
  if (name !== path.basename(name) || name.includes('/') || name.includes('\\') || name.startsWith('.')) return null;
  if (!playable(name)) return null;
  const file = path.join(root, dir, name);
  if (path.dirname(file) !== path.join(root, dir)) return null;
  try { return fs.statSync(file).isFile() ? file : null; } catch { return null; }
}
