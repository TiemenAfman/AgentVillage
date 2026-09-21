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
