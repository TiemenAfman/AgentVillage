// The Salty Kraken's door and its gangway, the one copy the layout and every page work out
// (Plans/kraken-op-zee.md). Plain whole-number arithmetic on grid cells: nothing here may differ
// between Node and a browser.
//
// The door is the foot of the zigzag stair up its rock, the baked `anchor.door` of
// assets/piratetavern (scripts/build-piratetavern.py, [2.4, 2.43] in the model's frame), on the
// lot's front edge - its z is PUB_LOT.d / 2 in lib/layout.mjs. Not the middle of the front: the rock
// stands there, and the stair comes down beside it. The E at the top of the stair is the page's
// (main.js, the stoop), and needs no cell.
export const PUB_GATE = [2.4, 3];

// A gangway runs at most this many cells of water from the stair's step to the first land
// (lib/layout.mjs `pirateTavernSeaSite` asks no more of a site), so a page never walks further
// than that looking for it.
export const PUB_PIER_MAX = 12;

// The quarter turn the page gives a lot at each `rot` (web/js/shipyard.js `turnLocal`, makeRecord's
// yaw), as lib/layout.mjs `lotGate` reads it: a point `[x, z]` of the model to the grid.
const QUARTERS = [(x, z) => [-x, -z], (x, z) => [z, -x], (x, z) => [x, z], (x, z) => [-z, x]];

// `{ door, step }`: the lot's cell inside the gate and the one outside it, for a plot
// `{ gx, gz, w, d, rot }` on PUB_LOT.
export function pubGate(p) {
  const at = (x, z) => {
    const [dx, dz] = QUARTERS[((p.rot % 4) + 4) % 4](x, z);
    return [Math.floor(p.gx + p.w / 2 + dx), Math.floor(p.gz + p.d / 2 + dz)];
  };
  const [x, z] = PUB_GATE;
  return { door: at(x, z - 0.5), step: at(x, z + 0.5) };
}

// The gangway of a Kraken standing in the sea: from the stair's step straight on, the way the lot
// looks, over every cell `wet(gx, gz)` says is water, to the first one that is not -
// `{ cells, shore, dir }`, the cells in the order a body walks them from the stair, `shore` the land
// it comes ashore on. Null for a pub whose step is land (on the beach, where there is no gangway)
// and for one with no land within `max`.
export function pubGangway(p, wet, max = PUB_PIER_MAX) {
  if (!p) return null;
  const { door, step } = pubGate(p);
  const dir = [step[0] - door[0], step[1] - door[1]];
  const cells = [];
  let c = step;
  while (wet(c[0], c[1])) {
    if (cells.length >= max) return null;
    cells.push(c);
    c = [c[0] + dir[0], c[1] + dir[1]];
  }
  return cells.length ? { cells, shore: c, dir } : null;
}
