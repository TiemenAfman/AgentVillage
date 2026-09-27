// The streets a settler may walk, read straight out of a village.
//
// Both of these were one-line readers living in browser files - roadCells in
// web/js/main.js and squareCells in web/js/world.js - and neither ever needed a renderer.
// They are here because the walk moved to Node and has to be able to ask the same
// question of the same village and get the same answer, byte for byte. Everything they
// read is produced by lib/layout.mjs and travels in village.json and in an island bundle,
// so there is nothing to derive and nothing to send.
//
// Plain arithmetic and array walking, so shared/'s rule holds without effort.

// Every road a settler may walk: the lanes, the bridges, and the quay's boardwalk.
//
// A bridge carries no road surface of its own - it is a deck over water, not a paved cell -
// so leaving it out puts a hole in the graph at every crossing, and the hamlet on the far
// bank becomes unreachable on foot while looking perfectly connected.
//
// The quay's deck is the same case pointed at a whole district. Most of it IS in `paths`
// already - the boardwalk is laid over the street plan - but the doorsteps and the walk
// out to the pier are not, and those are exactly the cells a settler needs to get off
// their own front deck. Without them the quay is a street plan with the ground cut away
// from under it: the boardwalk is drawn, and nobody can reach the far end of it.
export function roadCells(village) {
  const deck = [];
  for (const d of (village && village.districts) || []) {
    if (d && d.deck && d.deck.length) deck.push({ id: `deck:${d.id}`, cells: d.deck });
  }
  return [...((village && village.paths) || []), ...((village && village.bridges) || []), ...deck];
}

// The paving that counts as a square: the town's own, and every district's green. Kept
// apart from the general road network because the Friday gathering needs somewhere
// specific to aim for rather than "some road cell".
export function squareCells(village) {
  const out = [];
  const town = village && village.island && village.island.town;
  if (town && town.paved) {
    out.push(...town.paved);
  } else if (town && town.square) {
    // An older village records a corner and a size rather than the cells themselves.
    const n = town.size || 3;
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) out.push([town.square[0] + x, town.square[1] + z]);
  }
  for (const d of (village && village.districts) || []) for (const c of d.paved || []) out.push(c);
  return out;
}

// The paving the Friday gathering aims for: every square cell but the town's shopping
// streets (Plans/knus-dorpscentrum.md). The streets are paved into `town.paved` so that
// everything that walks or draws the square has them for free, and `town.streets` names
// them again for this one reader - a borrel belongs on the square, and with the streets in
// the draw half the village would stand about in the high street instead. A village from
// before the streets has none, and gets every square cell, as it always did.
export function gatherCells(village) {
  const town = village && village.island && village.island.town;
  const streets = new Set(((town && town.streets) || []).map(([gx, gz]) => `${gx},${gz}`));
  const all = squareCells(village);
  return streets.size ? all.filter(([gx, gz]) => !streets.has(`${gx},${gz}`)) : all;
}

// How far from a road a door may stand and still count as connected to it - the search
// shape shared/settlerwalk.mjs's gateOf uses (every direction, nearest cell wins). Exported
// so both keep one number: a door found reachable here and not there, or the other way
// round, is a settler stranded outside a house that draws as perfectly connected.
export const GATE_REACH = 3;

function walkableCells(village, size) {
  const cells = new Set();
  const inside = (gx, gz) => gx >= 0 && gz >= 0 && gx < size && gz < size;
  for (const p of roadCells(village)) for (const [gx, gz] of p.cells || []) if (inside(gx, gz)) cells.add(gx + gz * size);
  for (const [gx, gz] of squareCells(village)) if (inside(gx, gz)) cells.add(gx + gz * size);
  return cells;
}

// Every walkable cell reachable from the town square without leaving the road network -
// flood fill over exactly the graph shared/settlerwalk.mjs's setRoads would build a settler
// (lib/crowd.mjs is its only caller, and hands it these same two functions), seeded from
// the same square cells a Friday borrel gathers at. A debug check built on anything else
// could disagree with whether a settler could actually walk there.
export function reachableFromSquare(village, size) {
  const cells = walkableCells(village, size);
  const seen = new Set();
  const queue = [];
  const push = (gx, gz) => {
    if (gx < 0 || gz < 0 || gx >= size || gz >= size) return;
    const k = gx + gz * size;
    if (!cells.has(k) || seen.has(k)) return;
    seen.add(k);
    queue.push(k);
  };
  for (const [gx, gz] of squareCells(village)) push(gx, gz);
  for (let i = 0; i < queue.length; i++) {
    const k = queue[i];
    const gx = k % size, gz = (k - gx) / size;
    push(gx + 1, gz); push(gx - 1, gz); push(gx, gz + 1); push(gx, gz - 1);
  }
  return seen;
}

// The road cell a door would step out onto, or null if none is within GATE_REACH - the same
// answer shared/settlerwalk.mjs's gateOf gives a settler standing at that door, so a house
// this calls disconnected is a house nobody living in it could walk out of either.
export function houseGate(village, size, door) {
  if (!door) return null;
  const cells = walkableCells(village, size);
  const [hx, hz] = door;
  let best = null, bd = Infinity;
  for (let dz = -GATE_REACH; dz <= GATE_REACH; dz++) {
    for (let dx = -GATE_REACH; dx <= GATE_REACH; dx++) {
      const gx = hx + dx, gz = hz + dz;
      if (gx < 0 || gz < 0 || gx >= size || gz >= size) continue;
      const k = gx + gz * size;
      if (!cells.has(k)) continue;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = k; }
    }
  }
  return best;
}
