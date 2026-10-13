// Cuts of a ship's hull that two generators share: scripts/build-shipwalk.mjs (her walking surface and
// her side at the waterline, web/js/shipwalk-map.js) and scripts/build-craft.mjs (what the craft knows
// of her without a mesh, shared/craft-galleon.mjs). Pulled out of build-shipwalk so the craft's generator
// can run BEFORE the walk map is cut - build-shipwalk imports SHIP_DRAUGHT from shared/crafts.mjs, which
// reads the craft module this cut helps write - and with the draught handed in rather than imported, so
// each caller cuts at the waterline it knows: the walk map at the craft's, the craft at the bake's own
// `anchor.waterline`.
//
// Heights are the bake's (keel on y = 0) less `draught`: the hull as she floats, y = 0 the water.
import { createHash } from 'node:crypto';

// What a cut was made from, so that a re-baked ship that has not been cut again is caught
// (tests/shipwalk.test.mjs, tests/craft-bake.test.mjs).
export function sourceOf(pos) {
  return createHash('sha1').update(Buffer.from(new Float32Array(pos).buffer)).digest('hex').slice(0, 16);
}

// Her side at the waterline, for the boats that meet it (web/js/boat.js shipsOver). The walk map
// starts at the lowest deck and knows nothing of the hull under it, and a rowing boat sailed straight
// through her (Plans/speeltest-quests.md B1). So: the plan of everything of the hull from a little
// under the water to a rowing boat's gunwale over it (the rowboat's bake stands 0.275 above the water
// it rides on), cut across in slices `dz` long, each slice the least and the most x of the hull in it
// - in hundredths, in her own frame (+z forward). A slice with nothing in it is lo > hi. Not a box:
// she is 4.4 wide amidships and narrows to a point at the stem, and a ladder's foot hangs 0.2 off her
// side, where a rowing boat must still come to hoist the statue up it.
export const SIDE = { z0: -6.5, dz: 0.1, n: 125, below: 0.1, above: 0.4 };

// A polygon (points [x, y, z]) cut to `lo <= p[axis] <= hi` (Sutherland-Hodgman, two planes).
export function clipTo(poly, axis, lo, hi) {
  for (const [lim, keep] of [[lo, (v) => v >= lo], [hi, (v) => v <= hi]]) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ina = keep(a[axis]), inb = keep(b[axis]);
      if (ina) out.push(a);
      if (ina !== inb) {
        const t = (lim - a[axis]) / (b[axis] - a[axis]);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      }
    }
    poly = out;
    if (!poly.length) return poly;
  }
  return poly;
}

export function sideCut(pos, draught, s = SIDE) {
  const lo = new Array(s.n).fill(Infinity), hi = new Array(s.n).fill(-Infinity);
  for (let t = 0; t < pos.length; t += 9) {
    // Height over the water she floats in: the bake dropped by her draught.
    const tri = [0, 1, 2].map((k) => [pos[t + 3 * k], pos[t + 3 * k + 1] - draught, pos[t + 3 * k + 2]]);
    const band = clipTo(tri, 1, -s.below, s.above);
    if (band.length < 3) continue;
    const zs = band.map((p) => p[2]);
    const first = Math.max(0, Math.floor((Math.min(...zs) - s.z0) / s.dz));
    const last = Math.min(s.n - 1, Math.floor((Math.max(...zs) - s.z0) / s.dz));
    for (let k = first; k <= last; k++) {
      const piece = clipTo(band, 2, s.z0 + k * s.dz, s.z0 + (k + 1) * s.dz);
      for (const p of piece) {
        if (p[0] < lo[k]) lo[k] = p[0];
        if (p[0] > hi[k]) hi[k] = p[0];
      }
    }
  }
  // Rounded outwards, so the hull is never a hair narrower than her model.
  const q = (v, up) => (Number.isFinite(v) ? (up ? Math.ceil(v * 100) : Math.floor(v * 100)) : (up ? -1 : 1));
  return { z0: s.z0, dz: s.dz, lo: lo.map((v) => q(v, false)), hi: hi.map((v) => q(v, true)) };
}

// Every height at which the model has a triangle over (x, z), in the bake's frame less `lift`, low to
// high - the one vertical line of build-shipwalk's cut, for a generator that wants to ask the hull a
// question at a point (where the bulwark's top is beside a ladder, say) rather than map all of her.
export function heightsAt(pos, x, z, lift = 0) {
  const out = [];
  for (let t = 0; t < pos.length; t += 9) {
    const ax = pos[t], az = pos[t + 2], bx = pos[t + 3], bz = pos[t + 5], cx = pos[t + 6], cz = pos[t + 8];
    if (Math.min(ax, bx, cx) > x || Math.max(ax, bx, cx) < x || Math.min(az, bz, cz) > z || Math.max(az, bz, cz) < z) continue;
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
    const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    out.push(l1 * pos[t + 1] + l2 * pos[t + 4] + l3 * pos[t + 7] - lift);
  }
  return out.sort((a, b) => a - b);
}
