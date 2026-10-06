// The keeper's own sound samples (Plans/meer-geluiden.md, phase 9): HOME/audio/sfx, beside the
// rooms' music in HOME/audio (lib/music.mjs) and under the same rules. What is in it is the
// keeper's, under whatever licence the keeper got it - so it is never in the checkout, never in
// a release and never on the sea, and only this machine's own page hears it: the routes are under
// /api/ and not on PUBLIC_API, which lib/access.mjs keeps from every visitor. A visitor, a phone
// and the web hear the island's computed sounds.
//
// Which names a file may have is shared/sfx.mjs (one family per computed voice, variants by a
// suffix); the README written here says so to whoever opens the folder, and SOURCES.txt is the
// keeper's own list of where each file came from - written once, never again.
import fs from 'node:fs';
import path from 'node:path';
import { MUSIC } from './music.mjs';
import { SFX_FAMILIES, sfxFamilyOf } from '../shared/sfx.mjs';

export const SFX = path.join(MUSIC, 'sfx');

function readme() {
  const width = Math.max(...Object.keys(SFX_FAMILIES).map((n) => n.length)) + 2;
  const line = ([name, [, what]]) => `  ${name.padEnd(width)}${what}`;
  const all = Object.entries(SFX_FAMILIES);
  return `Promptholm - your own recordings for the island's sounds.

Every sound on the island is computed. A file in this folder replaces one of them on your own
page: the island plays your recording instead, at the loudness the computed one had (so a
file recorded loud or soft does not upset the mix - the sliders under Settings -> Audio still
work). Delete the file and the computed sound comes back.

Name a file after the sound it replaces, with any of these extensions:
  .ogg .opus .mp3 .wav .m4a .aac .flac

Several files for one sound are variants: name them surf-1.ogg, surf-2.ogg, gull-herring.mp3 -
the name, a dash, and anything after it (letters, digits, - and _). A short sound plays one of
its variants at random each time; a loop plays all of them, one after the other, joined by a
crossfade of a second or two and from the last back to the first, so it has no seam. Keep a
loop's files under 90 seconds each (longer is cut there) and a short sound short.

Loops (beds and sounds with a place):
${all.filter(([, [loop]]) => loop).map(line).join('\n')}

Short sounds:
${all.filter(([, [loop]]) => !loop).map(line).join('\n')}

A sound is loaded the first time something that makes it is within earshot, and the folder is
read again whenever you walk through a door - or reload the page. Only your own page plays
these files: visitors, other islands, the phone and the web never receive them.

Keep track of where each file came from in SOURCES.txt. CC0 recordings (Freesound's CC0 filter)
are the easy kind: nobody has to be named.
`;
}

const SOURCES = `# Where each file in this folder came from, and under which licence.
# One line per file, for example:
#
#   surf-1.ogg   https://freesound.org/s/123456/   CC0   waves on a pebble beach, trimmed
#
`;

// Make the folder and its two notes. The README is written again when the list of names has
// changed (it is ours: it says what the names are); SOURCES.txt is the keeper's and is only ever
// written when it is not there.
export function ensureSfx(root = SFX) {
  try {
    fs.mkdirSync(root, { recursive: true });
    const note = path.join(root, 'README.txt'), text = readme();
    let had = null;
    try { had = fs.readFileSync(note, 'utf8'); } catch { /* not there yet */ }
    if (had !== text) fs.writeFileSync(note, text);
    const sources = path.join(root, 'SOURCES.txt');
    if (!fs.existsSync(sources)) fs.writeFileSync(sources, SOURCES);
    return true;
  } catch {
    return false;
  }
}

// `{ surf: ['surf-1.ogg', 'surf-2.ogg'], gull: [...] }`: every family with a file, each in name
// order. Files whose name is no family, hidden files and folders are left out.
export function listSfx(root = SFX) {
  const out = {};
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isFile()) continue;
    const family = sfxFamilyOf(e.name);
    if (family) (out[family] = out[family] || []).push(e.name);
  }
  for (const names of Object.values(out)) names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  return out;
}

// The file a request names, or null: a bare name a family owns, and there. sfxFamilyOf already
// refuses a slash, a backslash and a name that does not start with a letter; the basename check
// says so again in this file's own terms.
export function sfxFile(name, root = SFX) {
  if (typeof name !== 'string' || name !== path.basename(name) || name.includes('\\') || !sfxFamilyOf(name)) return null;
  const file = path.join(root, name);
  try { return fs.statSync(file).isFile() ? file : null; } catch { return null; }
}
