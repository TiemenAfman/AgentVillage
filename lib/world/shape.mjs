import { makeRng } from '../../shared/rng.mjs';
import { makeNoise, fbm, smoothMin } from './noise.mjs';

// The island's outline.
//
// The old generator added noise to a *radius*: `d = |p| / coastScale + 0.18 * fbm(p)`. That
// can only ever produce a wobbly circle - the topology is fixed before the noise is applied.
// Here the outline is the smooth union of a handful of overlapping discs, sampled through a
// warped domain. Two discs whose centres are further apart than their radii sum meet in a
// neck; the warp then bends the whole thing so no part of it reads as a circle.
//
// The result is a signed field: positive on land, in metres from the waterline, and it keeps
// meaning something well out to sea (that is what the shore profile and the seabed need).

const LOBES = 9;
const BLEND_M = 12;              // smooth-union width: the waist where two lobes meet

// Two scales of domain warp. The large one makes headlands and deep bays; the small one puts
// the 10-20 m crenellation on a spit that makes it read as a spit rather than as a finger.
const WARP_FAR_M = 46, WARP_FAR_SCALE = 210;
const WARP_NEAR_M = 17, WARP_NEAR_SCALE = 42;

// How much of the nominal disc of `radiusM` ends up as land. Well under 1 because an island
// that fills its own bounding circle is a circle; the missing third is bays and open water.
const TARGET_FILL = 0.62;

// How many outlying islets the envelope holds. Fixed, and baked whether or not they are
// published yet - see the note by `skerries` below.
const ISLETS = 6;

/**
 * @param {number|string} seed
 * @param {{radiusM?: number, envelopeM?: number, islets?: number}} opts
 */
export function makeShape(seed, { radiusM = 208, envelopeM = 1024, islets = ISLETS } = {}) {
  const rng = makeRng(seed).fork('shape');
  const scale = radiusM / 208;              // every metre below is quoted for a 416 m island

  // ---- the lobe skeleton -------------------------------------------------------
  // A random walk rather than a ring: a ring of discs is a circle again. Each new centre
  // hangs off one already placed, and its bearing is pushed away from the running centroid
  // so the island spreads instead of piling up on itself.
  const lobes = [{ x: 0, z: 0, r: (78 + rng.range(-8, 14)) * scale }];
  let cx = 0, cz = 0;
  for (let i = 1; i < LOBES; i++) {
    const from = lobes[rng.int(lobes.length)];
    const away = Math.atan2(from.z - cz, from.x - cx);
    const bearing = away + rng.range(-1.05, 1.05);
    const step = (40 + rng.range(0, 50)) * scale;
    const lobe = {
      x: from.x + Math.cos(bearing) * step,
      z: from.z + Math.sin(bearing) * step,
      r: (34 + rng.range(0, 68)) * scale,
    };
    lobes.push(lobe);
    cx = lobes.reduce((s, l) => s + l.x, 0) / lobes.length;
    cz = lobes.reduce((s, l) => s + l.z, 0) / lobes.length;
  }

  // Recentre on the lobes' own middle, so the island sits on the origin whatever the walk did.
  const mx = lobes.reduce((s, l) => s + l.x, 0) / lobes.length;
  const mz = lobes.reduce((s, l) => s + l.z, 0) / lobes.length;
  for (const l of lobes) { l.x -= mx; l.z -= mz; }

  const warpFarX = makeNoise(seed, 'warp:far:x');
  const warpFarZ = makeNoise(seed, 'warp:far:z');
  const warpNearX = makeNoise(seed, 'warp:near:x');
  const warpNearZ = makeNoise(seed, 'warp:near:z');

  const blend = BLEND_M * scale;

  /** Unwarped: metres inside the coast, negative at sea. */
  function raw(x, z) {
    // Seeded with the first lobe rather than Infinity: the polynomial smin interpolates, and
    // `lerp(b, Infinity, 0)` is `b + Infinity * 0`, which is NaN.
    let d = Math.hypot(x - lobes[0].x, z - lobes[0].z) - lobes[0].r;
    for (let i = 1; i < lobes.length; i++) {
      const l = lobes[i];
      d = smoothMin(d, Math.hypot(x - l.x, z - l.z) - l.r, blend);
    }
    return -d;
  }

  /** Unnormalised: the warped field, before the island is sized to its target. */
  function warped(x, z) {
    const far = WARP_FAR_SCALE * scale, near = WARP_NEAR_SCALE * scale;
    const fx = WARP_FAR_M * scale * fbm(warpFarX, x / far, z / far, { octaves: 3 });
    const fz = WARP_FAR_M * scale * fbm(warpFarZ, x / far, z / far, { octaves: 3 });
    const nx = WARP_NEAR_M * scale * fbm(warpNearX, x / near, z / near, { octaves: 4 });
    const nz = WARP_NEAR_M * scale * fbm(warpNearZ, x / near, z / near, { octaves: 4 });
    return raw(x + fx + nx, z + fz + nz);
  }

  // ---- size the island -----------------------------------------------------------
  // The lobe walk gives a different silhouette per seed, which is the point - but it also
  // gives a different *area* per seed, measured at nearly 2x between the widest and the
  // narrowest. The layout engine needs a predictable amount of buildable land or a seed
  // decides how many settlers fit, so the whole field is scaled about the origin until the
  // land area hits its target. Shape stays free; size does not.
  //
  // Scaling the domain rather than the radii keeps the warp in proportion: an island stretched
  // by 15% gets a coastline 15% coarser, not the same crenellation on a larger blob.
  const targetAreaM2 = Math.PI * radiusM * radiusM * TARGET_FILL;
  const probe = (k) => {
    let land = 0;
    const step = radiusM / 24;                    // ~50x50 samples over the bounding window
    const reach = radiusM * 2.2;
    for (let z = -reach; z <= reach; z += step) {
      for (let x = -reach; x <= reach; x += step) {
        if (warped(x / k, z / k) > 0) land += step * step;
      }
    }
    return land;
  };
  let lo = 0.45, hi = 2.2;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (probe(mid) < targetAreaM2) lo = mid; else hi = mid;
  }
  const fit = (lo + hi) / 2;

  function mainCoast(x, z) {
    return warped(x / fit, z / fit) * fit;
  }

  // ---- the skerries ---------------------------------------------------------------
  // Sites come from a fixed lattice computed for the whole envelope at t=0, never from what
  // has been published: islet 4 lands where islet 4 lands whether or not islets 1 to 3 exist.
  // That is what lets the island grow into an archipelago without anything already standing
  // having to move.
  //
  // A district is a git repository, and `lib/layout.mjs` already insists with BELT that no two
  // parcels touch - "the gap between them is the countryside". An islet makes that separation
  // physical and permanent, which is the strongest reason to have them at all.
  // How far the main island reaches along a bearing: the *outermost* crossing of its own
  // coastline, found by marching rather than by bisection. A warped coast is not monotone
  // along a ray - a ray through a bay meets water, then land again on the headland behind
  // it - and a bisection would happily return the first crossing and drop an islet on dry
  // land inside the next lobe.
  function reachAlong(angle) {
    const cosA = Math.cos(angle), sinA = Math.sin(angle);
    const limit = envelopeM / 2;
    let last = 0;
    for (let r = 0; r <= limit; r += 2) {
      if (mainCoast(cosA * r, sinA * r) > 0) last = r;
    }
    return last;
  }

  // Islets are placed off the **coast**, not off the centre. They used to sit on two fixed
  // rings at 0.58 and 0.80 of the envelope, and because the coastline itself swings between
  // about 150 and 260 m on the same island, the water between an islet and the shore came
  // out anywhere from 74 to 228 m. A district on the far side of a 228 m channel is not a
  // district on an islet, it is a district nobody can reach: measured on seed 1337, six of
  // the twelve projects were stranded that way.
  //
  // Measuring from the coast makes the crossing the thing that is chosen, which is what it
  // should have been all along - the gap is what decides whether you walk a causeway, cross
  // a bridge, or need a boat.
  const GAP_MIN_M = 26;
  const GAP_MAX_M = 78;
  const skerries = [];
  {
    const rr = makeRng(seed).fork('skerries');
    const bearing0 = rr.range(0, Math.PI * 2);
    for (let k = 0; k < islets; k++) {
      // Golden-angle spacing so consecutive islets never land side by side, jittered so the
      // ring does not read as a ring.
      const angle = bearing0 + k * 2.39996 + rr.range(-0.22, 0.22);
      const gap = rr.range(GAP_MIN_M, GAP_MAX_M) * scale;

      // The shape first, around its own origin, so its true extent is known before it is
      // placed. Placing first and measuring after is what would put the gap wrong by
      // however far the outermost lobe happened to reach back towards the shore.
      const lobeCount = 2 + rr.int(3);
      const local = [];
      for (let i = 0; i < lobeCount; i++) {
        const a = rr.range(0, Math.PI * 2);
        const step = i === 0 ? 0 : rr.range(12, 34) * scale;
        local.push({ dx: Math.cos(a) * step, dz: Math.sin(a) * step, r: (16 + rr.range(0, 26)) * scale });
      }
      // Reach back along the bearing, which is the only direction the channel is measured in.
      let inward = 0;
      for (const l of local) {
        inward = Math.max(inward, l.r - (l.dx * Math.cos(angle) + l.dz * Math.sin(angle)));
      }

      const dist = reachAlong(angle) + gap + inward;
      const cx = Math.cos(angle) * dist;
      const cz = Math.sin(angle) * dist;
      const lobes = local.map((l) => ({ x: cx + l.dx, z: cz + l.dz, r: l.r }));
      skerries.push({ index: k, x: cx, z: cz, lobes, gapM: gap });
    }
  }

  const skerryBlend = 7 * scale;
  function skerryCoast(x, z) {
    let best = -Infinity;
    for (const s of skerries) {
      // Cheap rejection first: an islet is at most ~60 m across and there are several.
      if (Math.abs(x - s.x) > 140 * scale || Math.abs(z - s.z) > 140 * scale) continue;
      let d = Math.hypot(x - s.lobes[0].x, z - s.lobes[0].z) - s.lobes[0].r;
      for (let i = 1; i < s.lobes.length; i++) {
        const l = s.lobes[i];
        d = smoothMin(d, Math.hypot(x - l.x, z - l.z) - l.r, skerryBlend);
      }
      if (-d > best) best = -d;
    }
    return best;
  }

  /**
   * Signed distance to the nearest coastline in metres: positive inland, negative at sea.
   * This is the one function the rest of the generator asks about the island's outline.
   *
   * `max` and not a smooth union: two landmasses that merged into one would defeat the whole
   * point of putting a district on its own islet.
   */
  function coast(x, z) {
    const main = mainCoast(x, z);
    if (!skerries.length) return main;
    return Math.max(main, skerryCoast(x, z));
  }

  return { coast, mainCoast, raw, lobes, skerries, radiusM, envelopeM, fit };
}
