import { makeRng } from '../../shared/rng.mjs';

// Hydraulic erosion, as a droplet simulation over the baked grid.
//
// The relief up to this point is noise: ridged fbm quantised to benches. It has the *shape* of
// terrain and none of its history - every gully is where the noise happened to have a trough
// rather than where water would have cut one, so nothing converges, nothing collects, and a
// slope looks the same at its foot as at its top. This pass gives it a history. Sixty thousand
// droplets are dropped on the island; each follows the gradient, picks material up where it
// speeds up and puts it down where it slows, and dies of evaporation after thirty-odd metres.
// What survives is drainage: gullies that meet, talus at the foot of every face, and ridges
// that are sharp because the ground beside them was carried away.
//
// Three things about where it sits in the bake:
//
// - **Before the water.** `carveWater` walks downhill to find a river; run after erosion it
//   finds the gullies erosion already cut, so a river lies in a valley instead of across one.
//   The other way round, every gully would be a second drainage network ignoring the first.
// - **Before the gradient cap.** Erosion steepens a face while it undercuts it, and the cap is
//   the thing that decides how steep a face is allowed to be. Capping last keeps one answer to
//   that question, and what the cap shaves off is still rock-shell material.
// - **Only on the main island.** An islet sixty metres across has no catchment worth the name -
//   the same reason `carveWater` gives for skipping them.
//
// The pass is a redistribution: it can only move material downhill and, at the shore, lose it
// to the sea. Nothing is created, so the island cannot grow; a deposit is clamped to the height
// the island already stood at, so it cannot grow a new summit either.

// ---- the droplet ------------------------------------------------------------------
// Quoted for an island of 208 m radius sampled every metre. The ones in metres are multiplied
// by `scale`, so a larger island weathers at the same rate rather than harder.

export const DROPLET = {
  perHectare: 7200,      // ~55k droplets on 8.4 ha: about 0.7 per land sample
  lifetimeM: 36,         // metres a droplet travels before it gives up
  inertia: 0.055,        // 0 = follows the gradient exactly, 1 = ignores it
  capacity: 3.4,         // metres of sediment carried per metre of descent
  minCapacity: 0.012,    // so a droplet on flat ground still sheds its load
  erodeRate: 0.30,       // share of the shortfall picked up per step
  depositRate: 0.28,     // share of the surplus laid down per step
  evaporation: 0.045,    // share of the water lost per step
  gravity: 5,            // turns a metre of descent into speed
  radiusM: 3,            // brush radius: a cut is never one sample wide
};

/**
 * How much of the simulated displacement is kept: a blend between the island the relief left
 * and the island the droplets arrived at.
 *
 * Not 1, and the reason is worth writing down. A full run is a genuinely different island: the
 * slope median falls from 0.38 to 0.25 and bare rock and scree together drop from a quarter of
 * the island to a seventh, because a droplet sim converges on a drainage landscape and a
 * drainage landscape is gentler than fractal noise. Turning the *rates* down does not walk that
 * back - halving the capacity and the erosion rate together moves the slope median by 0.02,
 * since the shape the sim converges on is a property of the sim, not of how hard it is run.
 * Blending the two heightfields is the only lever that is linear in the result. At 0.7 the
 * drainage network is all there and the island is still the one the relief drew.
 */
export const WEATHERING = 0.7;

export const SHORE_GUARD_M = 5;            // metres of coast the droplets are kept off
export const SPAWN_REACH = 1.4;            // x radiusM: half-width of the square droplets fall in

/**
 * Weather a baked heightfield. Mutates `height` in place.
 *
 * Anything in `DROPLET` can be overridden per call. That is not configurability for its own
 * sake: the pass has ten interacting knobs and the only way to set them is to bake the same
 * seed twenty times and look, which is unbearable if each look needs a source edit.
 *
 * @param {{height: Float32Array, coast: Float32Array, n: number, envelopeM: number,
 *          metresPerSample: number}} grid
 * @param {number|string} seed
 * @param {{scale?: number, shape?: object, strength?: number}} opts
 *        `strength` is the blend above: 0 skips the pass, 1 is the simulation undiluted.
 */
export function erodeField(grid, seed, { scale = 1, shape = null, strength = WEATHERING, ...tuning } = {}) {
  const P = { ...DROPLET, ...tuning };
  const { height, coast, n, envelopeM, metresPerSample } = grid;
  const half = envelopeM / 2;
  const worldOf = (i) => i * metresPerSample - half;
  const guard = SHORE_GUARD_M * scale;
  const area = metresPerSample * metresPerSample;

  const nothing = {
    droplets: 0, spawnSamples: 0, touched: 0, movedM3: 0, lostM3: 0,
    netM3: 0, deepestCutM: 0, thickestFillM: 0, meanShiftM: 0,
  };
  if (strength <= 0) return nothing;

  // ---- the ground the droplets are allowed on -------------------------------------
  // The main island, five metres in from its own waterline - and deliberately not "every land
  // sample in the grid". `coast` is the union with the skerries, and the skerries are placed on
  // a lattice over the *envelope*, so a droplet that read `coast` would find different ground at
  // 640 m of envelope than at 1024 m. `islandStats` bakes at 640 and `publishWorld` at 1024, so
  // the island the pass is tuned on would not be the island anybody stands on.
  //
  // `mainCoast` depends on the seed and the radius alone, so a mask built from it makes the
  // whole pass a function of those two. It is not a cheap call, so the grid's own `coast` prunes
  // first: `coast >= mainCoast` everywhere, so a sample the cheap test rejects is one the
  // expensive test would have rejected too. That leaves about ninety thousand real calls.
  //
  // The shore band is outside the mask on purpose. The beach profile is built from the swell
  // exposure and is the one part of the island people land on; a gully cut through it is a hole
  // in a doorway. Sediment that arrives there goes into the sea instead, which is where a river
  // puts it.
  const reach = Math.min(shape ? shape.radiusM * SPAWN_REACH : half, half - 4);
  const lo = Math.max(1, Math.floor((half - reach) / metresPerSample));
  const hi = Math.min(n - 2, Math.ceil((half + reach) / metresPerSample));

  const open = new Uint8Array(n * n);
  const spawn = [];
  for (let j = lo; j <= hi; j++) {
    const z = worldOf(j);
    for (let i = lo; i <= hi; i++) {
      const k = i + j * n;
      if (coast[k] <= guard) continue;
      if (shape && shape.mainCoast(worldOf(i), z) <= guard) continue;
      open[k] = 1;
      spawn.push(k);
    }
  }
  if (!spawn.length) return nothing;

  // ---- the brush ------------------------------------------------------------------
  // Erosion spread over a disc rather than taken from the sample the droplet stands on. A
  // single-sample cut is a one-metre spike that the gradient cap then has to shave off again,
  // so the whole pass would turn into work for pass 5 and nothing else.
  const radius = Math.max(1, Math.round((P.radiusM * scale) / metresPerSample));
  const brushDI = [], brushDJ = [], brushW = [];
  {
    let sum = 0;
    for (let dj = -radius; dj <= radius; dj++) {
      for (let di = -radius; di <= radius; di++) {
        const d = Math.sqrt(di * di + dj * dj);
        if (d > radius) continue;
        brushDI.push(di); brushDJ.push(dj); brushW.push(1 - d / (radius + 1));
        sum += brushW[brushW.length - 1];
      }
    }
    for (let b = 0; b < brushW.length; b++) brushW[b] /= sum;
  }

  // Nothing may end up higher than the island already stood. Erosion redistributes; a summit
  // that grew would mean it had started inventing material.
  let ceiling = -Infinity;
  for (let t = 0; t < spawn.length; t++) if (height[spawn[t]] > ceiling) ceiling = height[spawn[t]];

  const before = height.slice();
  const rng = makeRng(seed).fork('erosion');
  const droplets = Math.round((spawn.length * area) / 10000 * P.perHectare);
  const maxLife = Math.max(4, Math.round((P.lifetimeM * scale) / metresPerSample));

  let movedM3 = 0, lostM3 = 0;

  for (let drop = 0; drop < droplets; drop++) {
    const k0 = spawn[rng.int(spawn.length)];
    // Jittered inside its sample, so fifty thousand droplets are not fifty thousand walks down
    // the same handful of lattice lines.
    //
    // The walk is kept in coordinates relative to the window's own corner, which is at the same
    // world position whatever the envelope. Absolute grid indices would put the identical walk
    // at 10.3 in one bake and at 42.3 in the other, and float addition is not translation
    // invariant: the two runs drifted apart in the eighth digit and the volume moved with them.
    let px = (k0 % n) - lo + rng.next() - 0.5;
    let pz = Math.floor(k0 / n) - lo + rng.next() - 0.5;
    let dx = 0, dz = 0;
    let speed = 1, water = 1, sediment = 0;
    // Where it last stood on open ground, and whether it got there under its own steam. A
    // droplet that simply runs out of water has to put its silt down; only one that walks into
    // the sea is allowed to take it with it.
    let restI = -1, restJ = -1;

    for (let life = 0; life < maxLife; life++) {
      const lx = Math.floor(px), lz = Math.floor(pz);
      const ix = lx + lo, iz = lz + lo;
      if (ix < 1 || iz < 1 || ix >= n - 2 || iz >= n - 2) { restI = -1; break; }
      const k = ix + iz * n;
      if (!open[k]) { restI = -1; break; }              // off the island: the sea takes the rest
      restI = ix; restJ = iz;

      const u = px - lx, v = pz - lz;
      const h00 = height[k], h10 = height[k + 1], h01 = height[k + n], h11 = height[k + n + 1];
      const gx = (h10 - h00) * (1 - v) + (h11 - h01) * v;
      const gz = (h01 - h00) * (1 - u) + (h11 - h10) * u;
      const h = h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v;

      dx = dx * P.inertia - gx * (1 - P.inertia);
      dz = dz * P.inertia - gz * (1 - P.inertia);
      let len = Math.sqrt(dx * dx + dz * dz);
      if (len < 1e-8) {
        // A bench top is genuinely flat and a gradient walk has nothing to say there. Rolling a
        // bearing keeps the droplet moving, so it lays its load across the terrace rather than
        // in the one sample it happened to stall on.
        const a = rng.next() * Math.PI * 2;
        dx = Math.cos(a); dz = Math.sin(a); len = 1;
      }
      dx /= len; dz /= len;
      px += dx; pz += dz;

      const nlx = Math.floor(px), nlz = Math.floor(pz);
      const nix = nlx + lo, niz = nlz + lo;
      if (nix < 1 || niz < 1 || nix >= n - 2 || niz >= n - 2) { restI = -1; break; }
      const nk = nix + niz * n;
      const nu = px - nlx, nv = pz - nlz;
      const nh = height[nk] * (1 - nu) * (1 - nv) + height[nk + 1] * nu * (1 - nv)
        + height[nk + n] * (1 - nu) * nv + height[nk + n + 1] * nu * nv;
      const dh = nh - h;

      const capacity = Math.max(-dh * speed * water * P.capacity, P.minCapacity);

      if (dh > 0 || sediment > capacity) {
        // Uphill, or carrying more than this much water can hold. Going uphill it lays down
        // exactly enough to fill the dip it is climbing out of, which is what turns the pit a
        // droplet sim otherwise digs into a hollow with a floor in it.
        const want = dh > 0 ? Math.min(dh, sediment) : (sediment - capacity) * P.depositRate;
        const laid = deposit(ix, iz, u, v, want);
        sediment -= laid;
        movedM3 += laid * area;
      } else {
        // Never more than the step it is about to take: a droplet that digs deeper than the
        // ground in front of it has made its own basin and spends the rest of its life in it.
        const want = Math.min((capacity - sediment) * P.erodeRate, -dh);
        sediment += scrape(ix, iz, want);
      }

      speed = Math.sqrt(Math.max(0, speed * speed - dh * P.gravity));
      water *= 1 - P.evaporation;
      if (water < 0.01) break;
    }
    // Out of road. Silt that is still in suspension settles where the water stopped, spread
    // over the same disc erosion uses so it lands as a patch and not as a pimple. Without this
    // every droplet took its whole load with it, and the island quietly lost a tenth of its
    // volume per bake - all of it off the top, where the droplets start.
    if (sediment > 0) {
      const laid = restI < 0 ? 0 : spread(restI, restJ, sediment);   // <0: it walked into the sea
      movedM3 += laid * area;
      lostM3 += (sediment - laid) * area;
    }
  }

  // ---- how much of it to keep ------------------------------------------------------
  // `strength` is a blend between the island as the relief left it and the island the droplets
  // arrived at, not a multiplier inside the simulation. Turning the rates down was the obvious
  // dial and it does almost nothing: halve the capacity and the erosion rate together and the
  // slope median moves from 0.26 to 0.27, because the shape a droplet sim converges on is a
  // property of the sim and not of how hard it is run. Blending the two heightfields is the
  // only lever that is actually linear in the result, so it is the one that is exposed.
  if (strength < 1) {
    for (let k = 0; k < height.length; k++) {
      if (height[k] !== before[k]) height[k] = before[k] + (height[k] - before[k]) * strength;
    }
  }

  // ---- what it did ----------------------------------------------------------------
  let deepestCutM = 0, thickestFillM = 0, shift = 0, touched = 0, netM3 = 0;
  for (let k = 0; k < height.length; k++) {
    const d = height[k] - before[k];
    if (d === 0) continue;
    touched++;
    shift += Math.abs(d);
    netM3 += d * area;
    if (-d > deepestCutM) deepestCutM = -d;
    if (d > thickestFillM) thickestFillM = d;
  }

  return {
    droplets, spawnSamples: spawn.length, touched,
    // `movedM3` and `lostM3` are what the droplets did; `netM3` and the rest describe the
    // heightfield that came out, which at strength below 1 is not the same island.
    movedM3: movedM3 * strength, lostM3: lostM3 * strength, netM3,
    deepestCutM, thickestFillM,
    meanShiftM: touched ? shift / touched : 0,
  };

  /** Lay `amount` metres down over the four samples the droplet stands between. */
  function deposit(i, j, u, v, amount) {
    if (!(amount > 0)) return 0;
    return add(i, j, amount * (1 - u) * (1 - v))
      + add(i + 1, j, amount * u * (1 - v))
      + add(i, j + 1, amount * (1 - u) * v)
      + add(i + 1, j + 1, amount * u * v);
  }

  function add(i, j, amount) {
    if (!(amount > 0) || i < 0 || j < 0 || i >= n || j >= n) return 0;
    const k = i + j * n;
    if (!open[k]) return 0;
    const room = ceiling - height[k];
    if (room <= 0) return 0;
    const put = amount < room ? amount : room;
    height[k] += put;
    return put;
  }

  /** Lay `amount` metres down over the disc around the droplet. Returns what was laid. */
  function spread(i, j, amount) {
    if (!(amount > 0)) return 0;
    let laid = 0;
    for (let b = 0; b < brushW.length; b++) laid += add(i + brushDI[b], j + brushDJ[b], amount * brushW[b]);
    return laid;
  }

  /** Take `amount` metres out of the disc around the droplet. Returns what was actually taken. */
  function scrape(i, j, amount) {
    if (!(amount > 0)) return 0;
    let took = 0;
    for (let b = 0; b < brushW.length; b++) {
      const ni = i + brushDI[b], nj = j + brushDJ[b];
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
      const nk = ni + nj * n;
      if (!open[nk]) continue;
      const cut = amount * brushW[b];
      height[nk] -= cut;
      took += cut;
    }
    movedM3 += took * area;
    return took;
  }
}
