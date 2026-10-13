// Cuts the pirate ship's walking surface out of her baked model: web/js/pirateship-mesh.js ->
// web/js/shipwalk-map.js. `node scripts/build-shipwalk.mjs` (npm run models:walk); run it after
// `npm run models -- pirateship`, and tests/shipwalk.test.mjs fails until you have.
//
// A vertical line through the middle of every 5 cm square of the hull's plan meets the model's
// triangles at some heights; those heights are all the walk needs (shared/hullwalk.mjs says how it
// reads them). Each is kept with one bit: whether it is a surface to stand on - level enough, not
// steeper than 70 degrees, whichever way its winding says it faces (the bake has stretches wound the
// wrong way round, the foot of the bow's ramp among them, and a ceiling that is stood on is refused by
// the headroom under it, not by its facing). The rest are obstacles, whichever way they face.
//
// Heights are in the hull's own frame, above DECK_Y, exactly as shared/crafts.mjs has them: the bake
// dropped by her draught (SHIP_DRAUGHT) and by DECK_Y. Only what a body on her can meet is kept: from
// 0.3 under the lowest deck to a body's height and a hand over the highest, in steps of 2 cm (gridsOf).
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SHIP_DRAUGHT } from '../shared/crafts.mjs';
import { DECK_Y } from '../shared/hull.mjs';
import { SIDE, sideCut as cutSide, sourceOf } from './hull-cut.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const { PIRATESHIP } = await import(pathToFileURL(`${root}web/js/pirateship-mesh.js`).href);
const positions = PIRATESHIP.parts['pirateship hull'].positions;

// The two grids are worked out from the bake (Plans/nieuwe-sloep.md chip 3), not typed: the deck's
// over her plan wherever the hull has anything between a hand under her lowest deck and a body's
// height over her highest, the band of heights the same; the crow's nest's as a layer of its own round
// `mast.main` at `deck.nest`'s height - a byte holds 128 heights, and 2 cm steps from the deck to the
// nest are hundreds of them, so the one grid cannot reach it, nor should it, since everything in
// between (the yard, the sail, the stays) is cloth and rope a body falls through. A deck rectangle
// outside the grid it is cut on throws: a map that ends short of a deck is a ship with a hole in it.
const CELL = 0.05, Q = 0.02;
// Whole cells and steps, rounded to the micron so a grid prints as the numbers it is (0.35, not 0.35000000000000003).
const tidy = (v) => Math.round(v * 1e6) / 1e6;
const snap = (v) => tidy(Math.round(v / CELL) * CELL);
export function gridsOf(bake, lift = bake.anchors.waterline[1] + DECK_Y) {
  const A = bake.anchors;
  const decks = Object.entries(A).filter(([k]) => /^(deck|stair)\./.test(k) && !/^deck\.nest\./.test(k)).map(([, p]) => p);
  if (!decks.length) throw new Error('the bake has no deck.* or stair.* anchors to walk');
  const low = Math.min(...decks.map((p) => p[1])) - lift, high = Math.max(...decks.map((p) => p[1])) - lift;
  const y0 = tidy(Math.floor((low - 0.3) / Q) * Q), top = tidy(Math.ceil((high + 0.55 + 0.35) / Q) * Q);
  const pos = bake.parts['pirateship hull'].positions;
  let xm = 0, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const y = pos[i + 1] - lift;
    if (y < y0 || y > top) continue;
    xm = Math.max(xm, Math.abs(pos[i]));
    z0 = Math.min(z0, pos[i + 2]);
    z1 = Math.max(z1, pos[i + 2]);
  }
  const x0 = -snap(xm + 2 * CELL), zs = snap(z0 - 2 * CELL);
  const grid = { cell: CELL, x0, z0: zs, nx: Math.round(-2 * x0 / CELL), nz: Math.round((snap(z1 + 2 * CELL) - zs) / CELL), y0, q: Q, top };
  for (const p of decks) {
    if (p[0] < grid.x0 || p[0] > -grid.x0 || p[2] < grid.z0 || p[2] > grid.z0 + grid.nz * CELL) {
      throw new Error(`a deck corner at (${p[0]}, ${p[2]}) lies outside the walk map's grid`);
    }
  }
  const mast = A['mast.main'], nest = A['deck.nest.lo'];
  const floor = nest ? nest[1] - lift : null;
  const aloft = mast && nest ? { cell: CELL, x0: snap(mast[0] - 0.9), z0: snap(mast[2] - 0.9), nx: 36, nz: 36,
    y0: tidy(Math.floor((floor - 0.3) / Q) * Q), q: Q, top: tidy(Math.ceil((floor + 1.4) / Q) * Q) } : null;
  return { grid, aloft };
}
export const { grid: GRID, aloft: ALOFT } = gridsOf(PIRATESHIP);
// Steeper than this is a wall, whichever way it faces: cos of 70 degrees, as the surface normal's y. The
// bow's ramp starts with a stretch of 63 degrees, which is a way up all the same.
const WALKABLE = 0.35;

// What the map was cut from, so that a re-baked ship that has not been cut again is caught.
export { sourceOf };

export function cut(pos, g = GRID, lift = SHIP_DRAUGHT + DECK_Y) {
  const tris = [];
  for (let t = 0; t < pos.length; t += 9) {
    const ax = pos[t], ay = pos[t + 1] - lift, az = pos[t + 2];
    const bx = pos[t + 3], by = pos[t + 4] - lift, bz = pos[t + 5];
    const cx = pos[t + 6], cy = pos[t + 7] - lift, cz = pos[t + 8];
    if (Math.min(ay, by, cy) > g.top || Math.max(ay, by, cy) < g.y0) continue;
    // The normal, from the winding: y of (b - a) x (c - a), and its length for the slope.
    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-12) continue;
    tris.push({ ax, ay, az, bx, by, bz, cx, cy, cz, stand: Math.abs(ny) / len >= WALKABLE,
      minx: Math.min(ax, bx, cx), maxx: Math.max(ax, bx, cx), minz: Math.min(az, bz, cz), maxz: Math.max(az, bz, cz) });
  }
  // Triangles by coarse square, so a cell only looks at the few that are near it.
  const B = 0.25, BX = Math.ceil((g.nx * g.cell) / B), BZ = Math.ceil((g.nz * g.cell) / B);
  const buckets = Array.from({ length: BX * BZ }, () => []);
  for (const t of tris) {
    for (let gx = Math.max(0, Math.floor((t.minx - g.x0) / B)); gx <= Math.min(BX - 1, Math.floor((t.maxx - g.x0) / B)); gx++) {
      for (let gz = Math.max(0, Math.floor((t.minz - g.z0) / B)); gz <= Math.min(BZ - 1, Math.floor((t.maxz - g.z0) / B)); gz++) {
        buckets[gx * BZ + gz].push(t);
      }
    }
  }
  const ends = new Uint16Array(g.nx * g.nz);
  const list = [];
  for (let ix = 0; ix < g.nx; ix++) {
    for (let iz = 0; iz < g.nz; iz++) {
      const x = g.x0 + (ix + 0.5) * g.cell, z = g.z0 + (iz + 0.5) * g.cell;
      const seen = new Set();
      for (const t of buckets[Math.floor((x - g.x0) / B) * BZ + Math.floor((z - g.z0) / B)]) {
        if (t.minx > x || t.maxx < x || t.minz > z || t.maxz < z) continue;
        const d = (t.bz - t.cz) * (t.ax - t.cx) + (t.cx - t.bx) * (t.az - t.cz);
        if (Math.abs(d) < 1e-12) continue;
        const l1 = ((t.bz - t.cz) * (x - t.cx) + (t.cx - t.bx) * (z - t.cz)) / d;
        const l2 = ((t.cz - t.az) * (x - t.cx) + (t.ax - t.cx) * (z - t.cz)) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue;
        const y = l1 * t.ay + l2 * t.by + l3 * t.cy;
        if (y < g.y0 || y > g.top) continue;
        const qn = Math.round((y - g.y0) / g.q);
        seen.add(qn * 2 + (t.stand ? 1 : 0));
      }
      // One entry per height and kind, low to high, so that a reader can stop early.
      list.push(...[...seen].sort((a, b) => a - b));
      ends[ix * g.nz + iz] = list.length;
    }
  }
  if (list.length > 65535) throw new Error(`${list.length} entries: the cell ends no longer fit in 16 bits`);
  if (list.some((e) => e > 255)) throw new Error('an entry no longer fits in a byte: widen the step or narrow the range');
  return { ends, hits: Uint8Array.from(list) };
}

const b64 = (u8) => Buffer.from(u8).toString('base64');

// One grid's cut, as the map keeps it.
export function layer(pos, g, lift) {
  const { ends, hits } = cut(pos, g, lift);
  return { cell: g.cell, x0: g.x0, z0: g.z0, nx: g.nx, nz: g.nz, y0: g.y0, q: g.q, off: b64(new Uint8Array(ends.buffer)), hits: b64(hits) };
}

// Her side at the waterline, for the boats that meet it (web/js/boat.js shipsOver): the cut is
// scripts/hull-cut.mjs's, shared with the craft's generator (scripts/build-craft.mjs), at the draught
// the craft floats her at. Re-exported for tests/shipwalk.test.mjs.
export { SIDE };
export const sideCut = (pos, s = SIDE) => cutSide(pos, SHIP_DRAUGHT, s);

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  // Cut where she floats: her bake's waterline, which the craft has to say too (scripts/build-craft.mjs
  // runs first) - a map cut at one draught and sailed at another puts every deck in the wrong place.
  if (Math.abs(PIRATESHIP.anchors.waterline[1] - SHIP_DRAUGHT) > 1e-9) {
    throw new Error(`the bake floats at ${PIRATESHIP.anchors.waterline[1]} and the craft at ${SHIP_DRAUGHT}: run node scripts/build-craft.mjs first`);
  }
  const { hits } = cut(positions);
  const map = { source: sourceOf(positions), ...layer(positions, GRID), aloft: layer(positions, ALOFT), side: sideCut(positions) };
  const out = `// Generated by scripts/build-shipwalk.mjs from web/js/pirateship-mesh.js. Never hand-edit.
// The ship's walking surface, cut from her model (shared/hullwalk.mjs reads it).
export const SHIPWALK = ${JSON.stringify(map)};
`;
  writeFileSync(`${root}web/js/shipwalk-map.js`, out);
  console.log(`shipwalk-map.js: ${GRID.nx} x ${GRID.nz} cells, ${hits.length} entries, ${(out.length / 1024).toFixed(0)} kB`);
}
