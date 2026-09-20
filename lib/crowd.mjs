// One island's people, stepped by the sea.
//
// Everything here comes out of the bundle that island published: its buildings, its lanes,
// its square, where the renderer actually put each house and where a road is carried over
// water. Nothing is asked of the island while it is running, which is what lets a crowd
// keep walking for the forty-five seconds of grace after its keeper closes their laptop.
//
// The walk itself is shared/settlerwalk.mjs, unchanged and unwrapped. This file is only the
// translation: a bundle in, a stepped sim out.
import { createWalk, DT } from '../shared/settlerwalk.mjs';
import { roadCells, squareCells } from '../shared/roads.mjs';
import { settlerLook, kindOf, styleOf } from '../shared/palette.mjs';
import { createBoating } from '../shared/boating.mjs';
import { quayFor } from '../shared/quay.mjs';
import { DECK_Y } from '../shared/hull.mjs';
import { makeRng, hash32 } from '../shared/rng.mjs';
// Deliberately not imported from lib/placements.mjs, which is six lines of arithmetic
// sitting behind lib/paths.mjs and therefore behind node:fs. The sea writes nothing, and
// that is worth being structural rather than a promise: nothing in its import graph can
// touch a disk. So the arithmetic is here, and it is the same arithmetic.
//
// Where a building stands, or where the survey says it should if no browser has drawn this
// island yet. The fallback is web/js/main.js's cellCentre, so the two agree exactly for the
// buildings that were never nudged - which on a real village is fifteen out of 274.
function placementOf(placements, spec, half) {
  const at = placements && placements.at && placements.at[spec.id];
  if (at) return at;
  const p = spec.plot;
  if (!p) return null;
  return [p.gx + p.w / 2 - half, p.gz + p.d / 2 - half];
}

// Civic buildings house nobody. The browser's placeFigure has always skipped them and the
// sea has to skip exactly the same ones, or two machines disagree about who exists.
const HOUSED = (spec) => spec && spec.kind !== 'civic' && !!spec.plot;

// How many may come up the beach at once before it stops being an arrival.
//
// One or two newcomers walking up from the landing is the village growing. Fifty at once
// is not an arrival, it is a scan catching up after a week - and fifty paths planned in
// one tick is also the single most expensive thing this file can be asked to do, because
// findPath sorts its open list on every pop. Over the line, everybody simply starts at
// their own door, which is where they would have ended up anyway.
const MAX_ARRIVING = 8;

// `known` is the ids the crowd that stood here before this one had. Anybody not in it is
// new since the last publish and walks up from the landing beach; null - the first crowd
// an island has, and the first after the sea restarts - means nobody is new, because a
// whole village coming ashore at once is not what anybody meant by "somebody arrived".
export function createCrowd(island, { known = null } = {}) {
  const { bundle, terrain } = island;
  const walk = createWalk(terrain);

  // The streets first: a figure works out which road cell it steps onto the first time it
  // is asked, and caches it, so the network has to be there before anybody is spawned.
  walk.setRoads(roadCells(bundle), squareCells(bundle));

  // Where a road is carried over water. The plain `gx + gz * size` key, which is what a
  // settler walking this island uses - an island bundle is one island, so the region
  // strides that walk mode needs do not come into it.
  const decks = new Map();
  for (const [cell, y] of Object.entries(bundle.decks || {})) decks.set(Number(cell), y);
  walk.setDecks(decks);

  const placements = { at: bundle.placements || {} };
  let spawned = 0;
  for (const spec of bundle.buildings || []) {
    if (!HOUSED(spec)) continue;
    const at = placementOf(placements, spec, terrain.half);
    if (!at) continue;
    // The height decides the stride, and it is hashed off the building id - the same hash
    // the browser draws the face from, so the two agree about who this is without a word.
    const look = settlerLook(spec.id, styleOf(spec), kindOf(spec));
    // spawn takes a three-element world position because that is what the browser hands
    // it from a mesh; only x and z are read.
    //
    // A settler whose session is running stands at their own door and hammers, which is
    // what the scaffolding on the house means and what docs/manual.md has always said
    // ("Scaffolding and hammering - that session is running right now"). The walk has had
    // the mode since before the crowd moved out here, and settler-figures.js has had a
    // whole InstancedMesh of hammers waiting for it, but nothing on this side ever asked
    // for one: `setMode` was the browser's own call and did not come along. So the swing
    // had quietly not been drawn on any island since. Set at spawn rather than kept in
    // step, because a crowd is rebuilt on every publish - so a settler who finishes their
    // work puts the hammer down at the next scan, a minute at most.
    walk.spawn(spec.id, spec, [at[0], 0, at[1]], { mode: spec.active ? 'hammer' : 'idle' }, look.height);
    spawned++;
  }

  // Up from the landing beach, for whoever was not here last time. The browser used to
  // do this for its own island and could not do it for anybody else's; here it happens
  // once, on the machine that walks every crowd, so a newcomer arrives on every screen
  // watching - including screens whose islander has never heard of them.
  //
  // The door is the same one the walk would send them home to. No callback: arriving *is*
  // the errand, and when it ends they are standing at their own door with nothing owed.
  const landing = bundle.island && bundle.island.landing;
  if (known && landing) {
    const fresh = (bundle.buildings || []).filter((b) => HOUSED(b) && !known.has(b.id));
    if (fresh.length && fresh.length <= MAX_ARRIVING) {
      for (const spec of fresh) {
        walk.walkIn(spec.id, landing, spec.door || [spec.plot.gx + 1, spec.plot.gz + 1], null);
      }
    }
  }

  // Who each index on the wire means, the other way round. Built once and not kept in
  // step, because a crowd is thrown away and rebuilt whenever its island republishes -
  // nothing adds a figure to a crowd that is already running, and the day something does,
  // its outings will be the smallest of the problems.
  const index = new Map();
  {
    let i = 0;
    for (const f of walk.figures.values()) index.set(f.id, i++);
  }

  // ---- the afternoon on the water -----------------------------------------------------
  //
  // Everything here is the island's OWN frame. shared/quay.mjs answers local cells and
  // local points, the walk this crowd runs is local, and the wire quantises against
  // terrain.half - so unlike web/js/main.js, which adds the region origin because it is
  // placing a hull in one shared scene, the sea never leaves the island it is standing on.
  // Getting that the wrong way round would put every dinghy an island's width out to sea.
  const quay = quayFor(terrain, bundle.island && bundle.island.landing);
  const dock = quay ? {
    cells: quay.cells, dir: quay.dir, berth: quay.berth, head: quay.head,
    yaw: quay.yaw, from: quay.from, shore: quay.shore,
    // planks() is the only thing boating asks a region for, and locally a region's
    // cellWorld *is* the terrain's.
    region: terrain,
  } : null;

  // The hull an outing borrows. On this side it is bookkeeping and nothing else: three
  // numbers and a deck height, because the mesh, the swell, the wake and the disposal are
  // the browser's half of the same dinghy. Deliberately not lib/boats.mjs either - that
  // holds the one boat an island has for *people* to cross in, and web/js/main.js explains
  // at length why an outing must never take it: the crossing outranks the afternoon.
  let hulls = 0;
  const dinghies = {
    take: () => ({ id: `outing:${island.id}:${hulls++}`, x: 0, z: 0, yaw: 0, deckY: DECK_Y }),
    release: () => {},
    // No swell here. The browser rides its hulls on its own clock and adds that rise to
    // the rider it draws, so a bob computed on this side would only be a second opinion
    // that has to be sent.
    bob: () => {},
  };

  // Seeded off the island's name, the same string web/js/main.js seeds its own outings
  // with, so a village that sails at four o'clock sails at four o'clock whichever side is
  // doing it.
  const boating = dock ? createBoating({
    terrain: () => terrain,
    settlers: walk,
    dock: () => dock,
    fleet: dinghies,
    rng: makeRng(hash32(`${(bundle.island && bundle.island.name) || island.id}:boating`)),
  }) : null;

  // ---- being spoken to ----------------------------------------------------------------
  //
  // shared/settlerwalk.mjs has one slot per settler (`f.attend`) and no notion of who put
  // it there. That was right while the browser doing the talking was also the one running
  // the walk: the slot lived exactly as long as the page did. Over a socket it is wrong the
  // moment somebody closes their laptop mid-sentence - the settler would stand looking at
  // an empty spot for the rest of the day, and nothing would ever come to move them on.
  //
  // So the crowd keeps the other half: who is holding whom. Two maps rather than one,
  // because both directions are asked for - a player leaving has to find their settler, and
  // a settler being let go has to find out whether anybody *else* is still standing there.
  // That second case is why this is a list per settler and not one owner: two people can
  // walk up to the same doorstep, and the first to leave must not take the second's
  // conversation with them.
  const held = new Map();        // who -> building id
  const holders = new Map();     // building id -> Map(who -> [x, z])

  function attend(who, id, at) {
    // One conversation at a time - faceUp on the far side cannot begin a second without
    // ending the first, and a client that says otherwise is not going to be believed.
    if (held.has(who) && held.get(who) !== id) release(who);
    const f = walk.attend(id, at);
    if (!f) return false;
    held.set(who, id);
    let l = holders.get(id);
    if (!l) { l = new Map(); holders.set(id, l); }
    l.set(who, [f.attend[0], f.attend[1]]);
    return true;
  }

  function release(who) {
    const id = held.get(who);
    if (id === undefined) return false;
    held.delete(who);
    const l = holders.get(id);
    if (!l) return false;
    l.delete(who);
    if (!l.size) { holders.delete(id); walk.unattend(id); return true; }
    // Still somebody there. They get the settler's eyes back, aimed at where *they* are
    // standing - the last to have walked up, which is whose face is in front of them.
    walk.attend(id, [...l.values()].pop());
    return true;
  }

  return {
    walk,
    attend,
    release,
    id: island.id,
    figures: walk.figures,
    count: () => spawned,
    advance(ticks, night) {
      walk.advance(ticks, night);
      // A tick at a time rather than one step of ticks*DT. Boating takes a dt and would
      // swallow a whole caught-up beat in one stride, which at CRUISE is over a waypoint
      // and back out the other side; and the timers that decide who goes out would fire
      // in lumps. It is two trips at most, so the loop costs nothing.
      if (boating) for (let i = 0; i < ticks; i++) boating.update(DT, night);
    },
    // The dinghies, addressed by the index the crowd already travels under.
    rides() {
      if (!boating) return [];
      const out = [];
      for (const r of boating.rides()) {
        const idx = index.get(r.id);
        if (idx == null) continue;
        out.push({ ...r, idx });
      }
      return out;
    },
  };
}

// Every island's crowd, and one clock over the lot.
//
// The accumulator lives here rather than in each crowd: they all step the same whole ticks
// at the same moment, so a settler on one island and a settler on another are always the
// same age. Two accumulators would drift apart by less than a tick and be impossible to
// reason about afterwards.
export function createCrowds({ now = () => Date.now(), maxTicksPerBeat = 8 } = {}) {
  const crowds = new Map();
  let last = now();
  let owed = 0;
  let ticks = 0;

  function join(island) {
    // Rebuilt from scratch when an island republishes. A crowd is cheap to make and the
    // village underneath it may have changed shape entirely - a house built, a district
    // founded, a polder drained - and reconciling that in place is a whole machine nobody
    // has asked for. What it costs is that everybody walks back to their own doorstep,
    // which is where a settler spends most of its life anyway.
    //
    // The one thing carried over is who was standing here, which is the whole of how a
    // newcomer is recognised: no flag in the bundle, no timestamp to trust, just the
    // difference between two crowds.
    const before = crowds.get(island.id);
    const known = before ? new Set([...before.figures.values()].map((f) => f.id)) : null;
    const crowd = createCrowd(island, { known });
    crowds.set(island.id, crowd);
    return crowd;
  }

  // Which island each talker is standing on, so letting go can find them again without
  // asking every crowd in the world. An island that has gone in the meantime simply has no
  // crowd to tell, and the row is dropped with it.
  const talkingOn = new Map();   // who -> island id

  function attend(who, islandId, buildingId, at) {
    const crowd = crowds.get(islandId);
    if (!crowd) { release(who); return false; }
    if (talkingOn.get(who) !== islandId) release(who);
    if (!crowd.attend(who, buildingId, at)) return false;
    talkingOn.set(who, islandId);
    return true;
  }

  function release(who) {
    const islandId = talkingOn.get(who);
    if (islandId === undefined) return false;
    talkingOn.delete(who);
    const crowd = crowds.get(islandId);
    return crowd ? crowd.release(who) : false;
  }

  const leave = (id) => {
    for (const [who, on] of talkingOn) if (on === id) talkingOn.delete(who);
    return crowds.delete(id);
  };
  const get = (id) => crowds.get(id) || null;

  // Step everybody by however much wall-clock time has gone by, in whole ticks.
  //
  // The cap matters. A process that was suspended - a laptop lid, a breakpoint, a long
  // garbage collection - comes back owing minutes, and stepping all of them at once would
  // freeze the sea for as long as it takes and then teleport every settler. Better to lose
  // the time: nobody is watching a crowd that nobody was connected to.
  function tick(nightAmount = 0) {
    const t = now();
    owed += (t - last) / 1000;
    last = t;
    let n = Math.floor(owed / DT);
    if (n <= 0) return 0;
    owed -= n * DT;
    if (n > maxTicksPerBeat) { n = maxTicksPerBeat; owed = 0; }
    for (const crowd of crowds.values()) crowd.advance(n, nightAmount);
    ticks += n;
    return n;
  }

  return {
    join, leave, get, tick, attend, release,
    ticks: () => ticks,
    count: () => crowds.size,
    all: () => [...crowds.values()],
    // Everybody in the world, for a snapshot or a count.
    figures: () => {
      let n = 0;
      for (const c of crowds.values()) n += c.figures.size;
      return n;
    },
  };
}
