// The route a parked body walks when the keeper clicks somewhere from above (main.js walkBodyTo,
// walk.js goTo; Plans/paard-in-plaats-van-fiets.md "Van boven op pad"). Pure: no DOM, no three,
// every question about the world comes in as a function, so tests/body-route.test.mjs can lay a
// village of real houses on flat ground and walk the route with the real walk mode.
//
// The search is the settlers' own A* over cells (shared/settlerwalk.mjs findPath, untouched), but
// the feet are stopped by shapes, not cells (web/js/solids.js), and a house stands on one of the
// residential plots' free angles: its corners reach in between two cell middles that are both
// free. A route was a cell middle to the next, straight, so it ran into a turned wall's corner on
// the way between them, slid, got no nearer and gave up after two seconds - "routing loopt tegen
// een huis aan en stopt" (8 October 2026). So a step between two cells is a way only when a body
// fits along the whole line between the two spots it would walk (`clear`), asked of the same
// `blockedAt` the feet use - which is what makes the route the feet's and not the settlers'.
import { findPath } from 'shared/settlerwalk.mjs';

// Where in a cell a route may pass when its middle is taken: the middle first, then a third of a
// cell off it each way.
export const ROUTE_SPOTS = [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3], [0.3, 0.3], [-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3]];
// Cells of route from which the body gets on its own ride (walk.js goTo's `ride`: the Adventurer's and
// the Wanderer's horse, the Traveller's bicycle): a street or two is walked, across a hamlet and further
// is ridden (Plans/paard-in-plaats-van-fiets.md "Van boven op pad").
export const RIDE_FROM = 20;
// A fence between two owners costs this many steps, except where a road passes (its gate).
export const FENCE_STEPS = 12;
const DECK_STEP = 0.44;          // just under walk.js's STEP_UP (0.45)
// How far apart a line between two spots is asked, and how much wider than the feet's body it is
// asked with. A corner that reaches only a few millimetres into the line is narrow - a porch post's
// was 3 cm along it, and slipped between samples 0.2 apart (measured: 42 of 400 trips through a
// street still stuck) - but every point the feet are stopped at lies within half a step of a
// sample, so a body CLEAR_PAD = CLEAR_STEP / 2 wider at the samples meets whatever stops them.
export const CLEAR_STEP = 0.2;
export const CLEAR_PAD = CLEAR_STEP / 2;
// Round the body's own position (and the clicked point) the line is asked at the feet's width: a body
// parked against a wall may walk away from it.
const LOOSE = 0.3;

// Whether a body fits all along the line from a to b, asked every CLEAR_STEP with CLEAR_PAD to spare -
// except within LOOSE of an end that is `loose` (where the body stands, or the point clicked).
export function clear(blockedAt, a, b, { looseA = false, looseB = false } = {}) {
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.ceil(len / CLEAR_STEP));
  for (let i = 0; i <= n; i++) {
    const along = (len * i) / n;
    const loose = (looseA && along < LOOSE) || (looseB && len - along < LOOSE);
    if (blockedAt(a[0] + (dx * i) / n, a[1] + (dz * i) / n, loose ? 0 : CLEAR_PAD)) return false;
  }
  return true;
}

// The route from world point `from` to `to` on `terrain` (makeTerrain's: size, cellWorld, inGrid,
// isLand, slope, worldHeight), or null when there is no way there. `blockedAt(x, z, pad)` is walk.js's.
// Options:
//   exact    end on (x, z) itself, not its cell's middle, when a body fits there;
//   deck     Map key -> deck height: the hand-built bridges, open over the water, entered at their ends;
//   roads    Set of keys a route prefers;
//   crossing (a, b) => extra cost of a step (the fences between owners);
//   closed   (a, b) => true where a hedge or wall stands between two cells;
//   avoid    Set of keys not to go through: where a body got stuck before (a replan, walk.js onStuck).
// Returns { points: [[x, z], ...] (the start left out), cells: the number of cells it crosses }.
export function planRoute(terrain, from, to, blockedAt, { exact = true, deck = null, roads = null, crossing = null, closed = null, avoid = null } = {}) {
  const t = terrain, size = t.size, half = size / 2;
  const cellOf = (px, pz) => [Math.floor(px + half), Math.floor(pz + half)];
  const a = cellOf(from[0], from[1]), b = cellOf(to[0], to[1]);
  if (!t.inGrid(b[0], b[1]) || !t.inGrid(a[0], a[1])) return null;
  const goal = b[0] + b[1] * size;
  if (!t.isLand(b[0], b[1]) && !(deck && deck.has(goal))) return null;
  const middle = (k) => t.cellWorld(k % size, (k - (k % size)) / size);
  // Where a route walks in each cell, asked lazily and remembered: a whole grid of collision tests per
  // click is 150k of them on a grown island, and A* looks at a few hundred. A cell whose middle is
  // taken (a trunk, a boulder, a gatepost) is still a way through when a body fits somewhere else in
  // it. null: nowhere in it.
  const spots = new Map();
  const spotOf = (k) => {
    let v = spots.get(k);
    if (v !== undefined) return v;
    v = null;
    if (deck && deck.has(k)) v = middle(k);
    else {
      const [cx, cz] = middle(k);
      for (const [ox, oz] of ROUTE_SPOTS) if (!blockedAt(cx + ox, cz + oz, CLEAR_PAD)) { v = [cx + ox, cz + oz]; break; }
    }
    spots.set(k, v);
    return v;
  };
  const start = a[0] + a[1] * size;
  // The cell a click landed in may be all house (a roof clicked): the route goes to its edge and
  // stops there, where the last step that fits ends.
  const goalTaken = spotOf(goal) === null;
  const blocked = { has: (k) => (avoid && avoid.has(k)) || (k !== start && spotOf(k) === null) };
  // A deck is a cell like any other to the search, and a step on to it from the bank beside it
  // halfway across the arch is two metres of wall: onto a deck (or off one) only where the two
  // surfaces are within a step, so it is entered at its ends and walked along.
  const surface = (k) => (deck && deck.has(k) ? deck.get(k) : t.worldHeight(...middle(k)));
  const decked = deck && deck.size > 0;
  // The step itself: a body fits all along the line between the two spots (the start from where the
  // body stands). Remembered per pair, both ways alike.
  const lines = new Map();
  const fits = (p, q) => {
    if (decked && (deck.has(p) || deck.has(q))) return true;   // a deck's own cells are walked as its planks
    if (q === goal && goalTaken) return true;
    const key = p < q ? p * size * size + q : q * size * size + p;
    let v = lines.get(key);
    if (v === undefined) {
      const sp = p === start ? from : spotOf(p), sq = q === start ? from : spotOf(q);
      v = !!sp && !!sq && clear(blockedAt, sp, sq, { looseA: p === start, looseB: q === start });
      lines.set(key, v);
    }
    return v;
  };
  const step = (p, q) => (!closed || !closed(p, q))
    && (!decked || (!deck.has(p) && !deck.has(q)) || surface(q) - surface(p) <= DECK_STEP)
    && fits(p, q);
  const path = findPath(t, a, b, blocked, { open: deck, prefer: roads, crossing, step });
  if (!path) return null;
  const keys = path.map(([px, pz]) => { const [gx, gz] = cellOf(px, pz); return gx + gz * size; });
  let points = keys.slice(1).map((k) => spotOf(k) || middle(k));
  if (goalTaken && keys.length > 1) points.pop();
  // Pulled straight: a cell route across open ground is a staircase, a corner every cell, which the feet
  // shrug off and a horse has to rein in for at every one. A point is skipped where the line past it
  // is clear and runs over open land only.
  points = straighten(t, from, points, blockedAt, (k) => (avoid && avoid.has(k)) || (deck && deck.has(k)));
  const last = points.length ? points[points.length - 1] : from;
  if (exact && !goalTaken && !blockedAt(to[0], to[1]) && clear(blockedAt, last, to, { looseA: !points.length, looseB: true })) points.push([to[0], to[1]]);
  if (!points.length) return null;
  return { points, cells: keys.length - 1 };
}

// How far ahead a point may be skipped to: a long look costs a clear() a point, and a route that
// bends round a hamlet gains nothing past a few streets.
const PULL_AHEAD = 16;
// The ground along a pulled line may not change by more than this between two samples (a walker
// steps up 0.45; a pulled line must not ask a step the cell route went round).
const PULL_RISE = 0.25;

// `points` with every point dropped that the body can go straight past: from each kept point, the
// furthest of the next PULL_AHEAD the line to which is clear() and whose cells are land, not `kept`
// (a deck, a cell to avoid), and no steeper than PULL_RISE a sample. The last point always stays.
export function straighten(t, from, points, blockedAt, kept = () => false) {
  if (points.length < 2) return points;
  const size = t.size, half = size / 2;
  const open = (a, b) => {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / CLEAR_STEP));
    let y = t.worldHeight(a[0], a[1]);
    for (let i = 1; i <= n; i++) {
      const x = a[0] + (dx * i) / n, z = a[1] + (dz * i) / n;
      const gx = Math.floor(x + half), gz = Math.floor(z + half);
      if (!t.inGrid(gx, gz) || !t.isLand(gx, gz) || kept(gx + gz * size)) return false;
      const h = t.worldHeight(x, z);
      if (Math.abs(h - y) > PULL_RISE) return false;
      y = h;
    }
    return true;
  };
  const out = [];
  let at = from, i = 0, first = true;
  while (i < points.length) {
    let j = i;
    for (let k = Math.min(points.length - 1, i + PULL_AHEAD); k > i; k--) {
      if (open(at, points[k]) && clear(blockedAt, at, points[k], { looseA: first })) { j = k; break; }
    }
    out.push(points[j]);
    at = points[j];
    first = false;
    i = j + 1;
  }
  return out;
}

// The total length of a route walked from `from`, in island units (a cell is one).
export function routeLength(from, points) {
  let d = 0, p = from;
  for (const q of points) { d += Math.hypot(q[0] - p[0], q[1] - p[1]); p = q; }
  return d;
}
