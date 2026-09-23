// One island's people, stepped by the sea.
//
// Everything here comes out of the bundle that island published: its buildings, its lanes,
// its square, where the renderer actually put each house and where a road is carried over
// water. Nothing is asked of the island while it is running, which is what lets a crowd
// keep walking for the forty-five seconds of grace after its keeper closes their laptop.
//
// The walk itself is shared/settlerwalk.mjs, unchanged and unwrapped. This file is only the
// translation: a bundle in, a stepped sim out.
import { createWalk, DT, DOOR_DIR } from '../shared/settlerwalk.mjs';
import { roadCells, squareCells } from '../shared/roads.mjs';
import { settlerLook, kindOf, styleOf } from '../shared/palette.mjs';
import { createBoating } from '../shared/boating.mjs';
import { quayFor } from '../shared/quay.mjs';
import { DECK_Y } from '../shared/hull.mjs';
import { makeRng, hash32 } from '../shared/rng.mjs';
import { GUARDHOUSE_ID, GUARDS, guardId, isGuard, isCodex } from '../shared/volcano.mjs';
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
// sea has to skip exactly the same ones, or two machines disagree about who exists. The
// volcano's guardhouse is civic too, and is the one building with more than one resident:
// its guards are spawned apart, further down, and counted by lib/guards.mjs.
//
// Nor are the Codex houses on the volcano (shared/volcano.mjs, lib/residents.mjs). Their
// residents come and go while the crowd runs - addResident below - and housing them here too
// would be a second way in for the same person, one that a crowd rebuilt from the bundle
// takes and the running one does not.
const HOUSED = (spec) => spec && spec.kind !== 'civic' && !!spec.plot && !isCodex(spec.id);

// How the guards stand at home: a loose block in front of the guardhouse gate, GUARD_COLS
// across and as many rows deep as there are guards, GUARD_GAP apart. Without it every guard
// would share the one spot `spawn` works out from the door, and twenty-four people idling in
// a circle a third of a cell wide is a single blur with twenty-four swords sticking out.
// Six across at 0.35 is about the width of the castle's front between its towers.
const GUARD_COLS = 6;
const GUARD_GAP = 0.35;
// Where a Codex settler with no house of its own stands (a lodger - lib/residents.mjs): in
// the same block of rows, behind every place a guard can have, so the two never share a
// spot. LODGER_ROWS deep and then round again from the front of that - the idle wander
// spreads them over the doorstep anyway, and a block that grew for every lodger would walk
// a queue of two hundred down the mountain.
const LODGER_FROM = Math.ceil(GUARDS.CAP / GUARD_COLS) * GUARD_COLS;
const LODGER_ROWS = 6;
// How many empty places a crowd carries before it closes them up. See `compact`.
const HOLES_MIN = 64;

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
  const walk = createWalk(terrain, bundle);

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

  // The guardhouse, on the one island that has one (shared/volcano.mjs). It is civic, so
  // the loop above housed nobody in it; its residents are the guards below, and how many
  // there are is not this file's decision - lib/guards.mjs counts islanders and calls
  // addGuard. None are made here, so a crowd starts with no guards and the controller
  // notices a new crowd and fills it.
  const guardhouse = (bundle.buildings || []).find((b) => b.id === GUARDHOUSE_ID && b.plot) || null;
  let guardsMade = 0;

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

  // Who each index on the wire means, the other way round. Built here and then only ever
  // added to: a crowd is thrown away and rebuilt whenever its island republishes, and the
  // one thing that adds a figure to a running crowd is a guard coming out of the guardhouse
  // (below), which is appended - Map keeps insertion order, so every index already on the
  // wire keeps meaning the same person and the page's roster only grows at the end.
  const index = new Map();
  {
    let i = 0;
    for (const f of walk.figures.values()) index.set(f.id, i++);
  }

  // ---- the guards ---------------------------------------------------------------------
  //
  // Figures that belong to the guardhouse rather than to a house of their own. They are
  // settlers in every respect the walk knows about - they idle round their doorstep, and
  // lib/hostility.mjs charters them for a chase exactly as it charters any resident of a
  // hostile island - and the differences are all here: their id is `guard:<n>` and not a
  // building's, they stand in rows in front of one door, and they can fall and come back.
  //
  // A new one is appended to the running crowd rather than the crowd being rebuilt: a
  // rebuild sends everybody back to their own door, and the volcano never republishes, so
  // there is no rebuild to ride on anyway. The caller sends the roster again (it has grown
  // at the end) and the new one's position at once - see lib/guards.mjs and lib/sea.mjs.
  function guardHome(n) {
    const at = placementOf(placements, guardhouse, terrain.half);
    const [ox, oz] = DOOR_DIR[(guardhouse.plot.rot | 0)] || DOOR_DIR[0];
    // Across the front is the door direction turned a quarter: (ox, oz) -> (-oz, ox).
    const across = ((n % GUARD_COLS) - (GUARD_COLS - 1) / 2) * GUARD_GAP;
    const out = Math.floor(n / GUARD_COLS) * GUARD_GAP;
    return [at[0] - oz * across + ox * out, at[1] + ox * across + oz * out];
  }

  function addGuard() {
    if (!guardhouse) return null;
    const n = guardsMade++;
    const id = guardId(n);
    // Dressed from their own id on both sides - settlerLook hashes the face and the height
    // off the first argument - with the guardhouse's style and kind, which is what the page
    // passes as well (web/js/crowd-view.js). The height is what the stride is made from.
    const look = settlerLook(id, styleOf(guardhouse), kindOf(guardhouse));
    const [x, z] = guardHome(n);
    const f = walk.spawn(id, guardhouse, [x, 0, z], { mode: 'idle' }, look.height);
    // Where they come back to after a fall. `home` itself is not safe to keep for that: an
    // arrival that was not an errand settles wherever it ended.
    f.door = [f.home[0], f.home[1]];
    f.pace = f.speed;
    f.dead = false;
    index.set(id, index.size);
    spawned++;
    return f;
  }

  // Fallen: out of sight and out of every errand. The figure keeps its slot, so every index
  // behind it on the wire still means the same person; crowdRoster sends a hole (null) in
  // its place, which is how a page learns to take the body away. Returns false for anything
  // that is not a standing guard.
  function guardDown(id) {
    const f = isGuard(id) ? walk.figures.get(id) : null;
    if (!f || f.dead) return false;
    walk.release(id);
    walk.unattend(id);
    f.dead = true;
    walk.setVisible(id, false);
    return true;
  }

  // Back out of the guardhouse, at their own place in the rows, with their own face.
  function guardUp(id) {
    const f = isGuard(id) ? walk.figures.get(id) : null;
    if (!f || !f.dead) return false;
    f.dead = false;
    f.home = [f.door[0], f.door[1]];
    f.pos = [f.door[0], f.door[1]];
    f.target = null; f.path = null; f.mode = 'idle'; f.attend = null;
    f.after = null; f.then = null; f.onDone = null;
    // A guard that fell mid-chase fell at GUARD_SPEED; `release` does not touch the speed.
    f.speed = f.pace;
    f.y = walk.groundOrDeck(f.pos[0], f.pos[1]);
    walk.setVisible(id, true);
    return true;
  }

  function guards() {
    const out = [];
    for (const f of walk.figures.values()) if (isGuard(f.id)) out.push(f);
    return out;
  }

  // ---- the Codex residents --------------------------------------------------------------
  //
  // Settlers the sea is told about while the crowd runs: each islander's Codex settlers, on
  // the volcano (lib/residents.mjs decides who, and which house). Added to the running crowd
  // the way a guard is - appended, so every index already on the wire keeps its person -
  // and taken away the way a fallen guard is, as a hole. A rebuild is not an option: one
  // islander's scan would send every guard and every other islander's settlers back to
  // their doors, once a minute per islander.
  //
  // `spec` is their house, or null for a lodger - a settler the plots ran out for, who lives
  // in the guardhouse like a guard. Dressed on both sides from its own id against whichever
  // of the two it lives in (web/js/crowd-view.js does the same), which is what the stride is
  // made from. Returns what happened: 'added', 'moved' (a new house, or out of the
  // guardhouse into one), 'same', or null when there is nowhere at all to put them.
  let lodgers = 0;
  function residentHome(spec) {
    if (spec) return placementOf(placements, spec, terrain.half);
    const n = LODGER_FROM + (lodgers++ % (LODGER_ROWS * GUARD_COLS));
    return guardHome(n);
  }

  function placeResident(id, spec, { active = false } = {}) {
    if (!isCodex(id)) return null;
    const home = spec || guardhouse;
    if (!home || !home.plot) return null;
    const mode = active ? 'hammer' : 'idle';
    const had = walk.figures.get(id);
    if (had && !had.dead && had.spec && had.spec.id === home.id && same(had.spec.plot, home.plot)) {
      had.spec = home;
      if (had.mode === 'idle' || had.mode === 'hammer') walk.setMode(id, mode);
      return 'same';
    }
    const look = settlerLook(id, styleOf(home), kindOf(home));
    const at = residentHome(spec);
    if (!at) return null;
    if (!had) {
      const f = walk.spawn(id, home, [at[0], 0, at[1]], { mode }, look.height);
      f.door = [f.home[0], f.home[1]];
      f.dead = false;
      index.set(id, index.size);
      spawned++;
      return 'added';
    }
    // Moving house, or back from being a hole. The same body, set down at its new door:
    // released from whatever it was doing, with the stride of whoever it is dressed as now.
    forget(id);
    walk.release(id);
    walk.unattend(id);
    const [ox, oz] = DOOR_DIR[(home.plot.rot | 0)] || DOOR_DIR[0];
    had.spec = home;
    had.home = [at[0] + ox * 0.85, at[1] + oz * 0.85];
    had.door = [had.home[0], had.home[1]];
    had.pos = [had.home[0], had.home[1]];
    had.target = null; had.path = null; had.attend = null;
    had.after = null; had.then = null; had.onDone = null;
    had.stride = 0.88 + (look.height - 1) * 1.1;
    had.speed = 0.34 * had.stride;
    had.mode = mode;
    had.dead = false;
    had.y = walk.groundOrDeck(had.pos[0], had.pos[1]);
    walk.setVisible(id, true);
    return 'moved';
  }

  const same = (a, b) => !!a && !!b && a.gx === b.gx && a.gz === b.gz && a.rot === b.rot;

  // Gone - their islander went home, or they fell out of its list. A hole, like a fallen
  // guard, so everybody behind them keeps their number; crowdRoster sends null in their place.
  function removeResident(id) {
    const f = isCodex(id) ? walk.figures.get(id) : null;
    if (!f || f.dead) return false;
    forget(id);
    walk.release(id);
    walk.unattend(id);
    f.mode = 'idle';
    f.dead = true;
    walk.setVisible(id, false);
    return true;
  }

  // Whoever was holding a conversation with somebody who is leaving lets go of them here,
  // or the talker's slot would name a body that is a hole.
  function forget(id) {
    const l = holders.get(id);
    if (!l) return;
    for (const who of l.keys()) held.delete(who);
    holders.delete(id);
  }

  function residents() {
    const out = [];
    for (const f of walk.figures.values()) if (isCodex(f.id)) out.push(f);
    return out;
  }

  // Close the holes, once there are enough of them to be worth a renumbering.
  //
  // A guard's hole is his place in the rows and he comes back to it, so guards keep theirs.
  // A Codex settler's hole is usually for good - an old session that dropped off the end of
  // its islander's list, an islander who never came back - and a sea that runs for a month
  // would carry a roster of nulls longer than its crowd. So past HOLES_MIN, and past as many
  // as there are residents standing, the departed are taken out of the walk and every index
  // behind them moves up. That is a new numbering, so the caller sends the whole roster and
  // everybody's position at once (lib/sea.mjs): a page retires whoever changed index and
  // enrols them again, which is a blink for the few it touches and nothing for the rest.
  // Returns whether it did anything.
  function compact() {
    let gone = 0, standing = 0;
    for (const f of walk.figures.values()) {
      if (!isCodex(f.id)) continue;
      if (f.dead) gone++; else standing++;
    }
    if (gone < HOLES_MIN || gone < standing) return false;
    for (const f of [...walk.figures.values()]) if (isCodex(f.id) && f.dead) walk.figures.delete(f.id);
    index.clear();
    let i = 0;
    for (const f of walk.figures.values()) index.set(f.id, i++);
    return true;
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
    guardhouse,
    addGuard,
    guardDown,
    guardUp,
    guards,
    guardsStanding: () => guards().filter((f) => !f.dead).length,
    placeResident,
    removeResident,
    residents,
    compact,
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
