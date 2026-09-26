// A small synthetic island for the story-animal tests: a real makeTerrain, a handful of houses
// on buildable blocks with doors, a lighthouse, and the ground check the garden would give -
// built here so no test has loadConfig found an island in the checkout it runs in.
import { makeTerrain } from '../../shared/terrain.mjs';

export function animalIsland({ seed = 11, size = 64, houses = 5, active = [0] } = {}) {
  const t = makeTerrain(seed, { size });
  const taken = new Set();
  const key = (gx, gz) => gx + gz * size;
  const blocks = [];
  const mid = size / 2;
  // Buildable 3x3 blocks, nearest the middle first, a street's width apart.
  const cands = [];
  for (let gz = 2; gz < size - 5; gz++) for (let gx = 2; gx < size - 5; gx++) cands.push([gx, gz]);
  cands.sort((a, b) => ((a[0] - mid) ** 2 + (a[1] - mid) ** 2) - ((b[0] - mid) ** 2 + (b[1] - mid) ** 2));
  for (const [gx, gz] of cands) {
    if (blocks.length >= houses + 1) break;
    let ok = true;
    for (let dz = -2; dz < 5 && ok; dz++) for (let dx = -2; dx < 5 && ok; dx++) if (taken.has(key(gx + dx, gz + dz))) ok = false;
    for (let dz = 0; dz < 3 && ok; dz++) for (let dx = 0; dx < 3 && ok; dx++) if (!t.isBuildable(gx + dx, gz + dz)) ok = false;
    // Room for the doorstep and a garden around it.
    for (let dz = -1; dz < 4 && ok; dz++) for (let dx = -1; dx < 4 && ok; dx++) if (!t.isLand(gx + dx, gz + dz)) ok = false;
    if (!ok) continue;
    blocks.push([gx, gz]);
    for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) taken.add(key(gx + dx, gz + dz));
  }
  if (blocks.length < houses + 1) throw new Error(`seed ${seed} has room for only ${blocks.length} blocks`);
  const now = Date.parse('2026-09-26T09:00:00Z');
  const buildings = blocks.slice(0, houses).map(([gx, gz], i) => ({
    id: `house:h${i}`, kind: 'house', name: ['Slate Mill', 'Verdant Moor', 'Nimble Barrow', 'Ashen Yarrow', 'Deft Alder', 'Merry Chisel'][i % 6],
    active: active.includes(i), lastAt: new Date(now - (active.includes(i) ? 0 : (i + 3) * 3600e3)).toISOString(),
    plot: { gx, gz, w: 3, d: 3, rot: 2 }, door: [gx + 1, gz + 2],
    stats: { humanTurns: 2, assistantMsgs: 10 + i, toolCalls: 5, filesTouched: 0 },
  }));
  const [lx, lz] = blocks[houses];
  buildings.push({ id: 'civic:lighthouse', kind: 'civic', civicType: 'lighthouse', name: 'Lighthouse', plot: { gx: lx, gz: lz, w: 1, d: 1, rot: 0 } });
  const village = {
    generatedAt: new Date(now).toISOString(),
    grid: { size }, island: { seed, name: 'Testholm', town: { centre: [mid, mid], paved: [] } },
    buildings, paths: [], districts: [], bridges: [], polders: [], fairway: null, grow: null,
  };
  // The garden's refusals, on the same terrain: sea, river, sand, steep.
  const check = () => ({
    terrain: t,
    refuse: (x, z) => {
      const gx = Math.floor(x + t.half), gz = Math.floor(z + t.half);
      if (!t.inGrid(gx, gz)) return 'off the island';
      if (t.isRiver(gx, gz)) return 'river';
      if (!t.isLand(gx, gz)) return 'sea';
      if (t.isBeach(gx, gz)) return 'sand';
      if (t.slope(gx, gz) > 1.1) return 'steep';
      return null;
    },
  });
  return { terrain: t, village, check, now };
}

// The same village a little later: everybody who is working has done a little more.
export function worked(village, steps = 1, { at } = {}) {
  const v = structuredClone(village);
  for (const b of v.buildings) {
    if (b.kind !== 'house') continue;
    if (b.active) { b.stats.assistantMsgs += 3 * steps; b.stats.toolCalls += 2 * steps; if (at) b.lastAt = new Date(at).toISOString(); }
  }
  return v;
}
