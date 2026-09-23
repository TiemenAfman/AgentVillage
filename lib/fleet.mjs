// Every island in the sea, and where each one lies.
//
// The sea has one island of its own, the volcano in the middle (shared/volcano.mjs), and
// it can afford to because that island follows entirely from a handful of constants:
// `raiseVolcano` below builds it at [0, 0] when the sea starts, before anybody joins, and a
// restart builds exactly the same one. Everything else here is somebody else's. The sea
// reads no transcripts, runs no scan, and writes nothing to disk - so this file holds the
// whole world in memory and loses all of it on a restart, deliberately. That is the same bargain lib/panelstate.mjs and lib/boats.mjs
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
import { mooringsFor } from '../shared/quay.mjs';
import { nextOrigin, SEA_GAP } from '../shared/regions.mjs';
import { parseBundle, parseParcel, volcanoBundle, ISLAND_ID } from './islandbundle.mjs';
import { VOLCANO, volcanoTerrain } from '../shared/volcano.mjs';

// How long an island stays in the world after its islander's socket drops. A page reload,
// a laptop lid, or the keeper restarting their own server after saving a file must not
// sink an island under the feet of somebody standing on it. Long enough to cover all
// three; short enough that a fleet does not fill up with ghosts.
export const GRACE_MS = 45000;

// Sixteen is not a limit anybody is going to reach socially; it is the point past which
// the draw budget has certainly gone (CLAUDE.md records 1.35x for one guest island) and a
// refusal is more honest than a slideshow. Sixteen of *theirs*: the volcano is not counted,
// because it is not somebody taking a place - a sea that refused its sixteenth islander
// because it had raised its own island first would be full at fifteen for no reason
// anybody could see. It is one more region in every world, and a page draws it whole or as
// a silhouette like any other (DETAILED in web/js/main.js).
export const MAX_ISLANDS = 16;

export function createFleet({ now = () => Date.now(), gap = SEA_GAP, max = MAX_ISLANDS } = {}) {
  const islands = new Map();          // id -> island

  const placed = () => [...islands.values()].map((i) => ({ half: i.half, origin: i.origin }));
  // How many islands belong to somebody - what `max` is measured against.
  const theirs = () => [...islands.values()].filter((i) => !i.sea).length;

  // Which lighthouses stand on an island, and where.
  //
  // Derived from the bundle rather than carried in it, and that is the finding rather than
  // a shortcut: a lighthouse is an ordinary civic building, so `civicType: 'lighthouse'`
  // and its plot have been through parseBundle's whitelist since bundles existed. Nothing
  // had to be added to lib/islandbundle.mjs at either end - no forgiving half, no strict
  // half, and therefore no chance of the pair that packParcel and parseParcel got wrong,
  // where a field leaves one machine and is silently refused on the next.
  //
  // Only the horizon needs this. Our own island and the four nearest ones build the tower
  // and read the lamp's anchor straight off the mesh (web/js/buildings.js); a silhouette
  // has no mesh to read, and asking for the whole 200 kB island to find out whether it has
  // a lighthouse is exactly what the manifest exists to avoid.
  //
  // LOCAL coordinates, and only x and z. The height is the client's own to work out: it
  // has already built that island's terrain in order to draw the silhouette at all, so
  // sending a y would be a second answer to a question that already has one.
  function beaconsOf(bundle) {
    const out = [];
    const half = bundle.island.gridSize / 2;
    for (const b of bundle.buildings || []) {
      if (b.civicType !== 'lighthouse' || !b.plot) continue;
      // Where the keeper's own browser put it, if a browser has ever looked; the surveyed
      // middle of the plot otherwise. For this one building the two agree exactly - a
      // lighthouse stands on a single coast cell, which is the case housePlacement never
      // nudges - so the fallback is what lets a freshly published island light up before
      // anybody has drawn it, rather than an approximation anybody has to live with.
      const at = bundle.placements && bundle.placements[b.id];
      out.push(at ? [at[0], at[1]]
        : [b.plot.gx + b.plot.w / 2 - half, b.plot.gz + b.plot.d / 2 - half]);
    }
    return out;
  }

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
      // Only the sea's own island says so. A page needs it before it has fetched anything:
      // horizon.js builds a silhouette from this row alone, and the volcano's ground is a
      // different heightfield from the same seed.
      ...(i.bundle.island.volcano ? { volcano: true } : {}),
      buildings: i.bundle.buildings.length,
      beacons: beaconsOf(i.bundle),
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
    if (island.sea) throw refuse('that island is the sea\'s own', 409);
    if (island.token && token !== island.token) throw refuse('that island is somebody else\'s', 409);

    const parcel = parseParcel(raw, { gridSize: island.bundle.island.gridSize });
    island.bundle = { ...island.bundle, props: parcel.props, crops: parcel.crops };
    island.seenAt = now();
    return parcel;
  }

  // Whether `token` may speak for island `id` through a door that is not the island itself -
  // the Codex list (lib/residents.mjs). The same refusals and statuses as `patch`, with one
  // more: an island nobody holds a claim on cannot be spoken for at all. `patch` lets an
  // untokened island be written to by anybody because the tree lands on that island only;
  // a Codex list puts houses and bodies on the one island everybody shares, so a claim is
  // what it takes - and serve.mjs always publishes with one.
  function vouch(id, token) {
    if (typeof id !== 'string' || !ISLAND_ID.test(id)) throw refuse('that is not an island id', 400);
    const island = islands.get(id);
    if (!island) throw refuse('no such island here', 404);
    if (island.sea) throw refuse('that island is the sea\'s own', 409);
    if (!island.token || token !== island.token) throw refuse('that island is somebody else\'s', 409);
    island.seenAt = now();
    return island;
  }

  function publish(id, raw, { token = null, live = true } = {}) {
    if (typeof id !== 'string' || !ISLAND_ID.test(id)) throw refuse('that is not an island id', 400);
    const had = islands.get(id);
    // The volcano has no token, and a claim check that reads `had.token &&` would hand it to
    // whoever asked first. Refused outright instead: it is not anybody's to publish over.
    if (had && had.sea) throw refuse('that island is the sea\'s own', 409);
    if (had && had.token && token !== had.token) throw refuse('that island is somebody else\'s', 409);
    if (!had && theirs() >= max) throw refuse('this sea is full', 503);

    // Rebuilt field by field, on this side, by the whitelisting rebuilder. Nothing from
    // the wire is ever kept, spread or trusted - see the header of lib/islandbundle.mjs.
    const bundle = parseBundle(raw);
    if (bundle.island.id !== id) throw refuse('this island does not answer to that name', 400);
    // There is one volcano and the sea raises it. A second one under somebody's own id would
    // be a copy of the middle of the world parked out on the ring.
    if (bundle.island.volcano) throw refuse('there is one volcano, and it is the sea\'s', 400);

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
      fairway: bundle.fairway || null,
      volcano: bundle.island.volcano === true,
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
      // Whether an islander is on the line for it - the caller knows, this file does not
      // see sockets. Published without one it goes straight into the grace period and is
      // swept unless a socket turns up to claim it; `true` unconditionally was how a copy
      // of an island outlived the islander that sent it, in a sea that had refused that
      // islander at the door.
      live,
      seenAt: now(),
      // Where this island's boats lie, derived rather than sent: three parties have to
      // agree about it without a message, which is the whole argument in shared/quay.mjs.
      // Out of the bundle's own harbours and districts - the kade a village built is one of
      // its harbours, and deriving off the landing instead moored the boat at a second pier
      // somewhere else on the coast. The bundle carries the planks and how many boats each
      // harbour has, so the sea reaches the same answer as the browser that sent them. A
      // bundle from before there were harbours gets its one boat, exactly as before.
      moorings: mooringsFor(id, terrain, bundle, origin),
    };
    islands.set(id, island);
    return island;
  }

  // The islander's socket dropped. The island stays exactly where it is and keeps being
  // drawn - what stops is new *shape*: no scan, no new house, no planted tree.
  function goneQuiet(id) {
    const i = islands.get(id);
    if (!i || i.sea) return null;
    i.live = false;
    i.seenAt = now();
    i.rev += 1;
    return i;
  }

  function claim(id, token) {
    const i = islands.get(id);
    if (!i || i.sea) return null;
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
    return [...islands.values()].filter((i) => !i.sea && !i.live && t - i.seenAt >= graceMs).map((i) => i.id);
  }

  function drop(id) {
    const i = islands.get(id);
    if (!i || i.sea) return null;
    islands.delete(id);
    return i;
  }

  // Every boat in the sea - the first of each island, and whatever its keeper has built at
  // its harbours - for lib/boats.mjs to start from. Rebuilt on demand rather than cached: a
  // fleet changes rarely and a stale mooring is a boat in a field.
  function moorings() {
    return [...islands.values()].flatMap((i) => i.moorings || []);
  }

  // The sea's own island, in the middle, before anybody else is here.
  //
  // Everything that makes an island somebody's is absent: no token (so no claim, and
  // `claim`, `publish` and `patch` refuse it), always live (so `expired` never lists it and
  // the sweep never takes it), and `sea: true`, which is what every one of those checks
  // reads. No moorings: its bundle has no landing, and shared/quay.mjs gives a bundle with
  // no landing no dock and no boat. Deterministic by construction - the bundle is built
  // from shared/volcano.mjs and nothing else - so a restarted sea raises it bit for bit.
  //
  // At [0, 0] and not through nextOrigin, and it has to be raised first: nextOrigin treats
  // whoever holds the origin as the middle of the world and rings everybody else round it.
  // Raised into a fleet that already had an island near the origin it would overlap that
  // one, so that is refused rather than quietly placed somewhere else.
  function raiseVolcano() {
    if (islands.has(VOLCANO.id)) return islands.get(VOLCANO.id);
    const terrain = volcanoTerrain();
    for (const i of islands.values()) {
      const need = i.half + terrain.half + gap;
      if (Math.abs(i.origin[0]) < need && Math.abs(i.origin[1]) < need) throw refuse('the middle of this sea is taken', 409);
    }
    const bundle = volcanoBundle(terrain);
    const island = {
      id: VOLCANO.id,
      bundle,
      // What it was raised with - the guardhouse - so furnishVolcano can put the Codex
      // houses after it without ever losing it.
      raised: bundle.buildings,
      origin: [0, 0],
      terrain,
      half: terrain.half,
      token: null,
      rev: 1,
      live: true,
      sea: true,
      seenAt: now(),
      moorings: [],
    };
    islands.set(island.id, island);
    return island;
  }

  // The Codex houses on the volcano, which change while the volcano does not
  // (lib/residents.mjs). Its bundle keeps the guardhouse it was raised with and takes the
  // houses after it, so a page that fetches it later gets them with everything else. `rev`
  // does not move, for the parcel door's reason: it would make every page drop the region
  // and build the volcano's ground again for a tent. Pages already watching are told by
  // the sea in one small message instead.
  function furnishVolcano(houses) {
    const v = islands.get(VOLCANO.id);
    if (!v) return null;
    v.bundle = { ...v.bundle, buildings: [...v.raised, ...houses] };
    return v;
  }

  const get = (id) => islands.get(id) || null;
  const has = (id) => islands.has(id);

  return {
    publish, patch, vouch, claim, goneQuiet, expired, drop, raiseVolcano, furnishVolcano,
    get, has, manifest, moorings, row,
    // Every island in the world, the volcano included - what /health reports. `players` is
    // how many of them are somebody's, which is what `max` counts.
    count: () => islands.size,
    players: theirs,
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
