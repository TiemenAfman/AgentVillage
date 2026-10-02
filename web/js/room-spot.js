// Where you stood in a room, kept across a reload or a restarted window - the room's half of
// main.js's rememberSpot. Pure: no DOM, no storage, no three.js, so tests/room-spot.test.mjs
// holds every rule here without a browser. main.js keeps the record per browser and per island
// (localStorage `promptholm.walk.room.<seed>`), writes it while you are inside and forgets it
// whenever the room is left - through the door, up to the sky, or put out at closing time - so a
// record that is still there means the page was closed with you in the room.
//
// A record is { v, room, door: { at: [x, z], y, facing: [x, z] | null }, at: [x, y, z], yaw, pitch }:
// `door` is main.js's `cameFrom`, the island spot outside the door (and its height, y or null), in
// the island's own frame;
// `at` is the feet in the room's frame, `y` included, because a room can have storeys and
// "x, z" alone is a gallery or the floor under it.

export const ROOM_SPOT_V = 1;

// How close the door you came in by must still be to the door the island draws now: further
// off and the building moved (a pub lifted onto its beach), or something else stands there.
export const DOOR_SLACK = 1.5;
// How far the floor under the remembered spot may be from where the feet were. Further, and the
// room is not the room it was (a storey gone, a floor moved by a rebake): its own way in instead.
export const FLOOR_SLACK = 0.3;
// Where a spot that is blocked now - a stool you sat on, a crate put down since - looks for room
// before giving up on it: a ring of eight at each of these distances.
export const NUDGES = [0.35, 0.7];
const D = Math.SQRT1_2;
const COMPASS = [[1, 0], [D, D], [0, 1], [-D, D], [-1, 0], [-D, -D], [0, -1], [D, -D]];

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const pair = (a) => Array.isArray(a) && a.length === 2 && a.every(num);
const round = (v) => Math.round(v * 1000) / 1000;

export function packRoomSpot({ room, door, pos, yaw, pitch }) {
  return {
    v: ROOM_SPOT_V,
    room,
    door: { at: door.at.map(round), y: num(door.y) ? round(door.y) : null, facing: door.facing ? door.facing.map(round) : null },
    at: [round(pos.x), round(pos.y), round(pos.z)],
    yaw: round(yaw),
    pitch: num(pitch) ? round(pitch) : null,
  };
}

// The record back out of storage, or null for anything that is not one: another version, a
// hand-edited field, a half-written string.
export function readRoomSpot(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== ROOM_SPOT_V) return null;
  if (typeof raw.room !== 'string' || !raw.room) return null;
  const d = raw.door;
  if (!d || !pair(d.at) || !(d.facing == null || pair(d.facing)) || !(d.y == null || num(d.y))) return null;
  if (!Array.isArray(raw.at) || raw.at.length !== 3 || !raw.at.every(num) || !num(raw.yaw)) return null;
  return {
    room: raw.room,
    door: { at: [...d.at], y: num(d.y) ? d.y : null, facing: d.facing ? [...d.facing] : null },
    at: [...raw.at],
    yaw: raw.yaw,
    pitch: num(raw.pitch) ? raw.pitch : null,
  };
}

// The door on the island that the record's room is entered by, if it still stands where you came
// in: one of `doors` (main.js interactables(), `{ room, x, z, r }`) for the same room within its
// own reach plus DOOR_SLACK of the step you stood on. Null when the building is gone or moved.
export function doorOf(spot, doors) {
  let best = null, bestD = Infinity;
  for (const d of doors || []) {
    if (!d || d.room !== spot.room || !num(d.x) || !num(d.z)) continue;
    const dist = Math.hypot(d.x - spot.door.at[0], d.z - spot.door.at[1]);
    if (dist <= (d.r || 0) + DOOR_SLACK && dist < bestD) { best = d; bestD = dist; }
  }
  return best;
}

// Where to put the feet in the room: the remembered spot, or the nearest place beside it that
// will take them, or null - and then the room's own way in, as on any visit. `room` is what the
// room can answer: `areas` (its rectangles, interior.js), `doorway` ({ z, hx }: past it you are
// outside again, so never there) and `standFloor(x, z, from)`, the floor a body standing at
// `from` finds there, or null when that is blocked (walk.js standFloor).
export function placeInRoom(spot, { areas, doorway, standFloor }) {
  const [x0, y, z0] = spot.at;
  const inRoom = (x, z) => (areas || []).some((a) => x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1);
  const outside = (x, z) => doorway && z > doorway.z - 0.3 && Math.abs(x) < doorway.hx;
  const tries = [[x0, z0]];
  for (const r of NUDGES) for (const [dx, dz] of COMPASS) tries.push([x0 + dx * r, z0 + dz * r]);
  for (const [x, z] of tries) {
    if (!inRoom(x, z) || outside(x, z)) continue;
    const floor = standFloor(x, z, y);
    if (floor == null || Math.abs(floor - y) > FLOOR_SLACK) continue;
    return { at: [x, z], y: floor, yaw: spot.yaw, pitch: spot.pitch };
  }
  return null;
}
