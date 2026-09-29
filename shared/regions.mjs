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
import { clamp, smoothstep } from './rng.mjs';
import { BED_BAND, fieldHeight, distToSquare, distToSquares } from './seabed.mjs';
export { distToSquares };

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

// How big the world is: a square of twice this round the volcano, in world units (a cell,
// 4 m, so some 16 km a side). 4032 is 14 cloud tiles (world.js CLOUD_TILE) and 42 islet
// squares (shared/islets.mjs ISLET_PITCH), so the sky seams up where the edge wraps round.
//
// The edge wraps by a jump, not by arithmetic (Plans/ronde-wereld.md): sail past it and the
// page moves you, your boat or your bicycle 2 * WORLD_HALF back across (`wrapShift`), and
// nothing else in the world knows the world is round. That is only invisible because
// nothing stands near the edge: `nextOrigin` keeps every island's room SEA_BAND clear of it,
// and the page closes the haze in near the edge (main.js setFogRange) so what lies across it
// is always behind the fog on both sides of the jump.
export const WORLD_HALF = 2016;
export const SEA_BAND = 900;

// How far to move a WORLD coordinate that has crossed the edge: 0 inside, otherwise the
// whole width back the other way. Pure, one axis at a time.
export function wrapShift(v) {
  if (v > WORLD_HALF) return -2 * WORLD_HALF;
  if (v < -WORLD_HALF) return 2 * WORLD_HALF;
  return 0;
}
// The chart's grid square: a sixteenth of the world, so the grid is A-P by 1-16 with no
// sliver at the edge. 252 units is 1008 m - "a kilometre" on the chart's scale bar.
export const KM = WORLD_HALF / 8;

// Four berths, snapped to the compass. Axis-aligned, so the strip of sea between two
// islands is a rectangle - which is what lets one water plane cover it without waste - and
// snapped rather than hashed so a neighbour keeps the property the horizon already gives
// it: always on the same bearing, so you learn where to look for them (horizon.js:5-7).
// nextOrigin's rings below keep both halves of that: every point on them is axis-aligned
// to its neighbours, and the four bearings are always the first four points of a ring.
const BEARINGS = [[1, 0], [-1, 0], [0, 1], [0, -1]];   // east, west, south, north
export const MAX_BERTHS = BEARINGS.length;
const RING_ORDER = [[1, 0], [0, 1], [-1, 0], [0, -1]];   // east, south, west, north

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
// and no ceiling, so this walks square rings outwards and takes the first free point.
//
// Two properties this has to have, and they are the whole design:
//
//   An island that has an origin keeps it. Nothing here ever moves one, because a newcomer
//   that shifted the fleet would slide the world under the feet of everybody standing on
//   it - the same reasoning replace() applies to levelBase further down.
//   The answer depends only on who is already placed, not on the order they are asked
//   about, so two machines given the same fleet reach the same point.
//
// The middle is special. Whoever holds [0, 0] - in a real sea the volcano, raised there by
// the sea before anybody joins (lib/fleet.mjs raiseVolcano); in a sea without one, the
// first island to arrive - sets how far out the FIRST ring lies, and only the first: its
// own half, SEA_GAP, and the biggest of everybody else. Every ring after that is one pitch
// further out, and the pitch is set by the biggest island that is *not* the middle. That
// split is the point. The pitch used to come from the biggest island present, full stop,
// so a 128-grid volcano would have spread every 64-grid in the world out to 176 apart and
// pushed the first ring out with it; now the first islands hug the middle across exactly
// SEA_GAP of water, eight of them to a ring (four bearings, four corners), and keep their
// own spacing amongst each other.
//
// A 256-grid joining a fleet of 64s still simply lands further out rather than anybody
// having to move: the biggest-other-island rule makes the rings coarser for newcomers from
// then on, and clearOf against everybody already placed is what keeps the answer right
// whatever the rings happen to offer. And with a middle of the same size as the rest the
// rings are exactly the old square lattice - ring 1 at one pitch, so one neighbour of the
// same size still lands due east, where berthOf and horizon.js have always put it.
export function nextOrigin(placed, half, gap = SEA_GAP) {
  if (!placed.length) return [0, 0];
  const centre = placed.find((p) => p.origin[0] === 0 && p.origin[1] === 0) || null;
  let biggest = half;
  for (const p of placed) if (p !== centre && p.half > biggest) biggest = p.half;
  const pitch = 2 * biggest + gap;
  // With nobody at the origin - the first island went home and nothing took the middle -
  // the rings are laid as though an island of the ordinary size stood there, which is the
  // lattice this always was, and the origin itself is left empty as it always was.
  //
  // And never closer in than one pitch. Points on a ring stand `r` apart along it, so a ring
  // tighter than the pitch holds only its two opposite bearings: round the 192 volcano,
  // islands holding 384 of room (every starter, and any island with room to grow) got a ring
  // of 336 against a pitch of 432, and the whole open sea filled up east and west in one line
  // (28 September 2026). A 64-grid's pitch is 112, well inside its 176, which is why nobody
  // saw it before the starters.
  const first = Math.max((centre ? centre.half : biggest) + gap + biggest, pitch);
  const mine = { half, origin: [0, 0] };
  for (let ring = 1; ring < 64; ring++) {
    for (const origin of ringPoints(first + (ring - 1) * pitch, pitch)) {
      mine.origin = origin;
      // Never into the band along the edge: an island there would be seen to vanish and
      // reappear across the world as you jumped (see WORLD_HALF).
      if (Math.max(Math.abs(origin[0]), Math.abs(origin[1])) + half > WORLD_HALF - SEA_BAND) continue;
      let ok = true;
      for (const p of placed) if (!clearOf(mine, p, gap)) { ok = false; break; }
      if (ok) return origin;
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
// berth, in the sea's frame. In a sea with a volcano nobody's berth is [0, 0] - the
// volcano holds the middle - so every page, the host's included, translates; it is the
// identity only for the first island into a sea raised without one (tests, an old sea).
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

// The points of the square ring `r` out from the middle, in a fixed order: the four
// bearings first, in BEARINGS' own order, then the rest of the square's edge, the ones
// nearest a bearing first. Sorted rather than walked round the perimeter so the order is
// stated in one place and cannot drift.
//
// Spaced at least `pitch` apart along each side, so two islands of the biggest size fit on
// neighbouring points, and the corners are exactly at `r` so a ring is clear of the one
// inside it by a whole pitch. Whole numbers wherever the halves are: the step is rounded
// down and the corner keeps the remainder, which only ever widens the gap before it.
function ringPoints(r, pitch) {
  const per = Math.max(1, Math.floor(r / pitch));    // points from a bearing to its corner
  const step = Math.floor(r / per);
  const at = (i) => (Math.abs(i) === per ? Math.sign(i) * r : i * step);
  const out = [];
  // Round the compass rather than berthOf's east, west, south, north: taken in that order a
  // ring filled across the middle first, and a sea of three islands was a line through the
  // volcano. East stays first, so the first neighbour is still due east.
  for (const [dx, dz] of RING_ORDER) out.push([dx * r, dz * r]);
  const rest = [];
  for (let i = -per; i <= per; i++) {
    for (let j = -per; j <= per; j++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== per || i === 0 || j === 0) continue;
      rest.push([i, j]);
    }
  }
  const off = (p) => Math.min(Math.abs(p[0]), Math.abs(p[1]));
  rest.sort((a, b) => (off(a) - off(b)) || (a[0] - b[0]) || (a[1] - b[1]));
  for (const [i, j] of rest) out.push([at(i), at(j)]);
  return out;
}

// A terrain facade in world coordinates. Same method names, same meanings, so every
// existing consumer takes one without knowing it is not a makeTerrain result - the way
// web/js/interior.js:532-542 already hands a flat floor to createWalkMode and peers.place().
//
// The cell-taking members (heightAt, slope, isLand, isWater, isBeach, isBuildable, isRiver,
// inGrid, corner, isLava) are passed straight through: a cell is local by definition, and
// every caller holding one got it out of village.json or layout.json, which are local too.
//
// The volcano's own fields ride along the same way (every ordinary island carries them too,
// empty, with isLava always false). `crater.centre` stays LOCAL like hillCentre and
// lakeCentre: it is a point on the island's own grid, and whoever wants it in world
// coordinates adds the origin, the way cellWorld does.
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
    volcano: terrain.volcano, crater: terrain.crater,
    lavaCells: terrain.lavaCells, lavaBankCells: terrain.lavaBankCells,
    inGrid: terrain.inGrid, corner: terrain.corner,
    heightAt: terrain.heightAt, slope: terrain.slope,
    isLand: terrain.isLand, isWater: terrain.isWater, isBeach: terrain.isBeach,
    isBuildable: terrain.isBuildable, isRiver: terrain.isRiver, isLava: terrain.isLava,

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
    const resized = strideOf(region) !== strideOf(list[i]);
    list[i] = region;
    // A grid that grew (Plans/eiland-laten-groeien.md) needs a wider stride, and keeping the
    // old base would run its level keys into the next region's. The deck-under-foot worry
    // above is moot then: every cell index on the island moved with the grid anyway.
    if (resized) reissueStrides();
    return region;
  }

  const get = (id) => list.find((r) => r.id === id) || null;
  const regionAt = (x, z) => list.find((r) => r.contains(x, z)) || null;

  // The sea bed between the islands: whatever is not an island's own grid but is not flat
  // open water either - the islets (web/js/islets.js) today. Handed in rather than known
  // here because it is worked out from the fleet by every page alike, and this module has
  // no fleet. `height(x, z)` answers in the same frame as `height` below and says `null`
  // where there is nothing, and `squares()` says where that is, as `{ origin, half, reach }`
  // - `reach` being how much dense water the sea lays round the square (waterPatchPlan).
  // OPEN_SEA stays the depth everything falls back to, so a bed may only raise it.
  let seabed = null;
  function setSeabed(next) { seabed = next || null; }

  const height = (x, z) => {
    const r = regionAt(x, z);
    if (r) return r.worldHeight(x, z);
    if (seabed) {
      const h = seabed.height(x, z);
      if (h != null) return h > OPEN_SEA ? h : OPEN_SEA;
    }
    return OPEN_SEA;
  };

  // ---- the floor a diver stands on (shared/seabed.mjs) --------------------------------------
  //
  // `height` above is the logical water surface: boats, guards and the colour of the water read
  // it, and it stays OPEN_SEA between the islands. `bedAt` is what is *under* that, for a body
  // that has dived and for the page's own sea-bed mesh (web/js/seabed.js). Two rules make it
  // safe to add beside everything else:
  //
  //   - Nothing here touches a terrain's `H`, so no terrain hash moves and no house with it.
  //   - It is additive: `height`, `setSeabed` and `waterSquares` answer exactly as they did.
  //
  // Three zones, in order:
  //   INSIDE a grid: the island's own heightfield, *unramped* - `r.terrain.worldHeight`, which
  //     is what the island's mesh really draws. `placeIsland.worldHeight` (used by `height`)
  //     ramps the outer BLEND_CELLS to OPEN_SEA so the water's colour has no seam, and that is
  //     not the ground: a diver at the rim of a grid would hover over a bed that dives away from
  //     under the mesh it sees.
  //   Up to BED_BAND OUTSIDE a grid: a smoothstep from the height at the grid's edge (the
  //     terrain clamps into its own grid, so asking it outside is asking for that edge) into the
  //     field. The mesh stops on a square, sometimes while still in shallows (26-42% of a grid's
  //     edge corners are shallower than -1.5), and the field starts flat: this is the seam
  //     between them, and it is continuous on both sides by construction.
  //   Beyond: `fieldHeight`, the relief of shared/seabed.mjs faded in with the distance to the
  //     nearest grid *or* islet square. An islet's own bed (`seabed.height`, non-null over its
  //     dome and shoals) wins where it exists - by `max`, so it can raise the field, which is
  //     flat there anyway, and never sink it.
  //
  // The field is in the WORLD frame and this archipelago is in the page's SCENE frame (the page
  // draws home at the scene origin and translates everybody else by its berth), so `setBedHome`
  // is handed that berth - the same `state.homeOrigin` net.js applies at the socket - and the
  // field is asked about `scene + home`. Without it two pages would put a bank in two places,
  // and one diver standing on it in the other's sand. Grids and islets are already scene frame.
  let bedHome = [0, 0];
  function setBedHome(home) {
    bedHome = home && Number.isFinite(home[0]) && Number.isFinite(home[1]) ? [home[0], home[1]] : [0, 0];
  }

  // A snapshot: the grids, the islets' squares and bed, and the berth as they are *now*. One
  // call of it is cheap and a bulk reader (the sea-bed mesh asks for ten thousand points a
  // rebuild) should make it once, because `seabed.squares()` builds a fresh array of every
  // islet each time it is asked.
  function bedSampler() {
    const grids = list.map((r) => ({ r, origin: r.origin, half: r.half, terrain: r.terrain || null }));
    const islets = seabed ? seabed.squares() : [];
    const squares = grids.map((g) => ({ origin: g.origin, half: g.half })).concat(islets);
    const isletBed = seabed ? seabed.height : null;
    const hx = bedHome[0], hz = bedHome[1];
    return function sample(x, z) {
      for (const g of grids) {
        if (!g.r.contains(x, z)) continue;
        return g.terrain ? g.terrain.worldHeight(x - g.origin[0], z - g.origin[1]) : g.r.worldHeight(x, z);
      }
      let h = fieldHeight(x + hx, z + hz, distToSquares(x, z, squares), OPEN_SEA);
      // The seam at a grid's edge. Weighted, not "the nearest one", so that the answer stays
      // continuous where two grids are both within the band; with the gap the sea keeps
      // (SEA_GAP) that never happens, and the sum is then just the one grid.
      let acc = 0, wSum = 0;
      for (const g of grids) {
        const d = distToSquare(x, z, g.origin, g.half);
        if (d >= BED_BAND) continue;
        const w = 1 - smoothstep(0, BED_BAND, d);
        const edge = g.terrain ? g.terrain.worldHeight(x - g.origin[0], z - g.origin[1]) : OPEN_SEA;
        acc += w * (edge - h);
        wSum += w;
      }
      if (wSum > 0) h += acc / Math.max(1, wSum);
      if (isletBed) {
        const ib = isletBed(x, z);
        if (ib != null && ib > h) h = ib;
      }
      return h;
    };
  }
  const bedAt = (x, z) => bedSampler()(x, z);

  // Every square the water is dense round: the islands' grids and the sea bed's own.
  const waterSquares = () => {
    const out = list.map((r) => ({ origin: r.origin, half: r.half }));
    if (seabed) for (const s of seabed.squares()) out.push(s);
    return out;
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
    nearestCoast, shoreWithin, setSeabed, waterSquares, bedAt, bedSampler, setBedHome,
    regions: () => list.slice(),
    count: () => list.length,
  };
}
