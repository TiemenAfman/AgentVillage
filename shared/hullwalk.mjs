// Walking on the model itself: the ship is its own hitbox (Plans/DONE/lopen-op-de-boot.md, "Het schip is
// de hitbox").
//
// A deck used to be a few rectangles and a list of rails, worked out by hand from the bake, and
// every time it was wrong somewhere else: a staircase drawn as stairs and walked as a step buried a
// settler in the treads, then the round plinth at the wheel did the same. So there is no
// approximation any more. `scripts/build-shipwalk.mjs` cuts the baked hull with a vertical line
// through the middle of every 5 cm square of its plan and writes down where the line meets a
// surface, at what height and whether it is one to stand on (level enough, not steeper than 70
// degrees) - `web/js/shipwalk-map.js`, a few thousand numbers. This file reads them, and everything
// a body can do on a ship follows from where the model has surfaces:
//
//   floor      the highest surface within a step of your feet with a body's height clear above it:
//              treads, ramps, the plinth, a low crate. A stair is stood on because it is there.
//   obstacle   anything, whichever way it faces, in the height of a body above that floor: a wall,
//              a mast, a cannon, a barrel too tall to step onto, the bulkhead below a balustrade. No
//              list of them, and nothing that can be forgotten.
//   support    a body's whole footprint (its ring, wider than its skin) has floor under it, no more
//              than a step below: so the top of a bulwark is not walked along and a ledge is not
//              walked off, both of which are only surfaces of a model that has no way to say they
//              are a rail. What is left over the side is a jump.
//
// It is pure - no THREE, no clock, no trig - like shared/deck.mjs, and shares its frame: the hull's
// own, `y` above DECK_Y. The sea does not walk anybody on a ship (it holds a claimed position to
// the coarse rectangles in shared/crafts.mjs), so this is the page's, and the tests'.

// A body: how high a step it takes without a jump, how far down it steps rather than falls, how much
// air it needs above its floor, how wide it is at the waist and how wide it needs floor to be under it.
// STEP_UP has to be above the model's own steps (0.16 at the bow, 0.21 up to the poop) and below what
// nobody should climb (the 0.3 of a cannon carriage); STEP_DOWN is the same the other way, and both
// are the walker's own reach, well inside a jump (0.38).
export const STEP_UP = 0.25;
export const STEP_DOWN = 0.3;
export const HEAD = 0.55;
// What the ring of a body may rise ahead of it before it is a wall and not a slope: a step's reach plus
// what a ramp gains across a body's radius (0.5 a unit is 0.08 in 0.16), or a stair's riser followed by
// the ramp behind it - the bow's - is a wall to the eye of the ring while being a way up to the feet.
export const RING_SLACK = 0.08;
export const BODY_R = 0.16;
export const FOOT_R = 0.24;
// How far a body that lands astride something is moved to where it can stand: under a body's width.
const NUDGE = 0.3;

// The eight points of a ring, unit radius; and the cells a body of a given radius touches are these
// scaled, plus its middle.
const RING = [[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]];

// Sixteen directions, a sixteenth of a turn apart, for looking round a point.
const DIRS = [[1, 0], [0.9239, 0.3827], [0.7071, 0.7071], [0.3827, 0.9239], [0, 1], [-0.3827, 0.9239], [-0.7071, 0.7071], [-0.9239, 0.3827],
  [-1, 0], [-0.9239, -0.3827], [-0.7071, -0.7071], [-0.3827, -0.9239], [0, -1], [0.3827, -0.9239], [0.7071, -0.7071], [0.9239, -0.3827]];

function bytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// One layer of the baked map (web/js/shipwalk-map.js): a grid over the hull's plan and a band of
// heights. `map.off` is, per cell, where its entries end in `map.hits` (16 bits each, little-endian,
// cell after cell in x-major order), and an entry is one byte: the height in `q` steps above `y0`,
// doubled, plus one if it is a surface to stand on. Everything else is an obstacle. The map is the
// deck's layer, and it may carry more layers beside it - `aloft`, the crow's nest at the head of the
// mainmast - each a box of its own with a band of its own, none of them overlapping in height.
function readLayer(map) {
  const { cell, x0, z0, nx, nz, y0, q } = map;
  const off = bytes(map.off);
  const hits = bytes(map.hits);
  const end = (i) => off[2 * i] | (off[2 * i + 1] << 8);
  const cellOf = (x, z) => {
    const ix = Math.floor((x - x0) / cell), iz = Math.floor((z - z0) / cell);
    return ix < 0 || iz < 0 || ix >= nx || iz >= nz ? -1 : ix * nz + iz;
  };
  const heightOf = (b) => y0 + (b >> 1) * q;

  // The highest surface in a cell that a body whose feet are at `y` can step onto, with the air of a
  // body above it - or null. `reach` is how far above its feet it may be.
  function floorIn(x, z, y, reach) {
    const c = cellOf(x, z);
    if (c < 0) return null;
    const a = c === 0 ? 0 : end(c - 1), b = end(c);
    let best = null;
    for (let i = b - 1; i >= a; i--) {
      const e = hits[i];
      if (!(e & 1)) continue;
      const h = heightOf(e);
      if (h > y + reach + 1e-9) continue;
      // Something in the way of a body standing on it: another entry above, not the surface itself
      // (a triangle beside it at the same height) and not so high it is over the head.
      let clear = true;
      for (let j = i + 1; j < b; j++) {
        const g = heightOf(hits[j]);
        if (g > h + 0.05 && g < h + HEAD) { clear = false; break; }
      }
      if (clear) { best = h; break; }
    }
    return best;
  }

  // Whether anything solid stands in the height of a body with feet at `y` in a cell: over a step's
  // reach and under its head, any surface at all.
  function solidIn(x, z, y, above) {
    const c = cellOf(x, z);
    if (c < 0) return false;
    const a = c === 0 ? 0 : end(c - 1), b = end(c);
    for (let i = a; i < b; i++) {
      const h = heightOf(hits[i]);
      if (h > y + above && h < y + HEAD) return true;
    }
    return false;
  }

  // The lowest and highest surface in the cell, or null where the line meets nothing.
  function spanIn(x, z) {
    const c = cellOf(x, z);
    if (c < 0) return null;
    const a = c === 0 ? 0 : end(c - 1), b = end(c);
    if (b <= a) return null;
    let lo = Infinity, hi = -Infinity;
    for (let i = a; i < b; i++) {
      const h = heightOf(hits[i]);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
    return [lo, hi];
  }
  return { floorIn, solidIn, spanIn, has: (x, z) => cellOf(x, z) >= 0 };
}

// A surface out of the baked map: every layer of it read as one. A floor is the highest any layer has
// within reach, a cell is solid where any layer is, so a body in the crow's nest stands on the nest
// and one on the waist under it on the waist, each asking with the height of its own feet.
export function createSurface(map) {
  const deck = readLayer(map);
  const layers = [deck, ...(map.aloft ? [readLayer(map.aloft)] : [])];

  function floorIn(x, z, y, reach) {
    let best = null;
    for (const l of layers) {
      const f = l.floorIn(x, z, y, reach);
      if (f !== null && (best === null || f > best)) best = f;
    }
    return best;
  }
  const solidIn = (x, z, y, above) => layers.some((l) => l.solidIn(x, z, y, above));

  // The body of radius `r` standing at (x, z) with its feet at `y`: an obstacle anywhere in its
  // ring. `above` is what it steps over - a step's reach on the ground, a hair in the air.
  function blockedAt(x, z, y, r = BODY_R, above = STEP_UP + RING_SLACK) {
    if (solidIn(x, z, y, above)) return true;
    for (const [dx, dz] of RING) if (solidIn(x + dx * r, z + dz * r, y, above)) return true;
    return false;
  }

  // The floor of a body standing at (x, z): its middle's floor - the highest within a step of `y` -
  // and its whole footprint held up. Null where there is nowhere to stand: nothing there, a body's
  // height of something over it, or a footprint that hangs over the edge of a deck or the top of a
  // wall. `y` is where the feet are.
  function standAt(x, z, y) {
    const f = floorIn(x, z, y, STEP_UP);
    if (f === null) return null;
    for (const [dx, dz] of RING) {
      // Ground under it, and not far below: what is higher than a step is a wall or a rise, which
      // blockedAt is there to judge - it is not the ground missing.
      const g = floorIn(x + dx * FOOT_R, z + dz * FOOT_R, f, 1);
      if (g === null || g < f - STEP_DOWN) return null;
    }
    return f;
  }

  // Where a falling body lands: the highest surface it has come down to (feet at `y`, and `reach`
  // above them what it fell through this frame, a hair by default), held up like a standing one.
  function landAt(x, z, y, reach = 0.05) {
    const f = floorIn(x, z, y, reach);
    if (f === null) return null;
    return standAt(x, z, f) === null ? null : f;
  }

  // The deck's layer is the hull's plan; the others lie inside it.
  const inMap = (x, z) => deck.has(x, z);
  // The lowest and highest surface in the deck's layer under (x, z), or null where the line meets
  // nothing: the hull's envelope there, which the follow camera keeps out of (walk.js,
  // Plans/camera-botsing.md). The deck's alone: a nest eight units up is not the hull's envelope.
  const spanAt = (x, z) => deck.spanIn(x, z);
  return { floorIn: (x, z, y, reach = STEP_UP) => floorIn(x, z, y, reach), blockedAt, standAt, landAt, inMap, spanAt, map };
}

// The nearest place to (x, z) where a body can stand and is not inside anything: for putting somebody
// down somewhere that a model, and not a table of numbers, says is free - where a ladder lands, a step
// forward of the wheel. Rings outwards a step of the grid at a time; null if there is none within `max`.
// `below` is how far under `y` the place may be: anywhere by default, a step for a body that has just
// come down on something and must not be put down on the deck eight units below the nest it was in.
export function nearestStand(surface, x, z, y, max = 0.8, below = Infinity) {
  const at = (px, pz) => {
    const f = surface.standAt(px, pz, y);
    return f !== null && f >= y - below && !surface.blockedAt(px, pz, f) ? { x: px, z: pz, y: f } : null;
  };
  const first = at(x, z);
  if (first) return first;
  for (let r = 0.05; r <= max + 1e-9; r += 0.05) {
    for (const [dx, dz] of DIRS) {
      const p = at(x + dx * r, z + dz * r);
      if (p) return p;
    }
  }
  return null;
}

// One step of a body on a hull's surface, in her frame. The same contract as shared/deck.mjs stepDeck
// - `s` is { x, z, y, vy, grounded } and is written in place, `off` when the body is no longer on her -
// with the walk's own rules in place of rectangles:
//
//   on foot     each axis on its own (a body pressed at a wall slides along it), and a step is taken
//               only where the surface can hold the body (standAt) and nothing is in the way of it
//               (blockedAt) and it is not a drop of more than a step (the floor there must be within
//               STEP_DOWN of the feet).
//   in the air  a jump goes where it is aimed, stopped only by what is above the feet - so a body that
//               has cleared a bulwark goes on over it - and comes down on the highest surface it has
//               reached. A body that falls below the deck with nothing to land on is off the ship.
export function stepHull(s, input, surface, dt, move) {
  const { speed, radius, jumpV, gravity } = move;
  const step = speed * dt;
  const nx = s.x + input.x * step, nz = s.z + input.z * step;
  const r = radius || BODY_R;
  const walkable = (x, z) => {
    const f = surface.standAt(x, z, s.y);
    return f !== null && f >= s.y - STEP_DOWN && !surface.blockedAt(x, z, f, r);
  };
  if (s.grounded) {
    // The floor comes with the step, and is worked out for the position it was taken to: a body on a
    // stair rises with it. Whole step first, then each axis, as walk.js does for walls.
    if (walkable(nx, nz)) { s.x = nx; s.z = nz; }
    else if (walkable(nx, s.z)) s.x = nx;
    else if (walkable(s.x, nz)) s.z = nz;
    const f = surface.standAt(s.x, s.z, s.y);
    if (input.jump) { s.vy = jumpV; s.grounded = false; }
    else if (f === null) { s.grounded = false; s.vy = 0; }    // the ground went: falling
    else { s.y = f; s.vy = 0; return s; }
  } else {
    const free = (x, z) => !surface.blockedAt(x, z, s.y, r, 0.02);
    if (free(nx, nz)) { s.x = nx; s.z = nz; }
    else if (free(nx, s.z)) s.x = nx;
    else if (free(s.x, nz)) s.z = nz;
  }
  const was = s.y;
  s.vy -= gravity * dt;
  s.y += s.vy * dt;
  if (!surface.inMap(s.x, s.z)) { s.off = true; return s; }
  if (s.vy <= 0) {
    // Only on a surface the feet came down through this frame: the highest one under where they were
    // and no lower than where they are. Any floor under them, as it was, set a body falling from the
    // crow's nest on the waist eight units down in one frame (Plans/DONE/kraaiennest.md) - and cut every
    // jump on her deck short at the top of its arc.
    const fell = Math.max(0, was - s.y) + 0.05;
    const f = surface.landAt(s.x, s.z, s.y, fell);
    if (f !== null && f >= s.y - 0.05) { s.y = f; s.vy = 0; s.grounded = true; return s; }
    // Came down through a floor that cannot hold the whole footprint - astride the nest's rim, or a
    // bulwark's top: onto the nearest place near it that can, a nudge, and not on through the planks.
    const g = surface.floorIn(s.x, s.z, s.y, fell);
    const at = g !== null && g >= s.y - 0.05 ? nearestStand(surface, s.x, s.z, g + 0.05, NUDGE, STEP_DOWN + 0.05) : null;
    if (at) { s.x = at.x; s.z = at.z; s.y = at.y; s.vy = 0; s.grounded = true; return s; }
    // Nothing to come down on, and lower than any deck of hers: over the side and gone.
    if (s.y < surface.map.y0 - 0.1) s.off = true;
  }
  return s;
}
