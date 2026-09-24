// The keeper's hand on the layout.
//
// lib/layout.mjs plans the island by itself and never moves a thing that already stands:
// that is the rule the whole file is built on. This module is the one exception, and it is
// an exception in exactly one sense - *who* decides. A scan decides nothing here. The
// keeper draws up a plan in the browser (web/js/plan-mode.js), it arrives over
// POST /api/plan, and it is applied once, deliberately, in the slot in scan.mjs where
// `clearRoads` already runs: after the model is built and before `placeAll` lays whatever
// the plan left unlaid. The scan after that is byte-identical again, which is the promise
// docs/branches.md asks for and tests/plan-*.test.mjs measure.
//
// Two ops so far. `move` sets one or more whole hamlets (lobes) down elsewhere, as a rigid
// translation by a super-cell delta: every house, every shed, the land itself. Houses do
// not move on their own - a house stands on the land of its own project, and that land is
// what moves. `zone` marks whole super-cells the keeper wants nothing built on, kept in
// `layout.zones` and enforced by `placeAll` exactly the way a polder's dike is (see
// `zoneCells` in lib/layout.mjs).
//
// Everything here validates first and mutates second, per op, so a plan whose third op is
// refused still reports a verdict for its fourth against the island the first two made -
// and nothing is written whatever the verdicts say: scan.mjs runs the whole plan on a copy
// first, and only a plan that passes in full is applied to the layout that goes to disk.
//
// What `placeAll` will not do for us, and this file therefore does: `placeAll` refuses
// nothing. Measured, two houses set down on a slope of 2.1 with nineteen unbuildable cells
// under them were accepted, roaded and given an office. Every plot it places itself goes
// through `Super.eligible` first; a plot handed to it does not. So the eligibility check
// is not a nicety here, it is the product.
import fs from 'node:fs';
import { makeTerrain } from '../shared/terrain.mjs';
import { writeJsonAtomic } from './paths.mjs';
import { blockOf, centreOfCell, superComplete } from '../shared/lattice.mjs';
import { reachableFromSquare } from '../shared/roads.mjs';
import {
  Super, replayGrid, heldOf, districtOrder, registerLand, latticeOf, outsideDoor, placeAll,
  polderCandidate, holdsLand, touchesShore, polderFromSupers, digPolder, fairwayHeld, zoneCells, markPath,
  NONE, TOWN, TOWN_CORE_R, BELT, FREE, PATH, SQUARE, BRIDGE, BLOCKED, PLOT, PIER, RESERVED,
} from './layout.mjs';

export const PLAN_CAPS = {
  ops: 64,            // one plan
  lobes: 22,          // hamlets in one move
  shift: 64,          // super-cells, either axis - the whole island is about 65 across
  zoneSupers: 512,    // per op, add and remove each
  polderSupers: 24,   // one hand-drawn polder; twice the ladder's, and every manifest row carries it
  polders: 64,        // the island bundle's own ceiling on the list
  roadCells: 512,     // one hand-drawn road; the island is about 260 cells across
  span: 12,           // cells of deck in one crossing. The router stops at five (MAX_SPAN in
                      // lib/layout.mjs) because it builds unasked; a hand may reach further,
                      // but past this it is a causeway over a lake, not a bridge over a river
  passes: 3,          // placeAll runs before a layout has to have settled
};
const OPS = new Set(['move', 'zone', 'polder', 'unpolder', 'parcel', 'road']);
const ZONE_KINDS = new Set(['no-build']);
const SNAPSHOT_RE = /^layout\.before-plan-\d{8}-\d{6}\.json$/;
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const ckey = (c) => `${c[0]},${c[1]}`;
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---- the wire ----------------------------------------------------------------------
// Rebuilt field by field and never spread, the way lib/placements.mjs and the island
// bundle do it, because this arrives on a socket. District ids are the one thing taken
// verbatim: they are raw folder paths (`p:d:\git\x`), so they are never matched with a
// regex and never put in a file name - they are looked up by `hasOwn` in the layout and
// nothing else. The words in the errors are for the ledger in the planner, so they say
// what is wrong in the island's own terms.
function int(v, what, { min = -Infinity, max = Infinity } = {}) {
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new Error(`${what} must be a whole number`);
  if (v < min || v > max) throw new Error(`${what} is out of range (${v})`);
  return v;
}
function superList(v, what, cap) {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new Error(`${what} must be a list of super-cells`);
  if (v.length > cap) throw new Error(`${what} names more than ${cap} super-cells`);
  const seen = new Set();
  const out = [];
  for (const c of v) {
    if (!Array.isArray(c) || c.length !== 2) throw new Error(`${what} has an entry that is not [i, j]`);
    const i = int(c[0], `${what}[i]`, { min: -1024, max: 1024 });
    const j = int(c[1], `${what}[j]`, { min: -1024, max: 1024 });
    const k = ckey([i, j]);
    if (seen.has(k)) continue;
    seen.add(k); out.push([i, j]);
  }
  return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}
function str(v, what, max = 512) {
  if (typeof v !== 'string' || !v.length || v.length > max) throw new Error(`${what} must be a string`);
  if (v === '__proto__' || v === 'constructor' || v === 'prototype') throw new Error(`${what} is not a name`);
  return v;
}

// A hand-drawn road: grid cells, each one a step from the last, none twice. The range
// check is only against nonsense here; whether a cell is on this island's grid is
// `opRoad`'s question, asked of the terrain.
function roadCells(v, what) {
  if (!Array.isArray(v)) throw new Error(`${what}: a road is a list of cells`);
  if (v.length < 2) throw new Error(`${what}: a road is at least two cells long`);
  if (v.length > PLAN_CAPS.roadCells) throw new Error(`${what}: a road is at most ${PLAN_CAPS.roadCells} cells long`);
  const seen = new Set();
  const out = [];
  for (const c of v) {
    if (!Array.isArray(c) || c.length !== 2) throw new Error(`${what}: a road has an entry that is not [gx, gz]`);
    const gx = int(c[0], `${what}: gx`, { min: 0, max: 4096 });
    const gz = int(c[1], `${what}: gz`, { min: 0, max: 4096 });
    if (seen.has(ckey([gx, gz]))) throw new Error(`${what}: the road crosses itself at ${gx},${gz}`);
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - gx) + Math.abs(last[1] - gz) !== 1) throw new Error(`${what}: the road jumps from ${ckey(last)} to ${gx},${gz}`);
    seen.add(ckey([gx, gz])); out.push([gx, gz]);
  }
  return out;
}

// Four-connected, the way `planPolder` grows one: a polder in two pieces is two dikes and
// one causeway, and the piece without the causeway has no way to town.
function connected(supers) {
  const own = new Set(supers.map(ckey));
  const seen = new Set([ckey(supers[0])]);
  const q = [supers[0]];
  while (q.length) {
    const [i, j] = q.pop();
    for (const [a, b] of N4) {
      const k = ckey([i + a, j + b]);
      if (own.has(k) && !seen.has(k)) { seen.add(k); q.push([i + a, j + b]); }
    }
  }
  return seen.size === supers.length;
}

export function parsePlan(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('a plan is an object with ops in it');
  const ops = raw.ops;
  if (!Array.isArray(ops) || !ops.length) throw new Error('a plan needs at least one op');
  if (ops.length > PLAN_CAPS.ops) throw new Error(`a plan holds at most ${PLAN_CAPS.ops} ops`);
  const out = [];
  for (const [n, o] of ops.entries()) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error(`op ${n} is not an object`);
    if (!OPS.has(o.op)) throw new Error(`op ${n}: unknown op "${String(o.op).slice(0, 24)}"`);
    if (o.op === 'move') {
      if (!Array.isArray(o.lobes) || !o.lobes.length) throw new Error(`op ${n}: a move names at least one hamlet`);
      if (o.lobes.length > PLAN_CAPS.lobes) throw new Error(`op ${n}: a move names at most ${PLAN_CAPS.lobes} hamlets`);
      const seen = new Set();
      const lobes = [];
      for (const l of o.lobes) {
        if (!l || typeof l !== 'object') throw new Error(`op ${n}: a hamlet is { district, lobe }`);
        const district = str(l.district, `op ${n}: district`);
        const lobe = int(l.lobe === undefined ? 0 : l.lobe, `op ${n}: lobe`, { min: 0, max: 8 });
        const k = `${district}#${lobe}`;
        if (seen.has(k)) continue;
        seen.add(k); lobes.push({ district, lobe });
      }
      const di = int(o.di, `op ${n}: di`, { min: -PLAN_CAPS.shift, max: PLAN_CAPS.shift });
      const dj = int(o.dj, `op ${n}: dj`, { min: -PLAN_CAPS.shift, max: PLAN_CAPS.shift });
      if (!di && !dj) throw new Error(`op ${n}: a move of nothing at all`);
      out.push({ op: 'move', lobes, di, dj });
    } else if (o.op === 'zone') {
      const kind = str(o.kind === undefined ? 'no-build' : o.kind, `op ${n}: kind`, 32);
      if (!ZONE_KINDS.has(kind)) throw new Error(`op ${n}: unknown zone kind "${kind}"`);
      const add = superList(o.add, `op ${n}: add`, PLAN_CAPS.zoneSupers);
      const remove = superList(o.remove, `op ${n}: remove`, PLAN_CAPS.zoneSupers);
      if (!add.length && !remove.length) throw new Error(`op ${n}: a zone op that changes nothing`);
      out.push({ op: 'zone', kind, add, remove });
    } else if (o.op === 'polder') {
      const supers = superList(o.supers, `op ${n}: supers`, PLAN_CAPS.polderSupers);
      if (!supers.length) throw new Error(`op ${n}: a polder needs at least one super-cell`);
      if (!connected(supers)) throw new Error(`op ${n}: a polder is one piece of land, not several`);
      out.push({ op: 'polder', supers });
    } else if (o.op === 'parcel') {
      const district = str(o.district, `op ${n}: district`);
      const lobe = int(o.lobe === undefined ? 0 : o.lobe, `op ${n}: lobe`, { min: 0, max: 8 });
      const add = superList(o.add, `op ${n}: add`, PLAN_CAPS.zoneSupers);
      const remove = superList(o.remove, `op ${n}: remove`, PLAN_CAPS.zoneSupers);
      if (!add.length && !remove.length) throw new Error(`op ${n}: a parcel op that changes nothing`);
      out.push({ op: 'parcel', district, lobe, add, remove });
    } else if (o.op === 'road') {
      out.push({ op: 'road', cells: roadCells(o.cells, `op ${n}`) });
    } else if (o.op === 'unpolder') {
      // One per plan: `layout.polders` is indexed, and a second splice would name the wrong
      // one. Two polders to give back is two plans.
      if (out.some((x) => x.op === 'unpolder')) throw new Error(`op ${n}: one polder can be given back per plan`);
      out.push({ op: 'unpolder', index: int(o.index, `op ${n}: index`, { min: 0, max: PLAN_CAPS.polders - 1 }) });
    }
  }
  return { ops: out };
}

// ---- the snapshot ------------------------------------------------------------------
// The undo point. Written next to layout.json before anything is, in the shape of the one
// that already sits there (`layout.before-256-20260918-151140.json`), and named by the
// server alone - nothing in a request ever becomes part of a file name.
export function snapshotName(now = new Date()) {
  const d = new Date(now);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `layout.before-plan-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.json`;
}
export function isSnapshotName(s) { return typeof s === 'string' && SNAPSHOT_RE.test(s); }

// ---- applying a plan ---------------------------------------------------------------
// `ctx` holds what every op reads and none may build twice: the terrain the layout was
// planned on, the lattice, a `Super` with the land register replayed on it, and the
// model's view of who is who. A zone changes what is held, so the register is rebuilt
// lazily after one - `dirty` - rather than every op paying for it.
function context(layout, model, { seed, size }) {
  const terrain = makeTerrain(seed, { size, polders: layout.polders || [], fairway: layout.fairway || null });
  // The one thing a plan may never do is be applied to ground the layout was not planned
  // on: `placeAll` would treat that as a reseeding and start the island again from nothing,
  // and the diff would read "everything moved". A layout with no town has not had its
  // first scan yet, and the lattice hangs off the town.
  if (layout.terrainHash !== terrain.hash) throw new Error('the ground is not what this layout was planned on; scan first');
  if (!layout.town) throw new Error('this island has no town yet; scan first');
  const lat = latticeOf(layout);
  const { districts, ordOf } = districtOrder(model);
  const nameOf = new Map(districts.map((d) => [d.id, d.name || d.id]));
  const kindOf = new Map(districts.map((d) => [d.id, d.kind]));
  const ctx = { terrain, lat, size, districts, ordOf, nameOf, kindOf, sup: null, dirty: true };
  ctx.register = () => {
    if (!ctx.dirty) return ctx.sup;
    ctx.sup = new Super(terrain, lat, heldOf(layout));
    registerLand(ctx.sup, layout, ordOf, null);
    ctx.dirty = false;
    return ctx.sup;
  };
  // Who owns super-cell (i, j), as a name for a sentence.
  ctx.owner = (i, j) => {
    const w = ctx.register().at(i, j);
    if (w === NONE) return null;
    if (w === TOWN) return 'the town';
    const d = districts[w];
    return d ? (d.name || d.id) : 'somebody';
  };
  return ctx;
}

// Apply every op of a parsed plan to `layout`, in order, each one validating in full
// before it changes anything. Returns the verdicts and the ids the plan touched; the
// caller decides whether anything is written. `layout` is mutated in place - hand it a
// copy for a dry run.
export function applyPlan(layout, model, plan, { seed, size, now = Date.now() }) {
  const ctx = context(layout, model, { seed, size });
  ctx.seed = seed; ctx.now = now; ctx.model = model;
  const verdicts = [];
  const touched = new Set();
  let reroute = false;
  const pavedBefore = new Set((layout.paths || []).map((p) => p.id));
  for (const [i, op] of plan.ops.entries()) {
    const v = { i, op: op.op, ok: true, notes: [] };
    try {
      const r = op.op === 'move' ? opMove(layout, op, ctx, v)
        : op.op === 'polder' ? opPolder(layout, op, ctx, v)
          : op.op === 'unpolder' ? opUnpolder(layout, op, ctx, v)
            : op.op === 'parcel' ? opParcel(layout, op, ctx, v)
            : op.op === 'road' ? opRoad(layout, op, ctx, v)
            : opZone(layout, op, ctx, v);
      for (const id of r.touched || []) touched.add(id);
      if (r.reroute) reroute = true;
    } catch (e) {
      v.ok = false;
      v.reason = String(e && e.message || e);
    }
    verdicts.push(v);
  }
  let pruned = [];
  if (reroute) {
    // The roads a move or a zone cut through are gone; now every stretch that only led to
    // them goes too, or it stays on record ending in the grass and passes every check that
    // asks whether a house has a path. Measured before this existed: moving one hamlet and
    // deleting only its own paths left a neighbour's road orphaned in two of four tries.
    // `placeAll` relays whatever is missing, from the doors that need it.
    pruned = pruneUnreachable(layout, size);
    // And the forest takes the ground back. `cleared` is a union that only ever grows, so
    // the old plots and the old roads would stay bald for good; emptied here it is rebuilt
    // by `placeAll` as exactly what stands - the same one-time exception `clearRoads` makes.
    layout.cleared = [];
  }
  // A road the keeper drew is kept whole in `layout.roads` so a re-route can pave it again
  // (`replayKeeperRoads`). One whose pavement this plan took away - a hamlet set down
  // across it, a zone painted over it, cut off from the square - goes from that list too,
  // or the next scan would lay it back through the new houses as a road with holes in it.
  const pavedAfter = new Set((layout.paths || []).map((p) => p.id));
  const lost = (layout.roads || []).filter((r) => pavedBefore.has(r.id) && !pavedAfter.has(r.id));
  if (lost.length) {
    layout.roads = layout.roads.filter((r) => !lost.includes(r));
    const gone = new Set(lost.map((r) => r.id));
    layout.bridges = (layout.bridges || []).filter((b) => !gone.has(b.id));
  }
  return { ok: verdicts.every((v) => v.ok), verdicts, touched, reroute, pruned };
}

// Every path with a cell that cannot be walked to from the town square is dropped, and a
// hamlet road that goes this way hands its lobe back to `placeAll` to road again. The
// flood is `reachableFromSquare` out of shared/roads.mjs - the same one the debug overlay
// and the tests use - over paths and bridges, from the town's paving, four-connected.
export function pruneUnreachable(layout, size) {
  const village = { paths: layout.paths || [], bridges: layout.bridges || [], island: { town: layout.town }, districts: [] };
  const open = reachableFromSquare(village, size);
  const keep = [], dropped = [];
  for (const p of layout.paths || []) {
    const joined = (p.cells || []).every(([gx, gz]) => open.has(gx + gz * size));
    if (joined) keep.push(p); else dropped.push(p.id);
  }
  layout.paths = keep;
  for (const id of dropped) {
    const m = /^road:(.+):(\d+)$/.exec(String(id));
    if (!m) continue;
    const rec = hasOwn(layout.districts, m[1]) ? layout.districts[m[1]] : null;
    const lobe = rec && rec.lobes && rec.lobes[Number(m[2])];
    if (lobe && lobe.road === id) lobe.road = null;
  }
  return dropped;
}

// ---- road -----------------------------------------------------------------------------
// A road the keeper draws, cell by cell, and the crossings it needs built to measure.
//
// The road is cut into ground and deck. Ground is a cell a road may lie on: land, and on
// the grid free, road already, or the square. Everything between two stretches of ground
// is deck, and a run of deck is one bridge exactly as long as the gap - which is what
// "a bridge to size" means here. Deck is not only the water: the lip of a river valley is
// never land (a cell four-adjacent to a flooded one shares two of its corners, see
// `crossingSpan` in lib/layout.mjs), and the bank above that is often too steep to build
// on, so a deck that stopped at the water's edge would end in mid-air or against a cliff.
// A run is only a bridge if it has a river in it; one with none is a road through ground
// that cannot take one, and is refused in those words.
//
// What the router enforces for its own crossings, this enforces for a hand's: straight and
// at right angles to nothing in particular (on a deck there is nowhere to turn), both
// banks on the road, the fairway left open for the boats, nothing built in the way, and at
// most PLAN_CAPS.span cells of deck. And the road has to join the network, or it is paving
// that leads nowhere and `pruneUnreachable` throws it away on the next plan.
//
// Recorded the way `markRoad` records a road - the decks in `layout.bridges`, the fresh
// ground in `layout.paths`, both under one id - plus whole in `layout.roads`, so that a
// re-route (`clearRoads`, a ROAD_VERSION bump) can pave it again; see `replayKeeperRoads`.
function opRoad(layout, op, ctx, v) {
  const { terrain, size } = ctx;
  const grid = replayGrid(terrain, layout);
  const fairway = new Set((((layout.fairway || {}).cells) || []).map(ckey));
  const at = (c) => `${c[0]},${c[1]}`;
  const ground = (c) => {
    const g = grid.get(c[0], c[1]);
    return g === BRIDGE || (terrain.isLand(c[0], c[1]) && (g === FREE || g === PATH || g === SQUARE));
  };
  for (const c of op.cells) {
    if (!terrain.inGrid(c[0], c[1])) throw new Error(`${at(c)} is off the island`);
    const g = grid.get(c[0], c[1]);
    if (g === PLOT) throw new Error(`something stands at ${at(c)}`);
    if (g === RESERVED) throw new Error(`${at(c)} is a dike or a zone; nothing crosses it`);
    if (g === PIER) throw new Error(`${at(c)} is a pier`);
    if (fairway.has(ckey(c))) throw new Error(`${at(c)} is the fairway; a bridge there would shut the harbour`);
  }
  if (!ground(op.cells[0]) || !ground(op.cells[op.cells.length - 1])) throw new Error('a road starts and ends on dry ground');

  // The runs of deck, each with the ground cell on either side of it.
  const decks = [];
  let run = null;
  for (let n = 0; n < op.cells.length; n++) {
    const c = op.cells[n];
    if (ground(c)) { if (run) { run.after = c; decks.push(run); run = null; } continue; }
    if (!run) run = { before: op.cells[n - 1], cells: [] };
    run.cells.push(c);
  }
  const bridges = [];
  for (const d of decks) {
    const line = [d.before, ...d.cells, d.after];
    const alongX = line.every((c) => c[1] === line[0][1]);
    const alongZ = line.every((c) => c[0] === line[0][0]);
    const where = `${at(d.cells[0])}${d.cells.length > 1 ? `-${at(d.cells[d.cells.length - 1])}` : ''}`;
    if (!d.cells.some((c) => terrain.isRiver(c[0], c[1]))) {
      const wet = d.cells.some((c) => !terrain.isLand(c[0], c[1]));
      throw new Error(wet ? `${where} is not a river; a bridge crosses a river, not the sea` : `${where} is too steep or too sandy for a road`);
    }
    if (!alongX && !alongZ) throw new Error(`the crossing at ${where} bends; a bridge runs straight from bank to bank`);
    if (d.cells.length > PLAN_CAPS.span) throw new Error(`the crossing at ${where} is ${d.cells.length} cells; a bridge spans at most ${PLAN_CAPS.span}`);
    for (const c of d.cells) if (grid.get(c[0], c[1]) !== BLOCKED) throw new Error(`something is in the way at ${at(c)}`);
    bridges.push({ axis: alongX ? 'x' : 'z', cells: d.cells });
  }

  // It has to reach the square, over the roads there are and the bridges it brings.
  const land = op.cells.filter((c) => !bridges.some((b) => b.cells.includes(c)));
  const trial = {
    paths: [...(layout.paths || []), { id: 'trial', cells: land }],
    bridges: [...(layout.bridges || []), ...bridges.map((b) => ({ id: 'trial', ...b }))],
    island: { town: layout.town }, districts: [],
  };
  const open = reachableFromSquare(trial, size);
  if (!op.cells.every(([gx, gz]) => open.has(gx + gz * size))) throw new Error('the road does not join the roads to the square; draw it from a road that does');

  // Mutate.
  layout.roadSeq = (layout.roadSeq || 0) + 1;
  const id = `road:keeper:${layout.roadSeq}`;
  for (const b of bridges) {
    layout.bridges.push({ id, axis: b.axis, cells: b.cells });
    for (const [gx, gz] of b.cells) grid.set(gx, gz, BRIDGE);
  }
  const had = (layout.paths || []).length;
  markPath(grid, layout, id, op.cells);
  const fresh = layout.paths.length > had ? layout.paths[layout.paths.length - 1].cells.length : 0;
  if (!layout.roads) layout.roads = [];
  layout.roads.push({ id, cells: op.cells, at: new Date(ctx.now).toISOString() });
  v.notes.push(`${op.cells.length} cells of road, ${fresh} of them new`
    + (bridges.length ? `; ${bridges.map((b) => `a bridge of ${b.cells.length}`).join(', ')}` : ''));
  return { touched: [], reroute: false };
}

// ---- zone ----------------------------------------------------------------------------
function opZone(layout, op, ctx, v) {
  const { lat, size } = ctx;
  const core = (i, j) => Math.max(Math.abs(i), Math.abs(j)) <= TOWN_CORE_R;
  for (const [i, j] of op.add) {
    if (!superComplete(lat, size, i, j)) throw new Error(`super-cell [${i}, ${j}] is not wholly on the island`);
    // The centre is where the civic lots are held back; zoning it would leave the next
    // milestone with nowhere to stand, and the keeper who wants that has the wrong tool.
    if (core(i, j)) throw new Error(`super-cell [${i}, ${j}] is the town's own ground`);
  }
  // The countryside only. A zone is RESERVED ground the router may not cross, so one drawn
  // over a hamlet's land cuts its lanes and its front paths - measured: three houses left
  // with no way to town, which the stranding guard in `runPlan` would refuse anyway, but in
  // words about roads rather than about the zone that caused it. "Do not build here" over
  // land somebody already owns is a parcel question, not a zone.
  const ownedBy = new Map();
  for (const [id, rec] of Object.entries(layout.districts || {})) for (const lobe of rec.lobes || []) for (const c of lobe.cells) ownedBy.set(ckey(c), ctx.nameOf.get(id) || id);
  for (const c of layout.town.commons || []) ownedBy.set(ckey(c), 'the town');
  for (const [i, j] of op.add) {
    if (ownedBy.has(ckey([i, j]))) throw new Error(`super-cell [${i}, ${j}] is ${ownedBy.get(ckey([i, j]))}'s land; a zone is for the countryside`);
    const [gx, gz] = blockOf(lat, i, j);
    for (const [id, p] of Object.entries(layout.plots || {})) {
      if (p.gx < gx + lat.pitch && p.gx + p.w > gx && p.gz < gz + lat.pitch && p.gz + p.d > gz) throw new Error(`${id} stands on super-cell [${i}, ${j}]`);
    }
  }
  let entry = (layout.zones || []).find((z) => z.kind === op.kind);
  const have = new Set((entry ? entry.supers : []).map(ckey));
  const added = [];
  for (const c of op.add) if (!have.has(ckey(c))) { have.add(ckey(c)); added.push(c); }
  for (const c of op.remove) have.delete(ckey(c));
  const supers = [...have].map((k) => k.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0]);

  // What the new ground covers. Nothing standing is touched - a zone freezes, it does not
  // evict - but it is said, because a keeper drawing over a hamlet by accident wants to
  // know before pressing Apply. A path through it goes, and is laid again around it.
  const cells = new Set();
  for (const [i, j] of added) {
    const [gx, gz] = blockOf(lat, i, j);
    for (let z = 0; z < lat.pitch; z++) for (let x = 0; x < lat.pitch; x++) cells.add(ckey([gx + x, gz + z]));
  }
  const covered = [];
  for (const [id, p] of Object.entries(layout.plots || {})) {
    let hit = false;
    for (let z = 0; z < p.d && !hit; z++) for (let x = 0; x < p.w && !hit; x++) if (cells.has(ckey([p.gx + x, p.gz + z]))) hit = true;
    if (hit) covered.push(id);
  }
  for (const [id, rec] of Object.entries(layout.districts || {})) {
    for (const lobe of rec.lobes || []) {
      const n = lobe.cells.filter((c) => added.some((a) => a[0] === c[0] && a[1] === c[1])).length;
      if (n) v.notes.push(`covers ${n} super-cell(s) of ${ctx.nameOf.get(id) || id}'s land; nothing new is built there`);
    }
  }
  if (covered.length) v.notes.push(`covers ${covered.length} building(s), which stay: ${covered.slice(0, 4).join(', ')}${covered.length > 4 ? ', …' : ''}`);

  // Mutate.
  if (!layout.zones) layout.zones = [];
  if (supers.length) {
    if (entry) entry.supers = supers;
    else layout.zones.push({ kind: op.kind, supers });
  } else if (entry) {
    layout.zones = layout.zones.filter((z) => z !== entry);
  }
  let reroute = false;
  const crossing = (layout.paths || []).filter((p) => (p.cells || []).some((c) => cells.has(ckey(c))));
  if (crossing.length) {
    layout.paths = layout.paths.filter((p) => !crossing.includes(p));
    for (const p of crossing) {
      const m = /^road:(.+):(\d+)$/.exec(String(p.id));
      const rec = m && hasOwn(layout.districts, m[1]) ? layout.districts[m[1]] : null;
      const lobe = rec && rec.lobes && rec.lobes[Number(m[2])];
      if (lobe && lobe.road === p.id) lobe.road = null;
    }
    v.notes.push(`${crossing.length} road(s) ran through it and will be laid again around it`);
    reroute = true;
  }
  ctx.dirty = true;
  v.notes.push(`${added.length} super-cell(s) zoned, ${op.remove.length} released`);
  return { touched: [], reroute };
}

// ---- polder --------------------------------------------------------------------------
// Land off the water, where the keeper points. The same polder `planPolder` would have
// made of these super-cells - `polderFromSupers` walls it, `digPolder` drains it and lays
// the causeway - with the ladder's own refusals asked here by hand: whole super-cells of
// shallow water, none of it the fairway or a zone, at least one touching the shore, and
// nothing built under the wall. The hash goes on record *here*, straight after the
// digging: `placeAll` will build the terrain with this polder in it and compare, and a
// layout carrying the coast without it would be read as a reseeding and start the island
// again from nothing (see resetForNewTerrain, and tests/polder-hash.test.mjs).
//
// The terrain in `ctx` is the new coast from here on, so a move later in the same plan may
// set a hamlet down on the land this op made.
function opPolder(layout, op, ctx, v) {
  const { lat, size, terrain } = ctx;
  if ((layout.polders || []).length >= PLAN_CAPS.polders) throw new Error(`the island holds at most ${PLAN_CAPS.polders} polders`);
  const keep = new Set([...(((layout.fairway || {}).cells) || []), ...zoneCells(layout)].map(ckey));
  let shore = false;
  for (const [i, j] of op.supers) {
    if (!superComplete(lat, size, i, j)) throw new Error(`super-cell [${i}, ${j}] is not wholly on the island`);
    if (!polderCandidate(terrain, lat, i, j, keep, { shore: true })) {
      const [gx, gz] = blockOf(lat, i, j);
      let land = 0, deep = 0, kept = 0;
      for (let z = 0; z < lat.pitch; z++) {
        for (let x = 0; x < lat.pitch; x++) {
          if (terrain.isLand(gx + x, gz + z)) land++;
          else if (keep.has(ckey([gx + x, gz + z]))) kept++;
          else if (terrain.heightAt(gx + x, gz + z) < -1.2) deep++;
        }
      }
      throw new Error(land === lat.pitch * lat.pitch ? `[${i}, ${j}] is already land` : kept ? `[${i}, ${j}] is the fairway, or zoned to stay water` : deep ? `[${i}, ${j}] is too deep for a dike` : `[${i}, ${j}] cannot be reclaimed`);
    }
    if (holdsLand(terrain, lat, i, j) || touchesShore(terrain, lat, i, j)) shore = true;
  }
  if (!shore) throw new Error('a polder has to touch the shore, or its houses get no road');
  const p = polderFromSupers(terrain, lat, op.supers, op.supers[0]);
  // Nothing built under the wall: the pier, the landing, a road along the coast. The
  // ladder misses these only by the luck of its bearing; a hand does not get to be lucky.
  const held = fairwayHeld(layout);
  for (const c of [...p.cells, ...p.dike]) {
    if (held.has(ckey(c))) throw new Error(`the dike would run over something built at ${ckey(c)}`);
  }
  p.manual = true;
  p.at = (ctx.model && ctx.model.stats && ctx.model.stats.settlers) || 0;
  p.dugAt = new Date(ctx.now).toISOString();
  const ground = digPolder(ctx.seed, size, layout, p);
  layout.terrainHash = ground.hash;
  ctx.terrain = ground;
  ctx.dirty = true;
  const works = new Set([...p.cells, ...p.pools, ...p.dike].map(ckey));
  if (layout.landing && works.has(ckey(layout.landing))) layout.landing = null;   // re-picked by placeAll
  v.notes.push(`${op.supers.length} super-cell(s) reclaimed, ${p.dike.length} cells of dike, ${p.pools.length} pooled, causeway of ${p.road.length}`);
  // `causeway` hands back one cell when no walk over land reaches ground a road can use.
  // That is common on a beach coast and not fatal by itself - `placeAll` lays the approach
  // road from that cell - but the dike on the water sides and the beach on the land side
  // can still seal the new land off from the inside, and that is what the stranding guard
  // in `runPlan` refuses when a hamlet is set down there. Measured on the live island:
  // three houses moved onto such a polder, no road to any of them.
  if ((p.road || []).length <= 1) v.notes.push('the causeway is a stub: no dry road reaches buildable ground from here, so a hamlet may not be roadable on it');
  // `causeway` hands back one cell when no walk over land reaches ground a road can use -
  // a polder against a beach with nothing buildable behind it. The ladder never digs one
  // there because its seed prefers the town's side; a hand can, and what it gets is land
  // with no way onto it, which is the stranding the guard in `runPlan` refuses a house
  // for. Said here, in the polder's own words, before anybody builds on it.
  return { touched: [], reroute: false };
}

// ---- unpolder ------------------------------------------------------------------------
// The sea takes a polder back: the mirror of `opPolder`, and the one thing on the island
// that ever un-makes ground. Its cells, pools and dike leave `layout.polders`, the coast is
// rebuilt, and the hash is recorded again on the spot for the same reason the digging
// records it. Refused while anything stands on it or owns it - a house, a shed, a
// hamlet's parcel - because those would be standing in the water afterwards; the keeper
// moves the hamlet off first, in the same plan if they like, since ops apply in order.
// Refused too when another polder leans on this one: a later polder walls only the sides
// that were water when it was dug, so taking its neighbour away leaves it with a side the
// dike never closed.
//
// `poldersReturned` is the ladder's memory of it (see `reclaim`), kept off the bundle: a
// count, not ground, so it has no hash. Every `road:polder:*` path goes with it, because
// they are named by index and the indices have just shifted; `placeAll` lays the
// causeways and approaches of the polders that remain again under their new numbers.
function opUnpolder(layout, op, ctx, v) {
  const { lat, size } = ctx;
  const polders = layout.polders || [];
  const p = polders[op.index];
  if (!p) throw new Error(`there is no polder ${op.index}`);
  const works = new Set([...(p.cells || []), ...(p.pools || []), ...(p.dike || [])].map(ckey));
  const near = (c) => {
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) if (works.has(ckey([c[0] + a, c[1] + b]))) return true;
    return false;
  };
  for (const [m, q] of polders.entries()) {
    if (m === op.index) continue;
    if ([...(q.cells || []), ...(q.dike || [])].some(near)) throw new Error(`polder ${m} leans on it as its shore`);
  }
  for (const [id, plot] of Object.entries(layout.plots || {})) {
    for (let z = 0; z < plot.d; z++) for (let x = 0; x < plot.w; x++) {
      if (works.has(ckey([plot.gx + x, plot.gz + z]))) throw new Error(`${whose(layout, id)} stands on it${plot.district ? '; move the hamlet off first' : ''}`);
    }
  }
  for (const [id, rec] of Object.entries(layout.districts || {})) {
    for (const lobe of rec.lobes || []) {
      for (const [i, j] of lobe.cells) {
        const [gx, gz] = blockOf(lat, i, j);
        for (let z = 0; z < lat.pitch; z++) for (let x = 0; x < lat.pitch; x++) {
          if (works.has(ckey([gx + x, gz + z]))) throw new Error(`${ctx.nameOf.get(id) || id}'s land is on it; move the hamlet first`);
        }
      }
    }
  }
  for (const [i, j] of layout.town.commons || []) {
    const [gx, gz] = blockOf(lat, i, j);
    for (let z = 0; z < lat.pitch; z++) for (let x = 0; x < lat.pitch; x++) {
      if (works.has(ckey([gx + x, gz + z]))) throw new Error("the town's commons is on it");
    }
  }
  // Mutate.
  polders.splice(op.index, 1);
  layout.poldersReturned = (layout.poldersReturned || 0) + 1;
  const crossing = (q) => (q.cells || []).some((c) => works.has(ckey(c)));
  layout.paths = (layout.paths || []).filter((q) => !String(q.id).startsWith('road:polder:') && !crossing(q));
  layout.bridges = (layout.bridges || []).filter((b) => !crossing(b));
  for (const rec of Object.values(layout.districts || {})) {
    for (const lobe of rec.lobes || []) if (lobe.road && !layout.paths.some((q) => q.id === lobe.road)) lobe.road = null;
  }
  const ground = makeTerrain(ctx.seed, { size, polders, fairway: layout.fairway || null });
  layout.terrainHash = ground.hash;
  ctx.terrain = ground;
  ctx.dirty = true;
  if (layout.landing && works.has(ckey(layout.landing))) layout.landing = null;
  v.notes.push(`polder ${op.index} given back: ${(p.cells || []).length} cells of land, ${(p.dike || []).length} of dike${p.manual ? '' : ' (a planned one; the ladder remembers)'}`);
  return { touched: [], reroute: true };
}

// Why super-cell t may not become district k's, in the island's own words - or null when
// it may. `Super.eligible` answers yes or no; this is the same four questions asked one at
// a time, so the ledger can say which one it was.
function whyNotEligible(ctx, sup, t, k, allowBeach) {
  const { lat, size } = ctx;
  const terrain = ctx.terrain;
  if (!superComplete(lat, size, t[0], t[1])) return `[${t[0]}, ${t[1]}] is not wholly on the island`;
  if (sup.eligible(t[0], t[1], k, allowBeach)) return null;
  if (!sup.usable(t[0], t[1], allowBeach)) {
    const [gx, gz] = blockOf(lat, t[0], t[1]);
    let water = 0, held = 0;
    for (let z = 0; z < lat.pitch; z++) {
      for (let x = 0; x < lat.pitch; x++) {
        if (!terrain.isLand(gx + x, gz + z)) water++;
        if (sup.held && sup.held.has(ckey([gx + x, gz + z]))) held++;
      }
    }
    return held ? `[${t[0]}, ${t[1]}] is held ground (a dike, a causeway or a zone)`
      : water ? `[${t[0]}, ${t[1]}] is water` : `[${t[0]}, ${t[1]}] is too steep to build on`;
  }
  const who = ctx.owner(t[0], t[1]);
  if (who) return `[${t[0]}, ${t[1]}] is ${who}'s land`;
  // Not ours, not anybody's, usable - so it is the belt: somebody's land within one.
  let near = null;
  for (let b = -BELT; b <= BELT && !near; b++) for (let a = -BELT; a <= BELT && !near; a++) near = ctx.owner(t[0] + a, t[1] + b);
  return `[${t[0]}, ${t[1]}] is within the belt of ${near || 'a neighbour'}'s land`;
}

// ---- parcel --------------------------------------------------------------------------
// More land for a hamlet, or less, without moving it. Added super-cells have to pass the
// same `Super.eligible` a scan asks when it grows a parcel; removed ones must have nothing
// standing on them and may not be the lobe's seed, which is where it was founded and what
// its growth and its door facing are measured from. The land stays one piece.
//
// And it may not shrink below the hamlet's own population: `ensureParcel` grows a lobe
// whose plots are fewer than its people on every scan, so land taken away below that
// would be taken straight back by the `placeAll` that runs after this op - somewhere the
// keeper did not choose.
function opParcel(layout, op, ctx, v) {
  const { lat, ordOf, kindOf, nameOf } = ctx;
  if (!hasOwn(layout.districts, op.district)) throw new Error(`no hamlet called ${op.district}`);
  const rec = layout.districts[op.district];
  const name = nameOf.get(op.district) || op.district;
  const lobe = rec.lobes && rec.lobes[op.lobe];
  if (!lobe) throw new Error(`${name} has no lobe ${op.lobe}`);
  if (!ordOf.has(op.district)) throw new Error(`${op.district} is not in the village any more`);
  const k = ordOf.get(op.district);
  const allowBeach = kindOf.get(op.district) === 'quay';
  const sup = ctx.register();
  const have = new Set(lobe.cells.map(ckey));
  const removed = [];
  for (const c of op.remove) {
    if (!have.has(ckey(c))) throw new Error(`[${c[0]}, ${c[1]}] is not ${name}'s land`);
    if (c[0] === lobe.seed[0] && c[1] === lobe.seed[1]) throw new Error(`[${c[0]}, ${c[1]}] is where ${name} was founded; move the hamlet instead`);
    const [gx, gz] = blockOf(lat, c[0], c[1]);
    for (const [id, p] of Object.entries(layout.plots || {})) {
      if (p.gx < gx + lat.pitch && p.gx + p.w > gx && p.gz < gz + lat.pitch && p.gz + p.d > gz) throw new Error(`${whose(layout, id)} stands on [${c[0]}, ${c[1]}]`);
    }
    have.delete(ckey(c));
    removed.push(c);
  }
  for (const [i, j] of removed) sup.release(i, j);
  const added = [];
  for (const c of op.add) {
    if (have.has(ckey(c))) continue;
    const why = whyNotEligible(ctx, sup, c, k, allowBeach);
    if (why) { for (const a of added) sup.release(a[0], a[1]); for (const [i, j] of removed) sup.claim(i, j, k, null); throw new Error(why); }
    sup.claim(c[0], c[1], k, null);
    have.add(ckey(c));
    added.push(c);
  }
  const restore = () => { for (const a of added) sup.release(a[0], a[1]); for (const [i, j] of removed) sup.claim(i, j, k, null); };
  const cells = [...have].map((s) => s.split(',').map(Number));
  if (!cells.length) { restore(); throw new Error(`${name} cannot give away all its land`); }
  if (!connected(cells)) { restore(); throw new Error(`${name}'s land would come apart in two pieces`); }
  const d = (ctx.model.districts || []).find((x) => x.id === op.district);
  const pop = (d && d.population) || 0;
  const room = rec.lobes.reduce((a, l, li) => a + (li === op.lobe ? cells.length : l.cells.length), 0);
  if (room < pop) { restore(); throw new Error(`${name} has ${pop} settlers and would have room for ${room}; the next scan would take land straight back`); }
  // Mutate: the lobe's own order kept for what stays, the new cells after it, so a second
  // scan replays the land in the same order and writes the same file.
  const gone = new Set(removed.map(ckey));
  lobe.cells = [...lobe.cells.filter((c) => !gone.has(ckey(c))), ...added];
  v.notes.push(`${name}: ${added.length} super-cell(s) more, ${removed.length} fewer`);
  return { touched: [], reroute: false };
}

// ---- move ----------------------------------------------------------------------------
// A rigid translation of whole lobes by (di, dj) super-cells. Rigid is what makes it safe:
// every relation inside the hamlet - which shed stands in whose yard, which way a door
// faces its lane, where the lane is - is preserved by construction, so the only questions
// are about the destination, and those are `Super.eligible` (buildable, nobody's, not
// within the belt of anybody's, not held) for the land and `freeBlock` on a replayed grid
// for every plot, plus one that neither asks: that each door still opens onto land.
function opMove(layout, op, ctx, v) {
  const { lat, size, ordOf, kindOf, nameOf } = ctx;
  const terrain = ctx.terrain;
  const { di, dj } = op;
  const sup = ctx.register();

  // Who is moving.
  const lobes = [];
  for (const { district, lobe } of op.lobes) {
    if (!hasOwn(layout.districts, district)) throw new Error(`no hamlet called ${district}`);
    const rec = layout.districts[district];
    const l = rec.lobes && rec.lobes[lobe];
    if (!l) throw new Error(`${nameOf.get(district) || district} has no lobe ${lobe}`);
    if (!ordOf.has(district)) throw new Error(`${district} is not in the village any more`);
    lobes.push({ district, li: lobe, rec, lobe: l, k: ordOf.get(district), allowBeach: kindOf.get(district) === 'quay' });
  }

  const houses = [], sheds = [], offices = [];
  const houseIds = new Set();
  for (const m of lobes) {
    for (const [id, p] of Object.entries(layout.plots)) {
      if (!id.startsWith('house:') || p.commons || p.district !== m.district || p.lobe !== m.li) continue;
      houses.push({ id, p, m }); houseIds.add(id);
    }
    if (m.li === 0 && layout.plots[`civic:office:${m.district}`]) offices.push(`civic:office:${m.district}`);
  }
  const inHouse = (gx, gz) => houses.some(({ p }) => gx >= p.gx && gx < p.gx + p.w && gz >= p.gz && gz < p.gz + p.d);
  for (const [id, p] of Object.entries(layout.plots)) {
    if (!id.startsWith('shed:')) continue;
    const master = (layout.shedOf || {})[id];
    if (houseIds.has(master) || (!master && inHouse(p.gx, p.gz))) {
      const m = houses.find((h) => h.id === master) || houses.find((h) => inHouse(p.gx, p.gz));
      sheds.push({ id, p, m: m ? m.m : lobes[0] });
    }
  }
  const moving = new Set([...houses.map((h) => h.id), ...sheds.map((s) => s.id), ...offices]);

  // The land: out of our own way first, then every destination has to be somebody's for
  // the taking. Restored before a refusal is thrown, so a failed op leaves the register as
  // it found it and the next op is judged against the island as it stands.
  const released = [];
  for (const m of lobes) for (const [i, j] of m.lobe.cells) { sup.release(i, j); released.push([i, j, m.k]); }
  const restore = () => { for (const [i, j, k] of released) sup.claim(i, j, k, null); };
  const refuse = (msg) => { restore(); throw new Error(msg); };
  for (const m of lobes) {
    for (const [i, j] of m.lobe.cells) {
      const t = [i + di, j + dj];
      if (!superComplete(lat, size, t[0], t[1])) refuse(`${nameOf.get(m.district)} would go off the island at [${t[0]}, ${t[1]}]`);
      const why = whyNotEligible(ctx, sup, t, m.k, m.allowBeach);
      if (why) refuse(why);
    }
  }

  // The cells: every plot on a grid that has the movers lifted off it, and any road that
  // runs through where they are going lifted too - it will be laid again round them.
  const dest = new Set();
  for (const { p } of [...houses, ...sheds]) {
    for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) dest.add(ckey([p.gx + x + di * lat.pitch, p.gz + z + dj * lat.pitch]));
  }
  const crossing = (layout.paths || []).filter((p) => (p.cells || []).some((c) => dest.has(ckey(c))));
  const view = { ...layout, paths: (layout.paths || []).filter((p) => !crossing.includes(p)) };
  const grid = replayGrid(terrain, view, { skip: moving });
  for (const { id, p, m } of houses) {
    const gx = p.gx + di * lat.pitch, gz = p.gz + dj * lat.pitch;
    if (!grid.freeBlock(gx, gz, p.w, p.d, m.allowBeach)) refuse(`something already stands where ${id} would go`);
    const door = outsideDoor(gx, gz, p.rot);
    if (!terrain.inGrid(door[0], door[1]) || !terrain.isLand(door[0], door[1])) refuse(`the door of ${id} would open onto the water`);
  }
  for (const { id, p, m } of sheds) {
    const gx = p.gx + di * lat.pitch, gz = p.gz + dj * lat.pitch;
    if (!grid.freeCell(gx, gz, m.allowBeach)) refuse(`something already stands where ${id} would go`);
  }

  // Mutate. `rot` stays - a translation turns nothing - and so does `shedOf`.
  for (const { p } of [...houses, ...sheds]) { p.gx += di * lat.pitch; p.gz += dj * lat.pitch; }
  for (const { p } of houses) if (p.cell) p.cell = [p.cell[0] + di, p.cell[1] + dj];
  const roadIds = new Set();
  for (const m of lobes) {
    m.lobe.cells = m.lobe.cells.map(([i, j]) => [i + di, j + dj]);
    m.lobe.seed = [m.lobe.seed[0] + di, m.lobe.seed[1] + dj];
    // `placeAll` recomputes this for a hamlet on every scan and for a farmstead never, so it
    // is set here for both rather than left to whichever the district happens to be.
    m.lobe.centre = centreOfCell(lat, m.lobe.seed);
    if (m.lobe.road) roadIds.add(m.lobe.road);
    m.lobe.road = null;
    if (m.rec.lobes[0]) m.rec.centre = m.rec.lobes[0].centre;
    for (const [i, j] of m.lobe.cells) sup.claim(i, j, m.k, null);
  }
  for (const id of offices) delete layout.plots[id];
  const gone = new Set([...roadIds, ...houses.map((h) => `path:${h.id}`), ...crossing.map((p) => p.id)]);
  layout.paths = (layout.paths || []).filter((p) => !gone.has(p.id));
  for (const p of crossing) {
    const m = /^road:(.+):(\d+)$/.exec(String(p.id));
    const rec = m && hasOwn(layout.districts, m[1]) ? layout.districts[m[1]] : null;
    const lobe = rec && rec.lobes && rec.lobes[Number(m[2])];
    if (lobe && lobe.road === p.id) lobe.road = null;
  }

  v.notes.push(`${lobes.map((m) => nameOf.get(m.district)).join(', ')} moved by [${di}, ${dj}]: ${houses.length} house(s), ${sheds.length} shed(s)`);
  if (offices.length) v.notes.push(`${offices.length} office(s) will stand again at the new gate`);
  if (crossing.length) v.notes.push(`${crossing.length} road(s) ran through the new ground and will be laid again`);
  return { touched: [...moving], reroute: true };
}

// ---- who is left without a road ---------------------------------------------------
// The houses that cannot walk from their own door to the town square: the flood
// tests/layout-measure.test.mjs does, over the graph the settlers walk (shared/roads.mjs).
// A door counts as joined if the cell it opens onto is on the network, or any cell of the
// house's own front path is. Asked of the trial after `placeAll` has had its say, because
// `placeAll` refuses nothing: a hamlet set down where no road can reach it - behind a
// beach the router may not cross, on a polder whose causeway is a stub - is placed,
// roaded as far as the router gets, and left. Measured on the live island: three houses
// moved onto a hand-drawn polder against the beach, no road to any of them.
export function stranded(layout, size) {
  const v = { paths: layout.paths || [], bridges: layout.bridges || [], island: { town: layout.town }, districts: [] };
  const open = reachableFromSquare(v, size);
  const at = ([gx, gz]) => open.has(gx + gz * size);
  const out = [];
  for (const [id, p] of Object.entries(layout.plots || {})) {
    if (!id.startsWith('house:')) continue;
    if (at(outsideDoor(p.gx, p.gz, p.rot))) continue;
    const own = (layout.paths || []).find((q) => q.id === `path:${id}`);
    if (own && own.cells.some(at)) continue;
    out.push(id);
  }
  return out;
}

// ---- the difference a plan made ----------------------------------------------------
// Read off two layouts rather than off the ops, so it reports what actually happened - and
// `otherMoved` is the invariant as a runtime guard: a plot that changed which the plan did
// not name means the plan did something it did not say, and scan.mjs refuses to write.
export function diffLayouts(before, after, touched = new Set()) {
  const stand = (p) => [p.gx, p.gz, p.rot];
  const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  const moved = [], removed = [], added = [], otherMoved = [];
  for (const [id, p] of Object.entries(before.plots || {})) {
    const q = (after.plots || {})[id];
    if (!q) { removed.push(id); continue; }
    if (!same(stand(p), stand(q))) {
      moved.push({ id, from: stand(p), to: stand(q) });
      if (!touched.has(id)) otherMoved.push(id);
    }
  }
  for (const id of Object.keys(after.plots || {})) if (!(before.plots || {})[id]) added.push(id);
  for (const id of removed) if (!touched.has(id)) otherMoved.push(id);
  const lobesOf = (l) => Object.fromEntries(Object.entries(l.districts || {}).map(([id, d]) => [id, (d.lobes || []).map((x) => x.cells.length)]));
  return {
    plots: { moved, removed, added, otherMoved },
    paths: { before: (before.paths || []).length, after: (after.paths || []).length },
    cleared: { before: (before.cleared || []).length, after: (after.cleared || []).length },
    polders: { before: (before.polders || []).length, after: (after.polders || []).length },
    terrainHash: { before: before.terrainHash, after: after.terrainHash },
    zones: after.zones || [],
    lobes: { before: lobesOf(before), after: lobesOf(after) },
  };
}

function whose(layout, id) {
  const p = (layout.plots || {})[id];
  const d = p && p.district ? String(p.district).split(/[\\/]/).pop() : null;
  return d ? `${id.slice(0, 14)}… (${d})` : id;
}

// `placeAll` until the layout stops changing, or give up after `max` passes. One pass is
// nearly always enough on a settled island (measured: 5 of 6 moves settled in one), but the
// path replay runs before a claimed super hands its blocked lane cells back as free, so a
// plot set down on ground the scanner would never have chosen can take three. A plan whose
// island has not settled within the cap is refused rather than written.
export function placeAllToFixedPoint(layout, model, opts, max = PLAN_CAPS.passes) {
  let prev = JSON.stringify(layout);
  let r = null;
  for (let pass = 1; pass <= max; pass++) {
    r = placeAll(layout, model, opts);
    const cur = JSON.stringify(layout);
    if (cur === prev) return { ...r, stable: true, passes: pass };
    prev = cur;
  }
  return { ...r, stable: false, passes: max };
}

// The plan as scan.mjs runs it: on a copy first, all or nothing, then for real. Returns what
// the wire wants; `layout` is only mutated when the trial passed and `dryRun` is off, and the
// snapshot is written before it is.
export function runPlan(layout, model, plan, { seed, size, dryRun = false, layoutFile = null, placementsFile = null, now = Date.now() }) {
  const t0 = Date.now();
  const before = clone(layout);
  const trial = clone(layout);
  const a = applyPlan(trial, model, plan, { seed, size, now });
  let placed = null;
  if (a.ok) placed = placeAllToFixedPoint(trial, model, { seed, size });
  const diff = diffLayouts(before, trial, a.touched);
  // Nobody the plan touched may be left without a way to town who had one before. Those
  // already cut off stay the island's own problem, not the plan's, or a settled island
  // with one stranded house could never be planned at all.
  const were = new Set(stranded(before, size));
  diff.stranded = placed ? stranded(trial, size).filter((id) => !were.has(id)) : [];
  const ok = a.ok && !!placed && placed.stable && diff.plots.otherMoved.length === 0 && !diff.stranded.length;
  const out = {
    ok, dryRun: !!dryRun, verdicts: a.verdicts, diff,
    pruned: a.pruned, stableAfter: placed ? placed.passes : null,
    unplaced: placed ? placed.unplaced : [], placeMs: Date.now() - t0,
  };
  if (!ok) {
    if (a.ok && placed && !placed.stable) out.error = `the island did not settle within ${PLAN_CAPS.passes} passes`;
    else if (a.ok && diff.plots.otherMoved.length) out.error = `the plan would move things it did not name: ${diff.plots.otherMoved.slice(0, 5).join(', ')}`;
    else if (a.ok && diff.stranded.length) out.error = `no road can reach ${diff.stranded.length} house(s) there: ${diff.stranded.slice(0, 3).map((id) => whose(before, id)).join(', ')}`;
    else out.error = 'a step of the plan was refused';
    return out;
  }
  if (dryRun) return out;

  // For real. The snapshot first, so there is always a way back; then the same ops on the
  // same island, which must say the same things - `placeAll` and the ops are deterministic,
  // and a difference here is a bug worth refusing to write over.
  let snapshot = null;
  if (layoutFile && fs.existsSync(layoutFile)) {
    snapshot = snapshotName(new Date(now));
    fs.copyFileSync(layoutFile, layoutFile.replace(/[^\\/]+$/, snapshot));
    pruneSnapshots(layoutFile);
  }
  const b = applyPlan(layout, model, plan, { seed, size, now });
  if (JSON.stringify(b.verdicts) !== JSON.stringify(a.verdicts)) throw new Error('the plan judged differently on the trial and on the island');
  const final = placeAllToFixedPoint(layout, model, { seed, size });
  if (placementsFile) forgetPlacements([...diff.plots.moved.map((m) => m.id), ...diff.plots.removed], placementsFile);
  return { ...out, snapshot, terrain: final.terrain, unplaced: final.unplaced, stableAfter: final.passes };
}

const KEEP_SNAPSHOTS = 10;
export function listSnapshots(layoutFile) {
  const dir = layoutFile.replace(/[^\\/]+$/, '');
  let names = [];
  try { names = fs.readdirSync(dir).filter(isSnapshotName); } catch { names = []; }
  return names.sort().reverse();
}
function pruneSnapshots(layoutFile) {
  const dir = layoutFile.replace(/[^\\/]+$/, '');
  for (const name of listSnapshots(layoutFile).slice(KEEP_SNAPSHOTS - 1)) {
    try { fs.unlinkSync(dir + name); } catch { /* the next apply will try again */ }
  }
}

// A renderer's note of where a building stood is stale the moment the building is moved;
// dropped here so the sea falls back to the surveyed centre until the keeper's page has
// drawn the island again and posted where things really are (lib/placements.mjs).
export function forgetPlacements(ids, file) {
  if (!ids.length || !file || !fs.existsSync(file)) return 0;
  let on;
  try { on = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return 0; }
  if (!on || typeof on !== 'object' || !on.at) return 0;
  let n = 0;
  for (const id of ids) if (hasOwn(on.at, id)) { delete on.at[id]; n++; }
  if (n) writeJsonAtomic(file, on);
  return n;
}
