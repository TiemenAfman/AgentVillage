// Standing on something that moves (Plans/lopen-op-de-boot.md): a position kept in a hull's
// own frame, and the arithmetic between that frame and the world.
//
// Somebody on a deck is somewhere *on the boat*, not somewhere in the sea: every frame the
// hull has moved on, and where they stand in the world is worked out again from where they
// stand on it. That is the whole trick of a lift, a lorry or a boat in any game, and doing
// it the other way round - a body in world coordinates dragged along by the hull's motion -
// is a body that slides off the planks the moment one side's idea of the hull is a frame
// late, which on a network is always.
//
// A hull's frame is { x, z, fx, fz }: where its middle is, and the unit vector it points
// along - (sin yaw, cos yaw), the way walk.js faces. The vector and not the angle, so this
// file needs no trigonometry: shared/ keeps to plain arithmetic, and whoever holds a yaw
// (the page, the sea) turns it into a vector once with its own Math (`frameOf` in
// lib/boats.mjs, `hullOf` in web/js/main.js). In the frame, +z is the bow and +x the right of
// somebody facing it; shared/crafts.mjs describes every deck in it.
//
// No clock and no THREE, like stepBoat: a step takes its dt, so tests/deck.test.mjs can walk
// a deck under Node, and the sea can hold a passenger to the planks with the same numbers.

// ---- the frame ----------------------------------------------------------------------

// Somewhere on the boat, in the world.
export function toWorld(frame, lx, lz, out = [0, 0]) {
  out[0] = frame.x + lx * frame.fz + lz * frame.fx;
  out[1] = frame.z - lx * frame.fx + lz * frame.fz;
  return out;
}

// Somewhere in the world, on the boat. The exact inverse of toWorld (the frame is a
// rotation, so its inverse is its transpose).
export function toLocal(frame, wx, wz, out = [0, 0]) {
  const dx = wx - frame.x, dz = wz - frame.z;
  out[0] = dx * frame.fz - dz * frame.fx;
  out[1] = dx * frame.fx + dz * frame.fz;
  return out;
}

// A direction - an input, a velocity - turns the same way, without the hull's position.
export function dirToWorld(frame, dx, dz, out = [0, 0]) {
  out[0] = dx * frame.fz + dz * frame.fx;
  out[1] = -dx * frame.fx + dz * frame.fz;
  return out;
}
export function dirToLocal(frame, dx, dz, out = [0, 0]) {
  out[0] = dx * frame.fz - dz * frame.fx;
  out[1] = dx * frame.fx + dz * frame.fz;
  return out;
}

// How fast the planks under somebody are going, in the world: a hull's speed along its own
// heading. What a body keeps when it jumps off - see leaveDeck.
export function hullVelocity(frame, v) {
  return { vx: v * frame.fx, vz: v * frame.fz };
}

// ---- the deck -----------------------------------------------------------------------

const inside = (r, x, z) => Math.abs(x - r.x) <= r.hx && Math.abs(z - r.z) <= r.hz;

// The height of the planking at a point of the deck, above DECK_Y, or null where there is no
// deck: the highest stretch that covers it, so a raised poop deck over the waist is stood on.
export function deckAt(craft, lx, lz) {
  let y = null;
  for (const r of craft.deck) if (inside(r, lx, lz) && (y === null || (r.y || 0) > y)) y = r.y || 0;
  return y;
}

// The nearest point of the deck to one that may not be on it. What the sea holds a
// passenger's claimed position to: a pose from a stranger's socket that says they are
// standing a metre off the stern is a pose that says they are standing at the stern.
export function clampToDeck(craft, lx, lz, out = [0, 0]) {
  let best = Infinity;
  for (const r of craft.deck) {
    const x = Math.max(r.x - r.hx, Math.min(r.x + r.hx, lx));
    const z = Math.max(r.z - r.hz, Math.min(r.z + r.hz, lz));
    const d = (x - lx) * (x - lx) + (z - lz) * (z - lz);
    if (d < best) { best = d; out[0] = x; out[1] = z; }
  }
  if (best === Infinity) { out[0] = 0; out[1] = 0; }
  return out;
}

// Whether a body of radius `r` standing at a point is inside a rail, a mast, a cabin wall.
function railed(craft, lx, lz, r) {
  for (const w of craft.rails) {
    if (Math.abs(lx - w.x) < w.hx + r && Math.abs(lz - w.z) < w.hz + r) return true;
  }
  return false;
}

// ---- walking on it ------------------------------------------------------------------

// One step on a deck, in its frame. `s` is { x, z, y, vy, grounded } and is written in
// place; it gains `off: true` the moment the body is no longer on this boat - walked over an
// edge with no rail, or in the air somewhere with no deck under it - which is the caller's
// cue to put it back in the world (leaveDeck). The hull's own motion is not in here at all,
// and that is the point: a jump goes straight up and comes down on the same planks however
// fast the boat is sailing, because the planks are the frame.
//
// `input` is { x, z, jump }: where the body is trying to go, already turned into the hull's
// frame (dirToLocal) and no longer than 1. `move` carries the walker's own numbers - speed,
// radius, jump and gravity - which are walk.js's and are handed in rather than copied.
export function stepDeck(s, input, craft, dt, move) {
  const { speed, radius, jumpV, gravity } = move;
  const step = speed * dt;
  const nx = s.x + input.x * step, nz = s.z + input.z * step;
  // Each axis on its own, so a body pressed against a rail slides along it rather than
  // stopping dead - walk.js's own rule for walls.
  if (!railed(craft, nx, s.z, radius)) s.x = nx;
  if (!railed(craft, s.x, nz, radius)) s.z = nz;

  if (input.jump && s.grounded) { s.vy = jumpV; s.grounded = false; }
  const floor = deckAt(craft, s.x, s.z);
  if (s.grounded) {
    if (floor === null) { s.off = true; return s; }
    s.y = floor;
    s.vy = 0;
    return s;
  }
  s.vy -= gravity * dt;
  s.y += s.vy * dt;
  if (floor === null) { s.off = true; return s; }
  if (s.y <= floor && s.vy <= 0) { s.y = floor; s.vy = 0; s.grounded = true; }
  return s;
}

// ---- getting on and off -------------------------------------------------------------

// Onto the boat: where a body at a world position would stand on this deck, or null when
// there is no deck there. Worked out once, at the moment of stepping on; from then on the
// deck position is the truth and the world position is derived from it every frame.
export function boardAt(frame, craft, wx, wz) {
  const [lx, lz] = toLocal(frame, wx, wz);
  const y = deckAt(craft, lx, lz);
  return y === null ? null : { x: lx, z: lz, y, vy: 0, grounded: true };
}

// Off it: the world position of somebody leaving the deck, carrying the hull's own velocity
// with them - over the side at full speed is a splash some way astern of where you jumped,
// not a body stopped dead in the water.
export function leaveDeck(frame, s, v) {
  const [x, z] = toWorld(frame, s.x, s.z);
  return { x, z, y: s.y, ...hullVelocity(frame, v) };
}
