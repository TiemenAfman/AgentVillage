// Where the settlers go. The half of the old web/js/settlers.js with no opinion about how
// any of it looks - and, since the sea took the world over, the half that runs in Node.
//
// settler-figures.js decides what is drawn where this file says a body is. Nothing in here
// imports three.js, touches a mesh, reads a colour or knows what a frame is, which is not
// tidiness: it is what lets the sea step every island's crowd whether or not anybody has a
// tab open, and lets a browser run the same code forward to predict what the sea is about
// to say.
//
// Because both sides run it, it obeys shared/'s rule (see the top of rng.mjs): plain
// arithmetic only, no Math.random and no transcendental functions. Four things had to
// change to get here, and each is worth knowing about.
//
// Math.hypot became Math.sqrt(dx*dx + dz*dz). hypot is not exactly specified and two
// engines may round it differently; sqrt is IEEE-exact and on the allowed list.
//
// The idle wander drew an angle and took its cosine. It now rejection-samples a point in
// the unit disc - draw two numbers in [-1,1] and keep the pair if it landed inside - and
// scales that. Still uniform in direction, and it was the only place a transcendental fed
// a *position*.
//
// Yaw left this file. Nothing here ever read it back into a position, so instead of an
// angle the walk publishes `f.face`, the direction to turn towards, and `f.turn`, how
// briskly. The renderer turns those into an angle with the atan2 it is perfectly entitled
// to use. That removed five call sites and the last of the trigonometry.
//
// The door offset stopped going through sin/cos of a mesh's rotation. placeFigure always
// passed the building's own yaw, so the DOOR_DIR table below was dead code - and the sea
// has no meshes, only a bundle. The two were checked against each other for all four
// rotations and agree exactly, so the table is now the only path and the answer did not
// move a millimetre.
//
// One figure object is still shared between this file and the renderer rather than split
// in two. main.js, facetoface.js and boating.mjs all reach into `figures` and read `f.pos`,
// `f.look` and `f.spec` directly. Each half's fields are grouped and labelled below.
import { quayBasin, quayDeckHeights } from './quay-basin.mjs';
import { makeRng, hash32, clamp } from './rng.mjs';
import { GATE_REACH } from './roads.mjs';

export const MAX_STROLL = 36;      // settlers out on an errand at the same time

// ---- work ------------------------------------------------------------------
// Somebody with nothing to do goes and does something: hoes a field, weeds a kitchen
// garden, fells and gathers wood at the edge of the forest, or fishes off the coast and the
// quay. Plans/inwoners-aan-het-werk.md has the why; the short version of the numbers:
//
// A cap of its own beside MAX_STROLL rather than a share of it, because a chore spends most
// of its time standing still at the far end - a stroll is nearly all walking - and forty
// people bent over their beds cost the wire nothing but a keyframe each.
export const MAX_CHORES = 48;
// How many may plan a chore in one tick. A chore's route is the road network and then
// findPath over open ground, and findPath sorts its open list on every pop - the same
// reason the borrel has GATHER_PER_TICK.
const CHORES_PER_TICK = 2;
// When the stroll timer fires and there is work within reach, how often it is work.
const CHORE_SHARE = 0.65;
export const CHORE_KINDS = ['garden', 'field', 'wood', 'fish'];
// How far from their own street a settler will go for each, in cells. A kitchen garden is
// the one behind the house; the sea is worth a walk.
const CHORE_REACH = { garden: 12, field: 18, wood: 18, fish: 24 };
const CHORE_WEIGHT = { garden: 3, field: 3, wood: 2, fish: 2 };
// What the body does while at it - the renderer's word, like 'hammer'. Wood starts as
// 'chop' and turns into 'gather' after the first bout; see nextBout.
const CHORE_ANIM = { garden: 'weed', field: 'hoe', wood: 'chop', fish: 'fish' };
// How briskly somebody shifts along their own furrow between two bouts.
const SHUFFLE = 0.22;

// The length of one tick, in seconds. Twenty a second: fine enough that a settler at
// 0.34 units a second never visibly jumps, coarse enough that stepping a few thousand
// figures is cheap. A constant rather than an argument because it is the thing both
// sides have to agree about - see `advance`.
export const DT = 0.05;

// How many settlers may start their walk to the square in one tick.
//
// The borrel is the one moment the whole village plans a route at once, and a route is the
// expensive thing in here - roadRoute is a breadth-first search over every paved cell.
// Measured on a village of 274: the first tick after `setGather(true)` cost 19 ms against
// an ordinary tick's 0.04. One island fits inside a 50 ms tick and eight ringing the bell
// at the same moment do not, and they would: the borrel is on a clock, and everybody's
// clock says Friday afternoon at the same time.
//
// So it is spread. Eight a tick empties a village of 274 in about a second and a half,
// which reads as people drifting in rather than arriving in a block - and that is better
// than what it replaced, not a compromise.
const GATHER_PER_TICK = 8;

// Fetching gold before building (Plans/goudkuil.md). A settler whose session is running
// hammers at their own door; with a gold pit on the island they first wheel a barrow over to
// it, load it, wheel it home and only then set to work - and go again every few minutes of
// work after that. All in seconds of walk time, drawn from the settler's own `<id>:gold`
// stream.
//
//   GOLD_FIRST  how long after setting to work the first trip starts: soon, but not all at
//               once when a whole village is started at the same moment (a sea restart).
//   GOLD_AGAIN  how long they hammer between trips. A session works for hours, and a bar
//               every few minutes keeps the lane to the pit busy without it becoming a
//               procession.
//   GOLD_LOAD   how long they stand at the pile.
//   MAX_GOLD    how many of one island may be on the way at once, MAX_STROLL's idea.
export const GOLD_FIRST = [2, 20];
export const GOLD_AGAIN = [150, 330];
export const GOLD_LOAD = [1.6, 3];
export const MAX_GOLD = 12;
// Which way a plot's door faces, by its rotation: 0 = -z, 1 = +x, 2 = +z, 3 = -x.
// Exported for lib/crowd.mjs, which stands the volcano's guards in rows in front of one
// door and finds the gold pit's open end, and has to know which way is "in front" by
// exactly the rule spawn uses.
export const DOOR_DIR = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// 4-neighbour A* over the cell grid: a settler walking in from the beach, and every guard's
// chase (lib/hostility.mjs).
//
// The open list is a binary heap ordered by (f, insertion order). It used to be an array
// sorted on every pop and shifted from the front - fine on a 64-grid, but the 192-grid
// volcano's ridges made a beach-to-rim search 30-65 ms, and the chase runs up to three a
// beat, so one player near the summit stalled the whole sea. The insertion counter is what
// keeps the order the sort gave: Array.prototype.sort is stable, so among equal f the
// earliest pushed came out first, and the heap breaks ties the same way. An entry whose
// cost has since been beaten is skipped when it comes out rather than expanded again,
// which is also all the old re-expansion ever amounted to (it relaxed with the best cost,
// which the fresher entry had already done). The 12000 budget counts expansions, as it
// always meant to; stale entries no longer eat it.
export function findPath(terrain, from, to, blocked) {
  const size = terrain.size;
  const key = (x, z) => x + z * size;
  const start = key(from[0], from[1]);
  const goal = key(to[0], to[1]);
  const g = new Map([[start, 0]]);
  const prev = new Map();
  // Three parallel arrays rather than an array of pairs: no allocation per push.
  const hf = [0], hc = [0], hk = [start];
  let seq = 1;
  const less = (a, b) => hf[a] < hf[b] || (hf[a] === hf[b] && hc[a] < hc[b]);
  const swap = (a, b) => {
    let t = hf[a]; hf[a] = hf[b]; hf[b] = t;
    t = hc[a]; hc[a] = hc[b]; hc[b] = t;
    t = hk[a]; hk[a] = hk[b]; hk[b] = t;
  };
  const push = (f, k) => {
    let i = hf.length;
    hf.push(f); hc.push(seq++); hk.push(k);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(i, p)) break;
      swap(i, p); i = p;
    }
  };
  // Pops into `top` rather than returning a pair, for the same no-allocation reason.
  const top = { f: 0, k: 0 };
  const pop = () => {
    top.f = hf[0]; top.k = hk[0];
    const last = hf.length - 1;
    if (last > 0) { hf[0] = hf[last]; hc[0] = hc[last]; hk[0] = hk[last]; }
    hf.pop(); hc.pop(); hk.pop();
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < hf.length && less(l, m)) m = l;
      if (r < hf.length && less(r, m)) m = r;
      if (m === i) break;
      swap(i, m); i = m;
    }
  };
  const h = (x, z) => Math.abs(x - to[0]) + Math.abs(z - to[1]);
  let guard = 0;
  while (hf.length && guard < 12000) {
    pop();
    const cur = top.k;
    const cx = cur % size, cz = (cur - (cur % size)) / size;
    const gc = g.get(cur) || 0;
    // Stale: this cell was reached more cheaply after this entry went in.
    if (top.f > gc + h(cx, cz)) continue;
    guard++;
    if (cur === goal) break;
    for (let d = 0; d < 4; d++) {
      const nx = d === 0 ? cx + 1 : d === 1 ? cx - 1 : cx;
      const nz = d === 2 ? cz + 1 : d === 3 ? cz - 1 : cz;
      if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
      if (!terrain.isLand(nx, nz)) continue;
      const k = key(nx, nz);
      if (blocked && blocked.has(k) && k !== goal) continue;
      const cost = gc + 1 + 4 * terrain.slope(nx, nz);
      if (g.has(k) && g.get(k) <= cost) continue;
      g.set(k, cost);
      prev.set(k, cur);
      push(cost + h(nx, nz), k);
    }
  }
  if (!prev.has(goal) && start !== goal) return null;
  const out = [];
  for (let k = goal; k !== undefined; k = prev.get(k)) {
    out.push(terrain.cellWorld(k % size, (k - (k % size)) / size));
    if (k === start) break;
  }
  return out.reverse();
}

// Plain arithmetic, and exact in both runtimes. Math.hypot would have done the same
// job and is not exactly specified: two engines may give different last bits for it,
// and a last bit is a step taken or not taken.
export function dist(dx, dz) { return Math.sqrt(dx * dx + dz * dz); }

// Which way to turn, and how briskly. The walk names a direction and leaves the angle
// to whoever is drawing: an angle needs atan2, and this file may not have one.
function face(f, dx, dz, turn) { f.face = [dx, dz]; f.turn = turn; f.faceAngle = null; }

// Used by the renderer rather than by anything here, and kept in this file because it
// is the other half of `face` above. Math.PI is a constant, not a function.
export function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * clamp(t, 0, 1);
}

// The height a body stands at: a stair tread if a staircase crosses this spot, else the
// deck if something is built over the ground here, else the ground itself. Local
// coordinates, like everything in shared/.
//
// Out here rather than inside createWalk because two machines need the same answer and only
// one of them walks. The sea steps the crowd through createWalk and puts x and z on the
// wire - no height, on purpose, because whoever draws it has the ground already - and the
// page then drew them at plain `terrain.worldHeight`. Which is the ground *under* the
// quay: the sea stood a settler on the boardwalk and the page drew them in the water
// beside it, and the two comments at the draw sites in main.js promising planks rather
// than water described what was meant rather than what happened.
//
// `decks` is bridges and props, keyed `gx + gz * size`. The quay's own boardwalk goes in
// after it and therefore wins a cell they share, which is the order createWalk's setDecks
// has always used: a plank floor laid over a crossing is the surface you walk on.
export function createStandHeight(terrain, village, decks = null) {
  const basin = quayBasin(village, terrain);
  const at = new Map(decks || []);
  for (const [cell, y] of quayDeckHeights(village, terrain.size)) at.set(cell, y);
  return (x, z) => {
    // The staircase first. It is the one surface that rises *within* a cell, so its tread
    // has to beat whatever single flat height that cell is otherwise recorded at - and a
    // quay's steps stand on deck cells by construction, since that is where they start.
    const tread = basin?.rampHeight(x, z);
    if (tread != null) return tread;
    const gx = Math.round(x + terrain.half - 0.5), gz = Math.round(z + terrain.half - 0.5);
    const deck = at.get(gx + gz * terrain.size);
    return deck != null ? deck : terrain.worldHeight(x, z);
  };
}

export function createWalk(terrain, village = null) {
  const figures = new Map();   // buildingId -> figure

  // `look` is the drawing half's business, and the one number out of it this half needs is
  // the height: a tall settler has a longer stride and therefore covers more ground. The
  // caller passes it in rather than this file reaching for settlerLook, which would drag
  // buildings.js - and with it three.js and a TextureLoader built at import time - into a
  // module whose whole point is not to need one.
  function spawn(id, spec, worldPos, opts = {}, height = 1) {
    if (figures.has(id)) return figures.get(id);
    // Seeded off the building id: it is a session id with a prefix on it, or for an
    // apprentice the prefix plus the agent id that is the one thing telling four
    // apprentices of the same master apart. An upgrade or a refit does not touch it, so a
    // settler who moves up from a hut to a manor is still recognisably the same person.
    const rng = makeRng(hash32(id + ':walk'));
    // Stand outside the door, not in the middle of the floor. A settler placed on its
    // own plot centre spends its life inside its own walls, and an apprentice, whose
    // shed is barely wider than it is, walks straight through them.
    const rot = (spec.plot ? spec.plot.rot : 0) | 0;
    const [ox, oz] = DOOR_DIR[rot] || DOOR_DIR[0];
    const reach = spec.kind === 'shed' ? 0.46 : 0.85;
    const home = [worldPos[0] + ox * reach, worldPos[2] + oz * reach];
    const f = {
      // ---- both halves read these
      id, spec,
      // ---- this half owns these
      // Long legs cover more ground per step, and no two people walk at the same cadence.
      stride: 0.88 + (height - 1) * 1.1,
      home,
      pos: null,
      target: null, yaw: 0, pause: 0,
      mode: opts.mode || 'idle', speed: 0.34, rng,
      radius: spec.kind === 'shed' ? 0.14 : 0.3, visible: true, path: null, pathI: 0, onDone: null,
      y: 0,
      strollIn: 0, keepHome: false, gate: undefined, gathering: false,
      // At a chore, and walking home from one with a bundle of wood. See startChore.
      work: null, hauling: false,
      // The two errand hooks, as records rather than closures - see walkRoute below.
      after: null, then: null,
      // Lent out. `chartered` means an errand planned somewhere else has this body and
      // nothing in here may plan another one for it; `aboard` is a function saying where
      // that errand is holding it, for the frames when it is not walking there itself.
      // See `charter` below - between them they are the whole of being borrowed.
      chartered: false, aboard: null, rideY: 0,
      // Whoever is talking to them, as [x, z], or null. See `attend`.
      attend: null,
      // The gold errand (see `startGold`). `active` is whether their session is running -
      // what they go back to doing when they get home with a bar; not `work`, which is an
      // idle settler's chore - and `goldIn` the seconds of work left before the next trip,
      // null until the first tick of work sets it. `carry` is what they are wheeling:
      // 'barrow' on the way out with it empty, 'gold' on the way home with it loaded, which
      // makes their walk 'barrow' or 'carry' on the wire (ANIMS in shared/settlerwire.mjs).
      // `goldRng` is made on first use, off the id: a stream of its own so that nothing here
      // draws from the middle of `rng`.
      active: opts.mode === 'hammer', goldIn: null, goldRng: null, carry: null,
      // Which animation the body is in, for the drawing half: 'walk', 'step', 'hammer' or
      // 'still'. Written every frame by step() and read by nothing in here. This is the
      // whole of what the renderer needs beyond a position.
      anim: 'still',
      // Which way to turn and how briskly, for the renderer. `faceAngle` is the one
      // case where an angle arrives from outside: a boat already knows its heading and
      // the body standing in it simply takes it.
      face: null, turn: 0.12, faceAngle: null,
    };
    // The draw order of this stream is load-bearing and must not be rearranged: every
    // settler's starting spot, heading and first errand come out of it in this order, so
    // moving one line moves everybody's feet.
    //
    // It used to carry the gait and the wave phase too - two numbers the walk never reads
    // and the renderer never stops reading - wedged in at positions one and five. Pulling
    // them out onto a stream of their own (see settler-figures.js) is what stops a change
    // to how somebody is *drawn* from silently changing where they *stand*, and it is the
    // one thing in this split that does not preserve the old numbers: everybody's starting
    // jitter, facing and first errand moved by a fraction. Nothing is stored that depends
    // on them, and a settler drifts further than that in the first two seconds.
    f.pos = [home[0] + rng.range(-0.12, 0.12), home[1] + rng.range(-0.12, 0.12)];
    f.yaw = rng.range(0, 6.28);
    f.pause = rng.range(0, 3);
    f.strollIn = rng.range(4, 150);
    f.speed = 0.34 * f.stride;
    f.y = groundOrDeck(f.pos[0], f.pos[1]);
    figures.set(id, f);
    return f;
  }

  function setVisible(id, v) {
    const f = figures.get(id);
    if (!f) return null;
    f.visible = v;
    return f;
  }
  function setMode(id, mode) {
    const f = figures.get(id);
    if (!f) return;
    if (mode === 'hammer' || mode === 'idle') f.active = mode === 'hammer';
    // Not while they are out for gold either: a trip counts itself in and out of `goldTrips`,
    // and a mode changed under it would leave the count one short for good. They pick up
    // `active` when they get home.
    if (f.mode !== 'walk' && f.mode !== 'sail' && f.mode !== 'gold') f.mode = mode;
  }

  // Being spoken to. The figure stops where it stands and turns towards `at` ([x, z] in
  // world units) until it is let go of again - somebody who wanders off mid-sentence
  // leaves you addressing an empty street. Nothing they were doing is thrown away, only
  // suspended: the errand, its path and the hammer are all still on them, so afterwards
  // they carry on from the spot the conversation caught them at. Returns the figure,
  // because the caller's next question is always where they are standing.
  function attend(id, at) {
    const f = figures.get(id);
    if (!f || !f.visible) return null;
    f.attend = at ? [at[0], at[1]] : [f.pos[0], f.pos[1]];
    return f;
  }
  function unattend(id) {
    const f = figures.get(id);
    if (f) f.attend = null;
  }

  // ---- errands ---------------------------------------------------------------
  // Once there are streets there is somewhere to go, so settlers leave the yard now
  // and then, walk the road network to somewhere else in town, stand about for a bit
  // and walk home again. Everything below is bookkeeping on top of the walk mode that
  // already existed: no new movement code, only a reason to move.
  let roads = null;
  let strolling = 0;
  // The nearest road cell to a destination off the network, cached - see nearestRoadCell.
  // Up here rather than beside it because setRoads has to empty it when the streets move.
  const roadNear = new Map();
  // Where a bridge carries the road over a river, and how high its deck is there. The
  // lookup itself is createStandHeight above, which the page uses to draw these same
  // people at the height this walked them to.
  let stand = createStandHeight(terrain, village);
  function setDecks(map) { stand = createStandHeight(terrain, village, map); }
  // One function whatever setDecks does behind it: this is read from three places in here
  // and handed out on the returned object, so it cannot be the thing that gets replaced.
  const groundOrDeck = (x, z) => stand(x, z);

  // The square's own cells, kept apart from the general road network so the Friday
  // gathering has somewhere specific to aim for instead of "some road cell".
  let squareList = [];
  function setRoads(paths, squares) {
    const cells = new Set();
    for (const p of paths || []) for (const [gx, gz] of p.cells) cells.add(gx + gz * terrain.size);
    const sq = [];
    for (const [gx, gz] of squares || []) { const k = gx + gz * terrain.size; cells.add(k); sq.push(k); }
    squareList = sq;
    roads = cells.size ? { cells, list: [...cells] } : null;
    for (const f of figures.values()) f.gate = undefined;   // streets moved; look again
    roadNear.clear();                                       // and so did the way to the quay
  }

  // Friday afternoon borrel: every settler not already spoken for walks to the square
  // and stays there until `setGather(false)` sends them home again. Bypasses MAX_STROLL
  // on purpose - this is the one time everyone is meant to be out at once.
  let gatherActive = false;
  function setGather(active) { gatherActive = active; }

  function nearestSquareCell(gate) {
    if (!squareList.length) return null;
    const size = terrain.size;
    const gx = gate % size, gz = (gate - (gate % size)) / size;
    let best = squareList[0], bd = Infinity;
    for (const k of squareList) {
      const kx = k % size, kz = (k - (k % size)) / size;
      const d = (kx - gx) * (kx - gx) + (kz - gz) * (kz - gz);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }

  function startGather(f) {
    const gate = gateOf(f);
    if (gate == null || !squareList.length) { f.gathering = false; return; }
    // Somewhere of your own on the square. Sending everybody to the cell nearest their own
    // front door puts everyone who lives on the same side of town in one huddle against
    // the same corner, which is exactly what it looked like. The cell comes out of the
    // figure's own rng, so the same settler takes the same spot every Friday rather than
    // shuffling about from one week to the next.
    //
    // Three tries and then the nearest cell after all: the square is one connected piece
    // of paving, but a borrel that silently skipped anybody whose random cell happened to
    // be unreachable would be a worse bargain than a slightly fuller corner.
    let out = null;
    for (let tries = 0; tries < 3 && !out; tries++) {
      out = roadRoute(gate, squareList[f.rng.int(squareList.length)]);
    }
    if (!out) out = roadRoute(gate, nearestSquareCell(gate));
    if (!out || !out.length) { f.gathering = false; return; }
    // And not onto the middle of that cell either. Two people sent to the same one would
    // otherwise stand in the same place to the millimetre; a third of a cell either way
    // keeps them inside their own square and out of each other.
    const last = out[out.length - 1];
    out[out.length - 1] = [last[0] + f.rng.range(-0.34, 0.34), last[1] + f.rng.range(-0.34, 0.34)];
    walkRoute(f, out, { kind: 'gather-out', route: out, home: [f.home[0], f.home[1]] });
  }

  // The road cell a figure steps out onto, cached: its front path by construction. The
  // same search, cell-for-cell, is shared/roads.mjs's houseGate - built for a door rather
  // than a spawned figure's home position, for a debug check that can never disagree with
  // this one about whether a house has a way out.
  function gateOf(f) {
    if (f.gate !== undefined) return f.gate;
    f.gate = null;
    if (roads) {
      const hx = Math.round(f.home[0] + terrain.half - 0.5);
      const hz = Math.round(f.home[1] + terrain.half - 0.5);
      let best = null, bd = Infinity;
      for (let dz = -GATE_REACH; dz <= GATE_REACH; dz++) {
        for (let dx = -GATE_REACH; dx <= GATE_REACH; dx++) {
          const k = (hx + dx) + (hz + dz) * terrain.size;
          if (!roads.cells.has(k)) continue;
          const d = dx * dx + dz * dz;
          if (d < bd) { bd = d; best = k; }
        }
      }
      f.gate = best;
    }
    return f.gate;
  }

  // Breadth first over road cells only. Roads are a thin network, so this stays small.
  function roadRoute(from, to) {
    if (!roads || from == null || to == null || from === to) return null;
    const size = terrain.size;
    const prev = new Map([[from, -1]]);
    const queue = [from];
    let head = 0;
    while (head < queue.length && head < 6000) {
      const cur = queue[head++];
      if (cur === to) {
        const out = [];
        for (let k = cur; k !== -1; k = prev.get(k)) out.push(terrain.cellWorld(k % size, (k - (k % size)) / size));
        out.reverse();
        return out;
      }
      const cx = cur % size, cz = (cur - cx) / size;
      for (const [nx, nz] of [[cx + 1, cz], [cx - 1, cz], [cx, cz + 1], [cx, cz - 1]]) {
        const k = nx + nz * size;
        if (!roads.cells.has(k) || prev.has(k)) continue;
        prev.set(k, cur);
        queue.push(k);
      }
    }
    return null;
  }

  // ---- what happens when a walk ends -----------------------------------------
  // An errand is two walks with a stand-about in between, and it used to be written as
  // nested closures: the arrival built a function that built another function. That reads
  // well and cannot survive leaving this process. A closure cannot be looked at, compared
  // against another machine's copy, written down or resumed - and all four of those are
  // things a settler who walks in Node and is drawn in a browser has to allow.
  //
  // So the two hooks a figure carries are plain records instead:
  //
  //   f.after   what to do when the path it is on runs out.
  //   f.then    what to do when the pause after that runs out.
  //
  // `f.onDone` stays a function, and only for the two calls that come from outside this
  // file - walkIn and sendOut. Those are somebody else's errand and will move when
  // shared/boating.mjs does.
  // `speed` is for the gold errand, whose legs draw their pace from the gold stream: the
  // draw here is from `rng`, and a new errand must not take numbers out of the middle of it.
  function walkRoute(f, points, after = null, onDone = null, speed = null) {
    f.path = [[f.pos[0], f.pos[1]], ...points];
    f.pathI = 0;
    f.mode = 'walk';
    f.keepHome = true;
    f.speed = speed ?? (0.42 + f.rng.range(0, 0.14)) * f.stride;
    f.after = after;
    f.onDone = onDone;
  }

  // The path ran out. Six kinds, three errands: out to the square, out along the roads or
  // out to the gold pit, and the walk home from each.
  function finishPath(f) {
    const a = f.after;
    f.after = null;
    if (!a) return;
    if (a.kind === 'gold-out') {
      // At the pile. Loading is its own mode rather than the idle branch's stand-about,
      // because that branch also starts strolls and the borrel, and a settler with a bar
      // half lifted is not free for either.
      f.target = null;
      f.mode = 'gold';
      f.pause = goldRngOf(f).range(GOLD_LOAD[0], GOLD_LOAD[1]);
      f.then = { kind: 'gold-home', route: a.route, home: a.home };
    } else if (a.kind === 'gold-home') {
      // Home with the bar, and back to work - or, if their session ended while they were
      // out, simply home.
      f.keepHome = false;
      f.home = a.home;
      f.carry = null;
      f.mode = f.active ? 'hammer' : 'idle';
      f.goldIn = goldRngOf(f).range(GOLD_AGAIN[0], GOLD_AGAIN[1]);
      goldTrips--;
    } else if (a.kind === 'stroll-out') {
      f.target = null;
      f.pause = f.rng.range(3, 11);          // stand about wherever the errand led
      f.then = { kind: 'stroll-home', route: a.route, home: a.home };
    } else if (a.kind === 'gather-out') {
      f.target = null;
      f.pause = f.rng.range(2, 5);
      // Stand about *here* for the rest of it. `home` is the point the idle wander circles
      // and theirs is a field away, so without this they arrive on the square and then
      // drift off it one small step at a time, heading for their own doorstep across the
      // grass. The real one is put back by the walk home below.
      f.home = [f.pos[0], f.pos[1]];
      f.then = { kind: 'gather-home', route: a.route, home: a.home };
    } else if (a.kind === 'stroll-home') {
      f.keepHome = false;
      f.home = a.home;
      f.strollIn = f.rng.range(40, 160);
      strolling--;
    } else if (a.kind === 'gather-home') {
      f.keepHome = false;
      f.home = a.home;
      f.gathering = false;
    } else if (a.kind === 'chore-out') {
      beginWork(f, a);
    } else if (a.kind === 'chore-home') {
      f.keepHome = false;
      f.home = a.home;
      f.hauling = false;
      f.strollIn = f.rng.range(30, 120);
      choring--;
    }
  }

  // The pause ran out and it is time to walk back. Same route, reversed, with the real
  // doorstep tacked on the end.
  function resume(f, t) {
    walkRoute(f, [...t.route].reverse().concat([t.home]), { kind: t.kind, home: t.home });
  }

  function startStroll(f) {
    const gate = gateOf(f);
    if (gate == null) { f.strollIn = f.rng.range(20, 60); return; }
    const size = terrain.size;
    const gx = gate % size, gz = (gate - (gate % size)) / size;
    let dest = null;
    for (let tries = 0; tries < 6 && dest === null; tries++) {
      const k = roads.list[f.rng.int(roads.list.length)];
      const kx = k % size, kz = (k - (k % size)) / size;
      const d = dist(kx - gx, kz - gz);
      if (d > 5 && d < 42) dest = k;
    }
    const out = dest === null ? null : roadRoute(gate, dest);
    if (!out || out.length < 3) { f.strollIn = f.rng.range(15, 50); return; }

    strolling++;
    walkRoute(f, out, { kind: 'stroll-out', route: out, home: [f.home[0], f.home[1]] });
  }

  // ---- chores ----------------------------------------------------------------
  // Where the work is. Fields, kitchen gardens and the edge of the wood come from the
  // keeper's page, which is the only thing that has planned them (web/js/hamlets.js,
  // web/js/world.js); the fishing spots come from lib/crowd.mjs, which works them out of
  // the coast and the quay. All of it is normalised here into one shape per site:
  //
  //   kind      'field' | 'garden' | 'wood' | 'fish'
  //   cell      [gx, gz], the land cell a route is planned to
  //   area      for a field or garden: [cx, cz, rx, rz], the rectangle worked over
  //   at        for wood: the trunk; for fish: where to stand
  //   via       for fish on the quay: plank points walked after `cell`, before `at`
  let sites = null;
  let choring = 0;
  function setWork(work) {
    const out = { field: [], garden: [], wood: [], fish: [] };
    const half = terrain.half;
    const rect = (kind) => (r) => {
      if (!Array.isArray(r) || r.length < 4) return;
      const [gx, gz, w, d] = r;
      if (!(w > 0 && d > 0)) return;
      // A margin off the edge so a hoe is never swung over the fence.
      const rx = w / 2 > 0.45 ? w / 2 - 0.3 : 0.15, rz = d / 2 > 0.45 ? d / 2 - 0.3 : 0.15;
      out[kind].push({ kind, cell: [gx, gz], size: [w, d], area: [gx + w / 2 - half, gz + d / 2 - half, rx, rz] });
    };
    for (const r of (work && work.fields) || []) rect('field')(r);
    for (const r of (work && work.gardens) || []) rect('garden')(r);
    for (const t of (work && work.trees) || []) {
      if (!Array.isArray(t) || t.length < 2) continue;
      const gx = Math.round(t[0] + half - 0.5), gz = Math.round(t[1] + half - 0.5);
      if (!terrain.isLand(gx, gz)) continue;
      out.wood.push({ kind: 'wood', cell: [gx, gz], at: [t[0], t[1]] });
    }
    for (const s of (work && work.fish) || []) {
      if (!s || !Array.isArray(s.cell) || !Array.isArray(s.at)) continue;
      out.fish.push({ kind: 'fish', cell: [s.cell[0], s.cell[1]], at: [s.at[0], s.at[1]], via: s.via || [] });
    }
    const any = out.field.length || out.garden.length || out.wood.length || out.fish.length;
    sites = any ? out : null;
  }

  // Which kind, and which one of it. The kinds within reach of this settler's own street
  // are weighed against each other, the favourite three times over; within a kind it is
  // one of the four nearest. The favourite is a hash of the id rather than a draw, so it
  // costs the walk's own stream nothing and the same person is the same fisherman on
  // every island rebuild.
  function pickSite(f, gate, nightAmount) {
    const size = terrain.size;
    const gx = gate % size, gz = (gate - (gate % size)) / size;
    const favourite = CHORE_KINDS[hash32(f.id + ':trade') % CHORE_KINDS.length];
    const near = {};
    let total = 0;
    for (const kind of CHORE_KINDS) {
      // After dark the land is left alone; a line can be wet until it is properly night.
      if (nightAmount > (kind === 'fish' ? 0.8 : 0.45)) continue;
      const reach = CHORE_REACH[kind];
      const list = [];
      const all = sites[kind];
      for (let i = 0; i < all.length; i++) {
        const s = all[i];
        const d = dist(s.cell[0] - gx, s.cell[1] - gz);
        if (d <= reach) list.push([d, i]);
      }
      if (!list.length) continue;
      list.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      near[kind] = list.slice(0, 4);
      total += CHORE_WEIGHT[kind] * (kind === favourite ? 3 : 1);
    }
    if (!total) return null;
    let roll = f.rng.next() * total;
    for (const kind of CHORE_KINDS) {
      if (!near[kind]) continue;
      roll -= CHORE_WEIGHT[kind] * (kind === favourite ? 3 : 1);
      if (roll > 0) continue;
      const pick = near[kind][f.rng.int(near[kind].length)];
      return sites[kind][pick[1]];
    }
    return null;
  }

  // Off to work. False if there was nothing to be had, so the caller falls back to a
  // plain stroll rather than losing the turn.
  function startChore(f, nightAmount) {
    const gate = gateOf(f);
    if (gate == null || !sites) return false;
    const site = pickSite(f, gate, nightAmount);
    if (!site) return false;
    // A field is not worked from one corner: the walk goes to a cell of it picked out of
    // the figure's own stream, and the bouts after that move about inside the rectangle.
    let cell = site.cell;
    if (site.area) cell = [site.cell[0] + f.rng.int(site.size[0]), site.cell[1] + f.rng.int(site.size[1])];
    const route = routeTo(f.id, cell);
    if (!route || !route.length) return false;
    let stand;
    if (site.kind === 'wood') {
      // Beside the trunk, on the side the walk came from, so nobody chops from inside it.
      const prev = route.length > 1 ? route[route.length - 2] : [f.pos[0], f.pos[1]];
      const dx = prev[0] - site.at[0], dz = prev[1] - site.at[1];
      const d = dist(dx, dz) || 1;
      stand = [site.at[0] + (dx / d) * 0.34, site.at[1] + (dz / d) * 0.34];
    } else if (site.kind === 'fish') {
      for (const p of site.via) route.push([p[0], p[1]]);
      stand = [site.at[0], site.at[1]];
    } else {
      const c = terrain.cellWorld(cell[0], cell[1]);
      stand = [c[0] + f.rng.range(-0.3, 0.3), c[1] + f.rng.range(-0.3, 0.3)];
    }
    route.push(stand);
    choring++;
    walkRoute(f, route, { kind: 'chore-out', route, home: [f.home[0], f.home[1]], site });
    return true;
  }

  // Arrived. The errand's second half is written down now, exactly as a stroll's is, and
  // the work stands in for the stand-about in between.
  function beginWork(f, a) {
    const s = a.site;
    f.target = null;
    f.pause = 0;
    const fishing = s.kind === 'fish';
    f.work = {
      kind: s.kind, anim: CHORE_ANIM[s.kind], site: s,
      left: fishing ? f.rng.range(70, 160) : f.rng.range(45, 120),
      bout: fishing ? f.rng.range(8, 16) : f.rng.range(3, 8),
      move: null,
    };
    f.then = { kind: 'chore-home', route: a.route, home: a.home };
  }

  // One bout is over; where the next one is. A field or a garden: somewhere else inside
  // the rectangle. Wood: the first bout is the axe, every one after it is bending for what
  // came down, a step or so round the tree. Fish: the same spot, a fresh cast.
  function nextBout(f, w) {
    const s = w.site;
    if (s.area) {
      const [cx, cz, rx, rz] = s.area;
      w.move = [cx + f.rng.range(-rx, rx), cz + f.rng.range(-rz, rz)];
      w.bout = f.rng.range(3, 8);
    } else if (s.kind === 'wood') {
      w.anim = 'gather';
      w.bout = f.rng.range(2.5, 4.5);
      // A point in the ring round the trunk, drawn the way the idle wander draws its disc.
      for (let tries = 0; tries < 12; tries++) {
        const u = f.rng.range(-1, 1), v = f.rng.range(-1, 1);
        const q = u * u + v * v;
        if (q > 1 || q < 0.25) continue;
        const r = 1.1 / Math.sqrt(q) * f.rng.range(0.55, 1);
        const x = s.at[0] + u * r, z = s.at[1] + v * r;
        const gx = Math.round(x + terrain.half - 0.5), gz = Math.round(z + terrain.half - 0.5);
        if (!terrain.isLand(gx, gz) || terrain.slope(gx, gz) > 1.3) continue;
        w.move = [x, z];
        break;
      }
    } else {
      w.bout = f.rng.range(8, 16);
    }
  }

  function workStep(f, dt) {
    const w = f.work;
    // The borrel is called: down tools and home first, then the square.
    if (gatherActive) w.left = 0;
    if (w.move && w.left > 0) {
      const dx = w.move[0] - f.pos[0], dz = w.move[1] - f.pos[1];
      const d = dist(dx, dz);
      if (d >= 0.05) {
        // 'walk', not 'step': only walkers travel at the walker rate (shared/settlerwire.mjs),
        // and a shuffle along the furrow sent as a keyframe would arrive ten seconds late
        // and be smeared over all ten.
        f.anim = 'walk';
        const stp = Math.min(d, SHUFFLE * f.stride * dt);
        f.pos[0] += (dx / d) * stp;
        f.pos[1] += (dz / d) * stp;
        face(f, dx, dz, 0.2);
        return;
      }
      w.move = null;
    }
    w.left -= dt;
    w.bout -= dt;
    if (w.left <= 0) {
      f.work = null;
      // Nobody comes back from the wood empty-handed.
      if (w.kind === 'wood') f.hauling = true;
      const t = f.then;
      f.then = null;
      if (t) resume(f, t);
      return;
    }
    f.anim = w.anim;
    if (w.site.kind === 'wood' && w.anim === 'chop') face(f, w.site.at[0] - f.pos[0], w.site.at[1] - f.pos[1], 0.15);
    if (w.bout <= 0) nextBout(f, w);
  }

  // ---- gold ---------------------------------------------------------------------
  // The gold pit by the square (Plans/goudkuil.md): where a settler goes before setting to
  // work. `setGold` is handed the site by whoever knows the island - lib/crowd.mjs, out of
  // the bundle - as three things in this island's own frame:
  //
  //   cell  the ground cell in front of the pit's open end, which the road leads to
  //   at    where a settler stands to load, just inside that end
  //   pile  the middle of the heap, which they face while loading
  //
  // No site, no trips: an island from before the pit, and the volcano, whose Codex settlers
  // hammer at their doors exactly as they always did.
  let gold = null;
  let goldTrips = 0;
  function setGold(site) {
    gold = site && site.cell && site.at && site.pile
      ? { cell: [site.cell[0], site.cell[1]], at: [site.at[0], site.at[1]], pile: [site.pile[0], site.pile[1]] }
      : null;
  }

  function goldRngOf(f) {
    if (!f.goldRng) f.goldRng = makeRng(hash32(f.id + ':gold'));
    return f.goldRng;
  }
  // A walking pace for a gold leg: the one walkRoute would have drawn, from the gold stream.
  const goldPace = (f) => (0.42 + goldRngOf(f).range(0, 0.14)) * f.stride;

  // Off to the pit: the road as far as it goes, the last stretch over the ground to the cell
  // in front of the pit, and a step inside. Every loader stands at a spot of their own
  // across the mouth - a third of a unit either way - so two at the pile at once are two
  // people and not one. No route (no road out of their yard yet, or none to the pit) puts
  // the trip off rather than giving it up.
  function startGold(f) {
    const r = goldRngOf(f);
    const out = routeTo(f.id, gold.cell);
    if (!out || !out.length) { f.goldIn = r.range(40, 120); return false; }
    const dx = gold.at[0] - gold.pile[0], dz = gold.at[1] - gold.pile[1];
    const d = dist(dx, dz) || 1;
    const side = r.range(-0.3, 0.3);
    out.push([gold.at[0] - (dz / d) * side, gold.at[1] + (dx / d) * side]);
    goldTrips++;
    // The barrow comes along from the first step: it is what the trip is for, and a settler
    // who fetched it from nowhere at the pit would be carrying gold home in their arms.
    f.carry = 'barrow';
    walkRoute(f, out, { kind: 'gold-out', route: out, home: [f.home[0], f.home[1]] }, null, goldPace(f));
    return true;
  }

  // The same way back with the barrow loaded, and the doorstep on the end.
  function carryHome(f, t) {
    f.carry = 'gold';
    walkRoute(f, [...t.route].reverse().concat([t.home]), { kind: 'gold-home', home: t.home }, null, goldPace(f));
  }

  // Carried over from the crowd this island had before it republished.
  //
  // The sea builds every crowd again from the bundle whenever an island publishes, and an
  // island with anybody at work publishes every scan - a house's `lastAt` moves - so once a
  // minute everybody is stood back at their own door. For most of what a settler does that
  // is no loss. For this errand it is all of it: somebody who lives further from the pit
  // than a minute's walk would set off, be put back, set off again, and never get there. So
  // what the gold errand has - the countdown to the next trip, or the trip itself with its
  // position, its path and the bar - is handed from the old figure to the new one, and only
  // that. Only when their doorstep is where it was: a house that moved gets a settler at
  // the new door, like everybody else. Returns whether anything was carried over.
  function adopt(id, old) {
    const f = figures.get(id);
    if (!f || !old || !gold || !old.home) return false;
    if (dist(old.home[0] - f.home[0], old.home[1] - f.home[1]) > 0.01) return false;
    if (old.goldRng) f.goldRng = old.goldRng;
    const kind = old.after && old.after.kind;
    const out = old.mode === 'gold' || (old.mode === 'walk' && (kind === 'gold-out' || kind === 'gold-home'));
    if (!out) {
      // At work between trips: keep the count running, so a republish is not a new start.
      if (f.active && old.active) f.goldIn = old.goldIn;
      return f.active && old.active;
    }
    f.pos = [old.pos[0], old.pos[1]];
    f.path = old.path;
    f.pathI = old.pathI;
    f.mode = old.mode;
    f.speed = old.speed;
    f.after = old.after;
    f.then = old.then;
    f.pause = old.pause;
    f.target = null;
    f.keepHome = old.keepHome;
    f.carry = old.carry;
    f.goldIn = old.goldIn;
    f.face = old.face;
    f.turn = old.turn;
    f.y = old.y;
    goldTrips++;
    return true;
  }

  // Walk in from the shore to a plot.
  function walkIn(id, fromCell, toCell, onDone) {
    const f = figures.get(id);
    if (!f) { onDone && onDone(); return; }
    const path = findPath(terrain, fromCell, toCell, null);
    if (!path || path.length < 2) { onDone && onDone(); return; }
    f.path = path;
    f.pathI = 0;
    f.pos = [path[0][0], path[0][1]];
    f.mode = 'walk';
    f.speed = Math.max(1.1, path.length / 7.5);
    f.after = null;
    f.onDone = onDone;
    f.visible = true;
  }

  // ---- lending a settler out --------------------------------------------------
  // Everything above plans its own errands. What follows lets another part of the island
  // plan one instead - today that is shared/boating.mjs, taking somebody out on the water -
  // without that part having to know anything about slots, gaits or the road graph.
  //
  // The bargain is `chartered`. A borrowed settler is invisible to the stroll timer, to
  // the borrel and to the idle wander, because two planners moving one body is how a
  // settler ends up walking to the square from the middle of the sea. `release` gives them
  // back, and nothing here ever takes them back on its own: an errand that stops halfway
  // leaves somebody standing where it stopped, which is at least legible.

  // Who could be spared. The same tests the stroll makes - at home, doing nothing, and
  // with a street to step out onto - plus not already lent out and not at the borrel.
  // Shuffled with the caller's rng, so it is not the same handful of neighbours who get
  // every afternoon off.
  function available(want, rng) {
    const out = [];
    if (gatherActive) return out;          // Friday afternoon: the whole village is busy
    for (const f of figures.values()) {
      if (!f.visible || f.chartered || f.gathering || f.attend || f.deckY) continue;
      if (f.mode !== 'idle' || f.then) continue;
      if (gateOf(f) == null) continue;
      out.push(f);
    }
    for (let i = out.length - 1; i > 0 && rng; i--) {
      const j = rng.int(i + 1);
      const swap = out[i];
      out[i] = out[j];
      out[j] = swap;
    }
    return out.slice(0, want).map((f) => ({ id: f.id, name: f.spec.name, home: [f.home[0], f.home[1]] }));
  }

  // Take one. `keepHome` is what stops the walk that follows from deciding the quay is
  // where this settler lives now - see the note on it in the walk branch of step().
  function charter(id) {
    const f = figures.get(id);
    if (!f || f.chartered || !f.visible) return false;
    f.chartered = true;
    f.keepHome = true;
    f.target = null;
    f.then = null;
    return true;
  }

  // A route from a settler's own door to any cell on the island: the road network as far
  // as it reaches, then open ground for the last stretch. The roads stop short of the
  // water - no lane is laid over sand - so a walk to the shore is always these two halves.
  // The nearest road cell to a destination is cached, because a caller asks for the same
  // quay over and over and the road list is thousands of cells long.
  function nearestRoadCell(cell) {
    const key = `${cell[0]},${cell[1]}`;
    if (roadNear.has(key)) return roadNear.get(key);
    let best = null, bd = Infinity;
    if (roads) {
      const size = terrain.size;
      for (const k of roads.list) {
        const kx = k % size, kz = (k - (k % size)) / size;
        const d = (kx - cell[0]) * (kx - cell[0]) + (kz - cell[1]) * (kz - cell[1]);
        if (d < bd) { bd = d; best = k; }
      }
    }
    roadNear.set(key, best);
    return best;
  }
  function routeTo(id, cell) {
    const f = figures.get(id);
    const gate = f ? gateOf(f) : null;
    if (gate == null || !roads) return null;
    const end = nearestRoadCell(cell);
    if (end == null) return null;
    const byRoad = end === gate ? [] : roadRoute(gate, end);
    if (byRoad === null) return null;
    const size = terrain.size;
    const overland = findPath(terrain, [end % size, (end - (end % size)) / size], cell, null);
    if (!overland || !overland.length) return null;
    return [...byRoad, ...overland.slice(1)];
  }

  // Walk them along a route somebody else worked out. `onDone` is called with true on
  // arrival and with false if there was nothing to walk, so a caller never has to wonder
  // whether its errand started.
  function sendOut(id, points, onDone) {
    const f = figures.get(id);
    if (!f || !f.chartered || !points || !points.length) { onDone && onDone(false); return false; }
    // Fourth argument, not third. walkRoute took the callback third until the errand hooks
    // became records and `after` was slotted in ahead of it; this call was not moved with
    // it, so the arrival closure was landing in `f.after`, where finishPath looked for a
    // `kind`, found undefined on a function, matched none of its four branches and dropped
    // it without a word. Every outing therefore walked to the end of the planks, stood
    // there for the ten minutes of VOYAGE_MAX and was written off as overdue - which is a
    // failure that looks exactly like nobody having felt like sailing.
    walkRoute(f, points, null, () => { f.mode = 'idle'; onDone && onDone(true); });
    return true;
  }

  // Off their own feet: `at` is called every frame and answers { x, z, yaw, y }, which is
  // a hull's position and the height of its deck. Called with null they stand on the
  // ground again, wherever the ride left them.
  function carry(id, at) {
    const f = figures.get(id);
    if (!f || !f.chartered) return;
    f.aboard = typeof at === 'function' ? at : null;
    f.mode = 'idle';
    f.path = null;
    f.after = null;
    f.onDone = null;
  }

  // Given back. They keep the door they started at - `charter` pinned it - and go to the
  // back of the errand queue, so nobody comes home from the water and strolls straight off
  // again.
  function release(id) {
    const f = figures.get(id);
    if (!f) return;
    f.chartered = false;
    f.aboard = null;
    f.keepHome = false;
    f.mode = 'idle';
    f.path = null;
    f.after = null;
    f.onDone = null;
    f.pause = f.rng.range(1, 4);
    f.strollIn = f.rng.range(40, 160);
  }

  // Where a settler is standing, height and all. The height is the interesting half:
  // a body on the quay's planks is at the deck's height and one on the lane is on the
  // ground, and whoever is about to lift them into a boat has to start the lift from
  // wherever they actually are rather than from a guess about which it was.
  function where(id) {
    const f = figures.get(id);
    return f ? { x: f.pos[0], z: f.pos[1], yaw: f.yaw, y: f.y } : null;
  }

  // Whether a borrowed settler is still there to be borrowed. A village rebuild takes
  // figures away under an errand's feet, and an outing that kept steering a boat for a
  // settler who no longer exists would sail it round the island for ever.
  function has(id) {
    const f = figures.get(id);
    return !!(f && f.visible && f.chartered);
  }

  // One step of the world. Every branch ends by having said which animation the body is
  // in, and that word is the entire contract with the renderer: 'walk' is along a path,
  // 'step' is the small idle wander, 'hammer' is building, 'still' is everything else.
  // The renderer turns those into bob, gait and arm swing off its own clock.
  function step(dt, nightAmount) {
    // How many have set off for the square so far this tick - see GATHER_PER_TICK.
    let starting = 0;
    // And how many have planned a chore - see CHORES_PER_TICK.
    let planned = 0;
    const tryChore = (f, night) => {
      if (!sites || choring >= MAX_CHORES || planned >= CHORES_PER_TICK) return false;
      // Drawn only when a chore is on offer at all, so an island with no work known to it
      // takes exactly the draws it always took.
      if (f.rng.next() >= CHORE_SHARE) return false;
      planned++;
      return startChore(f, night);
    };
    for (const f of figures.values()) {
      if (!f.visible) continue;
      f.anim = 'still';

      if (f.aboard) {
        // Carried. Something else - a boat - is deciding where this body is, and all that
        // is left here is to stand in it and face the way it is going. Tested before
        // `attend`, because being spoken to must not anchor somebody to a spot the hull
        // they are standing in has already left.
        const at = f.aboard();
        if (at) {
          f.pos[0] = at.x;
          f.pos[1] = at.z;
          f.faceAngle = at.yaw;
          f.face = null;
          f.rideY = at.y;
        }
      } else if (f.attend) {
        // Held by a conversation: no step, no errand, no hammer - only the head coming
        // round to whoever is talking. The same lerp the walking uses, so they turn at
        // the speed they take corners at instead of snapping to face you.
        face(f, f.attend[0] - f.pos[0], f.attend[1] - f.pos[1], 0.12);
      } else if (f.mode === 'walk' && f.path) {
        // 'walk' whether or not a step is taken this frame: the old code set the walking
        // bob outside its own if/else, so an arrival still finishes the stride it was in
        // the middle of. Cutting to 'still' on that last frame puts a visible hitch on the
        // end of every errand in the village.
        // Home from the wood with a bundle on the shoulder: still a walk to everything that
        // asks, only drawn carrying something.
        // And to and from the gold pit behind a wheelbarrow (Plans/goudkuil.md): 'barrow'
        // with it empty, 'carry' with it loaded - both a walk to everything on the wire too.
        f.anim = f.carry === 'gold' ? 'carry' : f.carry === 'barrow' ? 'barrow' : f.hauling ? 'haul' : 'walk';
        const t = f.path[Math.min(f.pathI + 1, f.path.length - 1)];
        const dx = t[0] - f.pos[0], dz = t[1] - f.pos[1];
        const d = dist(dx, dz);
        if (d < 0.12) {
          f.pathI++;
          if (f.pathI >= f.path.length - 1) {
            f.mode = 'idle'; f.path = null;
            if (!f.keepHome) f.home = [f.pos[0], f.pos[1]];   // an arrival settles here; an errand does not
            finishPath(f);
            if (f.onDone) { const cb = f.onDone; f.onDone = null; cb(); }
          }
        } else {
          const step = Math.min(d, f.speed * dt);
          f.pos[0] += (dx / d) * step;
          f.pos[1] += (dz / d) * step;
          face(f, dx, dz, 0.2);
        }
      } else if (f.mode === 'hammer') {
        f.anim = 'hammer';
        // Home is the doorstep, not the centre of the house. A ring around it put
        // half the builders through the wall and made the others hammer away from it.
        // Work on its outward side and face the building, independent of spawn jitter.
        const [ox, oz] = DOOR_DIR[f.spec.plot?.rot | 0] || DOOR_DIR[0];
        const clearance = f.spec.kind === 'shed' ? 0.20 : 0.35;
        const dx = f.home[0] + ox * clearance - f.pos[0];
        const dz = f.home[1] + oz * clearance - f.pos[1];
        const d = dist(dx, dz);
        if (d > 0) {
          const step = Math.min(d, 0.5 * dt);
          f.pos[0] += (dx / d) * step;
          f.pos[1] += (dz / d) * step;
        }
        face(f, -ox, -oz, 0.15);
        // And, with a pit on the island, off for gold now and then - first thing after
        // setting to work, then every few minutes of it. Not while the borrel is on: the
        // square is full and the pit is next to it, and nobody fetches work to a party.
        // A trip that cannot start because MAX_GOLD are already out waits here, a tick at
        // a time, which costs one comparison.
        if (gold && f.active && !gatherActive) {
          if (f.goldIn == null) f.goldIn = goldRngOf(f).range(GOLD_FIRST[0], GOLD_FIRST[1]);
          f.goldIn -= dt;
          if (f.goldIn <= 0 && goldTrips < MAX_GOLD && startGold(f)) f.anim = 'barrow';
        }
      } else if (f.mode === 'gold') {
        // At the pile, loading the barrow: facing the heap, bent over it ('load' - the page
        // parks the barrow in front of them), and then home with it along the way they came.
        // A trip carried over from an older crowd without its record (see `adopt`, which
        // never does this, but a record is cheap to check) is simply ended where it stands.
        f.anim = 'load';
        if (gold) face(f, gold.pile[0] - f.pos[0], gold.pile[1] - f.pos[1], 0.15);
        f.pause -= dt;
        if (f.pause <= 0) {
          const t = f.then;
          f.then = null;
          if (t && t.kind === 'gold-home') { carryHome(f, t); f.anim = 'carry'; }
          else { f.mode = f.active ? 'hammer' : 'idle'; f.carry = null; goldTrips--; }
        }
      } else if (f.chartered) {
        // Between the legs of somebody else's errand: off the planks and into the boat, or
        // standing on the quay waiting for a hull. Whoever chartered them says what happens
        // next, and a stroll started here would walk away from it mid-sentence.
        f.pause = 0;
      } else if (f.work) {
        // At a chore. Its own branch rather than a stand-about, because the wander below
        // would walk them back towards their own doorstep one small step at a time.
        workStep(f, dt);
      } else {
        f.pause -= dt;
        // The borrel ending cuts every wait short, so nobody lingers on the square
        // past closing time just because their own pause timer hadn't run out yet.
        if (f.gathering && !gatherActive) f.pause = Math.min(f.pause, 0);
        // Nobody goes home while the borrel is still on. The pause above is a fidget
        // timer of a few seconds, not the length of the party, so without this they turn
        // round and walk off again the moment they arrive. The line above is what lets
        // them go: when the borrel ends it cuts the pause to nothing and this fires on
        // the very next frame.
        if (f.then && f.pause <= 0 && !(f.gathering && gatherActive)) {
          const t = f.then; f.then = null; resume(f, t);
          continue;
        }
        if (gatherActive && !f.gathering && !f.deckY && roads && squareList.length && starting < GATHER_PER_TICK) {
          f.gathering = true;
          starting++;
          startGather(f);
          if (f.mode === 'walk') continue;
        }
        // Fewer errands after dark, and never more at once than the eye can follow.
        f.strollIn -= dt;
        if (!gatherActive && f.strollIn <= 0 && roads && strolling < MAX_STROLL && !f.deckY) {
          if (nightAmount > 0.55 && f.rng.next() < nightAmount) f.strollIn = f.rng.range(20, 70);
          else if (!tryChore(f, nightAmount)) startStroll(f);
          if (f.mode === 'walk') continue;
        }
        if (!f.target && f.pause <= 0) {
          // A point in the disc around the doorstep, without an angle and therefore
          // without a cosine. Draw a pair in the square and keep it if it fell inside
          // the circle - uniform in direction, which is all the wander ever wanted.
          // Twelve tries is about a one in ten million chance of coming up empty, and
          // coming up empty means standing still for one more beat.
          let u = 0, v = 0, d2 = 0;
          for (let tries = 0; tries < 12; tries++) {
            u = f.rng.range(-1, 1);
            v = f.rng.range(-1, 1);
            const q = u * u + v * v;
            if (q <= 1 && q > 1e-9) { d2 = q; break; }
          }
          if (d2) {
            const r = f.rng.range(0.1, f.radius) / Math.sqrt(d2);
            f.target = [f.home[0] + u * r, f.home[1] + v * r];
          }
        }
        if (f.target) {
          const dx = f.target[0] - f.pos[0], dz = f.target[1] - f.pos[1];
          const d = dist(dx, dz);
          if (d < 0.06) { f.target = null; f.pause = f.rng.range(1.2, 4.5); } else {
            f.anim = 'step';
            const step = Math.min(d, f.speed * dt);
            f.pos[0] += (dx / d) * step;
            f.pos[1] += (dz / d) * step;
            face(f, dx, dz, 0.12);
          }
        }
      }

      f.y = f.aboard ? f.rideY : (f.deckY != null ? f.deckY : groundOrDeck(f.pos[0], f.pos[1]));
    }
  }

  // Whole ticks of a fixed length, which is the only way two machines can agree.
  // Accumulated wall-clock dt diverges immediately however identical the code is - the
  // frames simply do not line up - so the caller keeps the accumulator and this counts
  // ticks.
  function advance(ticks = 1, nightAmount = 0) {
    for (let n = 0; n < ticks; n++) step(DT, nightAmount);
  }

  return {
    figures, spawn, setVisible, setMode, attend, unattend,
    setRoads, setDecks, setGather, setWork, walkIn, step, advance,
    available, charter, routeTo, sendOut, carry, release, has, where,
    setGold, adopt, goldTrips: () => goldTrips,
    groundOrDeck,
    findPath: (a, b) => findPath(terrain, a, b, null),
  };
}
