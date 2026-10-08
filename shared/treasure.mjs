// Treasure maps: which islet a map points at, where on it the chest lies, what is in the chest,
// and when a bottle washes up with the next map (Plans/schatkaarten.md).
//
// Nothing here is stored by the sea and nothing goes over the wire: a map is a seed, and the
// islet, the spot and the contents all follow from it by arithmetic, so every page that holds
// the same seed draws the same cross in the same place. That puts all of this under shared/'s
// rule - integer maths, + - * /, floor, abs, min, max and sqrt, and hash32/makeRng from
// rng.mjs; no sin, cos or pow (tests/treasure.test.mjs reads this file to check it).
//
// The islets' own rng streams are off limits. `furnish` in islets.mjs draws the palms and
// bushes from '<id>:flora', and one extra draw there moves every palm in the world. The spot
// therefore has a stream of its own per seed, '<islet id>:treasure:<seed>'.
import { hash32, makeRng } from './rng.mjs';
import { WORLD_HALF, KM } from './regions.mjs';
import { isletHeight, isletById } from './islets.mjs';

// ---- where on an islet -------------------------------------------------------------------

// Ground has to stand at least this far over the sea for anybody to dig in it: the same
// `isletHeight` that draws the sand and that a walker stands on, so nobody digs in the water.
export const DRY_MIN = 0.15;
// Cells kept clear of every palm and every bush. A palm is solid at its trunk and a chest
// half under a crown reads as a mistake; bushes are not solid but hide the X.
export const PALM_CLEAR = 1.6;
export const BUSH_CLEAR = 1.0;
// Rejection sampling: this many random spots, inside this share of the islet's radius (past
// it the coast wobbles into the water), before the deterministic search takes over.
export const SPOT_TRIES = 24;
const SPOT_REACH = 0.85;
// Step of the fallback search, in cells.
const SEARCH_STEP = 0.25;

function gapTo(list, lx, lz) {
  let least = Infinity;
  for (const f of list) {
    const dx = f.x - lx, dz = f.z - lz;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < least) least = d;
  }
  return least;
}

// Where on `islet` (as `isletsNear` or `isletById` furnishes it) the chest for `seed` lies, in
// the islet's own frame (cells from its middle): `{ x, z, y }`, y being the ground height.
// Dry, `PALM_CLEAR` off every palm and `BUSH_CLEAR` off every bush, in `SPOT_TRIES` tries;
// where nothing that tries finds it fits (a sandbank of radius three with its palm off
// centre), the highest dry point that is clear of the palms; and if there is none of that
// either, the point farthest from them. The fallback draws nothing, so it cannot drift.
export function spotOf(islet, seed) {
  const rng = makeRng(`${islet.id}:treasure:${seed}`);
  const palms = islet.palms || [], bushes = islet.bushes || [];
  const reach = SPOT_REACH * islet.r;
  for (let tries = 0; tries < SPOT_TRIES; tries++) {
    const x = rng.range(-reach, reach), z = rng.range(-reach, reach);
    const y = isletHeight(islet, x, z);
    if (y < DRY_MIN) continue;
    if (gapTo(palms, x, z) < PALM_CLEAR || gapTo(bushes, x, z) < BUSH_CLEAR) continue;
    return { x, z, y };
  }
  // Rows of z, then x, so a tie is always settled the same way.
  const n = Math.floor(islet.r / SEARCH_STEP);
  let high = null, far = null;
  for (let b = -n; b <= n; b++) {
    for (let a = -n; a <= n; a++) {
      const x = a * SEARCH_STEP, z = b * SEARCH_STEP;
      const y = isletHeight(islet, x, z);
      if (y < DRY_MIN) continue;
      const g = gapTo(palms, x, z);
      if (g >= PALM_CLEAR && (!high || y > high.y)) high = { x, z, y };
      if (!far || g > far.g) far = { x, z, y, g };
    }
  }
  if (high) return high;
  if (far) return { x: far.x, z: far.z, y: far.y };
  return { x: 0, z: 0, y: isletHeight(islet, 0, 0) };
}

// ---- which islet -------------------------------------------------------------------------

// How far from the player's berth a map may send them, in world units: a trip of some 15 to
// 95 seconds by boat, and not in sight from the beach.
export const MAP_MIN = 150;
export const MAP_MAX = 900;

// The id of the islet `seed` points at, out of `candidates` (a list from `isletsNear`; the
// caller asks the fleet, this file does not know it), among those `MAP_MIN`..`MAP_MAX` from
// `berth` ([x, z], world units). Null when there is none. If nothing lies in the band, the
// one nearest to it, so a lonely berth still gets a map.
//
// Highest hash wins (rendezvous hashing) rather than hash % length: a map remembers the id,
// but the same seed asked again after the fleet changed should land on the same islet unless
// that very islet went, and with a modulo any islet coming or going shifts the pick.
export function pickIslet(candidates, berth, seed) {
  if (!Array.isArray(candidates) || !candidates.length) return null;
  const [bx, bz] = Array.isArray(berth) ? berth : [0, 0];
  const dist = (c) => { const dx = c.x - bx, dz = c.z - bz; return Math.sqrt(dx * dx + dz * dz); };
  let pool = candidates.filter((c) => { const d = dist(c); return d >= MAP_MIN && d <= MAP_MAX; });
  if (!pool.length) {
    const off = (c) => { const d = dist(c); return d < MAP_MIN ? MAP_MIN - d : d - MAP_MAX; };
    let least = Infinity;
    for (const c of candidates) least = Math.min(least, off(c));
    pool = candidates.filter((c) => off(c) === least);
  }
  let best = null, bestHash = -1;
  for (const c of pool) {
    const h = hash32(`${seed}|${c.id}`);
    if (h > bestHash || (h === bestHash && c.id < best.id)) { best = c; bestHash = h; }
  }
  return best.id;
}

// The seed of the first hunt: the one that leads to the statue, the same whichever day it is.
// Per island, so two keepers' pirates do not send everybody to one islet, and free of the
// bottle's day so it does not depend on when somebody first spoke to the pirate.
export const FIRST_HUNT_SEED = (islandId) => `first-hunt:${islandId}`;

// ---- the map ----------------------------------------------------------------------------

// The chart's square for a world point: lettered A-P along the top by column, numbered 1-16
// down the side by row, A1 in the north-west - drawGrid in web/js/minimap.js lays the same
// lines (a sixteenth of the world, `KM`, from the volcano's -WORLD_HALF). North is -z.
export function gridOf(x, z) {
  const at = (v) => Math.max(0, Math.min(15, Math.floor((v + WORLD_HALF) / KM)));
  return 'ABCDEFGHIJKLMNOP'[at(x)] + (at(z) + 1);
}

// The map for `seed`, as it is stored and drawn:
//   { seed, islandId, isletId, spot: { x, z }, local: { x, z }, grid: 'K7', status, day }
// `spot` is in world units (the chart and the radar), `local` in the islet's own frame (the
// digger). `status` is 'awake', or 'asleep' when the islet is no longer in `candidates` -
// somebody's island was given that water - which draws a grey cross instead of failing; the
// map wakes again when the islet is back. The spot is worked out from the shape alone, so it
// is the same either way.
//   candidates  the list from isletsNear; without one the map cannot pick an islet (it
//               needs `isletId`) and cannot tell if it sleeps (it is taken to be awake)
//   berth       [x, z] the range of the pick is measured from
//   isletId     re-open a stored map on the islet it already names
//   day         the world day it was found on (worldTime().day), kept for the map's age
// Null when there is no islet to point at.
export function cardOf(seed, islandId, { candidates, berth = [0, 0], isletId = null, day = null } = {}) {
  const listed = Array.isArray(candidates);
  const id = isletId || (listed ? pickIslet(candidates, berth, seed) : null);
  if (!id) return null;
  const islet = (listed && candidates.find((c) => c.id === id)) || isletById(id);
  if (!islet) return null;
  const local = spotOf(islet, seed);
  const x = islet.x + local.x, z = islet.z + local.z;
  return {
    seed,
    islandId,
    isletId: id,
    spot: { x, z },
    local: { x: local.x, z: local.z },
    grid: gridOf(x, z),
    status: !listed || candidates.some((c) => c.id === id) ? 'awake' : 'asleep',
    day,
  };
}

// ---- the bottle -------------------------------------------------------------------------

// One bottle per world day per island, on a coast cell near the landing (`landingCells`, the
// caller's list of [gx, gz], any order: it is sorted here so the choice does not depend on
// how the list was built). Null with no cell. `seed` is the map's seed, so everyone who
// opens this day's bottle on this island holds the same map.
export function bottleOf(islandId, day, landingCells) {
  if (!Array.isArray(landingCells) || !landingCells.length) return null;
  const cells = landingCells.filter((c) => Array.isArray(c) && c.length === 2)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (!cells.length) return null;
  const id = `bottle:${islandId}:${day}`;
  return { id, day, cell: cells[hash32(id) % cells.length], seed: id };
}

// Whether the sea brings a bottle on `day`: only on a day the village worked. `lastAtDays`
// is the world day (worldTime().day) of each session's last activity - a number, or any list
// of them. The island is a picture of real work, and the sea brings post on days it was busy.
export function bottleWashesUp(day, lastAtDays) {
  if (!Number.isFinite(day)) return false;
  if (typeof lastAtDays === 'number') return lastAtDays === day;
  if (!lastAtDays || typeof lastAtDays[Symbol.iterator] !== 'function') return false;
  for (const d of lastAtDays) if (d === day) return true;
  return false;
}

// ---- where the pirate's chest stands at the Salty Kraken ----------------------------------

// Behind the pub, on its landward side, a corner you come upon rather than a signboard
// (Plans/piratenkroeg.md, Plans/schatkaarten.md "Wacht op de nieuwe tavern"). The spots as
// `[u, v]` in the lot's own frame: `u` along the way it looks - -2 the row just behind the lot,
// -1 its back row, 0 its middle row - and `v` along its front - 0 its middle column, +-1 either
// side of it, +-2 just beside the lot. On a three by three those are cells from its middle, as
// they were when every pub was one; on the Salty Kraken's eleven by six (PUB_LOT in lib/layout.mjs)
// "behind the middle" is behind the middle of its long back, and "the flank" is the short side.
// Best first: straight behind the middle, then behind either side, then along the back half of
// the flanks, the back corners, and the flanks at the middle. Never in front: at a pub on the
// water the front is the sea, and a door's step is a path's.
export const CHEST_SPOTS = [[-2, 0], [-2, 1], [-2, -1], [-1, 2], [-2, 2], [-1, -2], [-2, -2], [0, 2], [0, -2]];
// Which way a lot looks at each `rot` - shared/settlerwalk.mjs DOOR_DIR, as data here so this
// file imports no walk (tests/pirate-tavern-layout.test.mjs holds the two equal) - and which way
// is along its front: LOOK turned a quarter.
export const LOOK = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const ALONG = LOOK.map(([lx, lz]) => [-lz, lx]);

// `{ cell, rot, keeper }` for every spot round the lot `p` ({ gx, gz, w, d, rot }, `w` along x
// and `d` along z as it lies - a missing `w`/`d` is three), best first: the chest's cell, the way
// it faces - away from the wall it stands against - and the cell in front of it, where the pirate
// stands (lib/crowd.mjs puts a keeper one step along DOOR_DIR[rot]).
//
// Worked in doubled coordinates from the lot's middle, so an even side (the Kraken is six deep)
// has a middle between two cells and still comes out on whole cells: the middle row is the one
// at or behind the middle, never in front of it, and the middle column the one at or left of it.
export function chestSpots(p) {
  const [lx, lz] = LOOK[p.rot], [ax, az] = ALONG[p.rot];
  const w = p.w || 3, d = p.d || 3;
  // Depth along the look and width along the front, whichever way the lot is turned.
  const [deep, wide] = p.rot % 2 ? [w, d] : [d, w];
  const mx2 = 2 * p.gx + w - 1, mz2 = 2 * p.gz + d - 1;
  const mid = (n) => ((n - 1) >> 1);
  // Row and column as doubled offsets from the middle: `u` -2 is the row outside the back (-1),
  // -1 the back row (0), 0 the middle row; `v` +-2 outside the sides, +-1 either side of the middle.
  const row = (u) => 2 * (u === -2 ? -1 : u === -1 ? 0 : mid(deep)) - (deep - 1);
  const col = (v) => (v === 2 ? wide + 1 : v === -2 ? -(wide + 1) : 2 * (mid(wide) + v) - (wide - 1));
  return CHEST_SPOTS.map(([u, v]) => {
    const f = row(u), a = col(v);
    const cell = [(mx2 + f * lx + a * ax) / 2, (mz2 + f * lz + a * az) / 2];
    const rot = u === -2 ? (p.rot + 2) % 4 : v > 0 ? (p.rot + 1) % 4 : (p.rot + 3) % 4;
    return { cell, rot, keeper: [cell[0] + LOOK[rot][0], cell[1] + LOOK[rot][1]] };
  });
}

// ---- what is in the chest ---------------------------------------------------------------

// What can be found. The ids are the ones the inventory's tiles will carry: colours are
// PLAYER_SWATCHES entries (never SWATCHES, which the settlers draw their faces from), hats
// PLAYER_HAT_SHAPES, the item HAND_ITEMS. The shovel is not a find: the pirate hands it over.
export const SHOVEL = 'shovel';
export const REWARD_COLORS = [
  { id: 'captain-red', name: 'Captain red' },
  { id: 'sea-green', name: 'Sea green' },
  { id: 'kraken-purple', name: 'Kraken purple' },
  { id: 'gold-leaf', name: 'Gold leaf' },
];
export const REWARD_HATS = [
  { id: 'tricorn', name: 'Tricorn' },
  { id: 'bandana', name: 'Bandana' },
];
export const REWARD_ITEMS = [
  { id: 'spyglass', name: 'Spyglass' },
];
// The colours only a quest gives, never a chest: the gold mine's (Plans/goudmijn-zoektocht.md). Apart
// from REWARD_COLORS because rewardOf draws from that list, and a colour added there would change what
// every chest already on a map holds.
export const QUEST_COLORS = [
  { id: 'miners-ochre', name: "Miner's ochre" },
  { id: 'deep-garnet', name: 'Deep garnet' },
];
export const UNLOCK_IDS = [SHOVEL, ...REWARD_COLORS, ...QUEST_COLORS, ...REWARD_HATS, ...REWARD_ITEMS]
  .map((u) => (typeof u === 'string' ? u : u.id));

// In percent: a colour, a hat, a hand item.
const SHARE_COLOR = 70;
const SHARE_HAT = 25;

// What the chest for `seed` holds, given the ids already `owned` (an array or a Set): never
// something owned. `{ kind: 'color' | 'hat' | 'item', id, name }`, or `{ kind: 'doubloons',
// id: null, name, amount }` when there is nothing left to find. The kind is rolled first;
// a kind that is used up passes to the next, so a full wardrobe of colours still yields a hat.
export function rewardOf(seed, owned) {
  let have;
  try { have = new Set(owned || []); } catch { have = new Set(); }
  const rng = makeRng(`reward:${seed}`);
  const roll = rng.int(100);
  const pools = { color: REWARD_COLORS, hat: REWARD_HATS, item: REWARD_ITEMS };
  const order = roll < SHARE_COLOR ? ['color', 'hat', 'item']
    : roll < SHARE_COLOR + SHARE_HAT ? ['hat', 'color', 'item']
    : ['item', 'color', 'hat'];
  for (const kind of order) {
    const left = pools[kind].filter((p) => !have.has(p.id));
    if (left.length) {
      const p = left[rng.int(left.length)];
      return { kind, id: p.id, name: p.name };
    }
  }
  return { kind: 'doubloons', id: null, name: 'A handful of doubloons', amount: 3 + rng.int(6) };
}
