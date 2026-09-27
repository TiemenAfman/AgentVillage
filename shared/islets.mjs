// The islets: little unclaimable islands - a sandbank with one palm, a round one with a
// clump of them, a greener one with bushes as well - scattered over the open sea to give it
// something to sail to (Plans/starter-eilanden.md, "onclaimbare eilandjes als decoratie").
//
// Nobody lays them down and nothing sends them: every page works the same islets out of
// the same two things, a fixed lattice over the world and the fleet it is shown. So the
// sea gains no message, no field and no SEA_V, and everybody sees the same islet in the
// same place. That is also the whole of their persistence - an islet is where it is
// because of arithmetic, and it is gone when an island (or a starter) is given its water,
// which only ever happens when the fleet changes and everything is drawn again anyway.
// They never count for nextOrigin or MAX_ISLANDS: a sandbank that held a berth would make a
// whole island's worth of sea unusable for the sake of one palm.
//
// Here and not in web/js/ because the walk-on step (the second one in the plan) needs the
// ground height, and the ground somebody stands on has to be the ground that is drawn - so
// both come from `isletHeight`. That puts all of this under shared/'s rule: integer maths,
// + - * /, floor, abs, min, max and sqrt; no sin, cos or pow (see shared/rng.mjs). An angle
// here is only ever handed out, for the page to turn a palm by.
import { hash32, makeRng, makeSimplex2D } from './rng.mjs';
import { clearOf } from './regions.mjs';

// One candidate per square this wide, in world units. The square is the islet's own: an
// islet keeps `EDGE` off the square's sides, so two neighbours can never touch, which is
// what lets the lattice be tested point by point instead of against every other islet.
export const ISLET_PITCH = 96;
const EDGE = 8;
// Of the candidates in free water, how many hold an islet, in percent. Free water is rare
// near the fleet (every island holds its whole `reach`, room to grow included), so most
// islets come out in the empty berths of a ring and beyond the last one.
export const ISLET_CHANCE = 25;
// Open water kept between an islet's own square and every island's reach. A little more
// than a boat's turning circle, so no islet ever sits in the mouth of somebody's harbour.
export const ISLET_MARGIN = 24;
// How far out from the viewer, in world units, the lattice is worked out at all. Past this
// the haze has them anyway, and it keeps the work to a few hundred hashes. At a quarter of
// the free squares that is some forty islets round a berth - "hier en daar", not a reef.
export const ISLET_RANGE = 800;

// What there is. `r` is the radius in cells (the plan's 6 to 20 across), `peak` how high the
// middle stands over the sea, `palms` and `bushes` how many, each as [least, most].
export const ISLET_KINDS = {
  sandbank: { r: [3, 4], peak: 0.45, palms: [1, 1], bushes: [0, 0] },
  round: { r: [5, 7], peak: 0.7, palms: [3, 5], bushes: [0, 1] },
  green: { r: [8, 10], peak: 1.1, palms: [2, 4], bushes: [3, 6] },
};
// Four in ten a sandbank, four a round one, two a greener one.
const KIND_OF = ['sandbank', 'sandbank', 'sandbank', 'sandbank', 'round', 'round', 'round', 'round', 'green', 'green'];
// Where on an islet a palm may stand and a bush may grow, as a share of its radius - the
// palms nearer the top, so a crown does not hang out over the water from a sandbank.
const PALM_REACH = 0.5;
const BUSH_REACH = 0.75;
// Bigger than the island's own trees: a palm on a sandbank is the thing you sail towards,
// and at scale 1 (six metres, flora_palm_a's own height) it read from the water as a dot
// on a pancake. Some ten metres, which is what a grown coconut palm is anyway.
const PALM_SCALE = [1.4, 1.9];
const BUSH_SCALE = [1.3, 1.9];

const TAU = 6.283185307179586;
const noiseOf = new Map();

function noise(islet) {
  let n = noiseOf.get(islet.id);
  if (!n) { n = makeSimplex2D(islet.id); noiseOf.set(islet.id, n); }
  return n;
}

// The ground of one islet at a point in its own frame (cells from its middle): a dome with
// a knocked-about coast, above the sea only inside it and falling away under the water past
// it, so the sea closes over the edge. The noise is on the *distance*, not the height, which
// is what turns a circle into a coastline rather than into a lumpy circle.
export function isletHeight(islet, lx, lz) {
  const d = Math.sqrt(lx * lx + lz * lz) / islet.r;
  const wobble = 1 + 0.2 * noise(islet)(lx * 0.22, lz * 0.22);
  const rr = d * wobble;
  if (rr < 1) return islet.peak * (1 - rr * rr);
  return Math.max(-2, -(rr - 1) * 3);
}

// Every islet within `range` of `at` (world coordinates), clear of every row in `fleet`
// and of every `{ half, origin }` in `extra` (the phone's own berth, which is not in the
// fleet). Sorted by id, so two pages that ask about the same water get the same list.
export function isletsNear(fleet, at, { range = ISLET_RANGE, extra = [] } = {}) {
  const held = [];
  for (const row of fleet || []) {
    if (!row || !Array.isArray(row.origin)) continue;
    held.push({ half: row.reach ?? (row.gridSize || 64) / 2, origin: row.origin });
  }
  for (const e of extra) if (e && Array.isArray(e.origin)) held.push(e);
  const [ax, az] = at || [0, 0];
  const lo = (v) => Math.floor((v - range) / ISLET_PITCH);
  const hi = (v) => Math.floor((v + range) / ISLET_PITCH);
  const out = [];
  for (let j = lo(az); j <= hi(az); j++) {
    for (let i = lo(ax); i <= hi(ax); i++) {
      const islet = candidate(i, j);
      if (!islet) continue;
      if (Math.abs(islet.x - ax) > range || Math.abs(islet.z - az) > range) continue;
      const own = { half: islet.r, origin: [islet.x, islet.z] };
      if (!held.every((h) => clearOf(own, h, ISLET_MARGIN))) continue;
      out.push(islet);
    }
  }
  for (const islet of out) furnish(islet);
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// The islet a lattice square holds, if it holds one - before the fleet is asked. Its place
// in the square, its kind and its size all come out of one hash of the square.
export function candidate(i, j) {
  const id = `islet:${i}:${j}`;
  const h = hash32(id);
  if (h % 100 >= ISLET_CHANCE) return null;
  const kind = KIND_OF[(h >>> 7) % KIND_OF.length];
  const spec = ISLET_KINDS[kind];
  const r = spec.r[0] + ((h >>> 11) % (spec.r[1] - spec.r[0] + 1));
  // Anywhere in the square that keeps EDGE plus its own radius off every side.
  const room = ISLET_PITCH - 2 * (EDGE + r);
  const x = i * ISLET_PITCH + EDGE + r + ((h >>> 15) % (room + 1));
  const z = j * ISLET_PITCH + EDGE + r + (hash32(id + ':z') % (room + 1));
  return { id, kind, x, z, r, peak: spec.peak };
}

// What stands on it: palms and bushes, in the islet's own frame, each on its own ground.
// Drawn from the islet's own rng, so a palm is where it is on every screen.
function furnish(islet) {
  const spec = ISLET_KINDS[islet.kind];
  const rng = makeRng(islet.id + ':flora');
  const count = ([a, b]) => a + rng.int(b - a + 1);
  const place = (reach, [s0, s1], least) => {
    for (let tries = 0; tries < 12; tries++) {
      const lx = rng.range(-reach, reach) * islet.r;
      const lz = rng.range(-reach, reach) * islet.r;
      const y = isletHeight(islet, lx, lz);
      if (y < least) continue;
      return { x: lx, z: lz, y, rot: rng.range(0, TAU), s: rng.range(s0, s1) };
    }
    return null;
  };
  const palms = [], bushes = [];
  for (let n = count(spec.palms); n > 0; n--) { const p = place(PALM_REACH, PALM_SCALE, 0.12); if (p) palms.push(p); }
  for (let n = count(spec.bushes); n > 0; n--) { const b = place(BUSH_REACH, BUSH_SCALE, 0.08); if (b) bushes.push(b); }
  // A sandbank always has its palm: it is the one thing that makes it a place.
  if (!palms.length) palms.push({ x: 0, z: 0, y: islet.peak, rot: 0, s: 1 });
  islet.palms = palms;
  islet.bushes = bushes;
  return islet;
}
