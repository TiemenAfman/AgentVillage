// One world frame. Many island-local frames.
//
//   WORLD   absolute (x, z) in island units. The camera, walk mode, the peers, the pose
//           protocol in lib/players.mjs, state.pickables, every `interactables` entry and
//           every blocker rectangle speak this and nothing else. There is exactly one.
//
//   LOCAL   what shared/terrain.mjs and data/layout.json speak: (x, z) in -half..+half
//           around one island's own middle. Untouched, for ever. makeTerrain stays
//           origin-centred, stays free of sin/cos/pow, still hashes bit-identically in
//           Node and the browser. A house still never moves, because layout.json still
//           stores the same grid cells it always did.
//
//   world = local + region.origin        local = world - region.origin
//
// A REGION is one island. Its influence square is |world.x - ox| <= half and
// |world.z - oz| <= half. Regions may not overlap: `add` throws, because `regionAt` has to
// have one answer.
//
// The asymmetry to hold on to, because it is what makes the existing callers correct for
// free: `cellWorld` ADDS the origin and `worldHeight` SUBTRACTS it. Everything on the
// island reads cells out of village.json (local), turns them into positions with
// cellWorld (now world), and stands things up with worldHeight (now world-taking). So a
// module fed by cellWorld needs no change at all.
//
// The rule that does not follow from that and therefore has to be written down: a module
// that builds its own positions out of `half` wants the RAW LOCAL terrain and an offset
// Group, not this facade. web/js/world.js and web/js/hamlets.js are that case - see
// hamlets.js:612 and :702, which hand local coordinates to worldHeight. Give those two
// the facade and every fence post on a guest island sinks a metre, which reads as a
// shadow bug rather than as a coordinate one.
//
// This module lives in shared/ and obeys shared/'s rule: no Math.random, no sin/cos/pow.
// The berths are axis-aligned, which needs no trigonometry at all - one of the reasons to
// snap them to the compass rather than hash a bearing.
import { clamp } from './rng.mjs';

// Outside every region there is open sea, and open sea is exactly this. Not the nearest
// island's edge height, which is what makeTerrain's own clamp hands back
// (shared/terrain.mjs:271 clamps x+half into its own grid, so a query a hundred units east
// returns the coast - and on seed 1337/64 the mid-edge measures -0.742, which is shallow
// water, which the water shader draws pale with foam bands on it, out in the open sea).
//
// -2.5 rather than -Infinity because the number is read as a depth: world.js already
// forces -2.5 past its own square (world.js:300, and again in reshape at :1397) and
// terrain.mjs floors its own heightfield at -2.5 (terrain.mjs:203). So the gap between two
// islands is the same sea as the sea beyond one coast, and not a different substance.
export const OPEN_SEA = -2.5;

// How many cells of a region's own grid ramp from the heightfield down to OPEN_SEA.
// Without the ramp the boundary is a depth step of up to 1.8, and because the water shader
// shades by depth that step draws as a straight colour seam in open water, `half` units
// off the coast. Four cells is wide enough to be invisible from any distance you see it.
//
// The ramp is applied to what worldHeight RETURNS and never to H, so isLand, isWater,
// isBeach, heightAt, slope and the terrain hash are untouched, and it can only ever move
// water that was already well under. tests/regions.test.mjs asserts it changes no land cell.
export const BLEND_CELLS = 4;

// Open water between two coasts, measured between the grids rather than between the land,
// so the visible gap is this plus however far inside its own grid each island's land
// happens to stop (on seed 1337/64, about five cells a side). Two 64-grids at this gap
// measure roughly sixty units of real water, coast to coast.
export const SEA_GAP = 48;

// Four berths, snapped to the compass. Axis-aligned, so the strip of sea between two
// islands is a rectangle - which is what lets one water plane cover it without waste - and
// snapped rather than hashed so a neighbour keeps the property the horizon already gives
// it: always on the same bearing, so you learn where to look for them (horizon.js:5-7).
const BEARINGS = [[1, 0], [-1, 0], [0, 1], [0, -1]];   // east, west, south, north
export const MAX_BERTHS = BEARINGS.length;

// Where the `index`th berth lies, for an island of `theirHalf` beside one of `ownHalf`.
export function berthOf(index, ownHalf, theirHalf, gap = SEA_GAP) {
  const n = BEARINGS.length;
  const dir = BEARINGS[((index % n) + n) % n];
  const d = ownHalf + gap + theirHalf;
  return [dir[0] * d, dir[1] * d];
}

// Whether two islands have open water between them, rather than merely not overlapping.
// `add()` below only refuses squares that intersect; this is the stronger thing a fleet
// wants, and it is berthOf's own rule read backwards: separated on one axis by at least
// both halves plus the gap. One axis is enough because the grids are squares, so clearing
// on either one puts a full strip of sea along the whole facing side.
export function clearOf(a, b, gap = SEA_GAP) {
  const need = a.half + b.half + gap;
  return Math.abs(a.origin[0] - b.origin[0]) >= need
    || Math.abs(a.origin[1] - b.origin[1]) >= need;
}

// Where a newcomer drops anchor, given everybody already at anchor.
//
// berthOf answers "where is that island relative to me", which is the right question with
// one neighbour and the wrong one with seven: it has four bearings, and it is relative, so
// every screen would have to agree about who the middle is. A fleet needs absolute origins
// and no ceiling, so this walks a lattice outwards and takes the first free point.
//
// Two properties this has to have, and they are the whole design:
//
//   An island that has an origin keeps it. Nothing here ever moves one, because a newcomer
//   that shifted the fleet would slide the world under the feet of everybody standing on
//   it - the same reasoning replace() applies to levelBase further down.
//   The answer depends only on who is already placed, not on the order they are asked
//   about, so two machines given the same fleet reach the same lattice point.
//
// The pitch is set by the biggest island present, so a 256-grid joining a fleet of 64s
// simply lands further out rather than anybody having to move. And the first four points
// are the four bearings in berthOf's own order, so with one neighbour of the same size
// this puts them due east - exactly where the old code did, and where horizon.js has
// always taught you to look.
export function nextOrigin(placed, half, gap = SEA_GAP) {
  if (!placed.length) return [0, 0];
  let biggest = half;
  for (const p of placed) if (p.half > biggest) biggest = p.half;
  const pitch = 2 * biggest + gap;
  const mine = { half, origin: [0, 0] };
  for (let ring = 1; ring < 64; ring++) {
    for (const [i, j] of ringPoints(ring)) {
      mine.origin = [i * pitch, j * pitch];
      let ok = true;
      for (const p of placed) if (!clearOf(mine, p, gap)) { ok = false; break; }
      if (ok) return mine.origin;
    }
  }
  return null;    // sixty-four rings out is not a crowded sea, it is a bug somewhere else
}

// Which islands are near enough to be worth drawing whole, nearest first.
//
// The tiebreak on id is not tidiness. Berths are a lattice, so four islands sit at exactly
// the same distance from the middle as often as not, and without it the order fell out of
// whichever socket message had arrived last - so the near set swapped members between two
// equally close islands, and every swap tore down a coast and built it again. It showed
// itself as the same island being welcomed twice, a few seconds apart, for ever.
// The two frames a page lives between, and the whole of the translation.
//
// The sea has one world frame: every island has an origin in it, poses travel in it, the
// crowd's positions are island-local plus that origin. The page draws its OWN island at
// the scene origin whatever berth the sea gave it - world.js, the houses, the hamlets and
// the quay of home all hang straight in `scene` on local coordinates, and moving the lot
// would touch every place main.js adds something to the scene. So the page keeps home at
// [0, 0] and translates everything else by its berth: a position from the sea loses the
// berth on the way in, a position for the sea gains it on the way out. `home` is that
// berth, in the sea's frame. For the first island into a world it is [0, 0] and both of
// these are the identity, which is why nothing about a host changed when they arrived.
//
// Two lines, here rather than in the page, so the two directions live next to each other
// and a test can hold them to being exact inverses.
export function worldToScene(p, home = [0, 0]) { return [p[0] - home[0], p[1] - home[1]]; }
export function sceneToWorld(p, home = [0, 0]) { return [p[0] + home[0], p[1] + home[1]]; }

export function nearestFirst(rows, home = [0, 0]) {
  const d = (r) => {
    const o = r.origin || [0, 0];
    const dx = o[0] - home[0], dz = o[1] - home[1];
    return Math.sqrt(dx * dx + dz * dz);
  };
  return [...rows].sort((a, b) => (d(a) - d(b)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// The lattice points at distance `ring`, in a fixed order: the four bearings first, in
// BEARINGS' own order, then the rest of the square's edge. Sorted rather than walked round
// the perimeter so the order is stated in one place and cannot drift.
function ringPoints(ring) {
  const out = [];
  for (const [dx, dz] of BEARINGS) out.push([dx * ring, dz * ring]);
  for (let i = -ring; i <= ring; i++) {
    for (let j = -ring; j <= ring; j++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
      if ((i === 0 || j === 0) && (Math.abs(i) === ring || Math.abs(j) === ring)) continue;
      out.push([i, j]);
    }
  }
  return out;
}

// A terrain facade in world coordinates. Same method names, same meanings, so every
// existing consumer takes one without knowing it is not a makeTerrain result - the way
// web/js/interior.js:532-542 already hands a flat floor to createWalkMode and peers.place().
//
// The cell-taking members (heightAt, slope, isLand, isWater, isBeach, isBuildable, isRiver,
// inGrid, corner) are passed straight through: a cell is local by definition, and every
// caller holding one got it out of village.json or layout.json, which are local too.
export function placeIsland(terrain, { id, origin = [0, 0] } = {}) {
  const ox = origin[0], oz = origin[1];
  const half = terrain.half;
  const edge = Math.max(1e-6, BLEND_CELLS);

  // `into` is how far we are inside the outer BLEND_CELLS ring, measured on whichever axis
  // is further out, so the corners ramp too and the square meets the sea all the way round.
  const ramp = (lx, lz, h) => {
    const into = Math.max(Math.abs(lx), Math.abs(lz)) - (half - edge);
    if (into <= 0) return h;
    const t = Math.min(1, into / edge);
    return h + (OPEN_SEA - h) * t;
  };

  return {
    id,
    origin: [ox, oz],
    terrain,
    // Passed through unchanged: the shape of an island is the shape of an island.
    size: terrain.size, N: terrain.N, half, H: terrain.H, seed: terrain.seed,
    hash: terrain.hash,
    hillCentre: terrain.hillCentre, lakeCentre: terrain.lakeCentre,
    landCells: terrain.landCells, beachCells: terrain.beachCells,
    coastCells: terrain.coastCells,
    rivers: terrain.rivers, riverCells: terrain.riverCells,
    riverBankCells: terrain.riverBankCells,
    inGrid: terrain.inGrid, corner: terrain.corner,
    heightAt: terrain.heightAt, slope: terrain.slope,
    isLand: terrain.isLand, isWater: terrain.isWater, isBeach: terrain.isBeach,
    isBuildable: terrain.isBuildable, isRiver: terrain.isRiver,

    // The two that move, in opposite directions.
    cellWorld: (gx, gz) => {
      const c = terrain.cellWorld(gx, gz);
      return [c[0] + ox, c[1] + oz];
    },
    worldHeight: (x, z) => {
      const lx = x - ox, lz = z - oz;
      if (Math.abs(lx) > half || Math.abs(lz) > half) return OPEN_SEA;
      return ramp(lx, lz, terrain.worldHeight(lx, lz));
    },

    contains: (x, z) => Math.abs(x - ox) <= half && Math.abs(z - oz) <= half,
    toLocal: (x, z) => [x - ox, z - oz],
    toWorld: (lx, lz) => [lx + ox, lz + oz],

    // Over the LAND, the way frameIsland (web/js/main.js:1727-1738) already measures it.
    // The grid square reaches several cells past the last beach, and a camera leash on the
    // grid would let you drift out over empty water and lose the island off the bottom.
    bounds: () => {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const cell of terrain.landCells) {
        const p = terrain.cellWorld(cell[0], cell[1]);
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minZ) minZ = p[1];
        if (p[1] > maxZ) maxZ = p[1];
      }
      if (!Number.isFinite(minX)) {
        return { minX: ox - half, maxX: ox + half, minZ: oz - half, maxZ: oz + half };
      }
      return { minX: minX + ox, maxX: maxX + ox, minZ: minZ + oz, maxZ: maxZ + oz };
    },
  };
}

// Every island there is, and the sea between them.
export function createArchipelago() {
  const list = [];

  // Two islands of the same size produce identical `gx + gz*size` keys for corresponding
  // cells, and walk.js (:396), props.js (:475) and main.js (:1529) all build that key from
  // nothing but the cell and the size. A bridge on one island would become a deck in mid-air
  // on the other. So every region gets a stride of its own, wide enough that no two meet.
  const strideOf = (region) => region.size * region.size + 1;

  function reissueStrides() {
    let base = 0;
    for (const r of list) { r.levelBase = base; base += strideOf(r); }
  }

  function add(region) {
    for (const other of list) {
      if (region.id === other.id) throw new Error(`region ${region.id} is already here`);
      const gapX = Math.abs(region.origin[0] - other.origin[0]) - (region.half + other.half);
      const gapZ = Math.abs(region.origin[1] - other.origin[1]) - (region.half + other.half);
      if (gapX < 0 && gapZ < 0) throw new Error(`region ${region.id} overlaps ${other.id}`);
    }
    list.push(region);
    reissueStrides();
    return region;
  }

  function remove(id) {
    const i = list.findIndex((r) => r.id === id);
    if (i < 0) return null;
    const gone = list.splice(i, 1)[0];
    // The strides are handed out in order, so dropping one shifts every region after it.
    // Re-issue rather than leave a hole: a stale levelBase on a live region is a deck in
    // the sky, and it would appear on an island nobody had touched.
    reissueStrides();
    return gone;
  }

  // Swap an island for a newer shape of itself, in place. A polder is stamped into the
  // heightfield rather than drawn on top of it, so replaying the island's history really
  // does hand us a different terrain for the same island - and doing that as a remove and
  // an add would move it to the end of the list, which re-issues every stride after it.
  // Level keys would then shift under a bridge deck somebody is standing on.
  function replace(id, region) {
    const i = list.findIndex((r) => r.id === id);
    if (i < 0) return add(region);
    region.levelBase = list[i].levelBase;
    // Same island, same berth, so the overlap check has nothing new to say - but the size
    // can change with the grid, and then it does.
    for (let k = 0; k < list.length; k++) {
      if (k === i) continue;
      const other = list[k];
      const gapX = Math.abs(region.origin[0] - other.origin[0]) - (region.half + other.half);
      const gapZ = Math.abs(region.origin[1] - other.origin[1]) - (region.half + other.half);
      if (gapX < 0 && gapZ < 0) throw new Error(`region ${region.id} overlaps ${other.id}`);
    }
    list[i] = region;
    return region;
  }

  const get = (id) => list.find((r) => r.id === id) || null;
  const regionAt = (x, z) => list.find((r) => r.contains(x, z)) || null;
  const height = (x, z) => {
    const r = regionAt(x, z);
    return r ? r.worldHeight(x, z) : OPEN_SEA;
  };
  const isWaterAt = (x, z) => height(x, z) < 0;

  // The key walk.js hangs bridge decks and building floors off. Null out at sea: there is
  // nothing there to be on a level of, and a caller that gets null must not index with it.
  function levelKey(x, z) {
    const r = regionAt(x, z);
    if (!r) return null;
    const local = r.toLocal(x, z);
    const gx = clamp(Math.round(local[0] + r.half - 0.5), 0, r.size - 1);
    const gz = clamp(Math.round(local[1] + r.half - 0.5), 0, r.size - 1);
    return r.levelBase + gx + gz * r.size;
  }

  function bounds() {
    // The same default main.js starts with, so an archipelago nobody has filled yet leashes
    // the camera exactly where one island used to.
    if (!list.length) return { minX: -60, maxX: 60, minZ: -60, maxZ: 60 };
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const r of list) {
      const b = r.bounds();
      if (b.minX < minX) minX = b.minX;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.minZ < minZ) minZ = b.minZ;
      if (b.maxZ > maxZ) maxZ = b.maxZ;
    }
    return { minX, maxX, minZ, maxZ };
  }

  // The union of the influence squares, which is where there is real depth to read. Not
  // the same question as `bounds`: that one measures the land, for leashing a camera to
  // something worth looking at, and this one measures the grids, for laying a surface over
  // everything that has a heightfield under it.
  function gridBounds() {
    if (!list.length) return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const r of list) {
      if (r.origin[0] - r.half < minX) minX = r.origin[0] - r.half;
      if (r.origin[0] + r.half > maxX) maxX = r.origin[0] + r.half;
      if (r.origin[1] - r.half < minZ) minZ = r.origin[1] - r.half;
      if (r.origin[1] + r.half > maxZ) maxZ = r.origin[1] + r.half;
    }
    return { minX, maxX, minZ, maxZ };
  }

  // How far out the furthest coast lies, from the world origin. The haze and the orbit
  // leash both need one number for "how big is everything", and it has to be the truth
  // about what is actually placed rather than a constant in a file.
  function radius() {
    let out = 0;
    for (const r of list) {
      const d = Math.sqrt(r.origin[0] * r.origin[0] + r.origin[1] * r.origin[1]) + r.half;
      if (d > out) out = d;
    }
    return out;
  }

  // The nearest land, for washing a body ashore that has no other way out of the water.
  // Coast cells rather than land cells: it is the water's edge that is wanted, and there
  // are two orders of magnitude fewer of them - 37 against 1841 on this island.
  function nearestCoast(x, z) {
    let best = null, bestD = Infinity;
    for (const r of list) {
      for (const cell of r.coastCells) {
        const p = r.cellWorld(cell[0], cell[1]);
        const dx = p[0] - x, dz = p[1] - z;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = { region: r, x: p[0], z: p[1] }; }
      }
    }
    return best ? { region: best.region, x: best.x, z: best.z, d: Math.sqrt(bestD) } : null;
  }

  // Is there land within `r` of here? The same eight-point probe walk.js uses for
  // shoreWithinReach, but over the whole archipelago. The unit vectors are written out
  // because this module may not call the trigonometric functions.
  const PROBE = [
    [1, 0], [0.7071067811865476, 0.7071067811865476],
    [0, 1], [-0.7071067811865476, 0.7071067811865476],
    [-1, 0], [-0.7071067811865476, -0.7071067811865476],
    [0, -1], [0.7071067811865476, -0.7071067811865476],
  ];
  function shoreWithin(x, z, r) {
    if (height(x, z) >= 0.06) return true;
    for (const d of PROBE) {
      if (height(x + d[0] * r, z + d[1] * r) >= 0.06) return true;
    }
    return false;
  }

  return {
    // `worldHeight` is `height` under the name every terrain-shaped consumer already uses -
    // web/js/interior.js:532-542 duck-types a terrain with exactly that method, and
    // web/js/peers.js asks its floor for it. Having the alias means an archipelago can be
    // handed to anything that wanted a terrain for its heights, which is most things.
    worldHeight: height,
    add, remove, replace, get, regionAt, height, isWaterAt, levelKey, bounds, gridBounds, radius,
    nearestCoast, shoreWithin,
    regions: () => list.slice(),
    count: () => list.length,
  };
}
