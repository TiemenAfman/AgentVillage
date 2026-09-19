// Every island in the sea, and where each one lies.
//
// The sea has no island of its own. It reads no transcripts, runs no scan, and writes
// nothing to disk - so this file holds the whole world in memory and loses all of it on a
// restart, deliberately. That is the same bargain lib/panelstate.mjs and lib/boats.mjs
// already make and for the same reason: a world that has to be migrated is a world that
// has a schema, and none of this is worth one. After a restart the fleet reassembles
// itself as each islander reconnects and publishes again, which takes a second and needs
// no code at all.
//
// What an island is here:
//
//   the bundle    what its own machine sent, rebuilt field by field by lib/islandbundle.mjs
//                 on this side. Never the object that came off the wire.
//   the origin    where it lies in the one world frame. Assigned once and never moved.
//   the terrain   derived here from the seed, and checked against the hash the bundle
//                 carries. Two machines running a different shared/terrain.mjs would
//                 otherwise draw the same island in two different shapes.
//   the token     who is allowed to publish to it. The id is guessable - it is derived
//                 from a port and a hostname - so the id says which island and the token
//                 says it is really them.
import { makeTerrain } from '../shared/terrain.mjs';
import { mooringFor } from '../shared/quay.mjs';
import { nextOrigin, SEA_GAP } from '../shared/regions.mjs';
import { parseBundle, parseParcel, ISLAND_ID } from './islandbundle.mjs';

// How long an island stays in the world after its islander's socket drops. A page reload,
// a laptop lid, or the keeper restarting their own server after saving a file must not
// sink an island under the feet of somebody standing on it. Long enough to cover all
// three; short enough that a fleet does not fill up with ghosts.
export const GRACE_MS = 45000;

// Sixteen is not a limit anybody is going to reach socially; it is the point past which
// the draw budget has certainly gone (CLAUDE.md records 1.35x for one guest island) and a
// refusal is more honest than a slideshow.
export const MAX_ISLANDS = 16;

export function createFleet({ now = () => Date.now(), gap = SEA_GAP, max = MAX_ISLANDS } = {}) {
  const islands = new Map();          // id -> island

  const placed = () => [...islands.values()].map((i) => ({ half: i.half, origin: i.origin }));

  // What GET /world answers, and what every client keeps its fleet in step from. Small on
  // purpose: a few hundred bytes an island, so it can ride a socket message whenever
  // anything changes, and the 200 kB of actual island is fetched once over HTTP.
  function row(i) {
    return {
      id: i.id,
      name: i.bundle.island.name,
      keeper: i.bundle.island.keeper,
      origin: i.origin,
      seed: i.bundle.island.seed,
      gridSize: i.bundle.island.gridSize,
      polders: i.bundle.polders || [],
      terrainHash: i.bundle.island.terrainHash,
      rev: i.rev,
      live: i.live,
      buildings: i.bundle.buildings.length,
    };
  }

  function manifest() {
    return { gap, islands: [...islands.values()].map(row) };
  }

  // An islander publishing its island: the first time, and every time the scan changes it.
  //
  // `token` is checked before anything is parsed. The id is derived from a port and a
  // hostname and is therefore guessable; the token is random and is what actually holds
  // the claim. An island nobody has claimed yet is claimed by whoever publishes first.
  // What somebody has put on their island, and what is growing there, without the island
  // itself having changed.
  //
  // `rev` deliberately does NOT move. It means "their island is not what we drew", and it
  // is what makes every viewer drop a region and fetch two hundred kilobytes to raise it
  // again - which for a planted tree is a mesh rebuild of a whole coastline. The bundle
  // here is updated so a latecomer fetches the tree along with everything else, and the
  // people already watching are told in one small message instead.
  //
  // What that costs: a viewer disconnected across the patch does not learn it happened,
  // sees the same rev on its way back in, and misses the tree until the next scan
  // republishes - a minute at most. The alternative is paying for a coastline every time
  // somebody digs a bed.
  function patch(id, raw, { token = null } = {}) {
    if (typeof id !== 'string' || !ISLAND_ID.test(id)) throw refuse('that is not an island id', 400);
    const island = islands.get(id);
    if (!island) throw refuse('no such island here', 404);
    if (island.token && token !== island.token) throw refuse('that island is somebody else\'s', 409);

    const parcel = parseParcel(raw, { gridSize: island.bundle.island.gridSize });
    island.bundle = { ...island.bundle, props: parcel.props, crops: parcel.crops };
    island.seenAt = now();
    return parcel;
  }

  function publish(id, raw, { token = null } = {}) {
    if (typeof id !== 'string' || !ISLAND_ID.test(id)) throw refuse('that is not an island id', 400);
    const had = islands.get(id);
    if (had && had.token && token !== had.token) throw refuse('that island is somebody else\'s', 409);
    if (!had && islands.size >= max) throw refuse('this sea is full', 503);

    // Rebuilt field by field, on this side, by the whitelisting rebuilder. Nothing from
    // the wire is ever kept, spread or trusted - see the header of lib/islandbundle.mjs.
    const bundle = parseBundle(raw);
    if (bundle.island.id !== id) throw refuse('this island does not answer to that name', 400);

    // The terrain, for the half this island takes up and for where its boat lies.
    //
    // parseBundle has already built one of these and refused the bundle if its hash
    // disagreed - that check is its own and its message is the better one, so it is not
    // repeated here. This is the second build of the same heightfield, and it is deliberate
    // rather than overlooked: the alternative is deciding which terrain to build from
    // numbers that have not been through the whitelist yet, which is exactly the thing the
    // whitelist exists to prevent. It costs a rebuild per publish, and a publish happens
    // once a scan.
    const terrain = makeTerrain(bundle.island.seed, {
      size: bundle.island.gridSize,
      polders: bundle.polders || [],
    });

    // An island that is already at anchor keeps its berth - even if it has changed size,
    // which a polder or a re-founding can do. Only a newcomer is given one.
    let origin = had ? had.origin : nextOrigin(placed(), terrain.half, gap);
    if (!origin) throw refuse('this sea is full', 503);
    if (had && had.half !== terrain.half) {
      // It grew or shrank in place. Ask for a berth again as though it were new, but
      // without itself in the way, and keep the old one if it still fits.
      const others = [...islands.values()].filter((i) => i.id !== id).map((i) => ({ half: i.half, origin: i.origin }));
      const mine = { half: terrain.half, origin };
      const clear = others.every((o) => Math.abs(mine.origin[0] - o.origin[0]) >= mine.half + o.half + gap
        || Math.abs(mine.origin[1] - o.origin[1]) >= mine.half + o.half + gap);
      if (!clear) origin = nextOrigin(others, terrain.half, gap);
      if (!origin) throw refuse('this sea is full', 503);
    }

    const island = {
      id,
      bundle,
      origin,
      terrain,
      half: terrain.half,
      token: had && had.token ? had.token : token,
      rev: (had ? had.rev : 0) + 1,
      live: true,
      seenAt: now(),
      // Where this island's boat lies, derived rather than sent: three parties have to
      // agree about it without a message, which is the whole argument in shared/quay.mjs.
      mooring: mooringFor(id, terrain, bundle.island.landing, origin),
    };
    islands.set(id, island);
    return island;
  }

  // The islander's socket dropped. The island stays exactly where it is and keeps being
  // drawn - what stops is new *shape*: no scan, no new house, no planted tree.
  function goneQuiet(id) {
    const i = islands.get(id);
    if (!i) return null;
    i.live = false;
    i.seenAt = now();
    i.rev += 1;
    return i;
  }

  function claim(id, token) {
    const i = islands.get(id);
    if (!i) return null;
    if (i.token && i.token !== token) return null;
    i.token = token;
    i.live = true;
    i.seenAt = now();
    i.rev += 1;
    return i;
  }

  // Islands whose grace has run out. The caller broadcasts and removes; this only decides,
  // so the sweep is testable without a socket in sight.
  function expired(graceMs = GRACE_MS) {
    const t = now();
    return [...islands.values()].filter((i) => !i.live && t - i.seenAt >= graceMs).map((i) => i.id);
  }

  function drop(id) {
    const i = islands.get(id);
    if (!i) return null;
    islands.delete(id);
    return i;
  }

  // Every boat in the sea, one per island, for lib/boats.mjs to start from. Rebuilt on
  // demand rather than cached: a fleet changes rarely and a stale mooring is a boat in a
  // field.
  function moorings() {
    return [...islands.values()].map((i) => i.mooring).filter(Boolean);
  }

  const get = (id) => islands.get(id) || null;
  const has = (id) => islands.has(id);

  return {
    publish, patch, claim, goneQuiet, expired, drop,
    get, has, manifest, moorings, row,
    count: () => islands.size,
    ids: () => [...islands.keys()],
    all: () => [...islands.values()],
  };
}

// A refusal that carries the status it deserves, so the routes do not each have to guess
// which failures are the sender's fault and which are ours.
function refuse(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}
