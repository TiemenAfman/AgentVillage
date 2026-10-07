// The harbour's stone quay as the sea, the player and the drawing share it.
//
// The harbour used to be a basin drawn over the saved terrain (an overlay the terrain hash never
// saw: `parcelWaterField`, `quayWaterField` and `createQuayBasin` lived here), and the layout, the
// sea and the boats saw a hill where the page drew water. Since fase 3 of Plans/quay-en-rivier.md
// the harbour is real water - one more `works.dig` - and the quay is ground (`works.kade`,
// shared/terrain.mjs `levelKade`): a strip at the planks' height whose water side is a wall on a
// row of corners. What is left for this file is the one thing the heightfield cannot say: the
// wall's face. The cell in front of the quay (its foot) slopes from the harbour's bed up to the
// quay, as every cell is the mean of four corners; the page covers it with a stone face on the
// water side and a coping over the top (web/js/quay-basin.js), and so the foot is stood on at the
// quay's height here, by feet and by settlers alike - and a swimmer meets a wall, not a beach.
// Stairs go down the face into the water every so often, in front of it.
//
// No trig, no clock: shared/'s rule, and the sea reads it too.
export const BASIN_DECK = 0.44;

// The sea must know the permanent decks even before a browser has measured them.
// Shared with the page so an old placements snapshot cannot put feet underground.
export function quayDeckHeights(village, size) {
  const heights = new Map();
  for (const d of village?.districts || []) {
    if (d.kind !== 'quay') continue;
    for (const [gx, gz] of [...(d.deck || []), ...(d.pier || [])]) heights.set(gx + gz * size, BASIN_DECK);
  }
  for (const b of village?.buildings || []) {
    if (!b.harbour || !b.plot?.quay) continue;
    const p = b.plot;
    for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) {
      heights.set((p.gx + x) + (p.gz + z) * size, BASIN_DECK);
    }
  }
  return heights;
}

// The stairs down the face: every STAIR_EVERY cells of wall, starting STAIR_FIRST in, a flight
// STAIR_LEN cells long standing STAIR_DEPTH out from the face in the water, from one riser under
// the quay down to STAIR_FOOT - just over the water, so a swimmer steps out onto it - in risers of
// at most STAIR_RISE. Not where the water in front is somebody's: a deck, planks or a plot.
export const STAIR_EVERY = 12;
export const STAIR_FIRST = 4;
export const STAIR_LEN = 2;
export const STAIR_DEPTH = 0.6;
export const STAIR_FOOT = 0.02;
export const STAIR_RISE = 0.075;
// The finger jetties (see `createQuayKade`): every FINGER_EVERY cells of wall from FINGER_FIRST in -
// half a flight's spacing off the stairs - FINGER_LEN cells out, at most FINGER_MOST of them.
export const FINGER_EVERY = 6;
export const FINGER_FIRST = 7;
export const FINGER_LEN = 4;
export const FINGER_MOST = 5;

// The tread `along` a flight (0 at its upper end, `STAIR_LEN` at its foot).
export function stairHeight(s, along) {
  const n = s.steps;
  const k = Math.min(n - 1, Math.max(0, Math.floor((along / STAIR_LEN) * n + 1e-9)));
  return s.top - (s.top - STAIR_FOOT) * (k + 1) / n;
}

export function createQuayKade(village, terrain) {
  const k = village?.works?.kade;
  if (!k || !(k.cells || []).length) return null;
  const { size, half } = terrain;
  const level = k.level / 256;
  const [bx, bz] = k.back;
  const wx = -bx, wz = -bz;                 // towards the water
  const alongZ = wx !== 0;                   // the wall runs along z when the water is along x
  const at = (gx, gz) => gx + gz * size;
  const own = new Set(k.cells.map(([gx, gz]) => at(gx, gz)));
  const inGrid = (gx, gz) => gx >= 0 && gz >= 0 && gx < size && gz < size;

  // The foot of the wall: the water-side neighbour of every quay cell on the wall.
  const foot = [];
  for (const [gx, gz] of k.cells) {
    const fx = gx + wx, fz = gz + wz;
    if (own.has(at(fx, fz)) || !inGrid(fx, fz)) continue;
    // Where the face stands, across the wall: the foot's water-side edge, in grid units.
    const face = wx < 0 ? fx : wx > 0 ? fx + 1 : wz < 0 ? fz : fz + 1;
    foot.push({ gx: fx, gz: fz, along: alongZ ? fz : fx, across: alongZ ? fx : fz, face });
  }
  foot.sort((a, b) => a.across - b.across || a.along - b.along);
  const footAt = new Map(foot.map((f) => [at(f.gx, f.gz), f]));

  // Runs of the wall: foot cells next to each other along it.
  const runs = [];
  for (const f of foot) {
    const run = runs[runs.length - 1];
    if (run && run[run.length - 1].across === f.across && run[run.length - 1].along === f.along - 1) run.push(f);
    else runs.push([f]);
  }

  // What the water in front of the wall already carries.
  const taken = new Set();
  for (const d of village.districts || []) for (const [gx, gz] of [...(d.deck || []), ...(d.pier || [])]) taken.add(at(gx, gz));
  for (const b of village.buildings || []) {
    const p = b.plot;
    if (!p) continue;
    for (let z = 0; z < p.d; z++) for (let x = 0; x < p.w; x++) taken.add(at(p.gx + x, p.gz + z));
  }
  for (const p of village.paths || []) for (const [gx, gz] of p.cells || []) taken.add(at(gx, gz));

  const steps = Math.max(1, Math.ceil((level - STAIR_FOOT) / STAIR_RISE));
  const stairs = [];
  for (const run of runs) {
    for (let i = STAIR_FIRST; i + STAIR_LEN <= run.length; i += STAIR_EVERY) {
      const cells = run.slice(i, i + STAIR_LEN);
      if (cells.some((f) => taken.has(at(f.gx + wx, f.gz + wz)) || !inGrid(f.gx + wx, f.gz + wz))) continue;
      stairs.push({ a0: cells[0].along, face: cells[0].face, sign: alongZ ? wx : wz, top: level, steps, cells });
    }
  }

  // Finger jetties off the wall into the harbour, where the quay district's houses stood before
  // they moved to their resort on the sea (Plans/quay-op-zee.md, §5a): somewhere for the boats to
  // lie. Dressing only - route (a) of the plan: BOATS_PER_HARBOUR is still three and the moorings
  // are still the planks' - so nothing walks them and only the page draws them. Straight out from
  // the foot, on water nobody else's with a cell of water either side, off the stairs' water, the
  // planks and their berths.
  const kept = new Set(taken);
  for (const d of village.districts || []) {
    for (const [gx, gz] of d.pier || []) for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) kept.add(at(gx + dx, gz + dz));
  }
  for (const s of stairs) for (const f of s.cells) for (let k = 1; k <= 2; k++) kept.add(at(f.gx + wx * k, f.gz + wz * k));
  // A ground that cannot say where its water is (the flat stand-ins the wall's own tests hand in)
  // gets no fingers rather than a guess.
  const wet = typeof terrain.isWater === 'function' ? (gx, gz) => terrain.isWater(gx, gz) : () => false;
  const free = (gx, gz) => inGrid(gx, gz) && wet(gx, gz) && !kept.has(at(gx, gz));
  const side = alongZ ? [0, 1] : [1, 0];
  const fingers = [];
  for (const run of runs) {
    for (let i = FINGER_FIRST; i < run.length && fingers.length < FINGER_MOST; i += FINGER_EVERY) {
      const f = run[i];
      const cells = [];
      for (let n = 1; n <= FINGER_LEN; n++) cells.push([f.gx + wx * n, f.gz + wz * n]);
      if (!cells.every(([gx, gz]) => free(gx, gz) && free(gx + side[0], gz + side[1]) && free(gx - side[0], gz - side[1]))) continue;
      fingers.push({ along: f.along, face: f.face, cells });
    }
  }

  // Where (x, z), local, stands: a tread, the top of the wall, or null for everywhere else.
  const height = (x, z) => {
    const X = x + half, Z = z + half;
    const A = alongZ ? Z : X, C = alongZ ? X : Z;
    for (const s of stairs) {
      const out = (C - s.face) * s.sign;                // how far in front of the face
      if (out < 0 || out > STAIR_DEPTH || A < s.a0 || A >= s.a0 + STAIR_LEN) continue;
      return stairHeight(s, A - s.a0);
    }
    const f = footAt.get(at(Math.floor(X), Math.floor(Z)));
    return f ? level : null;
  };
  return { level, back: [bx, bz], water: [wx, wz], alongZ, foot, runs, stairs, fingers, height };
}

const cache = new WeakMap();
export function quayKade(village, terrain) {
  if (!village) return null;
  let entry = cache.get(village);
  if (!entry || entry.terrain !== terrain) {
    entry = { terrain, kade: createQuayKade(village, terrain) };
    cache.set(village, entry);
  }
  return entry.kade;
}
