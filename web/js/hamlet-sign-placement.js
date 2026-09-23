// Signs are scenery, not saved plots. Recheck their whole footprint when roads grow:
// moving only the centre off a lane can still leave a post on the next lane at a bend.
export function hamletSignSites(village, terrain) {
  const occupied = new Set();
  const mark = (cells) => { for (const [x, z] of cells || []) occupied.add(`${x},${z}`); };
  for (const path of village.paths || []) mark(path.cells);
  mark(village.island?.town?.paved);
  for (const d of village.districts || []) {
    mark(d.deck); mark(d.pier); mark(d.paved);
    for (const lobe of d.lobes || []) mark(lobe.paved);
  }
  for (const b of village.buildings || []) {
    const p = b.plot;
    if (!p) continue;
    for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) mark([[p.gx + x, p.gz + z]]);
  }

  return (gate) => {
    if (!gate) return null;
    const along = Math.abs(gate.next[0] - gate.at[0]) > Math.abs(gate.next[1] - gate.at[1]);
    // The lettered face points along local +Z. The gate's next cell is outside
    // the district, so preserve the direction as well as the road's axis.
    const turn = along
      ? (gate.next[0] > gate.at[0] ? Math.PI / 2 : -Math.PI / 2)
      : (gate.next[1] > gate.at[1] ? 0 : Math.PI);
    const candidates = [];
    for (let offset = 2; offset <= 6; offset++) for (const side of [-1, 1]) {
      for (let step = -3; step <= 3; step++) {
        const gx = gate.at[0] + (along ? step : side * offset);
        const gz = gate.at[1] + (along ? side * offset : step);
        candidates.push({ gx, gz, score: offset * offset + step * step });
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    for (const { gx, gz } of candidates) {
      // The 2.42-unit beam fits inside three cells; reserve those cells with a
      // little room around the posts, including against a previously placed sign.
      const cells = [-1, 0, 1].map((n) => [gx + (along ? 0 : n), gz + (along ? n : 0)]);
      if (cells.some(([x, z]) => x < 0 || z < 0 || x >= terrain.size || z >= terrain.size
        || occupied.has(`${x},${z}`) || !terrain.isLand(x, z))) continue;
      const heights = cells.map(([x, z]) => terrain.worldHeight(...terrain.cellWorld(x, z)));
      if (Math.max(...heights) - Math.min(...heights) > 0.25) continue;
      mark(cells);
      return { gx, gz, along, turn };
    }
    // A missing sign is preferable to putting its posts back onto the road.
    return null;
  };
}
