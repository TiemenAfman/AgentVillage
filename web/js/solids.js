// What walk mode bumps into and stands on, as shapes (Plans/hitboxes-en-looppaden.md). Pure: no
// three.js and no DOM, so tests/walk-solids.test.mjs and main.js's route search can ask the same
// questions walk.js does.
//
// A solid is one of
//   { x, z, r }                   a circle - a well, a trunk, a boulder
//   { x, z, hx, hz }              a rectangle along the world's axes - most of the town
//   { x, z, hx, hz, yaw }         the same rectangle turned by `yaw`, the angle a group's
//                                 rotation.y is, so `hx` runs along the thing's own x
// and may carry `y0`/`y1` (a wall only to a body whose span meets it: walk.js atHeight) and
// `top: true`, which makes `y1` a floor over the same shape as well: a crate, a boulder, a
// porch. A surface is a room's `{ x0, x1, z0, z1, y }` (or a slope, `y0`/`y1` + `axis`) as
// before, or any of the three shapes above with a `y`.
//
// The rectangle used to be the only shape, and a thing standing at an angle got the box round
// it: a bench at 45 degrees blocked twice its own area, and a house on one of the small free
// angles of the residential plots (main.js blockersOf) a strip past each wall.

// A thing's own frame, for a point in the world's: the inverse of main.js blockersOf's
// `x + rx cos + rz sin, z - rx sin + rz cos`.
function local(b, x, z) {
  const dx = x - b.x, dz = z - b.z;
  if (b.yaw == null) return [dx, dz];
  const c = b.c ?? Math.cos(b.yaw), s = b.s ?? Math.sin(b.yaw);
  return [dx * c - dz * s, dx * s + dz * c];
}

// Whether (x, z) is within `pad` of the solid - a body's radius, or a bed's.
export function insideSolid(b, x, z, pad = 0) {
  if (b.r) {
    const dx = x - b.x, dz = z - b.z, reach = b.r + pad;
    return dx * dx + dz * dz < reach * reach;
  }
  const [lx, lz] = local(b, x, z);
  return Math.abs(lx) < b.hx + pad && Math.abs(lz) < b.hz + pad;
}

// How far (x, z) is inside the solid grown by `pad`: the shortest way out, positive inside and
// zero or less outside. walk.js lets a body that is already in one step only the way out of it
// (Plans/muren-met-hitboxes.md): a building put up round you, or a ledge you came down on.
export function depthInSolid(b, x, z, pad = 0) {
  if (b.r) return b.r + pad - Math.hypot(x - b.x, z - b.z);
  const [lx, lz] = local(b, x, z);
  return Math.min(b.hx + pad - Math.abs(lx), b.hz + pad - Math.abs(lz));
}

// How high a surface is at (x, z), or null off it.
export function surfaceHeight(s, x, z) {
  if (s.x0 != null) {
    if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) return null;
    if (s.y != null) return s.y;
    const t = s.axis === 'x' ? (x - s.x0) / (s.x1 - s.x0) : (z - s.z0) / (s.z1 - s.z0);
    return s.y0 + (s.y1 - s.y0) * t;
  }
  if (s.r) {
    const dx = x - s.x, dz = z - s.z;
    return dx * dx + dz * dz <= s.r * s.r ? s.y : null;
  }
  const [lx, lz] = local(s, x, z);
  return Math.abs(lx) <= s.hx && Math.abs(lz) <= s.hz ? s.y : null;
}

// The world rectangle a shape can reach, for the index.
function boundsOf(b) {
  if (b.x0 != null) return [b.x0, b.x1, b.z0, b.z1];
  if (b.r) return [b.x - b.r, b.x + b.r, b.z - b.r, b.z + b.r];
  let ex = b.hx, ez = b.hz;
  if (b.yaw != null) {
    const c = Math.abs(Math.cos(b.yaw)), s = Math.abs(Math.sin(b.yaw));
    ex = b.hx * c + b.hz * s;
    ez = b.hx * s + b.hz * c;
  }
  return [b.x - ex, b.x + ex, b.z - ez, b.z + ez];
}

// A building's porch (buildings.js `built.porch`: its upper course in the building's own frame, and
// how far the lower one reaches past it) as floors and nothing else (`floor: true`: walk.js takes
// their tops and never walls anybody with them), put where the building stands and turned with it.
// The steps are 0.18 and 0.08: STEP_UP snaps the feet onto them and off again, which is what a
// doorstep is - no kerb to bump, no jump.
// Each course is grown by `pad`, a body's radius (buildings.js WALK_BODY_R): the upper course shows
// only 0.12 past the walls, less than a body is wide, so the middle of a body standing at the door
// was never over it. A foot is on the highest step under it, and the body is round.
export function porchFloor(porch, { x, z, y, yaw = 0 }, pad = 0.16) {
  const cx = (porch.x0 + porch.x1) / 2, cz = (porch.z0 + porch.z1) / 2;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = { x: x + cx * c + cz * s, z: z - cx * s + cz * c, ...(yaw ? { yaw } : {}), floor: true };
  const hx = (porch.x1 - porch.x0) / 2 + pad, hz = (porch.z1 - porch.z0) / 2 + pad;
  const out = [{ ...at, hx, hz, y1: y + porch.top }];
  if (porch.tread > 0 && porch.low != null) out.push({ ...at, hx: hx + porch.tread, hz: hz + porch.tread, y1: y + porch.low });
  return out;
}

// One of a building's own solids (buildings.js `built.solids`, in its frame) where the building
// stands: moved, turned by its `yaw` (the group's rotation.y) and lifted to its `y`. Turned, not
// boxed: the box round a house on one of the residential plots' free angles (9 to 25 degrees,
// house-placement.js) reached 0.09 to 0.21 past each wall, and past the porch's step at the door
// (Plans/muren-met-hitboxes.md). Main.js's blockersOf and guest-island.js both ask this.
//
// Two kinds keep the box: a circle needs no turn, and a ship's side (`hull`, buildings.js
// shipSolids) is read by boat.js hullOver, which knows only rectangles along the world's axes and
// is why her slabs are a unit long.
export function solidAt(r, { x, z, y = 0, yaw = 0 }) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = { x: x + r.x * c + r.z * s, z: z - r.x * s + r.z * c };
  if (r.r) return { ...at, r: r.r, ...(r.y0 != null ? { y0: r.y0 + y, y1: r.y1 + y } : {}) };
  if (r.hull != null || !yaw) {
    Object.assign(at, { hx: Math.abs(r.hx * c) + Math.abs(r.hz * s), hz: Math.abs(r.hx * s) + Math.abs(r.hz * c) });
  } else Object.assign(at, { hx: r.hx, hz: r.hz, yaw });
  if (r.hull != null) at.hull = r.hull;
  if (r.rail) at.rail = true;
  if (r.dry) at.dry = true;
  if (r.y0 != null) { at.y0 = r.y0 + y; at.y1 = r.y1 + y; }
  return at;
}

// The floor a solid with `top` is, in the surface form: the same shape at `y1`.
export function topOf(b) {
  const s = b.r ? { x: b.x, z: b.z, r: b.r, y: b.y1 } : { x: b.x, z: b.z, hx: b.hx, hz: b.hz, y: b.y1 };
  if (b.yaw != null && !b.r) s.yaw = b.yaw;
  return s;
}

// The follow camera's boom (Plans/camera-botsing.md): where along a segment it first runs into
// something. The segment is a + d t for t in [0, len], d a unit vector; the answer is the entry `t`,
// null when it misses, and -1 when `a` is inside already - the boom starts at the body, and what the
// body stands in (a porch roof's box, a gallery's post it is pressed against) is no reason to pull
// the camera in onto it.
//
// An axis-aligned box, grown by `r` on every side: the slab test.
// No arrays: it is asked for every part of a building near the boom, every frame (the Salty
// Kraken has over a thousand), and garbage per call adds up.
let slabT0 = 0, slabT1 = 0;
function slab(lo, hi, o, v) {
  if (v > -1e-9 && v < 1e-9) return o >= lo && o <= hi;
  let ta = (lo - o) / v, tb = (hi - o) / v;
  if (ta > tb) { const s = ta; ta = tb; tb = s; }
  if (ta > slabT0) slabT0 = ta;
  if (tb < slabT1) slabT1 = tb;
  return slabT0 <= slabT1;
}
export function boxEntry(x0, y0, z0, x1, y1, z1, ax, ay, az, dx, dy, dz, len, r = 0) {
  x0 -= r; y0 -= r; z0 -= r; x1 += r; y1 += r; z1 += r;
  if (ax >= x0 && ax <= x1 && ay >= y0 && ay <= y1 && az >= z0 && az <= z1) return -1;
  slabT0 = 0; slabT1 = len;
  if (!slab(x0, x1, ax, dx) || !slab(y0, y1, ay, dy) || !slab(z0, z1, az, dz)) return null;
  return slabT0;
}

// One of walk mode's solids (a circle, a rectangle, a turned rectangle) standing from `y0` to `y1`,
// grown by `r`. A circle is a cylinder: where the segment's line in plan meets the circle, then the
// height at that point. A turned rectangle is the box in its own frame, the segment turned into it.
export function segmentEntry(b, ax, ay, az, dx, dy, dz, len, r = 0, y0 = b.y0, y1 = b.y1) {
  if (b.r) {
    const R = b.r + r, ox = ax - b.x, oz = az - b.z;
    const inPlan = ox * ox + oz * oz < R * R;
    const inside = inPlan && ay > y0 - r && ay < y1 + r;
    if (inside) return -1;
    const A = dx * dx + dz * dz;
    let t0 = 0, t1 = len;
    if (A < 1e-12) { if (!inPlan) return null; }
    else {
      const B = ox * dx + oz * dz, C = ox * ox + oz * oz - R * R;
      const disc = B * B - A * C;
      if (disc < 0) return null;
      const q = Math.sqrt(disc);
      t0 = Math.max(0, (-B - q) / A); t1 = Math.min(len, (-B + q) / A);
      if (t0 > t1) return null;
    }
    // and the height interval, along the same stretch
    if (Math.abs(dy) < 1e-9) return ay > y0 - r && ay < y1 + r ? t0 : null;
    let ta = (y0 - r - ay) / dy, tb = (y1 + r - ay) / dy;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    const e = Math.max(t0, ta), x = Math.min(t1, tb);
    return e <= x ? e : null;
  }
  if (b.yaw == null) return boxEntry(b.x - b.hx, y0, b.z - b.hz, b.x + b.hx, y1, b.z + b.hz, ax, ay, az, dx, dy, dz, len, r);
  const c = b.c ?? Math.cos(b.yaw), s = b.s ?? Math.sin(b.yaw);
  const lx = ax - b.x, lz = az - b.z;
  return boxEntry(-b.hx, y0, -b.hz, b.hx, y1, b.hz, lx * c - lz * s, ay, lx * s + lz * c, dx * c - dz * s, dy, dx * s + dz * c, len, r);
}

// What the boom looks past rather than stops at: a rail, a fence, a post. A rail going by between the
// camera and the body pulled the camera in onto the head for as long as it took to pass and let it
// out again after (the keeper: "zoomt ie in, das niet handig") - a few frames of a close-up for a
// thing a few centimetres thick that hides nothing. So the camera stays where it is and the rail
// crosses the picture, and the body may be behind it for a moment - World of Warcraft's camera, which
// the keeper pointed at: it stops at the ground and the buildings and looks through every fence,
// crate and lamp post. Thin and low (narrower than CAM_THIN one way and lower than CAM_LOW) is a rail
// or a low wall; narrower than CAM_POST both ways, however tall, is a post or a lamp; within CAM_ITEM
// both ways and lower than CAM_LOW is a thing standing about - a crate, a barrel, a bench, a cart. A
// wall is thin one way but tall, a floor low but wide both ways: both still stop it.
export const CAM_THIN = 0.1;
export const CAM_LOW = 0.45;
export const CAM_POST = 0.16;
export const CAM_ITEM = 0.5;
export function camSeesPast(w, d, h) {
  if (h < CAM_LOW && (Math.min(w, d) < CAM_THIN || Math.max(w, d) < CAM_ITEM)) return true;
  return Math.max(w, d) < CAM_POST;
}
// The same for one of walk mode's solids. A rail is said so (`hop`, a hamlet's low boundary; `rail`,
// the Salty Kraken's pieces a pace long, which on a diagonal are no narrower than a pace one way).
// A solid with no height of its own is measured in plan only.
export function camSeesPastSolid(b) {
  if (b.hop || b.rail) return true;
  const w = b.r ? 2 * b.r : 2 * b.hx, d = b.r ? 2 * b.r : 2 * b.hz;
  return camSeesPast(w, d, b.y1 != null && b.y0 != null ? b.y1 - b.y0 : Infinity);
}

// A building as the camera's boom sees it: its part boxes (buildings.js `built.camBoxes`, six numbers a
// box in its own frame) and where it stands. Kept in its own frame rather than turned into the world's:
// a box is axis-aligned there, so the test is a slab test once the segment is turned in (camBodyEntry),
// and nothing is copied per box. `r` is how far its boxes reach from its middle, for the index. The
// boxes the boom sees past (camSeesPast) are left out here, once, rather than asked every frame.
export function camBodyOf(all, { x, z, y = 0, yaw = 0 }) {
  if (!all || !all.length) return null;
  const keep = [];
  for (let i = 0; i < all.length; i += 6) {
    if (!camSeesPast(all[i + 3] - all[i], all[i + 5] - all[i + 2], all[i + 4] - all[i + 1])) keep.push(i);
  }
  if (!keep.length) return null;
  const boxes = keep.length * 6 === all.length ? all : new Float32Array(keep.length * 6);
  if (boxes !== all) keep.forEach((i, k) => { for (let j = 0; j < 6; j++) boxes[k * 6 + j] = all[i + j]; });
  let r = 0;
  for (let i = 0; i < boxes.length; i += 6) {
    const ex = Math.max(Math.abs(boxes[i]), Math.abs(boxes[i + 3])), ez = Math.max(Math.abs(boxes[i + 2]), Math.abs(boxes[i + 5]));
    r = Math.max(r, Math.hypot(ex, ez));
  }
  return { x, z, y, r, c: Math.cos(yaw), s: Math.sin(yaw), boxes, cam: true };
}

// The first box of a camera body the segment runs into (as segmentEntry), or null. A box the start
// is inside is passed over, not answered with -1: a body has a hundred boxes and standing in one
// (the box of a porch roof, of a yard) says nothing about the others.
export function camBodyEntry(body, ax, ay, az, dx, dy, dz, len, r = 0) {
  const ox = ax - body.x, oz = az - body.z, c = body.c, s = body.s;
  // Past its reach altogether in plan (the index hands over whatever shares a bucket with the
  // segment's box): the nearest the segment comes to its middle, against its radius.
  const hz = Math.hypot(dx, dz);
  if (hz > 1e-9) {
    const along = Math.max(0, Math.min(len * hz, -(ox * dx + oz * dz) / hz));
    const nx = ox + dx / hz * along, nz = oz + dz / hz * along, R = body.r + r;
    if (nx * nx + nz * nz > R * R) return null;
  }
  const lx = ox * c - oz * s, lz = ox * s + oz * c, ly = ay - body.y;
  const vx = dx * c - dz * s, vz = dx * s + dz * c;
  const b = body.boxes;
  let best = null;
  for (let i = 0; i < b.length; i += 6) {
    const t = boxEntry(b[i], b[i + 1], b[i + 2], b[i + 3], b[i + 4], b[i + 5], lx, ly, lz, vx, dy, vz, best ?? len, r);
    if (t != null && t >= 0 && (best == null || t < best)) best = t;
  }
  return best;
}

// Every shape filed under each BUCKET-square it can reach, so a question about one point looks at
// a handful of shapes instead of every one on the island: with the forest in, that is thousands,
// asked several times a frame. Kept equal to a plain scan of the list by tests/walk-solids.test.mjs.
const BUCKET = 2;
export function createSolidIndex(list = []) {
  const cells = new Map();
  const key = (i, j) => i * 73856093 ^ j * 19349663;
  let stamp = 0;
  const seen = new WeakMap();
  for (const b of list) {
    // The turn, worked out once: `local` reads c/s before it would call cos and sin again.
    if (b.yaw != null && b.c == null) { b.c = Math.cos(b.yaw); b.s = Math.sin(b.yaw); }
    const [x0, x1, z0, z1] = boundsOf(b);
    for (let i = Math.floor(x0 / BUCKET); i <= Math.floor(x1 / BUCKET); i++) {
      for (let j = Math.floor(z0 / BUCKET); j <= Math.floor(z1 / BUCKET); j++) {
        const k = key(i, j);
        const have = cells.get(k);
        if (have) have.push(b); else cells.set(k, [b]);
      }
    }
  }
  // Calls `fn(shape)` once for every shape that may lie within `pad` of (x, z), until it returns
  // true; says whether it did. A rectangle is grown by a square in its own frame (insideSolid), and
  // turned that square reaches pad * sqrt 2 along a diagonal of the world, so that is how far to look.
  function some(x, z, pad, fn) {
    stamp++;
    pad *= Math.SQRT2;
    for (let i = Math.floor((x - pad) / BUCKET); i <= Math.floor((x + pad) / BUCKET); i++) {
      for (let j = Math.floor((z - pad) / BUCKET); j <= Math.floor((z + pad) / BUCKET); j++) {
        const here = cells.get(key(i, j));
        if (!here) continue;
        for (const b of here) {
          if (seen.get(b) === stamp) continue;
          seen.set(b, stamp);
          if (fn(b)) return true;
        }
      }
    }
    return false;
  }
  // The same, for every shape that may lie within `pad` of the segment from (ax, az) to (bx, bz):
  // the buckets of its box. A camera's boom is a few units, so that is a handful of buckets.
  function along(ax, az, bx, bz, pad, fn) {
    stamp++;
    pad *= Math.SQRT2;
    const i0 = Math.floor((Math.min(ax, bx) - pad) / BUCKET), i1 = Math.floor((Math.max(ax, bx) + pad) / BUCKET);
    const j0 = Math.floor((Math.min(az, bz) - pad) / BUCKET), j1 = Math.floor((Math.max(az, bz) + pad) / BUCKET);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const here = cells.get(key(i, j));
        if (!here) continue;
        for (const b of here) {
          if (seen.get(b) === stamp) continue;
          seen.set(b, stamp);
          if (fn(b)) return true;
        }
      }
    }
    return false;
  }
  return { some, along, size: list.length };
}
