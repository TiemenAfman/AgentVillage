import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { METRES_PER_LOT } from './lotfield.mjs';

// How the island grows.
//
// The whole envelope is baked at founding and every chunk of it is written to disk once
// (`publishWorld`). What the client and the layout engine ever see, though, is the
// *manifest* - and the manifest lists a subset. Growing the island is therefore nothing but
// naming more of what is already on disk: no chunk is ever generated a second time, no byte
// is ever rewritten, and the ground under a house that stands today is the same ground
// forever. That is the whole reason the polders could go (see `lib/layout.mjs`).
//
// Three properties this file exists to guarantee, in the order they matter:
//
//   deterministic - the same village always publishes the same set. `isletsWanted` is a pure
//                   function of two numbers off the model, and the islets are handed out in
//                   index order, so nothing depends on when a scan happened to run.
//   monotone      - more settlers never publishes fewer chunks. Both terms below only ever
//                   increase with their input, and an islet brings in a fixed set of chunks.
//   sticky        - what has been published stays published. The wanted set is unioned with
//                   `manifest.islets` rather than replacing it, so a village that shrinks -
//                   an archived project, a banished session - never has the sea close back
//                   over a hamlet.

/** The mainland. Published from the first scan: the town has to stand somewhere. */
export const MAIN = -1;

// ---- the ladder -------------------------------------------------------------------
// Two reasons an islet rises out of the sea, and the island takes whichever asks for more.
//
// The first is room. The main island is 8.4 ha of which about 2.6 ha carries a plot; an
// islet is 0.4 to 0.9 ha and holds four to eleven super-cells, so roughly one hamlet each
// (measured on seed 1337 at a 1024 m envelope). The mainland comfortably holds the village
// this island has today, so the settler ladder is slack: it is the floor that keeps a
// single-project island growing at all, not the thing that usually fires.
//
// The second is separation, and it is the one that does the work. A district is a git
// repository and `BELT` already insists that no two parcels touch - "the gap between them is
// the countryside". An islet makes that gap water, which is as permanent as separation gets.
// So every hamlet past the fourth gets a rock of its own.
//
// Why the fourth and not the first: measured on the real village, the four biggest projects
// hold 72 of its 104 settlers, which is more than any of these rocks could carry, and a town
// whose every repository moved offshore is a town with nothing around it. The mainland keeps
// its own hamlets; the archipelago starts where the main island stops being the obvious
// answer.
export const ISLET_AT = 30;        // settlers before the first islet is published at all
export const ISLET_EVERY = 45;     // one more for every this many settlers after that
export const HAMLETS_ASHORE = 4;   // hamlets the main island keeps before the rocks are used

/**
 * Which growth group each landmass belongs to: the mainland, or the skerry it grew from.
 *
 * The skerries are a fixed lattice computed over the whole envelope at t=0 (see `shape.mjs`),
 * so islet 4 is islet 4 whether or not islets 1 to 3 have been published. That index is the
 * islet's identity everywhere downstream - in the atlas, in the manifest and in
 * `layout.districts[id].islet` - precisely because it does not depend on what is above water.
 * An ordinal into "the islets that exist" would not survive the island growing.
 *
 * Anything the skerries do not account for is the mainland's: a spit that flood-fills as its
 * own landmass, a rock of a dozen samples too small to be named at all. Those are published
 * from the first scan, where they have always been.
 *
 * @param {object} field   a bake from lib/world/bake.mjs
 * @param {Array}  masses  from findLandmasses, biggest first
 * @param {Int32Array} label  the per-sample landmass id that came with them
 * @returns {Map<number, number>}  flood-fill id -> MAIN or a skerry index
 */
export function isletGroups(field, masses, label) {
  const groups = new Map();
  for (const m of masses) groups.set(m.id, MAIN);
  const half = field.envelopeM / 2;
  const claimed = new Set([masses.length ? masses[0].id : -1]);   // the main island keeps itself
  for (const s of field.shape.skerries) {
    const i = Math.round((s.x + half) / field.metresPerSample);
    const j = Math.round((s.z + half) / field.metresPerSample);
    if (i < 0 || j < 0 || i >= field.n || j >= field.n) continue;
    const id = label[i + j * field.n];
    // Two skerries that merged into one landmass are one islet, and it is the lower index
    // that names it - the same tie-break as everywhere else in the layout.
    if (id < 0 || claimed.has(id) || !groups.has(id)) continue;
    groups.set(id, s.index);
    claimed.add(id);
  }
  return groups;
}

/**
 * How many islets the island offers, as a pure function of the model.
 *
 * @param {{settlers: number, hamlets: number}} model  settlers alive, and districts that have
 *        earned a hamlet (population >= MIN_HAMLET). Both monotone, so this is too.
 */
export function isletsWanted({ settlers = 0, hamlets = 0 } = {}) {
  const bySettlers = settlers < ISLET_AT ? 0 : 1 + Math.floor((settlers - ISLET_AT) / ISLET_EVERY);
  const byHamlets = Math.max(0, hamlets - HAMLETS_ASHORE);
  return Math.max(bySettlers, byHamlets);
}

/**
 * The islets a village of this size gets, given the ones the bake actually produced.
 * Lowest index first, always: islet 4 is islet 4 whether or not 1 to 3 are above water.
 */
export function isletsFor(available, model) {
  const n = Math.min(available.length, isletsWanted(model));
  return available.slice(0, n);
}

// ---- the manifest, cut from the atlas ---------------------------------------------
// `atlas.json` is everything the bake produced; `manifest.json` is what has been published.
// The one is written once at founding and never again, the other is rewritten every time the
// island grows. Keeping them apart is what lets a growth scan skip the 1.7 s bake entirely:
// there is nothing to generate, only a list to widen.

// One thing the chunk quantum makes unavoidable, measured on seed 1337: chunk (2,1) holds
// both the mainland's east coast and the western tip of islet 5, because the channel there is
// narrower than the 64 m the chunk covers. That chunk comes up with the mainland, so a sandbar
// of an islet nobody has earned yet breaks the surface. The alternative - holding the chunk
// back until every landmass in it is published - punches a hole in the mainland's own coast,
// which is worse and visible from the town. The tip carries no landmass entry in the manifest,
// so nothing offers it to a district as an island.
/** Build the published manifest from the full atlas plus the islets that are above water. */
export function buildManifest(atlas, islets) {
  const published = new Set([MAIN, ...islets]);
  const chunks = atlas.chunks
    .filter((c) => c.needs.some((g) => published.has(g)))
    .map(({ needs, ...rest }) => rest);

  // The world's own revision: a hash over what was published, so the client can tell in one
  // string comparison whether anything about the ground changed. It moves when the island
  // grows, which is exactly when the client has new chunks to fetch.
  const worldRev = crypto.createHash('sha256')
    .update(chunks.map((c) => `${c.cx},${c.cz},${c.hash}`).join(';'))
    .digest('hex').slice(0, 8);

  // `atlas.islets` is what the bake produced; `manifest.islets` is what is above water. Same
  // name, different question, so the atlas's copy is dropped rather than shadowed.
  const { chunks: _c, landmasses, landings, islets: _i, ...header } = atlas;
  return {
    ...header,
    worldRev,
    islets: [...islets].sort((a, b) => a - b),
    landmasses: landmasses.filter((m) => published.has(m.group)).map(({ group, ...rest }) => rest),
    landings: landings.filter((l) => published.has(l.group)).map(({ group, ...rest }) => rest),
    chunks,
  };
}

/**
 * Publish more of the island if the village has earned it.
 *
 * Reads the atlas and the manifest off disk, widens the published set, and rewrites
 * manifest.json only when something actually changed - so an ordinary scan leaves the file
 * untouched and the client's `worldRev` stays put.
 *
 * @returns {{manifest: object, added: number, islets: number[]}|null}  null for a world baked
 *          by an older generator, which has no atlas and therefore nothing to grow into.
 */
export function growWorld(dir, model = {}) {
  const atlas = readJson(path.join(dir, 'atlas.json'));
  const manifest = readJson(path.join(dir, 'manifest.json'));
  if (!atlas || !manifest || !Array.isArray(atlas.chunks)) return null;

  const have = manifest.islets || [];
  // Union, never replacement: this is the whole of the stickiness promise. A village that
  // shrinks keeps every rock it ever settled.
  const islets = [...new Set([...have, ...isletsFor(atlas.islets || [], model)])].sort((a, b) => a - b);
  if (islets.length === have.length) return { manifest, added: 0, islets: have };

  const next = buildManifest(atlas, islets);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(next, null, 2));
  return { manifest: next, added: next.chunks.length - manifest.chunks.length, islets };
}

/**
 * Where each published islet is, in lots, for `placeAll`.
 *
 * The layout engine counts in lots and knows nothing about skerries; all it needs per islet
 * is one point on it, which it turns into the landmass under that point. The centroid of a
 * horseshoe-shaped islet can fall in the water, so the layout searches outward from here -
 * this is a hint, not a promise.
 */
export function isletSpecs(manifest) {
  const size = Math.round(manifest.envelopeM / METRES_PER_LOT);
  return (manifest.landmasses || [])
    .filter((m) => Number.isInteger(m.islet))
    .map((m) => ({
      index: m.islet,
      at: [
        Math.floor(m.centroid[0] / METRES_PER_LOT + size / 2),
        Math.floor(m.centroid[1] / METRES_PER_LOT + size / 2),
      ],
    }))
    .sort((a, b) => a.index - b.index);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
