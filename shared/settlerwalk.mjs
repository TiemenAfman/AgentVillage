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
import { quayBasin } from './quay-basin.mjs';
import { makeRng, hash32, clamp } from './rng.mjs';
import { GATE_REACH } from './roads.mjs';

export const MAX_STROLL = 36;      // settlers out on an errand at the same time

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
// Which way a plot's door faces, by its rotation: 0 = -z, 1 = +x, 2 = +z, 3 = -x.
const DOOR_DIR = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// 4-neighbour A* over the cell grid, used when a settler walks in from the beach.
export function findPath(terrain, from, to, blocked) {
  const size = terrain.size;
  const key = (x, z) => x + z * size;
  const open = [[0, key(from[0], from[1])]];
  const g = new Map([[key(from[0], from[1]), 0]]);
  const prev = new Map();
  const goal = key(to[0], to[1]);
  let guard = 0;
  while (open.length && guard++ < 12000) {
    open.sort((a, b) => a[0] - b[0]);
    const [, cur] = open.shift();
    if (cur === goal) break;
    const cx = cur % size, cz = (cur - (cur % size)) / size;
    for (const [nx, nz] of [[cx + 1, cz], [cx - 1, cz], [cx, cz + 1], [cx, cz - 1]]) {
      if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
      if (!terrain.isLand(nx, nz)) continue;
      const k = key(nx, nz);
      if (blocked && blocked.has(k) && k !== goal) continue;
      const cost = (g.get(cur) || 0) + 1 + 4 * terrain.slope(nx, nz);
      if (g.has(k) && g.get(k) <= cost) continue;
      g.set(k, cost);
      prev.set(k, cur);
      open.push([cost + Math.abs(nx - to[0]) + Math.abs(nz - to[1]), k]);
    }
  }
  if (!prev.has(goal) && key(from[0], from[1]) !== goal) return null;
  const out = [];
  for (let k = goal; k !== undefined; k = prev.get(k)) {
    out.push(terrain.cellWorld(k % size, (k - (k % size)) / size));
    if (k === key(from[0], from[1])) break;
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

export function createWalk(terrain, village = null) {
  const basin = quayBasin(village, terrain);
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
      // The two errand hooks, as records rather than closures - see walkRoute below.
      after: null, then: null,
      // Lent out. `chartered` means an errand planned somewhere else has this body and
      // nothing in here may plan another one for it; `aboard` is a function saying where
      // that errand is holding it, for the frames when it is not walking there itself.
      // See `charter` below - between them they are the whole of being borrowed.
      chartered: false, aboard: null, rideY: 0,
      // Whoever is talking to them, as [x, z], or null. See `attend`.
      attend: null,
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
    if (f && f.mode !== 'walk' && f.mode !== 'sail') f.mode = mode;
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
  // Where a bridge carries the road over a river, and how high its deck is there.
  let deckAt = new Map();
  function setDecks(map) { deckAt = map || new Map(); }
  const groundOrDeck = (x, z) => {
    const gx = Math.round(x + terrain.half - 0.5), gz = Math.round(z + terrain.half - 0.5);
    const ramp = basin?.rampHeight(x, z);
    if (ramp != null) return ramp;
    const d = deckAt.get(gx + gz * terrain.size);
    return d != null ? d : terrain.worldHeight(x, z);
  };

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
  function walkRoute(f, points, after = null, onDone = null) {
    f.path = [[f.pos[0], f.pos[1]], ...points];
    f.pathI = 0;
    f.mode = 'walk';
    f.keepHome = true;
    f.speed = (0.42 + f.rng.range(0, 0.14)) * f.stride;
    f.after = after;
    f.onDone = onDone;
  }

  // The path ran out. Four kinds, two errands: out to the square or out along the roads,
  // and the walk home from either.
  function finishPath(f) {
    const a = f.after;
    f.after = null;
    if (!a) return;
    if (a.kind === 'stroll-out') {
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
        f.anim = 'walk';
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
        const dx = f.home[0] - f.pos[0], dz = f.home[1] - f.pos[1];
        const d = dist(dx, dz);
        const want = 0.52;
        if (Math.abs(d - want) > 0.08) {
          const dir = d > want ? 1 : -1;
          f.pos[0] += (dx / (d || 1)) * dir * 0.5 * dt;
          f.pos[1] += (dz / (d || 1)) * dir * 0.5 * dt;
        }
        face(f, dx, dz, 0.15);
      } else if (f.chartered) {
        // Between the legs of somebody else's errand: off the planks and into the boat, or
        // standing on the quay waiting for a hull. Whoever chartered them says what happens
        // next, and a stroll started here would walk away from it mid-sentence.
        f.pause = 0;
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
          else startStroll(f);
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
    setRoads, setDecks, setGather, walkIn, step, advance,
    available, charter, routeTo, sendOut, carry, release, has, where,
    groundOrDeck,
    findPath: (a, b) => findPath(terrain, a, b, null),
  };
}
