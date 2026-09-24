// The volcano in the middle of the sea, and the one copy of what it is.
//
// It is the sea's own island - the one exception to "the sea has no island of its own" -
// and it is allowed to be because it follows entirely from the numbers below. No islander
// sends it and nobody claims it: lib/fleet.mjs raises it from this identity when a sea
// starts, at [0, 0], before anybody joins, and never sweeps it. A restart raises exactly
// the same one, which is why the sea still writes nothing down.
//
// In shared/ rather than lib/ because both ends need the same answer: the sea builds its
// terrain from these numbers, and a page that is handed its bundle builds the identical
// ground from the same fields (seed, size, `volcano: true`) and checks the hash.
import { makeTerrain } from './terrain.mjs';

export const VOLCANO = Object.freeze({
  // Sixteen hex digits, like every other island id, so it passes ISLAND_ID in
  // lib/islandbundle.mjs and fits BOAT_ID and the `guest:<id>:` namespace without a special
  // case. All zeros because it lies at the origin; a real island's id is a sha256 prefix
  // (beaconId) and landing on this one by accident is a one in 2^64 event.
  id: '0000000000000000',
  // A word rather than a number. makeTerrain hashes its seed as a string either way; the
  // word is what the terrain was tuned on (shared/terrain.mjs, `volcano`), and it is also
  // what lets parseBundle tell the one island that may carry a word from every other.
  seed: 'volcano',
  // Half as big again as the 128 it was raised at first, to hold a mountain nearly 40 high
  // with an apron round it wide enough to build on (shared/terrain.mjs, the volcano). 256
  // was measured too: a ground mesh of 131k triangles for a place nobody lives, and the apron
  // only needs 192 to give the Codex houses more plots than RESIDENTS can fill.
  size: 192,
  name: 'De Vulkaan',
  keeper: 'the sea',
  hostile: true,
  volcano: true,
});

export const isVolcano = (id) => id === VOLCANO.id;

// Its ground, the same call every side makes. `volcano: true` is what separates this
// terrain from an ordinary island of the same seed; until shared/terrain.mjs knows the
// flag it is ignored and this is a normal island of the same size, which everything
// downstream also has to survive.
export function volcanoTerrain() {
  return makeTerrain(VOLCANO.seed, { size: VOLCANO.size, volcano: true });
}

// ---- the bridges over the lava ------------------------------------------------------
//
// Three flows run from the rim to the sea, and a flow is a wall: it hurts to stand in, and
// the guards' search leaves it out altogether (lib/hostility.mjs). So each flow gets
// BRIDGES.PER_FLOW crossings, and they are the chokepoints: one down on the apron among the
// Codex houses, one halfway up the cone and one high on it, on the way to the rim.
//
// They are ordinary island bridges - `{ id, axis, cells }` in the bundle, their deck heights
// in `decks` - so everything that already knows a bridge knows these: parseBundle holds them
// to the same whitelist, the sea's crowd stands figures on them and the lava leaves anybody
// on one alone (lib/crowd.mjs setDecks, lib/lava.mjs), and a page draws them with the same
// buildBridgeGeometry its own river crossings come out of (web/js/guest-island.js).
//
// Worked out from the ground alone, like the guardhouse, so a restarted sea builds the same
// ones. Along each flow, in each height band, every cell of it is tried: the crossing goes
// along the axis the flow runs least along, over exactly the run of lava and basalt bank
// there, and lands on the first plain cell either side. The shortest, squarest run with the
// most level banks wins; a crossing whose banks differ by more than MAX_STEP, or whose run is
// longer than MAX_RUN, or that lands on lava, the crater or out of the grid, is never taken.
export const BRIDGES = Object.freeze({
  PER_FLOW: 3,
  // Height bands, as shares of the rim's height (terrain.crater.top), apron first. The
  // apron's is in units, up to BUILD_HEIGHT_MAX, because that is where the houses are.
  BANDS: Object.freeze([[1.2, 4.2, 'u'], [0.3, 0.52, 's'], [0.56, 0.84, 's']]),
  MAX_RUN: 7,
  MAX_STEP: 2.6,
  APART: 12,                     // cells down the flow between two crossings of it
});

// The deck heights along a crossing - the numbers web/js/buildings.js bridgeStops gives a
// crossing over land, where spanToBanks has nothing to extend, so the planks the page draws
// and the floor the sea stands people on are the same planks. Its constants are repeated
// here because this side may not import web/: DECK_LIP, the 0.08 over the abutment, DECK_MIN
// and BRIDGE_ARCH. The arch there is `0.5 - 0.5 cos(2 pi u)`, which is sin^2(pi u); this
// module may not call either, so sin(pi u) is Bhaskara's 16u(1-u) / (5 - 4u(1-u)), which is
// within 0.0016 of it - under a millimetre of deck at the crown.
const DECK_LIP = 0.6, DECK_OVER = 0.08, DECK_MIN = 0.34, BRIDGE_ARCH = 0.34;
// How far every deck cell has to ride over the ground under its middle: over the lava's own
// surface (web/js/lava.js floats it 0.1 up) and past DECK_CLEAR (lib/hostility.mjs), with
// room to spare, so the planks are a floor to everybody who asks.
const DECK_RIDE = 0.2;
function deckHeights(cells, terrain, axis) {
  const k = axis === 'x' ? 0 : 1;
  const n = cells.length;
  const dir = n > 1 ? Math.sign(cells[n - 1][k] - cells[0][k]) : 1;
  const abut = (end, sign) => { const c = [...end]; c[k] += sign * dir; return c; };
  const at = (c) => terrain.cellWorld(c[0], c[1]);
  const a = at(abut(cells[0], -1)), b = at(abut(cells[n - 1], 1));
  const y0 = terrain.worldHeight(a[0], a[1]) + DECK_OVER, y1 = terrain.worldHeight(b[0], b[1]) + DECK_OVER;
  const centres = cells.map(at);
  const s0 = centres[0][k] - DECK_LIP * dir, s1 = centres[n - 1][k] + DECK_LIP * dir;
  const rise = BRIDGE_ARCH * Math.min(1, (n + 1) / 5);
  return centres.map((p, i) => {
    const t = b[k] === a[k] ? 0 : (p[k] - a[k]) / (b[k] - a[k]);
    const u = s1 === s0 ? 0 : Math.min(1, Math.max(0, (p[k] - s0) / (s1 - s0)));
    const q = u * (1 - u), sine = (16 * q) / (5 - 4 * q);
    return [cells[i][0], cells[i][1], Math.max(DECK_MIN, y0 + (y1 - y0) * t) + rise * sine * sine];
  });
}

const bridgesOf = new WeakMap();
export function volcanoBridges(terrain) {
  if (!terrain || !terrain.volcano || !terrain.lavaFlows) return [];
  if (bridgesOf.has(terrain)) return bridgesOf.get(terrain);
  const { size } = terrain;
  const bank = new Uint8Array(size * size);
  for (const [gx, gz] of terrain.lavaBankCells) bank[gx + gz * size] = 1;
  const hot = (gx, gz) => terrain.inGrid(gx, gz) && (terrain.isLava(gx, gz) || bank[gx + gz * size] === 1);
  const top = terrain.crater.top || 15.3;
  const inCrater = (gx, gz) => {
    const [x, z] = terrain.cellWorld(gx, gz);
    return x * x + z * z < (terrain.crater.r + 1) * (terrain.crater.r + 1);
  };
  const out = [];
  terrain.lavaFlows.forEach((course, f) => {
    const n = course.length;
    let made = 0;
    const taken = [];                                // where down the flow the others went
    for (const [lo, hi, unit] of BRIDGES.BANDS) {
      const from = unit === 'u' ? lo : lo * top, to = unit === 'u' ? hi : hi * top;
      let best = null;
      for (let s = 4; s < n - 4; s++) {
        const [gx, gz] = course[s];
        const h = terrain.heightAt(gx, gz);
        if (h < from || h > to) continue;
        // Two crossings of one flow a few cells apart are one crossing twice.
        if (taken.some((t) => Math.abs(t - s) < BRIDGES.APART)) continue;
        const dx = course[s + 3][0] - course[s - 3][0], dz = course[s + 3][1] - course[s - 3][1];
        // Across the flow: along z where it runs along x, and the other way round. A flow
        // running on the diagonal is crossed too, but pays for it (`skew`, below): the run
        // is longer and the deck meets the banks at an angle.
        const major = Math.max(Math.abs(dx), Math.abs(dz)), minor = Math.min(Math.abs(dx), Math.abs(dz));
        if (!major) continue;
        const axis = Math.abs(dx) >= Math.abs(dz) ? 'z' : 'x';
        const skew = minor / major;
        const [sx, sz] = axis === 'x' ? [1, 0] : [0, 1];
        let a = 0, b = 0;
        while (a < BRIDGES.MAX_RUN && hot(gx - (a + 1) * sx, gz - (a + 1) * sz)) a++;
        while (b < BRIDGES.MAX_RUN && hot(gx + (b + 1) * sx, gz + (b + 1) * sz)) b++;
        const cells = [];
        for (let i = -a; i <= b; i++) cells.push([gx + i * sx, gz + i * sz]);
        if (cells.length > BRIDGES.MAX_RUN) continue;
        const ends = [[gx - (a + 1) * sx, gz - (a + 1) * sz], [gx + (b + 1) * sx, gz + (b + 1) * sz]];
        if (ends.some(([ex, ez]) => !terrain.inGrid(ex, ez) || !terrain.isLand(ex, ez) || hot(ex, ez) || inCrater(ex, ez))) continue;
        if (cells.some(([cx, cz]) => inCrater(cx, cz))) continue;
        const step = Math.abs(terrain.heightAt(...ends[0]) - terrain.heightAt(...ends[1]));
        if (step > BRIDGES.MAX_STEP) continue;
        // The deck ramps straight from bank to bank, so where the flow is crossed on the
        // slant of the cone the uphill bank can stand above the planks. Over the lava itself
        // they have to ride clear, or the crossing is not taken; over a bank cell they may
        // run into the basalt - cut into the slope, the way a footbridge's end is - and that
        // cell keeps its ground as the floor (no deck is recorded for it), paid for in the
        // score so the crossing that buries least of itself wins.
        const all = deckHeights(cells, terrain, axis);
        const ground = ([cx, cz]) => terrain.worldHeight(...terrain.cellWorld(cx, cz));
        if (all.some((d) => terrain.isLava(d[0], d[1]) && d[2] < ground(d) + DECK_RIDE)) continue;
        let buried = 0;
        const decks = all.filter((d) => {
          if (d[2] >= ground(d) + DECK_RIDE) return true;
          buried += Math.max(0, ground(d) + DECK_RIDE - d[2]);
          return false;
        });
        const score = cells.length + 2 * step + 3 * skew + 2 * buried;
        if (!best || score < best.score) best = { score, s, axis, cells, ends, decks };
      }
      if (!best) continue;
      taken.push(best.s);
      out.push({
        id: `bridge:lava:${f}:${made}`,
        axis: best.axis,
        cells: best.cells,
        ends: best.ends,
        decks: best.decks,
      });
      made++;
    }
  });
  bridgesOf.set(terrain, out);
  return out;
}

// Every cell a bridge stands on or lands on, keyed `gx + gz * size`: a plot may not take one,
// or the planks would run into somebody's front wall.
function bridgeFoot(terrain) {
  const foot = new Set();
  for (const b of volcanoBridges(terrain)) {
    for (const [gx, gz] of [...b.cells, ...b.ends]) foot.add(gx + gz * terrain.size);
  }
  return foot;
}

// ---- the guardhouse and its guards ---------------------------------------------------
//
// One building on the mountain that the sea puts there itself, and every guard lives in
// it: their door is its door. That keeps them inside the model the crowd already has - a
// figure belongs to a building - with the one new rule that this building has more than
// one resident (lib/crowd.mjs). Plans/vulkaan-in-het-midden.md, section 7.

// Its id, and the pattern every guard's id follows. The page has no building called
// `guard:3`, so it dresses a guard from its own id (web/js/crowd-view.js) - which is also
// what keeps twenty-four guards from all wearing the same face.
export const GUARDHOUSE_ID = 'civic:guardhouse';
export const GUARD_ID = /^guard:\d{1,3}$/;
export const isGuard = (id) => typeof id === 'string' && GUARD_ID.test(id);
export const guardId = (n) => `guard:${n}`;

// There is no guardhouse model yet - Martijn makes the Codex models himself, later - so it
// is drawn as the castle, a stone keep with four towers, which every page has always been
// able to build. A civicType the page does not know would be skipped with a console warning
// on every screen (guest-island.js), and a bundle cannot carry a model. When the real one
// exists this is the one word to change, plus the case in web/js/buildings.js.
export const GUARDHOUSE_LOOKS_LIKE = 'castle';

// How far the guardhouse reaches from the middle of its lot along the ground, the step it
// stands on included: the castle's towers stand out to 0.97 either way and the porch shows
// 0.23 past them (web/js/buildings.js, measured off buildBuilding - tests/imp.test.mjs holds
// the model to this number, since this side may not load it). Everybody who lives at the
// guardhouse stands outside it (lib/crowd.mjs, guardHome); before this number existed the
// first row was put 0.85 out, which is between the front wall and the towers' front, and
// the outer two guards of it stood inside a tower. A new guardhouse model means measuring
// again.
export const GUARDHOUSE_REACH = 1.2;

// How many guards there should be: BASE, and PER_ISLANDER more for every islander online,
// never more than CAP. The cap is not decoration: the hostility tick has three path searches
// a beat for the whole world, and a page's crowd has a fixed number of instance slots.
// RESPAWN_MS is how long a fallen guard takes to come back out of the guardhouse - only if
// the count is still below the target by then. The numbers are the plan's proposal and the
// one copy of each.
export const GUARDS = Object.freeze({ BASE: 4, PER_ISLANDER: 3, CAP: 24, RESPAWN_MS: 20000 });

export function guardTarget(islanders) {
  const n = Math.max(0, Math.floor(Number(islanders) || 0));
  return Math.min(GUARDS.CAP, GUARDS.BASE + GUARDS.PER_ISLANDER * n);
}

// Which way the search for the guardhouse sets off from the crater: a fixed bearing, as a
// unit vector rather than an angle (no cos here - see the rule at the top of shared/rng.mjs).
// South-south-east, and nothing more to it than that it is fixed.
const GUARDHOUSE_BEARING = [0.6, 0.8];

// Where the guardhouse stands, worked out from the ground alone so the sea raises it on the
// same spot every time without writing anything down.
//
// Out along GUARDHOUSE_BEARING from the crater rim, half a cell at a time, trying at each
// step the three-by-three lot under the ray and then lots up to six cells to either side of
// it; the first lot whose nine cells are all buildable, clear of every bridge
// (volcanoBridges), and whose front step is dry, lava-free ground wins. `isBuildable` on the
// volcano already refuses lava, the basalt beside it, the crater, the beach and anything too
// steep or too high, so the first hit outward is as high up the apron as a whole lot will go
// - measured on the 192-grid volcano, 58 cells out and 3.7 up (lot 132,139 facing +z), at
// the top of the foothills where the cone starts; on the 128 one it was lot 79,95. Searching
// sideways at each step rather than the whole ray first is what keeps it that high: straight
// down the bearing the first clean lot is on the beach shelf. Its door faces downhill, away
// from the crater, so the guards come out towards the coast.
//
// `rot` is the layout's own convention (0 = -z, 1 = +x, 2 = +z, 3 = -x; lib/layout.mjs
// `facing`), and `door` the plot cell a door sits in, as scan.mjs's doorOf writes it.
export function guardhouseSite(terrain) {
  const { half, size } = terrain;
  const [bx, bz] = GUARDHOUSE_BEARING;
  const from = (terrain.crater ? terrain.crater.r : 0) + 1;
  const ok = (gx, gz) => gx >= 0 && gz >= 0 && gx < size && gz < size;
  const foot = bridgeFoot(terrain);
  function lot(gx, gz) {
    for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) {
      if (!ok(gx + dx, gz + dz) || !terrain.isBuildable(gx + dx, gz + dz) || foot.has(gx + dx + (gz + dz) * size)) return null;
    }
    const cx = gx + 1.5 - half, cz = gz + 1.5 - half;
    const rot = Math.abs(cx) >= Math.abs(cz) ? (cx >= 0 ? 1 : 3) : (cz >= 0 ? 2 : 0);
    const step = rot === 0 ? [gx + 1, gz - 1] : rot === 1 ? [gx + 3, gz + 1] : rot === 2 ? [gx + 1, gz + 3] : [gx - 1, gz + 1];
    if (!ok(step[0], step[1]) || !terrain.isLand(step[0], step[1]) || terrain.isLava(step[0], step[1])) return null;
    const door = rot === 0 ? [gx + 1, gz] : rot === 1 ? [gx + 2, gz + 1] : rot === 2 ? [gx + 1, gz + 2] : [gx, gz + 1];
    return { plot: { gx, gz, w: 3, d: 3, rot }, door };
  }
  for (let r = from; r < half; r += 0.5) {
    for (let side = 0; side <= 6; side++) {
      for (const s of side ? [side, -side] : [0]) {
        // Across the ray by `s` cells: the perpendicular of (bx, bz) is (-bz, bx).
        const x = bx * r - bz * s, z = bz * r + bx * s;
        const hit = lot(Math.floor(x + half) - 1, Math.floor(z + half) - 1);
        if (hit) return hit;
      }
    }
  }
  return null;
}

// The guardhouse as a building, in the shape parseBundle takes. Null on a mountain with no
// lot anywhere near the bearing, which the volcano does not have - tests/volcano-guards
// asserts it - but a bundle with no guardhouse is still a valid island with no guards.
export function guardhouseSpec(terrain) {
  const site = guardhouseSite(terrain);
  if (!site) return null;
  return {
    id: GUARDHOUSE_ID,
    kind: 'civic',
    civicType: GUARDHOUSE_LOOKS_LIKE,
    name: 'The guardhouse',
    label: 'Guardhouse',
    tier: 'civic',
    style: 'unknown',
    plot: site.plot,
    door: site.door,
  };
}

// ---- the Codex houses --------------------------------------------------------------
//
// Every islander with Codex sessions sends the sea a short list of its Codex settlers
// (lib/islandbundle.mjs packCodex / parseCodex, POST /island/:id/codex), and the sea puts
// them up here: a house on the flank for as many as there are plots, and a bed in the
// guardhouse for the rest. Plans/vulkaan-in-het-midden.md, section 8. Nobody can do anything
// with a house on the volcano, so unlike a house on anybody's own island it is allowed to
// move - the plot follows from the id, not from a layout.json.

// The numbers, and the one copy of each. PER_ISLANDER caps the list on both sides of the
// door (the islander sends the busiest and the newest, the sea refuses more). RESIDENTS caps
// the bodies on the mountain as a whole, because a page draws a crowd into a fixed number of
// instance slots (CAPACITY in web/js/settler-figures.js) and the chase walks every one of
// them: sixteen islanders at sixty is 960, and past this a settler gets neither a house nor a
// body - it waits in the list until somebody leaves. PITCH is the lattice the plots sit on: a
// three-by-three lot and one cell of path between it and the next, which is also the row
// the door steps out into. CLEAR is how far every plot keeps from the guardhouse, whose
// front is where the guards and the lodgers stand.
export const CODEX = Object.freeze({ PER_ISLANDER: 60, RESIDENTS: 360, PITCH: 4, CLEAR: 3 });

// The house tiers a Codex settler may arrive as - lib/village.mjs's TIERS, the ones
// web/js/buildings.js knows how to raise. A list, not a pattern, so a word nobody can draw
// is refused at the door rather than warned about on every screen.
export const CODEX_TIERS = Object.freeze(['tent', 'hut', 'cottage', 'house', 'manor', 'keep']);

// A Codex settler's name on the volcano: the island it came from in front of the redacted
// id it had there, because two islanders can both have a `house:s3`. It is the house's id
// and the resident's - one string, the way every other settler is named after its house -
// and the page dresses the resident from it (web/js/crowd-view.js).
export const codexId = (islandId, id) => `codex:${islandId}:${id}`;
export const isCodex = (id) => typeof id === 'string' && id.startsWith('codex:');
// Which island a Codex id belongs to.
export const codexIsland = (id) => (isCodex(id) ? id.split(':')[1] : null);

// The plots on the flank, in a fixed order, worked out from the ground alone so a restarted
// sea finds the same ones.
//
// Lots on a PITCH lattice, so two never overlap and there is always a cell of path between
// them. A lot is taken if all nine of its cells are buildable (which on the volcano already
// refuses the crater, the lava and the basalt beside it, the beach, and anything too steep
// or too high), it keeps CLEAR cells away from the guardhouse, and the cell its door steps
// out onto is dry, lava-free land, and none of its cells is under a bridge or where one
// lands (volcanoBridges). The door faces away from the crater - downhill, the way the
// guardhouse's does - by the same dominant-axis rule, so a settler comes out of the house
// facing the sea. Measured on the 192-grid volcano: 301 lattice lots are buildable, and 300
// are left once the guardhouse, the bridges and the door steps have had theirs - nearly
// CODEX.RESIDENTS, where the 128 one had 137, so the guardhouse lodges almost nobody now.
//
// The offset of 2 is the one that fitted the most of them on the 128-grid volcano; it is kept
// because moving it moves every plot and there are plots to spare.
export function codexPlots(terrain) {
  const { half, size } = terrain;
  const { PITCH, CLEAR } = CODEX;
  const ok = (gx, gz) => gx >= 0 && gz >= 0 && gx < size && gz < size;
  const gh = guardhouseSite(terrain);
  const foot = bridgeFoot(terrain);
  const nearGuardhouse = (gx, gz) => {
    if (!gh) return false;
    const p = gh.plot;
    return gx + 3 > p.gx - CLEAR && gx < p.gx + p.w + CLEAR && gz + 3 > p.gz - CLEAR && gz < p.gz + p.d + CLEAR;
  };
  const out = [];
  for (let gz = 2; gz + 3 <= size; gz += PITCH) {
    for (let gx = 2; gx + 3 <= size; gx += PITCH) {
      if (nearGuardhouse(gx, gz)) continue;
      let clear = true;
      for (let dz = 0; dz < 3 && clear; dz++) for (let dx = 0; dx < 3; dx++) {
        if (!terrain.isBuildable(gx + dx, gz + dz) || foot.has(gx + dx + (gz + dz) * size)) { clear = false; break; }
      }
      if (!clear) continue;
      const cx = gx + 1.5 - half, cz = gz + 1.5 - half;
      const rot = Math.abs(cx) >= Math.abs(cz) ? (cx >= 0 ? 1 : 3) : (cz >= 0 ? 2 : 0);
      const step = rot === 0 ? [gx + 1, gz - 1] : rot === 1 ? [gx + 3, gz + 1] : rot === 2 ? [gx + 1, gz + 3] : [gx - 1, gz + 1];
      if (!ok(step[0], step[1]) || !terrain.isLand(step[0], step[1]) || terrain.isLava(step[0], step[1])) continue;
      const door = rot === 0 ? [gx + 1, gz] : rot === 1 ? [gx + 2, gz + 1] : rot === 2 ? [gx + 1, gz + 2] : [gx, gz + 1];
      out.push({ plot: { gx, gz, w: 3, d: 3, rot }, door });
    }
  }
  return out;
}
