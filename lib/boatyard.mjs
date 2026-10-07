// The boats a keeper has built at the island's harbours: how many at each side, and nothing
// more (Plans/DONE/vier-havens.md).
//
// Counted, not listed. A built boat's id and berth follow from its harbour and its number
// (mooringsFor in shared/quay.mjs), so the count is all any other page or the sea needs to
// moor it in the same place - which is why this is a handful of integers and not a fleet.
//
// Its own file, like garden.json and for the garden's reason: layout.json is written by the
// scan and by nobody else, under the scan queue, and a second writer beside it is a race
// that loses a harbour the one time it matters. scan.mjs reads this and hands the counts to
// village.json as `island.harbours[].boats`, which is where the bundle picks them up.
//
// Capped at BOATS_PER_HARBOUR a side here, where the number is made, and again in
// lib/islandbundle.mjs where it arrives from a stranger. The island's own first boat also
// counts towards its harbour's three; mooringsFor caps the total, so a count that reaches
// three at that harbour draws three boats and not four - which is why the caller hands
// buildBoat that harbour's `cap` of two, and a third press there is refused rather than
// written down as a boat nobody will ever see.
//
// Since the village earns boats by itself (shared/quay.mjs earnedBoats), what lies at a
// harbour is the larger of this count and the earned one, and B is a way to build *ahead*
// of the village: see `moored` below.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, readJson, writeJsonAtomic } from './paths.mjs';
import { BOATS_PER_HARBOUR } from '../shared/quay.mjs';

export const BOATS_FILE = path.join(DATA, 'boats.json');
export const SIDES = ['n', 'e', 's', 'w'];

const clean = (n) => (Number.isInteger(n) ? Math.max(0, Math.min(BOATS_PER_HARBOUR, n)) : 0);

// { n, e, s, w } - how many boats have been built at each side. A missing or broken file is
// a harbour with none, never an error: this is the island's boats, not its ground.
export function builtBoats({ file = BOATS_FILE } = {}) {
  const raw = readJson(file, null);
  const at = (raw && typeof raw === 'object' && raw.built && typeof raw.built === 'object') ? raw.built : {};
  return Object.fromEntries(SIDES.map((s) => [s, clean(at[s])]));
}

// One more boat at `side` than the harbour moors now. Throws a sentence a person can read
// when there is no room.
//
// `moored` is what the village last said lies there besides the first boat (village.json's
// `harbours[].boats`, the larger of this count and the earned one). The build goes one past
// *that*: a press that only added one to this file's count would disappear under an earned
// count already above it, and the keeper would press B and see nothing happen. Read against
// this file's own count too, so two presses before the rescan between them are two boats.
//
// `cap` is how many the harbour can hold in this file's unit - BOATS_PER_HARBOUR, or one
// fewer where the island's first boat lies (village.json's `harbours[].first`). The caller
// works it out, since only it knows where that is; it is a cap rather than a number of
// free berths so that a `moored` gone stale between two presses cannot push past it.
export function buildBoat(side, { moored = 0, cap = BOATS_PER_HARBOUR, file = BOATS_FILE } = {}) {
  if (!SIDES.includes(side)) throw new Error(`there is no ${String(side)} harbour`);
  const built = builtBoats({ file });
  const next = Math.max(built[side], clean(moored)) + 1;
  if (next > Math.min(cap, BOATS_PER_HARBOUR)) throw new Error(`the ${side} harbour already has all the boats it can moor`);
  built[side] = next;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, { built }, { pretty: true });
  return { side, built: built[side] };
}

// What buildBoat wants to know about one harbour, out of the village that was last written:
// how many lie there besides the first boat, and how many it can hold. Null when the village
// has no harbour on that side - there is nowhere to build.
export function harbourRoom(village, side) {
  const list = village && village.island && Array.isArray(village.island.harbours) ? village.island.harbours : [];
  const h = list.find((x) => x && x.side === side);
  if (!h) return null;
  return { moored: clean(h.boats), cap: BOATS_PER_HARBOUR - (h.first ? 1 : 0) };
}
