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
  size: 128,
  name: 'De Vulkaan',
  keeper: 'the sea',
  hostile: true,
  volcano: true,
});

export const isVolcano = (id) => id === VOLCANO.id;

// Its ground, the same call every side makes. `volcano: true` is what separates this
// terrain from an ordinary island of the same seed; until shared/terrain.mjs knows the
// flag it is ignored and this is a normal 128-grid island, which everything downstream
// also has to survive.
export function volcanoTerrain() {
  return makeTerrain(VOLCANO.seed, { size: VOLCANO.size, volcano: true });
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
// it; the first lot whose nine cells are all buildable and whose front step is dry,
// lava-free ground wins. `isBuildable` on the volcano already refuses lava, the basalt beside
// it, the crater, the beach and anything too steep or too high, so the first hit outward is
// as high up the lower flank as a whole lot will go - measured, 36 cells out and 3.8 up
// (lot 79,95 facing +z), where the flank has flattened enough for nine buildable cells in a block. Searching
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
  function lot(gx, gz) {
    for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) {
      if (!ok(gx + dx, gz + dz) || !terrain.isBuildable(gx + dx, gz + dz)) return null;
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
// out onto is dry, lava-free land. The door faces away from the crater - downhill, the way
// the guardhouse's does - by the same dominant-axis rule, so a settler comes out of the house
// facing the sea. Measured: 136 lattice lots are buildable on the volcano, and 134 are left
// once the guardhouse's clearance and the door steps that would open onto lava have had theirs.
//
// The offset of 2 is the one that fits the most of them (0 gives 131, 1 and 3 give 135).
export function codexPlots(terrain) {
  const { half, size } = terrain;
  const { PITCH, CLEAR } = CODEX;
  const ok = (gx, gz) => gx >= 0 && gz >= 0 && gx < size && gz < size;
  const gh = guardhouseSite(terrain);
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
        if (!terrain.isBuildable(gx + dx, gz + dz)) { clear = false; break; }
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
