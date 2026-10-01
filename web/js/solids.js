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

// The floor a solid with `top` is, in the surface form: the same shape at `y1`.
export function topOf(b) {
  const s = b.r ? { x: b.x, z: b.z, r: b.r, y: b.y1 } : { x: b.x, z: b.z, hx: b.hx, hz: b.hz, y: b.y1 };
  if (b.yaw != null && !b.r) s.yaw = b.yaw;
  return s;
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
  return { some, size: list.length };
}
