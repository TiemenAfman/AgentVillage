// Where the ways into a hamlet are. Node and browser both: the page stands a gateway over each
// of them (web/js/hamlet-sign-placement.js), the planner draws them (plan-overlay.js), and the
// server checks the ones the keeper sets (`opGate` in lib/plan.mjs) with this same sum - one
// copy, or the page and the server would disagree about which side a cell is on.
//
// Plans/DONE/ingangen-en-bruggen.md and Plans/DONE/ingangen-verplaatsen.md say why.
//
// An entrance is derived from the roads and never stored - except the ones the keeper sets by
// hand (`layout.gates`), which win. Derived: where the road network crosses the edge of the
// hamlet's land - two paved cells side by side, one on the land and one off it - one per side
// of the compass (N, E, S, W), and at most as many as the hamlet's size allows. A crossing is
// never two consecutive cells of one path: a path records only what it paved itself, so two
// consecutive cells can lie a street apart.
//
// Everything is in grid cells (`gx`, `gz`); a hamlet's land is a list of super-cells `[i, j]`
// on the island's lattice, as `layout.districts[id].lobes[].cells` has it.

export const SIDES = ['n', 'e', 's', 'w'];
export const SIDE_WORD = { n: 'North', e: 'East', s: 'South', w: 'West' };
// The step out of the land on each side; north is -z, as everywhere on the island.
export const OUT = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Settlers above which another side may open: a hamlet of a few has the one way in, a village
// up to four.
export const ENTRANCE_STEPS = [5, 14, 39];
export const maxEntrances = (population) => 1 + ENTRANCE_STEPS.filter((n) => (population || 0) > n).length;

// A hamlet's land as a question: is this cell on it, and which side of its middle is a cell on.
// The middle is the mean of its super-cells, which is not the hamlet's green.
export function landOf(lat, supers) {
  const own = new Set();
  let sx = 0, sz = 0;
  for (const [i, j] of supers) {
    own.add(`${i},${j}`);
    sx += lat.anchor[0] + i * lat.pitch + lat.pitch / 2;
    sz += lat.anchor[1] + j * lat.pitch + lat.pitch / 2;
  }
  if (!own.size) return null;
  const cx = sx / own.size, cz = sz / own.size;
  const mine = (gx, gz) => own.has(
    `${Math.floor((gx - lat.anchor[0]) / lat.pitch)},${Math.floor((gz - lat.anchor[1]) / lat.pitch)}`);
  const sideOf = (gx, gz) => {
    const dx = gx - cx, dz = gz - cz;
    return Math.abs(dx) >= Math.abs(dz) ? (dx >= 0 ? 'e' : 'w') : (dz >= 0 ? 's' : 'n');
  };
  // How far a cell is from the line through the middle on its side: the crossing nearest it wins.
  const offset = (side, gx, gz) => (side === 'e' || side === 'w' ? Math.abs(gz - cz) : Math.abs(gx - cx));
  return { mine, sideOf, offset, cx, cz };
}

// The cell just off the land beside `at`, on the way out: the side's own direction if that is
// off the land, else the first neighbour that is. Null for a cell that is not on the edge.
export function outwardOf(land, at, side) {
  const [px, pz] = OUT[side] || [0, 0];
  const tries = [[px, pz], ...N4.filter(([dx, dz]) => dx !== px || dz !== pz)];
  for (const [dx, dz] of tries) {
    if (!dx && !dz) continue;
    if (!land.mine(at[0] + dx, at[1] + dz)) return [at[0] + dx, at[1] + dz];
  }
  return null;
}

// The entrances of one hamlet, sorted N, E, S, W:
//   { side, at, next, label, back, fixed }
// `at` is the cell on the land, `next` the one outside it; `fixed` an entrance the keeper set.
// With two or more each carries `label` ("South entrance", the front of the board, seen from
// outside) and `back` ("South exit", the side seen from within); a lone entrance needs neither.
//
//   supers      the hamlet's land, [[i, j], ...]
//   paths       every path there is, [{ id, cells }]; a road is a road, whoever laid it and whatever it
//               leads to - but not a house's own front path, which touches the fence wherever
//               a house stands by it (a road is `road:*` or `path:civic:*`)
//   townPaved   the town's own streets
//   bridges     the road cells of bridges built by hand (props, not in `paths`), banks included
//   gates       `layout.gates[id]`: { n|e|s|w: { at } | { closed: true } }
export function entrancesOf({ lat, supers, population = 0, id = '', paths = [], townPaved = [], bridges = [], gates = null }) {
  if (!lat) return [];
  const land = landOf(lat, supers || []);
  if (!land) return [];
  const { mine } = land;

  const closed = new Set();
  const fixed = new Map();
  for (const side of SIDES) {
    const g = gates && gates[side];
    if (!g) continue;
    if (g.closed) { closed.add(side); continue; }
    if (!Array.isArray(g.at) || !mine(g.at[0], g.at[1])) continue;        // not on the land any more
    const next = outwardOf(land, g.at, side);
    if (!next) continue;                                                   // and not on the edge
    fixed.set(side, { side, at: [g.at[0], g.at[1]], next, own: true, bridge: false, perp: 0, fixed: true });
  }

  // The road network: `roads` maps a cell to whether it is one of this hamlet's own roads.
  const roads = new Map();
  const ownRoad = `road:${id}:`;
  const put = (cells, isOwn) => {
    for (const [x, z] of cells || []) {
      const k = `${x},${z}`;
      roads.set(k, roads.get(k) || isOwn);
    }
  };
  for (const path of paths) {
    const pid = String(path.id);
    if (!pid.startsWith('road:') && !pid.startsWith('path:civic:')) continue;
    put(path.cells, pid.startsWith(ownRoad));
  }
  put(townPaved, false);
  put(bridges, false);
  const bridgeKeys = new Set(bridges.map(([x, z]) => `${x},${z}`));

  // Within a side the hamlet's own road wins, then a bridge somebody built on purpose, then the
  // crossing nearest the middle of it.
  const better = (x, y) => (x.own === y.own ? 0 : x.own ? -1 : 1) || (x.bridge === y.bridge ? 0 : x.bridge ? -1 : 1)
    || x.perp - y.perp || x.at[1] - y.at[1] || x.at[0] - y.at[0];
  const best = new Map();
  for (const [key, isOwn] of roads) {
    const [gx, gz] = key.split(',').map(Number);
    if (!mine(gx, gz)) continue;
    for (const [dx, dz] of N4) {
      const nx = gx + dx, nz = gz + dz;
      if (!roads.has(`${nx},${nz}`) || mine(nx, nz)) continue;
      const side = land.sideOf(gx, gz);
      if (closed.has(side) || fixed.has(side)) continue;
      const e = {
        side, at: [gx, gz], next: [nx, nz], own: isOwn, fixed: false,
        bridge: bridgeKeys.has(key) || bridgeKeys.has(`${nx},${nz}`), perp: land.offset(side, gx, gz),
      };
      if (!best.has(side) || better(e, best.get(side)) < 0) best.set(side, e);
    }
  }
  for (const [side, e] of fixed) best.set(side, e);

  // More sides than the size allows: the keeper's first, then the hamlet's own road, then a bridge,
  // then the most central.
  const ranked = [...best.values()].sort((x, y) => (x.fixed === y.fixed ? 0 : x.fixed ? -1 : 1)
    || (x.own === y.own ? 0 : x.own ? -1 : 1) || (x.bridge === y.bridge ? 0 : x.bridge ? -1 : 1)
    || x.perp - y.perp || SIDES.indexOf(x.side) - SIDES.indexOf(y.side));
  const kept = ranked.slice(0, maxEntrances(population)).sort((x, y) => SIDES.indexOf(x.side) - SIDES.indexOf(y.side));
  return kept.map((e) => ({
    side: e.side, at: e.at, next: e.next, fixed: e.fixed,
    label: kept.length > 1 ? `${SIDE_WORD[e.side]} entrance` : null,
    back: kept.length > 1 ? `${SIDE_WORD[e.side]} exit` : null,
  }));
}
