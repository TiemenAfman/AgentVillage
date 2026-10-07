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
// 0.3 under the lowest deck to 2.6 (the poop is at 1.95, and a body on it is 0.55 tall), in steps of 2 cm.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SHIP_DRAUGHT } from '../shared/crafts.mjs';
import { DECK_Y } from '../shared/hull.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const { PIRATESHIP } = await import(pathToFileURL(`${root}web/js/pirateship-mesh.js`).href);
const positions = PIRATESHIP.parts['pirateship hull'].positions;

export const GRID = { cell: 0.05, x0: -2.6, z0: -6.4, nx: 104, nz: 256, y0: 0.7, q: 0.02, top: 2.6 };
// And the crow's nest at the head of the mainmast (shared/crafts.mjs `aloft`), as a layer of its own:
// a byte holds 128 heights, and 2 cm steps from the deck to the nest are 450 of them, so the one grid
// cannot reach it - nor should it, since everything in between (the yards, the sails, the stays) is
// cloth and rope a body falls through. A box round the mast from under the nest's floor (8.62, and its
// tiers 8.82 / 8.95 / 9.07 / 9.19 round the topmast) to a body's height over its rim (9.24).
export const ALOFT = { cell: 0.05, x0: -0.9, z0: -0.9, nx: 36, nz: 36, y0: 8.3, q: 0.02, top: 9.9 };
// Steeper than this is a wall, whichever way it faces: cos of 70 degrees, as the surface normal's y. The
// bow's ramp starts with a stretch of 63 degrees, which is a way up all the same.
const WALKABLE = 0.35;

// What the map was cut from, so that a re-baked ship that has not been cut again is caught.
export function sourceOf(pos) {
  return createHash('sha1').update(Buffer.from(new Float32Array(pos).buffer)).digest('hex').slice(0, 16);
}

export function cut(pos, g = GRID) {
  const lift = SHIP_DRAUGHT + DECK_Y;
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
export function layer(pos, g) {
  const { ends, hits } = cut(pos, g);
  return { cell: g.cell, x0: g.x0, z0: g.z0, nx: g.nx, nz: g.nz, y0: g.y0, q: g.q, off: b64(new Uint8Array(ends.buffer)), hits: b64(hits) };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { hits } = cut(positions);
  const map = { source: sourceOf(positions), ...layer(positions, GRID), aloft: layer(positions, ALOFT) };
  const out = `// Generated by scripts/build-shipwalk.mjs from web/js/pirateship-mesh.js. Never hand-edit.
// The ship's walking surface, cut from her model (shared/hullwalk.mjs reads it).
export const SHIPWALK = ${JSON.stringify(map)};
`;
  writeFileSync(`${root}web/js/shipwalk-map.js`, out);
  console.log(`shipwalk-map.js: ${GRID.nx} x ${GRID.nz} cells, ${hits.length} entries, ${(out.length / 1024).toFixed(0)} kB`);
}
