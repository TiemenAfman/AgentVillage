// Where each building actually ended up standing.
//
// This exists because of a fact that is easy to miss and expensive to find out later: a
// building's position is not its plot. `cellCentre` puts it at the middle of its surveyed
// cells, and then two things move it - `housePlacement` loosens the building line by up to
// a cell's width, and `yardNudge` pushes an apprentice's shed out to the edge of its
// master's yard - and *both of them measure the built geometry's bounding box*. That is a
// renderer's knowledge. Neither the scanner nor the sea has a mesh.
//
// It matters because a settler stands outside its own front door: 0.85 units out for a
// house, 0.46 for a shed. Measured on the live village, 259 of 274 buildings are nudged,
// by a median of 0.35 and a worst case of 0.55 - so a sea that placed settlers at the
// surveyed cell centre would stand a good many apprentices inside their own sheds.
//
// So the renderer writes down what it did. The keeper's page posts the positions it built,
// they are kept here beside the props and the beds - generated, safe to delete, rebuilt the
// next time anybody looks at the island - and they travel in the island bundle so the sea
// can put a body outside the right door.
//
// The honest cost: until a browser has drawn this island once, the sea has no placements
// and falls back to the surveyed centre. That self-heals the moment anybody opens the page,
// which is also the only moment anybody could notice.
import path from 'node:path';
import { DATA, readJson, writeJsonAtomic } from './paths.mjs';

export const PLACEMENTS_FILE = path.join(DATA, 'placements.json');

// The same ceiling lib/islandbundle.mjs puts on buildings: a village bigger than this has
// other problems, and a body on a socket does not get to decide how much memory to use.
const MAX = 600;
const LIMIT = 4096;      // a position on any grid this project can have

function num(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (v < -LIMIT || v > LIMIT) return null;
  // Millimetres. The difference this file exists to carry is measured in tenths of a unit,
  // so three decimals is two orders of magnitude finer than it needs to be, and it keeps
  // the file small.
  return Math.round(v * 1000) / 1000;
}

// Rebuilt field by field, never spread. The same rule the island bundle follows, and for
// the same reason: this arrives on a socket.
export function parsePlacements(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  let n = 0;
  for (const [id, at] of Object.entries(raw)) {
    if (n >= MAX) break;
    if (typeof id !== 'string' || id.length > 200) continue;
    if (id === '__proto__' || id === 'constructor' || id === 'prototype') continue;
    if (!Array.isArray(at) || at.length < 2) continue;
    const x = num(at[0]);
    const z = num(at[at.length - 1]);
    if (x === null || z === null) continue;
    out[id] = [x, z];
    n++;
  }
  return out;
}

// Where a bridge or a quay carries a road over water, and how high its planks are.
// The same story as the placements: the deck height comes out of the built bridge's
// own arch, which is geometry, and without it a settler crossing a river walks along
// the riverbed. Keyed by the plain `gx + gz * size` cell the bridges are recorded under.
function parseDecks(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  let n = 0;
  for (const [cell, y] of Object.entries(raw)) {
    if (n >= 4096) break;
    const k = Number(cell);
    if (!Number.isInteger(k) || k < 0 || k > 512 * 512) continue;
    const h = num(y);
    if (h === null) continue;
    out[k] = h;
    n++;
  }
  return out;
}

export function loadPlacements(file = PLACEMENTS_FILE) {
  const on = readJson(file, null);
  if (!on || typeof on !== 'object') return { at: {}, decks: {} };
  return { at: parsePlacements(on.at), decks: parseDecks(on.decks) };
}

export function savePlacements(body, file = PLACEMENTS_FILE) {
  const at = parsePlacements(body && body.at);
  const decks = parseDecks(body && body.decks);
  writeJsonAtomic(file, { generatedAt: new Date().toISOString(), at, decks });
  return { at, decks };
}

// Where a building stands, or where the survey says it should if nobody has drawn it yet.
// The fallback is the same arithmetic web/js/main.js's cellCentre does, so the two agree
// exactly for the buildings that were never nudged.
export function placementOf(placements, spec, half) {
  const at = placements && placements.at && placements.at[spec.id];
  if (at) return at;
  const p = spec.plot;
  if (!p) return null;
  return [p.gx + p.w / 2 - half, p.gz + p.d / 2 - half];
}
