// Water as connected bodies, for the tests and tools that ask "does this water still reach
// the sea?" (Plans/quay-en-rivier.md). Pure: it reads a terrain through `size` and
// `isWater(gx, gz)` and nothing else - no fs, no lib/paths.mjs - so a test can hand it a
// fake terrain as easily as a real one.
//
// A cell is `[gx, gz]`, grid indices as everywhere in layout.json (layout.fairway.cells,
// polders' cells): `terrain.isWater(gx, gz)` is the average of the cell's four corners
// under SEA_LEVEL, and `isWater` calls anything outside the grid water. Bodies are found
// over 4-neighbours, because a diagonal step is not a channel a boat or a river can use.
// A body is `open` when it touches the rim of the grid: that is where the sea goes on
// past what the terrain draws, so it is the only kind of water that is joined to the sea.

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// One label per cell: -1 for land, else the index of its body in the array `bodies` that
// the same pass builds. Both live here so `waterBodies` and `fairwayOpen` read one flood.
export function labelWater(terrain) {
  const size = terrain.size;
  const label = new Int32Array(size * size).fill(-1);
  const bodies = [];
  const queue = new Int32Array(size * size);
  for (let z0 = 0; z0 < size; z0++) {
    for (let x0 = 0; x0 < size; x0++) {
      if (label[x0 + z0 * size] !== -1 || !terrain.isWater(x0, z0)) continue;
      const id = bodies.length;
      const body = { size: 0, cells: [], open: false, bbox: { x0, z0, x1: x0, z1: z0 } };
      let head = 0, tail = 0;
      queue[tail++] = x0 + z0 * size;
      label[x0 + z0 * size] = id;
      while (head < tail) {
        const k = queue[head++];
        const x = k % size, z = (k - x) / size;
        body.cells.push([x, z]);
        if (x === 0 || z === 0 || x === size - 1 || z === size - 1) body.open = true;
        const b = body.bbox;
        if (x < b.x0) b.x0 = x;
        if (x > b.x1) b.x1 = x;
        if (z < b.z0) b.z0 = z;
        if (z > b.z1) b.z1 = z;
        for (const [dx, dz] of N4) {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
          const nk = nx + nz * size;
          if (label[nk] !== -1 || !terrain.isWater(nx, nz)) continue;
          label[nk] = id;
          queue[tail++] = nk;
        }
      }
      body.size = body.cells.length;
      bodies.push(body);
    }
  }
  return { label, bodies };
}

// Every body of water: `{ size, cells: [[gx, gz], ...], open, bbox: { x0, z0, x1, z1 } }`
// (bbox inclusive, in grid indices), in the order the scan meets them (rows from z = 0).
export function waterBodies(terrain) {
  return labelWater(terrain).bodies;
}

// Bodies with no way to the rim: lakes, ring ponds a growth step shut in, a channel cut off.
// The founding island's own lake counts too - compare against a baseline, not against zero.
export function pondCount(terrain) {
  return waterBodies(terrain).filter((b) => !b.open).length;
}

// How many cells lie in those bodies, all together.
export function enclosedCells(terrain) {
  return waterBodies(terrain).reduce((n, b) => n + (b.open ? 0 : b.size), 0);
}

// True when at least one cell of the dredged channel (`layout.fairway.cells`, same grid
// indices `makeTerrain` digs) lies in water that reaches the open sea. A fairway whose
// every cell is landlocked, dry, missing or empty is not open.
export function fairwayOpen(terrain, fairway) {
  const cells = (fairway && fairway.cells) || [];
  if (!cells.length) return false;
  const { label, bodies } = labelWater(terrain);
  const size = terrain.size;
  for (const [gx, gz] of cells) {
    if (gx < 0 || gz < 0 || gx >= size || gz >= size) continue;
    const id = label[gx + gz * size];
    if (id !== -1 && bodies[id].open) return true;
  }
  return false;
}
