// The super-lattice, as arithmetic. One lattice for the whole island, anchored one cell
// off the town centre: super-cell (i, j) owns the pitch x pitch ground cells whose min
// corner is `blockOf`, with the 3x3 plot at that corner and the far row and column as
// its lane. lib/layout.mjs decides the lattice; this file only converts along it.
//
// Here rather than in lib/layout.mjs because three files had grown their own copy of
// `blockOf` - the layout, web/js/hamlets.js (`decodeOwnership`) and web/js/history.js -
// and the planner is a fourth reader, on both sides of the wire: the browser turns a
// dragged distance into a super-cell delta with exactly the arithmetic the server then
// turns back into plots. Two copies of that is two truths about where a house stands.
//
// Plain integer arithmetic, so shared/'s rule holds: the same answer in Node and in the
// browser, to the bit.

export const PITCH = 4;          // 3x3 plot + a one cell lane

// The min corner of super-cell (i, j): the cell its plot starts on.
export const blockOf = (lat, i, j) => [lat.anchor[0] + lat.pitch * i, lat.anchor[1] + lat.pitch * j];

// The middle of the plot on super-cell c - the cell a door's facing is measured from.
export const centreOfCell = (lat, c) => [lat.anchor[0] + lat.pitch * c[0] + 1, lat.anchor[1] + lat.pitch * c[1] + 1];

// Which super-cell a ground cell lies in. Floor, not truncation: the lattice runs into
// negative indices west and north of the anchor, and `Math.trunc(-0.25)` is 0 where the
// cell belongs to super-cell -1.
export const superOf = (lat, gx, gz) => [
  Math.floor((gx - lat.anchor[0]) / lat.pitch),
  Math.floor((gz - lat.anchor[1]) / lat.pitch),
];

// All pitch x pitch ground cells of one super-cell, row by row from the min corner.
export function cellsOfSuper(lat, i, j) {
  const [gx, gz] = blockOf(lat, i, j);
  const out = [];
  for (let z = 0; z < lat.pitch; z++) for (let x = 0; x < lat.pitch; x++) out.push([gx + x, gz + z]);
  return out;
}

// Is every cell of super-cell (i, j) inside a size x size grid? A super-cell on the rim
// of the island is only partly there, and nothing that is measured in whole super-cells
// - a parcel, a polder, a zone - may claim one.
export function superComplete(lat, size, i, j) {
  const [gx, gz] = blockOf(lat, i, j);
  return gx >= 0 && gz >= 0 && gx + lat.pitch <= size && gz + lat.pitch <= size;
}

// The super-cell radius a size x size grid needs to cover every cell, whichever way the
// anchor sits: the same number lib/layout.mjs's `Super` sizes its arrays by.
export const superRadius = (size, pitch = PITCH) => Math.ceil(size / pitch) + 1;
