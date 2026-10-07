// The dredger's cell-by-cell route contains stair steps and a sharp join at the mouth.
// Buoy bearings need a stretch of that route, not the last grid step: offsetting each
// tiny corner folds the inside row back onto itself. None of this changes the channel.
export function placeBuoys(terrain) {
  const points = [];
  const distances = [];
  let length = 0;
  for (const cell of terrain.fairway?.line || []) {
    const p = terrain.cellWorld(...cell);
    const prev = points.at(-1);
    const step = prev ? Math.hypot(p[0] - prev[0], p[1] - prev[1]) : 0;
    if (prev && step < 1e-6) continue;
    length += step;
    points.push(p);
    distances.push(length);
  }
  if (points.length < 2) return [];
  const at = (s) => {
    s = Math.max(0, Math.min(length, s));
    let i = 1;
    while (i < distances.length - 1 && distances[i] < s) i++;
    const t = (s - distances[i - 1]) / (distances[i] - distances[i - 1]);
    return points[i - 1].map((v, axis) => v + (points[i][axis] - v) * t);
  };
  const smooth = (s) => {
    const reach = Math.min(1.5, s, length - s);
    const a = at(s - reach), b = at(s), c = at(s + reach);
    return b.map((v, axis) => (a[axis] + 2 * v + c[axis]) / 4);
  };
  const result = [];
  // Arc length keeps a diagonal approach as densely marked as the river itself.
  for (let s = 0; s <= length; s += 3.5) {
    const [cx, cz] = smooth(s);
    const a = smooth(Math.max(0, s - 2)), b = smooth(Math.min(length, s + 2));
    const dx = b[0] - a[0], dz = b[1] - a[1], span = Math.hypot(dx, dz);
    if (span < 1e-6) continue;
    for (const side of [-1, 1]) {
      for (let offset = 2; offset >= 1.2 - 1e-6; offset -= .2) {
        const x = cx - dz / span * side * offset;
        const z = cz + dx / span * side * offset;
        // Check the float's full footprint, not just its centre on the wet/dry edge.
        const wet = [[0, 0], [.3, 0], [-.3, 0], [0, .3], [0, -.3], [.22, .22], [.22, -.22], [-.22, .22], [-.22, -.22]];
        if (!wet.every(([ox, oz]) => terrain.worldHeight(x + ox, z + oz) < -.09)) continue;
        // Inner bends have less bank length. Omit a crowded mark rather than filling
        // the navigable lane with a cluster or pushing its neighbour towards shore.
        if (result.some((p) => Math.hypot(p.x - x, p.z - z) < (p.side === side ? 2.6 : 1.8))) continue;
        result.push({ x, z, side });
        break;
      }
    }
  }
  return result;
}
