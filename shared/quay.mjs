// Where an island's quay is and where its boat lies: the planks its village built, or,
// failing those, a site worked out from the island alone.
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

// Which of the four ways a unit step is, or null for anything else. The yaw literals live
// in SEAWARD and nowhere else, which is what keeps atan2 out of a file under shared/.
function wayOf(d) {
  for (const way of SEAWARD) if (way.d[0] === d[0] && way.d[1] === d[1]) return way;
  return null;
}

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

// The planks a village actually built, out of the village (or the guest bundle) that
// carries them. Null for an island nobody has districts for.
//
// A quay district records its pier in data/layout.json the day it is planned, and that run
// of planks is the island's harbour in every sense that matters: it is where a new settler
// sails in (main.js:sailIn), what the quayside parcel faces, and the only thing on this
// coast that looks like somewhere a boat ties up. quaySite below picks a site off the
// landing instead, which is the right answer for an island nobody has a village for and
// the wrong one the moment there is a quay - it put a second pier on the far side of this
// island, moored the boat at that one, and left the kade a decoration you could not walk
// on. Three commits moved the kade to the sea; this is what makes the move mean something.
// The district with planks, rather than the district called the quay - and that is not
// carelessness, it is the only thing that survives the crossing.
//
// lib/guestview.mjs redacts a bundle by replacing every occurrence of a district's id with
// a placeholder, values and keys alike, deliberately blunt so that no id can slip through
// somewhere it was not expected. The quay district's id is the literal string "quay"
// (lib/layout.mjs), so `kind: "quay"` is rewritten too - it arrives as "p:d0", fails
// islandbundle's slug check and lands as null. Measured on this island: the pier and the
// shore came across intact and the kind did not, so a neighbour's boat was moored at the
// derived quay while their own page had it at the kade.
//
// Only a quay district is ever given a pier, so "has planks" is what the name was standing
// in for anyway. Reading it this way is what makes the answer the same on both sides of
// the channel, which is the whole job of this file.
export function planksOf(village) {
  const list = (village && village.districts) || [];
  for (const d of list) {
    if (d && d.pier && d.pier.length) return { pier: d.pier, shore: d.shore || null };
  }
  return null;
}

// The same shape seawardRun hands back, built out of planks somebody else recorded - and
// trusted only as far as this terrain agrees with them.
//
// What is checked: a straight run along one of the four axes, every cell of it still water,
// and dry land behind the first plank. A layout written before a polder was drained carries
// planks over a field, and a guest bundle arrives from a stranger's socket; either way the
// answer is to fall back to the derivation rather than to moor a boat in a meadow.
//
// `shore` is the cell the ramp stands on. It is recorded alongside the pier, but an old
// layout may not have it, so a run of two or more planks derives it from its own bearing -
// which is exactly what buildPierGeometry does to put the ramp down.
function runFromPlanks(terrain, planks) {
  const cells = planks && planks.pier;
  if (!cells || !cells.length) return null;
  const n = cells.length;
  const dir = n > 1
    ? [Math.sign(cells[n - 1][0] - cells[0][0]), Math.sign(cells[n - 1][1] - cells[0][1])]
    : (planks.shore ? [Math.sign(cells[0][0] - planks.shore[0]), Math.sign(cells[0][1] - planks.shore[1])] : null);
  const way = dir && wayOf(dir);
  if (!way) return null;                                  // a bend, a diagonal, or one plank with no shore
  for (let i = 0; i < n; i++) {
    if (cells[i][0] !== cells[0][0] + way.d[0] * i) return null;
    if (cells[i][1] !== cells[0][1] + way.d[1] * i) return null;
    if (!terrain.isWater(cells[i][0], cells[i][1])) return null;
  }
  const shore = [cells[0][0] - way.d[0], cells[0][1] - way.d[1]];
  if (terrain.isWater(shore[0], shore[1])) return null;   // planks that start in the water lead nowhere
  return { dir: way.d, yaw: way.yaw, cells, shore };
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
// `planks` is what the village built, from planksOf() - the quay district's own pier. It
// wins where it is sound, because a village that has a kade has exactly one quay and it is
// that one. Leaving it out asks for the derived quay, which is all an island known from a
// datagram can offer.
export function quayFor(terrain, landing, planks = null) {
  const built = runFromPlanks(terrain, planks);
  const shore = built ? built.shore : quaySite(terrain, landing);
  if (!shore) return null;
  const run = built || seawardRun(terrain, shore);
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

// Every quay an island has, in its OWN coordinates like quayFor, each with the `side` it
// faces from the town ('n'/'e'/'s'/'w', or null for the one quay of an island that has no
// harbours on record). The harbours are village.island.harbours (lib/layout.mjs
// planHarbours); each goes through quayFor with its own planks, so it is checked against
// this terrain exactly the way the quay always has been - and one whose planks the ground
// no longer agrees with falls back to the derived quay, which is why the list is deduped by
// shore rather than trusted to be distinct. A village with no harbours - an older islander,
// a bundle from before they existed, an island known from a datagram - gets the single
// quay of old, so a world of mixed versions still has somewhere to moor on every island.
export function quaysOf(terrain, village, landing) {
  const harbours = village && village.island && Array.isArray(village.island.harbours) ? village.island.harbours : null;
  const out = [];
  for (const h of harbours || []) {
    if (!h || !Array.isArray(h.pier)) continue;
    const q = quayFor(terrain, landing, { pier: h.pier, shore: h.shore || null });
    if (!q || out.some((o) => o.shore[0] === q.shore[0] && o.shore[1] === q.shore[1])) continue;
    out.push({ ...q, side: typeof h.side === 'string' ? h.side : null });
  }
  if (out.length) return out;
  const one = quayFor(terrain, landing, planksOf(village));
  return one ? [{ ...one, side: null }] : [];
}

// How many boats one harbour can hold: three berths along five planks - either side of the
// head, and one alongside the middle. lib/islandbundle.mjs refuses more, lib/layout.mjs
// builds no more, and this lays out no more; it is the one copy of the number.
export const BOATS_PER_HARBOUR = 3;

// Where the k-th boat of a quay lies, in the quay's own coordinates. Berth 0 is quayFor's
// own berth, so an island that had one boat still has it exactly where it was; 1 is the
// mirror of it across the head; 2 is two planks in from the head on the first side.
function berthOf(q, k) {
  const side = [-q.dir[1], q.dir[0]];   // the side quayFor's berth is on
  if (k === 0) return q.berth;
  if (k === 1) return [q.head[0] - side[0] * 1.3, q.head[1] - side[1] * 1.3];
  return [q.head[0] - q.dir[0] * 2 + side[0] * 1.3, q.head[1] - q.dir[1] * 2 + side[1] * 1.3];
}

// Every boat an island puts in the water, in the world frame - what lib/boats.mjs is
// handed by the sea and what every page puts in the water itself, so that an untouched boat
// lies in the same place on every screen without a message about it.
//
// The island's first boat keeps the id it always had, `boat:<region>`, and the berth it
// always had - berth 0 of the harbour mooringFor would have put it at - because an older
// page finds its boat by exactly that id and an older sea moors exactly that one. It counts
// towards its harbour's three. Every other boat is `boat:<region>-<side><k>`: built by the
// keeper (`harbours[].boats`, lib/layout.mjs), counted rather than listed, so its id and
// berth follow from the harbour alone and need no message either. BOAT_ID in lib/boats.mjs
// allows 32 characters after `boat:`; a 16-character island id and a three-character
// suffix is 19.
export function mooringsFor(regionId, terrain, village, origin = [0, 0]) {
  const landing = village && village.island && village.island.landing;
  if (!landing) return [];
  const legacy = quayFor(terrain, landing, planksOf(village));
  const harbours = (village.island && Array.isArray(village.island.harbours)) ? village.island.harbours : [];
  const out = [];
  let placedLegacy = false;
  for (const q of quaysOf(terrain, village, landing)) {
    const h = harbours.find((x) => x && x.side === q.side) || null;
    const isLegacy = !!legacy && !placedLegacy && legacy.shore[0] === q.shore[0] && legacy.shore[1] === q.shore[1];
    const built = Math.max(0, Math.min(BOATS_PER_HARBOUR, (h && Number.isInteger(h.boats)) ? h.boats : 0));
    const n = Math.min(BOATS_PER_HARBOUR, built + (isLegacy ? 1 : 0));
    for (let k = 0; k < n; k++) {
      const [bx, bz] = berthOf(q, k);
      const id = isLegacy && k === 0 ? `boat:${regionId}` : `boat:${regionId}-${q.side || 'q'}${k}`;
      out.push({ id, x: bx + origin[0], z: bz + origin[1], yaw: q.yaw, side: q.side });
    }
    if (isLegacy) placedLegacy = true;
  }
  // The first boat is never lost: an island whose one quay is not among its harbours (the
  // ground no longer agrees with them, say) still has the boat it always had.
  if (legacy && !placedLegacy) {
    const [bx, bz] = legacy.berth;
    out.unshift({ id: `boat:${regionId}`, x: bx + origin[0], z: bz + origin[1], yaw: legacy.yaw, side: null });
  }
  return out;
}

// What lib/boats.mjs wants: one mooring per island, named after it. The id has to survive
// BOAT_ID over there, and it has to be the same on both sides of the channel - so it is
// built from the region's own id and nothing else.
export function mooringFor(regionId, terrain, landing, origin = [0, 0], planks = null) {
  const quay = quayFor(terrain, landing, planks);
  if (!quay) return null;
  return {
    id: `boat:${regionId}`,
    x: quay.berth[0] + origin[0],
    z: quay.berth[1] + origin[1],
    yaw: quay.yaw,
  };
}
