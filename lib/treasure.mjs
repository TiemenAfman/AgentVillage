// The treasure statue and the count of treasures found (Plans/schatkaarten.md, "Twee lagen").
//
// data/treasure.json is IRREPLACEABLE, like layout.json, garden.json, mail.json and
// animal-events.jsonl: the statue is unique, and `found` is a tally nothing else can rebuild.
// Deleting it puts the statue back on its islet and the plaque back on zero. It has its own
// file and one writer, for the boatyard's reason (lib/boatyard.mjs): layout.json belongs to
// the scan, and a second writer beside it is a race that loses something the one time it
// matters. scan.mjs reads this and writes `village.treasure` (see `viewOf`), which is where
// the bundle and every page pick it up.
//
// The state is a word and two numbers:
//
//   statue: 'buried'  lies on its islet, where the first treasure map points (the default)
//           'lifted'  somebody carries it, or it stands on their boat
//           'placed'  stands in the town centre, for good
//   found:  chests dug up so far
//   placedAt: ISO time it was set down, null until then
//
// `lifted` is recorded so a second screen can see the statue is gone from the islet, but it
// is soft on purpose: a page that closes mid-voyage sends `dropped`, and a page that crashes
// sends nothing - so a stale `lifted` is a statue the PAGE puts back on the islet when it
// loads, and the next `placed` still works from it (Plans: "herladen zet het beeld terug op
// het eilandje"). What can never happen is `placed` going back: once it stands, no action
// moves it, so the unique statue cannot be lost by any sequence of requests.
//
// `apply` is the pure reducer and knows no clock and no disk; `update` is the one door that
// reads, applies and writes, all synchronously - so two requests cannot interleave between
// the read and the write, and nothing holds a file handle across an event-loop turn. That
// second part is not tidiness: on Windows a rename over a file that any handle has open fails
// with EPERM (writeJsonAtomic's retry only covers a moment), and a page mid-download of a data
// file is exactly how a scan once lost a write.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, readJson, writeJsonAtomic } from './paths.mjs';
import { TREASURE_FOUND_MAX } from './islandbundle.mjs';

export const TREASURE_FILE = path.join(DATA, 'treasure.json');

// Bumped only when an older reader would misread the file. A file with a version above ours
// was written by a newer island; we neither trust it nor overwrite it unseen (see `save`).
export const TREASURE_V = 1;
export const STATUE_STATES = ['buried', 'lifted', 'placed'];
export const TREASURE_ACTIONS = ['placed', 'found', 'lifted', 'dropped'];
// The same number the bundle caps `found` at, so what we write is always something a
// bundle can carry. One copy: lib/islandbundle.mjs, which the sea shares.
export { TREASURE_FOUND_MAX };

export function defaultTreasure() {
  return { statue: 'buried', found: 0, placedAt: null };
}

// Anything that came off the disk, made into a state. Never throws: a hand-edited or
// half-written file is a statue on its islet, not a crashed scan.
export function sane(raw) {
  const out = defaultTreasure();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  if (STATUE_STATES.includes(raw.statue)) out.statue = raw.statue;
  if (Number.isInteger(raw.found)) out.found = Math.max(0, Math.min(TREASURE_FOUND_MAX, raw.found));
  // A time is only meaningful beside `placed`; anywhere else it would be a lie about when.
  if (out.statue === 'placed' && typeof raw.placedAt === 'string' && Number.isFinite(Date.parse(raw.placedAt))) out.placedAt = raw.placedAt;
  return out;
}

// What is on disk, or the default. A file from a newer island (`v` above ours) reads as the
// default too - we cannot tell what it means - and `save` keeps it aside instead of
// replacing it.
export function loadTreasure({ file = TREASURE_FILE } = {}) {
  const raw = readJson(file, null);
  if (raw && typeof raw === 'object' && Number.isInteger(raw.v) && raw.v > TREASURE_V) return defaultTreasure();
  return sane(raw);
}

// The reducer. Returns the next state - an equal one when the action changes nothing, which
// `sameTreasure` tells apart, so "nothing to write" is a comparison and not an identity that
// a caller's junk input could fake. Throws a sentence a person can read for a move that is
// not allowed.
//
//   placed   buried|lifted -> placed (and stamps placedAt). placed -> placed is a no-op, so
//            a double click or a second screen is harmless; nothing ever leaves placed.
//   found    +1 at any time - a chest dug up is a chest dug up - up to the cap.
//   lifted   buried -> lifted. lifted -> lifted is a no-op. Not once it is placed.
//   dropped  lifted -> buried: the statue goes back on its islet. buried -> buried is a
//            no-op. Not once it is placed.
export function apply(state, action, { now = Date.now() } = {}) {
  const s = sane(state);
  switch (action) {
    case 'placed':
      if (s.statue === 'placed') return s;
      return { ...s, statue: 'placed', placedAt: new Date(now).toISOString() };
    case 'found':
      if (s.found >= TREASURE_FOUND_MAX) return s;
      return { ...s, found: s.found + 1 };
    case 'lifted':
      if (s.statue === 'lifted') return s;
      if (s.statue === 'placed') throw new Error('the statue already stands in the town centre');
      return { ...s, statue: 'lifted' };
    case 'dropped':
      if (s.statue === 'buried') return s;
      if (s.statue === 'placed') throw new Error('the statue already stands in the town centre');
      return { ...s, statue: 'buried' };
    default:
      throw new Error(`action is one of ${TREASURE_ACTIONS.join(', ')}`);
  }
}

export function sameTreasure(a, b) {
  const x = sane(a), y = sane(b);
  return x.statue === y.statue && x.found === y.found && x.placedAt === y.placedAt;
}

// What village.json says (`village.treasure`, and from there the bundle): the two things a
// visitor sees - whether the statue stands and the number on its plaque. `lifted` is the
// carrier's business and reads as not placed.
export function viewOf(state) {
  const s = sane(state);
  return { placed: s.statue === 'placed', found: s.found };
}

// Writes the state atomically. If the file there is one we cannot use - not JSON, or from a
// newer island - it is copied aside first (best effort, and a synchronous copy, so no handle
// outlives this call), because the file is irreplaceable and "we could not read it" is not
// "it was empty".
export function saveTreasure(state, { file = TREASURE_FILE, now = Date.now() } = {}) {
  const clean = sane(state);
  let existing = null;
  try { existing = fs.readFileSync(file, 'utf8'); } catch { /* no file yet */ }
  if (existing !== null) {
    let parsed = null;
    try { parsed = JSON.parse(existing); } catch { /* torn or hand-edited */ }
    const usable = parsed && typeof parsed === 'object' && !(Number.isInteger(parsed.v) && parsed.v > TREASURE_V);
    if (!usable) {
      try { fs.copyFileSync(file, `${file}.unreadable-${now}`); } catch { /* keeping it aside is a kindness */ }
    }
  }
  writeJsonAtomic(file, { v: TREASURE_V, ...clean }, { pretty: true });
  return clean;
}

// Read, apply, write - the one door. `changed` says whether the file was touched, and `view`
// whether village.json would read differently afterwards (only then is a rescan worth it:
// `lifted` and `dropped` are the carrier's and change nothing anybody else sees).
export function updateTreasure(action, { file = TREASURE_FILE, now = Date.now() } = {}) {
  const before = loadTreasure({ file });
  const after = apply(before, action, { now });
  const changed = !sameTreasure(after, before);
  if (changed) saveTreasure(after, { file, now });
  const b = viewOf(before), a = viewOf(after);
  return { state: after, changed, view: a, viewChanged: b.placed !== a.placed || b.found !== a.found };
}
