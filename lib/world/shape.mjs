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
// published yet - see the note by `skerries` below. Sixteen because the real village has
// twelve repositories and eight of them already clear MIN_HAMLET, and repositories keep
// arriving: the shape is fixed at the first publication and forever after, so the headroom
// has to be bought now or not at all.
const ISLETS = 16;

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

  // How far out the archipelago is ever looked for, in metres. Derived from the island's own
  // radius and never from the envelope: `reachAlong` below is the one measurement the skerry
  // walk stands on, and if it could run off the edge of a small window the same seed would
  // bake two different archipelagos. Measured over five seeds the coast never passes 1.6x the
  // radius, so this is comfortable rather than tight.
  const REACH_LIMIT = radiusM * 2.4;

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
  // Sites are decided once for the whole archipelago at t=0, never from what has been
  // published: islet 4 lands where islet 4 lands whether or not islets 1 to 3 exist, and
  // whether the window is 640 m across or 1024. That is what lets the island grow into an
  // archipelago without anything already standing having to move.
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
    let last = 0;
    for (let r = 0; r <= REACH_LIMIT; r += 2) {
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
  //
  // What the coast alone could not do is scale. Six rocks fitted around the island on a
  // golden-angle fan; fourteen do not, because the fan spaces them in *angle* and a rock
  // takes up *arc*. At fourteen, islets 0 and 8 on seed 1337 came out 34 m apart with radii
  // of 51 and 63 m - one landmass, and the whole point of an islet is that it is not.
  //
  // So the rule is a walk rather than a fan, and what it walks around is the **frontier**:
  // how far the archipelago reaches along each bearing, starting as the main island's own
  // coastline and rising as each rock is laid. A rock is dropped a channel beyond whatever
  // shore is already there in front of it, which is the mainland for the first lap and an
  // earlier rock after that. Three things fall out of that and all three are wanted:
  //
  //   * every rock has water of a known width on its landward side, so `linkLandmasses` can
  //     always reach it - from the mainland, or in a chain through the rock inshore of it;
  //   * the ring fills at whatever angular density the coast allows, so rocks crowd where the
  //     island is narrow and spread where it bulges, which is what an archipelago looks like;
  //   * running out of room is not a failure case. The frontier has risen, so the walk simply
  //     comes round again further out.
  // Water between a rock and the shore it was dropped off. Never more than a bridge, so a
  // chain is always possible; never less than a channel, so it is never a sandbar. Both ends
  // are asked of the rock's *bounding circle*, which is the only cheap thing to ask, so the
  // water that comes out is a little wider than this: 25 to 36 m at the near end, measured.
  const GAP_MIN_M = 20;
  const GAP_MAX_M = 64;
  // Water between two rocks that stand side by side. Wanted: twelve metres, so a crossing
  // reads as a crossing. Asked for: sixteen, because the smooth union below carries each
  // coast a couple of metres past the lobes this is measured on.
  const SKERRY_GAP_M = 16;
  // A rock is drawn as an **area** and not as a radius, because what a district wants of one
  // is room for houses, and the outline below varies its own fill by a factor of two. Half a
  // hectare carries a hamlet of three or four once the beach has taken its rim; 1.25 ha
  // carries a dozen. The quadratic makes small rocks the common case and a big one an event.
  const AREA_MIN_M2 = 5000, AREA_MAX_M2 = 12500;
  // How finely the frontier is sampled. Fixed, and with `REACH_LIMIT` fixed too, so the
  // archipelago is the same archipelago in a 640 m window and in a 1024 m one.
  const BEARINGS = 512;
  const TAU = Math.PI * 2;

  const skerries = [];
  {
    const rr = makeRng(seed).fork('skerries');

    const COS = new Float64Array(BEARINGS), SIN = new Float64Array(BEARINGS);
    for (let t = 0; t < BEARINGS; t++) {
      COS[t] = Math.cos((t / BEARINGS) * TAU);
      SIN[t] = Math.sin((t / BEARINGS) * TAU);
    }

    // Two coastlines, and the difference between them is the whole walk.
    //
    // `shore` never changes: it is the main island, marched along the fan and kept as a point
    // cloud - *every* crossing along a bearing, not only the outermost. A ray through a bay
    // meets the water of the bay and then the headland behind it, and a rock dropped into the
    // bay has to clear the bay's own shore. Keeping the outermost crossing alone was tried
    // and it put rocks 1.4 m off the mainland on two seeds in three: separate landmasses on
    // the lot grid by luck, one landmass to look at.
    //
    // `front` starts as the outermost of those and rises as rocks are laid. A bearing where
    // the two still agree is open water off the island's own beach, which is where a rock
    // would rather be; a bearing where they have parted has a rock in front of it already.
    const shore = { r: new Float64Array(BEARINGS), pts: [] };
    for (let t = 0; t < BEARINGS; t++) {
      const hits = [];
      let was = false, outer = 0;
      for (let r = 0; r <= REACH_LIMIT; r += 2) {
        const land = mainCoast(COS[t] * r, SIN[t] * r) > 0;
        if (land !== was) { hits.push(r); was = land; }
        if (land) outer = r;
      }
      shore.pts.push(Float64Array.from(hits));
      shore.r[t] = outer;
    }
    const front = { r: shore.r.slice(), pts: Array.from(shore.r, (r) => Float64Array.of(r)) };

    /**
     * How far out along `angle` the centre of a rock of radius `rOut` has to stand to keep
     * `gap` metres of water between itself and every coast point of `fan`.
     *
     * Only the stretch of coast that can actually be in the way counts. A point at bearing
     * offset D is never nearer than `d * sin D` to a centre at distance `d`, whatever its own
     * radius, so `asin(want / d)` bounds the window - and since the answer is never nearer
     * than the shore straight ahead plus the standoff, that lower bound gives the widest
     * window worth walking. Bounding it by the rock's own silhouette instead was the first
     * attempt and it is wrong for the case that matters: a headland *beyond* the rock is
     * nowhere near its outline and squarely in its way.
     */
    function standOff(fan, angle, rOut, gap) {
      const ux = Math.cos(angle), uz = Math.sin(angle);
      const t0 = ((Math.round((angle / TAU) * BEARINGS) % BEARINGS) + BEARINGS) % BEARINGS;
      const want = rOut + gap;
      const span = Math.ceil((Math.asin(Math.min(1, want / (fan.r[t0] + want))) / TAU) * BEARINGS) + 2;
      let d = want;
      for (let s = -span; s <= span; s++) {
        const t = (((t0 + s) % BEARINGS) + BEARINGS) % BEARINGS;
        for (const r of fan.pts[t]) {
          const dot = ux * COS[t] * r + uz * SIN[t] * r;
          if (dot <= 0) continue;                  // behind: a disc out front cannot reach it
          const disc = dot * dot - r * r + want * want;
          if (disc <= 0) continue;                 // this ray never passes within `want` of it
          const hit = dot + Math.sqrt(disc);
          if (hit > d) d = hit;
        }
      }
      return d;
    }

    /**
     * A rock's outline in units of its own circumscribing radius, so its size is free.
     *
     * The middle lobe carries most of it and the others lean on it. Letting them drift out to
     * half the radius made peanuts, and a peanut is the one shape that loses to the beach:
     * 4 to 19 m of sand comes off every edge, so a waist between two 30 m lobes has no dry
     * middle left and a 0.48 ha rock came out holding one house.
     */
    function outline() {
      const n = 2 + rr.int(3);
      const spin = rr.range(0, TAU);
      const local = [{ dx: 0, dz: 0, r: rr.range(0.58, 0.76) }];
      for (let i = 1; i < n; i++) {
        // Golden angle again, but here it is the right tool: these lobes really are spread
        // around one centre, and the jitter keeps the three-lobed ones off a perfect trefoil.
        const a = spin + i * 2.39996 + rr.range(-0.45, 0.45);
        const d = rr.range(0.20, 0.42);
        local.push({ dx: Math.cos(a) * d, dz: Math.sin(a) * d, r: 1 - d });
      }
      return local;                                // every lobe touches the unit circle or less
    }

    // How much of its own bounding circle a rock has to fill to be worth settling. Measured
    // across three seeds, the rocks that came out holding one house were exactly the ones
    // under 0.7 of it: half a hectare spread over four arms is all beach and no middle, while
    // the same half hectare kept round holds six plots. Pi times this is the unit area below.
    const MIN_FILL = 0.70;

    /** That outline's area, likewise in units of the radius. Counted, because the union of
     *  four overlapping discs has no closed form worth writing down. */
    function unitArea(local) {
      const STEPS = 96;
      let n = 0;
      for (let j = 0; j < STEPS; j++) {
        const z = -1 + (2 * j + 1) / STEPS;
        for (let i = 0; i < STEPS; i++) {
          const x = -1 + (2 * i + 1) / STEPS;
          for (const l of local) {
            if ((x - l.dx) * (x - l.dx) + (z - l.dz) * (z - l.dz) < l.r * l.r) { n++; break; }
          }
        }
      }
      return (n * 4) / (STEPS * STEPS);
    }

    /** Lobe against lobe, not disc against disc: packing rocks by their bounding circles
     *  wastes a third of the ring on water nobody can see. */
    function clearOfRocks(lobes, need) {
      for (const s of skerries) {
        for (const m of s.lobes) {
          for (const l of lobes) {
            const dx = l.x - m.x, dz = l.z - m.z;
            const r = l.r + m.r + need;
            if (dx * dx + dz * dz < r * r) return false;
          }
        }
      }
      return true;
    }

    const bearing0 = rr.range(0, TAU);
    const STEP = TAU / BEARINGS;
    const need = SKERRY_GAP_M * scale;
    let angle = bearing0;

    for (let k = 0; k < islets; k++) {
      // Draw again rather than shrink: a rock too spindly to build on is a rock nobody is
      // ever given, and the ones that came out that way were a fifth of them.
      let local = outline(), unit = unitArea(local);
      for (let redraw = 0; redraw < 8 && unit < MIN_FILL * Math.PI; redraw++) {
        local = outline();
        unit = unitArea(local);
      }
      const areaM2 = (AREA_MIN_M2 + (AREA_MAX_M2 - AREA_MIN_M2) * rr.range(0, 1) ** 2) * scale * scale;
      const rOut = Math.sqrt(areaM2 / unit);
      const gap = rr.range(GAP_MIN_M, GAP_MAX_M) * scale;

      const seat = (a, extra) => {
        // Clear of the island by `gap`, and clear of whatever the archipelago has already put
        // in front of this bearing by the same. The first is the hard one and is what keeps a
        // channel real; the second is what turns "no room left" into a second lap.
        const ashore = standOff(shore, a, rOut, gap + extra);
        const d = Math.max(ashore, standOff(front, a, rOut, gap + extra));
        const cx = Math.cos(a) * d, cz = Math.sin(a) * d;
        return {
          a, d, cx, cz, open: d <= ashore + 1e-9,
          lobes: local.map((l) => ({ x: cx + l.dx * rOut, z: cz + l.dz * rOut, r: l.r * rOut })),
        };
      };

      // A lap of the compass looking for open island shore, then - if the inshore ring is
      // full - the cheapest seat found on that lap, which is a rock standing off another rock.
      // Walking on rather than pushing straight out is what keeps the archipelago a ring of
      // rocks around an island instead of a line of them marching out to sea.
      let seated = null;
      for (let lap = 0; !seated; lap++) {
        // Only ever reached if a whole lap found nowhere at all to stand, which takes a rock
        // smaller than everything already out there. Nudging the standoff seaward terminates.
        const extra = lap * 12 * scale;
        let cheapest = null;
        for (let step = 0; step < BEARINGS; step++, angle += STEP) {
          const spot = seat(angle, extra);
          if (!clearOfRocks(spot.lobes, need)) continue;
          if (spot.open) { seated = spot; break; }
          if (cheapest === null || spot.d < cheapest.d) cheapest = spot;
        }
        if (!seated && cheapest) { seated = cheapest; angle = cheapest.a + STEP; }
      }

      const { cx, cz, lobes } = seated;
      skerries.push({ index: k, x: cx, z: cz, lobes, rOut, areaM2, gapM: gap });

      // The rock is coastline now. Raise the frontier to its seaward edge along every bearing
      // it stands in, which is what puts the next lap a channel beyond this one.
      for (let t = 0; t < BEARINGS; t++) {
        let out = front.r[t];
        for (const l of lobes) {
          const dot = COS[t] * l.x + SIN[t] * l.z;
          if (dot <= 0) continue;
          const perp2 = l.x * l.x + l.z * l.z - dot * dot;
          if (perp2 >= l.r * l.r) continue;
          const hit = dot + Math.sqrt(l.r * l.r - perp2);
          if (hit > out) out = hit;
        }
        if (out > front.r[t]) { front.r[t] = out; front.pts[t] = Float64Array.of(out); }
      }
    }
  }

  const skerryBlend = 7 * scale;
  // How far out a rock still has something to say. Not "as far as the rock is wide": what this
  // field feeds is `relief.height`, whose seabed shelves away from the nearest coast and only
  // levels off on the floor after about three hundred metres. Cut the rock off nearer than
  // that and the bottom steps down where the test stops caring - a square of deep water
  // around every rock, plainly visible from above and already there at the old 140 m.
  const SKERRY_REACH_M = 310;
  const skerryReach = SKERRY_REACH_M * scale;
  const reachOf = skerries.map((s) => s.rOut + skerryReach);
  const bounds = new Float64Array(skerries.length);

  /** One rock's own outline, exactly. `sqrt` of the sum and not `hypot`: hypot guards against
   *  an overflow that cannot happen at these magnitudes, costs several times as much, and is
   *  the one operation here whose precision the standard leaves to the engine. */
  function oneSkerry(s, x, z) {
    let d = Math.sqrt((x - s.lobes[0].x) ** 2 + (z - s.lobes[0].z) ** 2) - s.lobes[0].r;
    for (let i = 1; i < s.lobes.length; i++) {
      const l = s.lobes[i];
      d = smoothMin(d, Math.sqrt((x - l.x) ** 2 + (z - l.z) ** 2) - l.r, skerryBlend);
    }
    return -d;
  }

  function skerryCoast(x, z) {
    // This runs once per sample of the whole envelope and the reach above overlaps most of the
    // archipelago onto most of the sea, so the sixteen rocks are sorted before they are asked.
    // No rock can carry further than its own bounding circle, so that distance is an upper
    // bound on its answer: evaluate the nearest rock properly, and every other rock is then
    // usually settled by one subtraction. Exact, not an approximation - a rock whose bound
    // beats the answer is still evaluated in full.
    let pick = -1, bound = -Infinity;
    for (let i = 0; i < skerries.length; i++) {
      const s = skerries[i];
      const ax = x - s.x, az = z - s.z;
      const box = reachOf[i];
      if (ax > box || ax < -box || az > box || az < -box) { bounds[i] = -Infinity; continue; }
      const b = s.rOut - Math.sqrt(ax * ax + az * az);
      bounds[i] = b;
      if (b > bound) { bound = b; pick = i; }
    }
    if (pick < 0) return -Infinity;

    let best = oneSkerry(skerries[pick], x, z);
    for (let i = 0; i < skerries.length; i++) {
      if (i === pick || bounds[i] <= best) continue;
      const v = oneSkerry(skerries[i], x, z);
      if (v > best) best = v;
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
