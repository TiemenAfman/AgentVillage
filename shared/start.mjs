// Where somebody with no island of their own starts: on land, with their skiff moored off it
// (Plans/start-op-land.md). The app and the web page alike - anything with no islander - ask
// this once, at boot, of the fleet the sea has just described, and walk on from there.
//
// Pure and under shared/'s rule (no sin, cos, atan2 or pow; see shared/rng.mjs), so the choice
// can be tested without a page and every page that asks the same question of the same fleet
// gets the same answer. Every coordinate handed out is in the world's frame; the page turns
// it into its own with worldToScene.
import { hash32 } from './rng.mjs';
import { isletsNear, isletHeight } from './islets.mjs';

// A starter's id: `5ea5` and its slot in twelve hex digits (starterId in lib/islandbundle.mjs,
// which a page may not import; tests/start.test.mjs holds the two together). The fleet row
// says `starter: true` itself from a sea that knows to; a sea from before that is recognised
// by the id, which no real island has (one in 2^48: a real id is a sha256 prefix).
const STARTER_ID = /^5ea5[0-9a-f]{12}$/;
export const isStarterRow = (row) => !!row && (row.starter === true || (typeof row.id === 'string' && STARTER_ID.test(row.id)));
const isVolcanoRow = (row) => !!row && row.volcano === true;
const placed = (row) => !!row && Array.isArray(row.origin);

// How deep the water has to be under a moored skiff, and how much further out it lies than
// the first water that deep - room for the hull, so it is not lying on the sand at its stern.
export const SKIFF_DEPTH = -0.8;
const SKIFF_ROOM = 1.5;
// What a body keeps off a palm's origin: the trunk stands up to 0.39 * scale to one side of
// it (PALM_FOOT in web/js/islets.js) and is 0.13 * scale thick, plus a body's own width.
const PALM_CLEAR = (s) => 0.6 * s + 0.8;
// Dry enough to stand on: above the waterline with something to spare for the swell.
const DRY = 0.15;

// Sixteen bearings, as unit vectors written out (k * 22.5 degrees from +z, turning towards +x),
// because shared/ may not call cos or sin. The order is the order a tie is broken in.
const DIRS = [
  [0, 1], [0.3826834323650898, 0.9238795325112867], [0.7071067811865476, 0.7071067811865476],
  [0.9238795325112867, 0.3826834323650898], [1, 0], [0.9238795325112867, -0.3826834323650898],
  [0.7071067811865476, -0.7071067811865476], [0.3826834323650898, -0.9238795325112867],
  [0, -1], [-0.3826834323650898, -0.9238795325112867], [-0.7071067811865476, -0.7071067811865476],
  [-0.9238795325112867, -0.3826834323650898], [-1, 0], [-0.9238795325112867, 0.3826834323650898],
  [-0.7071067811865476, 0.7071067811865476], [-0.3826834323650898, 0.9238795325112867],
];

// Which place: the free starter everybody is sent to, else the islet nearest an islander's
// island, else the islet nearest the volcano, else null (the old start, afloat at home).
// `extra` is what the page holds of the sea itself - its own open berth - which an islet may
// not take, exactly as isletsNear is asked everywhere else on the page.
export function startTarget(fleet, { extra = [] } = {}) {
  const rows = (fleet || []).filter(placed);
  // The highest slot: a newcomer takes the free starters lowest slot first (lib/fleet.mjs
  // publish), so this one stays nobody's longest - and every wanderer is sent to the same
  // one, which is the point of a square with a tavern on it. The id spells the slot in fixed
  // width hex, so it sorts as the slot does.
  const starters = rows.filter(isStarterRow).sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  if (starters.length) return { kind: 'starter', row: starters[0] };
  // Somebody's island: one with its islander on the line first, then by id.
  const islanders = rows.filter((r) => !isStarterRow(r) && !isVolcanoRow(r))
    .sort((a, b) => (!!b.live - !!a.live) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const row of islanders) {
    const islet = nearestIslet(fleet, row.origin, extra);
    if (islet) return { kind: 'islet', islet, near: row };
  }
  const volcano = rows.find(isVolcanoRow) || null;
  const islet = nearestIslet(fleet, volcano ? volcano.origin : [0, 0], extra);
  return islet ? { kind: 'islet', islet, near: volcano } : null;
}

function nearestIslet(fleet, [x, z], extra) {
  let best = null, bestD = Infinity;
  // isletsNear hands them out sorted by id, so a tie goes to the lowest.
  for (const islet of isletsNear(fleet, [x, z], { extra })) {
    const d = (islet.x - x) * (islet.x - x) + (islet.z - z) * (islet.z - z);
    if (d < bestD) { best = islet; bestD = d; }
  }
  return best;
}

// From a point on land, straight out along `dir` until the ground under the water is
// SKIFF_DEPTH deep, then SKIFF_ROOM further. Null if it never gets that deep within `limit`.
function offshore(height, [x, z], [dx, dz], limit) {
  for (let t = 0; t <= limit; t += 0.5) {
    if (height(x + dx * t, z + dz * t) <= SKIFF_DEPTH) {
      const u = t + SKIFF_ROOM;
      return { at: [x + dx * u, z + dz * u], t: u };
    }
  }
  return null;
}

// The cells of a starter's five by five square a body may stand on, round its middle: never
// the well (the middle) or the tables (one along and one down), which are solid.
const SQUARE_SPOTS = [[-1, -1], [1, -1], [-1, 1], [0, -1], [-1, 0], [1, 0], [0, 1], [-2, 0], [2, 0], [0, -2], [0, 2], [-2, -1], [2, -1], [-2, 1]];

// Where on a starter, and where its skiff lies: `terrain` is the starter's own (makeTerrain of
// its seed and gridSize, local frame), `bundle` the island as the sea hands it out (only its
// town is read), `row` the fleet row (its origin), `player` the id that scatters the spot.
export function starterSpot(row, terrain, bundle, player) {
  const centre = bundle && bundle.island && bundle.island.town && bundle.island.town.centre;
  if (!Array.isArray(centre)) return null;
  const [ox, oz] = row.origin;
  const [dx, dz] = SQUARE_SPOTS[hash32(`start:${player}`) % SQUARE_SPOTS.length];
  const [sx, sz] = terrain.cellWorld(centre[0] + dx, centre[1] + dz);
  // The shortest way to water deep enough, of the sixteen bearings, from the stand.
  let best = null;
  for (const dir of DIRS) {
    const off = offshore(terrain.worldHeight, [sx, sz], dir, terrain.size);
    if (off && (!best || off.t < best.t)) best = off;
  }
  if (!best) return null;
  return { stand: [sx + ox, sz + oz], skiff: [best.at[0] + ox, best.at[1] + oz] };
}

// Where on an islet: dry ground clear of every palm trunk, as near its middle as there is
// any, on a bearing the player's id turns, and the skiff straight out from there.
export function isletSpot(islet, player) {
  const height = (x, z) => isletHeight(islet, x, z);
  const turn = hash32(`start:${player}`) % DIRS.length;
  const clear = (x, z) => (islet.palms || []).every((p) => {
    const ddx = x - p.x, ddz = z - p.z;
    return ddx * ddx + ddz * ddz >= PALM_CLEAR(p.s) * PALM_CLEAR(p.s);
  });
  for (const k of [0.25, 0.4, 0.1, 0.55, 0.7]) {
    for (let n = 0; n < DIRS.length; n++) {
      const dir = DIRS[(turn + n) % DIRS.length];
      const x = dir[0] * islet.r * k, z = dir[1] * islet.r * k;
      if (height(x, z) < DRY || !clear(x, z)) continue;
      const off = offshore(height, [x, z], dir, islet.r * 3);
      if (!off) continue;
      return { stand: [x + islet.x, z + islet.z], skiff: [off.at[0] + islet.x, off.at[1] + islet.z] };
    }
  }
  return null;
}
