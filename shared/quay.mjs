// Where an island's boat lies, worked out from the island alone.
//
// This exists because three callers need the same answer and have to agree about it
// without talking: web/js/main.js draws the quay and puts the hull in the water,
// serve.mjs hands lib/boats.mjs the moorings it starts from, and the browser on the other
// side of the channel has to find an untouched boat in the same place as everybody else.
// A message saying where the boat is would do for two of them and not for the third, which
// is the whole argument for deriving it instead - the same argument lib/neighbours.mjs
// makes about drawing a neighbour's coast from four numbers in a datagram.
//
// It lives in shared/ and obeys shared/'s rule (see the top of rng.mjs): plain arithmetic,
// no transcendental functions. The one place that would have wanted `atan2` is the bow's
// heading, and there are exactly four of those, so they are written out as literals the way
// terrain.mjs writes out DIRS16 for the same reason.

// The four ways water can lie off a coast cell, and the heading that points along each.
// yaw is the island's own convention (walk.js:615-617): forward is (sin yaw, cos yaw), so
// +z is 0, +x is a quarter turn, -z is a half and -x is three quarters.
const SEAWARD = [
  { d: [1, 0], yaw: 1.5707963267948966 },    // east
  { d: [-1, 0], yaw: -1.5707963267948966 },  // west
  { d: [0, 1], yaw: 0 },                     // south
  { d: [0, -1], yaw: 3.141592653589793 },    // north
];

// How far out a run of planks may reach, and how deep the water has to stay to be worth
// walking over. Both are lib/layout.mjs's numbers - pierCells at :1942 and
// seawardDirection at :1931 - because the quay a district earns and the quay every island
// has are the same planks and must not come out different lengths.
export const QUAY_REACH = 5;
const PROBE = 6;

// Which way the open water lies off `shore`, and the run of water cells out into it.
// Null where there is no water worth a plank - a cell in a one-wide inlet, or a shore cell
// that turned out to be inland after a polder was drained.
export function seawardRun(terrain, shore) {
  let best = null, reach = 0;
  for (const way of SEAWARD) {
    let n = 0;
    for (let i = 1; i <= PROBE; i++) {
      if (!terrain.isWater(shore[0] + way.d[0] * i, shore[1] + way.d[1] * i)) break;
      n++;
    }
    if (n > reach) { reach = n; best = way; }
  }
  if (!best) return null;
  const cells = [];
  for (let i = 1; i <= QUAY_REACH; i++) {
    const c = [shore[0] + best.d[0] * i, shore[1] + best.d[1] * i];
    if (!terrain.isWater(c[0], c[1])) break;
    cells.push(c);
  }
  return cells.length ? { dir: best.d, yaw: best.yaw, cells } : null;
}

// Where the planks actually start. `landing` is the obvious answer and on a small island
// it is the right one - but it is not a coast cell. lib/layout.mjs:1469-1471 picks it as
// the BEACH cell nearest the town centre, and a beach cell is only land below BEACH_MAX;
// on a 64-grid the two coincide, and on a 256-grid the island is big enough to have wide
// low flats well inland. This island's landing came out at [199,156] with no water within
// six cells in any direction, and the quay silently did not get built.
//
// So the landing is a preference and not a promise: if it has open water off it, the quay
// goes there, and otherwise it goes to the nearest coast cell that does. Deterministic
// either way - coastCells is built in a fixed order by shared/terrain.mjs and ties fall to
// whichever comes first - so all three sides still arrive at the same answer without a word
// between them.
export function quaySite(terrain, landing) {
  if (landing && seawardRun(terrain, landing)) return landing;
  const coast = terrain.coastCells || [];
  const to = landing || [terrain.half, terrain.half];
  let best = null, bestD = Infinity;
  for (const c of coast) {
    const dx = c[0] - to[0], dz = c[1] - to[1];
    const d = dx * dx + dz * dz;          // squared, so no square root and no ties on rounding
    if (d >= bestD) continue;
    if (!seawardRun(terrain, c)) continue;
    bestD = d;
    best = c;
  }
  return best;
}

// The whole quay, in the island's OWN coordinates. A caller drawing it inside an offset
// group wants exactly these; a caller speaking world coordinates - walk mode, the boat,
// lib/boats.mjs - has to add the region's origin. Getting that the wrong way round is
// invisible on an island at the origin and puts a guest island's quay a hundred units out
// to sea, so the two are named apart: `local` here, and nothing called `world`.
//
// `landing` is where a settler already walks ashore, and every island has one from its seed
// alone whether or not it ever earned a quay district - but see quaySite above: it is a
// beach cell rather than a coast cell, so it is where the quay would like to be and not
// where it necessarily can be.
export function quayFor(terrain, landing) {
  const shore = quaySite(terrain, landing);
  if (!shore) return null;
  const run = seawardRun(terrain, shore);
  if (!run) return null;
  const from = terrain.cellWorld(shore[0], shore[1]);
  const head = terrain.cellWorld(
    run.cells[run.cells.length - 1][0],
    run.cells[run.cells.length - 1][1],
  );
  return {
    shore,
    cells: run.cells,
    dir: run.dir,
    // Bow pointing out along the run, which is the way you leave.
    yaw: run.yaw,
    // Where the planks are drawn from: the shore cell they start at.
    from,
    head,
    // Alongside the head rather than on it, so the hull is beside the planks and not
    // standing on them. Either side is water, or the head would not be there.
    berth: [head[0] - run.dir[1] * 1.3, head[1] + run.dir[0] * 1.3],
  };
}

// What lib/boats.mjs wants: one mooring per island, named after it. The id has to survive
// BOAT_ID over there, and it has to be the same on both sides of the channel - so it is
// built from the region's own id and nothing else.
export function mooringFor(regionId, terrain, landing, origin = [0, 0]) {
  const quay = quayFor(terrain, landing);
  if (!quay) return null;
  return {
    id: `boat:${regionId}`,
    x: quay.berth[0] + origin[0],
    z: quay.berth[1] + origin[1],
    yaw: quay.yaw,
  };
}
