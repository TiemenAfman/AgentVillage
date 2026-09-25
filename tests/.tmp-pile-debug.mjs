import { register } from 'node:module';
register('./support/shared-loader.mjs', import.meta.url);
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(_) {} }) };
const g = await import('../web/js/goldpit.js');
// Grid-only: square bars on the grid, check restsOn and overlaps between neighbours.
const COURSES = [[5, 8], [4, 7], [3, 6], [2, 5], [1, 4]];
let prev = null;
COURSES.forEach(([nx, nz], k) => {
  const cur = [];
  let unsup = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const s = [(i - (nx - 1) / 2) * g.PILE_PITCH.x, k * g.BAR.h, g.PILE_Z + (j - (nz - 1) / 2) * g.PILE_PITCH.z, 0, 0, 0];
    if (prev && !g.restsOn(s, prev)) unsup++;
    cur.push(s);
  }
  console.log('course', k, 'unsupported on a square grid:', unsup);
  prev = cur;
});
