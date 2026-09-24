// Standing in lava. Every beat, anybody on foot whose feet are on a lava cell of any island
// is hurt through the one door (lib/health.mjs `hurt`, cause `lava`): LAVA_PER_S a second,
// charged per beat by the time since the last one, for as long as they stay in it - and
// since every hurt is combat, no health comes back while they do. When it runs out they are
// sent back to their square or their skiff like any other capture. Not blockable: a shield
// is held against a blow (lib/hostility.mjs), and this never asks whether one is up.
// Plans/vulkaan-in-het-midden.md, section 3 and the Besluiten row "Lava aanraken".
//
// Beside the chase in lib/hostility.mjs and on the same filters (`afoot`): walking,
// outdoors, not at a tiller, posed. Immunity is health's own business - `hurt` refuses a
// player who was sent back a moment ago - so a player dropped at the square is not burnt
// again on the way.
//
// "Which cells are lava" is shared/terrain.mjs's `isLava`, the same mask the page draws the
// flows from and the guards' paths leave out, so what glows is exactly what burns. Only the
// volcano has any; every other island carries the field empty and is skipped for nothing.
import { afoot, pilotsOf, DECK_CLEAR } from './hostility.mjs';

// What a second in lava costs: a little under two seconds from whole (lib/health.mjs
// MAX_HEALTH 100) to nothing, so stepping across a stream is survivable and standing in
// one is not.
export const LAVA_PER_S = 60;
// How far above the ground under them somebody's feet may be and still be in it. A jump
// clears it for as long as it lasts; a body standing on the ground is at 0, give or take
// the quantisation of a pose.
export const LAVA_FEET = 0.5;
// A floor DECK_CLEAR (lib/hostility.mjs) above the terrain is something built over the lava -
// a bridge, a deck - and whoever stands on it is carried clear. The same floor the guards
// walk (crowd.walk.groundOrDeck), so the two agree about where the planks are.

export function createLava({ fleet, crowds, roster, health, now = () => Date.now() }) {
  let last = null;

  function tick() {
    const t = now();
    // Seconds since the last beat, so the damage is a rate and not a count of beats. The
    // cap is for a sea coming back from a suspended process owing minutes: nobody was
    // standing in anything while it was asleep that it should charge them for.
    const dt = last == null ? 0 : Math.min(0.5, Math.max(0, (t - last) / 1000));
    last = t;
    const players = roster.all();
    if (!players.length) return 0;
    const hot = fleet.all().filter((i) => i.terrain && i.terrain.lavaCells && i.terrain.lavaCells.length);
    if (!hot.length) return 0;
    const pilots = pilotsOf(roster);
    let burnt = 0;
    for (const p of players) {
      if (!afoot(p, pilots)) continue;
      for (const island of hot) {
        const terrain = island.terrain;
        const x = p.x - island.origin[0], z = p.z - island.origin[1];
        const gx = Math.floor(x + terrain.half), gz = Math.floor(z + terrain.half);
        if (!terrain.isLava(gx, gz)) continue;
        const ground = terrain.worldHeight(x, z);
        const crowd = crowds.get(island.id);
        const floor = crowd ? crowd.walk.groundOrDeck(x, z) : ground;
        if (floor > ground + DECK_CLEAR) break;       // on something built over it
        if (p.y - ground > LAVA_FEET) break;          // in the air above it
        // At least a sliver on the first beat, when there is no dt yet: stepping in is
        // touching it, and a touch is combat (it holds the regeneration off) even when it
        // costs next to nothing.
        if (health.hurt(p, Math.max(1, LAVA_PER_S * dt), { kind: 'lava', island: island.bundle.island.name })) burnt++;
        break;
      }
    }
    return burnt;
  }

  return { tick };
}
