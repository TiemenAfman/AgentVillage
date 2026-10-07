// Signs are scenery, not saved plots, so where one stands is worked out again from the roads
// on every rebuild. A hamlet's name stands over the road where it crosses the edge of that
// land: a gateway whose two posts are the cells either side of the road, so you read the name
// walking through it. That is only possible where the road runs straight through the cell and
// the cells beside it are free - at a bend or a junction a post lands on the next lane, which
// is what the first version did and why it was once moved off the road altogether. So the
// search walks the road a few cells either way from the entrance for a straight stretch. A road
// with none - one squeezed between rows of houses, say - gets no sign at all: a gateway
// standing in the grass beside a road reads as a mistake, and the planner shows the entrance
// anyway (plan-overlay.js `setGates`).
//
// "The road" is the paving, not one path's list of cells: a path records only the cells it
// paved itself (a road that joins another stops there), so two consecutive cells of one path
// can lie a street apart.
import { entrancesOf, maxEntrances, ENTRANCE_STEPS } from 'shared/entrances.mjs';

export function hamletSignSites(village, terrain, bridges = []) {
  const occupied = new Set();
  const ground = new Set();       // every cell of paving, whichever path it belongs to
  const special = new Set();      // town paving, quay planks: ground the sign must not stand on
  const plots = new Set();        // cells of a house's lot: `occupied`, but the one thing a post may squeeze onto
  const mark = (cells) => { for (const [x, z] of cells || []) occupied.add(`${x},${z}`); };
  const pave = (cells) => { mark(cells); for (const [x, z] of cells || []) ground.add(`${x},${z}`); };
  const markSpecial = (cells) => { pave(cells); for (const [x, z] of cells || []) special.add(`${x},${z}`); };
  for (const path of village.paths || []) pave(path.cells);
  markSpecial(village.island?.town?.paved);
  pave(bridges);               // a bridge somebody built, and its banks: the road goes over it
  for (const d of village.districts || []) {
    markSpecial(d.deck); markSpecial(d.pier); pave(d.paved);
    for (const lobe of d.lobes || []) pave(lobe.paved);
  }
  for (const b of village.buildings || []) {
    const p = b.plot;
    if (!p) continue;
    for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) { mark([[p.gx + x, p.gz + z]]); plots.add(`${p.gx + x},${p.gz + z}`); }
  }

  const inside = (x, z) => x >= 0 && z >= 0 && x < terrain.size && z < terrain.size;
  // The lettered face points along local +Z. `dx`/`dz` is the way out of the hamlet, so the
  // front looks at whoever is coming in and the back at whoever is leaving.
  const turnOf = (along, dx, dz) => (along
    ? (dx > 0 ? Math.PI / 2 : -Math.PI / 2)
    : (dz > 0 ? 0 : Math.PI));
  const flat = (cells) => {
    const heights = cells.map(([x, z]) => terrain.worldHeight(...terrain.cellWorld(x, z)));
    return Math.max(...heights) - Math.min(...heights) <= 0.25;
  };

  // The gateway stands exactly on the boundary fence (hamlets.js): the fence runs along the edge
  // between the last cell on the hamlet's land and the first one off it, and opens there for the
  // road, so the arch goes in that opening, in the fence's own line, its posts where the fence
  // is. That is half a cell out from the cell the road leaves the land at (`fx`/`fz`).
  // A gate that cannot stand on that line for want of room falls back to a cell of the road one
  // step out or up to three in - never further out, or the sign stands in the fields after a
  // junction instead of at the way in (AgentVillage's north track, two cells out, read as a
  // gateway in the grass).
  // The first candidate wants the cells beside the road free. The second is the same place, but
  // lets a post stand on the edge of a house's lot: where the road runs between two lots the
  // gateway is a hand wider than the gap and there is nothing else to be done for it. Never
  // onto paving, a deck or another sign - only ever onto a lot that is not paved.
  const CANDIDATES = [
    { t: 0.5, allowLot: false },
    { t: 0.5, allowLot: true },
    ...[-1, -2, -3, 0, 1].map((t) => ({ t, allowLot: false })),
    { t: 0, allowLot: true },
    { t: 1, allowLot: true },
  ];
  const overTheRoad = (gate) => {
    const dx = gate.next[0] - gate.at[0], dz = gate.next[1] - gate.at[1];
    if (Math.abs(dx) + Math.abs(dz) !== 1) return null;
    const along = dx !== 0;
    for (const { t, allowLot } of CANDIDATES) {
      // The row of cells the posts stand beside: for the fence line it is the last one on the
      // land, and the cell beyond it is only asked to be road (it may be a street across).
      const rows = [t === 0.5 ? 0 : t];
      const cell = (o, n = 0) => [gate.at[0] + o * dx + (along ? 0 : n), gate.at[1] + o * dz + (along ? n : 0)];
      // Paving straight through, one cell either way along the road.
      const run = [rows[0] - 1, ...rows, rows[0] + 1];
      // A gate the keeper set is where the road will be laid (`road:gate:*`): it is not paving yet, or not
      // straight through the cell, and the sign goes there all the same.
      if (!gate.fixed && !run.every((o) => ground.has(cell(o).join()))) continue;
      if (rows.some((o) => special.has(cell(o).join()))) continue;
      const beam = rows.flatMap((o) => [-1, 0, 1].map((n) => cell(o, n)));
      const sides = rows.flatMap((o) => [cell(o, -1), cell(o, 1)]);
      if (beam.some(([x, z]) => !inside(x, z) || !terrain.isLand(x, z))) continue;
      const taken = ([x, z]) => {
        const k = `${x},${z}`;
        return occupied.has(k) && !(allowLot && plots.has(k) && !ground.has(k));
      };
      if (sides.some(taken) || !flat(beam)) continue;
      mark(sides);
      const [gx, gz] = cell(t === 0.5 ? 0 : t);
      return { gx, gz, fx: t === 0.5 ? dx / 2 : 0, fz: t === 0.5 ? dz / 2 : 0, along, turn: turnOf(along, dx, dz), over: true };
    }
    return null;
  };

  return (gate) => (gate ? overTheRoad(gate) : null);
}

// A hamlet's entrances, as the page has them to hand. The sum itself is shared/entrances.mjs (the
// server checks the entrances the keeper sets with the same one): this only turns a village's
// parcel rows into the super-cells it wants, and reads the hamlet's stored gates.
//
// `bridges` are the cells of the bridges the keeper has built by hand (props, not part of the
// layout's paths): a road that crosses a river on one enters the hamlet like any other.
export { maxEntrances, ENTRANCE_STEPS };
export function hamletEntrances(village, d, bridges = []) {
  const lat = village.island && village.island.lattice;
  if (!lat || !d) return [];
  const supers = [];
  for (const lobe of d.lobes || []) {
    const p = lobe.parcel;
    if (!p) continue;
    for (let r = 0; r < p.h; r++) for (let c = 0; c < p.w; c++) if ((p.rows[r] || '')[c] === '1') supers.push([p.i0 + c, p.j0 + r]);
  }
  return entrancesOf({
    lat, supers, population: d.population, id: d.id, paths: village.paths || [],
    townPaved: village.island && village.island.town && village.island.town.paved,
    bridges, gates: village.gates && village.gates[d.id],
  });
}
