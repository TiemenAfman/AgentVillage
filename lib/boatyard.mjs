// The boats a keeper has built at the island's harbours: how many at each side, and nothing
// more (Plans/vier-havens.md).
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
// three at that harbour draws three boats and not four.
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

// One more boat at `side`, up to `room` more than there are (the caller works out how many
// the harbour can still take, since only it knows whether the island's first boat lies
// there). Throws a sentence a person can read when there is no room.
export function buildBoat(side, { room = BOATS_PER_HARBOUR, file = BOATS_FILE } = {}) {
  if (!SIDES.includes(side)) throw new Error(`there is no ${String(side)} harbour`);
  const built = builtBoats({ file });
  if (room <= 0 || built[side] >= BOATS_PER_HARBOUR) throw new Error(`the ${side} harbour already has all the boats it can moor`);
  built[side] += 1;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, { built }, { pretty: true });
  return { side, built: built[side] };
}
